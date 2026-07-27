-- Insert Social Media
INSERT INTO "public"."products" ("name")
VALUES ('Social Media')
ON CONFLICT DO NOTHING;

-- Deactivate N/A
UPDATE "public"."products"
SET "active" = false
WHERE lower("name") = 'n/a' OR lower("name") = 'none';
