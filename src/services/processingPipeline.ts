import { pool } from '../db';
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

  // Idempotency guard — if already processed or currently processing by another worker, skip
  if (!['pending', 'failed'].includes(capture.processing_status as string)) {
    console.log({ event: 'process_capture_skipped', captureId, status: capture.processing_status });
    return;
  }

  const text: string = capture.ocr_text ?? capture.transcript ?? '';
  if (!text.trim()) {
    await captureStore.updateCaptureStatus(captureId, 'done');
    return;
  }

  try {
    await captureStore.updateCaptureStatus(captureId, 'extracting');

    const nuggets = await extractNuggets(text, capture.intent as string);

    await Promise.all(nuggets.map(async (nuggetData) => {
      const nugget = await nuggetStore.createNugget({
        captureId,
        collectionId: capture.collection_id as string,
        userId:       capture.user_id as string,
        content:      nuggetData.content,
        sourceText:   nuggetData.sourceText,
        confidence:   nuggetData.confidence,
      });

      await Promise.all(nuggetData.artifacts.map((artifactData) =>
        nuggetStore.createArtifact({
          nuggetId: nugget.id,
          userId:   capture.user_id as string,
          kind:     artifactData.kind,
          front:    artifactData.front,
          back:     artifactData.back,
        }),
      ));
    }));

    await captureStore.updateCaptureStatus(captureId, 'done');

    // Update session status to complete
    await pool.query(
      `UPDATE sessions SET status = 'complete', completed_at = NOW()
       WHERE id = $1 AND status = 'active'`,
      [capture.session_id],
    );

    console.log({ event: 'process_capture_done', captureId, nuggetCount: nuggets.length });
  } catch (err) {
    console.error({ event: 'process_capture_failed', captureId, err: String(err) });
    await captureStore.updateCaptureStatus(captureId, 'failed');
  }
}
