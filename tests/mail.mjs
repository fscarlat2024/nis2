// Trimiterea de e-mail cu Brevo simulat, fara retea. node tests/mail.mjs
import { sendMail, mailReady, sendCompanyMail } from '../src/mail.js';
import { sendSmtp } from '../src/smtp.js';
let fails = 0;
const ok = (c, name, extra = '') => { console.log((c ? 'OK   ' : 'FAIL ') + name + (c ? '' : ' ' + extra)); if (!c) fails++; };
const env = { BREVO_API_KEY: '﻿cheie \n', MAIL_FROM: 'alerte@test.ro' };
const calls = [];
globalThis.fetch = async (url, o) => {
  const b = JSON.parse(o.body); calls.push({ url, o, b });
  if (b.to[0].email === 'exc@test.ro') throw new Error('retea');
  return new Response('{}', { status: b.to[0].email === 'refuz@test.ro' ? 400 : 201 });
};
const log = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('brevo')) log(...a); };

ok(mailReady(env) && !mailReady({ MAIL_FROM: 'a@b.ro' }) && !mailReady({ BREVO_API_KEY: 'x' }), 'cere cheie si expeditor');
ok(await sendMail({}, ['a@test.ro'], 's', 't') === 0 && calls.length === 0, 'fara cheie nu trimite');
ok(await sendMail(env, [], 's', 't') === 0 && calls.length === 0, 'fara destinatari nu trimite');
ok(await sendMail(env, ['a@test.ro', 'b@test.ro'], 'Linia 1\r\nBcc: x@y.ro', 'text') === 2, 'numara acceptate');
const c = calls[0];
ok(calls.length === 2 && c.b.to.length === 1, 'cate un mesaj pe destinatar');
ok(c.o.headers['api-key'] === 'cheie', 'curata BOM si spatii din cheie', JSON.stringify(c.o.headers['api-key']));
ok(!/[\r\n]/.test(c.b.subject), 'subiect fara linii noi', c.b.subject);
ok(c.b.sender.email === 'alerte@test.ro' && c.b.textContent === 'text', 'expeditor si text');
ok(await sendMail(env, ['a@test.ro', 'refuz@test.ro', 'exc@test.ro'], 's', 't') === 1, 'refuzurile si erorile nu se numara');

// --- SMTP cu server simulat
function fakeServer(script) {
  // script: functie (comanda) => raspuns text; inregistreaza tot ce primeste serverul
  const seen = [], enc = new TextEncoder(), dec = new TextDecoder();
  const pipe = (out) => {
    let ctl;
    const readable = new ReadableStream({ start(c) { ctl = c; if (out.greet) c.enqueue(enc.encode(out.greet)); } });
    const writable = new WritableStream({ write(chunk) {
      const cmd = dec.decode(chunk).replace(/\r\n$/, ''); seen.push({ cmd, secure: out.secure });
      const r = script(cmd, out.secure); if (r) ctl.enqueue(enc.encode(r));
    } });
    return { readable, writable };
  };
  const connectFn = (addr, opts) => {
    seen.opts = opts; seen.addr = addr;
    const s = pipe({ greet: '220 test\r\n', secure: opts.secureTransport === 'on' });
    s.close = async () => {};
    s.startTls = () => { seen.tls = true; const t = pipe({ secure: true }); t.close = async () => {}; return t; };
    return s;
  };
  return { seen, connectFn };
}
const happy = (cmd, secure) => {
  if (cmd.startsWith('EHLO')) return secure ? '250-test\r\n250 AUTH PLAIN LOGIN\r\n' : '250-test\r\n250 STARTTLS\r\n';
  if (cmd === 'STARTTLS') return '220 go\r\n';
  if (cmd.startsWith('AUTH')) return '235 ok\r\n';
  if (cmd.startsWith('MAIL') || cmd.startsWith('RCPT')) return '250 ok\r\n';
  if (cmd === 'DATA') return '354 go\r\n';
  if (cmd.endsWith('\r\n.')) return '250 ok\r\n';
  return '221 bye\r\n';
};
const cfg = { host: 'smtp.test.ro', port: 587, user: 'a@test.ro', pass: 'secret-parola', from: 'a@test.ro' };
const kindOf = async (p) => { try { await p; return null; } catch (e) { return e.kind; } };
const plain = (s) => s.cmd.startsWith('AUTH') || s.cmd.startsWith('MAIL');

let srv = fakeServer(happy);
ok(await kindOf(sendSmtp(cfg, 'b@test.ro', 'Subiect ă', 'Text ț\nlinia 2', { connectFn: srv.connectFn })) === null, 'trimite prin 587');
ok(srv.seen.tls === true && srv.seen.filter(plain).every((s) => s.secure), 'autentificarea doar dupa TLS');
ok(srv.seen.opts.secureTransport === 'starttls', 'port 587 foloseste STARTTLS');
const auth = srv.seen.find((s) => s.cmd.startsWith('AUTH')).cmd;
ok(atob(auth.slice(11)) === '\0a@test.ro\0secret-parola', 'AUTH PLAIN corect');
const msg = srv.seen.find((s) => s.cmd.endsWith('\r\n.')).cmd;
ok(/^From: "Scut NIS2" <a@test.ro>\r\n/.test(msg) && /Subject: =\?UTF-8\?B\?/.test(msg) && /charset=UTF-8/.test(msg), 'mesaj bine format');
ok(new TextDecoder().decode(Uint8Array.from(atob(msg.split('\r\n\r\n')[1].replace(/\r\n\.$/, '').replace(/\r\n/g, '')), (c) => c.charCodeAt(0))) === 'Text ț\r\nlinia 2', 'text UTF-8 pastrat');

srv = fakeServer(happy);
ok(await kindOf(sendSmtp({ ...cfg, port: 465 }, 'b@test.ro', 's', 't', { connectFn: srv.connectFn })) === null && srv.seen.opts.secureTransport === 'on' && !srv.seen.tls, 'port 465 foloseste TLS direct');

srv = fakeServer((c, s) => (c.startsWith('EHLO') ? '250-test\r\n250 AUTH PLAIN\r\n' : happy(c, s)));
ok(await kindOf(sendSmtp(cfg, 'b@test.ro', 's', 't', { connectFn: srv.connectFn })) === 'tls' && !srv.seen.some((s) => s.cmd.startsWith('AUTH')), 'fara STARTTLS parola nu pleaca');

srv = fakeServer((c, s) => (c === 'STARTTLS' ? '220 go\r\n250 injectat\r\n' : happy(c, s)));
ok(await kindOf(sendSmtp(cfg, 'b@test.ro', 's', 't', { connectFn: srv.connectFn })) === 'tls', 'refuza comenzi injectate inainte de TLS');

srv = fakeServer((c, s) => (c.startsWith('AUTH') ? '535 nu\r\n' : happy(c, s)));
ok(await kindOf(sendSmtp(cfg, 'b@test.ro', 's', 't', { connectFn: srv.connectFn })) === 'auth', 'parola gresita');

srv = fakeServer((c, s) => (c.startsWith('RCPT') ? '550 nu\r\n' : happy(c, s)));
ok(await kindOf(sendSmtp(cfg, 'b@test.ro', 's', 't', { connectFn: srv.connectFn })) === 'reject', 'destinatar refuzat');

srv = fakeServer(() => null);
ok(await kindOf(sendSmtp(cfg, 'b@test.ro', 's', 't', { connectFn: srv.connectFn, timeoutMs: 50 })) === 'timeout', 'server tacut');
ok(await kindOf(sendSmtp(cfg, 'b@test.ro>\r\nRCPT TO:<x@y.ro', 's', 't', { connectFn: fakeServer(happy).connectFn })) === 'reject', 'adresa cu injectare refuzata');
ok(await kindOf(sendSmtp(cfg, 'b@test.ro', 's', 't', { connectFn: () => { throw new Error('nu'); } })) === 'connect', 'conexiune esuata');

// --- contul firmei, cu rezerva
srv = fakeServer(happy); calls.length = 0;
let r = await sendCompanyMail(env, cfg, ['b@test.ro'], 's', 't', { connectFn: srv.connectFn });
ok(r.sent === 1 && r.failed === 0 && calls.length === 0, 'contul firmei e folosit primul', JSON.stringify(r));
calls.length = 0;
r = await sendCompanyMail(env, cfg, ['b@test.ro'], 's', 't', { connectFn: () => { throw new Error('nu'); } });
ok(r.sent === 1 && r.failed === 1 && calls.length === 1, 'daca pica, pleaca prin expeditorul implicit', JSON.stringify(r));
r = await sendCompanyMail({}, cfg, ['b@test.ro'], 's', 't', { connectFn: () => { throw new Error('nu'); } });
ok(r.sent === 0 && r.failed === 1, 'fara rezerva spune ca nu a plecat', JSON.stringify(r));
calls.length = 0;
r = await sendCompanyMail(env, null, ['b@test.ro'], 's', 't');
ok(r.sent === 1 && calls.length === 1, 'fara cont foloseste expeditorul implicit', JSON.stringify(r));

console.log = log;
console.log(fails ? `${fails} GRESITE` : 'toate au trecut');
process.exit(fails ? 1 : 0);
