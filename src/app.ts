import 'dotenv/config';
import crypto from 'crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, requireRole } from './middleware/requireAuth';
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

// Authenticated API routes: key by userId so one account can't starve others,
// fall back to IP for unauthenticated requests that slip through.
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    (req.res?.locals.userId as string | undefined) ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

app.use('/api/auth',           authLimiter, authRouter);
app.use('/api/collections',    apiLimiter, requireAuth, collectionsRouter);
app.use('/api/sessions',       apiLimiter, requireAuth, sessionsRouter);
app.use('/api/artifacts',      apiLimiter, requireAuth, artifactsRouter);
app.use('/api/review',         apiLimiter, requireAuth, reviewRouter);
app.use('/api/conversations',  apiLimiter, requireAuth, conversationsRouter);
app.use('/api/quiz',           apiLimiter, requireAuth, quizRouter);
app.use('/api/graph',           apiLimiter, requireAuth, graphRouter);
app.use('/api/retention-graph', apiLimiter, requireAuth, retentionGraphRouter);
app.use('/api/nuggets',         apiLimiter, requireAuth, nuggetLinksRouter);
app.use('/api/admin',           apiLimiter, requireAuth, requireRole('admin', 'support'), adminRouter);

app.get('/api/health', async (_req, res) => {
  try {
    await import('./db').then(({ pool }) => pool.query('SELECT 1'));
    const missingEnv = ['JWT_SECRET', 'ANTHROPIC_API_KEY', 'DATABASE_URL'].filter((k) => !process.env[k]);
    if (missingEnv.length) {
      return res.status(500).json({ status: 'degraded', missingEnv });
    }
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'degraded', error: 'database unreachable' });
  }
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error({ requestId: res.locals.requestId, path: req.path, err: err.message }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
});

export { app };
