-- PAYRAVON PLUS: MIGRATION FOR AN EXISTING DATABASE (DO NOT rerun 001).
-- Execute this file ONCE (safe repeat for structure, no duplicate rewards).
-- Existing user accounts, attendance and QR sessions are preserved.

create table if not exists public.points_ledger (
 id bigint generated always as identity primary key,
 student_id uuid not null references public.profiles(id),
 points integer not null check (points between 1 and 100),
 reason text not null check (char_length(trim(reason)) between 5 and 300),
 source text not null check (source in ('attendance','manual')),
 lesson_id smallint references public.lessons(id),
 awarded_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 constraint points_attendance_source_check check
   ((source='attendance' and lesson_id is not null and points=3 and awarded_by is null)
    or (source='manual' and lesson_id is null and awarded_by is not null))
);
create unique index if not exists points_ledger_one_qr_per_lesson
 on public.points_ledger(student_id,lesson_id) where source='attendance';
create index if not exists points_ledger_student_idx on public.points_ledger(student_id,created_at desc);

alter table public.points_ledger enable row level security;
drop policy if exists points_ledger_read on public.points_ledger;
create policy points_ledger_read on public.points_ledger for select to authenticated
 using (private.is_staff() or (student_id=(select auth.uid()) and private.is_approved_student()));
revoke all on public.points_ledger from public,anon,authenticated;
grant select on public.points_ledger to authenticated;
-- Never grant direct INSERT/UPDATE/DELETE privileges to authenticated.

-- Award exactly 3 points, atomically, when a new attendance row is inserted
-- by the existing trusted mark_attendance RPC. QR reuse won't earn twice.
create or replace function private.points_on_attendance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.points_ledger(student_id,points,reason,source,lesson_id)
 values (new.student_id,3,'Иштирок дар дарси ' || new.lesson_id,'attendance',new.lesson_id)
 on conflict do nothing;
 return new;
end;
$$;
revoke execute on function private.points_on_attendance() from public,anon,authenticated;
drop trigger if exists payravon_points_attendance on public.attendance;
create trigger payravon_points_attendance
 after insert on public.attendance for each row execute function private.points_on_attendance();

-- Include already recorded attendance in points, without giving duplicates.
insert into public.points_ledger(student_id,points,reason,source,lesson_id)
select student_id,3,'Иштирок дар дарси ' || lesson_id,'attendance',lesson_id
from public.attendance
on conflict do nothing;

-- Staff-awarded points are checked on the server, never trusted from browser.
create or replace function private.award_manual_points_impl(p_student uuid,p_points integer,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not private.is_staff() then raise exception 'Only staff may award points'; end if;
 if p_points is null or p_points not between 1 and 100 then
  raise exception 'Points must be between 1 and 100'; end if;
 if p_reason is null or char_length(trim(p_reason)) not between 5 and 300 then
  raise exception 'Reason must be 5-300 characters'; end if;
 perform 1 from public.profiles
 where id=p_student and role='student' and status='approved';
 if not found then raise exception 'Approved student not found'; end if;
 insert into public.points_ledger(student_id,points,reason,source,awarded_by)
 values (p_student,p_points,trim(p_reason),'manual',(select auth.uid()));
end;
$$;
create or replace function public.award_manual_points(p_student uuid,p_points integer,p_reason text)
returns void language sql security invoker set search_path = '' as $$
 select private.award_manual_points_impl(p_student,p_points,p_reason);
$$;
revoke all on function private.award_manual_points_impl(uuid,integer,text) from public,anon,authenticated;
revoke all on function public.award_manual_points(uuid,integer,text) from public,anon,authenticated;
grant execute on function private.award_manual_points_impl(uuid,integer,text) to authenticated;
grant execute on function public.award_manual_points(uuid,integer,text) to authenticated;

-- Existing set_staff_role RPC accepts 'student' as demotion;
-- it already enforces super_admin and protects against self-demotion.
