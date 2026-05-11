export function up(knex) {
  return knex.schema.createTable('screenshots', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('api_key_id').notNullable().references('id').inTable('api_keys').onDelete('CASCADE');
    table.string('job_id', 100);
    table.text('url').notNullable();
    table.jsonb('options');
    table.string('format', 10).defaultTo('png');
    table.string('storage_path', 500);
    table.integer('bytes');
    table.string('status', 20).notNullable().defaultTo('pending');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at');
  });
}

export function down(knex) {
  return knex.schema.dropTableIfExists('screenshots');
}
