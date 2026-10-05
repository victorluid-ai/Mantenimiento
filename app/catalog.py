"""Catálogo real de máquinas (URLs de manual, sin PDFs)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "equipment-catalog.json"

INTERVAL_LABELS = {
    "diaria": "Diaria",
    "semanal": "Semanal",
    "mensual": "Mensual",
    "bimestral": "Bimestral",
    "trimestral": "Trimestral",
    "semestral": "Semestral",
    "anual": "Anual",
    "cuando_indique": "Cuando lo indique",
}

MANUAL_LINK_LABELS = {
    "pdf_publico": "Abrir manual oficial",
    "pagina_soporte": "Abrir página de soporte",
    "sin_pdf_publico": "Abrir web del fabricante",
}

# Solo cuando el tipo genérico del demo coincide con la categoría del catálogo.
TYPE_NAME_BY_CATEGORY = {
    "Horno combi": "Horno mixto / combi",
    "Lavavajillas": "Lavavajillas industrial",
    "Cámara frigorífica": "Cámara frigorífica",
    "Campana extractora": "Campana extractora",
}


def catalog_key(brand: str, model: str) -> str:
    return f"{brand.strip()}::{model.strip()}"


def interval_text(interval: str) -> str:
    return INTERVAL_LABELS.get(interval, interval)


def safe_http_url(url: str | None) -> str | None:
    if not url or not isinstance(url, str):
        return None
    stripped = url.strip()
    if stripped.startswith("https://") or stripped.startswith("http://"):
        return stripped
    return None


@lru_cache
def load_catalog() -> dict[str, Any]:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    equipment = data.get("equipment")
    if not isinstance(equipment, list) or not isinstance(data.get("legal_note"), str):
        raise ValueError(f"Catálogo no válido: {CATALOG_PATH}")
    return data


def legal_note() -> str:
    return load_catalog()["legal_note"]


def _public_item(raw: dict[str, Any]) -> dict[str, Any]:
    brand = str(raw.get("brand") or "").strip()
    model = str(raw.get("model") or "").strip()
    tasks = raw.get("tasks") if isinstance(raw.get("tasks"), list) else []
    status = str(raw.get("manual_status") or "")
    return {
        "key": catalog_key(brand, model),
        "category": str(raw.get("category") or ""),
        "brand": brand,
        "model": model,
        "manual_url": safe_http_url(raw.get("manual_url")) or "",
        "manual_status": status,
        "link_label": MANUAL_LINK_LABELS.get(status, "Abrir enlace del fabricante"),
        "suggested_type_name": TYPE_NAME_BY_CATEGORY.get(str(raw.get("category") or "")),
        "task_count": len(tasks),
        "notes": str(raw.get("notes") or "").strip(),
        "tasks": [
            {
                "id": str(task.get("id") or ""),
                "title": str(task.get("title") or ""),
                "interval": str(task.get("interval") or ""),
                "source_note": str(task.get("source_note") or ""),
            }
            for task in tasks
            if task.get("id") and task.get("title")
        ],
    }


def list_items() -> list[dict[str, Any]]:
    return [_public_item(item) for item in load_catalog()["equipment"]]


def get_item(key: str) -> dict[str, Any] | None:
    if not key:
        return None
    for item in list_items():
        if item["key"] == key:
            return item
    return None


def match_item(brand: str | None, model: str | None) -> dict[str, Any] | None:
    if not brand or not model:
        return None
    return get_item(catalog_key(brand, model))
