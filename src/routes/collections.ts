import { Router } from 'express';
import * as store from '../store/collections';
import * as sessionStore from '../store/sessions';
import * as reviewStore from '../store/review';
import * as convService from '../services/conversation';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const collectionsRouter = Router();

const VALID_INTENTS      = ['study', 'work', 'pleasure'];
const VALID_SOURCE_TYPES = ['book', 'article', 'course', 'video', 'other'];

function parseGoalTargetAt(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const s = String(raw);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

collectionsRouter.get('/', asyncHandler(async (_req, res) => {
  const collections = await store.getCollections(res.locals.userId!);
  res.json({ collections });
}));

collectionsRouter.post('/', asyncHandler(async (req, res) => {
  const title:      string = String(req.body.title ?? '');
  const sourceType: string = String(req.body.sourceType ?? 'book');
  const intent:     string = String(req.body.intent ?? 'study');
  const language:   string | undefined = req.body.language ? String(req.body.language) : undefined;
  const goal:       string = String(req.body.goal ?? '').trim();
  const goalTargetAt = parseGoalTargetAt(req.body.goalTargetAt);

  if (!title.trim())                            return sendError(res, 400, 'VALIDATION_ERROR', 'title is required');
  if (!goal)                                    return sendError(res, 400, 'VALIDATION_ERROR', 'goal is required');
  if (goalTargetAt === undefined && req.body.goalTargetAt != null && req.body.goalTargetAt !== '') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'invalid goalTargetAt');
  }
  if (!VALID_INTENTS.includes(intent))          return sendError(res, 400, 'VALIDATION_ERROR', 'invalid intent');
  if (!VALID_SOURCE_TYPES.includes(sourceType)) return sendError(res, 400, 'VALIDATION_ERROR', 'invalid sourceType');

  // Pleasure can omit a date; study/work should have one when possible — soft nudge only in clients.
  const collection = await store.createCollection(res.locals.userId!, {
    title,
    sourceType,
    intent,
    language,
    goal,
    goalTargetAt: goalTargetAt ?? null,
  });
  res.status(201).json({ collection });
}));

collectionsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const collection = await store.getCollectionById(id, res.locals.userId!);
  if (!collection) return sendError(res, 404, 'NOT_FOUND', 'Collection not found');
  res.json({ collection });
}));

collectionsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);

  if (req.body.intent !== undefined && !VALID_INTENTS.includes(String(req.body.intent))) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'invalid intent');
  }
  if (req.body.sourceType !== undefined && !VALID_SOURCE_TYPES.includes(String(req.body.sourceType))) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'invalid sourceType');
  }

  const goalTargetAt = parseGoalTargetAt(req.body.goalTargetAt);
  if (goalTargetAt === undefined && req.body.goalTargetAt != null && req.body.goalTargetAt !== '') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'invalid goalTargetAt');
  }

  try {
    const collection = await store.updateCollection(id, res.locals.userId!, {
      title:        req.body.title !== undefined ? String(req.body.title) : undefined,
      intent:       req.body.intent !== undefined ? String(req.body.intent) : undefined,
      sourceType:   req.body.sourceType !== undefined ? String(req.body.sourceType) : undefined,
      language:     req.body.language !== undefined
        ? (req.body.language ? String(req.body.language) : null)
        : undefined,
      goal:         req.body.goal !== undefined ? String(req.body.goal) : undefined,
      goalTargetAt: req.body.goalTargetAt !== undefined ? (goalTargetAt ?? null) : undefined,
    });
    if (!collection) return sendError(res, 404, 'NOT_FOUND', 'Collection not found');
    res.json({ collection });
  } catch (err: unknown) {
    if (err instanceof Error && (err.message === 'title is required' || err.message === 'goal is required')) {
      return sendError(res, 400, 'VALIDATION_ERROR', err.message);
    }
    throw err;
  }
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
