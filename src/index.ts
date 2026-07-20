import 'dotenv/config';
import { app } from './app';
import { initSchema } from './db';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main() {
  await initSchema();
  console.log('Schema initialized');
  app.listen(PORT, () => {
    console.log(`Stratum API running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
