// Verificare rapida pe productie: creeaza o firma de test si o sterge. node tests/smoke.mjs adresa
import { createHmac } from 'node:crypto';
const BASE = process.argv[2];
const call = async (p, token, body, method) => {
  const r = await fetch(BASE + '/api/' + p, { method: method || (body ? 'POST' : 'GET'), headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
function totp(secret) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const out = [];
  for (const c of secret) { val = (val << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } val &= (1 << bits) - 1; }
  const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', Buffer.from(out)).update(m).digest(); const o = h[19] & 15;
  return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000).padStart(6, '0');
}
const email = `smoke.${Date.now()}@test.invalid`.replace('.invalid', '.ro'), password = 'test-' + Date.now() + '-parola', name = 'Test Smoke SRL';
const su = await call('signup', null, { cui: '14399840', company_name: name, name: 'Test', email, password });
console.log('inregistrare', su.s);
const t = su.d.token;
const st = await call('mfa/setup', t, undefined, 'POST'); console.log('mfa setup', st.s);
console.log('mfa enable', (await call('mfa/enable', t, { code: totp(st.d.secret) })).s);
console.log('plan', (await call('company/plan', t, { plan: 'firma' })).s);
const d = await call('dashboard', t); console.log('panou', d.s, 'masuri', d.d.measures?.length);
console.log('politici', (await call('policies', t)).d.items?.length);
const i = await call('incidents', t, { kind: 'Altceva', details: 'test' }); console.log('incident', i.s);
const rp = await call('report/link', t, undefined, 'POST'); console.log('raport', (await fetch(rp.d.url)).status);
console.log('stergere firma', (await call('company', t, { password, confirm: name }, 'DELETE')).s);
console.log('login dupa stergere', (await call('login', null, { email, password })).s);
