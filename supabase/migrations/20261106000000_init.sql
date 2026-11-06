-- คิวหมอ (Khiu Mor) — initial schema
-- Outpatient appointments, nurse triage, vitals, doctor visits and an anonymised admin dashboard.
-- All writes go through SECURITY DEFINER functions that check the caller's role.
-- Patients never read the appointments table directly: they use get_my_appointments().

-- ───────────────────────── types ─────────────────────────
create type public.user_role as enum ('patient', 'nurse', 'doctor', 'admin');
create type public.appt_status as enum (
  'booked', 'checked_in', 'skipped', 'in_vitals', 'waiting_doctor', 'in_exam', 'done', 'referred', 'cancelled'
);
create type public.coverage as enum ('gold', 'sso', 'civil', 'private', 'self');

-- ───────────────────────── reference tables ─────────────────────────
create table public.departments (
  id text primary key,
  name_th text not null,
  name_en text not null,
  active boolean not null default true
);

create table public.clinic_settings (
  id int primary key default 1 check (id = 1),
  slot_minutes int not null default 30,
  slot_capacity int not null default 6,
  checkin_before_minutes int not null default 30,
  open_time time not null default '09:00',
  close_time time not null default '15:30'
);

-- Example claim ratios per coverage. Replace with the hospital finance team's real rules.
create table public.coverage_rates (
  coverage public.coverage primary key,
  claim_ratio numeric(4,3) not null check (claim_ratio between 0 and 1)
);

-- ───────────────────────── people ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role public.user_role not null default 'patient',
  full_name text,
  department_id text references public.departments
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users on delete set null,
  full_name text not null,
  gender text not null check (gender in ('F', 'M')),
  birth_date date,
  phone text,
  coverage public.coverage not null default 'self',
  chronic_diseases text,
  regular_meds text,
  drug_allergies text,
  emergency_contact text,
  created_at timestamptz not null default now()
);

-- ───────────────────────── visits ─────────────────────────
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients on delete cascade,
  visit_date date not null,
  slot_start time not null,
  queue_no text not null,
  department_id text references public.departments,      -- set by a nurse, never by the patient
  triage_level smallint check (triage_level between 1 and 5),
  status public.appt_status not null default 'booked',
  checked_in_at timestamptz,
  rescheduled_from time,
  worsened_at timestamptz,
  worsened_flags text[],
  booked_by uuid references auth.users,
  created_at timestamptz not null default now(),
  unique (visit_date, queue_no)
);
create index appointments_day_idx on public.appointments (visit_date, status, slot_start);

create table public.screenings (
  appointment_id uuid primary key references public.appointments on delete cascade,
  red_flags text[] not null default '{}',
  onset text,
  trend text,
  associated text[] not null default '{}',
  pregnant boolean not null default false,
  note text
);

create table public.symptom_reports (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments on delete cascade,
  body_part text not null,
  description text not null,          -- free text written by the patient
  severity smallint not null check (severity between 0 and 10)
);

create table public.triage_reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments on delete cascade,
  nurse_id uuid references auth.users,
  stage text not null check (stage in ('pre_visit', 'vitals', 'worsened')),
  criteria_level smallint not null check (criteria_level between 1 and 5),
  criteria_reasons jsonb not null default '[]',
  from_level smallint,
  final_level smallint not null check (final_level between 1 and 5),
  department_id text references public.departments,
  override_reason text,
  created_at timestamptz not null default now()
);

create table public.vital_signs (
  appointment_id uuid primary key references public.appointments on delete cascade,
  weight numeric(5,1), height numeric(5,1),
  bp_sys int, bp_dia int, pulse int,
  temperature numeric(4,1), spo2 int, blood_sugar int,
  recorded_by uuid references auth.users,
  recorded_at timestamptz not null default now()
);

create table public.visits (
  appointment_id uuid primary key references public.appointments on delete cascade,
  doctor_id uuid references auth.users,
  diagnosis text,                     -- free text written by the doctor
  icd10 text,
  treatment text,
  started_at timestamptz,
  finished_at timestamptz
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments on delete cascade,
  item_type text not null check (item_type in ('consult', 'medicine', 'procedure')),
  amount numeric(10,2) not null check (amount >= 0),
  coverage public.coverage not null,
  claimable numeric(10,2) not null,
  patient_paid numeric(10,2) not null
);

create table public.emergency_alerts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients on delete cascade,
  flags text[] not null,
  created_at timestamptz not null default now(),
  handled_by uuid references auth.users,
  handled_at timestamptz
);

create table public.audit_logs (
  id bigserial primary key,
  actor_id uuid references auth.users,
  action text not null,
  table_name text,
  record_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.local_now() returns timestamp
language sql stable as $$ select (now() at time zone 'Asia/Bangkok') $$;

create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from profiles where id = auth.uid() $$;

create or replace function public.is_clinical() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(my_role() in ('nurse', 'doctor'), false) $$;

create or replace function public.require_role(roles public.user_role[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if my_role() is null or not (my_role() = any (roles)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

create or replace function public.log_action(p_action text, p_table text, p_record uuid, p_detail jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (actor_id, action, table_name, record_id, detail)
  values (auth.uid(), p_action, p_table, p_record, p_detail)
$$;

-- new auth user → patient profile
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, role, full_name)
  values (new.id, 'patient', coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ───────────────────────── queue engine ─────────────────────────
-- Marks every booked appointment whose check-in deadline has passed as skipped.
-- Called lazily by the other functions; can also run from pg_cron every minute.
create or replace function public.skip_overdue() returns int
language plpgsql security definer set search_path = public as $$
declare
  s clinic_settings;
  n int;
begin
  select * into s from clinic_settings where id = 1;
  with upd as (
    update appointments a set status = 'skipped'
    where a.status = 'booked'
      and local_now() > a.visit_date + a.slot_start - make_interval(mins => s.checkin_before_minutes)
    returning a.id, a.queue_no, a.slot_start
  )
  insert into audit_logs (actor_id, action, table_name, record_id, detail)
  select null, 'auto_skip', 'appointments', id, jsonb_build_object('queue_no', queue_no, 'slot', slot_start) from upd;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.slot_availability(p_date date)
returns table (slot time, booked int, capacity int, checkin_deadline time, open boolean)
language sql stable security definer set search_path = public as $$
  with s as (select * from clinic_settings where id = 1)
  select g::time,
         (select count(*)::int from appointments a
           where a.visit_date = p_date and a.slot_start = g::time and a.status not in ('cancelled', 'referred')),
         s.slot_capacity,
         (g - make_interval(mins => s.checkin_before_minutes))::time,
         (p_date + g::time - make_interval(mins => s.checkin_before_minutes)) >= local_now()
  from s, generate_series('2000-01-01'::date + s.open_time, '2000-01-01'::date + s.close_time,
                          make_interval(mins => s.slot_minutes)) g
  order by 1
$$;

create or replace function public.book_appointment(p_date date, p_slot time, p_screening jsonb, p_symptoms jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_patient uuid;
  s clinic_settings;
  v_count int;
  v_seq int;
  v_id uuid;
begin
  perform require_role(array['patient']::user_role[]);
  select id into v_patient from patients where user_id = auth.uid();
  if v_patient is null then raise exception 'PROFILE_REQUIRED'; end if;
  if jsonb_array_length(coalesce(p_screening -> 'red_flags', '[]')) > 0 then raise exception 'RED_FLAG_EMERGENCY'; end if;

  select * into s from clinic_settings where id = 1;
  if p_slot < s.open_time or p_slot > s.close_time then raise exception 'SLOT_INVALID'; end if;
  if (p_date + p_slot - make_interval(mins => s.checkin_before_minutes)) < local_now() then raise exception 'SLOT_PASSED'; end if;

  perform pg_advisory_xact_lock(hashtext('book:' || p_date::text));
  select count(*) into v_count from appointments
   where visit_date = p_date and slot_start = p_slot and status not in ('cancelled', 'referred');
  if v_count >= s.slot_capacity then raise exception 'SLOT_FULL'; end if;
  if exists (select 1 from appointments where patient_id = v_patient and visit_date = p_date
             and status not in ('done', 'cancelled', 'referred')) then
    raise exception 'ALREADY_BOOKED';
  end if;

  select count(*) + 1 into v_seq from appointments where visit_date = p_date;
  insert into appointments (patient_id, visit_date, slot_start, queue_no, booked_by)
  values (v_patient, p_date, p_slot, 'Q' || lpad(v_seq::text, 3, '0'), auth.uid())
  returning id into v_id;

  insert into screenings (appointment_id, red_flags, onset, trend, associated, pregnant, note)
  values (v_id, '{}', p_screening ->> 'onset', p_screening ->> 'trend',
          coalesce(array(select jsonb_array_elements_text(p_screening -> 'associated')), '{}'),
          coalesce((p_screening ->> 'pregnant')::boolean, false),
          nullif(trim(p_screening ->> 'note'), ''));

  insert into symptom_reports (appointment_id, body_part, description, severity)
  select v_id, x ->> 'body_part', trim(x ->> 'description'), (x ->> 'severity')::smallint
  from jsonb_array_elements(coalesce(p_symptoms, '[]')) x
  where coalesce(trim(x ->> 'description'), '') <> '';

  perform log_action('book', 'appointments', v_id, jsonb_build_object('slot', p_slot));
  return v_id;
end $$;

-- Patient selected an emergency sign: no booking, nurse must call back.
create or replace function public.report_red_flags(p_flags text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_patient uuid; v_id uuid;
begin
  perform require_role(array['patient']::user_role[]);
  select id into v_patient from patients where user_id = auth.uid();
  if v_patient is null then raise exception 'PROFILE_REQUIRED'; end if;
  insert into emergency_alerts (patient_id, flags) values (v_patient, p_flags) returning id into v_id;
  perform log_action('red_flag', 'emergency_alerts', v_id, jsonb_build_object('count', cardinality(p_flags)));
  return v_id;
end $$;

create or replace function public.handle_alert(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['nurse']::user_role[]);
  update emergency_alerts set handled_by = auth.uid(), handled_at = now() where id = p_id and handled_at is null;
  perform log_action('alert_handled', 'emergency_alerts', p_id);
end $$;

create or replace function public.check_in(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a appointments;
  s clinic_settings;
  v_role user_role := my_role();
  v_next time;
begin
  perform skip_overdue();
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_role = 'patient' then
    if not exists (select 1 from patients where id = a.patient_id and user_id = auth.uid()) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif v_role is distinct from 'nurse' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if a.visit_date <> local_now()::date then raise exception 'NOT_TODAY'; end if;

  if a.status = 'booked' then
    update appointments set status = 'checked_in', checked_in_at = now() where id = p_id;
    perform log_action('check_in', 'appointments', p_id, jsonb_build_object('by', v_role));
    return jsonb_build_object('status', 'checked_in');
  elsif a.status = 'skipped' then
    select * into s from clinic_settings where id = 1;
    perform pg_advisory_xact_lock(hashtext('book:' || a.visit_date::text));
    select g::time into v_next
    from generate_series('2000-01-01'::date + s.open_time, '2000-01-01'::date + s.close_time,
                         make_interval(mins => s.slot_minutes)) g
    where a.visit_date + g::time - make_interval(mins => s.checkin_before_minutes) >= local_now()
      and g::time <> a.slot_start
      and (select count(*) from appointments x where x.visit_date = a.visit_date and x.slot_start = g::time
           and x.status not in ('cancelled', 'referred')) < s.slot_capacity
    order by g limit 1;
    if v_next is null then
      perform log_action('no_slot', 'appointments', p_id);
      return jsonb_build_object('status', 'no_slot');
    end if;
    update appointments
       set rescheduled_from = slot_start, slot_start = v_next, status = 'checked_in', checked_in_at = now()
     where id = p_id;
    perform log_action('rescheduled', 'appointments', p_id, jsonb_build_object('from', a.slot_start, 'to', v_next));
    return jsonb_build_object('status', 'rescheduled', 'slot', v_next);
  end if;
  raise exception 'INVALID_STATUS';
end $$;

create or replace function public.report_worse(p_id uuid, p_flags text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['patient']::user_role[]);
  update appointments a set worsened_at = now(), worsened_flags = coalesce(p_flags, '{}')
   where a.id = p_id
     and a.status in ('booked', 'skipped', 'checked_in', 'in_vitals', 'waiting_doctor')
     and exists (select 1 from patients p where p.id = a.patient_id and p.user_id = auth.uid());
  if not found then raise exception 'NOT_FOUND'; end if;
  perform log_action('worsened', 'appointments', p_id, jsonb_build_object('flags', cardinality(p_flags)));
end $$;

-- What the patient may see about their own appointments (no triage level, no other people).
create or replace function public.get_my_appointments()
returns table (id uuid, queue_no text, visit_date date, slot_start time, checkin_deadline time,
               department_id text, status appt_status, checked_in_at timestamptz,
               rescheduled_from time, worsened_at timestamptz, ahead_count int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform require_role(array['patient']::user_role[]);
  perform skip_overdue();
  return query
  select a.id, a.queue_no, a.visit_date, a.slot_start,
         (a.slot_start - make_interval(mins => (select checkin_before_minutes from clinic_settings where clinic_settings.id = 1)))::time,
         a.department_id, a.status, a.checked_in_at, a.rescheduled_from, a.worsened_at,
         (select count(*)::int from appointments b
           where b.visit_date = a.visit_date and b.status = 'checked_in' and b.id <> a.id
             and (coalesce(b.triage_level, 4), b.slot_start, b.checked_in_at)
               < (coalesce(a.triage_level, 4), a.slot_start, a.checked_in_at))
  from appointments a join patients p on p.id = a.patient_id
  where p.user_id = auth.uid()
  order by a.visit_date desc, a.slot_start desc;
end $$;

-- ───────────────────────── nurse ─────────────────────────
create or replace function public.save_triage(
  p_id uuid, p_stage text, p_department text, p_level smallint,
  p_criteria_level smallint, p_criteria_reasons jsonb, p_override_reason text
) returns appt_status language plpgsql security definer set search_path = public as $$
declare a appointments; v_status appt_status;
begin
  perform require_role(array['nurse']::user_role[]);
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_level is null or p_level not between 1 and 5 then raise exception 'LEVEL_REQUIRED'; end if;
  if p_level > 2 and coalesce(p_department, a.department_id) is null then raise exception 'DEPARTMENT_REQUIRED'; end if;
  if p_level <> p_criteria_level and coalesce(trim(p_override_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;

  insert into triage_reviews (appointment_id, nurse_id, stage, criteria_level, criteria_reasons, from_level,
                              final_level, department_id, override_reason)
  values (p_id, auth.uid(), p_stage, p_criteria_level, coalesce(p_criteria_reasons, '[]'), a.triage_level,
          p_level, coalesce(p_department, a.department_id), nullif(trim(p_override_reason), ''));

  v_status := case
    when p_level <= 2 then 'referred'
    when a.status = 'in_vitals' and exists (select 1 from vital_signs v where v.appointment_id = p_id) then 'waiting_doctor'
    else a.status end;

  update appointments
     set triage_level = p_level, department_id = coalesce(p_department, department_id),
         worsened_at = null, worsened_flags = null, status = v_status
   where id = p_id;
  perform log_action('triage', 'appointments', p_id,
    jsonb_build_object('from', a.triage_level, 'to', p_level, 'criteria', p_criteria_level, 'stage', p_stage));
  return v_status;
end $$;

create or replace function public.call_next_vitals() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_role(array['nurse']::user_role[]);
  perform skip_overdue();
  select id into v_id from appointments
   where visit_date = local_now()::date and status = 'checked_in'
   order by coalesce(triage_level, 4), slot_start, checked_in_at
   limit 1 for update skip locked;
  if v_id is null then return null; end if;
  update appointments set status = 'in_vitals' where id = v_id;
  perform log_action('call_vitals', 'appointments', v_id);
  return v_id;
end $$;

-- p_needs_retriage: the vitals put the patient at a higher level than before (computed by the triage criteria).
create or replace function public.save_vitals(p_id uuid, p_vitals jsonb, p_needs_retriage boolean)
returns appt_status language plpgsql security definer set search_path = public as $$
declare a appointments; v_status appt_status;
begin
  perform require_role(array['nurse']::user_role[]);
  select * into a from appointments where id = p_id for update;
  if not found or a.status <> 'in_vitals' then raise exception 'INVALID_STATUS'; end if;
  insert into vital_signs (appointment_id, weight, height, bp_sys, bp_dia, pulse, temperature, spo2, blood_sugar, recorded_by)
  values (p_id, (p_vitals ->> 'weight')::numeric, (p_vitals ->> 'height')::numeric, (p_vitals ->> 'bp_sys')::int,
          (p_vitals ->> 'bp_dia')::int, (p_vitals ->> 'pulse')::int, (p_vitals ->> 'temperature')::numeric,
          (p_vitals ->> 'spo2')::int, (p_vitals ->> 'blood_sugar')::int, auth.uid())
  on conflict (appointment_id) do update set
    weight = excluded.weight, height = excluded.height, bp_sys = excluded.bp_sys, bp_dia = excluded.bp_dia,
    pulse = excluded.pulse, temperature = excluded.temperature, spo2 = excluded.spo2,
    blood_sugar = excluded.blood_sugar, recorded_by = excluded.recorded_by, recorded_at = now();
  -- stays at the vitals station until a nurse re-triages when needed
  v_status := case when p_needs_retriage or a.triage_level is null or a.department_id is null
                   then 'in_vitals' else 'waiting_doctor' end;
  update appointments set status = v_status where id = p_id;
  perform log_action('vitals', 'appointments', p_id, jsonb_build_object('retriage', p_needs_retriage));
  return v_status;
end $$;

-- ───────────────────────── doctor ─────────────────────────
create or replace function public.start_exam(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['doctor']::user_role[]);
  update appointments set status = 'in_exam' where id = p_id and status = 'waiting_doctor';
  if not found then raise exception 'INVALID_STATUS'; end if;
  insert into visits (appointment_id, doctor_id, started_at) values (p_id, auth.uid(), now())
  on conflict (appointment_id) do update set doctor_id = excluded.doctor_id, started_at = now();
  perform log_action('start_exam', 'appointments', p_id);
end $$;

create or replace function public.finish_visit(
  p_id uuid, p_diagnosis text, p_icd10 text, p_treatment text,
  p_consult numeric, p_medicine numeric, p_procedure numeric
) returns void language plpgsql security definer set search_path = public as $$
declare v_cov coverage; v_ratio numeric;
begin
  perform require_role(array['doctor']::user_role[]);
  if coalesce(trim(p_diagnosis), '') = '' then raise exception 'DIAGNOSIS_REQUIRED'; end if;
  select p.coverage into v_cov from appointments a join patients p on p.id = a.patient_id
   where a.id = p_id and a.status = 'in_exam';
  if v_cov is null then raise exception 'INVALID_STATUS'; end if;
  select claim_ratio into v_ratio from coverage_rates where coverage = v_cov;
  v_ratio := coalesce(v_ratio, 0);

  update visits set diagnosis = trim(p_diagnosis), icd10 = nullif(upper(trim(p_icd10)), ''),
                    treatment = nullif(trim(p_treatment), ''), finished_at = now()
   where appointment_id = p_id;
  delete from charges where appointment_id = p_id;
  insert into charges (appointment_id, item_type, amount, coverage, claimable, patient_paid)
  select p_id, t.item, t.amt, v_cov, round(t.amt * v_ratio, 2), t.amt - round(t.amt * v_ratio, 2)
  from (values ('consult', coalesce(p_consult, 0)), ('medicine', coalesce(p_medicine, 0)),
               ('procedure', coalesce(p_procedure, 0))) t(item, amt)
  where t.amt > 0;
  update appointments set status = 'done' where id = p_id;
  perform log_action('finish_visit', 'appointments', p_id);
end $$;

-- ───────────────────────── admin (aggregates only, no names) ─────────────────────────
create or replace function public.admin_stats(p_days int, p_department text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform require_role(array['admin']::user_role[]);
  with base as (
    select a.*, p.gender, p.coverage as cov,
           extract(year from age(a.visit_date, p.birth_date))::int as age
    from appointments a join patients p on p.id = a.patient_id
    where a.visit_date > local_now()::date - p_days and a.visit_date <= local_now()::date
      and (p_department is null or a.department_id = p_department)
  ), seen as (
    select * from base where status in ('done', 'referred')
  ), money as (
    select b.department_id, c.coverage, sum(c.amount) as amount, b.visit_date
    from charges c join base b on b.id = c.appointment_id
    group by b.department_id, c.coverage, b.visit_date
  ), last_review as (
    select distinct on (t.appointment_id) t.* from triage_reviews t join seen s on s.id = t.appointment_id
    order by t.appointment_id, t.created_at desc
  )
  select jsonb_build_object(
    'patients', (select count(*) from seen),
    'days', (select count(distinct visit_date) from seen),
    'revenue', (select coalesce(sum(amount), 0) from money),
    'on_time_pct', (select round(100.0 * count(*) filter (where rescheduled_from is null) / nullif(count(*), 0), 1)
                    from seen where checked_in_at is not null),
    'rescheduled_pct', (select round(100.0 * count(*) filter (where rescheduled_from is not null) / nullif(count(*), 0), 1)
                        from seen where checked_in_at is not null),
    'urgent_pct', (select round(100.0 * count(*) filter (where triage_level <= 3) / nullif(count(*), 0), 1) from seen),
    'override_up', (select count(*) from last_review where final_level < criteria_level),
    'override_down', (select count(*) from last_review where final_level > criteria_level),
    'by_department', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from
        (select department_id as department, count(*) as n from seen where department_id is not null group by 1) x),
    'age_gender', (select coalesce(jsonb_agg(x), '[]') from
        (select case when age < 15 then '0-14' when age < 30 then '15-29' when age < 45 then '30-44'
                     when age < 60 then '45-59' else '60+' end as age_group, gender, count(*) as n
           from seen where age is not null group by 1, 2) x),
    'heatmap', (select coalesce(jsonb_agg(x), '[]') from
        (select extract(isodow from visit_date)::int as dow, extract(hour from slot_start)::int as hour, count(*) as n
           from seen group by 1, 2) x),
    'top_diagnoses', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from
        (select case when v.icd10 is not null then v.icd10 || ' ' || min(v.diagnosis) else min(v.diagnosis) end as label,
                count(*) as n
           from visits v join seen s on s.id = v.appointment_id where v.diagnosis is not null
          group by v.icd10, case when v.icd10 is null then lower(trim(v.diagnosis)) end
          order by n desc limit 8) x),
    'revenue_by_department', (select coalesce(jsonb_agg(x), '[]') from
        (select department_id as department, coverage, sum(amount) as amount from money group by 1, 2) x),
    'revenue_weekly', (select coalesce(jsonb_agg(x order by x.week), '[]') from
        (select date_trunc('week', visit_date)::date as week, sum(amount) as amount from money group by 1) x),
    'levels', (select coalesce(jsonb_agg(x order by x.level), '[]') from
        (select final_level as level,
                count(*) filter (where final_level = criteria_level) as as_criteria,
                count(*) filter (where final_level < criteria_level) as raised,
                count(*) filter (where final_level > criteria_level) as lowered
           from last_review group by 1) x)
  ) into r;
  return r;
end $$;

-- ───────────────────────── row level security ─────────────────────────
alter table public.departments enable row level security;
alter table public.clinic_settings enable row level security;
alter table public.coverage_rates enable row level security;
alter table public.profiles enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.screenings enable row level security;
alter table public.symptom_reports enable row level security;
alter table public.triage_reviews enable row level security;
alter table public.vital_signs enable row level security;
alter table public.visits enable row level security;
alter table public.charges enable row level security;
alter table public.emergency_alerts enable row level security;
alter table public.audit_logs enable row level security;

create policy "read reference" on public.departments for select to authenticated using (true);
create policy "read settings" on public.clinic_settings for select to authenticated using (true);
create policy "read rates" on public.coverage_rates for select to authenticated using (true);

create policy "own profile" on public.profiles for select to authenticated
  using (id = auth.uid() or my_role() in ('nurse', 'doctor', 'admin'));

create policy "own or clinical read" on public.patients for select to authenticated
  using (user_id = auth.uid() or is_clinical());
create policy "create own record" on public.patients for insert to authenticated
  with check (user_id = auth.uid() and my_role() = 'patient');
create policy "update own record" on public.patients for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- nurses see the whole day; doctors only patients sent to them (their department when set)
create policy "clinical read" on public.appointments for select to authenticated using (
  my_role() = 'nurse'
  or (my_role() = 'doctor' and status in ('waiting_doctor', 'in_exam', 'done')
      and ((select department_id from profiles where id = auth.uid()) is null
           or department_id = (select department_id from profiles where id = auth.uid())))
);
create policy "clinical read" on public.screenings for select to authenticated using (is_clinical());
create policy "clinical read" on public.symptom_reports for select to authenticated using (is_clinical());
create policy "clinical read" on public.triage_reviews for select to authenticated using (is_clinical());
create policy "clinical read" on public.vital_signs for select to authenticated using (is_clinical());
create policy "clinical read" on public.visits for select to authenticated using (is_clinical());
create policy "clinical read" on public.charges for select to authenticated using (is_clinical());
create policy "nurse read" on public.emergency_alerts for select to authenticated using (my_role() = 'nurse');
create policy "staff read" on public.audit_logs for select to authenticated using (my_role() in ('nurse', 'doctor', 'admin'));

-- functions are the only write path; signed-in users only
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- realtime for the staff screens
alter publication supabase_realtime add table public.appointments, public.emergency_alerts;

-- ───────────────────────── reference data ─────────────────────────
insert into public.clinic_settings (id) values (1);
insert into public.departments (id, name_th, name_en) values
  ('med', 'อายุรกรรม', 'Internal Medicine'),
  ('ortho', 'ออร์โธปิดิกส์', 'Orthopedics'),
  ('skin', 'ผิวหนัง', 'Dermatology'),
  ('ent', 'หู คอ จมูก', 'ENT'),
  ('eye', 'จักษุ', 'Ophthalmology');
insert into public.coverage_rates (coverage, claim_ratio) values
  ('gold', 1), ('sso', 1), ('civil', 1), ('private', 0.8), ('self', 0);

-- Optional: run skip_overdue() every minute (enable the pg_cron extension first)
-- select cron.schedule('skip-overdue', '* * * * *', $$ select public.skip_overdue() $$);
