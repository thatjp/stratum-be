import { pool } from '../db';

export interface Nugget {
  id: string;
  captureId: string;
  collectionId: string;
  userId: string;
  content: string;
  sourceText: string | null;
  confidence: number;
  createdAt: string;
}

export interface Artifact {
  id: string;
  nuggetId: string;
  userId: string;
  kind: string;
  front: string;
  back: string;
  status: string;
  createdAt: string;
}

export async function createNugget(input: {
  captureId: string;
  collectionId: string;
  userId: string;
  content: string;
  sourceText?: string;
  confidence?: number;
}): Promise<Nugget> {
  const { rows } = await pool.query(
    `INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.captureId,
      input.collectionId,
      input.userId,
      input.content,
      input.sourceText ?? null,
      input.confidence ?? 1.0,
    ],
  );
  const r = rows[0];
  return {
    id: r.id, captureId: r.capture_id, collectionId: r.collection_id,
    userId: r.user_id, content: r.content, sourceText: r.source_text,
    confidence: Number(r.confidence), createdAt: r.created_at,
  };
}

export async function createArtifact(input: {
  nuggetId: string;
  userId: string;
  kind: string;
  front: string;
  back: string;
}): Promise<Artifact> {
  const { rows } = await pool.query(
    `INSERT INTO artifacts (nugget_id, user_id, kind, front, back)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.nuggetId, input.userId, input.kind, input.front, input.back],
  );
  const r = rows[0];
  return {
    id: r.id, nuggetId: r.nugget_id, userId: r.user_id,
    kind: r.kind, front: r.front, back: r.back,
    status: r.status, createdAt: r.created_at,
  };
}

export async function getArtifactsForSession(sessionId: string, userId: string): Promise<Artifact[]> {
  const { rows } = await pool.query(
    `SELECT a.* FROM artifacts a
     JOIN nuggets n ON a.nugget_id = n.id
     JOIN captures c ON n.capture_id = c.id
     WHERE c.session_id = $1 AND a.user_id = $2
     ORDER BY a.created_at ASC`,
    [sessionId, userId],
  );
  return rows.map((r) => ({
    id: r.id, nuggetId: r.nugget_id, userId: r.user_id,
    kind: r.kind, front: r.front, back: r.back,
    status: r.status, createdAt: r.created_at,
  }));
}

export async function updateArtifactStatus(id: string, userId: string, status: string): Promise<Artifact | undefined> {
  const { rows } = await pool.query(
    `UPDATE artifacts SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [status, id, userId],
  );
  if (!rows[0]) return undefined;
  const r = rows[0];
  return {
    id: r.id, nuggetId: r.nugget_id, userId: r.user_id,
    kind: r.kind, front: r.front, back: r.back,
    status: r.status, createdAt: r.created_at,
  };
}
