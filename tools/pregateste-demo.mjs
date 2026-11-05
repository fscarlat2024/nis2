// Incarca modelele de politici si recreeaza firma demonstrativa pentru verificarea Apple.
// Parola se salveaza doar local, in .demo-account.json (gitignored).
import { readFileSync, writeFileSync } from 'node:fs';
const base = process.argv[2] || 'https://nis2-app.flscarlat.workers.dev';
const key = readFileSync(new URL('../ops-key.txt', import.meta.url), 'utf8').trim();
const post = (p, body) => fetch(base + '/api/ops/' + p, { method: 'POST', headers: { 'x-ops-key': key, 'content-type': 'application/json' }, body });
const t = await post('templates', readFileSync(new URL('../content/politici.json', import.meta.url), 'utf8'));
console.log('modele', t.status, await t.text());
const d = await post('demo', '{}');
const demo = await d.json();
if (!d.ok) throw new Error(JSON.stringify(demo));
writeFileSync(new URL('../.demo-account.json', import.meta.url), JSON.stringify(demo, null, 1));
console.log('demo', d.status, demo.email);
