export function up(knex) {
  return knex.schema.alterTable('screenshots', (table) => {
    table.boolean('is_baseline').defaultTo(false);
    table.uuid('baseline_id').references('id').inTable('screenshots').onDelete('SET NULL');
    table.float('diff_percentage');
    table.string('diff_storage_path', 500);
  });
}

export function down(knex) {
  return knex.schema.alterTable('screenshots', (table) => {
    table.dropColumn('is_baseline');
    table.dropColumn('baseline_id');
    table.dropColumn('diff_percentage');
    table.dropColumn('diff_storage_path');
  });
}
