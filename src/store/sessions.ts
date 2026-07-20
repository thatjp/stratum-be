import { pool } from '../db';

export interface Session {
  id: string;
  collectionId: string;
  userId: string;
  inputMode: string;
  status: string;
  captureCount: number;
  nuggetCount: number;
  artifactCount: number;
  startedAt: string;
  completedAt: string | null;
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id:            row.id as string,
    collectionId:  row.collection_id as string,
    userId:        row.user_id as string,
    inputMode:     row.input_mode as string,
    status:        row.status as string,
    captureCount:  Number(row.capture_count ?? 0),
    nuggetCount:   Number(row.nugget_count ?? 0),
    artifactCount: Number(row.artifact_count ?? 0),
    startedAt:     row.started_at as string,
    completedAt:   row.completed_at as string | null,
  };
}

export async function createSession(
  collectionId: string,
  userId: string,
  inputMode: string,
): Promise<Session> {
  const { rows } = await pool.query(
    `INSERT INTO sessions (collection_id, user_id, input_mode)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [collectionId, userId, inputMode],
  );
  return rowToSession({ ...rows[0], capture_count: 0, nugget_count: 0, artifact_count: 0 });
}

export async function getSessionStatus(id: string, userId: string): Promise<Session | undefined> {
  const { rows } = await pool.query(
    `SELECT s.*,
       (SELECT count(*) FROM captures c WHERE c.session_id = s.id)::int AS capture_count,
       (SELECT count(*) FROM nuggets n
          JOIN captures c ON n.capture_id = c.id WHERE c.session_id = s.id)::int AS nugget_count,
       (SELECT count(*) FROM artifacts a
          JOIN nuggets n ON a.nugget_id = n.id
          JOIN captures c ON n.capture_id = c.id WHERE c.session_id = s.id)::int AS artifact_count
     FROM sessions s
     WHERE s.id = $1 AND s.user_id = $2`,
    [id, userId],
  );
  return rows[0] ? rowToSession(rows[0]) : undefined;
}
