import 'dotenv/config';
import { app } from './app';
import { initSchema, resetStuckCaptures, pruneExpiredTokens } from './db';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const REQUIRED_ENV = ['JWT_SECRET', 'ANTHROPIC_API_KEY', 'DATABASE_URL'] as const;

async function main() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error({ event: 'startup_failed', missing }, 'Required environment variables are not set');
    process.exit(1);
  }

  await initSchema();
  console.log({ event: 'schema_initialized' });
  await resetStuckCaptures();
  await pruneExpiredTokens();
  app.listen(PORT, () => {
    console.log({ event: 'server_started', port: PORT });
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
