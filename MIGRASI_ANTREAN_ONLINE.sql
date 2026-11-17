-- MIGRASI ANTREAN ONLINE POSYANDU KARANGSATRIA
-- Jalankan satu kali di Supabase Dashboard > SQL Editor > New query.
-- Script ini menambah tabel antrean bersama; tidak menghapus data keluarga,
-- anggota keluarga, jadwal, atau hasil skrining yang sudah ada.

begin;

-- 1. Tabel antrean yang dipakai bersama oleh portal orang tua dan portal kader.
create table if not exists public.posyandu_queues (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  child_id uuid not null references public.family_members(id) on delete restrict,
  event_id uuid not null references public.posyandu_events(id) on delete restrict,
  location_id text not null references public.posyandu_locations(id) on delete restrict,
  queue_number integer not null check (queue_number > 0),
  service_type text not null check (service_type in ('kms', 'imunisasi', 'umum')),
  service_date date not null,
  service_time time not null,
  status text not null default 'Menunggu'
    check (status in ('Menunggu', 'Dipanggil', 'Dilayani', 'Selesai', 'Dibatalkan')),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posyandu_queues_event_number_unique unique (event_id, queue_number)
);

create index if not exists posyandu_queues_location_created_idx
  on public.posyandu_queues(location_id, created_at desc);
create index if not exists posyandu_queues_household_created_idx
  on public.posyandu_queues(household_id, created_at desc);
create index if not exists posyandu_queues_event_status_idx
  on public.posyandu_queues(event_id, status, queue_number);

-- Satu anak tidak boleh mengambil layanan yang sama dua kali pada jadwal yang sama.
-- Pendaftaran yang dibatalkan tidak menghalangi pendaftaran ulang.
create unique index if not exists posyandu_queues_child_event_service_active_uidx
  on public.posyandu_queues(child_id, event_id, service_type)
  where status <> 'Dibatalkan';

-- 2. Penghitung nomor antrean per jadwal. Tabel ini hanya dapat diakses oleh
-- fungsi database di bawah, bukan langsung dari browser.
create table if not exists public.posyandu_queue_counters (
  event_id uuid primary key references public.posyandu_events(id) on delete cascade,
  last_number integer not null default 0 check (last_number >= 0)
);
alter table public.posyandu_queue_counters enable row level security;
revoke all on table public.posyandu_queue_counters from anon, authenticated;

-- 3. RLS dan hak akses tabel antrean.
alter table public.posyandu_queues enable row level security;
revoke all on table public.posyandu_queues from anon, authenticated;
grant select on table public.posyandu_queues to authenticated;
grant update (status) on table public.posyandu_queues to authenticated;

drop policy if exists posyandu_queues_read_scoped on public.posyandu_queues;
create policy posyandu_queues_read_scoped
on public.posyandu_queues
for select to authenticated
using (
  public.is_admin()
  or public.is_kader_for_location(location_id)
  or exists (
    select 1
    from public.households h
    where h.id = posyandu_queues.household_id
      and h.owner_user_id = auth.uid()
      and public.current_role() = 'keluarga'
  )
);

-- Orang tua hanya boleh membatalkan antreannya sendiri ketika masih menunggu.
drop policy if exists posyandu_queues_cancel_own on public.posyandu_queues;
create policy posyandu_queues_cancel_own
on public.posyandu_queues
for update to authenticated
using (
  submitted_by = auth.uid()
  and public.current_role() = 'keluarga'
  and status = 'Menunggu'
  and exists (
    select 1 from public.households h
    where h.id = posyandu_queues.household_id and h.owner_user_id = auth.uid()
  )
)
with check (
  submitted_by = auth.uid()
  and public.current_role() = 'keluarga'
  and status = 'Dibatalkan'
  and exists (
    select 1 from public.households h
    where h.id = posyandu_queues.household_id and h.owner_user_id = auth.uid()
  )
);

-- Kader hanya dapat memperbarui status antrean di lokasi tugasnya.
drop policy if exists posyandu_queues_update_staff on public.posyandu_queues;
create policy posyandu_queues_update_staff
on public.posyandu_queues
for update to authenticated
using (public.is_admin() or public.is_kader_for_location(location_id))
with check (public.is_admin() or public.is_kader_for_location(location_id));

-- 4. Fungsi atomik untuk mengambil nomor antrean.
-- Nomor berurutan per jadwal dan aman saat beberapa keluarga mendaftar bersamaan.
-- Fungsi memvalidasi pemilik akun, anak, lokasi, jadwal, dan jenis layanan di server.
create or replace function public.take_posyandu_queue_number(
  p_child_id uuid,
  p_event_id uuid,
  p_service_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_location_id text;
  v_child_exists boolean;
  v_event public.posyandu_events;
  v_queue_number integer;
  v_queue public.posyandu_queues;
begin
  if auth.uid() is null or public.current_role() is distinct from 'keluarga' then
    raise exception using errcode = '42501', message = 'Hanya akun orang tua/wali yang dapat mengambil nomor antrean.';
  end if;

  select h.id, h.location_id
    into v_household_id, v_location_id
  from public.households h
  where h.owner_user_id = auth.uid()
  order by h.created_at asc
  limit 1;

  if v_household_id is null then
    raise exception using errcode = 'P0002', message = 'Data keluarga belum ditemukan pada akun ini.';
  end if;

  select exists (
    select 1 from public.family_members m
    where m.id = p_child_id and m.household_id = v_household_id
  ) into v_child_exists;

  if not v_child_exists then
    raise exception using errcode = '42501', message = 'Anak yang dipilih tidak terdaftar pada keluarga ini.';
  end if;

  if p_service_type is null or p_service_type not in ('kms', 'imunisasi', 'umum') then
    raise exception using errcode = '22023', message = 'Jenis layanan tidak dikenal.';
  end if;

  select * into v_event
  from public.posyandu_events e
  where e.id = p_event_id
    and e.location_id = v_location_id
    and e.status = 'Terjadwal';

  if not found then
    raise exception using errcode = 'P0002', message = 'Jadwal tidak aktif atau bukan untuk lokasi keluarga ini. Muat ulang halaman jadwal.';
  end if;

  if p_service_type = 'imunisasi'
    and jsonb_array_length(coalesce(v_event.vaccines, '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'Layanan imunisasi tidak tersedia pada jadwal ini.';
  end if;

  if exists (
    select 1 from public.posyandu_queues q
    where q.child_id = p_child_id
      and q.event_id = p_event_id
      and q.service_type = p_service_type
      and q.status <> 'Dibatalkan'
  ) then
    raise exception using errcode = '23505', message = 'Anak ini sudah memiliki nomor antrean untuk layanan tersebut pada jadwal yang dipilih.';
  end if;

  insert into public.posyandu_queue_counters as counter (event_id, last_number)
  values (p_event_id, 1)
  on conflict (event_id)
  do update set last_number = counter.last_number + 1
  returning last_number into v_queue_number;

  insert into public.posyandu_queues (
    household_id, child_id, event_id, location_id, queue_number,
    service_type, service_date, service_time, status, submitted_by
  ) values (
    v_household_id, p_child_id, p_event_id, v_location_id, v_queue_number,
    p_service_type, v_event.event_date, v_event.event_time, 'Menunggu', auth.uid()
  )
  returning * into v_queue;

  return to_jsonb(v_queue);
end;
$$;

revoke all on function public.take_posyandu_queue_number(uuid, uuid, text) from public;
grant execute on function public.take_posyandu_queue_number(uuid, uuid, text) to authenticated;

commit;
