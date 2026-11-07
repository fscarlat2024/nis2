// Test cap-coada pe serverul local: node tests/e2e.mjs [adresa]
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
const BASE = process.argv[2] || 'http://127.0.0.1:8790';
const OPS = readFileSync(new URL('../ops-key.txt', import.meta.url), 'utf8').trim();
let pass = 0, failN = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { failN++; console.log('EROARE', name, extra); } };
const run = Date.now().toString(36);

async function call(path, { token, method, body, raw, type, ops } = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (ops) headers['x-ops-key'] = ops;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (type) headers['content-type'] = type;
  const r = await fetch(BASE + '/api/' + path, { method: method || (body !== undefined || raw ? 'POST' : 'GET'), headers, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
  const ct = r.headers.get('content-type') || '';
  return { s: r.status, d: ct.includes('json') ? await r.json() : await r.arrayBuffer(), h: r.headers };
}
function totp(secret, offset = 0) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const out = [];
  for (const c of secret) { val = (val << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } val &= (1 << bits) - 1; }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', Buffer.from(out)).update(msg).digest(); const o = h[19] & 15;
  return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000).padStart(6, '0');
}
function validCui() { // construieste un CUI valid cu cifra de control
  const base = String(10000000 + Math.floor(Math.random() * 8999999)); const key = '753217532'; const d = base.padStart(9, '0');
  let s = 0; for (let i = 0; i < 9; i++) s += Number(d[i]) * Number(key[i]);
  return base + String((s * 10) % 11 % 10);
}
async function signup(label, role = 'responsabil') {
  const email = `${label}.${run}@test.ro`, password = 'parola-foarte-buna-1';
  const r = await call('signup', { body: { cui: 'RO' + validCui(), company_name: 'Firma ' + label + ' SRL', name: 'Ion ' + label, email, password, role, terms: 'on' } });
  ok(r.s === 201, 'signup ' + label, JSON.stringify(r.d));
  const s = await call('mfa/setup', { token: r.d.token, method: 'POST' });
  const e = await call('mfa/enable', { token: r.d.token, body: { code: totp(s.d.secret) } });
  ok(e.s === 200 && e.d.recovery_codes.length === 8, 'mfa enable', JSON.stringify(e.d));
  return { token: r.d.token, email, password, secret: s.d.secret, recovery: e.d.recovery_codes };
}
async function member(admin, role, label) {
  const inv = await call('invites', { token: admin.token, body: { role } });
  ok(inv.s === 201, 'invitatie ' + role, JSON.stringify(inv.d));
  const email = `${label}.${run}@test.ro`, password = 'parola-foarte-buna-2';
  const j = await call('join', { body: { code: inv.d.code, name: 'Ana ' + label, email, password } });
  ok(j.s === 201, 'join ' + role, JSON.stringify(j.d));
  const again = await call('join', { body: { code: inv.d.code, name: 'X', email: 'x' + email, password } });
  ok(again.s === 400, 'invitatia merge o singura data');
  const m = { token: j.d.token, email, password };
  if (role !== 'angajat') {
    const blocked = await call('me', { token: m.token });
    ok(blocked.s === 403 && blocked.d.code === 'mfa_setup', 'MFA obligatoriu pentru ' + role);
    const s = await call('mfa/setup', { token: m.token, method: 'POST' });
    await call('mfa/enable', { token: m.token, body: { code: totp(s.d.secret) } });
  }
  return m;
}

// --- modele de politici
const t = await call('ops/templates', { ops: OPS, body: JSON.parse(readFileSync(new URL('../content/politici.json', import.meta.url), 'utf8')) });
ok(t.s === 200 && t.d.count === 12, 'incarcare modele', JSON.stringify(t.d));
ok((await call('ops/templates', { ops: 'gresit', body: { items: [] } })).s === 403, 'cheie ops gresita refuzata');

// --- validari la inregistrare
ok((await call('signup', { body: { cui: '12345678', company_name: 'X SRL', name: 'Ion', email: 'a@b.ro', password: 'parola-foarte-buna' } })).s === 400, 'CUI invalid refuzat');
ok((await call('signup', { body: { cui: validCui(), company_name: 'X SRL', name: 'Ion', email: 'a@b.ro', password: 'scurt' } })).s === 400, 'parola scurta refuzata');

const A = await signup('a'), B = await signup('b');
ok((await call('signup', { body: { cui: validCui(), company_name: 'X SRL', name: 'Ion', email: A.email, password: 'parola-foarte-buna' } })).s === 409, 'email duplicat');

// --- autentificare
const wrong = await call('login', { body: { email: A.email, password: 'gresita-gresita' } });
ok(wrong.s === 401, 'parola gresita');
const lg = await call('login', { body: { email: A.email, password: A.password } });
ok(lg.s === 200 && lg.d.next === 'mfa_verify', 'login cere MFA');
ok((await call('dashboard', { token: lg.d.token })).d.code === 'mfa_verify', 'fara cod nu intra');
ok((await call('mfa/verify', { token: lg.d.token, body: { code: '000000' } })).s === 400, 'cod TOTP gresit');
const rec = await call('mfa/verify', { token: lg.d.token, body: { code: A.recovery[0] } });
ok(rec.s === 200, 'cod de recuperare');
const lg2 = await call('login', { body: { email: A.email, password: A.password } });
ok((await call('mfa/verify', { token: lg2.d.token, body: { code: A.recovery[0] } })).s === 400, 'codul de recuperare merge o singura data');
ok((await call('me')).s === 401, 'fara token 401');

// --- incadrare
const as = await call('company/assess', { token: A.token, body: { sector: 'alimentar', employees: '50-249', turnover: '10-50' } });
ok(as.d.classification === 'importanta', 'alimentar mediu = importanta', JSON.stringify(as.d));
ok((await call('company/assess', { token: A.token, body: { sector: 'energie', employees: '250+', turnover: '50+' } })).d.classification === 'esentiala', 'energie mare = esentiala');
ok((await call('company/assess', { token: A.token, body: { sector: 'energie', employees: 'sub50', turnover: 'sub10' } })).d.classification === 'neinclusa', 'firma mica neinclusa');
ok((await call('company/assess', { token: A.token, body: { sector: 'altul', employees: 'sub50', turnover: 'sub10', special: true } })).d.classification === 'verificare', 'servicii speciale de verificat');
await call('company/assess', { token: A.token, body: { sector: 'alimentar', employees: '50-249', turnover: '10-50' } });

// --- planuri: gratuit
ok((await call('policies', { token: A.token })).s === 200, 'lansare gratuita: politici disponibile');
const dm = await call('ops/demo', { ops: OPS, body: {} }); ok(dm.s === 200, 'firma demo', JSON.stringify(dm.d));
const dl0 = await call('login', { body: { email: dm.d.email, password: dm.d.password } }); ok(dl0.d.next === 'app', 'demo fara MFA');
ok((await call('dashboard', { token: dl0.d.token })).d.score > 0, 'demo are scor');
const dm2 = await call('ops/demo', { ops: OPS, body: {} }); ok(dm2.s === 200, 'demo se recreeaza');
ok((await call('dashboard', { token: dl0.d.token })).s === 401, 'sesiunea demo veche dispare');
await call('company/plan', { token: B.token, body: { plan: 'consultant' } });

// --- panou si sarcini
let dash = await call('dashboard', { token: A.token });
ok(dash.d.score === 0 && dash.d.measures.length === 10, 'scor initial 0, 10 masuri', JSON.stringify(dash.d).slice(0, 200));
const items = (await call('tasks?measure=j', { token: A.token })).d.items;
ok(items.length === 3, '3 sarcini pe masura j');
const T = items[0].id;
ok((await call('tasks/' + T, { token: A.token, method: 'PUT', body: { status: 'finalizata' } })).s === 200, 'finalizare sarcina');
dash = await call('dashboard', { token: A.token });
ok(dash.d.measures.find((m) => m.id === 'j').pct === 33 && dash.d.score === 3, 'scorul se recalculeaza', String(dash.d.score));
ok((await call('tasks/' + T, { token: A.token, method: 'PUT', body: { due_on: 'ieri' } })).s === 400, 'data invalida');

// --- echipa
const dir = await member(A, 'conducere', 'dir'), ang = await member(A, 'angajat', 'ang');
const team = (await call('team', { token: A.token })).d.items;
ok(team.length === 3, 'echipa are 3 persoane');
const angId = team.find((x) => x.email === ang.email).id;
ok((await call('tasks/' + T, { token: A.token, method: 'PUT', body: { assignee_id: angId, due_on: new Date(Date.now() + 86400000).toISOString().slice(0, 10) } })).s === 200, 'atribuire sarcina');
ok((await call('team', { token: ang.token })).s === 403, 'angajatul nu vede echipa');
ok((await call('tasks/' + items[1].id, { token: ang.token })).s === 403, 'angajatul nu vede sarcini neatribuite');
ok((await call('tasks/' + T, { token: ang.token })).s === 200, 'angajatul isi vede sarcina');
ok((await call('dashboard', { token: ang.token })).d.score === null, 'angajatul nu vede scorul');

// --- dovezi
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const up = await call(`evidence?task_id=${T}&name=captura.png`, { token: A.token, raw: png, type: 'image/png' });
ok(up.s === 201, 'incarcare dovada', JSON.stringify(up.d));
ok((await call(`evidence?task_id=${T}&name=x.html`, { token: A.token, raw: Buffer.from('<script>'), type: 'text/html' })).s === 415, 'HTML refuzat');
ok((await call(`evidence?task_id=${T}&name=mare.png`, { token: A.token, raw: Buffer.alloc(2_000_000), type: 'image/png' })).s === 413, 'fisier prea mare');
const dl = await call('evidence/' + up.d.id, { token: A.token });
ok(dl.s === 200 && Buffer.from(dl.d).equals(png), 'descarcare identica');
ok((dl.h.get('content-disposition') || '').startsWith('attachment'), 'dovada se descarca, nu se afiseaza');
const lk = await call(`evidence/${up.d.id}/link`, { token: A.token, method: 'POST' }); ok(lk.s === 200, 'link fisier');
const lf = await fetch(lk.d.url.replace(/^https?:\/\/[^/]+/, BASE)); ok(lf.status === 200 && Buffer.from(await lf.arrayBuffer()).equals(png), 'fisier prin link');
ok((await call(`evidence/${up.d.id}/link`, { token: B.token, method: 'POST' })).s === 404, 'firma B nu face link la dovada firmei A');
ok((await fetch(BASE + '/f/' + 'a'.repeat(64))).status === 404, 'link fisier gresit');

// --- izolare intre firme
ok((await call('evidence/' + up.d.id, { token: B.token })).s === 404, 'firma B nu vede dovada firmei A');
ok((await call('tasks/' + T, { token: B.token })).s === 404, 'firma B nu vede sarcina firmei A');
ok((await call('tasks/' + T, { token: B.token, method: 'PUT', body: { status: 'deschisa' } })).s === 404, 'firma B nu modifica sarcina firmei A');
ok((await call(`evidence?task_id=${T}&name=x.png`, { token: B.token, raw: png, type: 'image/png' })).s === 404, 'firma B nu incarca la firma A');
ok((await call('tasks/' + items[1].id, { token: B.token, method: 'PUT', body: { assignee_id: angId } })).s === 404, 'firma B nu atribuie la firma A');
const bTask = (await call('tasks?measure=j', { token: B.token })).d.items[0].id;
ok((await call('tasks/' + bTask, { token: B.token, method: 'PUT', body: { assignee_id: angId } })).s === 400, 'nu poti atribui un angajat din alta firma');

// --- politici
const pols = (await call('policies', { token: A.token })).d.items;
ok(pols.length === 12, '12 politici', String(pols.length));
const P = pols[0].id;
const pd = await call('policies/' + P, { token: A.token });
ok(pd.d.body.includes('Firma a SRL') && !/netcomm|\{\{firma\}\}/i.test(pd.d.body), 'politica are numele firmei', pd.d.body.slice(0, 80));
ok((await call('policies', { token: ang.token })).d.items.length === 0, 'angajatul nu vede ciorne');
ok((await call(`policies/${P}/approve`, { token: dir.token, method: 'POST' })).s === 400, 'nu se aproba o ciorna');
ok((await call(`policies/${P}/submit`, { token: A.token, method: 'POST' })).s === 200, 'trimitere spre aprobare');
ok((await call(`policies/${P}/approve`, { token: A.token, method: 'POST' })).s === 403, 'doar conducerea aproba');
ok((await call(`policies/${P}/approve`, { token: dir.token, method: 'POST' })).s === 200, 'conducerea aproba');
ok((await call(`policies/${P}/read`, { token: ang.token, method: 'POST' })).s === 200, 'confirmare citire');
let list = (await call('policies', { token: A.token })).d.items.find((x) => x.id === P);
ok(list.reads === 1 && list.status === 'aprobata', 'citirea se numara');
await call('policies/' + P, { token: A.token, method: 'PUT', body: { body: pd.d.body + '\nModificare de test, destul de lunga.' } });
list = (await call('policies', { token: A.token })).d.items.find((x) => x.id === P);
ok(list.status === 'ciorna' && list.version === 2 && list.reads === 0, 'modificarea cere aprobare si citire din nou');
ok((await call('policies/' + P, { token: B.token })).s === 404, 'firma B nu vede politica firmei A');

// --- incidente
const inc = await call('incidents', { token: ang.token, body: { kind: 'Email suspect', details: 'Am deschis atasamentul <script>alert(1)</script>' } });
ok(inc.s === 201 && inc.d.seq === 1, 'angajatul raporteaza', JSON.stringify(inc.d));
const I = inc.d.id;
ok(inc.d.notified && inc.d.notified.targets >= 1 && inc.d.notified.push === 0 && inc.d.notified.email === 0, 'raportul spune ca nu a plecat nicio alerta', JSON.stringify(inc.d.notified));
const seen = (await call('incidents/' + I, { token: ang.token })).d;
ok(seen.notified && seen.notified.targets >= 1 && seen.notified.email === 0 && seen.reported_by_me === true, 'angajatul vede starea reala a alertei', JSON.stringify(seen.notified));
ok((await call('incidents', { token: ang.token })).d.items.length === 1, 'angajatul isi vede incidentul');
ok((await call(`evidence?incident_id=${I}&name=ecran.png`, { token: ang.token, raw: png, type: 'image/png' })).s === 201, 'poza la incident');
ok((await call('incidents/' + I, { token: ang.token, method: 'PUT', body: { significant: true } })).s === 403, 'angajatul nu evalueaza');
ok((await call(`incidents/${I}/mark`, { token: A.token, body: { step: 'early' } })).s === 400, 'nu marchezi inainte de evaluare');
ok((await call('incidents/' + I, { token: A.token, method: 'PUT', body: { significant: true } })).s === 200, 'marcat semnificativ');
let det = (await call('incidents/' + I, { token: A.token })).d;
ok(det.deadlines.early - det.aware_at === 24 * 3600000 && det.deadlines.notif - det.aware_at === 72 * 3600000, 'termene 24h si 72h');
ok(det.draft.includes('Firma a SRL') && det.draft.includes('Email suspect'), 'text DNSC pregatit');
ok(!('draft' in (await call('incidents/' + I, { token: ang.token })).d), 'angajatul nu vede textul DNSC');
ok((await call(`incidents/${I}/mark`, { token: A.token, body: { step: 'early' } })).s === 200, 'alerta marcata');
ok((await call('incidents/' + I, { token: B.token })).s === 404, 'firma B nu vede incidentul firmei A');
const inc2 = await call('incidents', { token: A.token, body: { kind: 'Cont spart' } });
ok((await call('incidents/' + inc2.d.id, { token: ang.token })).s === 403, 'angajatul nu vede incidentele altora');
ok(inc2.d.seq === 2, 'numerotare pe firma');
ok((await call('incidents', { token: B.token, body: { kind: 'Altceva' } })).d.seq === 1, 'numerotare separata la firma B');
ok((await call('incidents', { token: B.token, body: { kind: 'inventat' } })).s === 400, 'tip invalid');

// --- memento-uri
const r1 = await call('ops/reminders', { ops: OPS, body: { now: det.aware_at + 71.5 * 3600000 } });
ok(r1.s === 200 && r1.d.sent >= 1, 'memento termen', JSON.stringify(r1.d));
const r2 = await call('ops/reminders', { ops: OPS, body: { now: det.aware_at + 71.5 * 3600000 } });
ok(r2.d.sent === 0, 'memento-ul nu se repeta', JSON.stringify(r2.d));

// --- raport
const rl = await call('report/link', { token: A.token, method: 'POST' });
ok(rl.s === 200, 'link raport');
const page = await fetch(rl.d.url.replace(/^https?:\/\/[^/]+/, BASE));
const html = await page.text();
ok(page.status === 200 && html.includes('Firma a SRL') && html.includes('Nu este o certificare'), 'raportul se deschide');
ok((page.headers.get('content-security-policy') || '').includes("script-src 'self'"), 'raportul are CSP');
ok((await fetch(BASE + '/r/' + 'a'.repeat(64))).status === 404, 'link gresit refuzat');
ok((await call('report/link', { token: ang.token, method: 'POST' })).s === 403, 'angajatul nu genereaza raport');

// --- continut periculos
ok(!html.includes('<script>alert'), 'raportul nu contine scriptul introdus');

// --- consultant: doar firmele cu plan consultant
const cons = await call('ops/consultant', { ops: OPS, body: { email: `cons.${run}@test.ro`, name: 'Consultant Test' } });
ok(cons.s === 200, 'creare consultant', JSON.stringify(cons.d));
const cl = await call('login', { body: { email: cons.d.email, password: cons.d.temp_password } });
ok(cl.d.next === 'mfa_setup', 'consultantul are MFA obligatoriu');
const cs = await call('mfa/setup', { token: cl.d.token, method: 'POST' });
await call('mfa/enable', { token: cl.d.token, body: { code: totp(cs.d.secret) } });
const pc = await call('panel/companies', { token: cl.d.token });
ok(pc.d.items.some((c) => c.name === 'Firma b SRL'), 'consultantul vede firma cu plan consultant');
ok(!pc.d.items.some((c) => c.name === 'Firma a SRL'), 'consultantul nu vede firma fara acord');
const aId = (await call('me', { token: A.token })).d.company.id, bId = (await call('me', { token: B.token })).d.company.id;
ok((await call('panel/companies/' + aId, { token: cl.d.token })).s === 404, 'detalii refuzate fara acord');
const det2 = await call('panel/companies/' + bId, { token: cl.d.token }); ok(det2.s === 200 && det2.d.company.name === 'Firma b SRL', 'detalii cu acord');
ok((await call('panel/companies', { token: A.token })).s === 403, 'firmele nu au acces la panou');
const logB = (await call('audit', { token: B.token })).d.items;
ok(logB.some((l) => l.action.includes('consultant')), 'consultarea apare in jurnalul firmei');

// --- jurnal
const logA = (await call('audit', { token: A.token })).d.items;
ok(logA.some((l) => l.action === 'Politică aprobată') && logA.some((l) => l.action === 'Incident marcat semnificativ'), 'jurnalul inregistreaza');
ok((await call('audit', { token: ang.token })).s === 403, 'angajatul nu vede jurnalul');

// --- parola si resetare
ok((await call('password', { token: ang.token, body: { old: 'gresita', new: 'parola-noua-foarte-buna' } })).s === 400, 'parola veche gresita');
ok((await call('password', { token: ang.token, body: { old: ang.password, new: 'parola-noua-foarte-buna' } })).s === 200, 'schimbare parola');
const rs = await call(`team/${angId}/reset`, { token: A.token, method: 'POST' });
ok(rs.s === 200 && rs.d.temp_password, 'resetare de administrator');
ok((await call('me', { token: ang.token })).s === 401, 'sesiunile vechi se inchid la resetare');
ok((await call('login', { body: { email: ang.email, password: rs.d.temp_password } })).s === 200, 'login cu parola temporara');

// --- limitare incercari
let last;
for (let i = 0; i < 10; i++) last = await call('login', { body: { email: 'atac@test.ro', password: 'x' } });
ok(last.s === 429, 'blocare dupa prea multe incercari', String(last.s));

// --- stergeri
const onlyB = await call('account', { token: B.token, method: 'DELETE', body: { password: B.password } });
ok(onlyB.s === 409 && onlyB.d.code === 'last_manager', 'ultimul administrator nu se poate sterge');
ok((await call('company', { token: B.token, method: 'DELETE', body: { password: B.password, confirm: 'alt nume' } })).s === 400, 'stergerea cere numele firmei');
ok((await call('company', { token: B.token, method: 'DELETE', body: { password: B.password, confirm: 'Firma b SRL' } })).s === 200, 'stergere firma');
ok((await call('login', { body: { email: B.email, password: B.password } })).s === 401, 'contul dispare cu firma');
ok((await call('dashboard', { token: A.token })).s === 200, 'firma A nu e afectata');

console.log(`\n${pass} corecte, ${failN} erori`);
process.exit(failN ? 1 : 0);
