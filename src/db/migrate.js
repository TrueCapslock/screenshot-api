import db from './knex.js';

async function migrate() {
  console.log('Running migrations...');
  const [batch, log] = await db.migrate.latest();
  console.log(`Batch: ${batch}, Migrations: ${log.length ? log.join(', ') : 'none'}`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
