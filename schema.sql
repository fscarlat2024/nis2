-- Scut NIS2 - baza de date (Cloudflare D1). Toate datele firmelor sunt izolate prin company_id.
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cui TEXT NOT NULL,
  name TEXT NOT NULL,
  sector TEXT, employees TEXT, turnover TEXT, special INTEGER DEFAULT 0,
  classification TEXT,               -- esentiala | importanta | neinclusa | verificare
  plan TEXT NOT NULL DEFAULT 'evaluare',  -- evaluare | firma | consultant
  trial_until INTEGER,               -- ms; perioada de proba
  paid_until INTEGER,                -- ms; setat doar dupa o plata confirmata
  incident_email TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,  -- NULL = consultant NCS
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,                -- responsabil | conducere | angajat | consultant
  pass_hash TEXT NOT NULL,
  totp_secret TEXT,                  -- criptat cu DATA_KEY
  totp_on INTEGER NOT NULL DEFAULT 0,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_ok INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  label TEXT,
  created_by INTEGER,
  expires_at INTEGER NOT NULL,
  used_by INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  measure TEXT NOT NULL,             -- a..j, x = obligatii de baza (nu intra in scor)
  title TEXT NOT NULL,
  detail TEXT,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_on TEXT,                       -- AAAA-LL-ZZ
  status TEXT NOT NULL DEFAULT 'deschisa', -- deschisa | finalizata
  done_at INTEGER, done_by INTEGER,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id, measure);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  details TEXT,
  reported_by INTEGER,
  reported_at INTEGER NOT NULL,
  significant INTEGER,               -- NULL = neevaluat, 0 = nu, 1 = da
  aware_at INTEGER,                  -- momentul constatarii incidentului semnificativ
  personal_data INTEGER NOT NULL DEFAULT 0,
  early_sent_at INTEGER, notif_sent_at INTEGER, final_sent_at INTEGER,
  closed_at INTEGER,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_company ON incidents(company_id, reported_at);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  incident_id INTEGER REFERENCES incidents(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  blob BLOB NOT NULL,
  uploaded_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_task ON evidence(task_id);
CREATE INDEX IF NOT EXISTS idx_evidence_incident ON evidence(incident_id);

-- modelele de politici se incarca separat (tools/incarca-politici.mjs); textele nu sunt in repo-ul public
CREATE TABLE IF NOT EXISTS policy_templates (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  measure TEXT,
  body TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ciorna', -- ciorna | asteapta | aprobata
  version INTEGER NOT NULL DEFAULT 1,
  edited_by INTEGER,
  approved_by INTEGER, approved_at INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS policy_reads (
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (policy_id, user_id, version)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER,
  user_id INTEGER,
  user_label TEXT,
  action TEXT NOT NULL,
  target TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log(company_id, at);

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT, auth TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders_sent (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS report_links (
  token_hash TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
