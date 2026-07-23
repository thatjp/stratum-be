import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db';
import * as convStore from '../store/conversations';
import type { Message } from '../store/conversations';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYNOPSIS_THRESHOLD = 20;

// Fire-and-forget token usage logger — never blocks the calling path
function logTokenUsage(params: {
  userId:         string;
  conversationId?: string;
  operation:      string;
  model:          string;
  inputTokens:    number;
  outputTokens:   number;
}): void {
  pool.query(
    `INSERT INTO token_usage (user_id, conversation_id, operation, model, input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.userId, params.conversationId ?? null, params.operation, params.model, params.inputTokens, params.outputTokens],
  ).catch((err: unknown) =>
    console.error({ event: 'token_usage_log_failed', err: String(err) }),
  );
}
const CONTEXT_WINDOW     = 10;
const MAX_QUIZ_QUESTIONS = 25;

// Ghost context cache — avoids two DB queries on every chat message
const GHOST_CACHE_TTL_MS = 5 * 60 * 1000;
const ghostCache = new Map<string, { context: string; expiresAt: number }>();

async function getGhostContext(userId: string): Promise<string> {
  const cached = ghostCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.context;

  const [cgRows, cvRows] = await Promise.all([
    pool.query(
      `SELECT title, ghost_synopsis FROM collections WHERE user_id = $1 AND archived_at IS NOT NULL AND ghost_synopsis IS NOT NULL`,
      [userId],
    ),
    pool.query(
      `SELECT title, ghost_synopsis FROM conversations WHERE user_id = $1 AND archived_at IS NOT NULL AND ghost_synopsis IS NOT NULL`,
      [userId],
    ),
  ]);

  const ghosts = [
    ...cgRows.rows.map((r: Record<string, unknown>) => `- Collection "${r.title as string}": ${r.ghost_synopsis as string}`),
    ...cvRows.rows.map((r: Record<string, unknown>) => `- Conversation "${(r.title as string | null) ?? 'untitled'}": ${r.ghost_synopsis as string}`),
  ];

  const context = ghosts.length
    ? `\n\nThe user has previously studied or discussed the following (archived — use only as passive background, do not proactively reference unless relevant):\n${ghosts.join('\n')}`
    : '';

  ghostCache.set(userId, { context, expiresAt: Date.now() + GHOST_CACHE_TTL_MS });
  return context;
}

export function invalidateGhostCache(userId: string): void {
  ghostCache.delete(userId);
}

// MARK: - System prompt

export async function buildSystemPrompt(conv: convStore.Conversation): Promise<string> {
  // Fetch collection context and ghost context in parallel
  const [collectionRow, ghostContext] = await Promise.all([
    conv.collectionId
      ? pool.query(
          `SELECT c.title, c.intent, COUNT(n.id)::int AS nugget_count
           FROM collections c
           LEFT JOIN nuggets n ON n.collection_id = c.id
           WHERE c.id = $1
           GROUP BY c.id`,
          [conv.collectionId],
        ).then((r) => r.rows[0] ?? null)
      : Promise.resolve(null),
    getGhostContext(conv.userId),
  ]);

  const collectionContext = collectionRow
    ? `\nYou are discussing the collection "${collectionRow.title as string}" (${collectionRow.intent as string} intent, ${collectionRow.nugget_count as number} nuggets captured). Draw on this context when relevant.`
    : '';

  const socraticSection = conv.socraticEnabled
    ? `Your default approach is Socratic — lead with thoughtful questions that help the user discover insights rather than handing them answers directly. Only pivot to direct explanation when the user is clearly stuck or explicitly asks you to explain.`
    : `The user has disabled Socratic mode. Be naturally conversational and mostly explanatory — give direct, clear answers. You may occasionally ask a follow-up question to check understanding, but don't overdo it.`;

  const quizSection = conv.quizState?.active
    ? `\n\nA QUIZ IS IN PROGRESS. You are on question ${conv.quizState.currentIndex + 1} of ${conv.quizState.maxQuestions}. Do not break the quiz flow or offer explanations mid-quiz unless asked. After grading each answer, move directly to the next question.`
    : '';

  const synopsisSection = conv.synopsis
    ? `\n\nConversation history (synopsis):\n${conv.synopsis}\n\nThe messages below are the most recent part of the conversation.`
    : '';

  return `You are Stratum, an intelligent study companion that helps users understand what they read and capture.${collectionContext}${ghostContext}

${socraticSection}

Whenever you write code, wrap it in markdown code fences with the language tag (e.g. \`\`\`swift ... \`\`\`). Keep code examples concise and runnable.

Keep responses conversational and sized for a mobile chat — 2-4 short paragraphs or equivalent. Never use large headers or bullet-heavy lists unless the content genuinely calls for it.${quizSection}${synopsisSection}`;
}

// MARK: - Regular chat

export async function chat(params: {
  conv:           convStore.Conversation;
  userMessage:    string;
  recentMessages: convStore.Message[];
}): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const systemPrompt = await buildSystemPrompt(params.conv);

  const apiMessages: Anthropic.MessageParam[] = params.recentMessages.map((m) => ({
    role:    m.role as 'user' | 'assistant',
    content: m.content,
  }));
  apiMessages.push({ role: 'user', content: params.userMessage });

  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   apiMessages,
  });

  const content = response.content[0].type === 'text' ? response.content[0].text : '';
  logTokenUsage({
    userId:         params.conv.userId,
    conversationId: params.conv.id,
    operation:      'chat',
    model,
    inputTokens:    response.usage.input_tokens,
    outputTokens:   response.usage.output_tokens,
  });
  return { content, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}

// MARK: - Ghost synopsis generation

export async function generateCollectionGhost(params: {
  title:    string;
  userId:   string;
  collectionId: string;
}): Promise<string> {
  const { rows } = await pool.query(
    `SELECT content FROM nuggets WHERE collection_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 60`,
    [params.collectionId, params.userId],
  );

  if (!rows.length) {
    return `The user previously studied "${params.title}" but captured no notes.`;
  }

  const nuggetText = (rows as Array<{ content: string }>)
    .map((r, i) => `${i + 1}. ${r.content}`)
    .join('\n');

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages:   [{
      role:    'user',
      content: `The user has archived a collection titled "${params.title}". Write a 2-4 sentence ghost summary capturing the key topics and concepts they studied. This will be used as silent background context in future AI conversations. Third person, factual, no fluff.\n\nNuggets:\n${nuggetText}`,
    }],
  });

  return response.content[0].type === 'text'
    ? response.content[0].text
    : `The user previously studied "${params.title}".`;
}

export async function generateConversationGhost(params: {
  title:          string | null;
  synopsis:       string | null;
  messages:       Message[];
}): Promise<string> {
  const label = params.title ?? 'a conversation';

  if (!params.synopsis && !params.messages.length) {
    return `The user previously had ${label} with no recorded content.`;
  }

  const contextParts: string[] = [];
  if (params.synopsis) contextParts.push(`Synopsis: ${params.synopsis}`);
  if (params.messages.length) {
    const transcript = params.messages.slice(-20)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    contextParts.push(`Recent messages:\n${transcript}`);
  }

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages:   [{
      role:    'user',
      content: `The user has archived ${label}. Write a 1-3 sentence ghost summary of what was discussed. This will be silent background context in future AI conversations. Third person, factual.\n\n${contextParts.join('\n\n')}`,
    }],
  });

  return response.content[0].type === 'text'
    ? response.content[0].text
    : `The user previously had ${label}.`;
}

// MARK: - Map detection

const MAP_KEYWORDS = /\b(where is|where('s| is) (the|a)\b|map of|located in|location of|find .{1,40} on a map|directions? to|navigate to|show me .{1,30} on (a )?map)\b/i;

export async function detectMapPayload(
  userMessage: string,
  aiResponse:  string,
): Promise<convStore.MapPayload | null> {
  // Skip the model call entirely if neither message contains geographic vocabulary
  if (!MAP_KEYWORDS.test(userMessage) && !MAP_KEYWORDS.test(aiResponse)) return null;

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 128,
    messages:   [{
      role:    'user',
      content: `Does this exchange ask where a place is or request a map?

User: ${userMessage}
Assistant: ${aiResponse}

If yes: {"isMap":true,"placeName":"<name>","query":"<maps search query>"}
If no: {"isMap":false}
Return ONLY valid JSON.`,
    }],
  });

  const raw     = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as { isMap: boolean; placeName?: string; query?: string };
    if (parsed.isMap && parsed.placeName && parsed.query) {
      return { type: 'map', placeName: parsed.placeName, query: parsed.query };
    }
  } catch { /* not a map */ }
  return null;
}

// MARK: - Quiz generation

export async function generateQuizQuestions(params: {
  collectionIds:    string[];
  userId:           string;
  count:            number;
  purpose?:         string | null;
  convSynopsis?:    string | null;
  recentMessages?:  convStore.Message[];
}): Promise<convStore.QuizQuestion[]> {
  const clampedCount = Math.min(params.count, MAX_QUIZ_QUESTIONS);

  // Collect nuggets from specified collections (optional enrichment)
  let nuggetRows: Array<Record<string, unknown>> = [];
  if (params.collectionIds.length) {
    const { rows } = await pool.query(
      `SELECT n.id AS nugget_id, n.content FROM nuggets n
       WHERE n.collection_id = ANY($1::uuid[]) AND n.user_id = $2
       ORDER BY RANDOM() LIMIT $3`,
      [params.collectionIds, params.userId, clampedCount * 3],
    );
    nuggetRows = rows;
  }

  // Build context sections — conversation history is primary; nuggets are additive
  const parts: string[] = [];

  if (params.convSynopsis) {
    parts.push(`Conversation summary:\n${params.convSynopsis}`);
  }

  if (params.recentMessages?.length) {
    const transcript = params.recentMessages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    parts.push(`Recent conversation:\n${transcript}`);
  }

  if (nuggetRows.length) {
    const nuggetText = nuggetRows
      .map((r) => `- [${r.nugget_id as string}] ${r.content as string}`)
      .join('\n');
    parts.push(`Knowledge nuggets:\n${nuggetText}`);
  }

  // If we have no context at all, generate a general knowledge quiz
  const contextBlock = parts.length
    ? `Use the following context to generate questions:\n\n${parts.join('\n\n')}`
    : `Generate general knowledge quiz questions on any interesting topic.`;

  const purposeLine = params.purpose
    ? `\nFocus area: ${params.purpose}\nPrioritize questions relevant to this focus.\n`
    : '';

  const response = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages:   [{
      role:    'user',
      content: `Generate exactly ${clampedCount} quiz questions. Return ONLY valid JSON, no markdown.
${purposeLine}
${contextBlock}

Return a JSON array:
[{"question":"...","expectedAnswer":"...","nuggetId":"<nugget_id or null>"}]

Rules: distinct concepts, clear questions, concise answers (under 200 chars), vary question types. Only set nuggetId when the question comes directly from a nugget with an ID.`,
    }],
  });

  const raw     = response.content[0].type === 'text' ? response.content[0].text : '[]';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Array<{ question: string; expectedAnswer: string; nuggetId: string | null }>;
    return parsed.slice(0, clampedCount).map((q) => ({
      question:       q.question,
      expectedAnswer: q.expectedAnswer,
      nuggetId:       q.nuggetId ?? null,
      userAnswer:     null,
      isCorrect:      null,
      feedback:       null,
    }));
  } catch {
    return [];
  }
}

// MARK: - Grade a single answer

export async function gradeAnswer(params: {
  question:       string;
  expectedAnswer: string;
  userAnswer:     string;
}): Promise<{ isCorrect: boolean; feedback: string }> {
  const response = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 256,
    messages:   [{
      role:    'user',
      content: `Grade this answer. Return ONLY valid JSON.

Question: ${params.question}
Expected: ${params.expectedAnswer}
User answer: ${params.userAnswer}

{"isCorrect": true/false, "feedback": "1-2 sentences. If wrong, explain why and give the right answer briefly."}

Be generous — mark correct if the user captures the essential meaning.`,
    }],
  });

  const raw     = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as { isCorrect: boolean; feedback: string };
    return { isCorrect: Boolean(parsed.isCorrect), feedback: String(parsed.feedback ?? '') };
  } catch {
    return { isCorrect: false, feedback: 'Unable to grade answer.' };
  }
}

// MARK: - Quiz completion summary

export async function generateQuizSummary(questions: convStore.QuizQuestion[]): Promise<{
  summary:        string;
  score:          number;
  weakNuggetIds:  string[];
}> {
  const score  = questions.filter((q) => q.isCorrect).length;
  const total  = questions.length;
  const details = questions.map((q, i) =>
    `Q${i + 1}: ${q.question}\nAnswer: ${q.userAnswer ?? '(none)'}\nCorrect: ${q.isCorrect ? 'Yes' : 'No'}\nFeedback: ${q.feedback ?? ''}`,
  ).join('\n\n');

  const response = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 400,
    messages:   [{
      role:    'user',
      content: `The user scored ${score}/${total} on a quiz. Write a brief, encouraging 2-3 sentence summary of their performance. Mention specific strengths and what to review. Return ONLY valid JSON: {"summary":"..."}

${details}`,
    }],
  });

  const raw     = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let summary   = `You scored ${score} out of ${total}.`;
  try {
    const parsed = JSON.parse(cleaned) as { summary: string };
    summary = parsed.summary ?? summary;
  } catch { /* keep default */ }

  const weakNuggetIds = questions
    .filter((q) => !q.isCorrect && q.nuggetId)
    .map((q) => q.nuggetId as string);

  return { summary, score, weakNuggetIds };
}

// MARK: - Create review cards from weak nuggets

export async function createCardsFromNuggets(params: {
  nuggetIds: string[];
  userId:    string;
}): Promise<number> {
  if (!params.nuggetIds.length) return 0;

  const { rows } = await pool.query(
    `SELECT id, content FROM nuggets WHERE id = ANY($1::uuid[]) AND user_id = $2`,
    [params.nuggetIds, params.userId],
  );

  // Filter out nuggets that already have an accepted artifact
  const { rows: existingRows } = await pool.query(
    `SELECT nugget_id FROM artifacts WHERE nugget_id = ANY($1::uuid[]) AND status = 'accepted'`,
    [rows.map((r) => r.id as string)],
  );
  const existingIds = new Set(existingRows.map((r) => r.nugget_id as string));
  const toProcess = (rows as Array<{ id: string; content: string }>).filter((r) => !existingIds.has(r.id));

  if (!toProcess.length) return 0;

  const CONCURRENCY = 5;
  let created = 0;

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (nugget) => {
        const response = await client.messages.create({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages:   [{
            role:    'user',
            content: `Create one flashcard from this nugget. Return ONLY valid JSON: {"front":"...","back":"..."}

Nugget: ${nugget.content}`,
          }],
        });

        const raw     = response.content[0].type === 'text' ? response.content[0].text : '{}';
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const card    = JSON.parse(cleaned) as { front: string; back: string };
        await pool.query(
          `INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, due_at)
           VALUES ($1, $2, 'flashcard', $3, $4, 'accepted', NOW())`,
          [nugget.id, params.userId, card.front, card.back],
        );
      }),
    );
    created += results.filter((r) => r.status === 'fulfilled').length;
  }

  return created;
}

// MARK: - Auto title

export async function maybeAutoTitle(
  conversationId: string,
  userId:         string,
  conv:           convStore.Conversation,
  firstUserMessage: string,
  firstAiReply:     string,
): Promise<void> {
  if (conv.userTitled) return;
  // Only title on the first exchange — messageCount was incremented before this call
  if (conv.messageCount > 2) return;

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 24,
    messages:   [{
      role:    'user',
      content: `Write a 3-6 word title for this conversation exchange. Return only the title, no punctuation, no quotes.

User: ${firstUserMessage.slice(0, 300)}
Assistant: ${firstAiReply.slice(0, 300)}`,
    }],
  });

  const title = response.content[0].type === 'text'
    ? response.content[0].text.trim().replace(/^["']|["']$/g, '')
    : null;

  if (title) {
    await convStore.updateConversation(conversationId, userId, { title });
  }
}

// MARK: - Synopsis compression

export async function maybeSynopsize(
  conversationId: string,
  userId:         string,
  conv:           convStore.Conversation,
): Promise<void> {
  if (conv.messageCount < SYNOPSIS_THRESHOLD) return;

  // Guard against concurrent runs: skip if a synopsis was written in the last 60s
  if (conv.synopsisUpdatedAt) {
    const age = Date.now() - new Date(conv.synopsisUpdatedAt).getTime();
    if (age < 60_000) return;
  }

  const { messages: allMessages } = await convStore.getMessages(conversationId, userId, 1000);
  if (allMessages.length < SYNOPSIS_THRESHOLD) return;

  const toCompress = allMessages.slice(0, allMessages.length - CONTEXT_WINDOW);
  if (!toCompress.length) return;

  const transcript = toCompress
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const existing = conv.synopsis ? `Previous synopsis:\n${conv.synopsis}\n\nNew messages:\n` : '';

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages:   [{
      role:    'user',
      content: `${existing}Summarize this conversation excerpt in 3-6 sentences. Third person. Capture topics, insights reached, unresolved questions.\n\n${transcript}`,
    }],
  });

  const synopsis = response.content[0].type === 'text' ? response.content[0].text : '';
  if (!synopsis) return;

  // Write synopsis first — if this fails, messages are still intact
  await convStore.updateConversation(conversationId, userId, { synopsis });

  // Only delete after the synopsis is safely persisted
  const ids = toCompress.map((m) => m.id);
  if (ids.length) {
    await pool.query(`DELETE FROM messages WHERE id = ANY($1::uuid[])`, [ids]);
    await pool.query(
      `UPDATE conversations
       SET message_count = (SELECT COUNT(*) FROM messages WHERE conversation_id = $1)
       WHERE id = $1`,
      [conversationId],
    );
  }
}
