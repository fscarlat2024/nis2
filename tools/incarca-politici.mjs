// Incarca modelele de politici din content/politici.json (nepublic) in baza de date.
// Utilizare: node tools/incarca-politici.mjs [adresa], cu cheia in ops-key.txt
import { readFileSync } from 'node:fs';
const base = process.argv[2] || 'http://127.0.0.1:8790';
const key = readFileSync(new URL('../ops-key.txt', import.meta.url), 'utf8').trim();
const body = readFileSync(new URL('../content/politici.json', import.meta.url), 'utf8');
const r = await fetch(base + '/api/ops/templates', { method: 'POST', headers: { 'x-ops-key': key, 'content-type': 'application/json' }, body });
console.log(r.status, await r.text());
