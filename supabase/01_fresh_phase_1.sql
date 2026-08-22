begin;

-- Phase 1 starts fresh. Authentication accounts are intentionally preserved.
drop table if exists public.tm_order_comments cascade;
drop table if exists public.tm_payments cascade;
drop table if exists public.tm_quotes cascade;
drop table if exists public.tm_order_vendors cascade;
drop table if exists public.tm_vendors cascade;
drop table if exists public.tm_customers cascade;
drop table if exists public.tm_attachments cascade;
drop table if exists public.tm_order_events cascade;
drop table if exists public.tm_order_messages cascade;
drop table if exists public.tm_task_assignees cascade;
drop table if exists public.tm_tasks cascade;
drop table if exists public.tm_order_products cascade;
drop table if exists public.tm_orders cascade;
drop table if exists public.tm_board_stages cascade;
drop table if exists public.tm_profiles cascade;

drop table if exists public.notifications cascade;
drop table if exists public.inquiry_comments cascade;
drop table if exists public.inquiry_files cascade;
drop table if exists public.inquiry_items cascade;
drop table if exists public.inquiries cascade;
drop table if exists public.profiles cascade;
drop schema if exists private cascade;

create schema private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  inquiry_no bigint generated always as identity unique,
  status text not null default 'new' check (status in ('new','contacted','quoted','won','lost','on_hold')),
  person_name text not null,
  company_name text not null default '',
  mobile text not null default '',
  email text not null default '',
  customer_address text not null default '',
  delivery_address text not null default '',
  quote_amount numeric(14,2),
  quote_currency text not null default 'USD',
  quote_notes text not null default '',
  payment_notes text not null default '',
  source text not null default '',
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inquiry_items (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  product_name text not null,
  quantity numeric(14,3),
  quantity_unit text not null default 'pcs',
  details text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inquiry_files (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  file_kind text not null check (file_kind in ('client_photo','shared_photo','quote','payment_proof','other')),
  file_name text not null,
  object_key text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.inquiry_comments (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 3000),
  author_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  inquiry_id uuid references public.inquiries(id) on delete cascade,
  comment_id uuid references public.inquiry_comments(id) on delete cascade,
  kind text not null default 'comment' check (kind in ('comment','assignment','system')),
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  unique(recipient_id, comment_id)
);

create index inquiries_status_idx on public.inquiries(status);
create index inquiries_updated_at_idx on public.inquiries(updated_at desc);
create index inquiries_assigned_to_idx on public.inquiries(assigned_to);
create index inquiries_created_by_idx on public.inquiries(created_by);
create index inquiry_items_inquiry_id_idx on public.inquiry_items(inquiry_id);
create index inquiry_files_inquiry_id_idx on public.inquiry_files(inquiry_id);
create index inquiry_files_uploaded_by_idx on public.inquiry_files(uploaded_by);
create index inquiry_comments_inquiry_id_idx on public.inquiry_comments(inquiry_id, created_at);
create index inquiry_comments_author_id_idx on public.inquiry_comments(author_id);
create index notifications_recipient_idx on public.notifications(recipient_id, is_read, created_at desc);
create index notifications_actor_id_idx on public.notifications(actor_id);
create index notifications_inquiry_id_idx on public.notifications(inquiry_id);
create index notifications_comment_id_idx on public.notifications(comment_id);

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger inquiries_updated_at before update on public.inquiries
for each row execute function private.set_updated_at();
create trigger inquiry_items_updated_at before update on public.inquiry_items
for each row execute function private.set_updated_at();
create trigger inquiry_comments_updated_at before update on public.inquiry_comments
for each row execute function private.set_updated_at();

create function private.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.email, ''),
    case when not exists (select 1 from public.profiles) then 'admin' else 'member' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.create_profile_for_auth_user() from public, anon, authenticated;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.create_profile_for_auth_user();

insert into public.profiles (id, full_name, email, role)
select id,
       coalesce(raw_user_meta_data ->> 'full_name', split_part(coalesce(email, ''), '@', 1)),
       coalesce(email, ''),
       'admin'
from auth.users
on conflict (id) do update set role = 'admin', email = excluded.email;

create function private.notify_team_on_comment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_name text;
  inquiry_label text;
begin
  select coalesce(nullif(full_name, ''), email, 'A team member') into actor_name
  from public.profiles where id = new.author_id;

  select 'INQ-' || lpad(inquiry_no::text, 4, '0') || ' · ' || person_name into inquiry_label
  from public.inquiries where id = new.inquiry_id;

  insert into public.notifications (recipient_id, actor_id, inquiry_id, comment_id, kind, title, message)
  select p.id, new.author_id, new.inquiry_id, new.id, 'comment',
         'New comment on ' || inquiry_label,
         actor_name || ': ' || left(new.body, 180)
  from public.profiles p;

  return new;
end;
$$;

revoke all on function private.notify_team_on_comment() from public, anon, authenticated;
create trigger inquiry_comment_notifications
after insert on public.inquiry_comments
for each row execute function private.notify_team_on_comment();

alter table public.profiles enable row level security;
alter table public.inquiries enable row level security;
alter table public.inquiry_items enable row level security;
alter table public.inquiry_files enable row level security;
alter table public.inquiry_comments enable row level security;
alter table public.notifications enable row level security;

create policy profiles_team_read on public.profiles for select to authenticated using ((select auth.uid()) is not null);
create policy profiles_self_update on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy inquiries_team_select on public.inquiries for select to authenticated using ((select auth.uid()) is not null);
create policy inquiries_team_insert on public.inquiries for insert to authenticated with check ((select auth.uid()) = created_by);
create policy inquiries_team_update on public.inquiries for update to authenticated
using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
create policy inquiries_team_delete on public.inquiries for delete to authenticated using ((select auth.uid()) is not null);

create policy inquiry_items_team_all on public.inquiry_items for all to authenticated
using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
create policy inquiry_files_team_select on public.inquiry_files for select to authenticated using ((select auth.uid()) is not null);
create policy inquiry_files_team_insert on public.inquiry_files for insert to authenticated with check ((select auth.uid()) = uploaded_by);
create policy inquiry_files_team_delete on public.inquiry_files for delete to authenticated using ((select auth.uid()) is not null);
create policy inquiry_comments_team_select on public.inquiry_comments for select to authenticated using ((select auth.uid()) is not null);
create policy inquiry_comments_team_insert on public.inquiry_comments for insert to authenticated with check ((select auth.uid()) = author_id);
create policy inquiry_comments_author_update on public.inquiry_comments for update to authenticated
using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy inquiry_comments_author_delete on public.inquiry_comments for delete to authenticated using ((select auth.uid()) = author_id);
create policy notifications_own_select on public.notifications for select to authenticated using ((select auth.uid()) = recipient_id);
create policy notifications_own_update on public.notifications for update to authenticated
using ((select auth.uid()) = recipient_id) with check ((select auth.uid()) = recipient_id);
create policy notifications_own_delete on public.notifications for delete to authenticated using ((select auth.uid()) = recipient_id);

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
grant select, insert, update, delete on public.inquiries to authenticated;
grant select, insert, update, delete on public.inquiry_items to authenticated;
grant select, insert, delete on public.inquiry_files to authenticated;
grant select, insert, update, delete on public.inquiry_comments to authenticated;
grant select, update, delete on public.notifications to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inquiry_comments'
  ) then
    alter publication supabase_realtime add table public.inquiry_comments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
