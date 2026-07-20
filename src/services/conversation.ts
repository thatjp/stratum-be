import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db';
import * as convStore from '../store/conversations';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYNOPSIS_THRESHOLD = 20; // compress after this many messages
const CONTEXT_WINDOW     = 10; // keep this many recent messages after compression

const MODE_INSTRUCTIONS: Record<string, string> = {
  socratic: `Use the Socratic method. Respond primarily with probing questions that guide the user to discover insights themselves.
             Only give direct answers when the user is truly stuck. Push back gently on vague or incomplete answers.`,
  discussion: `Engage as a thoughtful discussion partner. Share your own analysis and connections, not just information.
               Build on what the user says. It's fine to disagree and explain why.`,
  explain: `Act as a clear, patient teacher. Break complex ideas down step by step. Use analogies.
            Check for understanding. Adjust depth based on the user's apparent level.`,
  quiz: `Generate quiz questions based on the collection content. After the user answers, evaluate their response and give feedback.
         Track which concepts the user struggles with and revisit them.`,
};

export interface ChatContext {
  collectionId?: string | null;
  scope: string;
  mode: string;
  synopsis?: string | null;
}

export async function buildSystemPrompt(ctx: ChatContext): Promise<string> {
  let collectionContext = '';

  if (ctx.collectionId) {
    const { rows } = await pool.query(
      `SELECT c.title, c.intent,
              (SELECT COUNT(*) FROM nuggets n WHERE n.collection_id = c.id) AS nugget_count
       FROM collections c WHERE c.id = $1`,
      [ctx.collectionId],
    );
    if (rows[0]) {
      const col = rows[0];
      collectionContext = `\nCollection: "${col.title as string}" (intent: ${col.intent as string}, ${col.nugget_count as string} nuggets captured)`;
    }
  }

  const modeGuide = MODE_INSTRUCTIONS[ctx.mode] ?? MODE_INSTRUCTIONS.discussion;
  const scopeNote = ctx.scope === 'global'
    ? 'You are having a general learning conversation with this user.'
    : ctx.scope === 'collection'
      ? `You are focused on discussing the collection above.${collectionContext}`
      : `You are focused on a specific concept from this collection.${collectionContext}`;

  const synopsisSection = ctx.synopsis
    ? `\n\nConversation history (synopsis):\n${ctx.synopsis}\n\nThe messages below are the most recent part of the conversation.`
    : '';

  return `You are Stratum, an intelligent study companion. You help users deepen their understanding of what they read and capture.

${scopeNote}

Conversation mode: ${modeGuide}${synopsisSection}

Keep responses concise and conversational — this is a mobile chat interface. Aim for 2-4 short paragraphs maximum.`;
}

export async function chat(params: {
  conversationId: string;
  userId: string;
  userMessage: string;
  ctx: ChatContext;
  recentMessages: convStore.Message[];
}): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const systemPrompt = await buildSystemPrompt(params.ctx);

  const apiMessages: Anthropic.MessageParam[] = params.recentMessages.map((m) => ({
    role:    m.role as 'user' | 'assistant',
    content: m.content,
  }));
  apiMessages.push({ role: 'user', content: params.userMessage });

  const response = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   apiMessages,
  });

  const content = response.content[0].type === 'text' ? response.content[0].text : '';
  return {
    content,
    inputTokens:  response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export async function maybeSynopsize(
  conversationId: string,
  userId: string,
  conv: convStore.Conversation,
): Promise<void> {
  if (conv.messageCount < SYNOPSIS_THRESHOLD) return;

  // Load all messages
  const allMessages = await convStore.getMessages(conversationId, userId);
  if (allMessages.length < SYNOPSIS_THRESHOLD) return;

  // Messages to compress = everything except the last CONTEXT_WINDOW
  const toCompress = allMessages.slice(0, allMessages.length - CONTEXT_WINDOW);
  if (toCompress.length === 0) return;

  const transcriptForSynopsis = toCompress
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const existingSynopsis = conv.synopsis
    ? `Previous synopsis:\n${conv.synopsis}\n\nNew messages to incorporate:\n`
    : '';

  const response = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 512,
    messages:   [
      {
        role:    'user',
        content: `${existingSynopsis}Summarize the following conversation excerpt into a concise synopsis (3-6 sentences).
Capture the main topics discussed, key insights the user arrived at, and any unresolved questions.
Write in third person (e.g., "The user asked about...", "They discussed...").

${transcriptForSynopsis}`,
      },
    ],
  });

  const synopsis = response.content[0].type === 'text' ? response.content[0].text : '';
  await convStore.updateConversation(conversationId, userId, { synopsis });

  // Delete compressed messages to keep the DB lean
  const compressedIds = toCompress.map((m) => m.id);
  if (compressedIds.length > 0) {
    await pool.query(
      `DELETE FROM messages WHERE id = ANY($1::uuid[])`,
      [compressedIds],
    );
  }
}
