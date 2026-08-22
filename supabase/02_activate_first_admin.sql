-- Run 01_schema.sql first.
-- Then use the portal's Create account screen to register your own account
-- and confirm the email. Replace the email below and run this file once.
-- All later team members sign up themselves and are approved inside Team.

update public.tm_profiles p
set role='admin', requested_role=null, is_active=true, updated_at=now()
from auth.users u
where p.id=u.id and lower(u.email)=lower('YOUR_ADMIN_EMAIL');

-- Verification: this should return one active administrator.
select p.full_name,u.email,p.role,p.is_active
from public.tm_profiles p
join auth.users u on u.id=p.id
where p.role='admin' and p.is_active=true;
