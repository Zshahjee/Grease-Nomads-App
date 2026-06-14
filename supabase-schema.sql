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
alter table public.ppi_reports add column if not exists repair_order_id text;
alter table public.ppi_reports add column if not exists customer_id text;
alter table public.ppi_reports add column if not exists vehicle_id text;

create index if not exists ppi_reports_updated_at_idx on public.ppi_reports (updated_at desc);
create index if not exists ppi_reports_vehicle_idx on public.ppi_reports (vehicle);
create index if not exists ppi_reports_customer_idx on public.ppi_reports (customer);
create index if not exists ppi_reports_vin_idx on public.ppi_reports (vin);
create index if not exists ppi_reports_repair_order_id_idx on public.ppi_reports (repair_order_id);
create index if not exists ppi_reports_customer_id_idx on public.ppi_reports (customer_id);
create index if not exists ppi_reports_vehicle_id_idx on public.ppi_reports (vehicle_id);

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
  customer_id text,
  vehicle_id text,
  job_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null
);

alter table public.repair_orders add column if not exists customer_id text;
alter table public.repair_orders add column if not exists vehicle_id text;
alter table public.repair_orders add column if not exists job_type text;

create index if not exists repair_orders_updated_at_idx on public.repair_orders (updated_at desc);
create index if not exists repair_orders_status_idx on public.repair_orders (status);
create index if not exists repair_orders_customer_idx on public.repair_orders (customer);
create index if not exists repair_orders_vehicle_idx on public.repair_orders (vehicle);
create index if not exists repair_orders_repair_order_idx on public.repair_orders (repair_order);
create index if not exists repair_orders_customer_id_idx on public.repair_orders (customer_id);
create index if not exists repair_orders_vehicle_id_idx on public.repair_orders (vehicle_id);
create index if not exists repair_orders_job_type_idx on public.repair_orders (job_type);

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

create table if not exists public.customers (
  id text primary key,
  name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists customers_name_idx on public.customers (name);
create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists customers_email_idx on public.customers (email);
grant select, insert, update, delete on table public.customers to service_role;

create table if not exists public.vehicles (
  id text primary key,
  customer_id text references public.customers(id) on delete set null,
  year_make_model text,
  vin text,
  mileage text,
  color text,
  trim text,
  engine text,
  transmission text,
  chassis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists vehicles_customer_id_idx on public.vehicles (customer_id);
create index if not exists vehicles_vin_idx on public.vehicles (vin);
create index if not exists vehicles_year_make_model_idx on public.vehicles (year_make_model);
grant select, insert, update, delete on table public.vehicles to service_role;

create table if not exists public.media_assets (
  id text primary key,
  repair_order_id text,
  customer_id text,
  vehicle_id text,
  module text,
  parent_id text,
  line_item_id text,
  label text,
  file_name text,
  file_type text,
  storage_path text,
  public_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists media_assets_repair_order_id_idx on public.media_assets (repair_order_id);
create index if not exists media_assets_customer_id_idx on public.media_assets (customer_id);
create index if not exists media_assets_vehicle_id_idx on public.media_assets (vehicle_id);
create index if not exists media_assets_module_idx on public.media_assets (module);
create index if not exists media_assets_parent_id_idx on public.media_assets (parent_id);
grant select, insert, update, delete on table public.media_assets to service_role;

insert into storage.buckets (id, name, public)
values ('ppi-photos', 'ppi-photos', true)
on conflict (id) do update set public = true;

notify pgrst, 'reload schema';
