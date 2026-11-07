// Scut NIS2 - aplicatia (o singura pagina; merge in browser si in aplicatiile native).
// Tot ce vine de la server trece prin esc() inainte de a ajunge in HTML.
const $ = (s, r = document) => r.querySelector(s);
const root = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get token() { try { return localStorage.getItem('nis2_token') || ''; } catch { return ''; } },
  set token(v) { try { v ? localStorage.setItem('nis2_token', v) : localStorage.removeItem('nis2_token'); } catch {} },
};
let meta = null, me = null, timer = null;

const go = (h) => { if (location.hash === '#' + h) render(); else location.hash = h; };
function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), 4200);
}
async function api(path, opt = {}) {
  const headers = {};
  if (store.token) headers.authorization = 'Bearer ' + store.token;
  let body = opt.raw;
  if (opt.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opt.body); }
  if (opt.type) headers['content-type'] = opt.type;
  const res = await fetch('/api/' + path, { method: opt.method || (body !== undefined ? 'POST' : 'GET'), headers, body });
  if (opt.blob && res.ok) return res.blob();
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (data.code === 'auth') { store.token = ''; me = null; go('login'); }
    else if (data.code === 'mfa_verify') go('mfa');
    else if (data.code === 'mfa_setup') go('mfa-setup');
    const e = new Error(data.error || 'A apărut o eroare. Încercați din nou.'); e.code = data.code; e.status = res.status; throw e;
  }
  return data;
}

const ICON = {
  home: '<path d="M4 11 L12 4 L20 11 V20 H4 Z"/>',
  list: '<path d="M4 6 L6 8 L9 4"/><path d="M13 6 H20"/><path d="M4 16 L6 18 L9 14"/><path d="M13 16 H20"/>',
  doc: '<path d="M6 3 H15 L19 7 V21 H6 Z"/><path d="M9 12 H16"/><path d="M9 16 H16"/>',
  down: '<path d="M12 4 V15"/><path d="M7 10 L12 15 L17 10"/><path d="M5 20 H19"/>',
  alert: '<path d="M12 3 L22 20 H2 Z"/><path d="M12 10 V14"/><path d="M12 17 V17.5"/>',
  back: '<path d="M15 5 L8 12 L15 19"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21 C5 16 8 14 12 14 C16 14 19 16 20 21"/>',
  shield: '<path d="M12 2.5 L20 5.5 V12 C20 17 16.5 20.5 12 22 C7.5 20.5 4 17 4 12 V5.5 Z"/><path d="M8.5 12 L11 14.5 L15.5 9.5"/>',
};
const icon = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const logo = `<div class="brand">${icon('shield', 30)}<span>Scut NIS2</span></div>`;
function tabs(active) {
  const mgr = me && me.user.role !== 'angajat';
  const items = mgr
    ? [['panou', 'Panou', 'home'], ['masuri', 'Măsuri', 'list'], ['politici', 'Politici', 'doc'], ['raport', 'Raport', 'down']]
    : [['panou', 'Acasă', 'home'], ['incidente', 'Incidente', 'alert'], ['politici', 'Politici', 'doc'], ['cont', 'Cont', 'user']];
  return `<nav class="tabs" aria-label="Navigare principală">${items.map(([h, l, i]) =>
    `<a href="#${h}" ${active === h ? 'aria-current="page"' : ''}>${icon(i)}${l}</a>`).join('')}</nav>`;
}
const screen = (content, active) => { root.innerHTML = `<main class="page">${content}</main>${tabs(active)}`; };
const plain = (content) => { root.innerHTML = `<main class="page plain">${content}</main>`; };
const back = (h, l) => `<a class="back" href="#${h}">${icon('back', 20)}${esc(l)}</a>`;
const fmt = (ms) => ms ? new Date(ms).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' }) : '';
const fmtDay = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
function dueLabel(d) {
  if (!d) return { t: 'Fără termen', c: 'muted' };
  const days = Math.round((new Date(d + 'T12:00:00') - new Date(new Date().toDateString() + ' 12:00')) / 864e5);
  if (days < 0) return { t: `Întârziat ${-days} z`, c: 'red' };
  if (days === 0) return { t: 'Azi', c: 'red' };
  return { t: days === 1 ? 'Mâine' : `${days} zile`, c: days <= 3 ? 'red' : days <= 7 ? 'amber' : 'muted' };
}
const pctColor = (p) => p === 100 ? 'blue' : p === 0 ? 'red' : 'amber';
const ROLE = { responsabil: 'Responsabil NIS2', conducere: 'Conducere', angajat: 'Angajat', consultant: 'Consultant' };
const loading = () => { root.innerHTML = '<main class="page plain"><p class="muted" role="status">Se încarcă...</p></main>'; };
function errorView(e) { plain(`${logo}<h1>Nu am putut încărca</h1><p class="sub">${esc(e.message)}</p><button class="btn" data-act="reload">Încercați din nou</button>`); }
const field = (id, label, input, hint = '') => `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<span class="hint" id="${id}-hint">${hint}</span>` : ''}</div>`;
const showError = (form, msg) => { let e = $('.form-error', form); if (!e) { e = document.createElement('p'); e.className = 'form-error'; e.setAttribute('role', 'alert'); form.prepend(e); } e.textContent = msg; };

// ---------- pagini fara cont ----------
function viewLogin() {
  plain(`${logo}<h1>Intrați în cont</h1><form data-form="login" novalidate>
    ${field('email', 'Email', '<input id="email" name="email" type="email" autocomplete="username" required>')}
    ${field('password', 'Parolă', '<input id="password" name="password" type="password" autocomplete="current-password" required>')}
    <button class="btn">Intrați</button></form>
    <p class="center"><a href="#signup">Creați contul firmei</a></p><p class="center"><a href="#join">Am un cod de invitație</a></p>
    <p class="center small muted">Ați uitat parola? Administratorul firmei o poate reseta din Echipă. Dacă sunteți administrator, scrieți la suport@netcomm.ro.</p>
    <p class="center small"><a href="/confidentialitate.html">Confidențialitate</a></p>`);
}
function viewSignup() {
  plain(`${logo}<h1>Creați contul firmei</h1><p class="sub">Aflați în câteva minute dacă NIS2 se aplică firmei dumneavoastră și ce aveți de făcut.</p>
  <form data-form="signup" novalidate>
    ${field('cui', 'CUI', '<input id="cui" name="cui" inputmode="numeric" autocomplete="off" class="mono" required>', '')}
    ${field('company_name', 'Numele firmei', '<input id="company_name" name="company_name" autocomplete="organization" required>')}
    ${field('name', 'Numele dumneavoastră', '<input id="name" name="name" autocomplete="name" required>')}
    ${field('email', 'Email de serviciu', '<input id="email" name="email" type="email" autocomplete="username" required>')}
    ${field('role', 'Rolul dumneavoastră', '<select id="role" name="role"><option value="responsabil">Responsabil NIS2 sau IT</option><option value="conducere">Administrator sau director</option></select>')}
    ${field('password', 'Parolă', '<input id="password" name="password" type="password" autocomplete="new-password" minlength="10" required>', 'Cel puțin 10 caractere')}
    <label class="check"><input type="checkbox" name="terms" required> <span>Sunt de acord cu <a href="/confidentialitate.html">prelucrarea datelor</a>.</span></label>
    <button class="btn">Continuați</button></form>
    <p class="center"><a href="#login">Am deja cont</a></p>`);
}
function viewJoin() {
  plain(`${logo}<h1>Intrați în echipa firmei</h1><p class="sub">Folosiți codul primit de la responsabilul NIS2.</p>
  <form data-form="join" novalidate>
    ${field('code', 'Cod de invitație', '<input id="code" name="code" autocomplete="off" autocapitalize="characters" class="mono" required>')}
    ${field('name', 'Numele dumneavoastră', '<input id="name" name="name" autocomplete="name" required>')}
    ${field('email', 'Email', '<input id="email" name="email" type="email" autocomplete="username" required>')}
    ${field('password', 'Parolă', '<input id="password" name="password" type="password" autocomplete="new-password" minlength="10" required>', 'Cel puțin 10 caractere')}
    <label class="check"><input type="checkbox" name="terms" required> <span>Sunt de acord cu <a href="/confidentialitate.html">prelucrarea datelor</a>.</span></label>
    <button class="btn">Creați contul</button></form><p class="center"><a href="#login">Am deja cont</a></p>`);
}
function viewMfa() {
  plain(`${logo}<h1>Cod de autentificare</h1><p class="sub">Introduceți codul de 6 cifre din aplicația de autentificare sau un cod de recuperare.</p>
  <form data-form="mfa" novalidate>${field('code', 'Cod', '<input id="code" name="code" autocomplete="one-time-code" class="mono" required>')}<button class="btn">Verificați</button></form>
  <p class="center"><button class="link" data-act="logout">Ieșiți din cont</button></p>`);
}
async function viewMfaSetup() {
  let d;
  try { d = await api('mfa/setup', { method: 'POST' }); } catch (e) {
    if (e.status === 400) { await loadMe(); return go('panou'); } // deja activ, de exemplu dupa reincarcarea paginii
    throw e;
  }
  let qr = '';
  try { const q = window.qrcode(0, 'M'); q.addData(d.uri); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 8, scalable: true }); } catch {}
  plain(`${logo}<h1>Activați autentificarea cu doi factori</h1>
  <p class="sub">Este obligatorie pentru administratori. Folosiți Microsoft Authenticator, Google Authenticator sau o aplicație similară.</p>
  <div class="qr" role="img" aria-label="Cod QR pentru aplicația de autentificare">${qr}</div>
  <p class="center"><a class="btn ghost small-btn" href="${esc(d.uri)}">Deschideți pe acest telefon</a></p>
  <p class="small muted center">Sau introduceți manual cheia:</p><p class="mono center key">${esc(d.secret.replace(/(.{4})/g, '$1 '))}</p>
  <form data-form="mfa-enable" novalidate>${field('code', 'Codul de 6 cifre afișat', '<input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" class="mono" maxlength="6" required>')}<button class="btn">Activați</button></form>
  <p class="center"><button class="link" data-act="logout">Ieșiți din cont</button></p>`);
}
function viewRecovery(codes) {
  plain(`${logo}<h1>Păstrați codurile de recuperare</h1><p class="sub">Le folosiți dacă pierdeți telefonul. Fiecare merge o singură dată și nu le mai afișăm.</p>
  <ul class="codes mono">${codes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  <button class="btn ghost" data-act="copy" data-text="${esc(codes.join('\n'))}">Copiați codurile</button>
  <div class="gap"></div><button class="btn" data-act="after-mfa">Le-am salvat</button>`);
}

// ---------- incadrare si plan ----------
async function viewAssess() {
  const c = me.company;
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  plain(`${back('panou', 'Panou')}<span class="eyebrow">ÎNCADRARE</span><h1>Se aplică NIS2 firmei dumneavoastră?</h1>
  <form data-form="assess" novalidate>
    ${field('sector', 'Domeniu de activitate', `<select id="sector" name="sector" required><option value="">Alegeți</option>${meta.sectors.map((s) => opt(s.id, s.name, c.sector)).join('')}</select>`)}
    ${field('employees', 'Număr de angajați', `<select id="employees" name="employees" required><option value="">Alegeți</option>${opt('sub50', 'Sub 50', c.employees)}${opt('50-249', '50 - 249', c.employees)}${opt('250+', '250 sau mai mulți', c.employees)}</select>`)}
    ${field('turnover', 'Cifră de afaceri anuală', `<select id="turnover" name="turnover" required><option value="">Alegeți</option>${opt('sub10', 'Sub 10 milioane EUR', c.turnover)}${opt('10-50', '10 - 50 milioane EUR', c.turnover)}${opt('50+', 'Peste 50 milioane EUR', c.turnover)}</select>`)}
    <label class="check"><input type="checkbox" name="special" ${c.special ? 'checked' : ''}> <span>Oferim DNS, domenii de nivel superior, servicii de încredere sau comunicații electronice publice.</span></label>
    <button class="btn">Vedeți rezultatul</button></form><div id="result"></div>`);
}

// ---------- panou ----------
function ring(pct) {
  const c = 327, dash = Math.round((pct / 100) * c);
  return `<svg width="112" height="112" viewBox="0 0 120 120" role="img" aria-label="Scor de pregătire: ${pct} la sută"><circle cx="60" cy="60" r="52" fill="none" stroke="#D8DEE5" stroke-width="12"/>${pct > 0 ? `<circle cx="60" cy="60" r="52" fill="none" stroke="#0B4F6C" stroke-width="12" stroke-dasharray="${dash} ${c}" stroke-linecap="round" transform="rotate(-90 60 60)"/>` : ''}<text x="60" y="69" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="28" font-weight="600" fill="currentColor">${pct}%</text></svg>`;
}
function taskRow(t) {
  const d = dueLabel(t.due_on);
  return `<a class="row-card" href="#sarcina/${t.id}"><span class="grow"><strong>${esc(t.title)}</strong><span class="small muted">${t.measure === 'x' ? 'Obligații de bază' : `Măsura (${esc(t.measure)})`}${t.assignee ? ', ' + esc(t.assignee) : ''}</span></span><span class="mono small ${d.c}">${d.t}</span></a>`;
}
async function viewDashboard() {
  const d = await api('dashboard');
  me.company = d.company;
  const mgr = d.user.role !== 'angajat';
  const label = d.score >= 80 ? 'Pregătire bună' : d.score >= 40 ? 'Pregătire parțială' : 'La început';
  const incRow = (i) => {
    const late = i.significant === 1 && nextStep(i);
    return `<a class="row-card" href="#incident/${i.id}"><span class="grow"><strong>#${i.seq} ${esc(i.kind)}</strong><span class="small muted">${i.significant === null ? 'De evaluat' : i.significant ? 'Semnificativ' : 'Nesemnificativ'}</span></span>${late ? `<span class="mono small red" data-count="${late.at}"></span>` : ''}</a>`;
  };
  screen(`<header class="top"><div><span class="muted">${esc(d.company.name)}</span><h1>${mgr ? 'Stadiul NIS2' : 'Bună, ' + esc(d.user.name.split(' ')[0])}</h1></div><a class="icon-btn" href="#cont" aria-label="Contul meu">${icon('user', 24)}</a></header>
  ${mgr ? `<section class="card score">${ring(d.score)}<div><strong class="big">${label}</strong><span class="muted">${d.counts.partial} măsuri în lucru, ${d.counts.none} neîncepute, ${d.counts.complete} complete</span><a href="#masuri">Vedeți măsurile</a></div></section>` : ''}
  <a class="btn danger" href="#incident-nou">${icon('alert')}Raportați un incident</a>
  ${mgr && !d.company.classification ? `<a class="row-card note" href="#incadrare"><span class="grow"><strong>Verificați dacă se aplică NIS2</strong><span class="small muted">Durează un minut</span></span></a>` : ''}
  ${d.incidents.length ? `<h2>Incidente deschise</h2>${d.incidents.map(incRow).join('')}` : ''}
  ${d.to_approve.length ? `<h2>De aprobat</h2>${d.to_approve.map((p) => `<a class="row-card" href="#politica/${p.id}"><span class="grow"><strong>${esc(p.title)}</strong></span></a>`).join('')}` : ''}
  ${d.to_read ? `<a class="row-card" href="#politici"><span class="grow"><strong>${d.to_read} ${d.to_read === 1 ? 'politică de citit' : 'politici de citit'}</strong></span></a>` : ''}
  <h2>Urmează</h2>${d.next.length ? d.next.map(taskRow).join('') : `<p class="muted">Nu aveți sarcini deschise.</p>`}`, 'panou');
}

// ---------- masuri si sarcini ----------
async function viewMeasures() {
  const d = await api('dashboard');
  if (d.user.role === 'angajat') return go('panou');
  const row = (m, letter) => `<a class="measure" href="#masura/${m.id}"><span class="mono small muted">${letter}</span><span class="grow name">${esc(m.name)}</span><span class="mono small ${pctColor(m.pct)}">${m.pct}%</span><span class="bar"><i class="bg-${pctColor(m.pct)}" style="width:${m.pct}%"></i></span></a>`;
  screen(`<header class="top"><div><h1>Cele 10 măsuri</h1><span class="muted">Art. 21 din directiva NIS2</span></div></header>
  <div class="list">${d.measures.map((m) => row(m, m.id)).join('')}</div>
  <a class="row-card" href="#masura/x"><span class="grow"><strong>Obligații de bază</strong><span class="small muted">Înregistrare, responsabilități, conducere. Nu intră în scor.</span></span></a>`, 'masuri');
}
async function viewMeasure(id) {
  const m = id === 'x' ? meta.base : meta.measures.find((x) => x.id === id);
  if (!m) return go('masuri');
  const d = await api('tasks?measure=' + encodeURIComponent(id));
  screen(`${back('masuri', 'Măsuri')}<span class="eyebrow">${id === 'x' ? '' : `MĂSURA (${esc(id).toUpperCase()})`}</span><h1>${esc(m.name)}</h1><p class="sub">${esc(m.full)}</p>
  ${d.items.map((t) => `<a class="row-card ${t.status === 'finalizata' ? 'done' : ''}" href="#sarcina/${t.id}"><span class="grow"><strong>${esc(t.title)}</strong><span class="small muted">${t.status === 'finalizata' ? 'Finalizată' : esc(t.assignee || 'Neatribuită')}${t.evidence ? `, ${t.evidence} ${t.evidence === 1 ? 'dovadă' : 'dovezi'}` : ''}</span></span>${t.status === 'finalizata' ? '<span class="small blue">Gata</span>' : `<span class="mono small ${dueLabel(t.due_on).c}">${dueLabel(t.due_on).t}</span>`}</a>`).join('')}`, 'masuri');
}
async function viewTask(id) {
  const t = await api('tasks/' + id);
  const mgr = me.user.role !== 'angajat';
  let people = [];
  if (mgr) { try { people = (await api('team')).items.filter((x) => x.active); } catch {} }
  const done = t.status === 'finalizata';
  const paid = me.company.entitled;
  const h = t.measure === 'x' ? 'masura/x' : 'masura/' + t.measure;
  screen(`${back(mgr ? h : 'panou', mgr ? 'Înapoi' : 'Acasă')}<span class="eyebrow">${t.measure === 'x' ? 'OBLIGAȚII DE BAZĂ' : `MĂSURA (${esc(t.measure).toUpperCase()})`}</span><h1>${esc(t.title)}</h1>
  ${mgr ? `<form class="grid2 card soft" data-form="task-meta" data-id="${t.id}">
    ${field('assignee_id', 'Responsabil', `<select id="assignee_id" name="assignee_id"><option value="">Neatribuită</option>${people.map((p) => `<option value="${p.id}" ${p.id === t.assignee_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`)}
    ${field('due_on', 'Termen', `<input id="due_on" name="due_on" type="date" value="${esc(t.due_on || '')}">`)}
  </form>` : `<p class="muted">Termen: ${esc(fmtDay(t.due_on) || 'fără termen')}</p>`}
  <h2>Ce aveți de făcut</h2><p>${esc(t.detail || '')}</p>
  <h2>Dovezi</h2>
  ${t.files.map((f) => `<div class="file"><button class="link grow left" data-act="open-file" data-id="${f.id}" data-name="${esc(f.filename)}" data-mime="${esc(f.mime)}">${esc(f.filename)}</button><span class="small muted">${esc(f.by_name || '')}</span>${mgr ? `<button class="link danger-text" data-act="del-file" data-id="${f.id}" aria-label="Ștergeți ${esc(f.filename)}">Ștergeți</button>` : ''}</div>`).join('') || '<p class="muted small">Nu există dovezi încă.</p>'}
  ${paid ? `<div class="grid2">
    <label class="btn ghost">Faceți o poză<input type="file" class="vh" accept="image/*" capture="environment" data-upload="task_id=${t.id}"></label>
    <label class="btn ghost">Alegeți un fișier<input type="file" class="vh" accept="image/*,.pdf,.txt,.docx,.xlsx" data-upload="task_id=${t.id}"></label></div>` : `<p class="small muted">Dovezile sunt incluse în abonament.</p>`}
  <div class="gap"></div>
  <button class="btn ${done ? 'ghost' : ''}" data-act="task-status" data-id="${t.id}" data-status="${done ? 'deschisa' : 'finalizata'}">${done ? 'Redeschideți sarcina' : 'Marcați ca finalizată'}</button>`, 'masuri');
}

// ---------- politici ----------
const PST = { ciorna: ['Ciornă', 'amber'], asteapta: ['De aprobat', 'amber'], aprobata: ['Aprobată', 'blue'] };
async function viewPolicies() {
  if (!me.company.entitled) {
    screen(`<header class="top"><div><h1>Politici</h1></div></header><p class="muted">Modelele de politici, aprobarea și evidența citirii sunt incluse în abonament.</p>`, 'politici');
    return;
  }
  const d = await api('policies');
  const mgr = me.user.role !== 'angajat';
  const ok = d.items.filter((p) => p.status === 'aprobata').length;
  screen(`<header class="top"><div><h1>Politici</h1>${mgr ? `<span class="muted">${ok} din ${d.items.length} aprobate de conducere</span>` : ''}</div></header>
  ${mgr && d.items.length ? '<p class="note small">Modelele sunt punct de plecare. Adaptați-le la firmă înainte de aprobare.</p>' : ''}
  ${d.items.length ? `<div class="list">${d.items.map((p) => {
    const [l, c] = PST[p.status];
    const sub = p.status === 'aprobata' ? (mgr ? `Citită de ${p.reads} din ${d.staff}` : p.read_by_me ? 'Citită' : 'De citit') : l;
    return `<a class="list-row" href="#politica/${p.id}"><span class="grow"><strong>${esc(p.title)}</strong><span class="small muted">${esc(sub)}</span></span><span class="small ${c}">${mgr ? l : p.read_by_me ? '' : 'Nouă'}</span></a>`;
  }).join('')}</div>` : '<p class="muted">Nu există politici disponibile încă.</p>'}`, 'politici');
}
async function viewPolicy(id) {
  const p = await api('policies/' + id);
  const mgr = me.user.role !== 'angajat';
  const [l, c] = PST[p.status];
  screen(`${back('politici', 'Politici')}<span class="eyebrow ${c}">${esc(l)}, VERSIUNEA ${p.version}</span><h1>${esc(p.title)}</h1>
  ${p.approved_at ? `<p class="small muted">Aprobată de ${esc(p.approved_by_name || '')}, ${esc(fmt(p.approved_at))}</p>` : ''}
  ${mgr ? `<form data-form="policy" data-id="${p.id}">${field('body', 'Textul politicii', `<textarea id="body" name="body" rows="16">${esc(p.body)}</textarea>`, 'La salvare, politica revine la ciornă și trebuie aprobată din nou.')}<button class="btn ghost">Salvați modificările</button></form><div class="gap"></div>` : `<div class="prose">${esc(p.body)}</div>`}
  ${mgr && p.status === 'ciorna' ? `<button class="btn" data-act="policy-submit" data-id="${p.id}">Trimiteți spre aprobare</button>` : ''}
  ${p.status === 'asteapta' ? (me.user.role === 'conducere' ? `<button class="btn" data-act="policy-approve" data-id="${p.id}">Aprobați politica</button>` : '<p class="note small">Așteaptă aprobarea conducerii.</p>') : ''}
  ${p.status === 'aprobata' ? (p.read_by_me ? '<p class="note small">Ați confirmat citirea acestei versiuni.</p>' : `<button class="btn" data-act="policy-read" data-id="${p.id}">Confirm că am citit</button>`) : ''}`, 'politici');
}

// ---------- incidente ----------
function viewIncidentNew() {
  plain(`${back('panou', 'Înapoi')}<h1>Ce s-a întâmplat?</h1><p class="sub">Nu trebuie să fiți sigur că e un incident. Trimitem o alertă responsabilului din firmă. Aceasta nu este o raportare către DNSC.</p>
  <form data-form="incident" novalidate>
    <fieldset class="chips"><legend class="vh-text">Tipul problemei</legend>${meta.kinds.map((k, i) => `<label class="chip"><input type="radio" name="kind" value="${esc(k)}" ${i === 0 ? 'checked' : ''}><span>${esc(k)}</span></label>`).join('')}</fieldset>
    ${field('details', 'Detalii, pe scurt', '<textarea id="details" name="details" rows="3"></textarea>')}
    <label class="btn ghost">${'Adăugați o poză a ecranului'}<input type="file" class="vh" name="photo" accept="image/*"></label><p class="small muted" id="photo-name"></p>
    <p class="small muted">Dacă ați deschis ceva suspect, deconectați calculatorul de la rețea, dar nu îl opriți.</p>
    <button class="btn danger">Trimiteți acum</button></form>`);
}
function nextStep(i) {
  if (i.significant !== 1 || !i.deadlines || i.closed_at) return null;
  if (!i.early_sent_at) return { key: 'early', at: i.deadlines.early, label: 'Alertă timpurie către DNSC', of: 'termenul de 24 de ore' };
  if (!i.notif_sent_at) return { key: 'notif', at: i.deadlines.notif, label: 'Notificarea incidentului', of: 'termenul de 72 de ore' };
  if (!i.final_sent_at) return { key: 'final', at: i.deadlines.final, label: 'Raport final', of: 'termenul de o lună' };
  return null;
}
function countdownText(at) {
  const left = at - Date.now(), a = Math.abs(left);
  const h = Math.floor(a / 36e5), m = Math.floor(a / 6e4) % 60, s = Math.floor(a / 1e3) % 60;
  const body = h >= 48 ? `${Math.floor(h / 24)}z ${h % 24}h` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return (left < 0 ? 'depășit cu ' : '') + body;
}
function tick() { document.querySelectorAll('[data-count]').forEach((el) => { el.textContent = countdownText(Number(el.dataset.count)); }); }
async function viewIncidents() {
  const d = await api('incidents');
  screen(`${me.user.role === 'angajat' ? '' : back('panou', 'Panou')}<h1>Incidente</h1><a class="btn danger" href="#incident-nou">${icon('alert')}Raportați un incident</a><div class="gap"></div>
  ${d.items.length ? d.items.map((i) => `<a class="row-card" href="#incident/${i.id}"><span class="grow"><strong>#${i.seq} ${esc(i.kind)}</strong><span class="small muted">${esc(fmt(i.reported_at))}${i.closed_at ? ', închis' : ''}</span></span><span class="small ${i.significant ? 'red' : 'muted'}">${i.significant === null ? 'De evaluat' : i.significant ? 'Semnificativ' : 'Nesemnificativ'}</span></a>`).join('') : '<p class="muted">Nu există incidente raportate.</p>'}`, me.user.role === 'angajat' ? 'incidente' : 'panou');
}
// Spune ce a plecat de fapt. „Trimis” nu inseamna ca responsabilul a vazut alerta.
function alertStatus(i) {
  const a = i.notified;
  if (i.significant !== null || i.closed_at) return '<p class="small muted">Responsabilul a evaluat incidentul.</p>';
  if (!a) return '<p class="note small">Incidentul este salvat în aplicație. Dacă este urgent, anunțați direct responsabilul.</p>';
  if (!a.targets) return '';
  if (!a.push && !a.email) return '<p class="note small"><strong class="red">Alerta nu a putut fi trimisă.</strong> Incidentul este salvat, dar responsabilul nu a fost anunțat. Anunțați-l direct, acum.</p>';
  const parts = [];
  if (a.push) parts.push(a.push === 1 ? 'o notificare' : a.push + ' notificări');
  if (a.email) parts.push(a.email === 1 ? 'un e-mail' : a.email + ' e-mailuri');
  return `<p class="note small">Am trimis ${parts.join(' și ')} către responsabil. Nu a evaluat încă incidentul. Dacă este urgent, anunțați-l direct.</p>`;
}
async function viewIncident(id) {
  const i = await api('incidents/' + id);
  const mgr = me.user.role !== 'angajat';
  const n = nextStep(i);
  const stepRow = (key, label, sub, sent, at) => `<li class="list-row"><span class="grow"><strong>${label}</strong><span class="small muted">${sub}</span></span>${sent ? `<button class="link small" data-act="inc-mark" data-id="${i.id}" data-step="${key}" data-undo="1">Trimis ${esc(fmt(sent))}</button>` : `<span class="mono small ${at < Date.now() ? 'red' : 'amber'}" data-count="${at}"></span>`}</li>`;
  if (!mgr) {
    screen(`${back('incidente', 'Incidente')}<span class="eyebrow">INCIDENT #${i.seq}</span><h1>${esc(i.kind)}</h1><p class="muted">Raportat la ${esc(fmt(i.reported_at))}.</p>${alertStatus(i)}<p>${esc(i.details || '')}</p>`, 'incidente');
    return;
  }
  screen(`${back('incidente', 'Incidente')}<span class="eyebrow">INCIDENT #${i.seq}${i.closed_at ? ', ÎNCHIS' : ''}</span><h1>${esc(i.kind)}</h1>
  <p class="small muted">Raportat de ${esc(i.reporter || '-')}, ${esc(fmt(i.reported_at))}</p>
  ${i.reported_by_me && i.significant === null && i.notified && i.notified.targets ? alertStatus(i) : ''}
  ${i.significant === null ? `<section class="card strong"><h2>Este un incident semnificativ?</h2><p class="muted small">Semnificativ înseamnă, în general, perturbare gravă a serviciilor, pierderi financiare sau daune importante pentru alții. Dacă nu sunteți sigur, cereți părerea unui consultant.</p>
    <div class="grid2"><button class="btn danger" data-act="inc-sig" data-id="${i.id}" data-v="1">Da, semnificativ</button><button class="btn ghost" data-act="inc-sig" data-id="${i.id}" data-v="0">Nu</button></div></section>` : ''}
  ${n ? `<section class="timer" aria-live="off"><span>${esc(n.label)}</span><strong class="mono" data-count="${n.at}"></strong><span>din ${esc(n.of)}</span></section>` : ''}
  ${i.significant === 1 ? `<ol class="list plainlist">
    ${stepRow('early', 'Alertă timpurie', 'În 24 de ore de la constatare', i.early_sent_at, i.deadlines.early)}
    ${stepRow('notif', 'Notificare incident', 'În 72 de ore de la constatare', i.notif_sent_at, i.deadlines.notif)}
    ${stepRow('final', 'Raport final', 'Într-o lună de la notificare', i.final_sent_at, i.deadlines.final)}</ol>
    <h2>Text pregătit pentru DNSC</h2><pre class="draft">${esc(i.draft)}</pre>
    <p class="small muted">Verificați și completați textul. Transmiterea o faceți dumneavoastră, prin canalele DNSC. Numărul 1911 și platforma de raportare sunt indicate de DNSC; verificați procedura actuală pe dnsc.ro.</p>
    <button class="btn ghost" data-act="copy" data-text="${esc(i.draft)}">Copiați textul</button><div class="gap"></div>
    ${n ? `<button class="btn" data-act="inc-mark" data-id="${i.id}" data-step="${n.key}">Marcați ca trimisă: ${esc(n.label.toLowerCase())}</button><div class="gap"></div>` : ''}
    <label class="check"><input type="checkbox" data-act-change="inc-personal" data-id="${i.id}" ${i.personal_data ? 'checked' : ''}> <span>Sunt afectate date cu caracter personal</span></label>
    ${i.personal_data ? '<p class="note small">GDPR cere, în general, notificarea ANSPDCP în 72 de ore de la constatare. Verificați cu responsabilul de protecția datelor.</p>' : ''}` : ''}
  <form data-form="inc-notes" data-id="${i.id}">
    ${field('details', 'Ce s-a întâmplat', `<textarea id="details" name="details" rows="3">${esc(i.details || '')}</textarea>`)}
    ${field('notes', 'Măsuri luate', `<textarea id="notes" name="notes" rows="3">${esc(i.notes || '')}</textarea>`)}
    <button class="btn ghost">Salvați</button></form>
  <h2>Fișiere</h2>${i.files.map((f) => `<div class="file"><button class="link grow left" data-act="open-file" data-id="${f.id}" data-name="${esc(f.filename)}" data-mime="${esc(f.mime)}">${esc(f.filename)}</button></div>`).join('') || '<p class="small muted">Nu există fișiere.</p>'}
  <label class="btn ghost">Adăugați un fișier<input type="file" class="vh" accept="image/*,.pdf,.txt,.docx,.xlsx" data-upload="incident_id=${i.id}"></label>
  <div class="gap"></div>
  ${i.significant !== null ? `<button class="link" data-act="inc-sig" data-id="${i.id}" data-v="">Reevaluați incidentul</button><div class="gap"></div>` : ''}
  <button class="btn ghost" data-act="inc-close" data-id="${i.id}" ${i.closed_at ? 'data-reopen="1"' : ''}>${i.closed_at ? 'Redeschideți incidentul' : 'Închideți incidentul'}</button>`, 'panou');
}

// ---------- raport ----------
async function viewReport() {
  const d = await api('dashboard');
  if (d.user.role === 'angajat') return go('panou');
  if (!d.company.entitled) {
    screen(`<header class="top"><div><h1>Raport NIS2</h1></div></header><p class="muted">Raportul este inclus în abonament.</p>`, 'raport');
    return;
  }
  screen(`<header class="top"><div><h1>Raport NIS2</h1><span class="muted">Pentru conducere sau pentru un auditor</span></div></header>
  <ul class="list plainlist"><li class="list-row"><span class="grow">Scor pe cele 10 măsuri</span><span class="mono">${d.score}%</span></li>
  <li class="list-row"><span class="grow">Sarcini, dovezi și politici</span><span class="small blue">Incluse</span></li><li class="list-row"><span class="grow">Incidente și termene</span><span class="small blue">Incluse</span></li><li class="list-row"><span class="grow">Jurnal de acțiuni</span><span class="small blue">Inclus</span></li></ul>
  <p class="note small">Raportul arată stadiul declarat de firmă și dovezile încărcate. Nu este o certificare și nu garantează conformitatea.</p>
  <button class="btn" data-act="report">Deschideți raportul</button><p class="small muted center">Din raport îl puteți tipări sau salva ca PDF. Linkul expiră după 10 minute.</p>
  <a class="row-card" href="#jurnal"><span class="grow"><strong>Jurnal de acțiuni</strong></span></a>`, 'raport');
}
async function viewAudit() {
  const d = await api('audit');
  screen(`${back('raport', 'Raport')}<h1>Jurnal de acțiuni</h1><ul class="list plainlist">${d.items.map((l) => `<li class="list-row"><span class="grow"><strong>${esc(l.action)}</strong><span class="small muted">${esc(l.user_label)}${l.target ? ', ' + esc(l.target) : ''}</span></span><span class="small muted">${esc(fmt(l.at))}</span></li>`).join('')}</ul>`, 'raport');
}

// ---------- cont si echipa ----------
function viewAccount() {
  const u = me.user, c = me.company;
  const mgr = u.role !== 'angajat';
  screen(`${back('panou', 'Înapoi')}<h1>Contul meu</h1><p class="muted">${esc(u.name)}, ${esc(ROLE[u.role])}<br>${esc(u.email)}<br>${esc(c.name)}</p>
  ${mgr ? `<a class="row-card" href="#email"><span class="grow"><strong>E-mail pentru alerte</strong><span class="small muted">Contul de pe care pleacă alertele și adresa care le primește</span></span></a>
  <a class="row-card" href="#echipa"><span class="grow"><strong>Echipă și invitații</strong></span></a>
  <a class="row-card" href="#incadrare"><span class="grow"><strong>Încadrare NIS2</strong></span></a>
  <label class="check card"><input type="checkbox" data-act-change="consultant" ${c.plan === 'consultant' ? 'checked' : ''}> <span><strong>Permiteți accesul consultantului NCS</strong><br><span class="small muted">Consultantul poate vedea stadiul, sarcinile și incidentele firmei. Fiecare consultare apare în jurnal. Puteți opri accesul oricând.</span></span></label>` : ''}
  <button class="row-card as-btn" data-act="push-on"><span class="grow"><strong>Activați notificările</strong><span class="small muted">Pentru incidente și termene</span></span></button>
  <h2>Schimbați parola</h2><form data-form="password" novalidate>${field('old', 'Parola actuală', '<input id="old" name="old" type="password" autocomplete="current-password" required>')}${field('new', 'Parola nouă', '<input id="new" name="new" type="password" autocomplete="new-password" minlength="10" required>')}<button class="btn ghost">Schimbați parola</button></form>
  <div class="gap"></div><button class="btn ghost" data-act="logout">Ieșiți din cont</button><div class="gap"></div>
  <p class="center small"><a href="/confidentialitate.html">Confidențialitate</a></p>
  <h2>Ștergere</h2><form data-form="del-account" novalidate>${field('del_pw', 'Parola, pentru confirmare', '<input id="del_pw" name="password" type="password" autocomplete="current-password" required>')}<button class="btn ghost danger-text">Ștergeți contul meu</button></form>
  ${mgr ? `<div class="gap"></div><form data-form="del-company" novalidate><p class="small muted">Ștergerea firmei elimină definitiv toate datele: sarcini, dovezi, politici, incidente și conturi.</p>${field('confirm', 'Scrieți numele firmei', '<input id="confirm" name="confirm" autocomplete="off" required>')}${field('del_pw2', 'Parola', '<input id="del_pw2" name="password" type="password" autocomplete="current-password" required>')}<button class="btn ghost danger-text">Ștergeți firma și toate datele</button></form>` : ''}`, 'cont');
}
async function viewMail() {
  const d = await api('company/mail');
  const a = d.account;
  screen(`${back('cont', 'Cont')}<h1>E-mail pentru alerte</h1>
  <h2>Adresa care primește alertele</h2>
  <form data-form="mail-box" novalidate>${field('incident_email', 'Adresa de incidente', `<input id="incident_email" name="incident_email" type="email" autocomplete="off" value="${esc(d.incident_email || '')}" required>`)}<button class="btn ghost">Salvați adresa</button></form>
  <h2>Contul de pe care pleacă</h2>
  ${a ? `<section class="card"><strong>${esc(a.from)}</strong><span class="small muted"><br>prin ${esc(a.host)}, port ${esc(String(a.port))}. Verificat la ${esc(fmt(a.ok_at))}.</span></section>
  ${a.fail_at ? `<p class="note small"><strong class="red">Ultima alertă nu a plecat prin acest cont</strong> (${esc(fmt(a.fail_at))}). Verificați parola și salvați din nou contul.</p>` : ''}<div class="gap"></div>
  <button class="btn ghost" data-act="mail-remove">Eliminați contul</button><div class="gap"></div>` : '<p class="small muted">Nu aveți un cont propriu. Alertele pleacă de la expeditorul implicit al aplicației.</p>'}
  <form data-form="mail-account" novalidate>
    ${field('host', 'Server SMTP', `<input id="host" name="host" autocomplete="off" autocapitalize="off" placeholder="smtp.office365.com" value="${esc(a ? a.host : '')}" required>`)}
    ${field('port', 'Port', `<select id="port" name="port"><option value="587" ${a && a.port === 465 ? '' : 'selected'}>587 (STARTTLS)</option><option value="465" ${a && a.port === 465 ? 'selected' : ''}>465 (TLS)</option></select>`)}
    ${field('user', 'Utilizator', `<input id="user" name="user" autocomplete="off" autocapitalize="off" value="${esc(a ? a.user : '')}" required>`)}
    ${field('password', 'Parola contului', '<input id="password" name="password" type="password" autocomplete="new-password" required>')}
    ${field('from', 'Adresa expeditorului', `<input id="from" name="from" type="email" autocomplete="off" value="${esc(a ? a.from : '')}" required>`)}
    <p class="small muted">Trimitem un e-mail de test la ${esc(me.user.email)} și salvăm contul doar dacă pleacă. Parola se păstrează criptat și nu se mai afișează. Folosiți un cont dedicat alertelor. La Gmail folosiți o parolă de aplicație; la Microsoft 365 trebuie activat SMTP AUTH pentru cont.</p>
    <button class="btn">Testați și salvați</button></form>`, 'cont');
}
async function viewTeam() {
  const d = await api('team');
  screen(`${back('cont', 'Cont')}<h1>Echipă</h1><div class="list">${d.items.map((p) => `<div class="list-row ${p.active ? '' : 'done'}"><span class="grow"><strong>${esc(p.name)}</strong><span class="small muted">${esc(ROLE[p.role])}, ${esc(p.email)}${p.mfa ? '' : ', fără doi factori'}${p.active ? '' : ', dezactivat'}</span></span>${p.id === me.user.id ? '' : `<button class="link small" data-act="member" data-id="${p.id}" data-name="${esc(p.name)}" data-role="${p.role}" data-active="${p.active}">Modificați</button>`}</div>`).join('')}</div>
  <div id="member-box"></div>
  <h2>Invitați o persoană</h2>
  ${me.company.entitled ? `<form data-form="invite" novalidate>${field('label', 'Pentru cine (opțional)', '<input id="label" name="label">')}${field('role', 'Rol', '<select id="role" name="role"><option value="angajat">Angajat</option><option value="responsabil">Responsabil NIS2</option><option value="conducere">Conducere</option></select>')}<button class="btn">Creați codul</button></form><div id="invite-box"></div>
  ${d.pending.length ? `<p class="small muted">${d.pending.length} ${d.pending.length === 1 ? 'invitație nefolosită' : 'invitații nefolosite'}.</p>` : ''}` : '<p class="muted">Echipa este inclusă în abonament.</p>'}`, 'cont');
}

// ---------- notificari native / browser ----------
async function registerNativePush() { if (window.NIS2_NATIVE_PUSH && store.token) { try { await api('push/native', { body: window.NIS2_NATIVE_PUSH }); } catch {} } }
window.addEventListener('nis2-native-push', registerNativePush);
async function enablePush() {
  if (window.NIS2_NATIVE) { if (window.NIS2_NATIVE_PUSH) { await registerNativePush(); return toast('Notificările sunt active'); } return toast('Permiteți notificările din setările telefonului', true); }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Acest browser nu acceptă notificări. Pe iPhone, adăugați aplicația pe ecranul principal.', true);
  const { key } = await api('push/key');
  if (!key) return toast('Notificările nu sunt încă activate pe server', true);
  if (await Notification.requestPermission() !== 'granted') return toast('Nu ați permis notificările', true);
  const reg = await navigator.serviceWorker.ready;
  const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
  const j = sub.toJSON();
  await api('push/sub', { body: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } });
  toast('Notificările sunt active');
}

// ---------- fisiere ----------
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.82));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}
const MIME_BY_EXT = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', txt: 'text/plain' };
async function uploadFile(file, query) {
  const f = await shrink(file);
  const type = f.type || MIME_BY_EXT[(f.name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
  await api(`evidence?${query}&name=${encodeURIComponent(f.name)}`, { method: 'POST', raw: f, type });
}

// ---------- evenimente ----------
const formData = (f) => Object.fromEntries(new FormData(f).entries());
async function afterLogin(r) {
  store.token = r.token; me = null;
  if (r.next === 'mfa_setup') return go('mfa-setup');
  if (r.next === 'mfa_verify') return go('mfa');
  await loadMe(); go(me && me.user.role === 'consultant' ? 'panou' : 'panou');
}
async function loadMe() { me = await api('me'); if (me.user.role === 'consultant') { location.href = '/consultant/'; } registerNativePush(); }
const FORMS = {
  async login(f) { await afterLogin(await api('login', { body: formData(f) })); },
  async signup(f) {
    const d = formData(f);
    if (!d.terms) throw new Error('Trebuie să acceptați prelucrarea datelor');
    await afterLogin(await api('signup', { body: d }));
  },
  async join(f) {
    const d = formData(f);
    if (!d.terms) throw new Error('Trebuie să acceptați prelucrarea datelor');
    await afterLogin(await api('join', { body: d }));
  },
  async mfa(f) { await api('mfa/verify', { body: formData(f) }); await loadMe(); go('panou'); },
  async 'mfa-enable'(f) { const r = await api('mfa/enable', { body: formData(f) }); viewRecovery(r.recovery_codes); },
  async assess(f) {
    const d = formData(f); d.special = !!d.special;
    const r = await api('company/assess', { body: d });
    await loadMe();
    $('#result').innerHTML = `<section class="card result"><span class="small blue">Rezultat orientativ</span><strong class="big">${esc(r.title)}</strong><span class="small">${esc(r.text)}</span></section><p class="small muted">Evaluarea nu este o încadrare oficială. Confirmați-o cu DNSC sau cu un consultant.</p><a class="btn" href="#panou">Vedeți ce urmează</a>`;
    $('#result').scrollIntoView({ behavior: 'smooth' });
  },
  async incident(f) {
    const d = formData(f); const photo = f.photo.files[0];
    const r = await api('incidents', { body: { kind: d.kind, details: d.details } });
    if (photo) { try { await uploadFile(photo, 'incident_id=' + r.id); } catch (e) { toast('Incidentul a fost trimis, dar poza nu: ' + e.message, true); } }
    toast('Incidentul a fost salvat'); go('incident/' + r.id);
  },
  async policy(f) { await api('policies/' + f.dataset.id, { method: 'PUT', body: formData(f) }); toast('Salvat'); render(); },
  async 'mail-box'(f) { await api('company', { method: 'PUT', body: formData(f) }); await loadMe(); toast('Salvat'); render(); },
  async 'mail-account'(f) { const r = await api('company/mail', { body: formData(f) }); toast('E-mail de test trimis la ' + r.sent_to); render(); },
  async 'inc-notes'(f) { await api('incidents/' + f.dataset.id, { method: 'PUT', body: formData(f) }); toast('Salvat'); render(); },
  async password(f) { await api('password', { body: formData(f) }); toast('Parola a fost schimbată'); f.reset(); },
  async invite(f) {
    const r = await api('invites', { body: formData(f) });
    $('#invite-box').innerHTML = `<section class="card result"><span class="small blue">Cod de invitație, valabil 14 zile</span><strong class="mono big">${esc(r.code)}</strong><span class="small">Transmiteți-l persoanei. Nu îl mai afișăm.</span><button type="button" class="btn ghost" data-act="copy" data-text="${esc(r.code)}">Copiați codul</button></section>`;
    f.reset();
  },
  async 'del-account'(f) { await api('account', { method: 'DELETE', body: formData(f) }); store.token = ''; me = null; toast('Contul a fost șters'); go('login'); },
  async 'del-company'(f) { await api('company', { method: 'DELETE', body: formData(f) }); store.token = ''; me = null; toast('Firma a fost ștearsă'); go('login'); },
  async 'member-save'(f) {
    const d = formData(f);
    await api('team/' + f.dataset.id, { method: 'PUT', body: { role: d.role, active: d.active === '1' } }); toast('Salvat'); render();
  },
};
document.addEventListener('submit', async (ev) => {
  const f = ev.target.closest('[data-form]'); if (!f) return;
  ev.preventDefault();
  const fn = FORMS[f.dataset.form]; if (!fn) return;
  const btn = $('button:not([type=button])', f); if (btn) btn.disabled = true;
  try { await fn(f); } catch (e) { if (f.isConnected) showError(f, e.message); }
  if (btn) btn.disabled = false;
});
const ACTS = {
  reload() { render(); },
  async logout() { try { await api('logout', { method: 'POST' }); } catch {} store.token = ''; me = null; go('login'); },
  async copy(b) { try { await navigator.clipboard.writeText(b.dataset.text); toast('Copiat'); } catch { toast('Nu am putut copia. Selectați textul manual.', true); } },
  async 'after-mfa'() { await loadMe(); go(me.company && !me.company.classification && me.user.role !== 'angajat' ? 'incadrare' : 'panou'); },
  async 'task-status'(b) { await api('tasks/' + b.dataset.id, { method: 'PUT', body: { status: b.dataset.status } }); toast(b.dataset.status === 'finalizata' ? 'Sarcină finalizată' : 'Sarcină redeschisă'); render(); },
  async 'del-file'(b) { if (!confirm('Ștergeți fișierul?')) return; await api('evidence/' + b.dataset.id, { method: 'DELETE' }); render(); },
  async 'open-file'(b) {
    const nb = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (window.NIS2_NATIVE && nb) { const r = await api(`evidence/${b.dataset.id}/link`, { method: 'POST' }); return nb.open({ url: r.url }); }
    const blob = await api('evidence/' + b.dataset.id, { blob: true });
    const url = URL.createObjectURL(new Blob([blob], { type: b.dataset.mime }));
    const a = document.createElement('a'); a.href = url; a.download = b.dataset.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  async 'policy-submit'(b) { await api(`policies/${b.dataset.id}/submit`, { method: 'POST' }); toast('Trimisă spre aprobare'); render(); },
  async 'policy-approve'(b) { await api(`policies/${b.dataset.id}/approve`, { method: 'POST' }); toast('Politică aprobată'); render(); },
  async 'policy-read'(b) { await api(`policies/${b.dataset.id}/read`, { method: 'POST' }); toast('Citire confirmată'); render(); },
  async 'inc-sig'(b) { const v = b.dataset.v; await api('incidents/' + b.dataset.id, { method: 'PUT', body: { significant: v === '' ? null : v === '1' } }); render(); },
  async 'mail-remove'() { if (!confirm('Eliminați contul de e-mail? Parola salvată se șterge.')) return; await api('company/mail', { method: 'DELETE' }); toast('Cont eliminat'); render(); },
  async 'inc-mark'(b) { if (b.dataset.undo && !confirm('Anulați marcarea ca trimisă?')) return; await api(`incidents/${b.dataset.id}/mark`, { body: { step: b.dataset.step, undo: !!b.dataset.undo } }); render(); },
  async 'inc-close'(b) { await api(`incidents/${b.dataset.id}/close`, { body: { reopen: !!b.dataset.reopen } }); render(); },
  async report() {
    const native = window.NIS2_NATIVE && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    const w = native ? null : window.open('', '_blank');
    const r = await api('report/link', { method: 'POST' });
    if (native) await native.open({ url: r.url }); else if (w) w.location = r.url; else location.href = r.url;
  },
  async 'push-on'() { await enablePush(); },
  member(b) {
    const { id, name, role, active } = b.dataset;
    const opt = (v, l) => `<option value="${v}" ${role === v ? 'selected' : ''}>${l}</option>`;
    $('#member-box').innerHTML = `<section class="card strong"><h2>${esc(name)}</h2><form data-form="member-save" data-id="${esc(id)}">
      ${field('m_role', 'Rol', `<select id="m_role" name="role">${opt('angajat', 'Angajat')}${opt('responsabil', 'Responsabil NIS2')}${opt('conducere', 'Conducere')}</select>`)}
      ${field('m_active', 'Stare', `<select id="m_active" name="active"><option value="1" ${active === '1' ? 'selected' : ''}>Activ</option><option value="0" ${active === '0' ? 'selected' : ''}>Dezactivat</option></select>`)}
      <button class="btn">Salvați</button></form><div class="gap"></div><button class="btn ghost" data-act="member-reset" data-id="${esc(id)}">Resetați accesul</button><div id="reset-box"></div></section>`;
    $('#member-box').scrollIntoView({ behavior: 'smooth' });
  },
  async 'member-reset'(b) {
    if (!confirm('Persoana va primi o parolă nouă și va configura din nou doi factori. Continuați?')) return;
    const r = await api(`team/${b.dataset.id}/reset`, { method: 'POST' });
    $('#reset-box').innerHTML = `<div class="gap"></div><p class="small">Parola temporară, afișată o singură dată:</p><p class="mono key">${esc(r.temp_password)}</p>`;
  },
};
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const fn = ACTS[b.dataset.act]; if (!fn) return;
  ev.preventDefault();
  if (b.tagName === 'BUTTON') b.disabled = true;
  try { await fn(b); } catch (e) { toast(e.message, true); }
  if (b.isConnected && b.tagName === 'BUTTON') b.disabled = false;
});
document.addEventListener('change', async (ev) => {
  const t = ev.target;
  try {
    if (t.dataset.upload) {
      const file = t.files[0]; if (!file) return;
      toast('Se încarcă...');
      await uploadFile(file, t.dataset.upload); toast('Fișier adăugat'); render(); return;
    }
    if (t.name === 'photo') { const n = $('#photo-name'); if (n) n.textContent = t.files[0] ? t.files[0].name : ''; return; }
    const metaForm = t.closest('[data-form="task-meta"]');
    if (metaForm) {
      const d = formData(metaForm);
      await api('tasks/' + metaForm.dataset.id, { method: 'PUT', body: { assignee_id: d.assignee_id || null, due_on: d.due_on || null } });
      toast('Salvat'); return;
    }
    if (t.dataset.actChange === 'consultant') { await api('company/plan', { body: { plan: t.checked ? 'consultant' : 'firma' } }); await loadMe(); toast(t.checked ? 'Acces permis' : 'Acces oprit'); return; }
    if (t.dataset.actChange === 'inc-personal') { await api('incidents/' + t.dataset.id, { method: 'PUT', body: { personal_data: t.checked } }); render(); return; }
    if (t.id === 'cui' && t.value.trim()) {
      const hint = $('#cui').parentElement;
      const r = await fetch('/api/cui/' + encodeURIComponent(t.value.trim()));
      let s = $('.hint', hint); if (!s) { s = document.createElement('span'); s.className = 'hint'; hint.append(s); }
      if (!r.ok) { s.textContent = 'CUI invalid. Verificați cifrele.'; return; }
      const j = await r.json();
      s.textContent = j.name ? `${j.name}${j.address ? ', ' + j.address : ''}` : 'CUI corect. Completați numele firmei.';
      if (j.name && !$('#company_name').value) $('#company_name').value = j.name;
    }
  } catch (e) { toast(e.message, true); }
});

// ---------- rutare ----------
const OPEN_ROUTES = { login: viewLogin, signup: viewSignup, join: viewJoin };
let renderSeq = 0;
async function render() {
  clearInterval(timer);
  const seq = ++renderSeq;
  const [route, arg] = (location.hash.slice(1) || 'panou').split('/');
  try {
    if (!meta) meta = await api('meta');
    if (OPEN_ROUTES[route] && !store.token) { OPEN_ROUTES[route](); return; }
    if (!store.token) return go('login');
    if (route === 'mfa') return viewMfa();
    if (route === 'mfa-setup') { loading(); return await viewMfaSetup(); }
    if (!me) { loading(); await loadMe(); }
    if (seq !== renderSeq) return;
    if (OPEN_ROUTES[route]) return go('panou');
    if (!me.company) return;
    const views = {
      panou: viewDashboard, incadrare: viewAssess, masuri: viewMeasures, masura: viewMeasure, sarcina: viewTask,
      politici: viewPolicies, politica: viewPolicy, 'incident-nou': viewIncidentNew, incidente: viewIncidents, incident: viewIncident,
      raport: viewReport, jurnal: viewAudit, cont: viewAccount, echipa: viewTeam, email: viewMail,
    };
    if (me.user.role === 'angajat' && ['incadrare', 'masuri', 'masura', 'raport', 'jurnal', 'echipa', 'email'].includes(route)) return go('panou');
    await (views[route] || viewDashboard)(arg);
    window.scrollTo(0, 0);
    tick(); timer = setInterval(tick, 1000);
  } catch (e) {
    if (['auth', 'mfa_verify', 'mfa_setup'].includes(e.code)) return;
    errorView(e);
  }
}
window.addEventListener('hashchange', render);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
