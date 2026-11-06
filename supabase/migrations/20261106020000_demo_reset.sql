-- Demo accounts (@khiumor.demo) can clear their open appointments at any stage and start over.
-- Real patient accounts cannot call this.
create or replace function public.demo_reset_my_appointments() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform require_role(array['patient']::user_role[]);
  if not exists (select 1 from auth.users u where u.id = auth.uid() and u.email like '%@khiumor.demo') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update appointments a
     set status = 'cancelled', worsened_at = null, worsened_flags = null
   where a.status not in ('done', 'cancelled')
     and exists (select 1 from patients p where p.id = a.patient_id and p.user_id = auth.uid());
  get diagnostics n = row_count;
  perform log_action('demo_reset', 'appointments', null, jsonb_build_object('count', n));
  return n;
end $$;

revoke execute on function public.demo_reset_my_appointments() from public, anon;
grant execute on function public.demo_reset_my_appointments() to authenticated, service_role;
