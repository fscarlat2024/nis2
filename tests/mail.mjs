// Trimiterea de e-mail cu Brevo simulat, fara retea. node tests/mail.mjs
import { sendMail, mailReady } from '../src/mail.js';
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
console.log = log;
console.log(fails ? `${fails} GRESITE` : 'toate au trecut');
process.exit(fails ? 1 : 0);
