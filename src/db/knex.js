import knex from 'knex';
import config from '../config.js';

const db = knex({
  client: 'pg',
  connection: config.db.url,
  migrations: {
    directory: new URL('.', import.meta.url).pathname + 'migrations',
    extension: 'js',
  },
  pool: { min: 2, max: 10 },
});

export default db;
