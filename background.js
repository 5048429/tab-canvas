const STORAGE_KEYS = {
  positions: "tabCanvas.positions",
  shots: "tabCanvas.shots",
  viewport: "tabCanvas.viewport",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const openPanelWindows = new Set();

async function setPanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => {
  setPanelBehavior().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  setPanelBehavior().catch(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-canvas") return;
  try {
    await toggleCanvasPanel();
  } catch {
    // Keyboard shortcuts are best-effort because Chrome can restrict panel opening
    // outside direct user activation in some surfaces.
  }
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

chrome.tabs.onActivated.addListener(() => notifyPanelTabsChanged());
chrome.tabs.onCreated.addListener(() => notifyPanelTabsChanged());
chrome.tabs.onRemoved.addListener(() => notifyPanelTabsChanged());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.title || changeInfo.url || changeInfo.favIconUrl || changeInfo.status) {
    notifyPanelTabsChanged();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message) {
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
    case "captureTab":
      return captureTab(message.tabId, message.windowId);
    case "saveLayout":
      return saveLayout(message.positions);
    case "saveViewport":
      return saveViewport(message.viewport);
    case "clearShot":
      return clearShot(message.tabId);
    case "warmup":
      return markFocusedPanelOpen();
    default:
      throw new Error("Unknown message type");
  }
}

async function toggleCanvasPanel(sender) {
  const windowId = await resolveWindowId(sender);
  if (!windowId) throw new Error("No active browser window found");

  if (openPanelWindows.has(windowId) && chrome.sidePanel?.close) {
    await chrome.sidePanel.close({ windowId });
    openPanelWindows.delete(windowId);
    return { panelState: "closed" };
  }

  if (!chrome.sidePanel?.open) {
    throw new Error("Side Panel API is unavailable in this browser");
  }

  await chrome.sidePanel.open({ windowId });
  openPanelWindows.add(windowId);
  return { panelState: "open" };
}

async function closeCanvasPanel(windowId) {
  if (!windowId) throw new Error("No active browser window found");
  if (!chrome.sidePanel?.close) {
    throw new Error("This Chrome version cannot close side panels programmatically");
  }
  await chrome.sidePanel.close({ windowId });
  openPanelWindows.delete(windowId);
  return { panelState: "closed" };
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

async function activateTab(tabId, windowId) {
  if (!tabId || !windowId) throw new Error("Missing tab target");
  await chrome.windows.update(windowId, { focused: true });
  const tab = await chrome.tabs.update(tabId, { active: true });
  return { tab: publicTab(tab) };
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
      "Capture access is missing. Reload the extension from chrome://extensions and accept site access.",
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
    throw new Error(`Chrome blocked this capture: ${original}`);
  }

  const storage = await chrome.storage.local.get([STORAGE_KEYS.shots]);
  const shots = storage[STORAGE_KEYS.shots] || {};
  shots[String(tab.id)] = {
    capturedAt: Date.now(),
    dataUrl,
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
    return "File pages require Chrome's Allow access to file URLs setting for this extension.";
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

async function saveViewport(viewport) {
  if (!viewport || typeof viewport !== "object") return {};
  const zoom = clamp(Number(viewport.zoom || 1), 0.55, 1.8);
  await chrome.storage.local.set({ [STORAGE_KEYS.viewport]: { zoom } });
  return {};
}

async function clearShot(tabId) {
  const storage = await chrome.storage.local.get([STORAGE_KEYS.shots]);
  const shots = storage[STORAGE_KEYS.shots] || {};
  delete shots[String(tabId)];
  await chrome.storage.local.set({ [STORAGE_KEYS.shots]: shots });
  return { shots };
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
