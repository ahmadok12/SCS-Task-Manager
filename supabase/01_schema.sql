-- SCS Task Management Portal
-- Isolated from the existing admin panel: all application tables start with tm_.

begin;

create schema if not exists private;

create table if not exists public.tm_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 100),
  initials text check (char_length(initials) between 1 and 4),
  role text not null default 'pending' check (role in ('pending','admin','sourcing','social','logistics')),
  requested_role text check (requested_role in ('sourcing','social','logistics')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keeps the setup rerunnable if an earlier portal schema was installed.
alter table public.tm_profiles add column if not exists requested_role text;
alter table public.tm_profiles alter column role set default 'pending';
alter table public.tm_profiles drop constraint if exists tm_profiles_role_check;
alter table public.tm_profiles add constraint tm_profiles_role_check check (role in ('pending','admin','sourcing','social','logistics'));
alter table public.tm_profiles drop constraint if exists tm_profiles_requested_role_check;
alter table public.tm_profiles add constraint tm_profiles_requested_role_check check (requested_role is null or requested_role in ('sourcing','social','logistics'));

create sequence if not exists private.tm_order_seq start with 1051;

create table if not exists public.tm_board_stages (
  id text primary key,
  name text not null check (char_length(name) between 1 and 80),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tm_orders (
  id text primary key,
  name text not null check (char_length(name) between 2 and 160),
  customer_name text not null,
  customer_company text,
  customer_phone text,
  customer_email text,
  delivery_address text not null,
  delivery_city text not null,
  owner_id uuid not null references public.tm_profiles(id),
  notes text,
  progress smallint not null default 5 check (progress between 0 and 100),
  created_by uuid not null references public.tm_profiles(id),
  updated_by uuid not null references public.tm_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tm_order_products (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.tm_orders(id) on delete cascade,
  name text not null,
  moq text,
  specifications text,
  image_url text,
  image_path text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tm_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.tm_orders(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 220),
  details text,
  team text not null check (team in ('sourcing','social','logistics')),
  stage_id text not null references public.tm_board_stages(id),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  due_date date,
  sort_order numeric(12,4) not null default 0,
  created_by uuid not null references public.tm_profiles(id),
  updated_by uuid not null references public.tm_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tm_task_assignees (
  task_id uuid not null references public.tm_tasks(id) on delete cascade,
  user_id uuid not null references public.tm_profiles(id) on delete cascade,
  assigned_by uuid not null references public.tm_profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (task_id,user_id)
);

create table if not exists public.tm_order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.tm_orders(id) on delete cascade,
  author_id uuid not null references public.tm_profiles(id),
  message text not null check (char_length(message) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.tm_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.tm_orders(id) on delete cascade,
  actor_id uuid references public.tm_profiles(id),
  event_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tm_tasks_order_idx on public.tm_tasks(order_id);
create index if not exists tm_tasks_team_stage_idx on public.tm_tasks(team,stage_id);
create index if not exists tm_tasks_due_idx on public.tm_tasks(due_date) where due_date is not null;
create index if not exists tm_assignees_user_idx on public.tm_task_assignees(user_id);
create index if not exists tm_messages_order_created_idx on public.tm_order_messages(order_id,created_at);
create index if not exists tm_events_order_created_idx on public.tm_order_events(order_id,created_at desc);
create index if not exists tm_products_order_idx on public.tm_order_products(order_id);

create or replace function private.tm_handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public,pg_temp
as $$
declare
  display_name text := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),split_part(coalesce(new.email,'Team member'),'@',1));
  requested text := case when new.raw_user_meta_data->>'requested_role' in ('sourcing','social','logistics') then new.raw_user_meta_data->>'requested_role' else 'sourcing' end;
begin
  insert into public.tm_profiles(id,full_name,initials,role,requested_role,is_active)
  values(new.id,display_name,upper(left(regexp_replace(display_name,'[^A-Za-z ]','','g'),1)),'pending',requested,false)
  on conflict(id) do nothing;
  return new;
end $$;

drop trigger if exists tm_create_pending_profile on auth.users;
create trigger tm_create_pending_profile after insert on auth.users for each row execute function private.tm_handle_new_auth_user();

create or replace function private.tm_current_role()
returns text language sql stable security definer set search_path = public,pg_temp
as $$ select role from public.tm_profiles where id = (select auth.uid()) and is_active limit 1 $$;

create or replace function private.tm_is_active_member()
returns boolean language sql stable security definer set search_path = public,pg_temp
as $$ select exists(select 1 from public.tm_profiles where id = (select auth.uid()) and is_active) $$;

create or replace function private.tm_next_order_id()
returns text language plpgsql volatile security definer set search_path = public,private,pg_temp
as $$
begin
  if not private.tm_is_active_member() then raise exception 'Not an active task portal member'; end if;
  return 'SCS-' || lpad(nextval('private.tm_order_seq')::text,4,'0');
end $$;

alter table public.tm_orders alter column id set default private.tm_next_order_id();

create or replace function private.tm_can_access_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public,pg_temp
as $$
  select private.tm_is_active_member() and exists (
    select 1 from public.tm_tasks t
    where t.id = p_task_id and (
      private.tm_current_role() = 'admin' or
      t.team = private.tm_current_role() or
      exists(select 1 from public.tm_task_assignees a where a.task_id=t.id and a.user_id=(select auth.uid()))
    )
  )
$$;

create or replace function private.tm_can_access_order(p_order_id text)
returns boolean language sql stable security definer set search_path = public,pg_temp
as $$
  select private.tm_is_active_member() and exists (
    select 1 from public.tm_orders o where o.id=p_order_id and (
      private.tm_current_role() in ('admin','sourcing') or o.owner_id=(select auth.uid()) or
      exists(select 1 from public.tm_tasks t where t.order_id=o.id and (
        t.team=private.tm_current_role() or
        exists(select 1 from public.tm_task_assignees a where a.task_id=t.id and a.user_id=(select auth.uid()))
      ))
    )
  )
$$;

create or replace function private.tm_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$ begin new.updated_at=now(); return new; end $$;

drop trigger if exists tm_profiles_touch on public.tm_profiles;
create trigger tm_profiles_touch before update on public.tm_profiles for each row execute function private.tm_touch_updated_at();
drop trigger if exists tm_stages_touch on public.tm_board_stages;
create trigger tm_stages_touch before update on public.tm_board_stages for each row execute function private.tm_touch_updated_at();
drop trigger if exists tm_orders_touch on public.tm_orders;
create trigger tm_orders_touch before update on public.tm_orders for each row execute function private.tm_touch_updated_at();
drop trigger if exists tm_tasks_touch on public.tm_tasks;
create trigger tm_tasks_touch before update on public.tm_tasks for each row execute function private.tm_touch_updated_at();

create or replace function private.tm_log_order_created()
returns trigger language plpgsql security definer set search_path = public,pg_temp
as $$ begin insert into public.tm_order_events(order_id,actor_id,event_type,description) values(new.id,(select auth.uid()),'order_created','Order created by '||coalesce((select full_name from public.tm_profiles where id=(select auth.uid())),'Team member')); return new; end $$;
drop trigger if exists tm_order_created_event on public.tm_orders;
create trigger tm_order_created_event after insert on public.tm_orders for each row execute function private.tm_log_order_created();

create or replace function private.tm_log_task_event()
returns trigger language plpgsql security definer set search_path = public,pg_temp
as $$
declare stage_name text;
begin
  select name into stage_name from public.tm_board_stages where id=new.stage_id;
  if tg_op='INSERT' then
    insert into public.tm_order_events(order_id,actor_id,event_type,description,metadata) values(new.order_id,(select auth.uid()),'task_created','Task “'||new.title||'” created in '||coalesce(stage_name,new.stage_id),jsonb_build_object('task_id',new.id));
  elsif old.stage_id is distinct from new.stage_id then
    insert into public.tm_order_events(order_id,actor_id,event_type,description,metadata) values(new.order_id,(select auth.uid()),'task_moved','Task “'||new.title||'” moved to '||coalesce(stage_name,new.stage_id),jsonb_build_object('task_id',new.id,'from',old.stage_id,'to',new.stage_id));
  end if;
  return new;
end $$;
drop trigger if exists tm_task_event on public.tm_tasks;
create trigger tm_task_event after insert or update of stage_id on public.tm_tasks for each row execute function private.tm_log_task_event();

create or replace function private.tm_log_message_event()
returns trigger language plpgsql security definer set search_path = public,pg_temp
as $$ begin insert into public.tm_order_events(order_id,actor_id,event_type,description,metadata) values(new.order_id,new.author_id,'message_posted',coalesce((select full_name from public.tm_profiles where id=new.author_id),'Team member')||' posted in order chat',jsonb_build_object('message_id',new.id)); return new; end $$;
drop trigger if exists tm_message_event on public.tm_order_messages;
create trigger tm_message_event after insert on public.tm_order_messages for each row execute function private.tm_log_message_event();

alter table public.tm_profiles enable row level security;
alter table public.tm_board_stages enable row level security;
alter table public.tm_orders enable row level security;
alter table public.tm_order_products enable row level security;
alter table public.tm_tasks enable row level security;
alter table public.tm_task_assignees enable row level security;
alter table public.tm_order_messages enable row level security;
alter table public.tm_order_events enable row level security;

drop policy if exists tm_profiles_read on public.tm_profiles;
create policy tm_profiles_read on public.tm_profiles for select to authenticated using (id=(select auth.uid()) or private.tm_current_role()='admin' or (is_active and private.tm_is_active_member()));
drop policy if exists tm_profiles_admin_all on public.tm_profiles;
create policy tm_profiles_admin_all on public.tm_profiles for all to authenticated using (private.tm_current_role()='admin') with check (private.tm_current_role()='admin');

drop policy if exists tm_stages_read on public.tm_board_stages;
create policy tm_stages_read on public.tm_board_stages for select to authenticated using (private.tm_is_active_member());
drop policy if exists tm_stages_admin_all on public.tm_board_stages;
create policy tm_stages_admin_all on public.tm_board_stages for all to authenticated using (private.tm_current_role()='admin') with check (private.tm_current_role()='admin');

drop policy if exists tm_orders_read on public.tm_orders;
create policy tm_orders_read on public.tm_orders for select to authenticated using (private.tm_can_access_order(id));
drop policy if exists tm_orders_insert on public.tm_orders;
create policy tm_orders_insert on public.tm_orders for insert to authenticated with check (private.tm_current_role() in ('admin','sourcing') and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
drop policy if exists tm_orders_update on public.tm_orders;
create policy tm_orders_update on public.tm_orders for update to authenticated using (private.tm_current_role() in ('admin','sourcing')) with check (private.tm_current_role() in ('admin','sourcing') and updated_by=(select auth.uid()));
drop policy if exists tm_orders_delete on public.tm_orders;
create policy tm_orders_delete on public.tm_orders for delete to authenticated using (private.tm_current_role()='admin');

drop policy if exists tm_products_read on public.tm_order_products;
create policy tm_products_read on public.tm_order_products for select to authenticated using (private.tm_can_access_order(order_id));
drop policy if exists tm_products_write on public.tm_order_products;
create policy tm_products_write on public.tm_order_products for all to authenticated using (private.tm_current_role() in ('admin','sourcing') and private.tm_can_access_order(order_id)) with check (private.tm_current_role() in ('admin','sourcing') and private.tm_can_access_order(order_id));

drop policy if exists tm_tasks_read on public.tm_tasks;
create policy tm_tasks_read on public.tm_tasks for select to authenticated using (private.tm_can_access_task(id));
drop policy if exists tm_tasks_insert on public.tm_tasks;
create policy tm_tasks_insert on public.tm_tasks for insert to authenticated with check (created_by=(select auth.uid()) and updated_by=(select auth.uid()) and private.tm_can_access_order(order_id) and (private.tm_current_role()='admin' or team=private.tm_current_role()));
drop policy if exists tm_tasks_update on public.tm_tasks;
create policy tm_tasks_update on public.tm_tasks for update to authenticated using (private.tm_can_access_task(id)) with check (updated_by=(select auth.uid()) and (private.tm_current_role()='admin' or team=private.tm_current_role()));
drop policy if exists tm_tasks_delete on public.tm_tasks;
create policy tm_tasks_delete on public.tm_tasks for delete to authenticated using (private.tm_current_role()='admin' or team=private.tm_current_role());

drop policy if exists tm_assignees_read on public.tm_task_assignees;
create policy tm_assignees_read on public.tm_task_assignees for select to authenticated using (private.tm_can_access_task(task_id));
drop policy if exists tm_assignees_insert on public.tm_task_assignees;
create policy tm_assignees_insert on public.tm_task_assignees for insert to authenticated with check (assigned_by=(select auth.uid()) and private.tm_can_access_task(task_id));
drop policy if exists tm_assignees_delete on public.tm_task_assignees;
create policy tm_assignees_delete on public.tm_task_assignees for delete to authenticated using (private.tm_can_access_task(task_id));

drop policy if exists tm_messages_read on public.tm_order_messages;
create policy tm_messages_read on public.tm_order_messages for select to authenticated using (private.tm_can_access_order(order_id));
drop policy if exists tm_messages_insert on public.tm_order_messages;
create policy tm_messages_insert on public.tm_order_messages for insert to authenticated with check (author_id=(select auth.uid()) and private.tm_can_access_order(order_id));
drop policy if exists tm_messages_delete on public.tm_order_messages;
create policy tm_messages_delete on public.tm_order_messages for delete to authenticated using (author_id=(select auth.uid()) or private.tm_current_role()='admin');

drop policy if exists tm_events_read on public.tm_order_events;
create policy tm_events_read on public.tm_order_events for select to authenticated using (private.tm_can_access_order(order_id));

revoke all on public.tm_profiles,public.tm_board_stages,public.tm_orders,public.tm_order_products,public.tm_tasks,public.tm_task_assignees,public.tm_order_messages,public.tm_order_events from anon;
grant select,insert,update,delete on public.tm_profiles,public.tm_board_stages,public.tm_orders,public.tm_order_products,public.tm_tasks,public.tm_task_assignees,public.tm_order_messages to authenticated;
grant select on public.tm_order_events to authenticated;
revoke all on function private.tm_current_role(),private.tm_is_active_member(),private.tm_next_order_id(),private.tm_can_access_task(uuid),private.tm_can_access_order(text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.tm_current_role(),private.tm_is_active_member(),private.tm_next_order_id(),private.tm_can_access_task(uuid),private.tm_can_access_order(text) to authenticated;

insert into public.tm_board_stages(id,name,sort_order) values
('inquiry','Inquiry received',0),('vendor','Sent to vendor',1),('quote','Quote received',2),('customer','Shared with customer',3),('approved','Quote approved',4),('payment','Payment received',5),('done','Completed',6)
on conflict (id) do nothing;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tm-product-images','tm-product-images',false,10485760,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists tm_images_read on storage.objects;
create policy tm_images_read on storage.objects for select to authenticated using (bucket_id='tm-product-images' and private.tm_can_access_order((storage.foldername(name))[1]));
drop policy if exists tm_images_insert on storage.objects;
create policy tm_images_insert on storage.objects for insert to authenticated with check (bucket_id='tm-product-images' and private.tm_can_access_order((storage.foldername(name))[1]));
drop policy if exists tm_images_update on storage.objects;
create policy tm_images_update on storage.objects for update to authenticated using (bucket_id='tm-product-images' and private.tm_can_access_order((storage.foldername(name))[1])) with check (bucket_id='tm-product-images' and private.tm_can_access_order((storage.foldername(name))[1]));
drop policy if exists tm_images_delete on storage.objects;
create policy tm_images_delete on storage.objects for delete to authenticated using (bucket_id='tm-product-images' and private.tm_can_access_order((storage.foldername(name))[1]));

do $$ begin
  alter publication supabase_realtime add table public.tm_tasks;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tm_order_messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tm_order_events;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tm_profiles;
exception when duplicate_object then null; end $$;

commit;
