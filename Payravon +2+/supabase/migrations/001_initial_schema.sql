-- Payravon v2: run ONCE in a brand-new, empty Supabase project.
-- It replaces (DOES NOT migrate) the earlier prototype schema.
-- No faculty / group columns. No plaintext passwords or browser-generated attendance.
-- Read README_SETUP_TG.md before running.

create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.user_role as enum ('student','admin','super_admin');
create type public.registration_status as enum ('pending','approved','rejected','excluded','removed');
create type public.lesson_status as enum ('scheduled','active','completed');

create table public.universities (
 id bigint generated always as identity primary key,
 name text not null unique,
 created_at timestamptz not null default now()
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null check (length(trim(full_name)) between 2 and 200),
 phone text not null unique,
 university_id bigint references public.universities(id),
 course smallint check (course between 1 and 6),
 role public.user_role not null default 'student',
 status public.registration_status not null default 'pending',
 approved_at timestamptz,
 excluded_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index profiles_role_status_idx on public.profiles(role,status);
create table public.lessons (
 id smallint primary key check (id between 1 and 30),
 title text not null,
 lesson_date date,
 starts_at time,
 ends_at time,
 place text,
 speaker text,
 status public.lesson_status not null default 'scheduled',
 completed_at timestamptz,
 updated_at timestamptz not null default now(),
 check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create table public.qr_sessions (
 id uuid primary key default gen_random_uuid(),
 lesson_id smallint not null references public.lessons(id),
 token_hash text not null unique,
 expires_at timestamptz not null,
 active boolean not null default true,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index qr_sessions_lookup_idx on public.qr_sessions(lesson_id,active,expires_at);
create table public.attendance (
 id bigint generated always as identity primary key,
 lesson_id smallint not null references public.lessons(id),
 student_id uuid not null references public.profiles(id),
 attended_at timestamptz not null default now(),
 qr_session_id uuid references public.qr_sessions(id),
 unique(lesson_id,student_id)
);
create index attendance_student_idx on public.attendance(student_id);
create table public.announcements (
 id bigint generated always as identity primary key,
 title text not null check (length(trim(title)) between 2 and 200),
 body text not null check (length(trim(body)) between 2 and 5000),
 audience_university_id bigint references public.universities(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
insert into public.lessons(id,title) select n, 'Дарси ' || n from generate_series(1,30) as n;
insert into public.universities(name) values
 ('Донишгоҳи миллии Тоҷикистон'), ('Донишгоҳи технологии Тоҷикистон');

-- A new Auth user creates a student profile, regardless of metadata supplied.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,full_name,phone,university_id,course)
 values (
  new.id,
  coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''), 'Донишҷӯ'),
  coalesce(nullif(trim(new.raw_user_meta_data->>'phone'),''), 'missing-' || new.id::text),
  nullif(new.raw_user_meta_data->>'university_id','')::bigint,
  nullif(new.raw_user_meta_data->>'course','')::smallint
 );
 return new;
end;
$$;
create trigger payravon_on_auth_user_created
 after insert on auth.users for each row execute function private.handle_new_user();

-- Restrict role/status sensitive modifications to trusted RPC functions.
create function private.role_of_caller() returns public.user_role
language sql stable security definer set search_path = '' as $$
 select role from public.profiles where id=(select auth.uid())
$$;
create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce(private.role_of_caller() in ('admin','super_admin'),false)
$$;
create function private.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce(private.role_of_caller()='super_admin',false)
$$;
create function private.is_approved_student() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles
               where id=(select auth.uid()) and role='student' and status='approved')
$$;

-- Lesson absences start AFTER approval; only COMPLETED consecutive lesson numbers count.
create function private.has_two_absences(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists (
  select 1 from public.profiles p
  join public.lessons first on first.status='completed'
       and first.completed_at >= p.approved_at
  join public.lessons second on second.id=first.id+1
       and second.status='completed' and second.completed_at >= p.approved_at
  where p.id=p_student and p.role='student' and p.status='approved'
    and not exists (select 1 from public.attendance a
                    where a.student_id=p.id and a.lesson_id=first.id)
    and not exists (select 1 from public.attendance a
                    where a.student_id=p.id and a.lesson_id=second.id)
 )
$$;

create function private.manage_student_impl(p_student uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status public.registration_status; v_role public.user_role;
begin
 if not private.is_staff() then raise exception 'Only staff may manage students'; end if;
 select role,status into v_role,v_status from public.profiles where id=p_student for update;
 if not found or v_role <> 'student' then raise exception 'Student not found'; end if;
 if p_action='approve' and v_status='pending' then
  update public.profiles set status='approved', approved_at=now(), updated_at=now()
   where id=p_student;
 elsif p_action='reject' and v_status='pending' then
  update public.profiles set status='rejected',updated_at=now() where id=p_student;
 elsif p_action='remove' and v_status='approved' then
  -- Soft removal: disable app access, preserve audit/attendance data.
  update public.profiles set status='removed',updated_at=now() where id=p_student;
 elsif p_action='exclude' and v_status='approved' then
  if not private.has_two_absences(p_student) then
   raise exception 'Two consecutive absences not confirmed';
  end if;
  update public.profiles set status='excluded',excluded_at=now(),updated_at=now()
   where id=p_student;
 else
  raise exception 'Invalid student status transition';
 end if;
end;
$$;

create function private.set_staff_role_impl(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not private.is_super_admin() then raise exception 'Only Super Admin'; end if;
 if p_user=(select auth.uid()) then raise exception 'Cannot change your own role'; end if;
 if p_role not in ('student','admin') then raise exception 'Invalid new role'; end if;
 if not exists(select 1 from public.profiles where id=p_user) then
  raise exception 'Account not found';
 end if;
 update public.profiles set role=p_role::public.user_role,
       status='approved',approved_at=coalesce(approved_at,now()),updated_at=now()
 where id=p_user and role<>'super_admin';
 if not found then raise exception 'Cannot change a Super Admin'; end if;
end;
$$;

create function private.start_qr_impl(p_lesson smallint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_token text; v_session uuid; v_exp timestamptz;
begin
 if not private.is_staff() then raise exception 'Only staff can create QR'; end if;
 perform 1 from public.lessons where id=p_lesson and status <> 'completed' for update;
 if not found then raise exception 'Lesson not found or already completed'; end if;
 update public.qr_sessions set active=false where lesson_id=p_lesson and active;
 v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
 v_exp := now() + interval '10 minutes';
 insert into public.qr_sessions(lesson_id,token_hash,expires_at,created_by)
 values (p_lesson,encode(extensions.digest(v_token,'sha256'),'hex'),v_exp,(select auth.uid()))
 returning id into v_session;
 update public.lessons set status='active',updated_at=now() where id=p_lesson;
 return jsonb_build_object('lesson',p_lesson,'token',v_token,'expires_at',v_exp);
end;
$$;
create function private.complete_lesson_impl(p_lesson smallint)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not private.is_staff() then raise exception 'Only staff can complete lessons'; end if;
 update public.lessons set status='completed',completed_at=now(),updated_at=now()
 where id=p_lesson and status='active';
 if not found then raise exception 'Lesson must be active'; end if;
 update public.qr_sessions set active=false where lesson_id=p_lesson and active;
end;
$$;
create function private.mark_attendance_impl(p_lesson smallint,p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session uuid; v_student uuid := (select auth.uid());
begin
 if v_student is null or not private.is_approved_student() then
  raise exception 'Student account not approved';
 end if;
 if p_token is null or length(p_token)<>64 then raise exception 'Invalid QR token'; end if;
 select q.id into v_session
 from public.qr_sessions q join public.lessons l on l.id=q.lesson_id
 where q.lesson_id=p_lesson and q.active and q.expires_at>now() and l.status='active'
   and q.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
 order by q.created_at desc limit 1;
 if v_session is null then raise exception 'QR is invalid or expired'; end if;
 insert into public.attendance(lesson_id,student_id,qr_session_id)
 values(p_lesson,v_student,v_session)
 on conflict(lesson_id,student_id) do nothing;
 if not found then raise exception 'Attendance already recorded'; end if;
 return jsonb_build_object('ok',true,'lesson',p_lesson);
end;
$$;

create function private.absence_warnings_impl()
returns table(student_id uuid,full_name text,lesson_a smallint,lesson_b smallint)
language sql stable security definer set search_path = '' as $$
 select p.id,p.full_name,ab.lesson_a,ab.lesson_b
 from public.profiles p
 cross join lateral (
   select first.id as lesson_a,second.id as lesson_b
   from public.lessons first
   join public.lessons second on second.id=first.id+1
   where first.status='completed' and second.status='completed'
     and first.completed_at>=p.approved_at and second.completed_at>=p.approved_at
     and not exists(select 1 from public.attendance a where a.student_id=p.id and a.lesson_id=first.id)
     and not exists(select 1 from public.attendance a where a.student_id=p.id and a.lesson_id=second.id)
   order by second.id desc limit 1
 ) ab
 where p.role='student' and p.status='approved' and private.is_staff()
$$;

-- Public RPC entrypoints are INVOKER, calling narrowly granted PRIVATE helpers.
create function public.manage_student(p_student uuid,p_action text) returns void
 language sql security invoker set search_path = '' as $$
 select private.manage_student_impl(p_student,p_action)
$$;
create function public.set_staff_role(p_user uuid,p_role text) returns void
 language sql security invoker set search_path = '' as $$
 select private.set_staff_role_impl(p_user,p_role)
$$;
create function public.start_lesson_qr(p_lesson smallint) returns jsonb
 language sql security invoker set search_path = '' as $$
 select private.start_qr_impl(p_lesson)
$$;
create function public.complete_lesson(p_lesson smallint) returns void
 language sql security invoker set search_path = '' as $$
 select private.complete_lesson_impl(p_lesson)
$$;
create function public.mark_attendance(p_lesson smallint,p_token text) returns jsonb
 language sql security invoker set search_path = '' as $$
 select private.mark_attendance_impl(p_lesson,p_token)
$$;
create function public.absence_warnings()
 returns table(student_id uuid,full_name text,lesson_a smallint,lesson_b smallint)
 language sql stable security invoker set search_path = '' as $$
 select * from private.absence_warnings_impl()
$$;

alter table public.universities enable row level security;
alter table public.profiles enable row level security;
alter table public.lessons enable row level security;
alter table public.qr_sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.announcements enable row level security;

create policy universities_read on public.universities for select to anon,authenticated using(true);
create policy universities_insert_super on public.universities for insert to authenticated
 with check (private.is_super_admin());
create policy profiles_read_own_staff on public.profiles for select to authenticated
 using (id=(select auth.uid()) or private.is_staff());
create policy lessons_read on public.lessons for select to authenticated
 using (private.is_staff() or private.is_approved_student());
create policy lessons_manage on public.lessons for update to authenticated
 using (private.is_staff()) with check (private.is_staff());
create policy attendance_read on public.attendance for select to authenticated
 using (private.is_staff() or (student_id=(select auth.uid()) and private.is_approved_student()));
create policy announcements_read on public.announcements for select to authenticated
 using (private.is_staff() or (private.is_approved_student() and (
   audience_university_id is null or audience_university_id =
    (select p.university_id from public.profiles p where p.id=(select auth.uid()))
 )));
create policy announcements_insert_staff on public.announcements for insert to authenticated
 with check (private.is_staff() and created_by=(select auth.uid()));
-- No client read/write policy for qr_sessions; browser cannot see QR secrets.

-- Explicit privilege minimization: no direct student modifications to attendance/status.
revoke all on public.profiles,public.lessons,public.qr_sessions,public.attendance,
 public.announcements,public.universities from anon,authenticated;
grant usage on schema public to anon,authenticated;
grant select on public.universities to anon,authenticated;
grant insert on public.universities to authenticated;
grant select on public.profiles,public.lessons,public.attendance,public.announcements to authenticated;
grant update(title,lesson_date,starts_at,ends_at,place,speaker) on public.lessons to authenticated;
grant insert(title,body,audience_university_id,created_by) on public.announcements to authenticated;
grant usage on all sequences in schema public to authenticated;

revoke all on schema private from public,anon;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
revoke execute on all functions in schema public from public,anon;
grant execute on function private.role_of_caller(),private.is_staff(),
 private.is_super_admin(),private.is_approved_student() to authenticated;
grant execute on function private.manage_student_impl(uuid,text),
 private.set_staff_role_impl(uuid,text),private.start_qr_impl(smallint),
 private.complete_lesson_impl(smallint),private.mark_attendance_impl(smallint,text),
 private.absence_warnings_impl() to authenticated;
grant execute on function public.manage_student(uuid,text),public.set_staff_role(uuid,text),
 public.start_lesson_qr(smallint),public.complete_lesson(smallint),
 public.mark_attendance(smallint,text),public.absence_warnings() to authenticated;

-- Explicitly revoke helper calls from roles that have no reason to use them.
revoke execute on function private.handle_new_user() from public,anon,authenticated;
-- Bootstrap the first super_admin after a real signup, using SQL Editor ONLY:
-- update public.profiles set role='super_admin',status='approved',approved_at=now()
-- where id = 'REPLACE_WITH_REAL_AUTH_USER_UUID';
