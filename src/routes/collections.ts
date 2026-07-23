import { Router } from 'express';
import * as store from '../store/collections';
import * as sessionStore from '../store/sessions';
import * as reviewStore from '../store/review';
import * as convService from '../services/conversation';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const collectionsRouter = Router();

const VALID_INTENTS     = ['study', 'work', 'pleasure'];
const VALID_SOURCE_TYPES = ['book', 'article', 'course', 'video', 'other'];

collectionsRouter.get('/', asyncHandler(async (_req, res) => {
  const collections = await store.getCollections(res.locals.userId!);
  res.json({ collections });
}));

collectionsRouter.post('/', asyncHandler(async (req, res) => {
  const title:      string = String(req.body.title ?? '');
  const sourceType: string = String(req.body.sourceType ?? 'book');
  const intent:     string = String(req.body.intent ?? 'study');
  const language:   string | undefined = req.body.language ? String(req.body.language) : undefined;

  if (!title.trim())                           return sendError(res, 400, 'VALIDATION_ERROR', 'title is required');
  if (!VALID_INTENTS.includes(intent))         return sendError(res, 400, 'VALIDATION_ERROR', 'invalid intent');
  if (!VALID_SOURCE_TYPES.includes(sourceType)) return sendError(res, 400, 'VALIDATION_ERROR', 'invalid sourceType');

  const collection = await store.createCollection(res.locals.userId!, { title, sourceType, intent, language });
  res.status(201).json({ collection });
}));

collectionsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const collection = await store.getCollectionById(id, res.locals.userId!);
  if (!collection) return sendError(res, 404, 'NOT_FOUND', 'Collection not found');
  res.json({ collection });
}));

collectionsRouter.post('/:id/sessions', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const collection = await store.getCollectionById(id, res.locals.userId!);
  if (!collection) return sendError(res, 404, 'NOT_FOUND', 'Collection not found');

  const inputMode = String(req.body.inputMode ?? '');
  const VALID_MODES = ['photo', 'narration', 'mixed'];
  if (!VALID_MODES.includes(inputMode)) return sendError(res, 400, 'VALIDATION_ERROR', 'invalid inputMode');

  const session = await sessionStore.createSession(id, res.locals.userId!, inputMode);
  res.status(201).json({ session });
}));

collectionsRouter.get('/:id/sessions', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const collection = await store.getCollectionById(id, res.locals.userId!);
  if (!collection) return sendError(res, 404, 'NOT_FOUND', 'Collection not found');
  const sessions = await reviewStore.getSessionsForCollection(id, res.locals.userId!);
  res.json({ sessions });
}));

// Archive (soft delete) or hard delete a collection
collectionsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id   = String(req.params.id);
  const hard = req.query.hard === 'true';
  const userId = res.locals.userId!;

  const collection = await store.getCollectionById(id, userId);
  if (!collection) return sendError(res, 404, 'NOT_FOUND', 'Collection not found');

  if (hard) {
    const deleted = await store.hardDeleteCollection(id, userId);
    if (!deleted) return sendError(res, 404, 'NOT_FOUND', 'Collection not found');
    return res.status(204).send();
  }

  // Generate ghost synopsis before archiving
  const ghost = await convService.generateCollectionGhost({
    title:        collection.title,
    userId,
    collectionId: id,
  });
  const archived = await store.archiveCollection(id, userId, ghost);
  if (!archived) return sendError(res, 404, 'NOT_FOUND', 'Collection not found');
  convService.invalidateGhostCache(userId);
  res.status(204).send();
}));
