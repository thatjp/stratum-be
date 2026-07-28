import 'dotenv/config';
import crypto from 'crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { pool } from './db';
import { requireAuth, requireRole } from './middleware/requireAuth';
import { sendError } from './middleware/sendError';
import { authRouter } from './routes/auth';
import { collectionsRouter } from './routes/collections';
import { sessionsRouter } from './routes/sessions';
import { artifactsRouter } from './routes/artifacts';
import { reviewRouter } from './routes/review';
import { conversationsRouter } from './routes/conversations';
import { quizRouter } from './routes/quiz';
import { graphRouter } from './routes/graph';
import { retentionGraphRouter } from './routes/retentionGraph';
import { nuggetLinksRouter } from './routes/nuggetLinks';
import { adminRouter } from './routes/admin';

const app = express();

// Trust the first proxy hop so req.ip resolves to the real client IP,
// which makes the rate limiters work correctly behind nginx / Railway / Render.
app.set('trust proxy', 1);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000'];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(helmet());

// Stamp every request with a unique ID for log correlation.
app.use((_req: Request, res: Response, next: NextFunction) => {
  const id = crypto.randomUUID();
  res.locals.requestId = id;
  res.setHeader('x-request-id', id);
  next();
});

// Default body limit is 100kb. Routes that receive large payloads
// (session processing, narration uploads) apply their own larger limit.
app.use(express.json({ limit: '100kb' }));

// Auth routes: tight limit regardless of IP trust
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Coarse per-IP backstop applied to everything under /api. Deliberately
// generous — its only job is to bound unauthenticated floods, since requests
// that fail requireAuth never reach the per-user limiter below.
const ipLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

// Authenticated API routes: key by userId so one account can't starve others.
// Must be mounted *after* requireAuth, otherwise res.locals.userId is always
// undefined and every user collapses into a single per-IP bucket.
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    (req.res?.locals.userId as string | undefined) ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

app.use('/api', ipLimiter);

app.use('/api/auth',            authLimiter, authRouter);
app.use('/api/collections',     requireAuth, apiLimiter, collectionsRouter);
app.use('/api/sessions',        requireAuth, apiLimiter, sessionsRouter);
app.use('/api/artifacts',       requireAuth, apiLimiter, artifactsRouter);
app.use('/api/review',          requireAuth, apiLimiter, reviewRouter);
app.use('/api/conversations',   requireAuth, apiLimiter, conversationsRouter);
app.use('/api/quiz',            requireAuth, apiLimiter, quizRouter);
app.use('/api/graph',           requireAuth, apiLimiter, graphRouter);
app.use('/api/retention-graph', requireAuth, apiLimiter, retentionGraphRouter);
app.use('/api/nuggets',         requireAuth, apiLimiter, nuggetLinksRouter);
app.use('/api/admin',           requireAuth, apiLimiter, requireRole('admin', 'support'), adminRouter);

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const missingEnv = ['JWT_SECRET', 'ANTHROPIC_API_KEY', 'DATABASE_URL'].filter((k) => !process.env[k]);
    if (missingEnv.length) {
      return res.status(500).json({ status: 'degraded', missingEnv });
    }
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'degraded', error: 'database unreachable' });
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  // Handlers that respond before doing background work can still throw afterwards.
  // Writing a second response here would throw ERR_HTTP_HEADERS_SENT and mask the
  // original error, so hand those off to Express's default handler instead.
  if (res.headersSent) return next(err);

  // Postgres raises 22P02 for a malformed input literal, which in practice means
  // a bad UUID in a path param. That's a client error, so don't log it as an
  // outage or report it as a 500.
  if ((err as { code?: string }).code === '22P02') {
    return sendError(res, 400, 'INVALID_ID', 'Malformed identifier in request');
  }

  // Oversized or malformed multipart bodies surface as MulterError. Matched by
  // name so this file doesn't need to import multer.
  if (err.name === 'MulterError') {
    return sendError(res, 400, 'INVALID_UPLOAD', err.message);
  }

  console.error({ requestId: res.locals.requestId, path: req.path, err: err.message }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
});

export { app };
