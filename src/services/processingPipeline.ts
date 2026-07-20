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
    console.error(`processCapture: capture ${captureId} not found`);
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

    for (const nuggetData of nuggets) {
      const nugget = await nuggetStore.createNugget({
        captureId,
        collectionId: capture.collection_id as string,
        userId:       capture.user_id as string,
        content:      nuggetData.content,
        sourceText:   nuggetData.sourceText,
        confidence:   nuggetData.confidence,
      });

      for (const artifactData of nuggetData.artifacts) {
        await nuggetStore.createArtifact({
          nuggetId: nugget.id,
          userId:   capture.user_id as string,
          kind:     artifactData.kind,
          front:    artifactData.front,
          back:     artifactData.back,
        });
      }
    }

    await captureStore.updateCaptureStatus(captureId, 'done');

    // Update session status to complete
    await pool.query(
      `UPDATE sessions SET status = 'complete', completed_at = NOW()
       WHERE id = $1 AND status = 'active'`,
      [capture.session_id],
    );

    console.log(`processCapture: ${nuggets.length} nuggets extracted from capture ${captureId}`);
  } catch (err) {
    console.error(`processCapture: failed for capture ${captureId}`, err);
    await captureStore.updateCaptureStatus(captureId, 'failed');
  }
}
