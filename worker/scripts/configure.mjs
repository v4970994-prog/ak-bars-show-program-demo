import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// These identify an EXISTING database. Never create a replacement database here.
const id = (process.env.CLOUDFLARE_D1_DATABASE_ID || '').trim();
const name = (process.env.CLOUDFLARE_D1_DATABASE_NAME || '').trim();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !name) {
  throw new Error('Set CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_D1_DATABASE_NAME to the existing DB binding before deployment. No configuration was written.');
}
const config = {
  name: 'ak-bars-show-program',
  main: 'src/worker.js',
  compatibility_date: '2026-10-04',
  keep_vars: true,
  secrets: { required: ['TELEGRAM_BOT_TOKEN', 'MAX_BOT_TOKEN'] },
  d1_databases: [{ binding: 'DB', database_name: name, database_id: id }]
};
writeFileSync(fileURLToPath(new URL('../wrangler.json', import.meta.url)), JSON.stringify(config, null, 2) + '\n');
console.log('Configured ak-bars-show-program with the existing DB binding. No deployment performed.');
