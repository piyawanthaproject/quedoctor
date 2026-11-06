-- Patients can cancel their own appointment before they arrive, then book again.
create or replace function public.cancel_appointment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['patient']::user_role[]);
  update appointments a set status = 'cancelled'
   where a.id = p_id
     and a.status in ('booked', 'skipped')
     and exists (select 1 from patients p where p.id = a.patient_id and p.user_id = auth.uid());
  if not found then raise exception 'INVALID_STATUS'; end if;
  perform log_action('cancel', 'appointments', p_id);
end $$;

revoke execute on function public.cancel_appointment(uuid) from public, anon;
grant execute on function public.cancel_appointment(uuid) to authenticated, service_role;
