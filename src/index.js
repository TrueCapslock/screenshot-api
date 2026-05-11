import app from './app.js';
import config from './config.js';
import db from './db/knex.js';
import { startCleanup } from './cleanup.js';

async function start() {
  if (config.env === 'production') {
    console.log('Running migrations...');
    const [batch, log] = await db.migrate.latest();
    console.log(`Migrations: batch ${batch}, ${log.length ? log.join(', ') : 'none'}`);
  }

  startCleanup();

  app.listen(config.port, () => {
    console.log(`Screenshot API listening on port ${config.port} [${config.env}]`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
