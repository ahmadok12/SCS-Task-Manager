begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
create policy push_subscriptions_own_select on public.push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy push_subscriptions_own_insert on public.push_subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy push_subscriptions_own_update on public.push_subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy push_subscriptions_own_delete on public.push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at before update on public.push_subscriptions for each row execute function private.set_updated_at();

alter table public.notifications add column if not exists push_sent_at timestamptz;

create table if not exists private.push_config (
  singleton boolean primary key default true check (singleton),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

create or replace function public.get_push_config()
returns table(public_key text, private_key text)
language sql security definer set search_path = '' stable
as $$ select c.public_key, c.private_key from private.push_config c where c.singleton = true limit 1 $$;
revoke all on function public.get_push_config() from public, anon, authenticated;
grant execute on function public.get_push_config() to service_role;

create or replace function public.set_push_config(p_public_key text, p_private_key text)
returns void language sql security definer set search_path = ''
as $$ insert into private.push_config(singleton,public_key,private_key) values(true,p_public_key,p_private_key) on conflict(singleton) do nothing $$;
revoke all on function public.set_push_config(text,text) from public, anon, authenticated;
grant execute on function public.set_push_config(text,text) to service_role;

create or replace function public.claim_push_notification(p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n public.notifications%rowtype; subscriptions jsonb;
begin
  select * into n from public.notifications where id=p_notification_id for update;
  if n.id is null or n.push_sent_at is not null then return null; end if;
  update public.notifications set push_sent_at=now() where id=n.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth))),'[]'::jsonb)
  into subscriptions from public.push_subscriptions s where s.user_id=n.recipient_id;
  return jsonb_build_object('notification',jsonb_build_object('id',n.id,'title',n.title,'message',n.message,'inquiry_id',n.inquiry_id,'kind',n.kind),'subscriptions',subscriptions);
end;
$$;
revoke all on function public.claim_push_notification(uuid) from public, anon, authenticated;
grant execute on function public.claim_push_notification(uuid) to service_role;

create or replace function public.remove_push_subscription(p_subscription_id uuid)
returns void language sql security definer set search_path = '' as $$ delete from public.push_subscriptions where id=p_subscription_id $$;
revoke all on function public.remove_push_subscription(uuid) from public, anon, authenticated;
grant execute on function public.remove_push_subscription(uuid) to service_role;

drop trigger if exists notification_push_delivery on public.notifications;
drop function if exists private.enqueue_push_notification();

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  title text not null,
  details text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.activity_events enable row level security;
grant select on public.activity_events to authenticated;
create policy activity_events_team_select on public.activity_events for select to authenticated using ((select auth.uid()) is not null);
create index if not exists activity_events_inquiry_created_idx on public.activity_events(inquiry_id,created_at desc);
create index if not exists activity_events_actor_id_idx on public.activity_events(actor_id);

create or replace function private.log_inquiry_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); changes text[] := array[]::text[];
begin
  if tg_op='INSERT' then
    insert into public.activity_events(inquiry_id,actor_id,event_type,title,details) values(new.id,coalesce(actor,new.created_by),'inquiry_created','Inquiry created',new.person_name || case when nullif(new.company_name,'') is not null then ' · '||new.company_name else '' end);
    return new;
  end if;
  if actor is null then return new; end if;
  if old.status is distinct from new.status then changes:=array_append(changes,'Status: '||old.status||' → '||new.status); end if;
  if old.priority is distinct from new.priority then changes:=array_append(changes,'Priority: '||old.priority||' → '||new.priority); end if;
  if old.assigned_to is distinct from new.assigned_to then changes:=array_append(changes,'Order assignee changed'); end if;
  if old.person_name is distinct from new.person_name then changes:=array_append(changes,'Customer name updated'); end if;
  if old.company_name is distinct from new.company_name then changes:=array_append(changes,'Company updated'); end if;
  if old.mobile is distinct from new.mobile then changes:=array_append(changes,'Mobile updated'); end if;
  if old.email is distinct from new.email then changes:=array_append(changes,'Email updated'); end if;
  if old.customer_address is distinct from new.customer_address then changes:=array_append(changes,'Customer address updated'); end if;
  if old.delivery_address is distinct from new.delivery_address then changes:=array_append(changes,'Delivery address updated'); end if;
  if old.quote_amount is distinct from new.quote_amount or old.quote_currency is distinct from new.quote_currency then changes:=array_append(changes,'Quote amount updated'); end if;
  if old.quote_notes is distinct from new.quote_notes then changes:=array_append(changes,'Quote notes updated'); end if;
  if old.payment_notes is distinct from new.payment_notes then changes:=array_append(changes,'Payment notes updated'); end if;
  if old.source is distinct from new.source then changes:=array_append(changes,'Inquiry source updated'); end if;
  if array_length(changes,1)>0 then insert into public.activity_events(inquiry_id,actor_id,event_type,title,details,metadata) values(new.id,actor,'inquiry_updated','Inquiry updated',array_to_string(changes,E'\n'),jsonb_build_object('changes',changes)); end if;
  return new;
end;
$$;

create or replace function private.log_product_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); row_data record;
begin
  if tg_op='DELETE' then row_data:=old; else row_data:=new; end if;
  if actor is null then return row_data; end if;
  insert into public.activity_events(inquiry_id,actor_id,event_type,title,details,metadata) values(row_data.inquiry_id,actor,'product_'||lower(tg_op),case tg_op when 'INSERT' then 'Product added' when 'UPDATE' then 'Product updated' else 'Product deleted' end,row_data.product_name,jsonb_build_object('product_id',row_data.id));
  return row_data;
end;
$$;

create or replace function private.log_file_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); row_data record;
begin
  if tg_op='DELETE' then row_data:=old; else row_data:=new; end if;
  if actor is null then return row_data; end if;
  insert into public.activity_events(inquiry_id,actor_id,event_type,title,details,metadata) values(row_data.inquiry_id,actor,'file_'||lower(tg_op),case tg_op when 'INSERT' then 'File uploaded' when 'UPDATE' then 'File replaced' else 'File deleted' end,row_data.file_name,jsonb_build_object('file_kind',row_data.file_kind,'file_id',row_data.id));
  return row_data;
end;
$$;

create or replace function private.log_comment_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_events(inquiry_id,actor_id,event_type,title,details,metadata) values(new.inquiry_id,new.author_id,'comment_added','Comment added',left(new.body,240),jsonb_build_object('comment_id',new.id)); return new;
end;
$$;

create or replace function private.log_task_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); row_data record; event_title text;
begin
  if tg_op='DELETE' then row_data:=old; else row_data:=new; end if;
  if actor is null or (tg_op='INSERT' and current_setting('scs.skip_task_assignment_notification',true)='on') then return row_data; end if;
  event_title:=case when tg_op='INSERT' then 'Task added' when tg_op='DELETE' then 'Task deleted' when old.status is distinct from new.status and new.status='done' then 'Task completed' when old.status is distinct from new.status and old.status='done' then 'Task reopened' else 'Task updated' end;
  insert into public.activity_events(inquiry_id,actor_id,event_type,title,details,metadata) values(row_data.inquiry_id,actor,'task_'||lower(tg_op),event_title,row_data.title,jsonb_build_object('task_id',row_data.id,'status',row_data.status,'assigned_to',row_data.assigned_to));
  return row_data;
end;
$$;

revoke all on function private.log_inquiry_activity(),private.log_product_activity(),private.log_file_activity(),private.log_comment_activity(),private.log_task_activity() from public,anon,authenticated;
drop trigger if exists inquiry_activity_log on public.inquiries;
create trigger inquiry_activity_log after insert or update on public.inquiries for each row execute function private.log_inquiry_activity();
drop trigger if exists product_activity_log on public.inquiry_items;
create trigger product_activity_log after insert or update or delete on public.inquiry_items for each row execute function private.log_product_activity();
drop trigger if exists file_activity_log on public.inquiry_files;
create trigger file_activity_log after insert or update or delete on public.inquiry_files for each row execute function private.log_file_activity();
drop trigger if exists comment_activity_log on public.inquiry_comments;
create trigger comment_activity_log after insert on public.inquiry_comments for each row execute function private.log_comment_activity();
drop trigger if exists task_activity_log on public.tasks;
create trigger task_activity_log after insert or update or delete on public.tasks for each row execute function private.log_task_activity();

insert into public.activity_events(inquiry_id,actor_id,event_type,title,details,created_at)
select i.id,i.created_by,'inquiry_created','Inquiry created',i.person_name || case when nullif(i.company_name,'') is not null then ' · '||i.company_name else '' end,i.created_at
from public.inquiries i where not exists(select 1 from public.activity_events a where a.inquiry_id=i.id and a.event_type='inquiry_created');

commit;
