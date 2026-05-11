export function up(knex) {
  return knex.schema.createTable('usage_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('api_key_id').notNullable().references('id').inTable('api_keys').onDelete('CASCADE');
    table.string('endpoint', 100).notNullable();
    table.string('status', 20).notNullable();
    table.integer('bytes');
    table.integer('duration_ms');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['api_key_id', 'created_at'], 'idx_usage_lookup');
  });
}

export function down(knex) {
  return knex.schema.dropTableIfExists('usage_logs');
}
