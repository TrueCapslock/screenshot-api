export function up(knex) {
  return knex.schema.createTable('alerts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.text('url').notNullable();
    table.jsonb('options');
    table.integer('interval_minutes').notNullable().defaultTo(60);
    table.float('threshold').notNullable().defaultTo(0);
    table.boolean('enabled').notNullable().defaultTo(true);
    table.timestamp('last_checked_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index(['user_id', 'enabled'], 'idx_alerts_enabled');
  });
}

export function down(knex) {
  return knex.schema.dropTableIfExists('alerts');
}
