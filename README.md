# Mantenimiento

Plataforma de **mantenimiento preventivo** para grupos de restauración.
Inventario de equipos por restaurante, calendario de revisiones, checklist por máquina y sistema de alarmas.
Backend Python (FastAPI + Jinja2) y base de datos **Supabase (PostgreSQL)**.

El código base es el export de ZeroManual, rama `cursor/mantenimiento-plataforma-22d1`.
Sobre esa base, el alta de equipo puede usar el catálogo real de `data/equipment-catalog.json` (15 modelos, solo URLs de manual).

## Arranque rápido (demo local)

```bash
python -m pip install -e ".[dev]"
export MANTENIMIENTO_DEMO_MODE=true
python -m app
```

Abre http://localhost:8100

En demo no hace falta Supabase: restaurantes, equipos, preventivos y alarmas viven en memoria.
El Rational iCombi Pro del local de demostración ya trae el checklist del catálogo.

## Catálogo real

En **Equipos → Registrar equipo**, elige un modelo del catálogo (marca y modelo).
La ficha rellena marca, modelo y el enlace al manual oficial, que se abre en otra pestaña.
Al guardar se copian las tareas preventivas del seed, en estado pendiente.
En la ficha del equipo, cada tarea se marca **Hecho** o **Pendiente**.

Dos modelos (campana Giatsu SoftAir y Hoshizaki IM-240) no traen checklist: no había manual PDF verificable y no se inventan tareas.
El alta manual, sin catálogo, sigue disponible.

## Supabase

1. Crea un proyecto en [Supabase](https://supabase.com).
2. En el SQL Editor, ejecuta en orden:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_catalog_checklist.sql`
   - `supabase/seed.sql`
3. Copia `.env.example` a `.env` y rellena las claves:

```bash
export SUPABASE_URL=https://xxxx.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...
unset MANTENIMIENTO_DEMO_MODE
python -m app
```

`002` añade `manual_url`, `catalog_key` y la tabla `equipment_tasks` (`pending` / `done`).
El seed de demostración enlaza el Rational iCombi ya existente con su checklist.
El desplegable del catálogo se lee siempre del JSON, no de un PDF.

## Modelo de datos

| Tabla | Uso |
|-------|-----|
| `groups` | Grupo de restauración (tenant) |
| `restaurants` | Locales del grupo |
| `equipment_types` | Tipos genéricos (horno, Josper, combi, cámara…) |
| `equipment` | Máquinas físicas por restaurante, con marca, modelo y URL de manual |
| `equipment_tasks` | Checklist del catálogo, hecho o pendiente, por equipo |
| `maintenance_plans` | Planes preventivos con `next_due_at` |
| `maintenance_logs` | Historial de intervenciones |
| `alarms` | Alarmas abiertas / reconocidas / resueltas |

## Rutas

| URL | Función |
|-----|---------|
| `/` | Landing |
| `/panel` | Dashboard operativo |
| `/restaurantes` | Alta y listado de locales |
| `/equipos` | Inventario, alta desde catálogo y checklist |
| `/preventivos` | Calendario y cierre de intervenciones |
| `/alarmas` | Sistema de alarmas |
| `/salud` | Healthcheck JSON |

## Tests

```bash
MANTENIMIENTO_DEMO_MODE=true python -m pytest -q
```

## Nota legal

Los manuales de fabricante están protegidos por copyright (Directiva 2001/29/CE y TRLPI en España). Se puede enlazar a la página oficial de descarga o al PDF publicado por el fabricante o un distribuidor autorizado. No se debe redistribuir, alojar ni copiar el PDF completo en la aplicación ni en el repositorio.

El checklist cita la fuente y es un resumen operativo, no una reproducción del manual. Quien use el equipo debe conservar el manual original. Esta aplicación no sustituye el mantenimiento técnico autorizado ni las obligaciones de seguridad alimentaria (APPCC/HACCP).

El texto íntegro está en el campo `legal_note` de `data/equipment-catalog.json` y en el formulario de alta.
