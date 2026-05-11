async function seed() {
  console.log('Seeding database...');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
