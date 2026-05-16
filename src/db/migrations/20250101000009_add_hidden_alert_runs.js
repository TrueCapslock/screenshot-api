export async function up(knex) {
  await knex.schema.alterTable('screenshots', (table) => {
    table.boolean('hidden').defaultTo(false);
  });

  await knex('screenshots').where('is_baseline', true).update({ hidden: true });

  await knex.schema.createTable('alert_runs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('alert_id').notNullable().references('id').inTable('alerts').onDelete('CASCADE');
    table.boolean('triggered').notNullable().defaultTo(false);
    table.float('diff_percentage');
    table.float('threshold');
    table.uuid('screenshot_id').references('id').inTable('screenshots').onDelete('SET NULL');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index('alert_id', 'idx_alert_runs_alert');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('alert_runs');
  await knex.schema.alterTable('screenshots', (table) => {
    table.dropColumn('hidden');
  });
}
