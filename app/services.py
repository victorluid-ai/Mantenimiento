"""Servicios de dominio sobre Supabase o demo en memoria."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any
from uuid import uuid4

from app.catalog import get_item, interval_text, match_item, safe_http_url
from app.config import get_settings
from app.db import DemoStore, SupabaseClient, get_client, get_demo


class MaintenanceService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client = get_client()
        self.demo: DemoStore | None = None if self.client else get_demo()

    @property
    def is_demo(self) -> bool:
        return self.client is None

    def resolve_group(self, slug: str | None = None) -> dict[str, Any]:
        slug = slug or self.settings.default_group_slug
        if self.client:
            rows = self.client.select(
                "groups", filters={"slug": f"eq.{slug}"}, limit=1
            )
            if not rows:
                raise LookupError(f"Grupo no encontrado: {slug}")
            return rows[0]
        assert self.demo
        for g in self.demo.groups:
            if g["slug"] == slug:
                return g
        raise LookupError(f"Grupo no encontrado: {slug}")

    def list_restaurants(self, group_id: str) -> list[dict[str, Any]]:
        if self.client:
            return self.client.select(
                "restaurants",
                filters={"group_id": f"eq.{group_id}", "is_active": "eq.true"},
                order="name.asc",
            )
        assert self.demo
        return [r for r in self.demo.restaurants if r["group_id"] == group_id]

    def list_equipment_types(self) -> list[dict[str, Any]]:
        if self.client:
            return self.client.select("equipment_types", order="name.asc")
        assert self.demo
        return list(self.demo.equipment_types)

    def list_equipment(
        self, group_id: str, restaurant_id: str | None = None
    ) -> list[dict[str, Any]]:
        restaurants = {r["id"]: r for r in self.list_restaurants(group_id)}
        types = {t["id"]: t for t in self.list_equipment_types()}
        if self.client:
            filters: dict[str, str] = {}
            if restaurant_id:
                filters["restaurant_id"] = f"eq.{restaurant_id}"
            else:
                ids = ",".join(restaurants.keys())
                if not ids:
                    return []
                filters["restaurant_id"] = f"in.({ids})"
            rows = self.client.select(
                "equipment",
                filters=filters,
                order="name.asc",
            )
        else:
            assert self.demo
            rows = [
                e
                for e in self.demo.equipment
                if e["restaurant_id"] in restaurants
                and (not restaurant_id or e["restaurant_id"] == restaurant_id)
            ]
        enriched = []
        for e in rows:
            rest = restaurants.get(e["restaurant_id"], {})
            et = types.get(e["equipment_type_id"], {})
            enriched.append(
                {
                    **e,
                    "restaurant_name": rest.get("name", ""),
                    "city": rest.get("city", ""),
                    "type_name": et.get("name", ""),
                    "type_category": et.get("category", ""),
                }
            )
        self._attach_checklists(enriched)
        return enriched

    def _attach_checklists(self, equipment: list[dict[str, Any]]) -> None:
        ids = [e["id"] for e in equipment]
        grouped: dict[str, list[dict[str, Any]]] = {eq_id: [] for eq_id in ids}
        if ids:
            if self.client:
                joined = ",".join(ids)
                rows = self.client.select(
                    "equipment_tasks",
                    filters={"equipment_id": f"in.({joined})"},
                )
            else:
                assert self.demo
                wanted = set(ids)
                rows = [t for t in self.demo.tasks if t["equipment_id"] in wanted]
            rows.sort(key=lambda row: (row["equipment_id"], row.get("catalog_task_id") or ""))
            for row in rows:
                grouped.setdefault(row["equipment_id"], []).append(self._task_view(row))
        for eq in equipment:
            tasks = grouped.get(eq["id"], [])
            item = get_item(eq.get("catalog_key") or "")
            eq["tasks"] = tasks
            eq["task_count"] = len(tasks)
            eq["tasks_done"] = sum(1 for task in tasks if task["status"] == "done")
            eq["manual_href"] = safe_http_url(eq.get("manual_url"))
            eq["manual_link_label"] = item["link_label"] if item else "Abrir manual oficial"
            eq["catalog_notes"] = item["notes"] if item else ""

    @staticmethod
    def _task_view(row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "interval_text": interval_text(str(row.get("interval_label") or "")),
        }

    def upcoming(self, group_id: str) -> list[dict[str, Any]]:
        if self.client:
            return self.client.select(
                "v_upcoming_maintenance",
                filters={"group_id": f"eq.{group_id}"},
                order="next_due_at.asc",
            )
        assert self.demo
        return self.demo.upcoming(group_id)

    def list_alarms(
        self, group_id: str, *, open_only: bool = True
    ) -> list[dict[str, Any]]:
        if self.client:
            filters: dict[str, str] = {"group_id": f"eq.{group_id}"}
            if open_only:
                filters["status"] = "in.(abierta,reconocida)"
            return self.client.select(
                "alarms",
                filters=filters,
                order="created_at.desc",
            )
        assert self.demo
        rows = [a for a in self.demo.alarms if a["group_id"] == group_id]
        if open_only:
            rows = [a for a in rows if a["status"] in ("abierta", "reconocida")]
        rows.sort(key=lambda a: a.get("created_at", ""), reverse=True)
        return rows

    def refresh_alarms(self, group_id: str) -> int:
        if self.client:
            result = self.client.rpc(
                "refresh_maintenance_alarms", {"p_group_id": group_id}
            )
            return int(result or 0)
        assert self.demo
        return self.demo.refresh_alarms(group_id)

    def dashboard(self, group_id: str) -> dict[str, Any]:
        restaurants = self.list_restaurants(group_id)
        equipment = self.list_equipment(group_id)
        upcoming = self.upcoming(group_id)
        alarms = self.list_alarms(group_id)
        overdue = [u for u in upcoming if u.get("urgency") == "vencido"]
        soon = [u for u in upcoming if u.get("urgency") == "proximo"]
        return {
            "restaurants_count": len(restaurants),
            "equipment_count": len(equipment),
            "overdue_count": len(overdue),
            "soon_count": len(soon),
            "alarms_count": len(alarms),
            "upcoming": upcoming[:12],
            "alarms": alarms[:8],
            "restaurants": restaurants,
        }

    def create_restaurant(
        self, group_id: str, *, name: str, code: str, city: str, address: str
    ) -> dict[str, Any]:
        row = {
            "group_id": group_id,
            "name": name.strip(),
            "code": code.strip() or None,
            "city": city.strip() or None,
            "address": address.strip() or None,
        }
        if self.client:
            return self.client.insert("restaurants", row)
        assert self.demo
        row["id"] = str(uuid4())
        row["is_active"] = True
        self.demo.restaurants.append(row)
        return row

    def create_equipment(
        self,
        *,
        restaurant_id: str,
        equipment_type_id: str,
        name: str,
        brand: str,
        model: str,
        serial_number: str,
        location_note: str,
        status: str = "operativo",
        create_plan: bool = True,
        catalog_key: str = "",
    ) -> dict[str, Any]:
        catalog_item = get_item(catalog_key) if catalog_key else match_item(brand, model)
        if catalog_key and catalog_item is None:
            raise LookupError("Modelo no encontrado en el catálogo")
        if catalog_item:
            brand = catalog_item["brand"]
            model = catalog_item["model"]
        manual_url = catalog_item["manual_url"] if catalog_item else ""
        row = {
            "restaurant_id": restaurant_id,
            "equipment_type_id": equipment_type_id,
            "name": name.strip(),
            "brand": brand.strip() or None,
            "model": model.strip() or None,
            "serial_number": serial_number.strip() or None,
            "location_note": location_note.strip() or None,
            "status": status,
            "manual_url": manual_url or None,
            "catalog_key": catalog_item["key"] if catalog_item else None,
        }
        if self.client:
            created = self.client.insert("equipment", row)
            if create_plan:
                types = {
                    t["id"]: t for t in self.list_equipment_types()
                }
                et = types.get(equipment_type_id, {})
                interval = int(et.get("default_interval_days") or 90)
                self.client.insert(
                    "maintenance_plans",
                    {
                        "equipment_id": created["id"],
                        "title": f"Preventivo — {created['name']}",
                        "description": et.get("description"),
                        "interval_days": interval,
                        "lead_time_days": 7,
                        "priority": "media",
                        "next_due_at": (
                            date.today() + timedelta(days=interval)
                        ).isoformat(),
                    },
                )
            self._insert_catalog_tasks(created["id"], catalog_item)
            return created
        assert self.demo
        row["id"] = str(uuid4())
        self.demo.equipment.append(row)
        if create_plan:
            et = next(
                (t for t in self.demo.equipment_types if t["id"] == equipment_type_id),
                {"default_interval_days": 90},
            )
            interval = int(et["default_interval_days"])
            self.demo.plans.append(
                {
                    "id": str(uuid4()),
                    "equipment_id": row["id"],
                    "title": f"Preventivo — {row['name']}",
                    "description": "",
                    "interval_days": interval,
                    "lead_time_days": 7,
                    "priority": "media",
                    "is_active": True,
                    "last_completed_at": None,
                    "next_due_at": (
                        date.today() + timedelta(days=interval)
                    ).isoformat(),
                }
            )
        self._insert_catalog_tasks(row["id"], catalog_item)
        return row

    def _insert_catalog_tasks(
        self, equipment_id: str, catalog_item: dict[str, Any] | None
    ) -> None:
        if not catalog_item:
            return
        task_rows = [
            {
                "equipment_id": equipment_id,
                "catalog_task_id": task["id"],
                "title": task["title"],
                "interval_label": task["interval"],
                "source_note": task["source_note"] or None,
                "status": "pending",
            }
            for task in catalog_item["tasks"]
        ]
        if self.client:
            for task_row in task_rows:
                self.client.insert("equipment_tasks", task_row)
            return
        assert self.demo
        for task_row in task_rows:
            task_row["id"] = str(uuid4())
            self.demo.tasks.append(task_row)

    def set_task_status(self, equipment_id: str, task_id: str, status: str) -> dict[str, Any]:
        if status not in ("pending", "done"):
            raise ValueError("Estado de tarea inválido")
        if self.client:
            rows = self.client.update(
                "equipment_tasks",
                {"id": f"eq.{task_id}", "equipment_id": f"eq.{equipment_id}"},
                {"status": status},
            )
            if not rows:
                raise LookupError("Tarea no encontrada")
            return rows[0]
        assert self.demo
        for task in self.demo.tasks:
            if task["id"] == task_id and task["equipment_id"] == equipment_id:
                task["status"] = status
                return task
        raise LookupError("Tarea no encontrada")

    def complete_plan(
        self, plan_id: str, *, performed_by: str, notes: str
    ) -> dict[str, Any]:
        today = date.today()
        if self.client:
            plans = self.client.select(
                "maintenance_plans", filters={"id": f"eq.{plan_id}"}, limit=1
            )
            if not plans:
                raise LookupError("Plan no encontrado")
            plan = plans[0]
            next_due = today + timedelta(days=int(plan["interval_days"]))
            self.client.insert(
                "maintenance_logs",
                {
                    "plan_id": plan_id,
                    "equipment_id": plan["equipment_id"],
                    "performed_at": today.isoformat(),
                    "performed_by": performed_by.strip() or None,
                    "notes": notes.strip() or None,
                    "result": "ok",
                },
            )
            updated = self.client.update(
                "maintenance_plans",
                {"id": f"eq.{plan_id}"},
                {
                    "last_completed_at": today.isoformat(),
                    "next_due_at": next_due.isoformat(),
                },
            )
            self.client.update(
                "alarms",
                {
                    "plan_id": f"eq.{plan_id}",
                    "status": "in.(abierta,reconocida)",
                },
                {
                    "status": "resuelta",
                    "resolved_at": date.today().isoformat(),
                },
            )
            return updated[0] if updated else plan

        assert self.demo
        plan = next(p for p in self.demo.plans if p["id"] == plan_id)
        plan["last_completed_at"] = today.isoformat()
        plan["next_due_at"] = (
            today + timedelta(days=int(plan["interval_days"]))
        ).isoformat()
        self.demo.logs.append(
            {
                "id": str(uuid4()),
                "plan_id": plan_id,
                "equipment_id": plan["equipment_id"],
                "performed_at": today.isoformat(),
                "performed_by": performed_by,
                "notes": notes,
                "result": "ok",
            }
        )
        for alarm in self.demo.alarms:
            if alarm.get("plan_id") == plan_id and alarm["status"] in (
                "abierta",
                "reconocida",
            ):
                alarm["status"] = "resuelta"
        return plan

    def update_alarm_status(self, alarm_id: str, status: str) -> dict[str, Any]:
        if status not in ("abierta", "reconocida", "resuelta", "silenciada"):
            raise ValueError("Estado de alarma inválido")
        payload: dict[str, Any] = {"status": status}
        if status == "reconocida":
            payload["acknowledged_at"] = date.today().isoformat()
        if status == "resuelta":
            payload["resolved_at"] = date.today().isoformat()
        if self.client:
            rows = self.client.update(
                "alarms", {"id": f"eq.{alarm_id}"}, payload
            )
            if not rows:
                raise LookupError("Alarma no encontrada")
            return rows[0]
        assert self.demo
        for alarm in self.demo.alarms:
            if alarm["id"] == alarm_id:
                alarm.update(payload)
                return alarm
        raise LookupError("Alarma no encontrada")
