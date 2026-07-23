import { Router } from 'express';
import multer from 'multer';
import * as sessionStore from '../store/sessions';
import * as captureStore from '../store/captures';
import * as nuggetStore from '../store/nuggets';
import { processCapture } from '../services/processingPipeline';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const sessionsRouter = Router();

// Files are held in memory until the request completes — keep the limit tight.
// Move to disk/object-storage streaming if uploads grow beyond ~10MB regularly.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

sessionsRouter.get('/:id/status', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const session = await sessionStore.getSessionStatus(id, res.locals.userId!);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');
  res.json({ session });
}));

sessionsRouter.post('/:id/captures', upload.single('file'), asyncHandler(async (req, res) => {
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

  const capture = await captureStore.createCapture({
    sessionId:     id,
    userId:        res.locals.userId!,
    kind,
    sequenceIndex: parseInt(sequenceIndex, 10),
    ocrText,
    transcript,
  });

  res.status(201).json({ capture });

  // Fire and forget — process in background, don't block the response
  setImmediate(() => {
    processCapture(capture.id).catch((err: unknown) =>
      console.error({ event: 'process_capture_failed', captureId: capture.id, sessionId: id, err: String(err) }),
    );
  });
}));

sessionsRouter.get('/:id/artifacts', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const session = await sessionStore.getSessionStatus(id, res.locals.userId!);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');
  const artifacts = await nuggetStore.getArtifactsForSession(id, res.locals.userId!);
  res.json({ artifacts });
}));
