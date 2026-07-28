import { pool } from '../db';

export interface QuizState {
  active:        boolean;
  questions:     QuizQuestion[];
  currentIndex:  number;
  collectionId:  string | null;
  maxQuestions:  number;
}

export interface QuizQuestion {
  question:       string;
  expectedAnswer: string;
  nuggetId:       string | null;
  userAnswer:     string | null;
  isCorrect:      boolean | null;
  feedback:       string | null;
}

export interface Conversation {
  id:                 string;
  userId:             string;
  collectionId:       string | null;
  scope:              'global' | 'collection' | 'nugget';
  socraticEnabled:    boolean;
  title:              string | null;
  userTitled:         boolean;
  synopsis:           string | null;
  synopsisUpdatedAt:  string | null;
  messageCount:       number;
  quizState:          QuizState | null;
  createdAt:          string;
  updatedAt:          string;
}

export interface MapPayload {
  type:       'map';
  placeName:  string;
  query:      string;
}

export type MessageMetadata = MapPayload;

export interface Message {
  id:             string;
  conversationId: string;
  role:           'user' | 'assistant';
  content:        string;
  tokenCount:     number | null;
  metadata:       MessageMetadata | null;
  createdAt:      string;
}

function rowToConversation(r: Record<string, unknown>): Conversation {
  return {
    id:                r.id as string,
    userId:            r.user_id as string,
    collectionId:      r.collection_id as string | null,
    scope:             r.scope as Conversation['scope'],
    socraticEnabled:   r.socratic_enabled as boolean,
    title:             r.title as string | null,
    userTitled:        (r.user_titled as boolean) ?? false,
    synopsis:          r.synopsis as string | null,
    synopsisUpdatedAt: r.synopsis_updated_at as string | null,
    messageCount:      r.message_count as number,
    quizState:         r.quiz_state as QuizState | null,
    createdAt:         r.created_at as string,
    updatedAt:         r.updated_at as string,
  };
}

function rowToMessage(r: Record<string, unknown>): Message {
  return {
    id:             r.id as string,
    conversationId: r.conversation_id as string,
    role:           r.role as Message['role'],
    content:        r.content as string,
    tokenCount:     r.token_count as number | null,
    metadata:       (r.metadata as MessageMetadata | null) ?? null,
    createdAt:      r.created_at as string,
  };
}

const CONVERSATION_COLS = `
  id, user_id, collection_id, scope, socratic_enabled, title, user_titled,
  synopsis, synopsis_updated_at, message_count, quiz_state, created_at, updated_at
`.trim();

export async function listConversations(
  userId: string,
  limit   = 50,
  before?: string,   // updated_at cursor (ISO string of last item in previous page)
): Promise<{ conversations: Conversation[]; hasMore: boolean }> {
  const vals: unknown[] = [userId, limit + 1];
  const cursorClause = before ? `AND updated_at < $3` : '';
  if (before) vals.push(before);

  const { rows } = await pool.query(
    `SELECT ${CONVERSATION_COLS}
     FROM conversations
     WHERE user_id = $1 AND archived_at IS NULL ${cursorClause}
     ORDER BY updated_at DESC
     LIMIT $2`,
    vals,
  );

  const hasMore = rows.length > limit;
  return { conversations: rows.slice(0, limit).map(rowToConversation), hasMore };
}

export async function archiveConversation(
  id: string,
  userId: string,
  ghostSynopsis: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE conversations SET archived_at = NOW(), ghost_synopsis = $1
     WHERE id = $2 AND user_id = $3 AND archived_at IS NULL`,
    [ghostSynopsis, id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function hardDeleteConversation(id: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM conversations WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function getArchivedConversationGhosts(userId: string): Promise<Array<{ title: string | null; ghostSynopsis: string }>> {
  const { rows } = await pool.query(
    `SELECT title, ghost_synopsis FROM conversations
     WHERE user_id = $1 AND archived_at IS NOT NULL AND ghost_synopsis IS NOT NULL`,
    [userId],
  );
  return rows.map(r => ({ title: r.title as string | null, ghostSynopsis: r.ghost_synopsis as string }));
}

export async function getConversation(id: string, userId: string): Promise<Conversation | null> {
  const { rows } = await pool.query(
    `SELECT ${CONVERSATION_COLS} FROM conversations WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function createConversation(params: {
  userId:       string;
  collectionId?: string | null;
  scope:        Conversation['scope'];
  title?:       string | null;
}): Promise<Conversation> {
  const { rows } = await pool.query(
    `INSERT INTO conversations (user_id, collection_id, scope, title)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.userId, params.collectionId ?? null, params.scope, params.title ?? null],
  );
  return rowToConversation(rows[0]);
}

export async function updateConversation(
  id: string,
  userId: string,
  fields: {
    title?:           string;
    userTitled?:      boolean;
    synopsis?:        string;
    socraticEnabled?: boolean;
    scope?:           Conversation['scope'];
    collectionId?:    string | null;
    quizState?:       QuizState | null;
  },
): Promise<Conversation | null> {
  const sets: string[] = ['updated_at = NOW()'];
  const vals: unknown[] = [];
  let i = 1;

  if (fields.title           !== undefined) { sets.push(`title = $${i++}`);            vals.push(fields.title); }
  if (fields.userTitled      !== undefined) { sets.push(`user_titled = $${i++}`);       vals.push(fields.userTitled); }
  if (fields.synopsis        !== undefined) { sets.push(`synopsis = $${i++}`);         vals.push(fields.synopsis);
                                              sets.push(`synopsis_updated_at = NOW()`); }
  if (fields.socraticEnabled !== undefined) { sets.push(`socratic_enabled = $${i++}`); vals.push(fields.socraticEnabled); }
  if (fields.scope           !== undefined) { sets.push(`scope = $${i++}`);            vals.push(fields.scope); }
  if (fields.collectionId    !== undefined) { sets.push(`collection_id = $${i++}`);    vals.push(fields.collectionId); }
  if (fields.quizState       !== undefined) { sets.push(`quiz_state = $${i++}`);       vals.push(fields.quizState === null ? null : JSON.stringify(fields.quizState)); }

  vals.push(id, userId);
  const { rows } = await pool.query(
    `UPDATE conversations SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i++} RETURNING ${CONVERSATION_COLS}`,
    vals,
  );
  return rows[0] ? rowToConversation(rows[0]) : null;
}

// Atomically update quiz_state only if currentIndex still matches expectedIndex.
// Returns null if the conversation was not found or another write already advanced the index,
// which signals a concurrent-answer collision to the caller.
export async function updateQuizState(
  id:            string,
  userId:        string,
  expectedIndex: number,
  newState:      QuizState,
): Promise<Conversation | null> {
  const { rows } = await pool.query(
    `UPDATE conversations
     SET quiz_state = $1, updated_at = NOW()
     WHERE id = $2
       AND user_id = $3
       AND (quiz_state->>'currentIndex')::int = $4
     RETURNING ${CONVERSATION_COLS}`,
    [JSON.stringify(newState), id, userId, expectedIndex],
  );
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function getMessages(
  conversationId: string,
  userId: string,
  limit = 100,
  before?: string,  // created_at cursor
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const vals: unknown[] = [conversationId, userId, limit + 1];
  const cursorClause = before ? `AND m.created_at < $4` : '';
  if (before) vals.push(before);

  const { rows } = await pool.query(
    `SELECT m.id, m.conversation_id, m.role, m.content, m.token_count, m.metadata, m.created_at
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = $1 AND c.user_id = $2 ${cursorClause}
     ORDER BY m.created_at DESC
     LIMIT $3`,
    vals,
  );

  const hasMore = rows.length > limit;
  // Return in ascending order so the client renders top-to-bottom
  return { messages: rows.slice(0, limit).reverse().map(rowToMessage), hasMore };
}

export async function addMessage(params: {
  conversationId: string;
  role:           Message['role'];
  content:        string;
  tokenCount?:    number;
  metadata?:      MessageMetadata | null;
}): Promise<Message> {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, role, content, token_count, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.conversationId, params.role, params.content, params.tokenCount ?? null,
     params.metadata ? JSON.stringify(params.metadata) : null],
  );
  // message_count and updated_at are maintained by the messages_count_insert
  // trigger, in the same transaction as the insert above — so they can't drift
  // and we don't pay a COUNT(*) over the whole thread on every message.
  return rowToMessage(rows[0]);
}

