-- Repairs order-creation permissions without disabling RLS.
-- Safe to run after 01_schema.sql and 02_activate_first_admin.sql.

begin;

create or replace function private.tm_current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.tm_profiles as p
  where p.id = (select auth.uid())
    and p.is_active = true
  limit 1
$$;

revoke all on function private.tm_current_role() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.tm_current_role() to authenticated;

drop policy if exists tm_orders_insert on public.tm_orders;
create policy tm_orders_insert
on public.tm_orders
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and (select private.tm_current_role()) in ('admin', 'sourcing')
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

grant select, insert, update, delete on public.tm_orders to authenticated;
alter table public.tm_orders enable row level security;

commit;

-- This should show your signed-up account as active admin or sourcing.
select p.full_name, u.email, p.role, p.is_active
from public.tm_profiles as p
join auth.users as u on u.id = p.id
where p.role in ('admin', 'sourcing')
order by p.created_at;
