import { Router } from 'express';
import * as reviewStore from '../store/review';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const reviewRouter = Router();

reviewRouter.get('/stats', asyncHandler(async (_req, res) => {
  const stats = await reviewStore.getUserStats(res.locals.userId!);
  res.json({ stats });
}));

reviewRouter.get('/due', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 50);
  const artifacts = await reviewStore.getDueArtifacts(res.locals.userId!, limit);
  res.json({ artifacts });
}));

reviewRouter.post('/recall-attempts', asyncHandler(async (req, res) => {
  const artifactId     = String(req.body.artifactId ?? '');
  const result         = String(req.body.result ?? '');
  const responseTimeMs = req.body.responseTimeMs ? Number(req.body.responseTimeMs) : undefined;

  if (!artifactId) return sendError(res, 400, 'VALIDATION_ERROR', 'artifactId is required');
  if (!['correct', 'incorrect', 'skipped'].includes(result)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'result must be correct, incorrect, or skipped');
  }

  try {
    const attempt = await reviewStore.recordRecallAttempt({
      artifactId,
      userId: res.locals.userId!,
      result: result as 'correct' | 'incorrect' | 'skipped',
      responseTimeMs,
    });
    res.status(201).json({ attempt });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Artifact not found') {
      return sendError(res, 404, 'NOT_FOUND', 'Artifact not found');
    }
    throw err;
  }
}));
