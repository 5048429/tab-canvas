const DEFAULT_COLORS = ["#49c87d", "#f2b84b", "#8fb7ff", "#f06464", "#dfe2da", "#c8b7ff"];
const CANVAS_SIZE = { width: 720, height: 1200 };
const BOARD_ZOOM = { min: 0.55, max: 1.8, step: 0.1 };

const state = {
  tabs: [],
  positions: {},
  shots: {},
  boardZoom: 1,
  query: "",
  dragging: null,
  panning: null,
};

const els = {
  canvasWrap: document.querySelector("#canvasWrap"),
  canvasPlane: document.querySelector("#canvasPlane"),
  canvas: document.querySelector("#canvas"),
  search: document.querySelector("#searchInput"),
  tabCount: document.querySelector("#tabCount"),
  status: document.querySelector("#statusText"),
  zoomOut: document.querySelector("#zoomOutButton"),
  zoomIn: document.querySelector("#zoomInButton"),
  zoomSlider: document.querySelector("#zoomSlider"),
  zoomValue: document.querySelector("#zoomValue"),
};

let viewportSaveTimer = 0;

init();

async function init() {
  bindEvents();
  await chrome.runtime.sendMessage({ type: "warmup" }).catch(() => {});
  await refreshState("Ready.");
}

function bindEvents() {
  els.zoomOut.addEventListener("click", () => setBoardZoom(state.boardZoom - BOARD_ZOOM.step, { persist: true }));
  els.zoomIn.addEventListener("click", () => setBoardZoom(state.boardZoom + BOARD_ZOOM.step, { persist: true }));
  els.zoomSlider.addEventListener("input", () => {
    setBoardZoom(Number(els.zoomSlider.value) / 100, { persist: true });
  });
  els.canvasWrap.addEventListener("wheel", zoomBoardWithWheel, { passive: false });
  els.canvasWrap.addEventListener("pointerdown", startBoardPan);

  ["input", "search", "change", "keyup"].forEach((eventName) => {
    els.search.addEventListener(eventName, () => {
      state.query = els.search.value;
      render();
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "tabsChanged") {
      refreshState();
    }
  });

  window.addEventListener("keydown", handleKeyDown);
}

async function refreshState(message) {
  const result = await sendMessage({ type: "getState" });
  state.tabs = result.tabs || [];
  state.positions = result.positions || {};
  state.shots = result.shots || {};
  state.boardZoom = clamp(Number(result.viewport?.zoom || 1), BOARD_ZOOM.min, BOARD_ZOOM.max);
  render();
  if (message) setStatus(message);
}

function render() {
  const visible = visibleTabs();
  const visibleIds = new Set(visible.map((tab) => String(tab.id)));
  els.tabCount.textContent =
    visible.length === state.tabs.length ? `${state.tabs.length} tabs` : `${visible.length}/${state.tabs.length}`;
  applyBoardZoom();

  if (!state.tabs.length) {
    els.canvas.innerHTML = '<div class="empty-state">No readable tabs yet.</div>';
    return;
  }

  state.tabs.forEach((tab, index) => {
    const key = String(tab.id);
    let card = els.canvas.querySelector(`[data-tab-id="${key}"]`);
    if (!card) {
      card = createCard(tab);
      els.canvas.appendChild(card);
    }

    const position = state.positions[key] || defaultPosition(index);
    card.style.setProperty("--x", `${position.x}px`);
    card.style.setProperty("--y", `${position.y}px`);
    card.style.setProperty("--scale", position.scale);
    card.style.setProperty("--card-color", tabColor(tab, index));
    card.classList.toggle("is-active", Boolean(tab.active));
    card.classList.toggle("is-hidden", !visibleIds.has(key));
    updateCard(card, tab, index);
  });
}

function createCard(tab) {
  const card = document.createElement("article");
  card.className = "tab-card";
  card.dataset.tabId = String(tab.id);
  card.innerHTML = `
    <div class="card-head">
      <span class="favicon"></span>
      <span class="title"></span>
      <span class="chip"></span>
    </div>
    <div class="shot"></div>
  `;
  card.addEventListener("pointerdown", (event) => startCardPointer(event, tab.id));
  card.addEventListener("wheel", (event) => zoomCard(event, tab.id), { passive: false });
  return card;
}

function updateCard(card, tab, index) {
  const favicon = card.querySelector(".favicon");
  const title = card.querySelector(".title");
  const chip = card.querySelector(".chip");
  const shot = card.querySelector(".shot");
  const shotData = state.shots[String(tab.id)];
  const status = shotStatus(shotData);

  favicon.innerHTML = "";
  if (tab.favIconUrl) {
    const image = document.createElement("img");
    image.src = tab.favIconUrl;
    image.alt = "";
    favicon.appendChild(image);
  } else {
    favicon.textContent = faviconLetter(tab.title);
  }

  title.textContent = tab.title || "Untitled tab";
  chip.textContent = shotLabel(shotData);
  chip.className = `chip ${status}`;
  shot.innerHTML = "";

  if (shotData?.dataUrl) {
    const image = document.createElement("img");
    image.src = shotData.dataUrl;
    image.alt = "";
    shot.appendChild(image);
  } else {
    shot.appendChild(createPlaceholder(tabColor(tab, index)));
  }
}

function createPlaceholder() {
  const wrapper = document.createElement("div");
  wrapper.className = "shot-placeholder";
  wrapper.innerHTML = `
    <div class="shot-col">
      <span class="block hero"></span>
      <span class="block"></span>
      <span class="block short"></span>
    </div>
    <div class="shot-col">
      <span class="block cardish"></span>
      <span class="block"></span>
      <span class="block cardish"></span>
    </div>
  `;
  return wrapper;
}

async function activateTab(tabId) {
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab) return;
  setStatus(`Switching to ${tab.title}...`);
  const result = await sendMessage({ type: "activateAndCaptureTab", tabId: tab.id, windowId: tab.windowId });
  const message = result.captureError
    ? `Switched to ${tab.title}. Snapshot skipped: ${result.captureError}`
    : `Switched to ${tab.title} and refreshed its snapshot.`;
  await refreshState(message);
}

function startCardPointer(event, tabId) {
  if (event.button !== 0) return;
  event.stopPropagation();

  const key = String(tabId);
  const card = event.currentTarget;
  const position = state.positions[key] || defaultPosition(state.tabs.findIndex((tab) => tab.id === tabId));
  let moved = false;

  state.dragging = {
    key,
    startX: event.clientX,
    startY: event.clientY,
    x: position.x,
    y: position.y,
    scale: position.scale,
    boardZoom: state.boardZoom,
  };

  card.classList.add("is-dragging");
  card.setPointerCapture(event.pointerId);

  function move(moveEvent) {
    const dx = (moveEvent.clientX - state.dragging.startX) / state.dragging.boardZoom;
    const dy = (moveEvent.clientY - state.dragging.startY) / state.dragging.boardZoom;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    state.positions[key] = {
      x: state.dragging.x + dx,
      y: state.dragging.y + dy,
      scale: state.dragging.scale,
    };
    render();
  }

  async function up(upEvent) {
    card.releasePointerCapture(upEvent.pointerId);
    card.classList.remove("is-dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    state.dragging = null;

    if (moved) {
      await saveLayout();
    } else {
      await activateTab(tabId);
    }
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startBoardPan(event) {
  if (event.button !== 0 || event.target.closest(".tab-card")) return;

  event.preventDefault();
  state.panning = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: els.canvasWrap.scrollLeft,
    scrollTop: els.canvasWrap.scrollTop,
  };

  els.canvasWrap.classList.add("is-panning");
  els.canvasWrap.setPointerCapture(event.pointerId);

  function move(moveEvent) {
    if (!state.panning || moveEvent.pointerId !== state.panning.pointerId) return;
    els.canvasWrap.scrollLeft = state.panning.scrollLeft - (moveEvent.clientX - state.panning.startX);
    els.canvasWrap.scrollTop = state.panning.scrollTop - (moveEvent.clientY - state.panning.startY);
  }

  function up(upEvent) {
    if (!state.panning || upEvent.pointerId !== state.panning.pointerId) return;
    if (els.canvasWrap.hasPointerCapture(upEvent.pointerId)) {
      els.canvasWrap.releasePointerCapture(upEvent.pointerId);
    }
    els.canvasWrap.classList.remove("is-panning");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    state.panning = null;
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

async function zoomCard(event, tabId) {
  if (event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  event.stopPropagation();
  const key = String(tabId);
  const tabIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  const position = state.positions[key] || defaultPosition(tabIndex);
  const delta = event.deltaY > 0 ? -0.06 : 0.06;
  state.positions[key] = {
    ...position,
    scale: clamp(position.scale + delta, 0.62, 1.55),
  };
  render();
  await saveLayout();
}

async function saveLayout() {
  await sendMessage({ type: "saveLayout", positions: state.positions });
}

function zoomBoardWithWheel(event) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const direction = event.deltaY > 0 ? -1 : 1;
  setBoardZoom(state.boardZoom + direction * BOARD_ZOOM.step, {
    anchorEvent: event,
    persist: true,
  });
}

function setBoardZoom(value, options = {}) {
  const next = roundZoom(clamp(value, BOARD_ZOOM.min, BOARD_ZOOM.max));
  if (next === state.boardZoom) return;

  const anchor = options.anchorEvent ? boardPointFromEvent(options.anchorEvent) : null;
  state.boardZoom = next;
  applyBoardZoom();

  if (anchor && options.anchorEvent) {
    const rect = els.canvasWrap.getBoundingClientRect();
    els.canvasWrap.scrollLeft = anchor.x * next - (options.anchorEvent.clientX - rect.left);
    els.canvasWrap.scrollTop = anchor.y * next - (options.anchorEvent.clientY - rect.top);
  }

  if (options.persist) queueSaveViewport();
}

function applyBoardZoom() {
  const zoom = state.boardZoom;
  els.canvasPlane.style.width = `${CANVAS_SIZE.width * zoom}px`;
  els.canvasPlane.style.height = `${CANVAS_SIZE.height * zoom}px`;
  els.canvas.style.transform = `scale(${zoom})`;
  els.zoomSlider.value = String(Math.round(zoom * 100));
  els.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
}

function boardPointFromEvent(event) {
  const rect = els.canvasWrap.getBoundingClientRect();
  return {
    x: (els.canvasWrap.scrollLeft + event.clientX - rect.left) / state.boardZoom,
    y: (els.canvasWrap.scrollTop + event.clientY - rect.top) / state.boardZoom,
  };
}

function queueSaveViewport() {
  clearTimeout(viewportSaveTimer);
  viewportSaveTimer = setTimeout(saveViewport, 220);
}

async function saveViewport() {
  await sendMessage({ type: "saveViewport", viewport: { zoom: state.boardZoom } });
}

async function arrangeCards() {
  state.positions = {};
  state.tabs.forEach((tab, index) => {
    state.positions[String(tab.id)] = defaultPosition(index);
  });
  render();
  await saveLayout();
  setStatus("Arranged.");
}

function handleKeyDown(event) {
  if (event.key === "Escape" && state.query) {
    state.query = "";
    els.search.value = "";
    render();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key === "0") {
    event.preventDefault();
    setBoardZoom(1, { persist: true });
    return;
  }

  if (event.altKey && event.key.toLowerCase() === "a") {
    event.preventDefault();
    arrangeCards();
  }
}

function visibleTabs() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.tabs;
  return state.tabs.filter((tab) =>
    [tab.title, tab.url].some((value) => String(value || "").toLowerCase().includes(query)),
  );
}

function defaultPosition(index) {
  return {
    x: 18 + (index % 2) * 244,
    y: 76 + Math.floor(index / 2) * 184,
    scale: index === 0 ? 1 : 0.92,
  };
}

function tabColor(tab, index) {
  if (tab.active) return "#49c87d";
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function shotStatus(shot) {
  if (!shot) return "missing";
  const minutes = (Date.now() - shot.capturedAt) / 60000;
  return minutes <= 5 ? "" : "stale";
}

function shotLabel(shot) {
  if (!shot) return "no shot";
  const minutes = Math.max(0, Math.round((Date.now() - shot.capturedAt) / 60000));
  if (minutes === 0) return "now";
  return `${minutes}m`;
}

function faviconLetter(title) {
  return String(title || "T").trim().charAt(0).toUpperCase() || "T";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundZoom(value) {
  return Math.round(value * 100) / 100;
}

function setStatus(message) {
  els.status.textContent = message;
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension request failed");
  return response;
}
