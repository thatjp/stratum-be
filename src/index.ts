import 'dotenv/config';
import { app } from './app';
import { pool, initSchema, resetStuckCaptures, pruneExpiredTokens } from './db';
import { logger } from './logger';
import { startQueue, stopQueue } from './queue';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// How long to let in-flight requests finish before exiting anyway.
const SHUTDOWN_TIMEOUT_MS = 15_000;

const REQUIRED_ENV = ['JWT_SECRET', 'ANTHROPIC_API_KEY', 'DATABASE_URL'] as const;

async function main() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    logger.fatal({ event: 'startup_failed', missing }, 'Required environment variables are not set');
    process.exit(1);
  }

  await initSchema();
  logger.info({ event: 'schema_initialized' });

  // Startup maintenance is best-effort — a slow or failing sweep should not
  // keep the server from coming up and put the deploy into a restart loop.
  //
  // resetStuckCaptures must run before the queue starts: a job retried after a
  // crash finds its capture still marked 'extracting' and would decline to
  // claim it. This assumes a single instance — with several, one booting node
  // would reset captures another is actively extracting.
  for (const task of [resetStuckCaptures, pruneExpiredTokens]) {
    await task().catch((err: unknown) =>
      logger.error({ event: 'startup_maintenance_failed', task: task.name, err: String(err) }),
    );
  }

  await startQueue();
  const server = app.listen(PORT, () => {
    logger.info({ event: 'server_started', port: PORT });
  });

  // Railway sends SIGTERM on every deploy. Without draining, requests that are
  // mid-Claude-call are severed after having already written a partial result
  // (a user message with no assistant reply, for example).
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'shutdown_started', signal });

    const forceExit = setTimeout(() => {
      logger.error({ event: 'shutdown_forced', afterMs: SHUTDOWN_TIMEOUT_MS });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(async (err) => {
      if (err) logger.error({ event: 'shutdown_server_close_failed', err: err.message });
      // Stop the queue before the pool: a graceful stop lets in-flight jobs
      // finish, and they still need database access to do it.
      try {
        await stopQueue();
      } catch (queueErr) {
        logger.error({ event: 'shutdown_queue_stop_failed', err: String(queueErr) });
      }
      try {
        await pool.end();
      } catch (poolErr) {
        logger.error({ event: 'shutdown_pool_close_failed', err: String(poolErr) });
      }
      logger.info({ event: 'shutdown_complete' });
      process.exit(err ? 1 : 0);
    });

    // server.close() stops new connections but waits on idle keep-alive sockets,
    // which would otherwise stall the drain until the force-exit timer fires.
    server.closeIdleConnections();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
