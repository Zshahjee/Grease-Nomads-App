create table if not exists public.ppi_reports (
  id text primary key,
  report_number text,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  public_path text,
  vehicle text,
  customer text,
  vin text,
  action text,
  risk text,
  payload jsonb not null
);

create index if not exists ppi_reports_updated_at_idx on public.ppi_reports (updated_at desc);
create index if not exists ppi_reports_vehicle_idx on public.ppi_reports (vehicle);
create index if not exists ppi_reports_customer_idx on public.ppi_reports (customer);
create index if not exists ppi_reports_vin_idx on public.ppi_reports (vin);

insert into storage.buckets (id, name, public)
values ('ppi-photos', 'ppi-photos', true)
on conflict (id) do update set public = true;

