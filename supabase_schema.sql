-- Supabase/Postgres schema for DigitalDent
create extension if not exists pgcrypto;

-- ===== Enums =====
create type if not exists public.role as enum (
  'ADMIN',
  'TECHNICIAN',
  'CLINIC_ADMIN',
  'DENTIST',
  'LAB',
  'CLIENT'
);

create type if not exists public.work_type as enum (
  'PROTESIS',
  'CORONA_ZIRCONIA',
  'CORONA_A_PERNO',
  'MODELO_IMPRESO',
  'TERMINACION_1_A_5',
  'TERMINACION_6_A_10',
  'REPARACION',
  'PROVISORIO',
  'GANCHO_LABRADO'
);

create type if not exists public.work_extra as enum (
  'TABLETA',
  'GANCHO_LABRADO'
);

create type if not exists public.work_order_status as enum (
  'CREATED',
  'IN_PROGRESS',
  'DONE',
  'DELIVERED'
);

create type if not exists public.work_order_file_type as enum (
  'PHOTO',
  'SCAN',
  'STL',
  'OTHER'
);

create type if not exists public.appointment_status as enum (
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW'
);

create type if not exists public.invoice_status as enum (
  'PENDING',
  'PAID',
  'CANCELLED'
);

create type if not exists public.payment_status as enum (
  'PENDING',
  'COMPLETED',
  'FAILED'
);

create type if not exists public.notification_channel as enum (
  'EMAIL',
  'IN_APP'
);

-- ===== Core tables =====
create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.labs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  email text,
  name text,
  role public.role not null default 'CLIENT',
  "clinicId" uuid,
  "labId" uuid,
  "clientId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint user_profiles_auth_fk foreign key (id) references auth.users(id) on delete cascade,
  constraint user_profiles_clinic_fk foreign key ("clinicId") references public.clinics(id) on delete set null,
  constraint user_profiles_lab_fk foreign key ("labId") references public.labs(id) on delete set null,
  constraint user_profiles_client_fk foreign key ("clientId") references public.clients(id) on delete set null
);

create unique index if not exists user_profiles_email_key on public.user_profiles (email);
create index if not exists user_profiles_role_idx on public.user_profiles (role);
create index if not exists user_profiles_clinic_idx on public.user_profiles ("clinicId");
create index if not exists user_profiles_lab_idx on public.user_profiles ("labId");
create index if not exists user_profiles_client_idx on public.user_profiles ("clientId");

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  message text,
  source text,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists patients_name_idx on public.patients (name);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  "sequentialNumber" integer not null default 0,
  "displayCode" text not null,
  status public.work_order_status not null default 'CREATED',
  "dentistId" uuid not null,
  "labId" uuid,
  "patientId" uuid not null,
  "clientId" uuid,
  "doctorId" uuid,
  "clinicId" uuid,
  "workType" public.work_type,
  extras public.work_extra[] not null default '{}',
  price numeric(10,2),
  "dueDate" timestamptz,
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint work_orders_dentist_fk foreign key ("dentistId") references public.user_profiles(id) on delete restrict,
  constraint work_orders_lab_fk foreign key ("labId") references public.labs(id) on delete set null,
  constraint work_orders_patient_fk foreign key ("patientId") references public.patients(id) on delete restrict,
  constraint work_orders_client_fk foreign key ("clientId") references public.clients(id) on delete set null,
  constraint work_orders_doctor_fk foreign key ("doctorId") references public.user_profiles(id) on delete set null,
  constraint work_orders_clinic_fk foreign key ("clinicId") references public.clinics(id) on delete set null
);

create index if not exists work_orders_seq_idx on public.work_orders ("sequentialNumber");
create index if not exists work_orders_status_idx on public.work_orders (status);
create index if not exists work_orders_dentist_idx on public.work_orders ("dentistId");
create index if not exists work_orders_patient_idx on public.work_orders ("patientId");
create index if not exists work_orders_client_idx on public.work_orders ("clientId");
create index if not exists work_orders_lab_idx on public.work_orders ("labId");
create index if not exists work_orders_clinic_idx on public.work_orders ("clinicId");
create index if not exists work_orders_created_idx on public.work_orders ("createdAt");
create index if not exists work_orders_status_created_idx on public.work_orders (status, "createdAt");

create table if not exists public.work_order_events (
  id uuid primary key default gen_random_uuid(),
  "workOrderId" uuid not null,
  type text not null,
  message text not null,
  metadata jsonb,
  "createdAt" timestamptz not null default now(),
  constraint work_order_events_order_fk foreign key ("workOrderId") references public.work_orders(id) on delete cascade
);

create index if not exists work_order_events_order_idx on public.work_order_events ("workOrderId");
create index if not exists work_order_events_created_idx on public.work_order_events ("createdAt");

create table if not exists public.work_order_files (
  id uuid primary key default gen_random_uuid(),
  "workOrderId" uuid not null,
  kind public.work_order_file_type not null,
  url text not null,
  size integer not null,
  mime text not null,
  "uploadedBy" text,
  "createdAt" timestamptz not null default now(),
  constraint work_order_files_order_fk foreign key ("workOrderId") references public.work_orders(id) on delete cascade
);

create index if not exists work_order_files_order_idx on public.work_order_files ("workOrderId");

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  "patientId" uuid not null,
  "dentistId" uuid not null,
  "startsAt" timestamptz not null,
  "endsAt" timestamptz not null,
  treatment text,
  notes text,
  status public.appointment_status not null default 'SCHEDULED',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint appointments_patient_fk foreign key ("patientId") references public.patients(id) on delete restrict,
  constraint appointments_dentist_fk foreign key ("dentistId") references public.user_profiles(id) on delete restrict
);

create index if not exists appointments_starts_idx on public.appointments ("startsAt");
create index if not exists appointments_patient_idx on public.appointments ("patientId");
create index if not exists appointments_dentist_idx on public.appointments ("dentistId");

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  "clientId" uuid not null,
  "workOrderId" uuid,
  amount numeric(10,2) not null,
  currency text not null default 'USD',
  "dueAt" timestamptz not null,
  status public.invoice_status not null default 'PENDING',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint invoices_client_fk foreign key ("clientId") references public.user_profiles(id) on delete restrict,
  constraint invoices_work_order_fk foreign key ("workOrderId") references public.work_orders(id) on delete set null
);

create index if not exists invoices_client_idx on public.invoices ("clientId");
create index if not exists invoices_work_order_idx on public.invoices ("workOrderId");
create index if not exists invoices_status_idx on public.invoices (status);
create index if not exists invoices_created_idx on public.invoices ("createdAt");
create index if not exists invoices_client_status_idx on public.invoices ("clientId", status);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  "invoiceId" uuid not null,
  provider text not null,
  "providerRef" text not null default '',
  amount numeric(10,2) not null,
  status public.payment_status not null default 'COMPLETED',
  "createdAt" timestamptz not null default now(),
  constraint payments_invoice_fk foreign key ("invoiceId") references public.invoices(id) on delete cascade
);

create index if not exists payments_invoice_idx on public.payments ("invoiceId");
create index if not exists payments_created_idx on public.payments ("createdAt");

create table if not exists public.account_entries (
  id uuid primary key default gen_random_uuid(),
  "clientId" uuid not null,
  "invoiceId" uuid not null,
  debit numeric(10,2) not null default 0,
  credit numeric(10,2) not null default 0,
  "balanceAfter" numeric(12,2) not null default 0,
  "createdAt" timestamptz not null default now(),
  constraint account_entries_client_fk foreign key ("clientId") references public.user_profiles(id) on delete restrict,
  constraint account_entries_invoice_fk foreign key ("invoiceId") references public.invoices(id) on delete cascade
);

create index if not exists account_entries_client_idx on public.account_entries ("clientId");
create index if not exists account_entries_invoice_idx on public.account_entries ("invoiceId");
create index if not exists account_entries_created_idx on public.account_entries ("createdAt");
create index if not exists account_entries_client_created_idx on public.account_entries ("clientId", "createdAt");

create table if not exists public.account_statements (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null,
  "workOrderId" uuid not null,
  amount numeric(10,2) not null,
  status text not null default 'PENDING',
  "createdAt" timestamptz not null default now(),
  constraint account_statements_user_fk foreign key ("userId") references public.user_profiles(id) on delete cascade,
  constraint account_statements_order_fk foreign key ("workOrderId") references public.work_orders(id) on delete cascade
);

create index if not exists account_statements_user_idx on public.account_statements ("userId");
create index if not exists account_statements_order_idx on public.account_statements ("workOrderId");

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null,
  channel public.notification_channel not null,
  title text not null,
  body text not null,
  metadata jsonb,
  read boolean not null default false,
  "createdAt" timestamptz not null default now(),
  constraint notifications_user_fk foreign key ("userId") references public.user_profiles(id) on delete cascade
);

create index if not exists notifications_user_idx on public.notifications ("userId");
create index if not exists notifications_created_idx on public.notifications ("createdAt");

-- ===== Store =====
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text,
  name text not null,
  description text,
  category text,
  price numeric(10,2) not null,
  currency text not null default 'USD',
  stock integer not null default 0,
  images jsonb not null default '[]'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create unique index if not exists products_sku_key on public.products (sku);

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null,
  total numeric(10,2) not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint carts_user_fk foreign key ("userId") references public.user_profiles(id) on delete cascade
);

create unique index if not exists carts_user_key on public.carts ("userId");

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  "cartId" uuid not null,
  "productId" uuid not null,
  qty integer not null default 1,
  "unitPrice" numeric(10,2) not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint cart_items_cart_fk foreign key ("cartId") references public.carts(id) on delete cascade,
  constraint cart_items_product_fk foreign key ("productId") references public.products(id) on delete restrict
);

create unique index if not exists cart_items_cart_product_key on public.cart_items ("cartId", "productId");

-- ===== updatedAt trigger =====
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$ language plpgsql;

-- Drop + recreate triggers to keep idempotent

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_patients_updated_at on public.patients;
create trigger trg_patients_updated_at
before update on public.patients
for each row execute function public.set_updated_at();

drop trigger if exists trg_work_orders_updated_at on public.work_orders;
create trigger trg_work_orders_updated_at
before update on public.work_orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_appointments_updated_at on public.appointments;
create trigger trg_appointments_updated_at
before update on public.appointments
for each row execute function public.set_updated_at();

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists trg_carts_updated_at on public.carts;
create trigger trg_carts_updated_at
before update on public.carts
for each row execute function public.set_updated_at();

drop trigger if exists trg_cart_items_updated_at on public.cart_items;
create trigger trg_cart_items_updated_at
before update on public.cart_items
for each row execute function public.set_updated_at();
