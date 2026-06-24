(function initTabCanvasHandle() {
  const hostId = "tab-canvas-quick-toggle";
  if (document.getElementById(hostId)) return;
  if (!document.documentElement || document.documentElement.dataset.tabCanvasHandle === "off") return;

  const host = document.createElement("div");
  host.id = hostId;
  host.style.cssText = [
    "all: initial",
    "position: fixed",
    "right: 0",
    "top: 50%",
    "width: 44px",
    "height: 136px",
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
        margin: 0;
        padding: 0;
        transform: none;
        border: 1px solid rgba(244, 245, 239, 0.34);
        border-right: 0;
        border-radius: 12px 0 0 12px;
        background: linear-gradient(180deg, #63d991, #49c87d);
        box-shadow:
          0 16px 40px rgba(0, 0, 0, 0.28),
          0 0 0 1px rgba(18, 59, 39, 0.24);
        color: #102018;
        cursor: pointer;
        font: 900 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        opacity: 0.92;
        transition:
          opacity 160ms ease,
          box-shadow 160ms ease,
          background 160ms ease,
          transform 160ms ease;
        writing-mode: vertical-rl;
      }

      button:hover,
      button:focus-visible {
        background: linear-gradient(180deg, #7be3a5, #54d486);
        box-shadow:
          0 18px 46px rgba(0, 0, 0, 0.34),
          0 0 0 3px rgba(73, 200, 125, 0.22);
        opacity: 1;
        outline: 0;
      }

      button:active,
      button.is-busy {
        transform: translateX(-2px);
      }
    </style>
    <button type="button" aria-label="Toggle Tab Canvas" title="Toggle Tab Canvas">Canvas</button>
  `;

  const button = shadow.querySelector("button");
  let resetTimer = 0;
  let lastToggleAt = 0;

  function resetButtonLabel(delay) {
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      button.classList.remove("is-busy");
      button.textContent = "Canvas";
    }, delay);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "canvasToggleFailed") return;
    button.classList.remove("is-busy");
    button.textContent = "Blocked";
    button.title = message.error || "Chrome blocked Tab Canvas.";
    resetButtonLabel(1800);
  });

  function triggerToggle() {
    const now = Date.now();
    if (now - lastToggleAt < 350) return;
    lastToggleAt = now;
    button.classList.add("is-busy");
    button.textContent = "Opening";

    chrome.runtime.sendMessage({ type: "toggleCanvasFromHandle" }).catch((error) => {
      button.textContent = "Blocked";
      button.title = error?.message || "Chrome blocked Tab Canvas. Reload the extension and this page, then try again.";
      resetButtonLabel(1800);
    });

    resetButtonLabel(700);
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
})();
