export async function up(knex) {
  await knex.schema.alterTable('alerts', (table) => {
    table.integer('consecutive_failures').notNullable().defaultTo(0);
  });

  await knex.schema.alterTable('alert_runs', (table) => {
    table.text('error_message');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('alerts', (table) => {
    table.dropColumn('consecutive_failures');
  });

  await knex.schema.alterTable('alert_runs', (table) => {
    table.dropColumn('error_message');
  });
}
