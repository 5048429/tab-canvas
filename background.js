const STORAGE_KEYS = {
  positions: "tabCanvas.positions",
  shots: "tabCanvas.shots",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch {
    // Keyboard shortcuts are best-effort because Chrome can restrict panel opening
    // outside direct user activation in some surfaces.
  }
});

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
    case "activateTab":
      return activateTab(message.tabId, message.windowId);
    case "captureTab":
      return captureTab(message.tabId, message.windowId);
    case "saveLayout":
      return saveLayout(message.positions);
    case "clearShot":
      return clearShot(message.tabId);
    case "warmup":
      return {};
    default:
      throw new Error("Unknown message type");
  }
}

async function getState() {
  const [tabs, storage, hasBroadCapture] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.local.get([STORAGE_KEYS.positions, STORAGE_KEYS.shots]),
    Promise.resolve(false),
  ]);

  return {
    tabs: tabs.map(publicTab),
    positions: storage[STORAGE_KEYS.positions] || {},
    shots: storage[STORAGE_KEYS.shots] || {},
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
  await activateTab(tabId, windowId);
  await sleep(450);

  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 58,
    });
  } catch (error) {
    throw new Error(
      "Chrome blocked this capture. Click the extension icon, then Capture active again.",
    );
  }

  const storage = await chrome.storage.local.get([STORAGE_KEYS.shots]);
  const shots = storage[STORAGE_KEYS.shots] || {};
  shots[String(tabId)] = {
    capturedAt: Date.now(),
    dataUrl,
  };

  const trimmed = trimShots(shots, 36);
  await chrome.storage.local.set({ [STORAGE_KEYS.shots]: trimmed });
  return { shot: trimmed[String(tabId)] };
}

async function saveLayout(positions) {
  if (!positions || typeof positions !== "object") return {};
  await chrome.storage.local.set({ [STORAGE_KEYS.positions]: positions });
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

function notifyPanelTabsChanged() {
  chrome.runtime.sendMessage({ type: "tabsChanged" }).catch(() => {});
}
