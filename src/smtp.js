// Trimitere prin contul de e-mail al firmei (SMTP). Criptarea e obligatorie: 465 = TLS direct, 587 = STARTTLS.
// Parola nu pleaca niciodata pe o conexiune necriptata si nu se scrie in loguri.
export class SmtpError extends Error {
  constructor(kind, detail) { super(detail || kind); this.kind = kind; } // connect, tls, auth, reject, timeout
}
const realConnect = async (...a) => (await import('cloudflare:sockets')).connect(...a);
const b64 = (s) => { let o = ''; for (const c of new TextEncoder().encode(s)) o += String.fromCharCode(c); return btoa(o); };
const SAFE_ADDR = /^[^\s<>@,;:"]+@[^\s<>@,;:"]+$/;

export function buildMessage(from, to, subject, text, now = new Date()) {
  const body = b64(String(text).replace(/\r?\n/g, '\r\n')).replace(/(.{76})/g, '$1\r\n');
  const domain = from.split('@')[1];
  return [
    `From: "Scut NIS2" <${from}>`, `To: <${to}>`,
    `Subject: =?UTF-8?B?${b64(String(subject).replace(/[\r\n]+/g, ' '))}?=`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body,
  ].join('\r\n');
}

function wire(sock) {
  const r = sock.readable.getReader(), w = sock.writable.getWriter(), dec = new TextDecoder(), enc = new TextEncoder();
  let buf = '';
  return {
    async reply() {
      const lines = [];
      for (;;) {
        let i;
        while ((i = buf.indexOf('\n')) < 0) {
          const { value, done } = await r.read();
          if (done) throw new SmtpError('connect', 'conexiune inchisa');
          buf += dec.decode(value, { stream: true });
          if (buf.length > 65536) throw new SmtpError('connect', 'raspuns prea lung');
        }
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); lines.push(line);
        if (/^\d{3}( |$)/.test(line)) return { code: Number(line.slice(0, 3)), lines };
        if (!/^\d{3}-/.test(line)) throw new SmtpError('connect', 'raspuns invalid');
      }
    },
    send: (s) => w.write(enc.encode(s + '\r\n')),
    pending: () => buf.length,
    release() { r.releaseLock(); w.releaseLock(); },
  };
}
async function dialog(cfg, to, message, connectFn, keep) {
  const starttls = cfg.port === 587;
  let sock;
  try { sock = await connectFn({ hostname: cfg.host, port: cfg.port }, { secureTransport: starttls ? 'starttls' : 'on', allowHalfOpen: false }); }
  catch (e) { throw new SmtpError('connect', String(e && e.message || e)); }
  keep(sock);
  let io = wire(sock);
  const ask = async (cmd, ok, kind = 'reject') => {
    await io.send(cmd);
    const r = await io.reply();
    if (!ok.includes(r.code)) throw new SmtpError(kind, 'cod ' + r.code);
    return r;
  };
  const greet = await io.reply();
  if (greet.code !== 220) throw new SmtpError('connect', 'cod ' + greet.code);
  let ehlo = await ask('EHLO scut-nis2', [250]);
  if (starttls) {
    if (!ehlo.lines.some((l) => /^250[ -]STARTTLS\b/i.test(l))) throw new SmtpError('tls', 'serverul nu ofera STARTTLS');
    await ask('STARTTLS', [220], 'tls');
    if (io.pending()) throw new SmtpError('tls', 'date neasteptate inainte de TLS'); // injectare de comenzi
    io.release();
    try { sock = sock.startTls(); } catch (e) { throw new SmtpError('tls', String(e && e.message || e)); }
    keep(sock);
    io = wire(sock);
    ehlo = await ask('EHLO scut-nis2', [250]);
  }
  const auth = ehlo.lines.find((l) => /^250[ -]AUTH\b/i.test(l)) || '';
  if (/\bPLAIN\b/i.test(auth)) {
    await ask('AUTH PLAIN ' + b64(`\0${cfg.user}\0${cfg.pass}`), [235], 'auth');
  } else if (/\bLOGIN\b/i.test(auth)) {
    await ask('AUTH LOGIN', [334], 'auth');
    await ask(b64(cfg.user), [334], 'auth');
    await ask(b64(cfg.pass), [235], 'auth');
  } else throw new SmtpError('auth', 'serverul nu ofera o autentificare acceptata');
  await ask(`MAIL FROM:<${cfg.from}>`, [250]);
  await ask(`RCPT TO:<${to}>`, [250, 251]);
  await ask('DATA', [354]);
  await ask(message + '\r\n.', [250]);
  await io.send('QUIT').catch(() => {});
}
export async function sendSmtp(cfg, to, subject, text, { connectFn = realConnect, timeoutMs = 8000 } = {}) {
  if (!SAFE_ADDR.test(to) || !SAFE_ADDR.test(cfg.from)) throw new SmtpError('reject', 'adresa invalida');
  let sock, timer;
  const close = () => { try { if (sock) sock.close().catch(() => {}); } catch {} };
  const timeout = new Promise((_, no) => { timer = setTimeout(() => no(new SmtpError('timeout', 'fara raspuns')), timeoutMs); });
  try {
    await Promise.race([dialog(cfg, to, buildMessage(cfg.from, to, subject, text), connectFn, (s) => { sock = s; }), timeout]);
  } catch (e) {
    throw e instanceof SmtpError ? e : new SmtpError('connect', String(e && e.message || e));
  } finally { clearTimeout(timer); close(); }
}
