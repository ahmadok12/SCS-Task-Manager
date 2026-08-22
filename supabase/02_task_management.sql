begin;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references public.profiles(id) on delete set null,
  due_date date,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid() references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;
grant select, insert, update, delete on public.tasks to authenticated;

create policy tasks_team_select on public.tasks for select to authenticated
using ((select auth.uid()) is not null);
create policy tasks_team_insert on public.tasks for insert to authenticated
with check ((select auth.uid()) = created_by);
create policy tasks_team_update on public.tasks for update to authenticated
using ((select auth.uid()) is not null)
with check ((select auth.uid()) is not null);
create policy tasks_team_delete on public.tasks for delete to authenticated
using ((select auth.uid()) is not null);

create index tasks_inquiry_id_idx on public.tasks(inquiry_id);
create index tasks_assigned_to_idx on public.tasks(assigned_to);
create index tasks_status_idx on public.tasks(status);
create index tasks_due_date_open_idx on public.tasks(due_date) where status <> 'done';
create index tasks_created_by_idx on public.tasks(created_by);

create trigger tasks_updated_at before update on public.tasks
for each row execute function private.set_updated_at();

create or replace function private.set_task_completed_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then new.completed_at = now(); end if;
  if new.status <> 'done' then new.completed_at = null; end if;
  return new;
end;
$$;
create trigger tasks_completed_at before update of status on public.tasks
for each row execute function private.set_task_completed_at();

create or replace function private.create_default_inquiry_tasks()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.tasks (inquiry_id,title,assigned_to,sort_order,created_by) values
    (new.id,'Review inquiry details',new.assigned_to,10,new.created_by),
    (new.id,'Source suitable suppliers',new.assigned_to,20,new.created_by),
    (new.id,'Prepare quotation',new.assigned_to,30,new.created_by),
    (new.id,'Share quotation with customer',new.assigned_to,40,new.created_by),
    (new.id,'Follow up with customer',new.assigned_to,50,new.created_by);
  return new;
end;
$$;
create trigger inquiry_default_tasks after insert on public.inquiries
for each row execute function private.create_default_inquiry_tasks();

alter table public.notifications add column if not exists task_id uuid references public.tasks(id) on delete cascade;
create index if not exists notifications_task_id_idx on public.notifications(task_id);

create or replace function private.notify_task_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); inquiry_number bigint;
begin
  if actor is null or new.assigned_to is null or new.assigned_to = actor then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  select inquiry_no into inquiry_number from public.inquiries where id = new.inquiry_id;
  insert into public.notifications(recipient_id,actor_id,inquiry_id,task_id,kind,title,message)
  values(new.assigned_to,actor,new.inquiry_id,new.id,'task_assigned','New task assigned',new.title || ' · INQ-' || lpad(inquiry_number::text,4,'0'));
  return new;
end;
$$;
revoke all on function private.notify_task_assignment() from public, anon, authenticated;
create trigger task_assignment_notification after insert or update of assigned_to on public.tasks
for each row execute function private.notify_task_assignment();

insert into public.tasks(inquiry_id,title,assigned_to,sort_order,created_by)
select i.id, template.title, i.assigned_to, template.sort_order, i.created_by
from public.inquiries i
cross join (values
  ('Review inquiry details',10),
  ('Source suitable suppliers',20),
  ('Prepare quotation',30),
  ('Share quotation with customer',40),
  ('Follow up with customer',50)
) as template(title,sort_order)
where not exists (select 1 from public.tasks t where t.inquiry_id = i.id);

commit;
