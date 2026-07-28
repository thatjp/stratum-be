import { pool } from '../db';

export interface Collection {
  id: string;
  userId: string;
  title: string;
  sourceType: string;
  intent: string;
  language: string | null;
  goal: string | null;
  goalTargetAt: string | null;
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
    goal:          (row.goal as string | null) ?? null,
    goalTargetAt:  (row.goal_target_at as string | null) ?? null,
    sessionCount:  Number(row.session_count ?? 0),
    nuggetCount:   Number(row.nugget_count ?? 0),
    lastSessionAt: row.last_session_at as string | null,
    createdAt:     row.created_at as string,
    updatedAt:     row.updated_at as string,
  };
}

const COLLECTION_SELECT = `
  SELECT c.*,
         COALESCE(s.session_count, 0)::int AS session_count,
         COALESCE(n.nugget_count, 0)::int  AS nugget_count,
         s.last_session_at
  FROM collections c
  LEFT JOIN (
    SELECT collection_id,
           COUNT(*)::int        AS session_count,
           MAX(started_at)      AS last_session_at
    FROM sessions
    GROUP BY collection_id
  ) s ON s.collection_id = c.id
  LEFT JOIN (
    SELECT collection_id, COUNT(*)::int AS nugget_count
    FROM nuggets
    GROUP BY collection_id
  ) n ON n.collection_id = c.id
`;

export async function getCollections(userId: string): Promise<Collection[]> {
  const { rows } = await pool.query(
    `${COLLECTION_SELECT}
     WHERE c.user_id = $1 AND c.archived_at IS NULL
     ORDER BY c.updated_at DESC`,
    [userId],
  );
  return rows.map(rowToCollection);
}

export async function archiveCollection(
  id: string,
  userId: string,
  ghostSynopsis: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE collections SET archived_at = NOW(), ghost_synopsis = $1
     WHERE id = $2 AND user_id = $3 AND archived_at IS NULL`,
    [ghostSynopsis, id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function hardDeleteCollection(id: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM collections WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function getArchivedCollectionGhosts(userId: string): Promise<Array<{ title: string; ghostSynopsis: string }>> {
  const { rows } = await pool.query(
    `SELECT title, ghost_synopsis FROM collections
     WHERE user_id = $1 AND archived_at IS NOT NULL AND ghost_synopsis IS NOT NULL`,
    [userId],
  );
  return rows.map(r => ({ title: r.title as string, ghostSynopsis: r.ghost_synopsis as string }));
}

export async function getCollectionById(id: string, userId: string): Promise<Collection | undefined> {
  const { rows } = await pool.query(
    `${COLLECTION_SELECT}
     WHERE c.id = $1 AND c.user_id = $2`,
    [id, userId],
  );
  return rows[0] ? rowToCollection(rows[0]) : undefined;
}

export async function createCollection(
  userId: string,
  input: {
    title: string;
    sourceType: string;
    intent: string;
    language?: string;
    goal: string;
    goalTargetAt?: string | null;
  },
): Promise<Collection> {
  const { rows } = await pool.query(
    `INSERT INTO collections (user_id, title, source_type, intent, language, goal, goal_target_at)
     VALUES ($1, trim($2), $3, $4, $5, trim($6), $7)
     RETURNING *`,
    [
      userId,
      input.title,
      input.sourceType,
      input.intent,
      input.language ?? null,
      input.goal,
      input.goalTargetAt ?? null,
    ],
  );
  return rowToCollection({ ...rows[0], session_count: 0, nugget_count: 0, last_session_at: null });
}

export async function updateCollection(
  id: string,
  userId: string,
  input: {
    title?: string;
    intent?: string;
    sourceType?: string;
    language?: string | null;
    goal?: string;
    goalTargetAt?: string | null;
  },
): Promise<Collection | undefined> {
  const existing = await getCollectionById(id, userId);
  if (!existing) return undefined;

  const title        = input.title?.trim()        ?? existing.title;
  const intent       = input.intent               ?? existing.intent;
  const sourceType   = input.sourceType           ?? existing.sourceType;
  const language     = input.language !== undefined ? input.language : existing.language;
  const goal         = input.goal !== undefined ? input.goal.trim() : (existing.goal ?? '');
  const goalTargetAt = input.goalTargetAt !== undefined ? input.goalTargetAt : existing.goalTargetAt;

  if (!title) throw new Error('title is required');
  if (!goal)  throw new Error('goal is required');

  await pool.query(
    `UPDATE collections
     SET title = $1, intent = $2, source_type = $3, language = $4,
         goal = $5, goal_target_at = $6, updated_at = NOW()
     WHERE id = $7 AND user_id = $8 AND archived_at IS NULL`,
    [title, intent, sourceType, language, goal, goalTargetAt, id, userId],
  );

  return getCollectionById(id, userId);
}
