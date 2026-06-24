const DEFAULT_COLORS = ["#49c87d", "#f2b84b", "#8fb7ff", "#f06464", "#dfe2da", "#c8b7ff"];
const CANVAS_SIZE = { width: 720, height: 1200 };
const CARD_SIZE = { width: 220, height: 158 };
const BOARD_ZOOM = { min: 0.55, max: 1.8, step: 0.1 };
const PANEL_WIDTH = { min: 240, max: 1600 };
const PANEL_WIDTH_STORAGE_KEY = "tabCanvas.panelWidth";
const SURFACE = new URLSearchParams(window.location.search).get("surface") || "sidepanel";

const state = {
  tabs: [],
  positions: {},
  shots: {},
  boardZoom: 1,
  panelWidth: 0,
  panelRatio: 0,
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
  zoomOut: document.querySelector("#zoomOutButton"),
  zoomIn: document.querySelector("#zoomInButton"),
  zoomSlider: document.querySelector("#zoomSlider"),
  zoomValue: document.querySelector("#zoomValue"),
};

let viewportSaveTimer = 0;
let panelPort = null;
let suppressActiveLocateUntil = 0;
let heldViewport = null;

init();

async function init() {
  panelPort = chrome.runtime.connect({ name: SURFACE === "overlay" ? "tab-canvas-overlay" : "tab-canvas-panel" });
  panelPort.onMessage.addListener(handlePanelPortMessage);
  bindEvents();
  if (SURFACE === "sidepanel") {
    await chrome.runtime.sendMessage({ type: "warmup" }).catch(() => {});
  }
  await refreshState();
  queueSaveViewport();
  window.setTimeout(releasePanelWidthHint, 1200);
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
  window.addEventListener("resize", queueSaveViewport);
  window.addEventListener("pagehide", () => {
    saveViewport().catch(() => {});
  });
}

function handlePanelPortMessage(message) {
  if (message?.type === "closeCanvasPanel") {
    closeCanvasPanelFromRequest();
  }
}

async function closeCanvasPanelFromRequest() {
  try {
    await saveViewport();
  } catch {
    // The panel is already closing; preserving width is best effort.
  }
  window.close();
}

async function refreshState(message) {
  const previousActiveId = activeTabId();
  const result = await sendMessage({ type: "getState" });
  state.tabs = result.tabs || [];
  state.positions = result.positions || {};
  state.shots = result.shots || {};
  state.boardZoom = clamp(Number(result.viewport?.zoom || 1), BOARD_ZOOM.min, BOARD_ZOOM.max);
  state.panelWidth = Number(result.viewport?.panelWidth || 0);
  state.panelRatio = Number(result.viewport?.panelRatio || 0);
  render();
  restoreHeldViewport();
  const nextActiveId = activeTabId();
  if (nextActiveId && nextActiveId !== previousActiveId && !isActiveLocateSuppressed()) {
    scheduleActiveTabLocate();
  }
  if (message) setStatus(message);
}

function render() {
  const visible = visibleTabs();
  const visibleIds = new Set(visible.map((tab) => String(tab.id)));
  const currentIds = new Set(state.tabs.map((tab) => String(tab.id)));
  els.tabCount.textContent =
    visible.length === state.tabs.length ? `${state.tabs.length} tabs` : `${visible.length}/${state.tabs.length}`;
  applyBoardZoom();

  els.canvas.querySelectorAll(".tab-card").forEach((card) => {
    if (!currentIds.has(card.dataset.tabId)) card.remove();
  });

  if (!state.tabs.length) {
    els.canvas.innerHTML = '<div class="empty-state">No readable tabs yet.</div>';
    return;
  }

  els.canvas.querySelector(".empty-state")?.remove();

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
      <button class="card-close" type="button" aria-label="Close tab" title="Close tab">x</button>
    </div>
    <div class="shot"></div>
  `;
  card.addEventListener("pointerdown", (event) => startCardPointer(event, tab.id));
  card.addEventListener("wheel", (event) => zoomCard(event, tab.id), { passive: false });
  const closeButton = card.querySelector(".card-close");
  closeButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeTab(tab.id);
  });
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

async function closeTab(tabId) {
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab) return;

  holdViewportDuringClose();
  setStatus(`Closing ${tab.title}...`);
  try {
    await freezeCurrentPositions();
    await sendMessage({ type: "closeTab", tabId });
    state.tabs = state.tabs.filter((item) => item.id !== tabId);
    delete state.positions[String(tabId)];
    delete state.shots[String(tabId)];
    render();
    restoreHeldViewport();
    await refreshState(`Closed ${tab.title}.`);
    restoreHeldViewport();
  } catch (error) {
    setStatus(error.message || "Could not close tab.");
  }
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
  await sendMessage({ type: "saveViewport", viewport: currentViewportSnapshot() });
}

function currentViewportSnapshot() {
  const panelWidth = Math.round(window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 0);
  rememberPanelWidth(panelWidth);
  return {
    zoom: state.boardZoom,
    panelWidth,
  };
}

function rememberPanelWidth(width) {
  if (!Number.isFinite(width) || width < PANEL_WIDTH.min) return;
  const panelWidth = clamp(Math.round(width), PANEL_WIDTH.min, PANEL_WIDTH.max);
  try {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(panelWidth));
  } catch {
    // Width restoration still has the async extension storage fallback.
  }
}

function releasePanelWidthHint() {
  document.documentElement.style.removeProperty("--tab-canvas-panel-width");
  document.documentElement.style.removeProperty("width");
  document.documentElement.style.removeProperty("min-width");
}

function scheduleActiveTabLocate() {
  if (state.query || state.dragging || state.panning || isActiveLocateSuppressed()) return;
  requestAnimationFrame(() => scrollActiveTabIntoView());
}

function scrollActiveTabIntoView() {
  if (state.query || state.dragging || state.panning || isActiveLocateSuppressed()) return;

  const activeId = activeTabId();
  const activeIndex = state.tabs.findIndex((tab) => tab.id === activeId);
  if (activeIndex < 0) return;

  const key = String(activeId);
  const card = els.canvas.querySelector(`[data-tab-id="${key}"]`);
  if (!card || card.classList.contains("is-hidden")) return;

  const position = state.positions[key] || defaultPosition(activeIndex);
  const scale = Number(position.scale || 1);
  const cardCenterX = (position.x + (CARD_SIZE.width * scale) / 2) * state.boardZoom;
  const cardCenterY = (position.y + (CARD_SIZE.height * scale) / 2) * state.boardZoom;
  const targetLeft = cardCenterX - els.canvasWrap.clientWidth / 2;
  const targetTop = cardCenterY - els.canvasWrap.clientHeight / 2;
  const maxLeft = Math.max(0, els.canvasWrap.scrollWidth - els.canvasWrap.clientWidth);
  const maxTop = Math.max(0, els.canvasWrap.scrollHeight - els.canvasWrap.clientHeight);

  els.canvasWrap.scrollTo({
    left: clamp(targetLeft, 0, maxLeft),
    top: clamp(targetTop, 0, maxTop),
    behavior: "smooth",
  });
}

async function freezeCurrentPositions() {
  let changed = false;
  state.tabs.forEach((tab, index) => {
    const key = String(tab.id);
    if (state.positions[key]) return;
    state.positions[key] = defaultPosition(index);
    changed = true;
  });

  if (changed) await saveLayout();
}

function holdViewportDuringClose() {
  const until = Date.now() + 1200;
  suppressActiveLocateUntil = Math.max(suppressActiveLocateUntil, until);
  heldViewport = {
    left: els.canvasWrap.scrollLeft,
    top: els.canvasWrap.scrollTop,
    until,
  };
}

function restoreHeldViewport() {
  if (!heldViewport) return;
  if (Date.now() > heldViewport.until) {
    heldViewport = null;
    return;
  }

  const maxLeft = Math.max(0, els.canvasWrap.scrollWidth - els.canvasWrap.clientWidth);
  const maxTop = Math.max(0, els.canvasWrap.scrollHeight - els.canvasWrap.clientHeight);
  els.canvasWrap.scrollLeft = clamp(heldViewport.left, 0, maxLeft);
  els.canvasWrap.scrollTop = clamp(heldViewport.top, 0, maxTop);
}

function isActiveLocateSuppressed() {
  return Date.now() < suppressActiveLocateUntil;
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

function activeTabId() {
  return state.tabs.find((tab) => tab.active)?.id || null;
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

function setStatus() {}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension request failed");
  return response;
}
