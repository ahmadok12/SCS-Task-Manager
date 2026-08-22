-- Structured sourcing operations: customers, vendors, quotes, payments and comments.
-- Safe to run after 01_schema.sql. Preserves all existing tm_ data.

begin;

create table if not exists public.tm_customers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 2 and 160),
  contact_name text,
  email text,
  phone text,
  country text,
  city text,
  address text,
  notes text,
  created_by uuid not null references public.tm_profiles(id),
  updated_by uuid not null references public.tm_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tm_vendors (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 2 and 180),
  contact_name text,
  email text,
  phone text,
  wechat text,
  country text not null default 'China',
  product_categories text[] not null default '{}',
  rating numeric(2,1) check (rating is null or rating between 0 and 5),
  notes text,
  created_by uuid not null references public.tm_profiles(id),
  updated_by uuid not null references public.tm_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tm_orders add column if not exists customer_id uuid;
alter table public.tm_orders add column if not exists order_type text not null default 'standard_sourcing';
alter table public.tm_orders add column if not exists status text not null default 'inquiry_received';
alter table public.tm_orders add column if not exists status_updated_at timestamptz not null default now();
alter table public.tm_orders add column if not exists next_action text;
alter table public.tm_orders add column if not exists next_action_owner_id uuid;
alter table public.tm_orders add column if not exists next_action_due date;
alter table public.tm_orders add column if not exists quantity text;
alter table public.tm_orders add column if not exists target_price numeric(14,4);
alter table public.tm_orders add column if not exists currency text not null default 'USD';
alter table public.tm_orders add column if not exists destination_country text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tm_orders_customer_id_fkey'
      and conrelid = 'public.tm_orders'::regclass
  ) then
    alter table public.tm_orders
      add constraint tm_orders_customer_id_fkey
      foreign key (customer_id) references public.tm_customers(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tm_orders_next_action_owner_id_fkey'
      and conrelid = 'public.tm_orders'::regclass
  ) then
    alter table public.tm_orders
      add constraint tm_orders_next_action_owner_id_fkey
      foreign key (next_action_owner_id) references public.tm_profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tm_orders_order_type_check'
      and conrelid = 'public.tm_orders'::regclass
  ) then
    alter table public.tm_orders add constraint tm_orders_order_type_check
      check (order_type in ('standard_sourcing','private_label','custom_manufacturing','sample','packaging','inspection','shipping'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tm_orders_status_check'
      and conrelid = 'public.tm_orders'::regclass
  ) then
    alter table public.tm_orders add constraint tm_orders_status_check
      check (status in (
        'inquiry_received','requirements_confirmed','vendor_search','quote_requested',
        'vendor_quote_received','quote_prepared','quote_sent','customer_revision',
        'quote_confirmed','payment_requested','payment_received','order_placed',
        'production','quality_inspection','shipping','completed','cancelled'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tm_orders_currency_check'
      and conrelid = 'public.tm_orders'::regclass
  ) then
    alter table public.tm_orders add constraint tm_orders_currency_check
      check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

alter table public.tm_tasks add column if not exists waiting_on text;
alter table public.tm_tasks add column if not exists expected_date date;

create table if not exists public.tm_order_vendors (
  order_id text not null references public.tm_orders(id) on delete cascade,
  vendor_id uuid not null references public.tm_vendors(id) on delete cascade,
  status text not null default 'considering'
    check (status in ('considering','contacted','quoted','selected','rejected')),
  notes text,
  added_by uuid not null references public.tm_profiles(id),
  created_at timestamptz not null default now(),
  primary key (order_id, vendor_id)
);

create table if not exists public.tm_quotes (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.tm_orders(id) on delete cascade,
  vendor_id uuid references public.tm_vendors(id) on delete set null,
  quote_type text not null check (quote_type in ('vendor','customer')),
  status text not null default 'draft'
    check (status in ('draft','requested','received','prepared','sent','revised','confirmed','rejected')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  unit_price numeric(14,4) check (unit_price is null or unit_price >= 0),
  total_amount numeric(14,2) check (total_amount is null or total_amount >= 0),
  moq text,
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  payment_terms text,
  packaging text,
  shipping_terms text,
  margin_percent numeric(7,3) check (margin_percent is null or margin_percent between -100 and 1000),
  valid_until date,
  notes text,
  created_by uuid not null references public.tm_profiles(id),
  updated_by uuid not null references public.tm_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tm_quotes_vendor_type_check check (
    (quote_type = 'vendor' and vendor_id is not null) or quote_type = 'customer'
  )
);

create table if not exists public.tm_payments (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.tm_orders(id) on delete cascade,
  direction text not null check (direction in ('customer_receipt','vendor_payment')),
  status text not null default 'expected'
    check (status in ('expected','received','paid','cancelled')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  due_date date,
  paid_at timestamptz,
  reference text,
  notes text,
  created_by uuid not null references public.tm_profiles(id),
  updated_by uuid not null references public.tm_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tm_order_comments (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.tm_orders(id) on delete cascade,
  author_id uuid not null references public.tm_profiles(id),
  body text not null check (char_length(body) between 1 and 6000),
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cover foreign keys and common dashboard filters.
create index if not exists tm_customers_created_by_idx on public.tm_customers(created_by);
create index if not exists tm_customers_updated_by_idx on public.tm_customers(updated_by);
create index if not exists tm_customers_company_idx on public.tm_customers(company_name);
create index if not exists tm_vendors_created_by_idx on public.tm_vendors(created_by);
create index if not exists tm_vendors_updated_by_idx on public.tm_vendors(updated_by);
create index if not exists tm_vendors_company_idx on public.tm_vendors(company_name);
create index if not exists tm_orders_customer_idx on public.tm_orders(customer_id);
create index if not exists tm_orders_owner_idx on public.tm_orders(owner_id);
create index if not exists tm_orders_created_by_idx on public.tm_orders(created_by);
create index if not exists tm_orders_updated_by_idx on public.tm_orders(updated_by);
create index if not exists tm_orders_next_action_owner_idx on public.tm_orders(next_action_owner_id);
create index if not exists tm_orders_status_created_idx on public.tm_orders(status, created_at desc);
create index if not exists tm_orders_next_action_due_idx on public.tm_orders(next_action_due) where next_action_due is not null;
create index if not exists tm_tasks_stage_idx on public.tm_tasks(stage_id);
create index if not exists tm_tasks_created_by_idx on public.tm_tasks(created_by);
create index if not exists tm_tasks_updated_by_idx on public.tm_tasks(updated_by);
create index if not exists tm_task_assignees_assigned_by_idx on public.tm_task_assignees(assigned_by);
create index if not exists tm_messages_author_idx on public.tm_order_messages(author_id);
create index if not exists tm_events_actor_idx on public.tm_order_events(actor_id);
create index if not exists tm_attachments_uploader_idx on public.tm_attachments(uploader_id);
create index if not exists tm_order_vendors_vendor_idx on public.tm_order_vendors(vendor_id);
create index if not exists tm_order_vendors_added_by_idx on public.tm_order_vendors(added_by);
create index if not exists tm_quotes_order_created_idx on public.tm_quotes(order_id, created_at desc);
create index if not exists tm_quotes_vendor_idx on public.tm_quotes(vendor_id);
create index if not exists tm_quotes_created_by_idx on public.tm_quotes(created_by);
create index if not exists tm_quotes_updated_by_idx on public.tm_quotes(updated_by);
create index if not exists tm_payments_order_created_idx on public.tm_payments(order_id, created_at desc);
create index if not exists tm_payments_created_by_idx on public.tm_payments(created_by);
create index if not exists tm_payments_updated_by_idx on public.tm_payments(updated_by);
create index if not exists tm_comments_order_created_idx on public.tm_order_comments(order_id, created_at desc);
create index if not exists tm_comments_author_idx on public.tm_order_comments(author_id);

drop trigger if exists tm_customers_touch on public.tm_customers;
create trigger tm_customers_touch before update on public.tm_customers
for each row execute function private.tm_touch_updated_at();
drop trigger if exists tm_vendors_touch on public.tm_vendors;
create trigger tm_vendors_touch before update on public.tm_vendors
for each row execute function private.tm_touch_updated_at();
drop trigger if exists tm_quotes_touch on public.tm_quotes;
create trigger tm_quotes_touch before update on public.tm_quotes
for each row execute function private.tm_touch_updated_at();
drop trigger if exists tm_payments_touch on public.tm_payments;
create trigger tm_payments_touch before update on public.tm_payments
for each row execute function private.tm_touch_updated_at();
drop trigger if exists tm_comments_touch on public.tm_order_comments;
create trigger tm_comments_touch before update on public.tm_order_comments
for each row execute function private.tm_touch_updated_at();

create or replace function private.tm_can_manage_commercial(p_order_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (select private.tm_current_role()) in ('admin','sourcing')
    and (select private.tm_can_access_order(p_order_id))
$$;

revoke execute on function private.tm_can_manage_commercial(text) from public, anon;
grant execute on function private.tm_can_manage_commercial(text) to authenticated;

create or replace function private.tm_log_sourcing_event()
returns trigger language plpgsql security definer set search_path = public,pg_temp
as $$
declare
  v_order_id text;
  v_description text;
  v_type text;
begin
  v_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  if tg_table_name = 'tm_order_comments' then
    v_type := case when tg_op = 'DELETE' then 'comment_deleted' else 'comment_added' end;
    v_description := case when tg_op = 'DELETE'
      then 'A permanent comment was deleted'
      else coalesce((select full_name from public.tm_profiles where id = new.author_id),'Team member') || ' added a permanent comment'
    end;
  elsif tg_table_name = 'tm_quotes' then
    v_type := 'quote_' || lower(case when tg_op = 'DELETE' then old.status else new.status end);
    v_description := initcap(case when tg_op = 'DELETE' then old.quote_type else new.quote_type end)
      || ' quote ' || case when tg_op = 'DELETE' then 'deleted' else 'saved as ' || new.status end;
  else
    v_type := 'payment_' || lower(case when tg_op = 'DELETE' then old.status else new.status end);
    v_description := case when tg_op = 'DELETE' then 'Payment record deleted'
      else initcap(replace(new.direction,'_',' ')) || ' recorded as ' || new.status
    end;
  end if;

  insert into public.tm_order_events(order_id,actor_id,event_type,description,metadata)
  values(
    v_order_id,
    (select auth.uid()),
    v_type,
    v_description,
    jsonb_build_object('record_id',case when tg_op = 'DELETE' then old.id else new.id end)
  );
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists tm_comment_event on public.tm_order_comments;
create trigger tm_comment_event after insert or delete on public.tm_order_comments
for each row execute function private.tm_log_sourcing_event();
drop trigger if exists tm_quote_event on public.tm_quotes;
create trigger tm_quote_event after insert or update of status or delete on public.tm_quotes
for each row execute function private.tm_log_sourcing_event();
drop trigger if exists tm_payment_event on public.tm_payments;
create trigger tm_payment_event after insert or update of status or delete on public.tm_payments
for each row execute function private.tm_log_sourcing_event();

create or replace function private.tm_log_order_workflow_event()
returns trigger language plpgsql security definer set search_path = public,pg_temp
as $$
begin
  if old.status is distinct from new.status then
    new.status_updated_at := now();
    insert into public.tm_order_events(order_id,actor_id,event_type,description,metadata)
    values(
      new.id,(select auth.uid()),'status_changed',
      'Order status changed to ' || replace(new.status,'_',' '),
      jsonb_build_object('from',old.status,'to',new.status)
    );
  end if;
  if old.next_action is distinct from new.next_action
    or old.next_action_owner_id is distinct from new.next_action_owner_id
    or old.next_action_due is distinct from new.next_action_due then
    insert into public.tm_order_events(order_id,actor_id,event_type,description,metadata)
    values(
      new.id,(select auth.uid()),'next_action_updated',
      'Next action updated: ' || coalesce(new.next_action,'Not set'),
      jsonb_build_object('owner_id',new.next_action_owner_id,'due',new.next_action_due)
    );
  end if;
  return new;
end $$;

drop trigger if exists tm_order_workflow_event on public.tm_orders;
create trigger tm_order_workflow_event before update of status,next_action,next_action_owner_id,next_action_due
on public.tm_orders for each row execute function private.tm_log_order_workflow_event();

alter table public.tm_customers enable row level security;
alter table public.tm_vendors enable row level security;
alter table public.tm_order_vendors enable row level security;
alter table public.tm_quotes enable row level security;
alter table public.tm_payments enable row level security;
alter table public.tm_order_comments enable row level security;

drop policy if exists tm_customers_read on public.tm_customers;
create policy tm_customers_read on public.tm_customers for select to authenticated
using ((select private.tm_is_active_member()));
drop policy if exists tm_customers_insert on public.tm_customers;
create policy tm_customers_insert on public.tm_customers for insert to authenticated
with check ((select private.tm_current_role()) in ('admin','sourcing') and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
drop policy if exists tm_customers_update on public.tm_customers;
create policy tm_customers_update on public.tm_customers for update to authenticated
using ((select private.tm_current_role()) in ('admin','sourcing'))
with check ((select private.tm_current_role()) in ('admin','sourcing') and updated_by=(select auth.uid()));
drop policy if exists tm_customers_delete on public.tm_customers;
create policy tm_customers_delete on public.tm_customers for delete to authenticated
using ((select private.tm_current_role())='admin');

drop policy if exists tm_vendors_read on public.tm_vendors;
create policy tm_vendors_read on public.tm_vendors for select to authenticated
using ((select private.tm_current_role()) in ('admin','sourcing'));
drop policy if exists tm_vendors_insert on public.tm_vendors;
create policy tm_vendors_insert on public.tm_vendors for insert to authenticated
with check ((select private.tm_current_role()) in ('admin','sourcing') and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
drop policy if exists tm_vendors_update on public.tm_vendors;
create policy tm_vendors_update on public.tm_vendors for update to authenticated
using ((select private.tm_current_role()) in ('admin','sourcing'))
with check ((select private.tm_current_role()) in ('admin','sourcing') and updated_by=(select auth.uid()));
drop policy if exists tm_vendors_delete on public.tm_vendors;
create policy tm_vendors_delete on public.tm_vendors for delete to authenticated
using ((select private.tm_current_role())='admin');

drop policy if exists tm_order_vendors_read on public.tm_order_vendors;
create policy tm_order_vendors_read on public.tm_order_vendors for select to authenticated
using ((select private.tm_can_manage_commercial(order_id)));
drop policy if exists tm_order_vendors_insert on public.tm_order_vendors;
create policy tm_order_vendors_insert on public.tm_order_vendors for insert to authenticated
with check ((select private.tm_can_manage_commercial(order_id)) and added_by=(select auth.uid()));
drop policy if exists tm_order_vendors_update on public.tm_order_vendors;
create policy tm_order_vendors_update on public.tm_order_vendors for update to authenticated
using ((select private.tm_can_manage_commercial(order_id)))
with check ((select private.tm_can_manage_commercial(order_id)));
drop policy if exists tm_order_vendors_delete on public.tm_order_vendors;
create policy tm_order_vendors_delete on public.tm_order_vendors for delete to authenticated
using ((select private.tm_can_manage_commercial(order_id)));

drop policy if exists tm_quotes_read on public.tm_quotes;
create policy tm_quotes_read on public.tm_quotes for select to authenticated
using ((select private.tm_can_manage_commercial(order_id)));
drop policy if exists tm_quotes_insert on public.tm_quotes;
create policy tm_quotes_insert on public.tm_quotes for insert to authenticated
with check ((select private.tm_can_manage_commercial(order_id)) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
drop policy if exists tm_quotes_update on public.tm_quotes;
create policy tm_quotes_update on public.tm_quotes for update to authenticated
using ((select private.tm_can_manage_commercial(order_id)))
with check ((select private.tm_can_manage_commercial(order_id)) and updated_by=(select auth.uid()));
drop policy if exists tm_quotes_delete on public.tm_quotes;
create policy tm_quotes_delete on public.tm_quotes for delete to authenticated
using ((select private.tm_current_role())='admin');

drop policy if exists tm_payments_read on public.tm_payments;
create policy tm_payments_read on public.tm_payments for select to authenticated
using ((select private.tm_can_manage_commercial(order_id)));
drop policy if exists tm_payments_insert on public.tm_payments;
create policy tm_payments_insert on public.tm_payments for insert to authenticated
with check ((select private.tm_can_manage_commercial(order_id)) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
drop policy if exists tm_payments_update on public.tm_payments;
create policy tm_payments_update on public.tm_payments for update to authenticated
using ((select private.tm_can_manage_commercial(order_id)))
with check ((select private.tm_can_manage_commercial(order_id)) and updated_by=(select auth.uid()));
drop policy if exists tm_payments_delete on public.tm_payments;
create policy tm_payments_delete on public.tm_payments for delete to authenticated
using ((select private.tm_current_role())='admin');

drop policy if exists tm_comments_read on public.tm_order_comments;
create policy tm_comments_read on public.tm_order_comments for select to authenticated
using ((select private.tm_can_access_order(order_id)));
drop policy if exists tm_comments_insert on public.tm_order_comments;
create policy tm_comments_insert on public.tm_order_comments for insert to authenticated
with check ((select private.tm_can_access_order(order_id)) and author_id=(select auth.uid()));
drop policy if exists tm_comments_update on public.tm_order_comments;
create policy tm_comments_update on public.tm_order_comments for update to authenticated
using (author_id=(select auth.uid()) or (select private.tm_current_role())='admin')
with check ((select private.tm_can_access_order(order_id)) and (author_id=(select auth.uid()) or (select private.tm_current_role())='admin'));
drop policy if exists tm_comments_delete on public.tm_order_comments;
create policy tm_comments_delete on public.tm_order_comments for delete to authenticated
using (author_id=(select auth.uid()) or (select private.tm_current_role())='admin');

-- Remove overlapping SELECT policies from the original setup.
drop policy if exists tm_profiles_admin_all on public.tm_profiles;
drop policy if exists tm_profiles_admin_update on public.tm_profiles;
create policy tm_profiles_admin_update on public.tm_profiles for update to authenticated
using ((select private.tm_current_role())='admin')
with check ((select private.tm_current_role())='admin');
drop policy if exists tm_profiles_admin_delete on public.tm_profiles;
create policy tm_profiles_admin_delete on public.tm_profiles for delete to authenticated
using ((select private.tm_current_role())='admin');

drop policy if exists tm_stages_admin_all on public.tm_board_stages;
drop policy if exists tm_stages_admin_insert on public.tm_board_stages;
create policy tm_stages_admin_insert on public.tm_board_stages for insert to authenticated
with check ((select private.tm_current_role())='admin');
drop policy if exists tm_stages_admin_update on public.tm_board_stages;
create policy tm_stages_admin_update on public.tm_board_stages for update to authenticated
using ((select private.tm_current_role())='admin')
with check ((select private.tm_current_role())='admin');
drop policy if exists tm_stages_admin_delete on public.tm_board_stages;
create policy tm_stages_admin_delete on public.tm_board_stages for delete to authenticated
using ((select private.tm_current_role())='admin');

drop policy if exists tm_products_write on public.tm_order_products;
drop policy if exists tm_products_insert on public.tm_order_products;
create policy tm_products_insert on public.tm_order_products for insert to authenticated
with check ((select private.tm_current_role()) in ('admin','sourcing') and (select private.tm_can_access_order(order_id)));
drop policy if exists tm_products_update on public.tm_order_products;
create policy tm_products_update on public.tm_order_products for update to authenticated
using ((select private.tm_current_role()) in ('admin','sourcing') and (select private.tm_can_access_order(order_id)))
with check ((select private.tm_current_role()) in ('admin','sourcing') and (select private.tm_can_access_order(order_id)));
drop policy if exists tm_products_delete on public.tm_order_products;
create policy tm_products_delete on public.tm_order_products for delete to authenticated
using ((select private.tm_current_role()) in ('admin','sourcing') and (select private.tm_can_access_order(order_id)));

revoke all on public.tm_customers,public.tm_vendors,public.tm_order_vendors,public.tm_quotes,public.tm_payments,public.tm_order_comments from anon;
grant select,insert,update,delete on public.tm_customers,public.tm_vendors,public.tm_order_vendors,public.tm_quotes,public.tm_payments,public.tm_order_comments to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.tm_orders;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tm_order_comments;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tm_quotes;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tm_payments;
exception when duplicate_object then null; end $$;

commit;

