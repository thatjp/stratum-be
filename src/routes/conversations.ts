import { Router } from 'express';
import * as convStore from '../store/conversations';
import * as convService from '../services/conversation';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const conversationsRouter = Router();

const VALID_SCOPES = ['global', 'collection', 'nugget'] as const;
const VALID_MODES  = ['socratic', 'discussion', 'explain', 'quiz'] as const;

// List conversations
conversationsRouter.get('/', asyncHandler(async (req, res) => {
  const conversations = await convStore.listConversations(res.locals.userId!);
  res.json({ conversations });
}));

// Create conversation
conversationsRouter.post('/', asyncHandler(async (req, res) => {
  const scope        = String(req.body.scope ?? 'global');
  const mode         = String(req.body.mode ?? 'discussion');
  const collectionId = req.body.collectionId ? String(req.body.collectionId) : null;
  const title        = req.body.title ? String(req.body.title) : null;

  if (!VALID_SCOPES.includes(scope as typeof VALID_SCOPES[number])) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid scope');
  }
  if (!VALID_MODES.includes(mode as typeof VALID_MODES[number])) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid mode');
  }

  const conversation = await convStore.createConversation({
    userId: res.locals.userId!,
    collectionId,
    scope: scope as convStore.Conversation['scope'],
    mode:  mode as convStore.Conversation['mode'],
    title,
  });
  res.status(201).json({ conversation });
}));

// Get conversation + messages
conversationsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const conversation = await convStore.getConversation(id, res.locals.userId!);
  if (!conversation) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');

  const messages = await convStore.getMessages(id, res.locals.userId!);
  res.json({ conversation, messages });
}));

// Update conversation metadata (title, mode, scope, collectionId)
conversationsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id     = String(req.params.id);
  const fields: Parameters<typeof convStore.updateConversation>[2] = {};

  if (req.body.title        !== undefined) fields.title        = String(req.body.title);
  if (req.body.mode         !== undefined) {
    const mode = String(req.body.mode);
    if (!VALID_MODES.includes(mode as typeof VALID_MODES[number])) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid mode');
    }
    fields.mode = mode as convStore.Conversation['mode'];
  }
  if (req.body.scope        !== undefined) {
    const scope = String(req.body.scope);
    if (!VALID_SCOPES.includes(scope as typeof VALID_SCOPES[number])) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid scope');
    }
    fields.scope = scope as convStore.Conversation['scope'];
  }
  if (req.body.collectionId !== undefined) {
    fields.collectionId = req.body.collectionId ? String(req.body.collectionId) : null;
  }

  const conversation = await convStore.updateConversation(id, res.locals.userId!, fields);
  if (!conversation) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');
  res.json({ conversation });
}));

// Delete conversation
conversationsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const deleted = await convStore.deleteConversation(id, res.locals.userId!);
  if (!deleted) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');
  res.status(204).send();
}));

// Send a message and get AI reply
conversationsRouter.post('/:id/messages', asyncHandler(async (req, res) => {
  const id      = String(req.params.id);
  const content = String(req.body.content ?? '').trim();

  if (!content) return sendError(res, 400, 'VALIDATION_ERROR', 'Message content is required');
  if (content.length > 4000) return sendError(res, 400, 'VALIDATION_ERROR', 'Message too long');

  const conversation = await convStore.getConversation(id, res.locals.userId!);
  if (!conversation) return sendError(res, 404, 'NOT_FOUND', 'Conversation not found');

  // Persist user message
  const userMsg = await convStore.addMessage({
    conversationId: id,
    role:    'user',
    content,
  });

  // Load recent messages for context (last 10 before the one we just added)
  const allMessages = await convStore.getMessages(id, res.locals.userId!);
  const historyForAPI = allMessages
    .filter((m) => m.id !== userMsg.id)
    .slice(-10);

  // Call AI
  const ctx: convService.ChatContext = {
    collectionId: conversation.collectionId,
    scope:        conversation.scope,
    mode:         conversation.mode,
    synopsis:     conversation.synopsis,
  };

  const aiResponse = await convService.chat({
    conversationId: id,
    userId:         res.locals.userId!,
    userMessage:    content,
    ctx,
    recentMessages: historyForAPI,
  });

  // Persist assistant message
  const assistantMsg = await convStore.addMessage({
    conversationId: id,
    role:        'assistant',
    content:     aiResponse.content,
    tokenCount:  aiResponse.outputTokens,
  });

  // Fire-and-forget synopsis compression
  const updatedConv = await convStore.getConversation(id, res.locals.userId!);
  if (updatedConv) {
    convService.maybeSynopsize(id, res.locals.userId!, updatedConv).catch((e) => {
      console.error('Synopsis compression failed:', e);
    });
  }

  res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
}));
