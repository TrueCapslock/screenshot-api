export async function up(knex) {
  await knex.schema.createTable('magic_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email').notNullable().index();
    table.string('token').notNullable().unique().index();
    table.boolean('used').notNullable().defaultTo(false);
    table.timestamp('expires_at').notNullable();
    table.timestamps(true, true);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('magic_tokens');
}
