export function up(knex) {
  return knex.schema.createTable('api_keys', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('key_hash', 255).notNullable();
    table.string('key_prefix', 10).notNullable();
    table.string('name', 255).notNullable();
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamp('last_used_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export function down(knex) {
  return knex.schema.dropTableIfExists('api_keys');
}
