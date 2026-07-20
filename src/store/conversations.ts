import { pool } from '../db';

export interface Conversation {
  id: string;
  userId: string;
  collectionId: string | null;
  scope: 'global' | 'collection' | 'nugget';
  mode: 'socratic' | 'discussion' | 'explain' | 'quiz';
  title: string | null;
  synopsis: string | null;
  synopsisUpdatedAt: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  tokenCount: number | null;
  createdAt: string;
}

function rowToConversation(r: Record<string, unknown>): Conversation {
  return {
    id:                 r.id as string,
    userId:             r.user_id as string,
    collectionId:       r.collection_id as string | null,
    scope:              r.scope as Conversation['scope'],
    mode:               r.mode as Conversation['mode'],
    title:              r.title as string | null,
    synopsis:           r.synopsis as string | null,
    synopsisUpdatedAt:  r.synopsis_updated_at as string | null,
    messageCount:       r.message_count as number,
    createdAt:          r.created_at as string,
    updatedAt:          r.updated_at as string,
  };
}

function rowToMessage(r: Record<string, unknown>): Message {
  return {
    id:             r.id as string,
    conversationId: r.conversation_id as string,
    role:           r.role as Message['role'],
    content:        r.content as string,
    tokenCount:     r.token_count as number | null,
    createdAt:      r.created_at as string,
  };
}

export async function listConversations(userId: string): Promise<Conversation[]> {
  const { rows } = await pool.query(
    `SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(rowToConversation);
}

export async function getConversation(id: string, userId: string): Promise<Conversation | null> {
  const { rows } = await pool.query(
    `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function createConversation(params: {
  userId: string;
  collectionId?: string | null;
  scope: Conversation['scope'];
  mode: Conversation['mode'];
  title?: string | null;
}): Promise<Conversation> {
  const { rows } = await pool.query(
    `INSERT INTO conversations (user_id, collection_id, scope, mode, title)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.userId, params.collectionId ?? null, params.scope, params.mode, params.title ?? null],
  );
  return rowToConversation(rows[0]);
}

export async function updateConversation(
  id: string,
  userId: string,
  fields: { title?: string; synopsis?: string; mode?: Conversation['mode']; scope?: Conversation['scope']; collectionId?: string | null },
): Promise<Conversation | null> {
  const sets: string[] = ['updated_at = NOW()'];
  const vals: unknown[] = [];
  let i = 1;

  if (fields.title !== undefined)        { sets.push(`title = $${i++}`);         vals.push(fields.title); }
  if (fields.synopsis !== undefined)     { sets.push(`synopsis = $${i++}`);      vals.push(fields.synopsis);
                                           sets.push(`synopsis_updated_at = NOW()`); }
  if (fields.mode !== undefined)         { sets.push(`mode = $${i++}`);          vals.push(fields.mode); }
  if (fields.scope !== undefined)        { sets.push(`scope = $${i++}`);         vals.push(fields.scope); }
  if (fields.collectionId !== undefined) { sets.push(`collection_id = $${i++}`); vals.push(fields.collectionId); }

  vals.push(id, userId);
  const { rows } = await pool.query(
    `UPDATE conversations SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i++} RETURNING *`,
    vals,
  );
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function deleteConversation(id: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM conversations WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function getMessages(conversationId: string, userId: string): Promise<Message[]> {
  // Verify ownership via conversation
  const conv = await getConversation(conversationId, userId);
  if (!conv) return [];
  const { rows } = await pool.query(
    `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId],
  );
  return rows.map(rowToMessage);
}

export async function addMessage(params: {
  conversationId: string;
  role: Message['role'];
  content: string;
  tokenCount?: number;
}): Promise<Message> {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, role, content, token_count)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.conversationId, params.role, params.content, params.tokenCount ?? null],
  );
  await pool.query(
    `UPDATE conversations SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1`,
    [params.conversationId],
  );
  return rowToMessage(rows[0]);
}
