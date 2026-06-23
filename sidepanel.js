const DEFAULT_COLORS = ["#49c87d", "#f2b84b", "#8fb7ff", "#f06464", "#dfe2da", "#c8b7ff"];

const state = {
  tabs: [],
  positions: {},
  shots: {},
  query: "",
  hasBroadCapture: false,
  dragging: null,
};

const els = {
  canvas: document.querySelector("#canvas"),
  search: document.querySelector("#searchInput"),
  layoutHint: document.querySelector("#layoutHint"),
  tabCount: document.querySelector("#tabCount"),
  shotCount: document.querySelector("#shotCount"),
  captureState: document.querySelector("#captureState"),
  status: document.querySelector("#statusText"),
  refresh: document.querySelector("#refreshButton"),
  capture: document.querySelector("#captureButton"),
  grant: document.querySelector("#grantButton"),
  arrange: document.querySelector("#arrangeButton"),
  clearSearch: document.querySelector("#clearSearchButton"),
};

init();

async function init() {
  bindEvents();
  await readPanelLayout();
  await chrome.runtime.sendMessage({ type: "warmup" }).catch(() => {});
  await refreshState("Click a card to switch the real browser tab.");
}

function bindEvents() {
  els.refresh.addEventListener("click", () => refreshState("Tabs refreshed."));
  els.capture.addEventListener("click", captureActiveTab);
  els.grant.addEventListener("click", checkCaptureAccess);
  els.arrange.addEventListener("click", arrangeCards);
  els.clearSearch.addEventListener("click", () => {
    state.query = "";
    els.search.value = "";
    render();
  });

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
}

async function refreshState(message) {
  const result = await sendMessage({ type: "getState" });
  state.tabs = result.tabs || [];
  state.positions = result.positions || {};
  state.shots = result.shots || {};
  state.hasBroadCapture = Boolean(result.hasBroadCapture);
  render();
  if (message) setStatus(message);
}

async function readPanelLayout() {
  if (!chrome.sidePanel?.getLayout) {
    els.layoutHint.textContent = "Set Chrome side panel to the left in browser settings.";
    return;
  }

  try {
    const layout = await chrome.sidePanel.getLayout({});
    els.layoutHint.textContent =
      layout?.side === "left"
        ? "Panel is on the left. Good for fast switching."
        : "For this product, set Chrome side panel to Left in browser settings.";
  } catch {
    els.layoutHint.textContent = "Set Chrome side panel to the left in browser settings.";
  }
}

function render() {
  const visible = visibleTabs();
  const visibleIds = new Set(visible.map((tab) => String(tab.id)));
  els.tabCount.textContent = String(state.tabs.length);
  els.shotCount.textContent = String(Object.keys(state.shots).length);
  els.captureState.textContent = state.hasBroadCapture ? "Ready" : "Missing";

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
  await sendMessage({ type: "activateTab", tabId: tab.id, windowId: tab.windowId });
  await refreshState(`Switched to ${tab.title}. Canvas stayed open.`);
}

async function captureActiveTab() {
  const active = state.tabs.find((tab) => tab.active);
  if (!active) {
    setStatus("No active tab to capture.");
    return;
  }

  try {
    await sendMessage({ type: "captureTab", tabId: active.id, windowId: active.windowId });
    await refreshState(`Captured ${active.title}.`);
  } catch (error) {
    setStatus(error.message || "Capture failed.");
  }
}

async function checkCaptureAccess() {
  const result = await sendMessage({ type: "checkCaptureAccess" });
  state.hasBroadCapture = Boolean(result.hasBroadCapture);
  render();
  setStatus(
    state.hasBroadCapture
      ? "Capture access is ready for normal web pages."
      : "Capture access is missing. Reload the extension and accept site access.",
  );
}

function startCardPointer(event, tabId) {
  if (event.button !== 0) return;

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
  };

  card.classList.add("is-dragging");
  card.setPointerCapture(event.pointerId);

  function move(moveEvent) {
    const dx = moveEvent.clientX - state.dragging.startX;
    const dy = moveEvent.clientY - state.dragging.startY;
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

async function zoomCard(event, tabId) {
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

async function arrangeCards() {
  state.positions = {};
  state.tabs.forEach((tab, index) => {
    state.positions[String(tab.id)] = defaultPosition(index);
  });
  render();
  await saveLayout();
  setStatus("Cards arranged.");
}

async function saveLayout() {
  await sendMessage({ type: "saveLayout", positions: state.positions });
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
    y: 18 + Math.floor(index / 2) * 184,
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

function setStatus(message) {
  els.status.textContent = message;
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension request failed");
  return response;
}
