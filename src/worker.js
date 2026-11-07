// Scut NIS2 - API (Cloudflare Worker + D1)
// Reguli de securitate: orice rand se citeste/scrie doar prin company_id-ul utilizatorului autentificat;
// tokenurile si codurile se pastreaza doar ca hash; secretul TOTP e criptat cu DATA_KEY.
import { MEASURES, BASE_MEASURE, STARTER_TASKS, SECTORS, classify, INCIDENT_KINDS } from './content.js';
import { sendToUsers } from './push.js';
import { sendMail, brevoKeepAlive } from './mail.js';

const SESSION_DAYS = 30;
// Lansare gratuita (decizia lui Florin, 5 nov 2026): toate functiile sunt incluse pana apare plata prin magazine.
const FREE_LAUNCH = true;
const TRIAL_DAYS = 14;
const MAX_FILE = 1_900_000; // limita unui rand D1
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const ROLES = ['responsabil', 'conducere', 'angajat'];
const enc = new TextEncoder();
const H = 3600000;

class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }
const fail = (s, m, c) => { throw new HttpError(s, m, c); };
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const str = (v, max = 2000) => (v == null ? '' : String(v)).trim().slice(0, max);
async function body(req) { try { return await req.json(); } catch { fail(400, 'Date invalide'); } }

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/r/')) return await reportPage(env, url.pathname.slice(3));
      if (url.pathname.startsWith('/f/')) return await filePage(env, url.pathname.slice(3));
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
      return await route(req, env, url, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
      console.error(e);
      return json({ error: 'Eroare de server. Încercați din nou.' }, 500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runReminders(env).catch((e) => console.error('reminders', e))); },
};

// ---------- criptografie ----------
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function sha256(s) { const d = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function randomHex(n = 32) { return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function randomCode(len = 12) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(len));
  return [...r].map((b) => abc[b % abc.length]).join('').replace(/(.{4})(?=.)/g, '$1-');
}
async function hashPassword(pw, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;
}
async function verifyPassword(pw, stored) {
  const [, , salt, hash] = String(stored).split('$');
  if (!salt) return false;
  return safeEqual((await hashPassword(pw, unb64(salt))).split('$')[3], hash);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function dataKey(env) {
  if (!env.DATA_KEY) fail(500, 'Serverul nu este configurat');
  return crypto.subtle.importKey('raw', unb64(env.DATA_KEY.trim()), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(env), enc.encode(text));
  return b64(iv) + '.' + b64(ct);
}
async function unseal(env, sealed) {
  const [iv, ct] = sealed.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await dataKey(env), unb64(ct)));
}

// ---------- TOTP (RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } val &= (1 << bits) - 1; }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of s) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } val &= (1 << bits) - 1; }
  return new Uint8Array(out);
}
async function totpAt(secret, step) {
  const key = await crypto.subtle.importKey('raw', unbase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new DataView(new ArrayBuffer(8)); msg.setUint32(0, Math.floor(step / 2 ** 32)); msg.setUint32(4, step >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg.buffer));
  const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0');
}
async function totpMatch(secret, code, lastStep) {
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now, now - 1, now + 1]) {
    if (step > lastStep && safeEqual(await totpAt(secret, step), code)) return step;
  }
  return 0;
}

// ---------- limite ----------
async function hit(env, key, max, windowMs) {
  const now = Date.now();
  const r = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN reset_at < ?3 THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at < ?3 THEN ?2 ELSE reset_at END
     RETURNING count`).bind(key, now + windowMs, now).first();
  if (r.count > max) fail(429, 'Prea multe încercări. Reîncercați mai târziu.');
}
const ipOf = (req) => req.headers.get('cf-connecting-ip') || 'local';
async function clearLimit(env, key) { await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run(); }

// ---------- sesiune ----------
const mfaRequired = (u) => u.role !== 'angajat' && !u.mfa_exempt;
async function createSession(env, userId, mfaOk) {
  const token = randomHex();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, mfa_ok, expires_at) VALUES (?,?,?,?)')
    .bind(await sha256(token), userId, mfaOk ? 1 : 0, Date.now() + SESSION_DAYS * 86400000).run();
  return token;
}
async function sessionUser(req, env) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer ([a-f0-9]{64})$/);
  if (!m) fail(401, 'Neautentificat', 'auth');
  const hash = await sha256(m[1]);
  const u = await env.DB.prepare(
    `SELECT u.id, u.company_id, u.email, u.name, u.role, u.mfa_exempt, u.totp_on, u.totp_secret, u.totp_last_step, s.mfa_ok, s.token_hash
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).bind(hash, Date.now()).first();
  if (!u) fail(401, 'Sesiunea a expirat', 'auth');
  return u;
}
async function auth(req, env) {
  const u = await sessionUser(req, env);
  if (u.totp_on && !u.mfa_ok) fail(403, 'Introduceți codul de autentificare', 'mfa_verify');
  if (!u.totp_on && mfaRequired(u)) fail(403, 'Activați autentificarea cu doi factori', 'mfa_setup');
  if (u.company_id) u.company = await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(u.company_id).first();
  return u;
}
const isManager = (u) => u.role === 'responsabil' || u.role === 'conducere';
const needManager = (u) => { if (!isManager(u)) fail(403, 'Doar responsabilul sau conducerea pot face asta'); };
const needCompany = (u) => { if (!u.company) fail(403, 'Cont fără firmă'); };
function entitled(c) { if (FREE_LAUNCH && c) return true; const n = Date.now(); return !!c && ((c.paid_until || 0) > n || (c.trial_until || 0) > n); }
const needPaid = (u) => { if (!entitled(u.company)) fail(402, 'Funcția este inclusă în abonament. Porniți perioada de probă.', 'plan'); };
async function audit(env, u, action, target) {
  await env.DB.prepare('INSERT INTO audit_log (company_id, user_id, user_label, action, target, at) VALUES (?,?,?,?,?,?)')
    .bind(u.company_id ?? null, u.id ?? null, u.name || u.email || 'sistem', action, target == null ? null : String(target).slice(0, 200), Date.now()).run();
}
const managerIds = async (env, companyId) => (await env.DB.prepare("SELECT id FROM users WHERE company_id = ? AND active = 1 AND role IN ('responsabil','conducere')").bind(companyId).all()).results.map((r) => r.id);
const pub = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, mfa: !!u.totp_on });

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200; }
function checkPassword(p) { if (typeof p !== 'string' || p.length < 10 || p.length > 200) fail(400, 'Parola trebuie să aibă cel puțin 10 caractere'); }
export function validCui(raw) {
  const s = String(raw || '').toUpperCase().replace(/^RO/, '').replace(/\s/g, '');
  if (!/^[1-9]\d{1,9}$/.test(s)) return null;
  const key = '753217532';
  const digits = s.slice(0, -1).padStart(9, '0');
  let sum = 0; for (let i = 0; i < 9; i++) sum += Number(digits[i]) * Number(key[i]);
  const c = (sum * 10) % 11 % 10;
  return c === Number(s.at(-1)) ? s : null;
}

// ---------- rute ----------
async function route(req, env, url, ctx) {
  const m = req.method, p = url.pathname.slice(5).replace(/\/$/, ''), parts = p.split('/');
  const id = Number(parts[1]);

  if (p === 'meta' && m === 'GET') return json({ sectors: SECTORS.map(({ id, name }) => ({ id, name })), kinds: INCIDENT_KINDS, measures: MEASURES, base: BASE_MEASURE, trial_days: TRIAL_DAYS });
  if (parts[0] === 'cui' && m === 'GET') return cuiLookup(req, env, parts[1]);
  if (p === 'signup' && m === 'POST') return signup(req, env);
  if (p === 'join' && m === 'POST') return join(req, env);
  if (p === 'login' && m === 'POST') return login(req, env);
  if (parts[0] === 'ops') return ops(req, env, parts.slice(1));

  if (p === 'logout' && m === 'POST') {
    const u = await sessionUser(req, env);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(u.token_hash).run();
    return json({ ok: true });
  }
  if (parts[0] === 'mfa') return mfa(req, env, parts[1]);

  const u = await auth(req, env);
  if (p === 'me' && m === 'GET') return json({ user: pub(u), company: u.company ? companyOut(u.company) : null });
  if (p === 'password' && m === 'POST') return changePassword(req, env, u);
  if (parts[0] === 'push') return push(req, env, u, parts[1]);
  if (parts[0] === 'panel') return panel(env, u, parts[1], Number(parts[2]) || 0);
  needCompany(u);

  if (p === 'account' && m === 'DELETE') return deleteAccount(req, env, u);
  if (parts[0] === 'company') return company(req, env, u, parts[1]);
  if (p === 'dashboard' && m === 'GET') return dashboard(env, u);
  if (parts[0] === 'tasks') return tasks(req, env, u, id);
  if (parts[0] === 'evidence') return evidence(req, env, u, url, id, parts[2]);
  if (parts[0] === 'team') return team(req, env, u, id, parts[2]);
  if (parts[0] === 'invites') return invites(req, env, u);
  if (parts[0] === 'policies') return policies(req, env, u, id, parts[2]);
  if (parts[0] === 'incidents') return incidents(req, env, u, id, parts[2], ctx);
  if (p === 'report/link' && m === 'POST') return reportLink(req, env, u, url);
  if (p === 'audit' && m === 'GET') {
    needManager(u);
    return json({ items: (await env.DB.prepare('SELECT user_label, action, target, at FROM audit_log WHERE company_id = ? ORDER BY id DESC LIMIT 100').bind(u.company_id).all()).results });
  }
  fail(404, 'Nu există');
}

function companyOut(c) {
  const { id, cui, name, sector, employees, turnover, special, classification, plan, trial_until, paid_until, incident_email } = c;
  return { id, cui, name, sector, employees, turnover, special, classification, plan, trial_until, paid_until, incident_email, entitled: entitled(c) };
}

// ---------- CUI ----------
async function cuiLookup(req, env, raw) {
  await hit(env, 'cui:' + ipOf(req), 30, H);
  const cui = validCui(raw);
  if (!cui) fail(400, 'CUI invalid');
  try {
    const r = await fetch('https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ cui: Number(cui), data: new Date().toISOString().slice(0, 10) }]),
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    const g = j.found && j.found[0] && j.found[0].date_generale;
    return json({ cui, name: g ? g.denumire : '', address: g ? g.adresa : '' });
  } catch (e) { return json({ cui, name: '', address: '' }); }
}

// ---------- cont ----------
async function seedCompany(env, companyId, companyName) {
  const stmts = STARTER_TASKS.map(([measure, title, detail], i) =>
    env.DB.prepare('INSERT INTO tasks (company_id, measure, title, detail, sort) VALUES (?,?,?,?,?)').bind(companyId, measure, title, detail, i));
  const tpl = (await env.DB.prepare('SELECT code, title, body, sort FROM policy_templates ORDER BY sort').all()).results;
  for (const t of tpl) {
    stmts.push(env.DB.prepare('INSERT INTO policies (company_id, code, title, body, sort) VALUES (?,?,?,?,?)')
      .bind(companyId, t.code, t.title, t.body.replaceAll('{{firma}}', companyName), t.sort));
  }
  await env.DB.batch(stmts);
}
async function signup(req, env) {
  await hit(env, 'signup:' + ipOf(req), 10, H);
  const b = await body(req);
  const cui = validCui(b.cui); if (!cui) fail(400, 'CUI invalid. Verificați cifrele.');
  const name = str(b.company_name, 200); if (name.length < 2) fail(400, 'Completați numele firmei');
  const email = str(b.email, 200).toLowerCase(); if (!validEmail(email)) fail(400, 'Email invalid');
  const person = str(b.name, 120); if (person.length < 2) fail(400, 'Completați numele dumneavoastră');
  checkPassword(b.password);
  const role = b.role === 'conducere' ? 'conducere' : 'responsabil';
  if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) fail(409, 'Există deja un cont cu acest email');
  const pass = await hashPassword(b.password);
  const now = Date.now();
  const c = await env.DB.prepare('INSERT INTO companies (cui, name, incident_email, created_at) VALUES (?,?,?,?) RETURNING id').bind(cui, name, email, now).first();
  const us = await env.DB.prepare('INSERT INTO users (company_id, email, name, role, pass_hash, created_at) VALUES (?,?,?,?,?,?) RETURNING id')
    .bind(c.id, email, person, role, pass, now).first();
  await seedCompany(env, c.id, name);
  await audit(env, { company_id: c.id, id: us.id, name: person }, 'Firmă creată', name);
  return json({ token: await createSession(env, us.id, false), next: 'mfa_setup' }, 201);
}
async function join(req, env) {
  await hit(env, 'join:' + ipOf(req), 15, H);
  const b = await body(req);
  const code = str(b.code, 40).toUpperCase();
  const inv = await env.DB.prepare('SELECT * FROM invites WHERE code_hash = ? AND used_by IS NULL AND expires_at > ?').bind(await sha256(code), Date.now()).first();
  if (!inv) fail(400, 'Cod de invitație invalid sau expirat');
  const email = str(b.email, 200).toLowerCase(); if (!validEmail(email)) fail(400, 'Email invalid');
  const person = str(b.name, 120); if (person.length < 2) fail(400, 'Completați numele dumneavoastră');
  checkPassword(b.password);
  if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) fail(409, 'Există deja un cont cu acest email');
  const us = await env.DB.prepare('INSERT INTO users (company_id, email, name, role, pass_hash, created_at) VALUES (?,?,?,?,?,?) RETURNING id')
    .bind(inv.company_id, email, person, inv.role, await hashPassword(b.password), Date.now()).first();
  await env.DB.prepare('UPDATE invites SET used_by = ? WHERE code_hash = ?').bind(us.id, inv.code_hash).run();
  await audit(env, { company_id: inv.company_id, id: us.id, name: person }, 'Cont creat din invitație', inv.role);
  return json({ token: await createSession(env, us.id, false), next: mfaRequired({ role: inv.role }) ? 'mfa_setup' : 'app' }, 201);
}
async function login(req, env) {
  const b = await body(req);
  const email = str(b.email, 200).toLowerCase();
  await hit(env, 'login:' + email, 8, 15 * 60000);
  await hit(env, 'loginip:' + ipOf(req), 60, H);
  const u = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND active = 1').bind(email).first();
  // aceeasi durata si acelasi mesaj cand contul nu exista
  const ok = await verifyPassword(String(b.password || ''), u ? u.pass_hash : 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$x');
  if (!u || !ok) fail(401, 'Email sau parolă greșite');
  await clearLimit(env, 'login:' + email);
  const next = u.totp_on ? 'mfa_verify' : mfaRequired(u) ? 'mfa_setup' : 'app';
  return json({ token: await createSession(env, u.id, false), next });
}
async function mfa(req, env, action) {
  const u = await sessionUser(req, env);
  if (req.method !== 'POST') fail(405, 'Metodă invalidă');
  if (action === 'setup') {
    if (u.totp_on) fail(400, 'Autentificarea cu doi factori este deja activă');
    const secret = base32(crypto.getRandomValues(new Uint8Array(20)));
    await env.DB.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').bind(await seal(env, secret), u.id).run();
    const label = encodeURIComponent('Scut NIS2:' + u.email);
    return json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=Scut%20NIS2&digits=6&period=30` });
  }
  const b = await body(req);
  await hit(env, 'mfa:' + u.id, 8, 15 * 60000);
  if (action === 'enable') {
    if (u.totp_on) fail(400, 'Autentificarea cu doi factori este deja activă');
    if (!u.totp_secret) fail(400, 'Reluați configurarea');
    const step = await totpMatch(await unseal(env, u.totp_secret), str(b.code, 6), 0);
    if (!step) fail(400, 'Cod greșit. Verificați ora telefonului și încercați din nou.');
    const codes = Array.from({ length: 8 }, () => randomCode(12));
    const stmts = [env.DB.prepare('UPDATE users SET totp_on = 1, totp_last_step = ? WHERE id = ?').bind(step, u.id),
      env.DB.prepare('UPDATE sessions SET mfa_ok = 1 WHERE token_hash = ?').bind(u.token_hash)];
    for (const c of codes) stmts.push(env.DB.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?,?)').bind(u.id, await sha256(c)));
    await env.DB.batch(stmts);
    await clearLimit(env, 'mfa:' + u.id);
    await audit(env, u, 'Autentificare cu doi factori activată');
    return json({ ok: true, recovery_codes: codes });
  }
  if (action === 'verify') {
    if (!u.totp_on) fail(400, 'Autentificarea cu doi factori nu este activă');
    const code = str(b.code, 40).toUpperCase();
    let ok = false;
    if (/^\d{6}$/.test(code)) {
      const step = await totpMatch(await unseal(env, u.totp_secret), code, u.totp_last_step);
      if (step) { ok = true; await env.DB.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').bind(step, u.id).run(); }
    } else {
      const r = await env.DB.prepare('DELETE FROM recovery_codes WHERE user_id = ? AND code_hash = ? RETURNING 1 AS x').bind(u.id, await sha256(code)).first();
      if (r) { ok = true; await audit(env, u, 'Cod de recuperare folosit'); }
    }
    if (!ok) fail(400, 'Cod greșit');
    await env.DB.prepare('UPDATE sessions SET mfa_ok = 1 WHERE token_hash = ?').bind(u.token_hash).run();
    await clearLimit(env, 'mfa:' + u.id);
    return json({ ok: true });
  }
  fail(404, 'Nu există');
}
async function changePassword(req, env, u) {
  const b = await body(req);
  await hit(env, 'pw:' + u.id, 8, 15 * 60000);
  const row = await env.DB.prepare('SELECT pass_hash FROM users WHERE id = ?').bind(u.id).first();
  if (!await verifyPassword(String(b.old || ''), row.pass_hash)) fail(400, 'Parola actuală este greșită');
  checkPassword(b.new);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(b.new), u.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(u.id, u.token_hash),
  ]);
  await audit(env, u, 'Parolă schimbată');
  return json({ ok: true });
}
async function deleteAccount(req, env, u) {
  const b = await body(req);
  await hit(env, 'pw:' + u.id, 8, 15 * 60000);
  const row = await env.DB.prepare('SELECT pass_hash FROM users WHERE id = ?').bind(u.id).first();
  if (!await verifyPassword(String(b.password || ''), row.pass_hash)) fail(400, 'Parola este greșită');
  if (isManager(u)) {
    const others = (await managerIds(env, u.company_id)).filter((x) => x !== u.id);
    if (!others.length) fail(409, 'Sunteți singurul administrator. Numiți pe altcineva sau ștergeți firma.', 'last_manager');
  }
  await audit(env, u, 'Cont șters', u.email);
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(u.id).run();
  return json({ ok: true });
}

async function deleteCompanyData(env, C) {
  // foreign keys ON DELETE CASCADE sterg tot; le stergem si explicit, ca D1 sa nu depinda de PRAGMA
  const U = `(SELECT id FROM users WHERE company_id = ${Number(C)})`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE user_id IN ${U}`),
    env.DB.prepare(`DELETE FROM push_subs WHERE user_id IN ${U}`),
    env.DB.prepare(`DELETE FROM recovery_codes WHERE user_id IN ${U}`),
    env.DB.prepare(`DELETE FROM policy_reads WHERE policy_id IN (SELECT id FROM policies WHERE company_id = ?)`).bind(C),
    env.DB.prepare('DELETE FROM evidence WHERE company_id = ?').bind(C),
    env.DB.prepare('DELETE FROM incidents WHERE company_id = ?').bind(C),
    env.DB.prepare('DELETE FROM tasks WHERE company_id = ?').bind(C),
    env.DB.prepare('DELETE FROM policies WHERE company_id = ?').bind(C),
    env.DB.prepare('DELETE FROM invites WHERE company_id = ?').bind(C),
    env.DB.prepare('DELETE FROM report_links WHERE company_id = ?').bind(C),
    env.DB.prepare('DELETE FROM file_links WHERE company_id = ?').bind(C),
    env.DB.prepare('DELETE FROM audit_log WHERE company_id = ?').bind(C),
    env.DB.prepare('DELETE FROM users WHERE company_id = ?').bind(C),
    env.DB.prepare('DELETE FROM companies WHERE id = ?').bind(C),
  ]);
}

// ---------- firma ----------
async function company(req, env, u, action) {
  const m = req.method;
  if (!action && m === 'PUT') {
    needManager(u);
    const b = await body(req);
    const name = str(b.name, 200) || u.company.name;
    const mail = str(b.incident_email, 200).toLowerCase();
    if (mail && !validEmail(mail)) fail(400, 'Email invalid');
    await env.DB.prepare('UPDATE companies SET name = ?, incident_email = ? WHERE id = ?').bind(name, mail || u.company.incident_email, u.company_id).run();
    await audit(env, u, 'Date firmă modificate');
    return json({ ok: true });
  }
  if (!action && m === 'DELETE') {
    needManager(u);
    const b = await body(req);
    await hit(env, 'pw:' + u.id, 8, 15 * 60000);
    const row = await env.DB.prepare('SELECT pass_hash FROM users WHERE id = ?').bind(u.id).first();
    if (!await verifyPassword(String(b.password || ''), row.pass_hash)) fail(400, 'Parola este greșită');
    if (str(b.confirm, 200) !== u.company.name) fail(400, 'Scrieți exact numele firmei ca să confirmați');
    await deleteCompanyData(env, u.company_id);
    return json({ ok: true });
  }
  if (action === 'assess' && m === 'POST') {
    needManager(u);
    const b = await body(req);
    const r = classify({ sector: str(b.sector, 40), employees: str(b.employees, 10), turnover: str(b.turnover, 10), special: !!b.special });
    if (!r) fail(400, 'Completați toate câmpurile');
    await env.DB.prepare('UPDATE companies SET sector = ?, employees = ?, turnover = ?, special = ?, classification = ? WHERE id = ?')
      .bind(b.sector, b.employees, b.turnover, b.special ? 1 : 0, r.classification, u.company_id).run();
    await audit(env, u, 'Încadrare orientativă', r.title);
    return json(r);
  }
  if (action === 'plan' && m === 'POST') {
    needManager(u);
    const b = await body(req);
    const plan = b.plan;
    if (!['evaluare', 'firma', 'consultant'].includes(plan)) fail(400, 'Plan invalid');
    let trial = u.company.trial_until;
    if (!FREE_LAUNCH && plan !== 'evaluare' && !trial) trial = Date.now() + TRIAL_DAYS * 86400000; // o singura perioada de proba per firma
    await env.DB.prepare('UPDATE companies SET plan = ?, trial_until = ? WHERE id = ?').bind(plan, trial, u.company_id).run();
    await audit(env, u, plan === 'consultant' ? 'Acces consultant permis' : 'Acces consultant oprit', plan);
    return json({ ok: true, trial_until: trial });
  }
  fail(404, 'Nu există');
}

// ---------- panou si scor ----------
async function measureStats(env, companyId) {
  const rows = (await env.DB.prepare("SELECT measure, COUNT(*) AS total, SUM(status = 'finalizata') AS done FROM tasks WHERE company_id = ? GROUP BY measure").bind(companyId).all()).results;
  const by = Object.fromEntries(rows.map((r) => [r.measure, r]));
  const list = MEASURES.map((x) => {
    const r = by[x.id] || { total: 0, done: 0 };
    return { ...x, total: r.total, done: r.done || 0, pct: r.total ? Math.round(((r.done || 0) / r.total) * 100) : 0 };
  });
  const r = by.x || { total: 0, done: 0 };
  return {
    measures: list,
    base: { ...BASE_MEASURE, total: r.total, done: r.done || 0, pct: r.total ? Math.round(((r.done || 0) / r.total) * 100) : 0 },
    score: Math.round(list.reduce((n, x) => n + x.pct, 0) / list.length),
    counts: { complete: list.filter((x) => x.pct === 100).length, none: list.filter((x) => x.pct === 0).length, partial: list.filter((x) => x.pct > 0 && x.pct < 100).length },
  };
}
async function dashboard(env, u) {
  const C = u.company_id;
  const stats = await measureStats(env, C);
  const mine = u.role === 'angajat';
  const next = (await env.DB.prepare(
    `SELECT t.id, t.measure, t.title, t.due_on, us.name AS assignee FROM tasks t LEFT JOIN users us ON us.id = t.assignee_id
     WHERE t.company_id = ?1 AND t.status = 'deschisa' ${mine ? 'AND t.assignee_id = ?2' : ''}
     ORDER BY t.due_on IS NULL, t.due_on, t.sort LIMIT 5`).bind(...(mine ? [C, u.id] : [C])).all()).results;
  const open = (await env.DB.prepare(
    `SELECT * FROM incidents WHERE company_id = ?1 AND closed_at IS NULL ${mine ? 'AND reported_by = ?2' : ''} ORDER BY reported_at DESC LIMIT 5`)
    .bind(...(mine ? [C, u.id] : [C])).all()).results;
  const toApprove = u.role === 'conducere' ? (await env.DB.prepare("SELECT id, title FROM policies WHERE company_id = ? AND status = 'asteapta' ORDER BY sort").bind(C).all()).results : [];
  const toRead = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM policies p WHERE p.company_id = ? AND p.status = 'aprobata'
     AND NOT EXISTS (SELECT 1 FROM policy_reads r WHERE r.policy_id = p.id AND r.user_id = ? AND r.version = p.version)`).bind(C, u.id).first()).n;
  return json({
    company: companyOut(u.company), user: pub(u), ...(mine ? { score: null, measures: [], counts: null } : stats),
    next, incidents: open.map((i) => incidentOut(i, false)), to_approve: toApprove, to_read: toRead,
  });
}

// ---------- sarcini ----------
async function ownTask(env, u, id) {
  const t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').bind(id, u.company_id).first();
  if (!t) fail(404, 'Sarcina nu există');
  if (u.role === 'angajat' && t.assignee_id !== u.id) fail(403, 'Sarcina nu vă este atribuită');
  return t;
}
async function tasks(req, env, u, id) {
  const m = req.method;
  if (!id && m === 'GET') {
    const measure = new URL(req.url).searchParams.get('measure');
    const args = [u.company_id]; let q = `SELECT t.id, t.measure, t.title, t.due_on, t.status, t.assignee_id, us.name AS assignee,
      (SELECT COUNT(*) FROM evidence e WHERE e.task_id = t.id) AS evidence
      FROM tasks t LEFT JOIN users us ON us.id = t.assignee_id WHERE t.company_id = ?`;
    if (measure) { q += ' AND t.measure = ?'; args.push(measure); }
    if (u.role === 'angajat') { q += ' AND t.assignee_id = ?'; args.push(u.id); }
    return json({ items: (await env.DB.prepare(q + ' ORDER BY t.status, t.sort').bind(...args).all()).results });
  }
  if (!id && m === 'POST') {
    needManager(u);
    const b = await body(req);
    const title = str(b.title, 200); if (title.length < 3) fail(400, 'Completați titlul');
    const measure = [...MEASURES, BASE_MEASURE].some((x) => x.id === b.measure) ? b.measure : fail(400, 'Măsură invalidă');
    const r = await env.DB.prepare('INSERT INTO tasks (company_id, measure, title, detail, sort) VALUES (?,?,?,?,1000) RETURNING id').bind(u.company_id, measure, title, str(b.detail, 2000)).first();
    await audit(env, u, 'Sarcină adăugată', title);
    return json({ id: r.id }, 201);
  }
  const t = await ownTask(env, u, id);
  if (m === 'GET') {
    const files = (await env.DB.prepare('SELECT e.id, e.filename, e.mime, e.size, e.created_at, us.name AS by_name FROM evidence e LEFT JOIN users us ON us.id = e.uploaded_by WHERE e.task_id = ? AND e.company_id = ? ORDER BY e.id').bind(id, u.company_id).all()).results;
    const assignee = t.assignee_id ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(t.assignee_id).first() : null;
    return json({ ...t, assignee: assignee && assignee.name, files });
  }
  if (m === 'PUT') {
    const b = await body(req);
    const sets = []; const args = [];
    if ('status' in b) {
      if (!['deschisa', 'finalizata'].includes(b.status)) fail(400, 'Stare invalidă');
      const done = b.status === 'finalizata';
      sets.push('status = ?', 'done_at = ?', 'done_by = ?'); args.push(b.status, done ? Date.now() : null, done ? u.id : null);
    }
    if ('assignee_id' in b || 'due_on' in b) {
      needManager(u);
      if ('assignee_id' in b) {
        const a = b.assignee_id ? Number(b.assignee_id) : null;
        if (a && !await env.DB.prepare('SELECT 1 FROM users WHERE id = ? AND company_id = ? AND active = 1').bind(a, u.company_id).first()) fail(400, 'Persoană invalidă');
        sets.push('assignee_id = ?'); args.push(a);
      }
      if ('due_on' in b) {
        const d = b.due_on || null;
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(400, 'Dată invalidă');
        sets.push('due_on = ?'); args.push(d);
      }
    }
    if (!sets.length) fail(400, 'Nimic de modificat');
    await env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).bind(...args, id, u.company_id).run();
    await audit(env, u, b.status === 'finalizata' ? 'Sarcină finalizată' : b.status === 'deschisa' ? 'Sarcină redeschisă' : 'Sarcină modificată', t.title);
    return json({ ok: true });
  }
  fail(405, 'Metodă invalidă');
}

// ---------- dovezi ----------
async function evidence(req, env, u, url, id, linkAction) {
  const m = req.method;
  if (!id && m === 'POST') {
    const q = url.searchParams;
    const taskId = Number(q.get('task_id')) || null, incidentId = Number(q.get('incident_id')) || null;
    if (!!taskId === !!incidentId) fail(400, 'Alegeți sarcina sau incidentul');
    if (taskId) { needPaid(u); await ownTask(env, u, taskId); }
    if (incidentId) await ownIncident(env, u, incidentId);
    const mime = (req.headers.get('content-type') || '').split(';')[0].trim();
    if (!FILE_TYPES.includes(mime)) fail(415, 'Tip de fișier nepermis. Folosiți poze, PDF, Word sau Excel.');
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) fail(400, 'Fișier gol');
    if (buf.byteLength > MAX_FILE) fail(413, 'Fișierul depășește 1,9 MB');
    const filename = str(q.get('name'), 150).replace(/[\\/\r\n"]/g, '_') || 'dovada';
    const r = await env.DB.prepare('INSERT INTO evidence (company_id, task_id, incident_id, filename, mime, size, blob, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id')
      .bind(u.company_id, taskId, incidentId, filename, mime, buf.byteLength, buf, u.id, Date.now()).first();
    await audit(env, u, 'Dovadă adăugată', filename);
    return json({ id: r.id }, 201);
  }
  const e = await env.DB.prepare('SELECT id, company_id, task_id, incident_id, filename, mime, blob FROM evidence WHERE id = ? AND company_id = ?').bind(id, u.company_id).first();
  if (!e) fail(404, 'Fișierul nu există');
  if (e.task_id) await ownTask(env, u, e.task_id);
  if (e.incident_id) await ownIncident(env, u, e.incident_id);
  if (linkAction === 'link' && m === 'POST') {
    const token = randomHex();
    await env.DB.prepare('INSERT INTO file_links (token_hash, evidence_id, company_id, expires_at) VALUES (?,?,?,?)').bind(await sha256(token), id, u.company_id, Date.now() + 5 * 60000).run();
    await audit(env, u, 'Dovadă deschisă', e.filename);
    return json({ url: `${url.origin}/f/${token}` });
  }
  if (m === 'GET') {
    return new Response(new Uint8Array(e.blob), { headers: {
      'content-type': e.mime, 'content-disposition': `attachment; filename="${encodeURIComponent(e.filename)}"`,
      'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
    } });
  }
  if (m === 'DELETE') {
    needManager(u);
    await env.DB.prepare('DELETE FROM evidence WHERE id = ? AND company_id = ?').bind(id, u.company_id).run();
    await audit(env, u, 'Dovadă ștearsă', e.filename);
    return json({ ok: true });
  }
  fail(405, 'Metodă invalidă');
}

// ---------- echipa ----------
async function team(req, env, u, id, action) {
  needManager(u);
  const m = req.method;
  if (!id && m === 'GET') {
    const items = (await env.DB.prepare('SELECT id, email, name, role, totp_on, active FROM users WHERE company_id = ? ORDER BY active DESC, name').bind(u.company_id).all()).results;
    const pending = (await env.DB.prepare('SELECT role, label, expires_at FROM invites WHERE company_id = ? AND used_by IS NULL AND expires_at > ? ORDER BY expires_at').bind(u.company_id, Date.now()).all()).results;
    return json({ items: items.map((x) => ({ ...x, mfa: !!x.totp_on, totp_on: undefined })), pending });
  }
  const t = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND company_id = ?').bind(id, u.company_id).first();
  if (!t) fail(404, 'Persoana nu există');
  const others = (await managerIds(env, u.company_id)).filter((x) => x !== id);
  if (m === 'PUT') {
    const b = await body(req);
    const role = 'role' in b ? (ROLES.includes(b.role) ? b.role : fail(400, 'Rol invalid')) : t.role;
    const active = 'active' in b ? (b.active ? 1 : 0) : t.active;
    if (isManager(t) && (role === 'angajat' || !active) && !others.length) fail(409, 'Firma trebuie să rămână cu cel puțin un administrator');
    const stmts = [env.DB.prepare('UPDATE users SET role = ?, active = ? WHERE id = ?').bind(role, active, id)];
    if (!active) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
    await env.DB.batch(stmts);
    await audit(env, u, active ? 'Rol modificat' : 'Cont dezactivat', t.email + ' -> ' + role);
    return json({ ok: true });
  }
  if (action === 'reset' && m === 'POST') {
    // resetare fara email: administratorul primeste o parola temporara, pe care o transmite persoanei; MFA se reconfigureaza
    if (id === u.id) fail(400, 'Folosiți schimbarea parolei din cont');
    const temp = randomCode(16);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pass_hash = ?, totp_on = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?').bind(await hashPassword(temp), id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      env.DB.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(id),
    ]);
    await audit(env, u, 'Acces resetat', t.email);
    return json({ temp_password: temp });
  }
  fail(405, 'Metodă invalidă');
}
async function invites(req, env, u) {
  needManager(u); needPaid(u);
  if (req.method !== 'POST') fail(405, 'Metodă invalidă');
  await hit(env, 'inv:' + u.company_id, 100, 86400000);
  const b = await body(req);
  const role = ROLES.includes(b.role) ? b.role : 'angajat';
  const code = randomCode(12);
  const expires = Date.now() + 14 * 86400000;
  await env.DB.prepare('INSERT INTO invites (code_hash, company_id, role, label, created_by, expires_at) VALUES (?,?,?,?,?,?)')
    .bind(await sha256(code), u.company_id, role, str(b.label, 120), u.id, expires).run();
  await audit(env, u, 'Invitație creată', role);
  return json({ code, role, expires_at: expires }, 201);
}

// ---------- politici ----------
async function policies(req, env, u, id, action) {
  const m = req.method;
  needPaid(u);
  const mgr = isManager(u);
  if (!id && m === 'GET') {
    const staff = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND active = 1').bind(u.company_id).first()).n;
    const rows = (await env.DB.prepare(
      `SELECT p.id, p.code, p.title, p.status, p.version, p.approved_at,
        (SELECT COUNT(*) FROM policy_reads r JOIN users us ON us.id = r.user_id AND us.active = 1 WHERE r.policy_id = p.id AND r.version = p.version) AS reads,
        EXISTS (SELECT 1 FROM policy_reads r WHERE r.policy_id = p.id AND r.user_id = ?1 AND r.version = p.version) AS read_by_me
       FROM policies p WHERE p.company_id = ?2 ${mgr ? '' : "AND p.status = 'aprobata'"} ORDER BY p.sort`).bind(u.id, u.company_id).all()).results;
    return json({ items: rows, staff });
  }
  const p = await env.DB.prepare('SELECT * FROM policies WHERE id = ? AND company_id = ?').bind(id, u.company_id).first();
  if (!p || (!mgr && p.status !== 'aprobata')) fail(404, 'Politica nu există');
  if (!action && m === 'GET') {
    const by = p.approved_by ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(p.approved_by).first() : null;
    const read = await env.DB.prepare('SELECT 1 FROM policy_reads WHERE policy_id = ? AND user_id = ? AND version = ?').bind(id, u.id, p.version).first();
    return json({ ...p, approved_by_name: by && by.name, read_by_me: !!read });
  }
  if (!action && m === 'PUT') {
    needManager(u);
    const b = await body(req);
    const text = str(b.body, 60000); if (text.length < 20) fail(400, 'Textul este prea scurt');
    await env.DB.prepare("UPDATE policies SET body = ?, status = 'ciorna', version = version + 1, edited_by = ?, approved_by = NULL, approved_at = NULL WHERE id = ?").bind(text, u.id, id).run();
    await audit(env, u, 'Politică modificată', p.title);
    return json({ ok: true });
  }
  if (action === 'submit' && m === 'POST') {
    needManager(u);
    if (p.status === 'aprobata') fail(400, 'Politica este deja aprobată');
    await env.DB.prepare("UPDATE policies SET status = 'asteapta' WHERE id = ?").bind(id).run();
    await audit(env, u, 'Politică trimisă spre aprobare', p.title);
    const ids = (await env.DB.prepare("SELECT id FROM users WHERE company_id = ? AND role = 'conducere' AND active = 1").bind(u.company_id).all()).results.map((r) => r.id);
    await sendToUsers(env, ids, { title: 'Politică de aprobat', body: p.title, url: '/app/#politica/' + id, tag: 'politica-' + id }).catch(() => {});
    return json({ ok: true });
  }
  if (action === 'approve' && m === 'POST') {
    if (u.role !== 'conducere') fail(403, 'Doar conducerea poate aproba politicile');
    if (p.status !== 'asteapta') fail(400, 'Politica nu așteaptă aprobarea');
    await env.DB.prepare("UPDATE policies SET status = 'aprobata', approved_by = ?, approved_at = ? WHERE id = ?").bind(u.id, Date.now(), id).run();
    await audit(env, u, 'Politică aprobată', `${p.title}, versiunea ${p.version}`);
    return json({ ok: true });
  }
  if (action === 'read' && m === 'POST') {
    if (p.status !== 'aprobata') fail(400, 'Politica nu este aprobată');
    await env.DB.prepare('INSERT OR IGNORE INTO policy_reads (policy_id, user_id, version, read_at) VALUES (?,?,?,?)').bind(id, u.id, p.version, Date.now()).run();
    await audit(env, u, 'Politică citită', p.title);
    return json({ ok: true });
  }
  fail(405, 'Metodă invalidă');
}

// ---------- incidente ----------
function addMonth(ms) { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + 1); return d.getTime(); }
export function deadlines(i) {
  if (i.significant !== 1 || !i.aware_at) return null;
  const notif = i.aware_at + 72 * H;
  return { early: i.aware_at + 24 * H, notif, final: addMonth(i.notif_sent_at || notif) };
}
function incidentOut(i, full) {
  const out = { id: i.id, seq: i.seq, kind: i.kind, reported_at: i.reported_at, significant: i.significant, closed_at: i.closed_at,
    aware_at: i.aware_at, personal_data: i.personal_data, early_sent_at: i.early_sent_at, notif_sent_at: i.notif_sent_at, final_sent_at: i.final_sent_at,
    deadlines: deadlines(i) };
  if (full) {
    out.details = i.details; out.notes = i.notes;
    out.notified = i.notify_targets === null || i.notify_targets === undefined ? null : { targets: i.notify_targets, push: i.notify_push || 0, email: i.notify_email || 0 };
  }
  return out;
}
const MAIL_PER_HOUR = 10; // adresele nu sunt verificate la inregistrare: limitam ce poate declansa o firma
const within = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);
// Alerteaza responsabilii si adresa de incidente a firmei, pe notificare si pe e-mail, si noteaza ce a plecat de fapt.
// E-mailul nu contine detaliile incidentului; acestea raman in aplicatie.
async function alertIncident(env, incident, exceptUserId, msg, mailLines, ctx) {
  const all = (await env.DB.prepare("SELECT id, email, mfa_exempt FROM users WHERE company_id = ? AND active = 1 AND role IN ('responsabil','conducere')").bind(incident.company_id).all()).results;
  const others = all.filter((x) => x.id !== exceptUserId);
  const co = await env.DB.prepare('SELECT name, incident_email FROM companies WHERE id = ?').bind(incident.company_id).first();
  const skip = new Set(all.filter((x) => x.mfa_exempt || x.id === exceptUserId).map((x) => x.email.toLowerCase())); // firma demonstrativa si cel care raporteaza
  const box = String(co.incident_email || '').toLowerCase();
  const to = [...new Set([...others.map((x) => x.email.toLowerCase()), box].filter((x) => x && !skip.has(x)))];
  const recent = (await env.DB.prepare('SELECT COUNT(*) AS n FROM incidents WHERE company_id = ? AND reported_at > ?').bind(incident.company_id, Date.now() - H).first()).n;
  const pushing = sendToUsers(env, others.map((x) => x.id), msg).catch(() => ({ sent: 0 }));
  if (ctx) ctx.waitUntil(pushing); // daca depaseste asteptarea de mai jos, trimiterea continua
  const [p, email] = await Promise.all([
    within(pushing, 8000, { sent: 0 }),
    recent > MAIL_PER_HOUR ? 0 : sendMail(env, to, `${msg.title} - ${co.name}`, [`Firma: ${co.name}`, ...mailLines, '', 'Deschideți incidentul în aplicația Scut NIS2:', (env.APP_URL || 'https://nis2-app.flscarlat.workers.dev') + msg.url, '', 'Detaliile rămân în aplicație. Acest mesaj este o alertă internă și nu reprezintă o raportare către DNSC.'].join('\n')),
  ]);
  const sent = { targets: new Set([...others.map((x) => x.id), ...to]).size, push: p.sent || 0, email };
  await env.DB.prepare('UPDATE incidents SET notify_targets = MAX(COALESCE(notify_targets, 0), ?), notify_push = COALESCE(notify_push, 0) + ?, notify_email = COALESCE(notify_email, 0) + ? WHERE id = ?').bind(sent.targets, sent.push, sent.email, incident.id).run();
  return sent;
}
export function incidentDraft(i, companyName, cui) {
  const when = i.aware_at ? new Date(i.aware_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '[data și ora]';
  const lines = [`Firma: ${companyName} (CUI ${cui})`, `Constatat la: ${when}`, `Tipul incidentului: ${i.kind}`, `Descriere: ${i.details || '[completați]'}`];
  if (i.notes) lines.push(`Măsuri luate: ${i.notes}`); else lines.push('Măsuri luate: [completați]');
  lines.push('Suspiciune de act ilegal sau rău intenționat: [da/nu]', 'Posibil impact transfrontalier: [da/nu]', 'Date cu caracter personal afectate: ' + (i.personal_data ? 'da' : '[da/nu]'));
  return lines.join('\n');
}
async function ownIncident(env, u, id) {
  const i = await env.DB.prepare('SELECT * FROM incidents WHERE id = ? AND company_id = ?').bind(id, u.company_id).first();
  if (!i) fail(404, 'Incidentul nu există');
  if (!isManager(u) && i.reported_by !== u.id) fail(403, 'Nu aveți acces la acest incident');
  return i;
}
async function incidents(req, env, u, id, action, ctx) {
  const m = req.method;
  if (!id && m === 'GET') {
    const mine = !isManager(u);
    const rows = (await env.DB.prepare(`SELECT * FROM incidents WHERE company_id = ?1 ${mine ? 'AND reported_by = ?2' : ''} ORDER BY reported_at DESC LIMIT 100`).bind(...(mine ? [u.company_id, u.id] : [u.company_id])).all()).results;
    return json({ items: rows.map((i) => incidentOut(i, false)) });
  }
  if (!id && m === 'POST') {
    // raportarea ramane disponibila mereu, indiferent de abonament
    await hit(env, 'inc:' + u.id, 30, H);
    const b = await body(req);
    const kind = INCIDENT_KINDS.includes(b.kind) ? b.kind : fail(400, 'Alegeți tipul problemei');
    const n = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM incidents WHERE company_id = ?').bind(u.company_id).first();
    const r = await env.DB.prepare('INSERT INTO incidents (company_id, seq, kind, details, reported_by, reported_at) VALUES (?,?,?,?,?,?) RETURNING id')
      .bind(u.company_id, n.n, kind, str(b.details, 4000), u.id, Date.now()).first();
    await audit(env, u, 'Incident raportat', `#${n.n} ${kind}`);
    // Incidentul e deja salvat: o alerta esuata nu trebuie sa intoarca eroare celui care raporteaza.
    const notified = await alertIncident(env, { id: r.id, company_id: u.company_id }, u.id, { title: 'Incident raportat', body: `${kind}, raportat de ${u.name}. Evaluați-l acum.`, url: '/app/#incident/' + r.id, tag: 'incident-' + r.id }, [`Tip: ${kind}`, `Raportat de: ${u.name}`, 'Incidentul trebuie evaluat acum.'], ctx)
      .catch((e) => { console.log('alerta incident', String(e && e.message || e)); return { targets: 0, push: 0, email: 0, failed: true }; });
    return json({ id: r.id, seq: n.n, notified }, 201);
  }
  const i = await ownIncident(env, u, id);
  if (!action && m === 'GET') {
    const files = (await env.DB.prepare('SELECT id, filename, mime, size FROM evidence WHERE incident_id = ? AND company_id = ? ORDER BY id').bind(id, u.company_id).all()).results;
    const by = i.reported_by ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(i.reported_by).first() : null;
    const out = { ...incidentOut(i, true), reporter: by && by.name, files, reported_by_me: i.reported_by === u.id };
    if (isManager(u)) out.draft = incidentDraft(i, u.company.name, u.company.cui);
    return json(out);
  }
  needManager(u);
  if (!action && m === 'PUT') {
    const b = await body(req);
    const sets = [], args = [];
    if ('significant' in b) {
      const s = b.significant === null ? null : b.significant ? 1 : 0;
      sets.push('significant = ?', 'aware_at = ?');
      args.push(s, s === 1 ? (i.aware_at || Date.now()) : null);
    }
    if ('personal_data' in b) { sets.push('personal_data = ?'); args.push(b.personal_data ? 1 : 0); }
    if ('notes' in b) { sets.push('notes = ?'); args.push(str(b.notes, 4000)); }
    if ('details' in b) { sets.push('details = ?'); args.push(str(b.details, 4000)); }
    if (!sets.length) fail(400, 'Nimic de modificat');
    await env.DB.prepare(`UPDATE incidents SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).bind(...args, id, u.company_id).run();
    if ('significant' in b) await audit(env, u, b.significant ? 'Incident marcat semnificativ' : 'Incident marcat nesemnificativ', '#' + i.seq);
    else await audit(env, u, 'Incident actualizat', '#' + i.seq);
    return json({ ok: true });
  }
  if (action === 'mark' && m === 'POST') {
    const b = await body(req);
    const col = { early: 'early_sent_at', notif: 'notif_sent_at', final: 'final_sent_at' }[b.step];
    if (!col) fail(400, 'Pas invalid');
    if (i.significant !== 1) fail(400, 'Marcați întâi incidentul ca semnificativ');
    await env.DB.prepare(`UPDATE incidents SET ${col} = ? WHERE id = ? AND company_id = ?`).bind(b.undo ? null : Date.now(), id, u.company_id).run();
    await audit(env, u, b.undo ? 'Trimitere anulată' : 'Trimitere către DNSC marcată', `#${i.seq} ${b.step}`);
    return json({ ok: true });
  }
  if (action === 'close' && m === 'POST') {
    const b = await body(req);
    await env.DB.prepare('UPDATE incidents SET closed_at = ? WHERE id = ? AND company_id = ?').bind(b.reopen ? null : Date.now(), id, u.company_id).run();
    await audit(env, u, b.reopen ? 'Incident redeschis' : 'Incident închis', '#' + i.seq);
    return json({ ok: true });
  }
  fail(405, 'Metodă invalidă');
}

// ---------- raport ----------
async function reportLink(req, env, u, url) {
  needManager(u); needPaid(u);
  const token = randomHex();
  await env.DB.prepare('INSERT INTO report_links (token_hash, company_id, user_id, expires_at) VALUES (?,?,?,?)').bind(await sha256(token), u.company_id, u.id, Date.now() + 10 * 60000).run();
  await audit(env, u, 'Raport generat');
  return json({ url: `${url.origin}/r/${token}` });
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' }) : '-');
const CLASS_LABEL = { esentiala: 'Entitate esențială (orientativ)', importanta: 'Entitate importantă (orientativ)', neinclusa: 'Probabil neinclusă (orientativ)', verificare: 'De verificat' };
async function reportPage(env, token) {
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
  const bad = () => new Response('<!doctype html><meta charset="utf-8"><title>Raport</title><p>Linkul a expirat. Generați raportul din nou din aplicație.</p>', { status: 404, headers });
  if (!/^[a-f0-9]{64}$/.test(token)) return bad();
  const link = await env.DB.prepare('SELECT * FROM report_links WHERE token_hash = ? AND expires_at > ?').bind(await sha256(token), Date.now()).first();
  if (!link) return bad();
  const C = link.company_id;
  const c = await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(C).first();
  const s = await measureStats(env, C);
  const ev = (await env.DB.prepare('SELECT COUNT(*) AS n FROM evidence WHERE company_id = ?').bind(C).first()).n;
  const pol = (await env.DB.prepare('SELECT p.title, p.status, p.version, p.approved_at, us.name AS by_name FROM policies p LEFT JOIN users us ON us.id = p.approved_by WHERE p.company_id = ? ORDER BY p.sort').bind(C).all()).results;
  const inc = (await env.DB.prepare('SELECT * FROM incidents WHERE company_id = ? ORDER BY reported_at DESC LIMIT 100').bind(C).all()).results;
  const log = (await env.DB.prepare('SELECT user_label, action, target, at FROM audit_log WHERE company_id = ? ORDER BY id DESC LIMIT 100').bind(C).all()).results;
  const open = (await env.DB.prepare("SELECT measure, title, due_on FROM tasks WHERE company_id = ? AND status = 'deschisa' ORDER BY measure, sort").bind(C).all()).results;
  const st = { ciorna: 'Ciornă', asteapta: 'Așteaptă aprobarea', aprobata: 'Aprobată' };
  const html = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Raport NIS2 - ${esc(c.name)}</title>
<style>body{font:14px/1.45 Arial,Helvetica,sans-serif;color:#10202E;max-width:800px;margin:0 auto;padding:24px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #D8DEE5;vertical-align:top}th{background:#F3F5F7}.note{background:#E7F1F5;padding:12px;border-radius:6px;margin:16px 0}button{font:600 15px Arial,sans-serif;background:#0B4F6C;color:#fff;border:0;border-radius:8px;padding:12px 20px;cursor:pointer}@media print{.noprint{display:none}body{padding:0}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body>
<p class="noprint"><button id="print" type="button">Tipăriți sau salvați ca PDF</button></p>
<h1>Raport NIS2: ${esc(c.name)}</h1><p>CUI ${esc(c.cui)} · ${esc(CLASS_LABEL[c.classification] || 'Încadrare necompletată')} · generat la ${esc(fmtDate(Date.now()))}</p>
<p class="note">Raportul arată stadiul declarat de firmă și dovezile încărcate. Nu este o certificare și nu garantează conformitatea.</p>
<h2>Scor de pregătire: ${s.score}%</h2><table><tr><th>Art. 21(2)</th><th>Măsura</th><th>Sarcini finalizate</th><th>%</th></tr>
${s.measures.map((m) => `<tr><td>(${m.id})</td><td>${esc(m.full)}</td><td>${m.done} din ${m.total}</td><td>${m.pct}%</td></tr>`).join('')}</table>
<p>Dovezi atașate: <strong>${ev}</strong>. Obligații de bază: ${s.base.done} din ${s.base.total} finalizate.</p>
<h2>Sarcini deschise (${open.length})</h2><table><tr><th>Măsura</th><th>Sarcina</th><th>Termen</th></tr>${open.map((t) => `<tr><td>${esc(t.measure)}</td><td>${esc(t.title)}</td><td>${esc(t.due_on || '-')}</td></tr>`).join('')}</table>
<h2>Politici</h2><table><tr><th>Politica</th><th>Stare</th><th>Versiune</th><th>Aprobată de</th></tr>${pol.map((p) => `<tr><td>${esc(p.title)}</td><td>${esc(st[p.status])}</td><td>${p.version}</td><td>${p.approved_at ? esc(p.by_name) + ', ' + esc(fmtDate(p.approved_at)) : '-'}</td></tr>`).join('')}</table>
<h2>Incidente (${inc.length})</h2><table><tr><th>Nr.</th><th>Tip</th><th>Raportat</th><th>Semnificativ</th><th>Alertă 24h</th><th>Notificare 72h</th><th>Raport final</th></tr>${inc.map((i) => `<tr><td>${i.seq}</td><td>${esc(i.kind)}</td><td>${esc(fmtDate(i.reported_at))}</td><td>${i.significant === 1 ? 'Da' : i.significant === 0 ? 'Nu' : 'Neevaluat'}</td><td>${esc(fmtDate(i.early_sent_at))}</td><td>${esc(fmtDate(i.notif_sent_at))}</td><td>${esc(fmtDate(i.final_sent_at))}</td></tr>`).join('')}</table>
<h2>Jurnal de acțiuni (ultimele 100)</h2><table><tr><th>Când</th><th>Cine</th><th>Acțiune</th></tr>${log.map((l) => `<tr><td>${esc(fmtDate(l.at))}</td><td>${esc(l.user_label)}</td><td>${esc(l.action)}${l.target ? ': ' + esc(l.target) : ''}</td></tr>`).join('')}</table>
<script src="/raport.js"></script></body></html>`;
  return new Response(html, { headers });
}

async function filePage(env, token) {
  const none = () => new Response('Linkul a expirat.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  if (!/^[a-f0-9]{64}$/.test(token)) return none();
  const l = await env.DB.prepare('SELECT evidence_id, company_id FROM file_links WHERE token_hash = ? AND expires_at > ?').bind(await sha256(token), Date.now()).first();
  if (!l) return none();
  const e = await env.DB.prepare('SELECT filename, mime, blob FROM evidence WHERE id = ? AND company_id = ?').bind(l.evidence_id, l.company_id).first();
  if (!e) return none();
  const inline = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(e.mime);
  return new Response(new Uint8Array(e.blob), { headers: { 'content-type': e.mime, 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(e.filename)}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", 'referrer-policy': 'no-referrer' } });
}

// ---------- notificari ----------
async function push(req, env, u, action) {
  const m = req.method;
  if (action === 'key' && m === 'GET') return json({ key: env.VAPID_PUBLIC || null });
  if (action === 'sub' && m === 'POST') {
    const b = await body(req);
    const ep = str(b.endpoint, 800);
    if (!/^https:\/\//.test(ep) || !b.p256dh || !b.auth) fail(400, 'Abonament invalid');
    await env.DB.prepare('INSERT OR REPLACE INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?,?,?,?,?)').bind(ep, u.id, str(b.p256dh, 200), str(b.auth, 100), Date.now()).run();
    return json({ ok: true });
  }
  if (action === 'native' && m === 'POST') {
    const b = await body(req);
    const token = str(b.token, 300);
    if (!/^[A-Za-z0-9:_-]{20,}$/.test(token)) fail(400, 'Token invalid');
    const ep = (b.platform === 'android' ? 'fcm:' : 'apns:') + token;
    await env.DB.prepare('INSERT OR REPLACE INTO push_subs (endpoint, user_id, created_at) VALUES (?,?,?)').bind(ep, u.id, Date.now()).run();
    return json({ ok: true });
  }
  if (action === 'test' && m === 'POST') return json(await sendToUsers(env, [u.id], { title: 'Scut NIS2', body: 'Notificările funcționează.', url: '/app/', tag: 'test' }));
  fail(404, 'Nu există');
}
async function once(env, key) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO reminders_sent (key, at) VALUES (?,?)').bind(key, Date.now()).run();
  return r.meta.changes > 0;
}
export async function runReminders(env, now = Date.now()) {
  let sent = 0;
  const open = (await env.DB.prepare('SELECT * FROM incidents WHERE significant = 1 AND closed_at IS NULL').all()).results;
  const STEPS = [['early', 'early_sent_at', 'Alerta timpurie către DNSC'], ['notif', 'notif_sent_at', 'Notificarea incidentului'], ['final', 'final_sent_at', 'Raportul final']];
  for (const i of open) {
    const d = deadlines(i);
    for (const [step, col, label] of STEPS) {
      if (i[col]) continue;
      const left = d[step] - now;
      const marks = [[-Infinity, 0, 'a depășit termenul'], [0, H, 'mai aveți sub o oră'], [H, 4 * H, 'mai aveți sub 4 ore'], [4 * H, 12 * H, 'mai aveți sub 12 ore']];
      const hit = marks.find(([a, b]) => left > a && left <= b);
      if (hit && await once(env, `inc:${i.id}:${step}:${hit[1]}`)) {
        await alertIncident(env, i, null, { title: `Incident #${i.seq}: ${label}`, body: hit[2], url: '/app/#incident/' + i.id, tag: `incident-${i.id}-${step}` }, [`Pas: ${label}`, `Stare: ${hit[2]}`]).catch((e) => console.log('memento incident', String(e && e.message || e)));
        sent++;
      }
      break; // doar primul pas netrimis
    }
  }
  // incidente pe care nu le-a evaluat nimeni: alerta se repeta dupa 1, 4 si 24 de ore
  const waiting = (await env.DB.prepare('SELECT * FROM incidents WHERE significant IS NULL AND closed_at IS NULL').all()).results;
  for (const i of waiting) {
    const age = now - i.reported_at;
    const mark = [24, 4, 1].find((x) => age >= x * H);
    if (mark && await once(env, `inc:${i.id}:eval:${mark}`)) {
      await alertIncident(env, i, null, { title: `Incident #${i.seq} neevaluat`, body: `${i.kind}. Nu a fost evaluat de ${mark === 1 ? 'o oră' : mark + ' ore'}.`, url: '/app/#incident/' + i.id, tag: 'incident-' + i.id }, [`Tip: ${i.kind}`, `Nu a fost evaluat de ${mark === 1 ? 'o oră' : mark + ' ore'}.`]).catch((e) => console.log('memento evaluare', String(e && e.message || e)));
      sent++;
    }
  }
  if (await once(env, 'brevo:' + new Date(now).toISOString().slice(0, 7))) await brevoKeepAlive(env).catch(() => {});
  const today = new Date(now).toISOString().slice(0, 10);
  const soon = new Date(now + 3 * 86400000).toISOString().slice(0, 10);
  const due = (await env.DB.prepare("SELECT id, company_id, title, due_on, assignee_id FROM tasks WHERE status = 'deschisa' AND due_on IS NOT NULL AND due_on <= ? LIMIT 200").bind(soon).all()).results;
  for (const t of due) {
    const late = t.due_on < today;
    if (await once(env, `task:${t.id}:${t.due_on}:${late ? 'late' : 'soon'}`)) {
      const to = t.assignee_id ? [t.assignee_id] : await managerIds(env, t.company_id);
      await sendToUsers(env, to, { title: late ? 'Sarcină întârziată' : 'Sarcină cu termen apropiat', body: `${t.title} (${t.due_on})`, url: '/app/#sarcina/' + t.id, tag: 'task-' + t.id }).catch(() => {});
      sent++;
    }
  }
  await env.DB.prepare('DELETE FROM report_links WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare('DELETE FROM file_links WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(now).run();
  return { sent };
}

// ---------- panou NCS: doar firmele care au ales planul cu consultant ----------
async function panel(env, u, what, id) {
  if (u.role !== 'consultant') fail(403, 'Doar pentru consultanți');
  if (what !== 'companies') fail(404, 'Nu există');
  const now = Date.now();
  const scope = FREE_LAUNCH ? "plan = 'consultant' AND ?1 > 0" : "plan = 'consultant' AND (COALESCE(paid_until,0) > ?1 OR COALESCE(trial_until,0) > ?1)";
  if (!id) {
    const rows = (await env.DB.prepare(`SELECT id, name, cui, classification, trial_until, paid_until FROM companies WHERE ${scope} ORDER BY name`).bind(now).all()).results;
    const today = new Date(now).toISOString().slice(0, 10);
    const items = [];
    for (const c of rows) {
      const s = await measureStats(env, c.id);
      const late = (await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE company_id = ? AND status = 'deschisa' AND due_on < ?").bind(c.id, today).first()).n;
      const open = (await env.DB.prepare('SELECT COUNT(*) AS n FROM incidents WHERE company_id = ? AND closed_at IS NULL').bind(c.id).first()).n;
      items.push({ ...c, score: s.score, late, open_incidents: open });
    }
    return json({ items });
  }
  const c = await env.DB.prepare(`SELECT * FROM companies WHERE id = ?2 AND ${scope}`).bind(now, id).first();
  if (!c) fail(404, 'Firma nu există sau nu a ales planul cu consultant');
  await audit(env, { company_id: id, id: u.id, name: 'Consultant: ' + u.name }, 'Date consultate de consultant');
  const s = await measureStats(env, id);
  const open = (await env.DB.prepare("SELECT measure, title, due_on FROM tasks WHERE company_id = ? AND status = 'deschisa' ORDER BY due_on IS NULL, due_on, sort LIMIT 50").bind(id).all()).results;
  const inc = (await env.DB.prepare('SELECT * FROM incidents WHERE company_id = ? ORDER BY reported_at DESC LIMIT 30').bind(id).all()).results;
  return json({ company: companyOut(c), ...s, open_tasks: open, incidents: inc.map((i) => incidentOut(i, false)) });
}

// Cont demonstrativ pentru verificarea Apple: fara MFA, cu date de exemplu. Se recreeaza la fiecare apel.
async function demoCompany(env) {
  const email = 'review@nis2-demo.ro', staffMail = 'angajat@nis2-demo.ro';
  const old = await env.DB.prepare('SELECT company_id FROM users WHERE email = ?').bind(email).first();
  if (old) await deleteCompanyData(env, old.company_id);
  const password = randomCode(16), now = Date.now(), name = 'Firma Demo SRL';
  const c = await env.DB.prepare("INSERT INTO companies (cui, name, sector, employees, turnover, classification, plan, incident_email, created_at) VALUES ('14399840',?,'alimentar','50-249','10-50','importanta','firma',?,?) RETURNING id").bind(name, email, now).first();
  const mk = async (mail, who, role) => (await env.DB.prepare('INSERT INTO users (company_id, email, name, role, pass_hash, mfa_exempt, created_at) VALUES (?,?,?,?,?,1,?) RETURNING id').bind(c.id, mail, who, role, await hashPassword(password), now).first()).id;
  const boss = await mk(email, 'Andrei Popescu', 'conducere');
  const staff = await mk(staffMail, 'Maria Ionescu', 'angajat');
  await seedCompany(env, c.id, name);
  const day = (n) => new Date(now + n * 86400000).toISOString().slice(0, 10);
  const stmts = [];
  for (const [title, due] of [['Activați MFA pentru administratori', 2], ['Testați restaurarea din backup', 6], ['Faceți lista furnizorilor critici', 12]]) stmts.push(env.DB.prepare('UPDATE tasks SET due_on = ?, assignee_id = ? WHERE company_id = ? AND title = ?').bind(day(due), boss, c.id, title));
  for (const m of ['a', 'b', 'g', 'h', 'i']) stmts.push(env.DB.prepare("UPDATE tasks SET status = 'finalizata', done_at = ?, done_by = ? WHERE company_id = ? AND id IN (SELECT id FROM tasks WHERE company_id = ? AND measure = ? ORDER BY sort LIMIT 2)").bind(now, boss, c.id, c.id, m));
  stmts.push(env.DB.prepare("UPDATE policies SET status = 'aprobata', approved_by = ?, approved_at = ? WHERE company_id = ? AND sort < 4").bind(boss, now, c.id));
  stmts.push(env.DB.prepare("UPDATE policies SET status = 'asteapta' WHERE company_id = ? AND sort = 4").bind(c.id));
  stmts.push(env.DB.prepare("INSERT INTO incidents (company_id, seq, kind, details, reported_by, reported_at, significant, aware_at) VALUES (?, 1, 'Email suspect', 'Am primit un e-mail cu o factură și am deschis atașamentul.', ?, ?, 1, ?)").bind(c.id, staff, now - 5 * 3600000, now - 5 * 3600000));
  await env.DB.batch(stmts);
  await audit(env, { company_id: c.id, id: boss, name: 'Andrei Popescu' }, 'Firmă demonstrativă creată');
  return json({ email, staff_email: staffMail, password });
}

// ---------- administrare prin cheie (doar din uneltele locale) ----------
async function ops(req, env, parts) {
  const key = req.headers.get('x-ops-key') || '';
  await hit(env, 'ops:' + ipOf(req), 60, H);
  if (!env.OPS_KEY || !safeEqual(await sha256(key), await sha256(env.OPS_KEY.trim()))) fail(403, 'Interzis');
  const b = await body(req);
  if (parts[0] === 'templates') {
    if (!Array.isArray(b.items) || !b.items.length) fail(400, 'Lipsesc modelele');
    await env.DB.batch(b.items.map((t, i) => env.DB.prepare('INSERT OR REPLACE INTO policy_templates (code, title, measure, body, sort) VALUES (?,?,?,?,?)').bind(str(t.code, 20), str(t.title, 200), str(t.measure, 2), String(t.body), i)));
    return json({ ok: true, count: b.items.length });
  }
  if (parts[0] === 'consultant') {
    const email = str(b.email, 200).toLowerCase(); if (!validEmail(email)) fail(400, 'Email invalid');
    const temp = randomCode(16);
    await env.DB.prepare('INSERT INTO users (company_id, email, name, role, pass_hash, created_at) VALUES (NULL,?,?,?,?,?)').bind(email, str(b.name, 120) || email, 'consultant', await hashPassword(temp), Date.now()).run();
    return json({ email, temp_password: temp });
  }
  if (parts[0] === 'demo') return demoCompany(env);
  if (parts[0] === 'paid') {
    const until = Number(b.until);
    if (!until) fail(400, 'Dată invalidă');
    await env.DB.prepare('UPDATE companies SET paid_until = ? WHERE id = ?').bind(until, Number(b.company_id)).run();
    return json({ ok: true });
  }
  if (parts[0] === 'reset') {
    const email = str(b.email, 200).toLowerCase();
    const u = await env.DB.prepare('SELECT id, company_id, name FROM users WHERE email = ?').bind(email).first();
    if (!u) fail(404, 'Contul nu există');
    const temp = randomCode(16);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pass_hash = ?, totp_on = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?').bind(await hashPassword(temp), u.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
      env.DB.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(u.id),
    ]);
    await audit(env, { company_id: u.company_id, name: 'Suport' }, 'Acces resetat de suport', email);
    return json({ temp_password: temp });
  }
  if (parts[0] === 'reminders') return json(await runReminders(env, Number(b.now) || Date.now()));
  fail(404, 'Nu există');
}
