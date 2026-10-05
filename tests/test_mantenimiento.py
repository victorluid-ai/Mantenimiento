"""Tests unitarios del servicio (modo demo, sin Supabase)."""

from __future__ import annotations

import os

import pytest

# Forzar demo antes de importar el servicio
os.environ["MANTENIMIENTO_DEMO_MODE"] = "true"
os.environ.pop("SUPABASE_URL", None)
os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)

from app.config import get_settings
from app.db import get_demo
from app.services import MaintenanceService


@pytest.fixture(autouse=True)
def _reset_cache():
    get_settings.cache_clear()
    import app.db as db

    db._demo = None
    yield
    get_settings.cache_clear()
    db._demo = None


def test_dashboard_counts():
    svc = MaintenanceService()
    assert svc.is_demo
    group = svc.resolve_group()
    data = svc.dashboard(group["id"])
    assert data["restaurants_count"] == 3
    assert data["equipment_count"] == 6
    assert data["overdue_count"] >= 1
    assert data["alarms_count"] >= 1


def test_create_equipment_creates_plan():
    svc = MaintenanceService()
    group = svc.resolve_group()
    restaurants = svc.list_restaurants(group["id"])
    types = svc.list_equipment_types()
    created = svc.create_equipment(
        restaurant_id=restaurants[0]["id"],
        equipment_type_id=types[0]["id"],
        name="Horno test",
        brand="TestBrand",
        model="T-1",
        serial_number="SN-1",
        location_note="Cocina",
    )
    assert created["name"] == "Horno test"
    upcoming = svc.upcoming(group["id"])
    assert any(u["equipment_name"] == "Horno test" for u in upcoming)


def test_complete_plan_resolves_alarm():
    svc = MaintenanceService()
    group = svc.resolve_group()
    upcoming = svc.upcoming(group["id"])
    overdue = next(u for u in upcoming if u["urgency"] == "vencido")
    svc.complete_plan(overdue["plan_id"], performed_by="Ana", notes="OK")
    alarms = svc.list_alarms(group["id"])
    assert all(a.get("plan_id") != overdue["plan_id"] for a in alarms)


def test_health_endpoint():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    res = client.get("/salud")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["demo"] is True


def test_panel_renders():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    res = client.get("/panel")
    assert res.status_code == 200
    assert "Panel de preventivo" in res.text
    assert "Mantenimiento" in res.text


def test_catalog_has_fifteen_models_and_no_pdfs():
    from pathlib import Path

    from app.catalog import legal_note, list_items

    items = list_items()
    assert len(items) == 15
    assert len({item["key"] for item in items}) == 15
    assert "Directiva 2001/29/CE" in legal_note()
    assert all(item["manual_url"].startswith("http") for item in items)
    root = Path(__file__).resolve().parents[1]
    pdfs = [
        path
        for path in root.rglob("*.pdf")
        if ".git" not in path.parts and ".venv" not in path.parts
    ]
    assert pdfs == []


def test_demo_rational_uses_catalog_checklist():
    from fastapi.testclient import TestClient
    from app.db import get_demo
    from app.main import app

    client = TestClient(app)
    page = client.get("/equipos")
    assert page.status_code == 200
    assert "Ejecutar limpieza automática iCareSystem" in page.text
    assert "toolbox.rational-online.com" in page.text
    assert "is-done" not in page.text
    task = next(
        row for row in get_demo().tasks if row["catalog_task_id"] == "rat-icombi-01"
    )
    toggled = client.post(
        f"/equipos/{task['equipment_id']}/tareas/{task['id']}",
        data={"status": "done"},
        follow_redirects=True,
    )
    assert toggled.status_code == 200
    assert "is-done" in toggled.text
    again = client.get("/equipos")
    assert "is-done" in again.text


def test_create_equipment_from_real_catalog():
    from app.catalog import list_items
    from app.db import get_demo

    svc = MaintenanceService()
    group = svc.resolve_group()
    restaurant = svc.list_restaurants(group["id"])[0]
    equipment_type = svc.list_equipment_types()[0]
    fryer = next(item for item in list_items() if item["key"].startswith("Electrolux Professional::700XP 371085"))
    created = svc.create_equipment(
        restaurant_id=restaurant["id"],
        equipment_type_id=equipment_type["id"],
        name="Freidora de prueba",
        brand="No usar",
        model="No usar",
        serial_number="SN-CAT",
        location_note="Línea fría",
        catalog_key=fryer["key"],
    )
    assert created["brand"] == fryer["brand"]
    assert created["model"] == fryer["model"]
    assert created["manual_url"] == fryer["manual_url"]
    tasks = [row for row in get_demo().tasks if row["equipment_id"] == created["id"]]
    assert len(tasks) == fryer["task_count"]
    assert {row["status"] for row in tasks} == {"pending"}
    updated = svc.set_task_status(created["id"], tasks[0]["id"], "done")
    assert updated["status"] == "done"
    listed = svc.list_equipment(group["id"])
    saved = next(row for row in listed if row["id"] == created["id"])
    assert saved["tasks_done"] == 1
    assert saved["manual_href"] == fryer["manual_url"]
