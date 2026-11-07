-- Contul de e-mail al firmei pentru alerte (SMTP). Parola e criptata cu DATA_KEY.
ALTER TABLE companies ADD COLUMN mail_host TEXT;
ALTER TABLE companies ADD COLUMN mail_port INTEGER;
ALTER TABLE companies ADD COLUMN mail_user TEXT;
ALTER TABLE companies ADD COLUMN mail_from TEXT;
ALTER TABLE companies ADD COLUMN mail_pass TEXT;
ALTER TABLE companies ADD COLUMN mail_ok_at INTEGER;
ALTER TABLE companies ADD COLUMN mail_fail_at INTEGER;
