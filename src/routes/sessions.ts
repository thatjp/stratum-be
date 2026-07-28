import { Router } from 'express';
import multer from 'multer';
import * as sessionStore from '../store/sessions';
import * as captureStore from '../store/captures';
import * as nuggetStore from '../store/nuggets';
import { withTransaction } from '../db';
import { enqueueCapture } from '../queue';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const sessionsRouter = Router();

// Captures arrive as text the client has already extracted (ocrText / transcript)
// and req.file is never read, so buffering the upload was pure overhead. multer
// stays only to parse the multipart *fields*; the filter drains any file part
// without storing it. Reinstate storage here if we start persisting the original
// image or audio, and stream it to object storage rather than into memory.
const upload = multer({
  fileFilter: (_req, _file, cb) => cb(null, false),
  limits: { fields: 20, fieldSize: 1024 * 1024 },
});

sessionsRouter.get('/:id/status', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const session = await sessionStore.getSessionStatus(id, res.locals.userId!);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');
  res.json({ session });
}));

sessionsRouter.post('/:id/captures', upload.any(), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const session = await sessionStore.getSessionStatus(id, res.locals.userId!);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');

  const kind          = String(req.body.kind ?? '');
  const sequenceIndex = String(req.body.sequenceIndex ?? '0');
  const ocrText       = req.body.ocrText ? String(req.body.ocrText) : undefined;
  const transcript    = req.body.transcript ? String(req.body.transcript) : undefined;

  if (!['photo', 'narration'].includes(kind)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'kind must be photo or narration');
  }

  // Row and job commit together, so a capture can't be created without work
  // queued for it, and a failed enqueue doesn't leave an orphan row behind.
  const capture = await withTransaction(async (client) => {
    const created = await captureStore.createCapture({
      sessionId:     id,
      userId:        res.locals.userId!,
      kind,
      sequenceIndex: parseInt(sequenceIndex, 10),
      ocrText,
      transcript,
    }, client);

    await enqueueCapture(created.id, client);
    return created;
  });

  res.status(201).json({ capture });
}));

sessionsRouter.get('/:id/artifacts', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const session = await sessionStore.getSessionStatus(id, res.locals.userId!);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');
  const artifacts = await nuggetStore.getArtifactsForSession(id, res.locals.userId!);
  res.json({ artifacts });
}));
