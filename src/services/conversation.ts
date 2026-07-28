import { z } from 'zod';
import { pool } from '../db';
import * as convStore from '../store/conversations';
import type { Message } from '../store/conversations';
import {
  callClaudeJSON,
  callClaudeText,
  DEFAULT_MODEL,
  HAIKU_MODEL,
} from './claude';
import { gradeAnswer as gradeQuizAnswer, summarizeQuizPerformance } from './quiz';

const SYNOPSIS_THRESHOLD = 20;
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

  const apiMessages = params.recentMessages.map((m) => ({
    role:    m.role as 'user' | 'assistant',
    content: m.content,
  }));
  apiMessages.push({ role: 'user', content: params.userMessage });

  return callClaudeText({
    model:     DEFAULT_MODEL(),
    maxTokens: 1024,
    system:    systemPrompt,
    messages:  apiMessages,
    usage:     {
      operation:      'chat',
      userId:         params.conv.userId,
      conversationId: params.conv.id,
    },
  });
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

  const { content } = await callClaudeText({
    model:     HAIKU_MODEL,
    maxTokens: 300,
    usage:     { operation: 'ghost_collection', userId: params.userId },
    messages:  [{
      role:    'user',
      content: `The user has archived a collection titled "${params.title}". Write a 2-4 sentence ghost summary capturing the key topics and concepts they studied. This will be used as silent background context in future AI conversations. Third person, factual, no fluff.\n\nNuggets:\n${nuggetText}`,
    }],
  });

  return content || `The user previously studied "${params.title}".`;
}

export async function generateConversationGhost(params: {
  title:          string | null;
  synopsis:       string | null;
  messages:       Message[];
  userId?:        string;
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

  const { content } = await callClaudeText({
    model:     HAIKU_MODEL,
    maxTokens: 200,
    usage:     { operation: 'ghost_conversation', userId: params.userId },
    messages:  [{
      role:    'user',
      content: `The user has archived ${label}. Write a 1-3 sentence ghost summary of what was discussed. This will be silent background context in future AI conversations. Third person, factual.\n\n${contextParts.join('\n\n')}`,
    }],
  });

  return content || `The user previously had ${label}.`;
}

// MARK: - Map detection

const MAP_KEYWORDS = /\b(where is|where('s| is) (the|a)\b|map of|located in|location of|find .{1,40} on a map|directions? to|navigate to|show me .{1,30} on (a )?map)\b/i;

const MapSchema = z.discriminatedUnion('isMap', [
  z.object({
    isMap:     z.literal(true),
    placeName: z.string().min(1),
    query:     z.string().min(1),
  }),
  z.object({ isMap: z.literal(false) }),
]);

export async function detectMapPayload(
  userMessage: string,
  aiResponse:  string,
  usage?: { userId?: string; conversationId?: string },
): Promise<convStore.MapPayload | null> {
  if (!MAP_KEYWORDS.test(userMessage) && !MAP_KEYWORDS.test(aiResponse)) return null;

  const { data } = await callClaudeJSON({
    schema:    MapSchema,
    fallback:  { isMap: false as const },
    model:     HAIKU_MODEL,
    maxTokens: 128,
    usage:     {
      operation:      'detect_map',
      userId:         usage?.userId,
      conversationId: usage?.conversationId,
    },
    messages: [{
      role:    'user',
      content: `Does this exchange ask where a place is or request a map?

User: ${userMessage}
Assistant: ${aiResponse}

If yes: {"isMap":true,"placeName":"<name>","query":"<maps search query>"}
If no: {"isMap":false}
Return ONLY valid JSON.`,
    }],
  });

  if (data.isMap) {
    return { type: 'map', placeName: data.placeName, query: data.query };
  }
  return null;
}

// MARK: - Quiz generation

const ConvQuizQuestionsSchema = z.array(z.object({
  question:       z.string().min(1),
  expectedAnswer: z.string().min(1),
  nuggetId:       z.string().nullable().optional().default(null),
}));

export async function generateQuizQuestions(params: {
  collectionIds:    string[];
  userId:           string;
  count:            number;
  purpose?:         string | null;
  convSynopsis?:    string | null;
  recentMessages?:  convStore.Message[];
  conversationId?:  string;
}): Promise<convStore.QuizQuestion[]> {
  const clampedCount = Math.min(params.count, MAX_QUIZ_QUESTIONS);

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

  const contextBlock = parts.length
    ? `Use the following context to generate questions:\n\n${parts.join('\n\n')}`
    : `Generate general knowledge quiz questions on any interesting topic.`;

  const purposeLine = params.purpose
    ? `\nFocus area: ${params.purpose}\nPrioritize questions relevant to this focus.\n`
    : '';

  const { data } = await callClaudeJSON({
    schema:    ConvQuizQuestionsSchema,
    fallback:  [],
    model:     DEFAULT_MODEL(),
    maxTokens: 2048,
    usage:     {
      operation:      'conv_quiz_generate',
      userId:         params.userId,
      conversationId: params.conversationId,
    },
    messages: [{
      role:    'user',
      content: `Generate exactly ${clampedCount} quiz questions. Return ONLY valid JSON, no markdown.
${purposeLine}
${contextBlock}

Return a JSON array:
[{"question":"...","expectedAnswer":"...","nuggetId":"<nugget_id or null>"}]

Rules: distinct concepts, clear questions, concise answers (under 200 chars), vary question types. Only set nuggetId when the question comes directly from a nugget with an ID.`,
    }],
  });

  return data.slice(0, clampedCount).map((q) => ({
    question:       q.question,
    expectedAnswer: q.expectedAnswer,
    nuggetId:       q.nuggetId ?? null,
    userAnswer:     null,
    isCorrect:      null,
    feedback:       null,
  }));
}

// MARK: - Grade a single answer (delegates to the shared quiz grader)

export async function gradeAnswer(params: {
  question:       string;
  expectedAnswer: string;
  userAnswer:     string;
  userId?:        string;
  conversationId?: string;
}): Promise<{ isCorrect: boolean; feedback: string }> {
  return gradeQuizAnswer(params);
}

// MARK: - Quiz completion summary

export async function generateQuizSummary(
  questions: convStore.QuizQuestion[],
  usage?: { userId?: string; conversationId?: string },
): Promise<{
  summary:        string;
  score:          number;
  weakNuggetIds:  string[];
}> {
  const score = questions.filter((q) => q.isCorrect).length;
  const total = questions.length;

  const summary = await summarizeQuizPerformance({
    questions,
    score,
    maxScore:       total,
    userId:         usage?.userId,
    conversationId: usage?.conversationId,
  });

  const weakNuggetIds = questions
    .filter((q) => !q.isCorrect && q.nuggetId)
    .map((q) => q.nuggetId as string);

  return { summary, score, weakNuggetIds };
}

// MARK: - Create review cards from weak nuggets

const FlashcardSchema = z.object({
  front: z.string().min(1).max(500),
  back:  z.string().min(1).max(500),
});

export async function createCardsFromNuggets(params: {
  nuggetIds: string[];
  userId:    string;
}): Promise<number> {
  if (!params.nuggetIds.length) return 0;

  const { rows } = await pool.query(
    `SELECT id, content FROM nuggets WHERE id = ANY($1::uuid[]) AND user_id = $2`,
    [params.nuggetIds, params.userId],
  );

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
        const { data: card } = await callClaudeJSON({
          schema:    FlashcardSchema,
          fallback:  { front: '', back: '' },
          model:     HAIKU_MODEL,
          maxTokens: 256,
          usage:     { operation: 'create_flashcard', userId: params.userId },
          messages:  [{
            role:    'user',
            content: `Create one flashcard from this nugget. Return ONLY valid JSON: {"front":"...","back":"..."}

Nugget: ${nugget.content}`,
          }],
        });
        if (!card.front || !card.back) throw new Error('empty flashcard');
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
  if (conv.messageCount > 2) return;

  const { content } = await callClaudeText({
    model:     HAIKU_MODEL,
    maxTokens: 24,
    usage:     { operation: 'auto_title', userId, conversationId },
    messages:  [{
      role:    'user',
      content: `Write a 3-6 word title for this conversation exchange. Return only the title, no punctuation, no quotes.

User: ${firstUserMessage.slice(0, 300)}
Assistant: ${firstAiReply.slice(0, 300)}`,
    }],
  });

  const title = content.trim().replace(/^["']|["']$/g, '') || null;
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

  const { content: synopsis } = await callClaudeText({
    model:     HAIKU_MODEL,
    maxTokens: 512,
    usage:     { operation: 'synopsize', userId, conversationId },
    messages:  [{
      role:    'user',
      content: `${existing}Summarize this conversation excerpt in 3-6 sentences. Third person. Capture topics, insights reached, unresolved questions.\n\n${transcript}`,
    }],
  });
  if (!synopsis) return;

  await convStore.updateConversation(conversationId, userId, { synopsis });

  const ids = toCompress.map((m) => m.id);
  if (ids.length) {
    await pool.query(`DELETE FROM messages WHERE id = ANY($1::uuid[])`, [ids]);
  }
}
