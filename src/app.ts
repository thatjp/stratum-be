import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { requireAuth } from './middleware/requireAuth';
import { authRouter } from './routes/auth';
import { collectionsRouter } from './routes/collections';
import { sessionsRouter } from './routes/sessions';
import { artifactsRouter } from './routes/artifacts';
import { reviewRouter } from './routes/review';
import { conversationsRouter } from './routes/conversations';
import { quizRouter } from './routes/quiz';

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000'];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

const authLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
const apiLimiter  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });

app.use('/api/auth',        authLimiter, authRouter);
app.use('/api/collections', apiLimiter, requireAuth, collectionsRouter);
app.use('/api/sessions',    apiLimiter, requireAuth, sessionsRouter);
app.use('/api/artifacts',   apiLimiter, requireAuth, artifactsRouter);
app.use('/api/review',         apiLimiter, requireAuth, reviewRouter);
app.use('/api/conversations',  apiLimiter, requireAuth, conversationsRouter);
app.use('/api/quiz',           apiLimiter, requireAuth, quizRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
});

export { app };
