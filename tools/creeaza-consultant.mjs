// Creeaza un cont de consultant NCS. Utilizare: node tools/creeaza-consultant.mjs email "Nume" [adresa]
import { readFileSync } from 'node:fs';
const [email, name, base = 'http://127.0.0.1:8790'] = process.argv.slice(2);
const key = readFileSync(new URL('../ops-key.txt', import.meta.url), 'utf8').trim();
const r = await fetch(base + '/api/ops/consultant', { method: 'POST', headers: { 'x-ops-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ email, name }) });
console.log(r.status, await r.text());
