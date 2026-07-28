import { pool, type Queryable } from '../db';

export interface Capture {
  id: string;
  sessionId: string;
  userId: string;
  kind: string;
  sequenceIndex: number;
  processingStatus: string;
  transcript: string | null;
  ocrText: string | null;
  durationSeconds: number | null;
  createdAt: string;
}

function rowToCapture(row: Record<string, unknown>): Capture {
  return {
    id:               row.id as string,
    sessionId:        row.session_id as string,
    userId:           row.user_id as string,
    kind:             row.kind as string,
    sequenceIndex:    Number(row.sequence_index),
    processingStatus: row.processing_status as string,
    transcript:       row.transcript as string | null,
    ocrText:          row.ocr_text as string | null,
    durationSeconds:  row.duration_seconds != null ? Number(row.duration_seconds) : null,
    createdAt:        row.created_at as string,
  };
}

export async function createCapture(input: {
  sessionId: string;
  userId: string;
  kind: string;
  sequenceIndex: number;
  ocrText?: string;
  transcript?: string;
  imageUrl?: string;
  audioUrl?: string;
  durationSeconds?: number;
}, db: Queryable = pool): Promise<Capture> {
  const { rows } = await db.query(
    `INSERT INTO captures
       (session_id, user_id, kind, sequence_index, ocr_text, transcript, image_url, audio_url, duration_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.sessionId, input.userId, input.kind, input.sequenceIndex,
      input.ocrText ?? null, input.transcript ?? null,
      input.imageUrl ?? null, input.audioUrl ?? null,
      input.durationSeconds ?? null,
    ],
  );
  return rowToCapture(rows[0]);
}

// Atomically move a capture into 'extracting', but only from a state that is
// safe to re-process. Returns false when another worker got there first, which
// is what makes processCapture safe to invoke concurrently for the same id.
export async function claimCaptureForProcessing(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE captures SET processing_status = 'extracting'
     WHERE id = $1 AND processing_status IN ('pending', 'failed')`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function updateCaptureStatus(
  id: string,
  status: string,
): Promise<void> {
  await pool.query(
    `UPDATE captures SET processing_status = $1 WHERE id = $2`,
    [status, id],
  );
}
