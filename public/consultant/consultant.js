// Panoul NCS: vede doar firmele care au ales planul cu consultant. Doar citire; fiecare consultare intra in jurnalul firmei.
const root = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = ''; try { token = localStorage.getItem('nis2_token') || ''; } catch {}
const CLASS = { esentiala: 'Esențială', importanta: 'Importantă', neinclusa: 'Neinclusă', verificare: 'De verificat' };
const fmt = (ms) => ms ? new Date(ms).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' }) : '-';
async function api(p) {
  const r = await fetch('/api/' + p, { headers: { authorization: 'Bearer ' + token } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || d.code === 'mfa_verify' || d.code === 'mfa_setup') { location.href = '/app/'; throw new Error('auth'); }
  if (!r.ok) throw new Error(d.error || 'Eroare');
  return d;
}
async function list() {
  const d = await api('panel/companies');
  root.innerHTML = `<main class="page"><div class="top"><div><h1>Firmele mele</h1><span class="muted">Doar firmele care au ales planul cu consultant</span></div><button class="link" id="out">Ieșiți</button></div>
  ${d.items.length ? `<div class="scrollx"><table><thead><tr><th scope="col">Firma</th><th scope="col">Încadrare</th><th scope="col">Scor</th><th scope="col">Întârzieri</th><th scope="col">Incidente deschise</th></tr></thead><tbody>
  ${d.items.map((c) => `<tr><td><a href="#${c.id}">${esc(c.name)}</a><br><span class="small muted">CUI ${esc(c.cui)}</span></td><td>${esc(CLASS[c.classification] || '-')}</td><td class="mono">${c.score}%</td><td class="${c.late ? 'red' : ''}">${c.late}</td><td class="${c.open_incidents ? 'red' : ''}">${c.open_incidents}</td></tr>`).join('')}
  </tbody></table></div>` : '<p class="muted">Nicio firmă nu a ales încă planul cu consultant.</p>'}</main>`;
  document.getElementById('out').onclick = async () => {
    await fetch('/api/logout', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
    try { localStorage.removeItem('nis2_token'); } catch {}
    location.href = '/app/';
  };
}
async function detail(id) {
  const d = await api('panel/companies/' + id);
  root.innerHTML = `<main class="page"><a class="back" href="#">Înapoi la firme</a><h1>${esc(d.company.name)}</h1><p class="muted">Scor ${d.score}% · ${esc(CLASS[d.company.classification] || 'Încadrare necompletată')}</p>
  <h2>Măsuri</h2><div class="list">${d.measures.map((m) => `<div class="list-row"><span class="grow">(${esc(m.id)}) ${esc(m.name)}</span><span class="mono small">${m.done} din ${m.total}</span></div>`).join('')}</div>
  <h2>Sarcini deschise</h2><div class="list">${d.open_tasks.map((t) => `<div class="list-row"><span class="grow">${esc(t.title)}</span><span class="small muted">${esc(t.due_on || 'fără termen')}</span></div>`).join('') || '<p class="muted list-row">Nimic deschis.</p>'}</div>
  <h2>Incidente</h2><div class="list">${d.incidents.map((i) => `<div class="list-row"><span class="grow">#${i.seq} ${esc(i.kind)}<span class="small muted">${esc(fmt(i.reported_at))}${i.closed_at ? ', închis' : ''}</span></span><span class="small ${i.significant ? 'red' : 'muted'}">${i.significant === null ? 'De evaluat' : i.significant ? 'Semnificativ' : 'Nesemnificativ'}</span></div>`).join('') || '<p class="muted list-row">Niciun incident.</p>'}</div></main>`;
}
async function render() {
  if (!token) { location.href = '/app/'; return; }
  const id = Number(location.hash.slice(1));
  try { await (id ? detail(id) : list()); } catch (e) { if (e.message !== 'auth') root.innerHTML = `<main class="page"><h1>Eroare</h1><p>${esc(e.message)}</p></main>`; }
}
addEventListener('hashchange', render);
render();
