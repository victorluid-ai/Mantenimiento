-- Catálogo real: URL de manual y checklist hecho/pendiente por equipo.
-- Ejecutar después de 001_initial_schema.sql y antes de supabase/seed.sql.

alter table public.equipment
  add column if not exists manual_url text,
  add column if not exists catalog_key text;

create table if not exists public.equipment_tasks (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  catalog_task_id text not null,
  title text not null,
  interval_label text not null,
  source_note text,
  status text not null default 'pending'
    check (status in ('pending', 'done')),
  updated_at timestamptz not null default now(),
  unique (equipment_id, catalog_task_id)
);

create index if not exists idx_equipment_tasks_equipment
  on public.equipment_tasks(equipment_id);

drop trigger if exists trg_equipment_tasks_updated on public.equipment_tasks;
create trigger trg_equipment_tasks_updated
  before update on public.equipment_tasks
  for each row execute function public.set_updated_at();

alter table public.equipment_tasks enable row level security;

drop policy if exists "authenticated_all_equipment_tasks" on public.equipment_tasks;
create policy "authenticated_all_equipment_tasks" on public.equipment_tasks
  for all to authenticated using (true) with check (true);
