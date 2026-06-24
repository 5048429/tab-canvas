const STORAGE_KEYS = {
  positions: "tabCanvas.positions",
  shots: "tabCanvas.shots",
  viewport: "tabCanvas.viewport",
};

const SIDE_PANEL_PATH = "sidepanel.html";
const PANEL_WIDTH = { min: 240, max: 1600 };
const OVERLAY_PRELOAD_TIMEOUT_MS = 650;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const openPanelWindows = new Set();
const panelPortsByWindow = new Map();
const overlayOpenWindows = new Map();
const autoCaptureTimers = new Map();

function withTimeout(promise, ms) {
  return Promise.race([promise, sleep(ms).then(() => undefined)]);
}

async function setPanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

async function initializeExtension() {
  await setPanelBehavior();
  await injectHandlesIntoOpenTabs();
}

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  initializeExtension().catch(() => {});
});

chrome.action?.onClicked?.addListener((tab) => {
  toggleCanvasSurfaceFromAction(tab).catch(() => {});
});

if (chrome.sidePanel?.onOpened) {
  chrome.sidePanel.onOpened.addListener((info) => {
    if (info?.windowId) openPanelWindows.add(info.windowId);
  });
}

if (chrome.sidePanel?.onClosed) {
  chrome.sidePanel.onClosed.addListener((info) => {
    if (info?.windowId) openPanelWindows.delete(info.windowId);
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "tab-canvas-panel") return;
  let panelWindowId = null;
  resolveWindowId()
    .then((windowId) => {
      panelWindowId = windowId;
      if (panelWindowId) {
        openPanelWindows.add(panelWindowId);
        panelPortsByWindow.set(panelWindowId, port);
      }
    })
    .catch(() => {});
  port.onDisconnect.addListener(() => {
    if (panelWindowId) {
      openPanelWindows.delete(panelWindowId);
      if (panelPortsByWindow.get(panelWindowId) === port) {
        panelPortsByWindow.delete(panelWindowId);
      }
    }
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  notifyPanelTabsChanged();
  chrome.tabs
    .get(activeInfo.tabId)
    .then(async (tab) => {
      await injectHandleIntoTab(tab);
      await syncCanvasOverlayIntoTab(tab);
      scheduleAutoCapture(tab, "activated");
    })
    .catch(() => {});
});
chrome.tabs.onCreated.addListener(() => notifyPanelTabsChanged());
chrome.tabs.onRemoved.addListener((tabId) => {
  cleanupClosedTab(tabId)
    .catch(() => {})
    .finally(() => notifyPanelTabsChanged());
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.title || changeInfo.url || changeInfo.favIconUrl || changeInfo.status) {
    notifyPanelTabsChanged();
  }
  if (changeInfo.status === "complete" || changeInfo.url) {
    chrome.tabs
      .get(tabId)
      .then(async (tab) => {
        await injectHandleIntoTab(tab);
        await syncCanvasOverlayIntoTab(tab);
        if (tab.active) scheduleAutoCapture(tab, "updated");
      })
      .catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "toggleCanvasFromHandle") {
    toggleCanvasFromHandle(sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "getState":
      return getState();
    case "toggleCanvasPanel":
      return toggleCanvasPanel(sender);
    case "closeCanvasPanel":
      return closeCanvasPanel(await resolveWindowId(sender, message.windowId));
    case "checkCaptureAccess":
      return { hasBroadCapture: await hasRequiredCaptureAccess() };
    case "activateTab":
      return activateTab(message.tabId, message.windowId);
    case "activateAndCaptureTab":
      return activateAndCaptureTab(message.tabId, message.windowId);
    case "closeTab":
      return closeTab(message.tabId);
    case "captureTab":
      return captureTab(message.tabId, message.windowId);
    case "saveLayout":
      return saveLayout(message.positions);
    case "saveViewport":
      return saveViewport(message.viewport, sender);
    case "getCanvasOverlayState":
      return getCanvasOverlayState(sender);
    case "setCanvasOverlayState":
      return setCanvasOverlayState(message, sender);
    case "saveCanvasOverlayWidth":
      return saveCanvasOverlayWidth(message, sender);
    case "clearShot":
      return clearShot(message.tabId);
    case "warmup":
      return markFocusedPanelOpen();
    default:
      throw new Error("Unknown message type");
  }
}

async function toggleCanvasPanel(sender) {
  const windowId = sender?.tab?.windowId || (await resolveWindowId(sender));
  if (!windowId) throw new Error("No active browser window found");

  if (openPanelWindows.has(windowId)) {
    return closeCanvasPanel(windowId);
  }

  if (!chrome.sidePanel?.open) {
    throw new Error("Side Panel API is unavailable in this browser");
  }

  preparePanelForOpen(windowId).catch(() => {});
  const openPromise = chrome.sidePanel.open({ windowId });
  await openPromise;
  openPanelWindows.add(windowId);
  return { panelState: "open" };
}

async function toggleCanvasSurfaceFromAction(tab) {
  if (tab?.id && isInjectablePage(tab.url)) {
    try {
      await injectHandleIntoTab(tab);
      await chrome.tabs.sendMessage(tab.id, { type: "toggleCanvasOverlay" });
      return;
    } catch {
      // Fall back to the native side panel on pages where content messaging fails.
    }
  }

  await toggleCanvasPanel({ tab });
}

async function getCanvasOverlayState(sender) {
  const windowId = await resolveWindowId(sender);
  if (!windowId) return { isOpen: false, width: 0 };
  return {
    isOpen: overlayOpenWindows.has(windowId),
    width: await resolvePanelWidthForOpen(windowId),
  };
}

async function setCanvasOverlayState(message, sender) {
  const windowId = await resolveWindowId(sender);
  if (!windowId) return { isOpen: false, width: 0 };

  if (message.open) {
    overlayOpenWindows.set(windowId, true);
  } else {
    overlayOpenWindows.delete(windowId);
  }

  if (message.width) {
    await saveViewport({ panelWidth: message.width }, sender);
  }

  return getCanvasOverlayState(sender);
}

async function saveCanvasOverlayWidth(message, sender) {
  return saveViewport({ panelWidth: message.width }, sender);
}

async function syncCanvasOverlayIntoTab(tab) {
  if (!tab?.id || !tab.active || !overlayOpenWindows.has(tab.windowId) || !isInjectablePage(tab.url)) return;
  await ensureCanvasOverlayInTab(tab, { timeoutMs: 300 }).catch(() => {});
}

async function preloadCanvasOverlayForTab(tabId, windowId) {
  if (!overlayOpenWindows.has(windowId)) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isInjectablePage(tab.url)) return;
  await ensureCanvasOverlayInTab(tab, { timeoutMs: OVERLAY_PRELOAD_TIMEOUT_MS }).catch(() => {});
}

async function ensureCanvasOverlayInTab(tab, options = {}) {
  const { width } = await getCanvasOverlayState({ tab });
  await injectHandleIntoTab(tab);
  const showOverlay = chrome.tabs
    .sendMessage(tab.id, {
      type: "showCanvasOverlay",
      width,
    })
    .then((response) => {
      if (response?.ok === false) throw new Error(response.error || "Could not preload canvas overlay");
      return response;
    });

  if (!options.timeoutMs) {
    await showOverlay;
    return;
  }

  await withTimeout(showOverlay, options.timeoutMs);
}

async function toggleCanvasFromHandle(sender) {
  const tabId = sender?.tab?.id;
  const windowId = sender?.tab?.windowId;
  if (!tabId || !windowId) throw new Error("No active browser window found");

  if (openPanelWindows.has(windowId)) {
    try {
      const result = await closeCanvasPanel(windowId);
      notifyHandleToggleState(tabId, "closed");
      return result;
    } catch (error) {
      notifyHandleToggleFailed(tabId, error);
      throw error;
    }
  }

  if (!chrome.sidePanel?.open) throw new Error("Side Panel API is unavailable in this browser");
  try {
    preparePanelForOpen(windowId).catch(() => {});
    await chrome.sidePanel.open({ tabId });
    openPanelWindows.add(windowId);
    notifyHandleToggleState(tabId, "open");
    return { panelState: "open" };
  } catch (error) {
    notifyHandleToggleFailed(tabId, error);
    throw error;
  }
}

async function preparePanelForOpen(windowId) {
  if (!chrome.sidePanel?.setOptions) return;
  const targetWidth = await resolvePanelWidthForOpen(windowId);
  const path = panelPathForWidth(targetWidth);
  try {
    await chrome.sidePanel.setOptions({ path, enabled: true });
  } catch {
    if (path === SIDE_PANEL_PATH) return;
    await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: true }).catch(() => {});
  }
}

async function resolvePanelWidthForOpen(windowId) {
  const storage = await chrome.storage.local.get([STORAGE_KEYS.viewport]);
  const viewport = storage[STORAGE_KEYS.viewport] || {};
  const browserWindow = await chrome.windows.get(windowId).catch(() => null);
  const windowWidth = Number(browserWindow?.width || 0);
  const ratioWidth = Number(viewport.panelRatio || 0) * windowWidth;
  const lastWidth = Number(viewport.panelWidth || 0);
  return sanitizePanelWidth(ratioWidth || lastWidth);
}

function panelPathForWidth(width) {
  return width ? `${SIDE_PANEL_PATH}?panelWidth=${encodeURIComponent(String(width))}` : SIDE_PANEL_PATH;
}

function sanitizePanelWidth(width) {
  const panelWidth = Math.round(Number(width || 0));
  if (!Number.isFinite(panelWidth) || panelWidth < PANEL_WIDTH.min) return 0;
  return clamp(panelWidth, PANEL_WIDTH.min, PANEL_WIDTH.max);
}

function notifyHandleToggleState(tabId, state) {
  if (!tabId) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: "canvasToggleState",
      state,
    })
    .catch(() => {});
}

function notifyHandleToggleFailed(tabId, error) {
  if (!tabId) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: "canvasToggleFailed",
      error: error?.message || String(error || "Edge blocked Tab Canvas."),
    })
    .catch(() => {});
}

async function closeCanvasPanel(windowId) {
  if (!windowId) throw new Error("No active browser window found");
  const hadPanelPort = panelPortsByWindow.has(windowId);
  if (await requestPanelSelfClose(windowId)) {
    return { panelState: "closed" };
  }
  if (!chrome.sidePanel?.close) {
    if (hadPanelPort) openPanelWindows.add(windowId);
    throw new Error("This Edge version cannot close side panels programmatically");
  }
  try {
    await chrome.sidePanel.close({ windowId });
  } catch (error) {
    if (hadPanelPort) openPanelWindows.add(windowId);
    throw error;
  }
  openPanelWindows.delete(windowId);
  return { panelState: "closed" };
}

async function requestPanelSelfClose(windowId) {
  const port = panelPortsByWindow.get(windowId);
  if (!port) return false;

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = 0;

    function settle(didClose) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      port.onDisconnect.removeListener(onDisconnect);
      resolve(didClose);
    }

    function onDisconnect() {
      settle(true);
    }

    try {
      port.onDisconnect.addListener(onDisconnect);
      port.postMessage({ type: "closeCanvasPanel" });
      openPanelWindows.delete(windowId);
      timeoutId = setTimeout(() => settle(false), 700);
    } catch {
      panelPortsByWindow.delete(windowId);
      settle(false);
    }
  });
}

async function markFocusedPanelOpen() {
  const windowId = await resolveWindowId();
  if (windowId) openPanelWindows.add(windowId);
  return { panelState: "open" };
}

async function resolveWindowId(sender, requestedWindowId) {
  if (requestedWindowId) return requestedWindowId;
  if (sender?.tab?.windowId) return sender.tab.windowId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.windowId;
}

async function getState() {
  const [tabs, storage, hasBroadCapture] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.local.get([STORAGE_KEYS.positions, STORAGE_KEYS.shots, STORAGE_KEYS.viewport]),
    hasRequiredCaptureAccess(),
  ]);

  return {
    tabs: tabs.map(publicTab),
    positions: storage[STORAGE_KEYS.positions] || {},
    shots: storage[STORAGE_KEYS.shots] || {},
    viewport: storage[STORAGE_KEYS.viewport] || { zoom: 1 },
    hasBroadCapture,
  };
}

async function injectHandlesIntoOpenTabs() {
  if (!chrome.scripting?.executeScript) return;
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((tab) => injectHandleIntoTab(tab)));
}

async function injectHandleIntoTab(tab) {
  if (!chrome.scripting?.executeScript || !tab?.id || !isInjectablePage(tab.url)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-handle.js"],
    });
  } catch {
    // Some matched pages can still block extension scripts, such as browser
    // stores, restricted enterprise pages, or pages still loading.
  }
}

function isInjectablePage(url = "") {
  return url.startsWith("http://") || url.startsWith("https://");
}

function scheduleAutoCapture(tab, reason) {
  if (!tab?.id || !tab.active || !tab.windowId) return;
  clearAutoCaptureTimer(tab.id);
  const delay = reason === "updated" ? 900 : 700;
  const timer = setTimeout(() => {
    autoCaptureTimers.delete(tab.id);
    autoCaptureActiveTab(tab.id, tab.windowId).catch(() => {});
  }, delay);
  autoCaptureTimers.set(tab.id, timer);
}

function clearAutoCaptureTimer(tabId) {
  const timer = autoCaptureTimers.get(tabId);
  if (!timer) return;
  clearTimeout(timer);
  autoCaptureTimers.delete(tabId);
}

async function autoCaptureActiveTab(tabId, windowId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || tab.windowId !== windowId) return;
  if (!(await shouldAutoCapture(tab))) return;
  await captureVisibleTabSnapshot(publicTab(tab), windowId);
  notifyPanelTabsChanged();
}

async function shouldAutoCapture(tab) {
  const url = tab?.url || "";
  if (captureBlockedReason(url)) return false;
  const storage = await chrome.storage.local.get([STORAGE_KEYS.shots]);
  const shot = storage[STORAGE_KEYS.shots]?.[String(tab.id)];
  return !shot?.dataUrl || shot.url !== url;
}

async function activateTab(tabId, windowId) {
  if (!tabId || !windowId) throw new Error("Missing tab target");
  await preloadCanvasOverlayForTab(tabId, windowId);
  await chrome.windows.update(windowId, { focused: true });
  const tab = await chrome.tabs.update(tabId, { active: true });
  return { tab: publicTab(tab) };
}

async function closeTab(tabId) {
  if (!tabId) throw new Error("Missing tab target");
  await chrome.tabs.remove(tabId);
  await cleanupClosedTab(tabId);
  return {};
}

async function captureTab(tabId, windowId) {
  if (!tabId || !windowId) throw new Error("Missing capture target");
  const target = await activateTab(tabId, windowId);
  const shot = await captureVisibleTabSnapshot(target.tab, windowId);
  return { ...target, shot };
}

async function activateAndCaptureTab(tabId, windowId) {
  if (!tabId || !windowId) throw new Error("Missing tab target");
  const target = await activateTab(tabId, windowId);
  try {
    const shot = await captureVisibleTabSnapshot(target.tab, windowId);
    return { ...target, shot };
  } catch (error) {
    return { ...target, captureError: error.message || String(error) };
  }
}

async function captureVisibleTabSnapshot(tab, windowId) {
  const url = tab?.url || "";
  const blockedReason = captureBlockedReason(url);
  if (blockedReason) throw new Error(blockedReason);
  if (!(await hasRequiredCaptureAccess())) {
    throw new Error(
      "Capture access is missing. Reload the extension from edge://extensions and accept site access.",
    );
  }

  await sleep(450);

  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 58,
    });
  } catch (error) {
    const original = error?.message || chrome.runtime.lastError?.message || String(error);
    throw new Error(`Edge blocked this capture: ${original}`);
  }

  const storage = await chrome.storage.local.get([STORAGE_KEYS.shots]);
  const shots = storage[STORAGE_KEYS.shots] || {};
  shots[String(tab.id)] = {
    capturedAt: Date.now(),
    dataUrl,
    url,
  };

  const trimmed = trimShots(shots, 36);
  await chrome.storage.local.set({ [STORAGE_KEYS.shots]: trimmed });
  return trimmed[String(tab.id)];
}

function captureBlockedReason(url) {
  if (!url) return "";
  const internalSchemes = [
    "about:",
    "brave://",
    "chrome://",
    "devtools://",
    "edge://",
    "opera://",
    "vivaldi://",
  ];
  if (internalSchemes.some((scheme) => url.startsWith(scheme))) {
    return "Browser internal pages cannot be captured from the side panel. Open a normal web page and try again.";
  }
  if (url.startsWith("chrome-extension://")) {
    return "Extension pages cannot be captured from the side panel. Open a normal web page and try again.";
  }
  if (url.startsWith("edge-extension://")) {
    return "Extension pages cannot be captured from the side panel. Open a normal web page and try again.";
  }
  if (url.startsWith("file://")) {
    return "File pages require Edge's Allow access to file URLs setting for this extension.";
  }
  if (url.startsWith("data:")) {
    return "Data URLs require a direct activeTab user gesture and are not reliable from the side panel.";
  }
  if (
    url.startsWith("https://chromewebstore.google.com/") ||
    url.startsWith("https://chrome.google.com/webstore/") ||
    url.startsWith("https://microsoftedge.microsoft.com/addons/")
  ) {
    return "Browser extension store pages block extension capture. Open a normal web page and try again.";
  }
  return "";
}

async function hasRequiredCaptureAccess() {
  return chrome.permissions.contains({ origins: ["<all_urls>"] });
}

async function saveLayout(positions) {
  if (!positions || typeof positions !== "object") return {};
  await chrome.storage.local.set({ [STORAGE_KEYS.positions]: positions });
  return {};
}

async function saveViewport(viewport, sender) {
  if (!viewport || typeof viewport !== "object") return {};
  const storage = await chrome.storage.local.get([STORAGE_KEYS.viewport]);
  const next = { ...(storage[STORAGE_KEYS.viewport] || {}) };

  if (Object.hasOwn(viewport, "zoom")) {
    next.zoom = clamp(Number(viewport.zoom || 1), 0.55, 1.8);
  }

  if (Object.hasOwn(viewport, "panelWidth")) {
    const panelWidth = sanitizePanelWidth(viewport.panelWidth);
    if (panelWidth > 0) {
      next.panelWidth = panelWidth;
      const windowWidth = await resolveBrowserWindowWidth(sender);
      if (windowWidth) {
        next.windowWidth = windowWidth;
        next.panelRatio = Math.round(clamp(next.panelWidth / windowWidth, 0.08, 0.9) * 1000) / 1000;
      }
      next.panelSavedAt = Date.now();
    }
  }

  if (!Object.hasOwn(next, "zoom")) next.zoom = 1;
  await chrome.storage.local.set({ [STORAGE_KEYS.viewport]: next });
  return { viewport: next };
}

async function resolveBrowserWindowWidth(sender) {
  try {
    const windowId = await resolveWindowId(sender);
    if (!windowId) return 0;
    const browserWindow = await chrome.windows.get(windowId);
    return Math.round(Number(browserWindow?.width || 0));
  } catch {
    return 0;
  }
}

async function clearShot(tabId) {
  const storage = await chrome.storage.local.get([STORAGE_KEYS.shots]);
  const shots = storage[STORAGE_KEYS.shots] || {};
  delete shots[String(tabId)];
  await chrome.storage.local.set({ [STORAGE_KEYS.shots]: shots });
  return { shots };
}

async function cleanupClosedTab(tabId) {
  const key = String(tabId);
  const storage = await chrome.storage.local.get([STORAGE_KEYS.positions, STORAGE_KEYS.shots]);
  const positions = storage[STORAGE_KEYS.positions] || {};
  const shots = storage[STORAGE_KEYS.shots] || {};

  let changed = false;
  if (Object.hasOwn(positions, key)) {
    delete positions[key];
    changed = true;
  }
  if (Object.hasOwn(shots, key)) {
    delete shots[key];
    changed = true;
  }
  if (!changed) return;

  await chrome.storage.local.set({
    [STORAGE_KEYS.positions]: positions,
    [STORAGE_KEYS.shots]: shots,
  });
}

function publicTab(tab) {
  return {
    active: Boolean(tab.active),
    audible: Boolean(tab.audible),
    discarded: Boolean(tab.discarded),
    favIconUrl: tab.favIconUrl || "",
    id: tab.id,
    incognito: Boolean(tab.incognito),
    index: tab.index,
    pinned: Boolean(tab.pinned),
    status: tab.status || "",
    title: tab.title || "Untitled tab",
    url: tab.url || "",
    windowId: tab.windowId,
  };
}

function trimShots(shots, limit) {
  return Object.fromEntries(
    Object.entries(shots)
      .sort(([, a], [, b]) => (b.capturedAt || 0) - (a.capturedAt || 0))
      .slice(0, limit),
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function notifyPanelTabsChanged() {
  chrome.runtime.sendMessage({ type: "tabsChanged" }).catch(() => {});
}
