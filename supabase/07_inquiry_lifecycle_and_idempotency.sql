begin;

alter table public.inquiries add column if not exists client_request_id uuid;
alter table public.inquiries add column if not exists closed_at timestamptz;
alter table public.inquiries add column if not exists closed_by uuid references public.profiles(id) on delete set null;
alter table public.inquiries add column if not exists close_reason text not null default '';
alter table public.inquiries add column if not exists archived_at timestamptz;
alter table public.inquiries add column if not exists archived_by uuid references public.profiles(id) on delete set null;

create unique index if not exists inquiries_client_request_id_key
on public.inquiries(client_request_id);

create index if not exists inquiries_archived_at_idx on public.inquiries(archived_at, updated_at desc);
create index if not exists inquiries_closed_at_idx on public.inquiries(closed_at, updated_at desc);
create index if not exists inquiries_archived_by_idx on public.inquiries(archived_by);
create index if not exists inquiries_closed_by_idx on public.inquiries(closed_by);

create or replace function private.log_inquiry_lifecycle_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then return new; end if;
  if old.closed_at is null and new.closed_at is not null then
    insert into public.activity_events(inquiry_id,actor_id,event_type,title,details)
    values(new.id,actor,'inquiry_closed','Inquiry closed',coalesce(nullif(new.close_reason,''),'Buyer no longer interested'));
  elsif old.closed_at is not null and new.closed_at is null then
    insert into public.activity_events(inquiry_id,actor_id,event_type,title,details)
    values(new.id,actor,'inquiry_reopened','Inquiry reopened','Buyer interest restored');
  end if;
  if old.archived_at is null and new.archived_at is not null then
    insert into public.activity_events(inquiry_id,actor_id,event_type,title,details)
    values(new.id,actor,'inquiry_archived','Inquiry archived','Moved to archive');
  elsif old.archived_at is not null and new.archived_at is null then
    insert into public.activity_events(inquiry_id,actor_id,event_type,title,details)
    values(new.id,actor,'inquiry_restored','Inquiry restored','Returned from archive');
  end if;
  return new;
end;
$$;

revoke all on function private.log_inquiry_lifecycle_activity() from public, anon, authenticated;
drop trigger if exists inquiry_lifecycle_activity_log on public.inquiries;
create trigger inquiry_lifecycle_activity_log
after update of closed_at, archived_at on public.inquiries
for each row execute function private.log_inquiry_lifecycle_activity();

commit;
