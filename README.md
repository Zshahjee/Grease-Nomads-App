# Grease-Nomads-Pre-Purchase-Inspection-

Render-ready Grease Nomads pre-purchase inspection app.

## Supabase setup

Run `supabase-schema.sql` in the Supabase SQL editor, then add these Render environment variables:

- `SUPABASE_URL`: your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: your Supabase service role key, kept private on Render
- `SUPABASE_REPORTS_TABLE`: `ppi_reports`
- `SUPABASE_PHOTO_BUCKET`: `ppi-photos`

If those variables are not set, the backend falls back to local disk storage in `data/reports`.
