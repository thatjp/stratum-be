import { Router } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import * as convStore from '../store/conversations';
import * as convService from '../services/conversation';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const conversationsRouter = Router();

const VALID_SCOPES = ['global', 'collection', 'nugget'] as const;

// List (cursor-paginated by updated_at)
conversationsRouter.get('/', asyncHandler(async (req, res) => {
  const limit  = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  const before = req.query.before ? String(req.query.before) : undefined;
  const result = await convStore.listConversations(res.locals.userId!, limit, before);
  res.json(result);
}));

// Create
conversationsRouter.post('/', asyncHandler(async (req, res) => {
  const scope        = String(req.body.scope ?? 'global');
  const collectionId = req.body.collectionId ? String(req.body.collectionId) : null;
  const title        = req.body.title ? String(req.body.title) : null;

  if (!VALID_SCOPES.includes(scope as typeof VALID_SCOPES[number])) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid scope');
  }

  if (collectionId) {
    const { rows } = await pool.query(
      `SELECT id FROM collections WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
      [collectionId, res.locals.userId!],
    );
    if (!rows.length) return sendError(res, 404, 'NOT_FOUND', 'Collection not found');
  }

  const conversation = await convStore.createConversation({
    userId: res.locals.userId!,
    collectionId,
    scope:  scope as convStore.Conversation['scope'],
    title,
  });
  res.status(201).json({ conversation });
}));

// Get conversation + messages (cursor-paginated by created_at)
conversationsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id     = String(req.params.id);
  const limit  = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 200);
  const before = req.query.before ? String(req.query.before) : undefined;

  const conversation = await convStore.getConversation(id, res.locals.userId!);
  if (!conversation) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');

  const { messages, hasMore } = await convStore.getMessages(id, res.locals.userId!, limit, before);
  res.json({ conversation, messages, hasMore });
}));

// Update metadata (title, scope, collectionId, socraticEnabled)
conversationsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id     = String(req.params.id);
  const fields: Parameters<typeof convStore.updateConversation>[2] = {};

  if (req.body.title !== undefined) {
    fields.title      = String(req.body.title);
    fields.userTitled = true;
  }
  const socraticRaw = req.body.socraticEnabled ?? req.body.socratic_enabled;
  if (socraticRaw !== undefined) fields.socraticEnabled = Boolean(socraticRaw);
  if (req.body.scope           !== undefined) {
    const scope = String(req.body.scope);
    if (!VALID_SCOPES.includes(scope as typeof VALID_SCOPES[number])) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid scope');
    }
    fields.scope = scope as convStore.Conversation['scope'];
  }
  const collectionIdRaw = req.body.collectionId ?? req.body.collection_id;
  if (collectionIdRaw !== undefined) {
    fields.collectionId = collectionIdRaw ? String(collectionIdRaw) : null;
  }

  const conversation = await convStore.updateConversation(id, res.locals.userId!, fields);
  if (!conversation) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');
  res.json({ conversation });
}));

// Archive (soft delete) or hard delete a conversation
conversationsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id     = String(req.params.id);
  const hard   = req.query.hard === 'true';
  const userId = res.locals.userId!;

  const conversation = await convStore.getConversation(id, userId);
  if (!conversation) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');

  if (hard) {
    const deleted = await convStore.hardDeleteConversation(id, userId);
    if (!deleted) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');
    return res.status(204).send();
  }

  const { messages } = await convStore.getMessages(id, userId);
  const ghost = await convService.generateConversationGhost({
    title:    conversation.title,
    synopsis: conversation.synopsis,
    messages,
    userId,
  });
  const archived = await convStore.archiveConversation(id, userId, ghost);
  if (!archived) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');
  convService.invalidateGhostCache(userId);
  res.status(204).send();
}));

// Send message
conversationsRouter.post('/:id/messages', asyncHandler(async (req, res) => {
  const id      = String(req.params.id);
  const content = String(req.body.content ?? '').trim();

  if (!content) return sendError(res, 400, 'VALIDATION_ERROR', 'Message content is required');
  if (content.length > 4000) return sendError(res, 400, 'VALIDATION_ERROR', 'Message too long');

  const conversation = await convStore.getConversation(id, res.locals.userId!);
  if (!conversation) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');

  // If a quiz is active, route to quiz answer handler instead
  if (conversation.quizState?.active) {
    return handleQuizAnswer(req, res, conversation, content);
  }

  const userMsg = await convStore.addMessage({ conversationId: id, role: 'user', content });

  const { messages: allMessages } = await convStore.getMessages(id, res.locals.userId!, 11);
  const historyForAPI = allMessages.filter((m) => m.id !== userMsg.id).slice(-10);

  const aiResponse = await convService.chat({
    conv:           conversation,
    userMessage:    content,
    recentMessages: historyForAPI,
  });

  const mapPayload = await convService.detectMapPayload(content, aiResponse.content, {
    userId:         res.locals.userId!,
    conversationId: id,
  });

  const assistantMsg = await convStore.addMessage({
    conversationId: id,
    role:           'assistant',
    content:        aiResponse.content,
    tokenCount:     aiResponse.outputTokens,
    metadata:       mapPayload,
  });

  // Pass a locally-incremented count so fire-and-forget tasks don't need a DB round-trip.
  // (+2: user message + assistant message both inserted above)
  const convForTasks = { ...conversation, messageCount: conversation.messageCount + 2 };
  convService.maybeSynopsize(id, res.locals.userId!, convForTasks).catch((err: unknown) =>
    logger.error({ event: 'synopsize_failed', conversationId: id, err: String(err) }),
  );
  convService.maybeAutoTitle(id, res.locals.userId!, convForTasks, content, aiResponse.content).catch((err: unknown) =>
    logger.error({ event: 'auto_title_failed', conversationId: id, err: String(err) }),
  );

  res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
}));

// Start a quiz in this conversation
conversationsRouter.post('/:id/quiz/start', asyncHandler(async (req, res) => {
  const id            = String(req.params.id);
  const count         = Math.min(Math.max(Number(req.body.count ?? 5), 1), 25);
  const collectionIds = Array.isArray(req.body.collectionIds)
    ? (req.body.collectionIds as unknown[]).map(String)
    : req.body.collectionId ? [String(req.body.collectionId)] : [];
  const purpose       = req.body.purpose ? String(req.body.purpose).trim().slice(0, 500) : null;

  const conversation = await convStore.getConversation(id, res.locals.userId!);
  if (!conversation) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');
  if (conversation.quizState?.active) return sendError(res, 409, 'QUIZ_ACTIVE', 'A quiz is already in progress');

  const { messages: recentMessages } = await convStore.getMessages(id, res.locals.userId!, 10);

  const questions = await convService.generateQuizQuestions({
    collectionIds:   collectionIds.length ? collectionIds : (conversation.collectionId ? [conversation.collectionId] : []),
    userId:          res.locals.userId!,
    count,
    purpose:         purpose ?? null,
    convSynopsis:    conversation.synopsis ?? null,
    recentMessages:  recentMessages.slice(-10),
    conversationId:  id,
  });

  if (!questions.length) {
    return sendError(res, 422, 'GENERATION_FAILED', 'Failed to generate quiz questions. Please try again.');
  }

  const quizState: convStore.QuizState = {
    active:       true,
    questions,
    currentIndex: 0,
    collectionId: collectionIds[0] ?? conversation.collectionId,
    maxQuestions: questions.length,
  };

  await convStore.updateConversation(id, res.locals.userId!, { quizState });

  const firstQ      = questions[0];
  const purposeLine = purpose ? `\nFocus: ${purpose}\n` : '';
  const intro       = `Let's start your quiz — ${questions.length} question${questions.length === 1 ? '' : 's'}.${purposeLine}\n\n**Question 1 of ${questions.length}**\n\n${firstQ.question}`;
  const assistantMsg = await convStore.addMessage({ conversationId: id, role: 'assistant', content: intro });

  const updatedConv = await convStore.getConversation(id, res.locals.userId!);
  res.json({ assistantMessage: assistantMsg, conversation: updatedConv, questionCount: questions.length });
}));

// Create review cards from the last quiz's weak spots
conversationsRouter.post('/:id/quiz/create-cards', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const conversation = await convStore.getConversation(id, res.locals.userId!);
  if (!conversation) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawIds  = Array.isArray(req.body.nuggetIds) ? req.body.nuggetIds : [];
  const weakNuggetIds: string[] = rawIds.map(String).filter((s: string) => UUID_RE.test(s));
  if (!weakNuggetIds.length) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'No valid nugget IDs provided');
  }

  const created = await convService.createCardsFromNuggets({
    nuggetIds: weakNuggetIds,
    userId:    res.locals.userId!,
  });

  const msg = created === 0
    ? `Cards already exist for those concepts — check your Expedition queue.`
    : `Done! I've added ${created} new card${created === 1 ? '' : 's'} to your Expedition queue. They're ready to review.`;

  const assistantMsg = await convStore.addMessage({ conversationId: id, role: 'assistant', content: msg });
  res.json({ assistantMessage: assistantMsg, created });
}));

// Internal: handle quiz answer within a message POST
async function handleQuizAnswer(
  req: Parameters<Parameters<typeof conversationsRouter.post>[1]>[0],
  res: Parameters<Parameters<typeof conversationsRouter.post>[1]>[1],
  conversation: convStore.Conversation,
  userAnswer: string,
): Promise<void> {
  const id        = conversation.id;
  const quizState = conversation.quizState!;
  const current   = quizState.questions[quizState.currentIndex];

  // Persist user answer as message
  const userMsg = await convStore.addMessage({ conversationId: id, role: 'user', content: userAnswer });

  // Grade the answer
  const { isCorrect, feedback } = await convService.gradeAnswer({
    question:       current.question,
    expectedAnswer: current.expectedAnswer,
    userAnswer,
    userId:         conversation.userId,
    conversationId: id,
  });

  // Build the new state from the read snapshot — do not mutate the original object
  const expectedIndex = quizState.currentIndex;
  const updatedQuestions = quizState.questions.map((q, i) =>
    i === expectedIndex ? { ...q, userAnswer, isCorrect, feedback } : q,
  );
  const nextIndex = expectedIndex + 1;
  const isLastQ   = nextIndex >= quizState.questions.length;

  let assistantContent: string;
  let newQuizState: convStore.QuizState;

  if (isLastQ) {
    newQuizState = { ...quizState, questions: updatedQuestions, active: false, currentIndex: nextIndex };

    const { summary, score, weakNuggetIds } = await convService.generateQuizSummary(updatedQuestions, {
      userId:         conversation.userId,
      conversationId: id,
    });
    const total = updatedQuestions.length;

    assistantContent = `${isCorrect ? '✓ Correct.' : '✗ Not quite.'} ${feedback}\n\n---\n\n**Quiz complete! You scored ${score}/${total}.**\n\n${summary}`;

    if (weakNuggetIds.length) {
      assistantContent += `\n\nWould you like me to create flashcards for the ${weakNuggetIds.length} concept${weakNuggetIds.length === 1 ? '' : 's'} you missed? Tap **Create cards** to add them to your Expedition queue.`;
    }
  } else {
    newQuizState = { ...quizState, questions: updatedQuestions, currentIndex: nextIndex };
    const next = updatedQuestions[nextIndex];
    assistantContent = `${isCorrect ? '✓ Correct.' : '✗ Not quite.'} ${feedback}\n\n**Question ${nextIndex + 1} of ${updatedQuestions.length}**\n\n${next.question}`;
  }

  // Atomic write — only succeeds if no other answer was processed concurrently
  const savedConv = await convStore.updateQuizState(id, conversation.userId, expectedIndex, newQuizState);
  if (!savedConv) {
    sendError(res, 409, 'CONFLICT', 'Quiz state changed concurrently — please retry');
    return;
  }

  const assistantMsg = await convStore.addMessage({ conversationId: id, role: 'assistant', content: assistantContent });

  const weakNuggetIds = isLastQ
    ? newQuizState.questions.filter((q) => !q.isCorrect && q.nuggetId).map((q) => q.nuggetId as string)
    : [];

  res.json({
    userMessage:      userMsg,
    assistantMessage: assistantMsg,
    quizComplete:     isLastQ,
    weakNuggetIds,
    conversation:     savedConv,
  });
}
