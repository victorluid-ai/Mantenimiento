/**
 * Esqueleto de seguimiento de mantenimiento preventivo (grupo Essencia).
 * El catálogo se lee de data/equipment-catalog.json.
 * La cocina y el estado de cada tarea viven en localStorage.
 */

const STORAGE_KEY = "essencia.mantenimiento.v1";

const INTERVAL_LABELS = {
  diaria: "Diaria",
  semanal: "Semanal",
  mensual: "Mensual",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  cuando_indique: "Cuando lo indique",
};

const INTERVAL_ORDER = [
  "diaria",
  "semanal",
  "mensual",
  "bimestral",
  "trimestral",
  "semestral",
  "anual",
  "cuando_indique",
];

const STATUS_FILTERS = [
  ["all", "Todas"],
  ["pending", "Pendientes"],
  ["done", "Hechas"],
];

const app = document.querySelector("#app");
const legal = document.querySelector("#legal");

let catalog = null;
let catalogByKey = new Map();
let saved = null;
let draft = null;
let screen = "setup";
let boardFilter = { status: "all", interval: "all" };

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "text") {
      node.textContent = String(value);
      continue;
    }
    if (key === "class") {
      node.className = String(value);
      continue;
    }
    if (key === "checked" || key === "disabled" || key === "selected") {
      node[key] = Boolean(value);
      continue;
    }
    if (key === "value") {
      node.value = String(value);
      continue;
    }
    node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

function equipmentKey(item) {
  return `${item.brand} ${item.model}`;
}

function taskStorageKey(eqKey, taskId) {
  return `${eqKey}::${taskId}`;
}

function norm(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function safeUrl(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function intervalLabel(interval) {
  return INTERVAL_LABELS[interval] ?? interval;
}

function manualStatusLabel(status) {
  switch (status) {
    case "pdf_publico":
      return "Manual en PDF";
    case "pagina_soporte":
      return "Página de soporte";
    case "sin_pdf_publico":
      return "Sin PDF público";
    default:
      return status || "Enlace";
  }
}

function manualLinkLabel(status) {
  switch (status) {
    case "pdf_publico":
      return "Abrir manual oficial";
    case "pagina_soporte":
      return "Abrir página de soporte";
    case "sin_pdf_publico":
      return "Abrir web del fabricante";
    default:
      return "Abrir enlace del fabricante";
  }
}

function tasksOf(item) {
  return Array.isArray(item.tasks) ? item.tasks : [];
}

function categories() {
  const list = [];
  for (const item of catalog.equipment) {
    if (!list.includes(item.category)) list.push(item.category);
  }
  return list;
}

function formatWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function indexCatalog() {
  catalogByKey = new Map();
  for (const item of catalog.equipment) {
    const key = equipmentKey(item);
    if (catalogByKey.has(key)) {
      throw new Error(`Equipo duplicado en el catálogo: ${key}`);
    }
    catalogByKey.set(key, item);
  }
}

function sanitizeTasks(raw) {
  if (!raw || typeof raw !== "object") return {};
  const tasks = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || typeof value.done !== "boolean") continue;
    tasks[key] = {
      done: value.done,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    };
  }
  return tasks;
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) return null;
    const rawKeys = Array.isArray(parsed.equipmentKeys)
      ? parsed.equipmentKeys.filter((key) => typeof key === "string")
      : [];
    const wanted = new Set(rawKeys);
    const equipmentKeys = catalog.equipment.map(equipmentKey).filter((key) => wanted.has(key));
    return {
      name: parsed.name.trim().slice(0, 80),
      equipmentKeys,
      tasks: sanitizeTasks(parsed.tasks),
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

function isDone(eqKey, taskId) {
  return Boolean(saved?.tasks?.[taskStorageKey(eqKey, taskId)]?.done);
}

function taskRecord(eqKey, taskId) {
  return saved?.tasks?.[taskStorageKey(eqKey, taskId)] ?? null;
}

function selectedItems() {
  return saved.equipmentKeys.map((key) => catalogByKey.get(key)).filter(Boolean);
}

function progressStats(items = selectedItems()) {
  let total = 0;
  let done = 0;
  for (const item of items) {
    const key = equipmentKey(item);
    for (const task of tasksOf(item)) {
      total += 1;
      if (isDone(key, task.id)) done += 1;
    }
  }
  return { total, done, pending: total - done };
}

function filteredEquipment() {
  const query = norm(draft.query.trim());
  return catalog.equipment.filter((item) => {
    if (draft.category !== "all" && item.category !== draft.category) return false;
    if (!query) return true;
    return norm(`${item.category} ${item.brand} ${item.model}`).includes(query);
  });
}

function matchesFilter(task, eqKey) {
  if (boardFilter.interval !== "all" && task.interval !== boardFilter.interval) return false;
  const done = isDone(eqKey, task.id);
  if (boardFilter.status === "pending") return !done;
  if (boardFilter.status === "done") return done;
  return true;
}

function intervalsInUse() {
  const present = new Set();
  for (const item of selectedItems()) {
    for (const task of tasksOf(item)) present.add(task.interval);
  }
  const known = INTERVAL_ORDER.filter((interval) => present.has(interval));
  const extra = [...present].filter((interval) => !INTERVAL_ORDER.includes(interval));
  return [...known, ...extra];
}

function canReturnToBoard() {
  return Boolean(saved && saved.name && saved.equipmentKeys.length > 0);
}

function updateTitle() {
  document.title = saved?.name
    ? `${saved.name} · Mantenimiento Essencia`
    : "Mantenimiento preventivo · Essencia";
}

function render(focus) {
  const keepScroll = Boolean(focus?.taskKey || focus?.status);
  const scrollY = keepScroll ? window.scrollY : 0;
  app.replaceChildren(screen === "setup" ? renderSetup() : renderBoard());
  app.dataset.screen = screen;
  updateTitle();
  if (focus?.taskKey) {
    const node = document.querySelector(`[data-task-key="${CSS.escape(focus.taskKey)}"]`);
    if (node) node.focus();
    else document.querySelector('[data-action="filter-status"][aria-pressed="true"]')?.focus();
  } else if (focus?.status) {
    document
      .querySelector(`[data-action="filter-status"][data-status="${CSS.escape(focus.status)}"]`)
      ?.focus();
  }
  window.scrollTo(0, scrollY);
}

function renderHeader(actions) {
  return el("header", { class: "topbar" }, [
    el("div", {}, [
      el("p", { class: "eyebrow", text: "Grupo Essencia" }),
      el("h1", { text: "Mantenimiento preventivo" }),
    ]),
    actions.length ? el("div", { class: "top-actions" }, actions) : null,
  ]);
}

function renderSetup() {
  const editing = canReturnToBoard();
  const root = el("div", { class: "wrap" }, [
    renderHeader(
      editing
        ? [
            el("button", {
              type: "button",
              class: "button",
              "data-action": "cancel",
              text: "Cancelar",
            }),
            el("button", {
              type: "button",
              class: "button danger",
              "data-action": "delete",
              text: "Borrar datos locales",
            }),
          ]
        : [],
    ),
    el("p", {
      class: "lead",
      text: "Crea la cocina, marca las máquinas instaladas y consulta las tareas de mantenimiento preventivo. Lo que marques como hecho o pendiente se guarda en este navegador.",
    }),
    el("form", { id: "setup-form", class: "stack" }, [
      el("label", { class: "field" }, [
        el("span", { text: "Nombre de la cocina" }),
        el("input", {
          id: "kitchen-name",
          type: "text",
          maxlength: "80",
          required: true,
          autocomplete: "off",
          placeholder: "Cocina de Essencia Centro",
          value: draft.name,
        }),
      ]),
      el("div", { class: "section-head" }, [
        el("h2", { text: "Equipos del catálogo" }),
        el("p", {
          class: "count",
          text: `${countLabel(catalog.equipment.length, "equipo", "equipos")} en el catálogo semilla`,
        }),
      ]),
      el("div", { class: "filters-setup" }, [
        el("label", { class: "field" }, [
          el("span", { text: "Buscar" }),
          el("input", {
            id: "equip-search",
            type: "search",
            placeholder: "Marca, modelo o categoría",
            value: draft.query,
          }),
        ]),
        el("label", { class: "field" }, [
          el("span", { text: "Categoría" }),
          el(
            "select",
            { id: "equip-category" },
            [
              el("option", { value: "all", text: "Todas", selected: draft.category === "all" }),
              ...categories().map((category) =>
                el("option", {
                  value: category,
                  text: category,
                  selected: draft.category === category,
                }),
              ),
            ],
          ),
        ]),
      ]),
      el("ul", { id: "equip-list", class: "equip-list" }),
      el("p", { id: "selection-meta", class: "count" }),
      el("div", { class: "actions" }, [
        el("button", {
          id: "save-kitchen",
          class: "button primary",
          type: "submit",
          text: editing ? "Guardar cambios" : "Crear cocina",
        }),
      ]),
      el("p", { id: "save-hint", class: "hint" }),
    ]),
  ]);
  paintEquipList(root);
  paintSelectionMeta(root);
  return root;
}

function renderEquipCard(item) {
  const key = equipmentKey(item);
  const selected = draft.equipmentKeys.includes(key);
  const taskCount = tasksOf(item).length;
  const input = el("input", {
    type: "checkbox",
    name: "equipment",
    value: key,
    checked: selected,
  });
  return el("li", {}, [
    el(
      "label",
      {
        class: `equip-card${selected ? " is-selected" : ""}`,
        "data-equip-key": key,
      },
      [
        input,
        el("span", {}, [
          el("span", { class: "eyebrow", text: item.category }),
          el("strong", { text: `${item.brand} — ${item.model}` }),
          el("span", {
            class: "count",
            text: `${countLabel(taskCount, "tarea", "tareas")} · ${manualStatusLabel(item.manual_status)}`,
          }),
        ]),
      ],
    ),
  ]);
}

function paintEquipList(scope = document) {
  const list = scope.querySelector("#equip-list");
  if (!list) return;
  const items = filteredEquipment();
  if (items.length === 0) {
    list.replaceChildren(
      el("li", {}, [
        el("p", { class: "empty", text: "Ningún equipo coincide con la búsqueda." }),
      ]),
    );
    return;
  }
  list.replaceChildren(...items.map(renderEquipCard));
}

function paintSelectionMeta(scope = document) {
  const meta = scope.querySelector("#selection-meta");
  const hint = scope.querySelector("#save-hint");
  const save = scope.querySelector("#save-kitchen");
  if (!meta || !hint || !save) return;
  const selectedCount = draft.equipmentKeys.length;
  const visible = new Set(filteredEquipment().map(equipmentKey));
  const hidden = draft.equipmentKeys.filter((key) => !visible.has(key)).length;
  let text = countLabel(selectedCount, "equipo seleccionado", "equipos seleccionados");
  if (hidden === 1) text += ". 1 seleccionado no coincide con el filtro y sigue marcado.";
  else if (hidden > 1) text += `. ${hidden} seleccionados no coinciden con el filtro y siguen marcados.`;
  meta.textContent = text;

  const nameOk = draft.name.trim().length > 0;
  const ready = nameOk && selectedCount > 0;
  save.disabled = !ready;
  const nextHint = ready
    ? "Al guardar verás las tareas de los equipos elegidos."
    : !nameOk && selectedCount === 0
      ? "Escribe el nombre de la cocina y elige al menos un equipo."
      : !nameOk
        ? "Escribe el nombre de la cocina."
        : "Elige al menos un equipo del catálogo.";
  if (hint.textContent !== nextHint) hint.textContent = nextHint;
}

function renderBoard() {
  const stats = progressStats();
  const intervals = intervalsInUse();
  if (boardFilter.interval !== "all" && !intervals.includes(boardFilter.interval)) {
    boardFilter.interval = "all";
  }
  const percent = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100);
  return el("div", { class: "wrap" }, [
    renderHeader([
      el("button", {
        type: "button",
        class: "button",
        "data-action": "configure",
        text: "Configurar cocina",
      }),
      el("button", {
        type: "button",
        class: "button danger",
        "data-action": "delete",
        text: "Borrar datos locales",
      }),
    ]),
    el("p", { class: "eyebrow", text: "Cocina" }),
    el("h2", { text: saved.name }),
    el("p", {
      class: "lead",
      text: "Marca cada tarea cuando la completes. El manual se abre en una pestaña nueva; esta aplicación no descarga ni guarda el PDF.",
    }),
    el("p", { class: "summary", id: "progress-label", text: progressText(stats) }),
    stats.total > 0
      ? el(
          "div",
          {
            class: "progress",
            role: "progressbar",
            "aria-valuemin": "0",
            "aria-valuemax": String(stats.total),
            "aria-valuenow": String(stats.done),
            "aria-label": "Tareas hechas",
          },
          [el("span", { style: `width: ${percent}%` })],
        )
      : null,
    el("div", { class: "filters" }, [
      el(
        "div",
        { class: "segment", role: "group", "aria-label": "Filtrar por estado" },
        STATUS_FILTERS.map(([status, label]) =>
          el("button", {
            type: "button",
            "data-action": "filter-status",
            "data-status": status,
            "aria-pressed": boardFilter.status === status ? "true" : "false",
            text: label,
          }),
        ),
      ),
      el("label", { class: "field interval-field" }, [
        el("span", { text: "Intervalo" }),
        el(
          "select",
          { id: "interval-filter" },
          [
            el("option", {
              value: "all",
              text: "Todos los intervalos",
              selected: boardFilter.interval === "all",
            }),
            ...intervals.map((interval) =>
              el("option", {
                value: interval,
                text: intervalLabel(interval),
                selected: boardFilter.interval === interval,
              }),
            ),
          ],
        ),
      ]),
    ]),
    filterNote(),
    ...selectedItems().map(renderMachine),
  ]);
}

function progressText(stats) {
  if (stats.total === 0) return "Los equipos elegidos no tienen tareas en el catálogo.";
  const noun = stats.total === 1 ? "tarea hecha" : "tareas hechas";
  return `${stats.done} de ${stats.total} ${noun}`;
}

function filterNote() {
  if (boardFilter.status === "all" && boardFilter.interval === "all") return null;
  const parts = [];
  if (boardFilter.status === "pending") parts.push("Pendientes");
  if (boardFilter.status === "done") parts.push("Hechas");
  if (boardFilter.interval !== "all") parts.push(intervalLabel(boardFilter.interval));
  return el("p", { class: "filter-note", text: `Filtro activo: ${parts.join(" · ")}.` });
}

function renderMachine(item) {
  const key = equipmentKey(item);
  const tasks = tasksOf(item);
  const stats = progressStats([item]);
  const visible = tasks.filter((task) => matchesFilter(task, key));
  const href = safeUrl(item.manual_url);
  const linkLabel = manualLinkLabel(item.manual_status);
  const link = href
    ? el("a", {
        class: "button primary external",
        href,
        target: "_blank",
        rel: "noopener noreferrer",
        text: linkLabel,
        "aria-label": `${linkLabel} de ${item.brand} ${item.model}. Se abre en una pestaña nueva.`,
      })
    : el("p", { class: "empty", text: "Enlace de manual no disponible." });

  let taskBlock;
  if (tasks.length === 0) {
    taskBlock = item.notes
      ? null
      : el("p", {
          class: "empty",
          text: "No hay tareas de mantenimiento en el catálogo para este equipo.",
        });
  } else if (visible.length === 0) {
    taskBlock = el("p", { class: "empty", text: "Ninguna tarea coincide con el filtro." });
  } else {
    taskBlock = el(
      "ul",
      { class: "task-list" },
      visible.map((task) => renderTask(item, key, task)),
    );
  }

  const countText = tasks.length === 0 ? "Sin tareas en el catálogo" : progressText(stats);

  return el("article", { class: "machine", "data-equip-key": key }, [
    el("header", { class: "machine-head" }, [
      el("div", {}, [
        el("p", { class: "eyebrow", text: item.category }),
        el("h3", { text: `${item.brand} — ${item.model}` }),
        el("p", { class: "count", text: countText }),
      ]),
      el("div", { class: "machine-links" }, [
        el("span", {
          class: `badge${item.manual_status === "pdf_publico" ? "" : " warn"}`,
          text: manualStatusLabel(item.manual_status),
        }),
        link,
      ]),
    ]),
    renderNotes(item),
    taskBlock,
    renderSources(item),
  ]);
}

function renderNotes(item) {
  if (typeof item.notes !== "string" || !item.notes.trim()) return null;
  return el("p", { class: "gap-note", text: item.notes });
}

function renderTask(item, eqKey, task) {
  const storageKey = taskStorageKey(eqKey, task.id);
  const record = taskRecord(eqKey, task.id);
  const done = Boolean(record?.done);
  const when = done ? formatWhen(record?.updatedAt) : "";
  const stateLabel = done ? "Hecho" : "Pendiente";
  const meta = [stateLabel, intervalLabel(task.interval)];
  if (when) meta.push(when);
  const input = el("input", {
    type: "checkbox",
    name: "task",
    checked: done,
    "data-task-key": storageKey,
    "data-equip-key": eqKey,
    "data-task-id": task.id,
  });
  return el("li", {}, [
    el("label", { class: `task${done ? " is-done" : ""}` }, [
      input,
      el("span", {}, [
        el("span", { class: "task-title", text: task.title }),
        el("span", { class: "task-meta", text: meta.join(" · ") }),
        task.source_note
          ? el("span", { class: "source-note" }, [
              el("span", { class: "sr-only", text: "Fuente: " }),
              document.createTextNode(task.source_note),
            ])
          : null,
      ]),
    ]),
  ]);
}

function renderSources(item) {
  const extras = (Array.isArray(item.sources) ? item.sources : []).filter((source) => {
    return source && typeof source.url === "string" && source.url !== item.manual_url && safeUrl(source.url);
  });
  if (extras.length === 0) return null;
  return el("details", { class: "sources" }, [
    el("summary", { text: "Otras fuentes citadas" }),
    el(
      "ul",
      {},
      extras.map((source) => {
        const href = safeUrl(source.url);
        return el("li", {}, [
          el("a", {
            href,
            target: "_blank",
            rel: "noopener noreferrer",
            text: source.name || href,
          }),
        ]);
      }),
    ),
  ]);
}

function openSetup() {
  draft = {
    name: saved?.name ?? "",
    equipmentKeys: [...(saved?.equipmentKeys ?? [])],
    query: "",
    category: "all",
  };
  screen = "setup";
  render();
}

function saveKitchen() {
  const name = draft.name.trim();
  if (!name || draft.equipmentKeys.length === 0) {
    paintSelectionMeta();
    return;
  }
  const next = {
    name,
    equipmentKeys: catalog.equipment
      .map(equipmentKey)
      .filter((key) => draft.equipmentKeys.includes(key)),
    tasks: saved?.tasks ?? {},
  };
  const previous = saved;
  saved = next;
  if (!persist()) {
    saved = previous;
    render();
    flash("No se ha podido guardar la cocina en este navegador.");
    return;
  }
  screen = "board";
  render();
}

function toggleEquipment(key, checked, card) {
  const selected = new Set(draft.equipmentKeys);
  if (checked) selected.add(key);
  else selected.delete(key);
  draft.equipmentKeys = catalog.equipment.map(equipmentKey).filter((itemKey) => selected.has(itemKey));
  if (card) card.classList.toggle("is-selected", checked);
  paintSelectionMeta();
}

function toggleTask(eqKey, taskId, done) {
  const key = taskStorageKey(eqKey, taskId);
  const previous = saved.tasks[key];
  saved.tasks[key] = { done, updatedAt: new Date().toISOString() };
  if (!persist()) {
    if (previous) saved.tasks[key] = previous;
    else delete saved.tasks[key];
    return false;
  }
  return true;
}

function deleteKitchen() {
  const confirmed = window.confirm(
    "¿Borrar la cocina y todas las tareas marcadas en este navegador?",
  );
  if (!confirmed) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error(error);
    flash("No se han podido borrar los datos de este navegador.");
    return;
  }
  saved = null;
  boardFilter = { status: "all", interval: "all" };
  openSetup();
}

function flash(message) {
  const node = el("p", { id: "flash", class: "flash", role: "alert", text: message });
  app.prepend(node);
}

function renderLegal() {
  legal.hidden = false;
  legal.replaceChildren(
    el("div", { class: "wrap" }, [
      el("h2", { text: "Nota legal" }),
      el("p", { text: catalog.legal_note }),
    ]),
  );
}

function renderError() {
  app.dataset.screen = "error";
  app.replaceChildren(
    el("div", { class: "wrap" }, [
      el("h1", { text: "No se ha podido cargar el catálogo" }),
      el("p", {
        class: "lead",
        text: "Abre esta aplicación con un servidor local, no como archivo suelto. En la carpeta del proyecto ejecuta python3 -m http.server 8080 y entra en http://127.0.0.1:8080.",
      }),
    ]),
  );
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const target = event.target;
  if (target instanceof HTMLInputElement && target.id === "equip-search") {
    event.preventDefault();
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== "setup-form") return;
  event.preventDefault();
  saveKitchen();
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || screen !== "setup") return;
  if (target.id === "kitchen-name") {
    draft.name = target.value;
    paintSelectionMeta();
  } else if (target.id === "equip-search") {
    draft.query = target.value;
    paintEquipList();
    paintSelectionMeta();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.name === "equipment" && screen === "setup") {
    const card = target.closest("[data-equip-key]");
    toggleEquipment(target.value, target.checked, card);
    return;
  }
  if (target instanceof HTMLSelectElement && target.id === "equip-category" && screen === "setup") {
    draft.category = target.value;
    paintEquipList();
    paintSelectionMeta();
    return;
  }
  if (target instanceof HTMLSelectElement && target.id === "interval-filter" && screen === "board") {
    boardFilter.interval = target.value;
    render();
    return;
  }
  if (target instanceof HTMLInputElement && target.name === "task" && screen === "board") {
    const eqKey = target.dataset.equipKey ?? "";
    const taskId = target.dataset.taskId ?? "";
    const focusKey = target.dataset.taskKey ?? "";
    const ok = toggleTask(eqKey, taskId, target.checked);
    render({ taskKey: focusKey });
    if (!ok) flash("No se ha podido guardar el cambio en este navegador.");
  }
});

document.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const action = button.dataset.action;
  switch (action) {
    case "cancel":
      screen = "board";
      render();
      break;
    case "configure":
      openSetup();
      break;
    case "delete":
      deleteKitchen();
      break;
    case "filter-status": {
      const status = button.dataset.status;
      if (status !== "all" && status !== "pending" && status !== "done") break;
      boardFilter.status = status;
      render({ status });
      break;
    }
    default:
      console.error("Acción no contemplada", action);
  }
});

async function loadCatalog() {
  const response = await fetch("data/equipment-catalog.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.equipment) || typeof data.legal_note !== "string") {
    throw new Error("Formato de catálogo no válido");
  }
  return data;
}

try {
  catalog = await loadCatalog();
  indexCatalog();
  if (catalog.coverage_summary && catalog.coverage_summary.total !== catalog.equipment.length) {
    console.warn("coverage_summary.total no coincide con equipment.length");
  }
  saved = loadSaved();
  if (canReturnToBoard()) {
    screen = "board";
    render();
  } else {
    openSetup();
  }
  renderLegal();
} catch (error) {
  console.error(error);
  renderError();
}
