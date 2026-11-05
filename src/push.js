// Scut NIS2 - notificari push (preluat din Quadratree)
// Web Push (VAPID + aes128gcm, RFC 8291/8292) pentru browser/PWA,
// APNs (iOS nativ, endpoint "apns:<token>") si FCM (Android nativ, endpoint "fcm:<token>").
// Secrete: VAPID_PUBLIC, VAPID_PRIVATE_JWK; optional APNS_KEY/APNS_KEY_ID/APNS_TEAM_ID/APNS_TOPIC, FCM_SA.

const enc = new TextEncoder();
const stripBom = (s) => String(s).replace(/^﻿/, '').trim();

function b64uToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function bytesToB64u(b) {
  let bin = '';
  for (const x of new Uint8Array(b)) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// ---------- Web Push ----------
async function vapidAuthHeader(env, endpoint) {
  const jwk = JSON.parse(stripBom(env.VAPID_PRIVATE_JWK));
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: 'mailto:' + (env.SERVICE_MAILBOX || 'suport@netcomm.ro'),
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + claims));
  return 'vapid t=' + head + '.' + claims + '.' + bytesToB64u(sig) + ', k=' + stripBom(env.VAPID_PUBLIC);
}
async function encryptPush(sub, payloadText) {
  const uaPub = b64uToBytes(sub.p256dh), authSecret = b64uToBytes(sub.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concatBytes(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concatBytes(enc.encode(payloadText), new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPub.length;
  return concatBytes(header, asPub, ct);
}

// ---------- APNs (aplicatia iOS) ----------
let apnsJwtCache = { token: '', at: 0 };
async function apnsJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwtCache.token && now - apnsJwtCache.at < 40 * 60) return apnsJwtCache.token;
  const pem = stripBom(env.APNS_KEY).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = bytesToB64u(enc.encode(JSON.stringify({ alg: 'ES256', kid: stripBom(env.APNS_KEY_ID) })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({ iss: stripBom(env.APNS_TEAM_ID), iat: now })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + claims));
  apnsJwtCache = { token: head + '.' + claims + '.' + bytesToB64u(sig), at: now };
  return apnsJwtCache.token;
}
async function sendApns(env, token, msg) {
  const body = { aps: { alert: { title: msg.title, body: msg.body || '' }, sound: 'default' }, url: msg.url || '/app/' };
  if (msg.tag) body.aps['thread-id'] = String(msg.tag);
  return fetch('https://api.push.apple.com/3/device/' + token, {
    method: 'POST',
    headers: { authorization: 'bearer ' + await apnsJwt(env), 'apns-topic': env.APNS_TOPIC || 'ro.netcomm.nis2', 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------- FCM (aplicatia Android) ----------
let fcmCache = { token: '', exp: 0, project: '' };
async function fcmAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (fcmCache.token && fcmCache.exp - 120 > now) return fcmCache;
  const sa = JSON.parse(stripBom(env.FCM_SA));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const head = bytesToB64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head + '.' + claims));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claims + '.' + bytesToB64u(sig),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('fcm oauth: ' + JSON.stringify(j).slice(0, 200));
  fcmCache = { token: j.access_token, exp: now + (j.expires_in || 3600), project: sa.project_id };
  return fcmCache;
}
async function sendFcm(env, token, msg) {
  const t = await fcmAccessToken(env);
  return fetch('https://fcm.googleapis.com/v1/projects/' + t.project + '/messages:send', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + t.token, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { token,
      notification: { title: msg.title, body: msg.body || '' },
      data: { url: String(msg.url || '/app/') },
      android: { priority: 'HIGH', notification: { sound: 'default', tag: msg.tag ? String(msg.tag) : undefined } } } }),
  });
}

// ---------- trimitere ----------
// userIds: lista de utilizatori care primesc notificarea; abonamentele utilizatorilor inactivi sunt ignorate
export async function sendToUsers(env, userIds, msg) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  const hasWeb = !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE_JWK), hasApns = !!(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID), hasFcm = !!env.FCM_SA;
  if (!ids.length || (!hasWeb && !hasApns && !hasFcm)) return { subs: 0, sent: 0 };
  const rows = (await env.DB.prepare(
    `SELECT p.endpoint, p.p256dh, p.auth FROM push_subs p JOIN users u ON u.id = p.user_id
     WHERE u.active = 1 AND p.user_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
  const payload = JSON.stringify(msg);
  const drop = (ep) => env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(ep).run();
  let sent = 0, removed = 0, failed = 0;
  await Promise.all(rows.map(async (s) => {
    try {
      let r;
      if (s.endpoint.startsWith('apns:')) {
        if (!hasApns) return;
        r = await sendApns(env, s.endpoint.slice(5), msg);
        if (!r.ok && (r.status === 410 || /BadDeviceToken|Unregistered/.test(await r.clone().text()))) { await drop(s.endpoint); removed++; return; }
      } else if (s.endpoint.startsWith('fcm:')) {
        if (!hasFcm) return;
        r = await sendFcm(env, s.endpoint.slice(4), msg);
        if (!r.ok && (r.status === 404 || /UNREGISTERED/.test(await r.clone().text()))) { await drop(s.endpoint); removed++; return; }
      } else {
        if (!hasWeb) return;
        r = await fetch(s.endpoint, {
          method: 'POST',
          headers: { authorization: await vapidAuthHeader(env, s.endpoint), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'high' },
          body: await encryptPush(s, payload),
        });
        if (r.status === 404 || r.status === 410) { await drop(s.endpoint); removed++; return; }
      }
      if (r.ok) sent++; else { failed++; console.log('push ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
    } catch (e) { failed++; console.log('push exc', String(e && e.message || e)); }
  }));
  return { subs: rows.length, sent, removed, failed };
}

