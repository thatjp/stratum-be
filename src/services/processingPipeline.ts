import { pool, withTransaction } from '../db';
import * as captureStore from '../store/captures';
import * as nuggetStore from '../store/nuggets';
import { extractNuggets } from './extraction';

export async function processCapture(captureId: string): Promise<void> {
  // Load capture with collection intent
  const { rows } = await pool.query(
    `SELECT c.*, col.intent, col.id AS collection_id
     FROM captures c
     JOIN sessions s ON c.session_id = s.id
     JOIN collections col ON s.collection_id = col.id
     WHERE c.id = $1`,
    [captureId],
  );

  const capture = rows[0];
  if (!capture) {
    console.error({ event: 'process_capture_not_found', captureId });
    return;
  }

  // Idempotency guard. Checking the status we just read and then writing it
  // would be a race — two workers could both see 'pending' and both extract —
  // so claim the row with a single conditional UPDATE instead.
  if (!(await captureStore.claimCaptureForProcessing(captureId))) {
    console.log({ event: 'process_capture_skipped', captureId, statusAtRead: capture.processing_status });
    return;
  }

  const text: string = capture.ocr_text ?? capture.transcript ?? '';
  if (!text.trim()) {
    await captureStore.updateCaptureStatus(captureId, 'done');
    return;
  }

  try {
    const nuggets = await extractNuggets(text, capture.intent as string);

    // One transaction for the whole capture: a malformed artifact partway
    // through would otherwise leave orphan nuggets behind while the capture
    // itself is marked failed, and a retry would then duplicate them.
    await withTransaction(async (client) => {
      for (const nuggetData of nuggets) {
        const nugget = await nuggetStore.createNugget(
          {
            captureId,
            collectionId: capture.collection_id as string,
            userId:       capture.user_id as string,
            content:      nuggetData.content,
            sourceText:   nuggetData.sourceText,
            confidence:   nuggetData.confidence,
          },
          client,
        );

        for (const artifactData of nuggetData.artifacts ?? []) {
          await nuggetStore.createArtifact(
            {
              nuggetId: nugget.id,
              userId:   capture.user_id as string,
              kind:     artifactData.kind,
              front:    artifactData.front,
              back:     artifactData.back,
            },
            client,
          );
        }
      }

      await client.query(
        `UPDATE captures SET processing_status = 'done' WHERE id = $1`,
        [captureId],
      );

      await client.query(
        `UPDATE sessions SET status = 'complete', completed_at = NOW()
         WHERE id = $1 AND status = 'active'`,
        [capture.session_id],
      );
    });

    console.log({ event: 'process_capture_done', captureId, nuggetCount: nuggets.length });
  } catch (err) {
    console.error({ event: 'process_capture_failed', captureId, err: String(err) });
    // Back to 'failed' so the claim above can pick it up again, then rethrow so
    // the queue records the failure and schedules a retry. Swallowing it here
    // would leave the job marked complete with nothing extracted.
    await captureStore.updateCaptureStatus(captureId, 'failed');
    throw err;
  }
}
