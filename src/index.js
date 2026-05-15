import './instrument.js';

import app from './app.js';
import config from './config.js';
import db from './db/knex.js';
import { startCleanup } from './cleanup.js';
import logger from './services/logger.js';

const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;

console.log = (...args) => {
  origLog(...args);
  logger.info(args.map(String).join(' '));
};
console.error = (...args) => {
  origError(...args);
  logger.error(args.map(String).join(' '));
};
console.warn = (...args) => {
  origWarn(...args);
  logger.warn(args.map(String).join(' '));
};

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
