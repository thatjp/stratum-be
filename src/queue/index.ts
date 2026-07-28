import { PgBoss, type Job } from 'pg-boss';
import type { Queryable } from '../db';
import { logger } from '../logger';
import { processCapture } from '../services/processingPipeline';

export const CAPTURE_QUEUE = 'capture.process';

// Bounds how many captures are extracted at once. Each in-flight job holds a
// database connection and an Anthropic request for the duration of extraction,
// so unbounded concurrency exhausts the pool and trips provider rate limits.
const CAPTURE_CONCURRENCY = parseInt(process.env.CAPTURE_CONCURRENCY ?? '4', 10);

interface CaptureJob {
  captureId: string;
}

let boss: PgBoss | undefined;

export async function startQueue(): Promise<void> {
  const instance = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    // pg-boss maintains its own pool; keep it small so background polling
    // doesn't compete with the request path for Postgres connections.
    max: 4,
  });

  // pg-boss surfaces polling and maintenance failures here. Without a listener
  // these are unhandled 'error' events, which would take the process down.
  instance.on('error', (err: Error) => {
    logger.error({ event: 'queue_error', err: err.message });
  });

  await instance.start();

  await instance.createQueue(CAPTURE_QUEUE, {
    // A job that outlives this is assumed dead and becomes eligible for retry —
    // generous enough for a slow extraction, short enough that a crashed worker
    // doesn't strand a capture for long.
    expireInSeconds: 300,
    retryLimit:      3,
    retryDelay:      30,
    retryBackoff:    true,
  });

  await instance.work<CaptureJob>(
    CAPTURE_QUEUE,
    { localConcurrency: CAPTURE_CONCURRENCY },
    async (jobs: Job<CaptureJob>[]) => {
      for (const job of jobs) {
        await processCapture(job.data.captureId);
      }
    },
  );

  boss = instance;
  logger.info({ event: 'queue_started', queue: CAPTURE_QUEUE, concurrency: CAPTURE_CONCURRENCY });
}

// Enqueue a capture for extraction. Pass the client of an open transaction as
// `db` to make the job commit atomically with the rows that produced it — a
// capture row can then never exist without the job that processes it, and a
// rolled-back insert never leaves a job pointing at a row that isn't there.
export async function enqueueCapture(captureId: string, db?: Queryable): Promise<void> {
  if (!boss) throw new Error('Queue has not been started');

  await boss.send(
    CAPTURE_QUEUE,
    { captureId },
    {
      // Collapses duplicate enqueues while an extraction is still outstanding.
      singletonKey: captureId,
      ...(db ? { db: { executeSql: (text: string, values?: unknown[]) => db.query(text, values) } } : {}),
    },
  );
}

export async function stopQueue(): Promise<void> {
  const instance = boss;
  boss = undefined;
  await instance?.stop({ graceful: true });
}
