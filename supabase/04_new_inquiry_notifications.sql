begin;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
check (kind in ('comment','assignment','system','task_assigned','task_done','new_inquiry'));

create or replace function private.notify_team_on_new_inquiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  customer_label text;
begin
  if actor is null or actor <> new.created_by then return new; end if;

  select coalesce(nullif(full_name, ''), email, 'A team member')
  into actor_name from public.profiles where id = actor;

  customer_label := new.person_name || case
    when nullif(btrim(new.company_name), '') is not null then ' · ' || new.company_name
    else '' end;

  insert into public.notifications (recipient_id, actor_id, inquiry_id, kind, title, message)
  select p.id, actor, new.id, 'new_inquiry',
         'New inquiry · INQ-' || lpad(new.inquiry_no::text, 4, '0'),
         coalesce(actor_name, 'A team member') || ' added ' || customer_label
  from public.profiles p;

  return new;
end;
$$;

revoke all on function private.notify_team_on_new_inquiry() from public, anon, authenticated;

drop trigger if exists new_inquiry_notifications on public.inquiries;
create trigger new_inquiry_notifications
after insert on public.inquiries
for each row execute function private.notify_team_on_new_inquiry();

create or replace function private.create_default_inquiry_tasks()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform set_config('scs.skip_task_assignment_notification', 'on', true);
  insert into public.tasks (inquiry_id,title,assigned_to,sort_order,created_by) values
    (new.id,'Review inquiry details',new.assigned_to,10,new.created_by),
    (new.id,'Source suitable suppliers',new.assigned_to,20,new.created_by),
    (new.id,'Prepare quotation',new.assigned_to,30,new.created_by),
    (new.id,'Share quotation with customer',new.assigned_to,40,new.created_by),
    (new.id,'Follow up with customer',new.assigned_to,50,new.created_by);
  perform set_config('scs.skip_task_assignment_notification', 'off', true);
  return new;
end;
$$;

create or replace function private.notify_task_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); inquiry_number bigint;
begin
  if current_setting('scs.skip_task_assignment_notification', true) = 'on' then return new; end if;
  if actor is null or new.assigned_to is null or new.assigned_to = actor then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  select inquiry_no into inquiry_number from public.inquiries where id = new.inquiry_id;
  insert into public.notifications(recipient_id,actor_id,inquiry_id,task_id,kind,title,message)
  values(new.assigned_to,actor,new.inquiry_id,new.id,'task_assigned','New task assigned',new.title || ' · INQ-' || lpad(inquiry_number::text,4,'0'));
  return new;
end;
$$;

revoke all on function private.notify_task_assignment() from public, anon, authenticated;

commit;
