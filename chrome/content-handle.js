(function initTabCanvasHandle() {
  const hostId = "tab-canvas-quick-toggle";
  const overlayId = "tab-canvas-page-overlay";
  const overlayWidth = { min: 280, max: 1600, fallback: 520 };
  document.getElementById(hostId)?.remove();
  if (!document.documentElement || document.documentElement.dataset.tabCanvasHandle === "off") return;
  if (!hasLiveExtensionContext()) return;

  const host = document.createElement("div");
  host.id = hostId;
  host.style.cssText = [
    "all: initial",
    "position: fixed",
    "right: 0",
    "top: 50%",
    "width: 34px",
    "height: 118px",
    "transform: translateY(-50%)",
    "z-index: 2147483647",
    "pointer-events: auto",
    "display: block",
    "contain: layout style paint",
  ].join(";");
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      button {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: grid;
        grid-template-rows: 1fr 18px;
        align-items: center;
        justify-items: center;
        gap: 5px;
        margin: 0;
        padding: 0;
        transform: none;
        border: 1px solid rgba(244, 245, 239, 0.16);
        border-right: 0;
        border-radius: 10px 0 0 10px;
        background: rgba(17, 19, 18, 0.72);
        box-shadow:
          0 16px 36px rgba(5, 9, 7, 0.22),
          inset 1px 0 0 rgba(255, 255, 255, 0.08);
        color: rgba(244, 245, 239, 0.76);
        cursor: pointer;
        font: 750 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        opacity: 0.86;
        overflow: hidden;
        transition:
          opacity 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
          box-shadow 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
          background 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
          color 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
          transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }

      .label {
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        text-rendering: geometricPrecision;
      }

      .arrow {
        font-size: 15px;
        line-height: 1;
        opacity: 0.68;
        transform: translateX(0);
        transition:
          opacity 240ms ease,
          transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }

      button:hover,
      button:focus-visible {
        background: rgba(17, 19, 18, 0.86);
        box-shadow:
          0 18px 42px rgba(5, 9, 7, 0.28),
          inset 1px 0 0 rgba(255, 255, 255, 0.12);
        color: rgba(244, 245, 239, 0.94);
        opacity: 1;
        outline: 0;
        transform: translateX(-3px);
      }

      button:active,
      button.is-busy {
        transform: translateX(-5px) scale(0.985);
      }

      button[data-state="open"] .arrow {
        transform: rotate(180deg);
        opacity: 0.92;
      }

      button[data-state="blocked"] {
        color: #f5c8c8;
      }

      @media (prefers-reduced-motion: reduce) {
        button,
        .arrow {
          transition-duration: 0.001ms;
        }
      }
    </style>
    <button type="button" aria-label="Toggle Tab Canvas" title="Toggle Tab Canvas" data-state="closed" aria-expanded="false">
      <span class="label">Canvas</span>
      <span class="arrow" aria-hidden="true">&lsaquo;</span>
    </button>
  `;

  const button = shadow.querySelector("button");
  const label = shadow.querySelector(".label");
  let resetTimer = 0;
  let lastToggleAt = 0;
  let overlaySaveTimer = 0;

  function resetButtonLabel(delay) {
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      if (button.dataset.state === "pending" || button.dataset.state === "blocked") {
        setHandleState("closed");
      }
    }, delay);
  }

  function setHandleState(state) {
    button.dataset.state = state;
    button.classList.toggle("is-busy", state === "pending");
    button.setAttribute("aria-expanded", String(state === "open"));
    label.textContent = state === "pending" ? "Opening" : state === "blocked" ? "Blocked" : "Canvas";
  }

  addRuntimeMessageListener((message, sender, sendResponse) => {
    if (message?.type === "toggleCanvasOverlay") {
      respondToOverlayRequest(toggleOverlay(), sendResponse);
      return true;
    }
    if (message?.type === "showCanvasOverlay") {
      respondToOverlayRequest(openOverlay(message.width), sendResponse);
      return true;
    }
    if (message?.type === "hideCanvasOverlay") {
      respondToOverlayRequest(closeOverlay(), sendResponse);
      return true;
    }
    if (message?.type === "canvasToggleState") {
      setHandleState(message.state === "open" ? "open" : "closed");
      return;
    }
    if (message?.type !== "canvasToggleFailed") return;
    setHandleState("blocked");
    button.title = message.error || "Chrome blocked Tab Canvas.";
    resetButtonLabel(1800);
  });

  function respondToOverlayRequest(request, sendResponse) {
    request
      .then(() => sendResponse?.({ ok: true }))
      .catch((error) => {
        showToggleError(error);
        sendResponse?.({ ok: false, error: error?.message || String(error) });
      });
  }

  function triggerToggle() {
    const now = Date.now();
    if (now - lastToggleAt < 350) return;
    lastToggleAt = now;
    setHandleState("pending");

    toggleOverlay()
      .then(() => {
        window.clearTimeout(resetTimer);
      })
      .catch((error) => showToggleError(error));
  }

  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    triggerToggle();
  });

  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    triggerToggle();
  });

  document.documentElement.appendChild(host);
  restoreOverlayIfNeeded();

  function showToggleError(error) {
    setHandleState("blocked");
    button.title = error?.message || "Chrome blocked Tab Canvas. Reload the extension and this page, then try again.";
    resetButtonLabel(1800);
  }

  async function restoreOverlayIfNeeded() {
    const state = await sendRuntimeMessage({ type: "getCanvasOverlayState" }).catch(() => null);
    if (state?.isOpen) {
      await openOverlay(state.width).catch(() => {});
    }
  }

  async function toggleOverlay() {
    if (document.getElementById(overlayId)) {
      await closeOverlay();
      return;
    }
    await openOverlay();
  }

  async function openOverlay(preferredWidth) {
    if (!hasLiveExtensionContext()) throw new Error("Extension context invalidated.");
    const existing = document.getElementById(overlayId);
    if (existing) {
      setHandleState("open");
      return;
    }

    const state = preferredWidth ? null : await sendRuntimeMessage({ type: "getCanvasOverlayState" }).catch(() => null);
    const width = resolveOverlayWidth(preferredWidth || state?.width);
    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.style.cssText = [
      "all: initial",
      "position: fixed",
      "top: 0",
      "right: 0",
      `width: ${width}px`,
      "height: 100vh",
      "z-index: 2147483646",
      "display: block",
      "pointer-events: auto",
      "contain: layout style paint",
      "box-shadow: -18px 0 42px rgba(5, 9, 7, 0.32)",
    ].join(";");

    const overlayShadow = overlay.attachShadow({ mode: "closed" });
    overlayShadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .surface {
          position: absolute;
          inset: 0;
          background: #111312;
          border-left: 1px solid rgba(244, 245, 239, 0.16);
          overflow: hidden;
        }

        iframe {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
          background: #111312;
        }

        .resize {
          position: absolute;
          z-index: 2;
          left: 0;
          top: 0;
          bottom: 0;
          width: 10px;
          cursor: ew-resize;
          touch-action: none;
          background: linear-gradient(90deg, rgba(244, 245, 239, 0.22), transparent);
          opacity: 0.18;
          transition: opacity 140ms ease;
        }

        .resize:hover,
        .resize:focus-visible,
        .resize.is-dragging {
          opacity: 0.62;
          outline: 0;
        }
      </style>
      <div class="surface">
        <div class="resize" role="separator" aria-label="Resize Tab Canvas" tabindex="0"></div>
        <iframe title="Tab Canvas" src="${chrome.runtime.getURL("sidepanel.html?surface=overlay")}"></iframe>
      </div>
    `;

    document.documentElement.appendChild(overlay);
    wireOverlayResize(overlay, overlayShadow.querySelector(".resize"));
    setHandleState("open");
    await sendRuntimeMessage({ type: "setCanvasOverlayState", open: true, width }).catch(() => {});
  }

  async function closeOverlay() {
    const overlay = document.getElementById(overlayId);
    const width = overlay ? Math.round(overlay.getBoundingClientRect().width) : 0;
    if (overlay) overlay.remove();
    setHandleState("closed");
    await sendRuntimeMessage({ type: "setCanvasOverlayState", open: false, width }).catch(() => {});
  }

  function wireOverlayResize(overlay, resizeHandle) {
    resizeHandle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = overlay.getBoundingClientRect().width;
      resizeHandle.classList.add("is-dragging");
      resizeHandle.setPointerCapture(pointerId);
      document.documentElement.style.cursor = "ew-resize";

      function move(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        const nextWidth = startWidth + startX - moveEvent.clientX;
        applyOverlayWidth(overlay, nextWidth);
      }

      function up(upEvent) {
        if (upEvent.pointerId !== pointerId) return;
        resizeHandle.releasePointerCapture(pointerId);
        resizeHandle.classList.remove("is-dragging");
        resizeHandle.removeEventListener("pointermove", move);
        resizeHandle.removeEventListener("pointerup", up);
        resizeHandle.removeEventListener("pointercancel", up);
        document.documentElement.style.cursor = "";
        queueSaveOverlayWidth(overlay, 0);
      }

      resizeHandle.addEventListener("pointermove", move);
      resizeHandle.addEventListener("pointerup", up);
      resizeHandle.addEventListener("pointercancel", up);
    });
  }

  function applyOverlayWidth(overlay, width) {
    const nextWidth = resolveOverlayWidth(width);
    overlay.style.width = `${nextWidth}px`;
    queueSaveOverlayWidth(overlay, 160);
  }

  function queueSaveOverlayWidth(overlay, delay) {
    window.clearTimeout(overlaySaveTimer);
    overlaySaveTimer = window.setTimeout(() => {
      const width = Math.round(overlay.getBoundingClientRect().width);
      sendRuntimeMessage({ type: "saveCanvasOverlayWidth", width }).catch(() => {});
    }, delay);
  }

  function resolveOverlayWidth(width) {
    const availableWidth = Math.max(overlayWidth.min, window.innerWidth - 96);
    const maxWidth = Math.min(overlayWidth.max, availableWidth);
    const fallback = Math.min(maxWidth, Math.max(overlayWidth.min, Math.round(window.innerWidth * 0.42), overlayWidth.fallback));
    const nextWidth = Math.round(Number(width || fallback));
    if (!Number.isFinite(nextWidth)) return fallback;
    return Math.min(maxWidth, Math.max(overlayWidth.min, nextWidth));
  }

  function hasLiveExtensionContext() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function addRuntimeMessageListener(listener) {
    try {
      if (!hasLiveExtensionContext()) return false;
      chrome.runtime.onMessage.addListener(listener);
      return true;
    } catch {
      return false;
    }
  }

  function sendRuntimeMessage(message) {
    try {
      if (!hasLiveExtensionContext()) {
        return Promise.reject(new Error("Extension context invalidated."));
      }
      return chrome.runtime.sendMessage(message);
    } catch (error) {
      return Promise.reject(error);
    }
  }
})();
