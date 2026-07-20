import { pool } from '../db';

export interface Collection {
  id: string;
  userId: string;
  title: string;
  sourceType: string;
  intent: string;
  language: string | null;
  sessionCount: number;
  nuggetCount: number;
  lastSessionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToCollection(row: Record<string, unknown>): Collection {
  return {
    id:            row.id as string,
    userId:        row.user_id as string,
    title:         row.title as string,
    sourceType:    row.source_type as string,
    intent:        row.intent as string,
    language:      row.language as string | null,
    sessionCount:  Number(row.session_count ?? 0),
    nuggetCount:   Number(row.nugget_count ?? 0),
    lastSessionAt: row.last_session_at as string | null,
    createdAt:     row.created_at as string,
    updatedAt:     row.updated_at as string,
  };
}

export async function getCollections(userId: string): Promise<Collection[]> {
  const { rows } = await pool.query(
    `SELECT c.*,
       (SELECT count(*) FROM sessions s WHERE s.collection_id = c.id)::int AS session_count,
       (SELECT count(*) FROM nuggets n WHERE n.collection_id = c.id)::int AS nugget_count,
       (SELECT max(s.started_at) FROM sessions s WHERE s.collection_id = c.id) AS last_session_at
     FROM collections c
     WHERE c.user_id = $1
     ORDER BY c.updated_at DESC`,
    [userId],
  );
  return rows.map(rowToCollection);
}

export async function getCollectionById(id: string, userId: string): Promise<Collection | undefined> {
  const { rows } = await pool.query(
    `SELECT c.*,
       (SELECT count(*) FROM sessions s WHERE s.collection_id = c.id)::int AS session_count,
       (SELECT count(*) FROM nuggets n WHERE n.collection_id = c.id)::int AS nugget_count,
       (SELECT max(s.started_at) FROM sessions s WHERE s.collection_id = c.id) AS last_session_at
     FROM collections c
     WHERE c.id = $1 AND c.user_id = $2`,
    [id, userId],
  );
  return rows[0] ? rowToCollection(rows[0]) : undefined;
}

export async function createCollection(
  userId: string,
  input: { title: string; sourceType: string; intent: string; language?: string },
): Promise<Collection> {
  const { rows } = await pool.query(
    `INSERT INTO collections (user_id, title, source_type, intent, language)
     VALUES ($1, trim($2), $3, $4, $5)
     RETURNING *`,
    [userId, input.title, input.sourceType, input.intent, input.language ?? null],
  );
  return rowToCollection({ ...rows[0], session_count: 0, nugget_count: 0, last_session_at: null });
}
