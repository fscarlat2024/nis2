// E-mailuri de alerta prin Brevo (secretul BREVO_API_KEY, expeditor MAIL_FROM autentificat in Brevo).
// Fara cheie sau expeditor nu pleaca nimic, iar functia intoarce 0: aplicatia afiseaza ce s-a trimis de fapt.
import { sendSmtp } from './smtp.js';

const brevoKey = (env) => String(env.BREVO_API_KEY || '').replace(/^﻿/, '').trim();

export const mailReady = (env) => !!(brevoKey(env) && env.MAIL_FROM);

// Cate un mesaj pe destinatar, ca adresele sa nu se vada intre ele. Intoarce cate au fost acceptate de Brevo.
export async function sendMail(env, to, subject, text) {
  if (!mailReady(env) || !to.length) return 0;
  const one = async (email) => {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevoKey(env), accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ sender: { name: 'Scut NIS2', email: env.MAIL_FROM }, to: [{ email }], subject: String(subject).replace(/[\r\n]+/g, ' '), textContent: text }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) console.log('brevo ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return r.ok ? 1 : 0;
    } catch (e) { console.log('brevo exc', String(e && e.message || e)); return 0; }
  };
  return (await Promise.all(to.map(one))).reduce((a, b) => a + b, 0);
}

// Cu contul firmei, daca e configurat; ce nu pleaca prin el incearca expeditorul implicit, ca alerta sa nu se piarda.
export async function sendCompanyMail(env, account, to, subject, text, smtpOptions) {
  if (!account) return { sent: await sendMail(env, to, subject, text), failed: 0 };
  const results = await Promise.all(to.map((email) => sendSmtp(account, email, subject, text, smtpOptions).then(() => null, (e) => {
    console.log('smtp firma', e.kind);
    return email;
  })));
  const left = results.filter(Boolean);
  return { sent: to.length - left.length + await sendMail(env, left, subject, text), failed: left.length };
}

// Brevo dezactiveaza cheile nefolosite 90 de zile, iar o firma fara incidente poate sta atat fara e-mailuri.
export async function brevoKeepAlive(env) {
  if (!brevoKey(env)) return;
  const r = await fetch('https://api.brevo.com/v3/smtp/templates?limit=1', { headers: { 'api-key': brevoKey(env), accept: 'application/json' } });
  if (!r.ok) console.log('brevo keepalive ' + r.status);
}
