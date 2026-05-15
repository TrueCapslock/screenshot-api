export function up(knex) {
  return knex.schema.createTable('sessions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('token', 128).notNullable().unique();
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('api_key_id').notNullable().references('id').inTable('api_keys').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('last_used_at').defaultTo(knex.fn.now());
  });
}

export function down(knex) {
  return knex.schema.dropTableIfExists('sessions');
}
