-- Ce alerte au plecat de fapt pentru un incident. NULL = incident raportat inainte de aceasta evidenta.
ALTER TABLE incidents ADD COLUMN notify_targets INTEGER;
ALTER TABLE incidents ADD COLUMN notify_push INTEGER;
ALTER TABLE incidents ADD COLUMN notify_email INTEGER;
