-- MIGRASI TAMBAHAN: KEGIATAN DAN JADWAL POSYANDU
-- Jalankan SATU KALI pada Supabase SQL Editor setelah backup.
-- Tidak menghapus atau mengubah tabel/data lama.

create table if not exists public.posyandu_events (
  id uuid primary key default gen_random_uuid(),
  location_id text not null references public.posyandu_locations(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '',
  place text not null default '',
  event_date date not null,
  event_time time not null default '08:00',
  status text not null default 'Terjadwal'
    check (status in ('Terjadwal', 'Dibatalkan', 'Selesai')),
  vitamin_a boolean not null default false,
  vaccines jsonb not null default '[]'::jsonb
    check (jsonb_typeof(vaccines) = 'array'),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posyandu_events_location_date_idx
  on public.posyandu_events(location_id, event_date, event_time);

alter table public.posyandu_events enable row level security;

grant select, insert, update on public.posyandu_events to authenticated;

drop policy if exists posyandu_events_read_scoped on public.posyandu_events;
create policy posyandu_events_read_scoped
on public.posyandu_events
for select to authenticated
using (
  public.is_admin()
  or public.is_kader_for_location(location_id)
  or (
    public.current_role() = 'keluarga'
    and exists (
      select 1
      from public.households h
      where h.owner_user_id = auth.uid()
        and h.location_id = posyandu_events.location_id
    )
  )
);

drop policy if exists posyandu_events_insert_staff on public.posyandu_events;
create policy posyandu_events_insert_staff
on public.posyandu_events
for insert to authenticated
with check (
  created_by = auth.uid()
  and (public.is_admin() or public.is_kader_for_location(location_id))
);

drop policy if exists posyandu_events_update_staff on public.posyandu_events;
create policy posyandu_events_update_staff
on public.posyandu_events
for update to authenticated
using (public.is_admin() or public.is_kader_for_location(location_id))
with check (public.is_admin() or public.is_kader_for_location(location_id));

-- Orang tua hanya mendapat SELECT; tidak ada policy INSERT/UPDATE/DELETE untuk keluarga.
