# Scut NIS2

Aplicație pentru firme: verifică dacă se aplică NIS2, urmărește cele 10 măsuri din Art. 21, păstrează dovezile, gestionează politicile și incidentele cu termene. Numele este provizoriu.

Aplicația ajută la organizarea conformității, dar nu o garantează și nu înlocuiește consultanța de specialitate.

## Structură

- `src/` server (Cloudflare Worker + D1)
- `public/app/` aplicația, folosită și în browser, și în aplicațiile native
- `public/consultant/` panoul consultantului
- `schema.sql` baza de date
- `tools/` unelte locale de administrare
- `tests/` teste (`e2e.mjs` pe serverul local, `smoke.mjs` pe producție)

## Date care nu sunt în acest repo

Repo-ul este public, deci nu intră în el: cheile (`.dev.vars`, `ops-key.txt`, `.prod-secrets.json`) și modelele de politici (`content/`). Modelele se încarcă în baza de date cu `tools/incarca-politici.mjs`.

## Dezvoltare

```bash
npm install
npx wrangler d1 execute nis2-app --local --file=schema.sql
npx wrangler dev --port 8790
```

```bash
node tests/e2e.mjs http://127.0.0.1:8790
```
