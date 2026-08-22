begin;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
check (kind in ('comment','assignment','system','task_assigned','task_done'));

create or replace function private.notify_team_on_task_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  inquiry_label text;
begin
  if actor is null or old.status = 'done' or new.status <> 'done' then return new; end if;

  select coalesce(nullif(full_name, ''), email, 'A team member')
  into actor_name from public.profiles where id = actor;

  select 'INQ-' || lpad(inquiry_no::text, 4, '0') || ' · ' || person_name
  into inquiry_label from public.inquiries where id = new.inquiry_id;

  insert into public.notifications (recipient_id, actor_id, inquiry_id, task_id, kind, title, message)
  select p.id, actor, new.inquiry_id, new.id, 'task_done',
         'Task completed · ' || inquiry_label,
         coalesce(actor_name, 'A team member') || ' completed: ' || new.title
  from public.profiles p;

  return new;
end;
$$;

revoke all on function private.notify_team_on_task_completion() from public, anon, authenticated;

drop trigger if exists task_completion_notifications on public.tasks;
create trigger task_completion_notifications
after update of status on public.tasks
for each row
when (old.status is distinct from new.status and new.status = 'done')
execute function private.notify_team_on_task_completion();

commit;
