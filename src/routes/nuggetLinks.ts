import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';
import * as nuggetLinksStore from '../store/nuggetLinks';

export const nuggetLinksRouter = Router();

async function userOwnsNugget(nuggetId: string, userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM nuggets WHERE id = $1 AND user_id = $2`,
    [nuggetId, userId],
  );
  return rows.length > 0;
}

// GET /nuggets/:id/links
nuggetLinksRouter.get('/:id/links', asyncHandler(async (req, res) => {
  const userId   = res.locals.userId!;
  const nuggetId = String(req.params.id);

  if (!(await userOwnsNugget(nuggetId, userId))) {
    return sendError(res, 404, 'NOT_FOUND', 'Nugget not found');
  }

  const links = await nuggetLinksStore.getLinksForNugget(nuggetId, userId);
  res.json({ links });
}));

// POST /nuggets/:id/links
// Body: { targetNuggetId, note?, source? }
nuggetLinksRouter.post('/:id/links', asyncHandler(async (req, res) => {
  const userId         = res.locals.userId!;
  // Lowercased so the self-link check below compares canonical forms — Postgres
  // treats 'AB…' and 'ab…' as the same UUID, and a mismatch here would slip
  // past this guard only to trip the nugget_links_no_self_link constraint.
  const nuggetId        = String(req.params.id).toLowerCase();
  const targetNuggetId  = String(req.body.targetNuggetId ?? '').toLowerCase();
  const note            = req.body.note ? String(req.body.note) : undefined;
  const source          = req.body.source === 'ai_suggested' ? 'ai_suggested' : 'manual';

  if (!targetNuggetId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'targetNuggetId is required');
  }
  if (targetNuggetId === nuggetId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Cannot link a nugget to itself');
  }
  const [ownsSource, ownsTarget] = await Promise.all([
    userOwnsNugget(nuggetId, userId),
    userOwnsNugget(targetNuggetId, userId),
  ]);
  if (!ownsSource || !ownsTarget) {
    return sendError(res, 404, 'NOT_FOUND', 'Nugget not found');
  }

  const created = await nuggetLinksStore.createNuggetLink({
    userId, nuggetId, targetNuggetId, note, source,
  });
  // Return the same joined shape GET .../links uses (link + the *other*
  // nugget's content), not the raw nugget_links row — the client only
  // ever decodes one NuggetLink shape regardless of which endpoint responded.
  const link = await nuggetLinksStore.getLinkedNoteView(created.id, nuggetId, userId);
  res.status(201).json({ link });
}));

// DELETE /nuggets/links/:linkId
nuggetLinksRouter.delete('/links/:linkId', asyncHandler(async (req, res) => {
  const userId = res.locals.userId!;
  const linkId = String(req.params.linkId);

  const deleted = await nuggetLinksStore.deleteNuggetLink(linkId, userId);
  if (!deleted) return sendError(res, 404, 'NOT_FOUND', 'Link not found');
  res.status(204).send();
}));
