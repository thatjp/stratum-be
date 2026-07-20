import { Router } from 'express';
import * as nuggetStore from '../store/nuggets';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const artifactsRouter = Router();

artifactsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id     = String(req.params.id);
  const status = String(req.body.status ?? '');

  if (!['accepted', 'dismissed'].includes(status)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'status must be accepted or dismissed');
  }

  const artifact = await nuggetStore.updateArtifactStatus(id, res.locals.userId!, status);
  if (!artifact) return sendError(res, 404, 'NOT_FOUND', 'Artifact not found');
  res.json({ artifact });
}));
