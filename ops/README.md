# Hostinger Rollout Artifacts

These files are checked in as the concrete deployment templates for the raw clip segment ingest rollout.

- `cron/ingest-clip-segments.cron` contains the cron line for the VPS.
- `logrotate/ingest-clip-segments` contains the `/var/log/ingest-clip-segments.log` rotation policy.

The actual VPS setup still needs to be applied on the Hostinger server with the correct `.env`, service-account JSON path, and Supabase migration.