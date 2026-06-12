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
  sent_at timestamptz,
  viewed_at timestamptz,
  payload jsonb not null
);

alter table public.ppi_reports add column if not exists sent_at timestamptz;
alter table public.ppi_reports add column if not exists viewed_at timestamptz;

create index if not exists ppi_reports_updated_at_idx on public.ppi_reports (updated_at desc);
create index if not exists ppi_reports_vehicle_idx on public.ppi_reports (vehicle);
create index if not exists ppi_reports_customer_idx on public.ppi_reports (customer);
create index if not exists ppi_reports_vin_idx on public.ppi_reports (vin);

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.ppi_reports to service_role;

create table if not exists public.repair_orders (
  id text primary key,
  status text not null default 'estimates',
  customer text,
  vehicle text,
  repair_order text,
  estimate_id text,
  inspection_id text,
  inspection_type text,
  service_summary_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists repair_orders_updated_at_idx on public.repair_orders (updated_at desc);
create index if not exists repair_orders_status_idx on public.repair_orders (status);
create index if not exists repair_orders_customer_idx on public.repair_orders (customer);
create index if not exists repair_orders_vehicle_idx on public.repair_orders (vehicle);
create index if not exists repair_orders_repair_order_idx on public.repair_orders (repair_order);

grant select, insert, update, delete on table public.repair_orders to service_role;

create table if not exists public.service_preps (
  id text primary key,
  service text,
  chassis text,
  trim text,
  engine text,
  transmission text,
  drivetrain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists service_preps_updated_at_idx on public.service_preps (updated_at desc);
create index if not exists service_preps_service_idx on public.service_preps (service);
create index if not exists service_preps_match_idx on public.service_preps (chassis, trim, engine, transmission, drivetrain);

grant select, insert, update, delete on table public.service_preps to service_role;

insert into storage.buckets (id, name, public)
values ('ppi-photos', 'ppi-photos', true)
on conflict (id) do update set public = true;

notify pgrst, 'reload schema';
