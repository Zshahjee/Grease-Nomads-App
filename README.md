# Grease-Nomads-Pre-Purchase-Inspection-

Render-ready Grease Nomads pre-purchase inspection app.

## Supabase setup

Run `supabase-schema.sql` in the Supabase SQL editor, then add these Render environment variables:

- `SUPABASE_URL`: your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: your Supabase service role key, kept private on Render
- `SUPABASE_ANON_KEY`: your Supabase anon public key, used for email/password login
- `SUPABASE_REPORTS_TABLE`: `ppi_reports`
- `SUPABASE_PHOTO_BUCKET`: `ppi-photos`

If those variables are not set, the backend falls back to local disk storage in `data/reports`.

## Auth setup

In Supabase, create the technician login under Authentication > Users. Customer report links under `/report/...` stay public, but the dashboard, inspection form, report list, and report saving require a signed-in Supabase user when `SUPABASE_ANON_KEY` is set.
