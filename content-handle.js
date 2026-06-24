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
        grid-template-rows: 16px 1fr 16px;
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

      .rail {
        width: 3px;
        height: 24px;
        border-radius: 999px;
        background: #49c87d;
        box-shadow: 0 0 16px rgba(73, 200, 125, 0.42);
        opacity: 0.86;
        transition:
          height 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 240ms ease;
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

      button:hover .rail,
      button:focus-visible .rail {
        height: 34px;
        opacity: 1;
      }

      button:active,
      button.is-busy {
        transform: translateX(-5px) scale(0.985);
      }

      button[data-state="open"] .arrow {
        transform: rotate(180deg);
        opacity: 0.92;
      }

      button[data-state="open"] .rail {
        height: 44px;
      }

      button[data-state="blocked"] {
        color: #f5c8c8;
      }

      button[data-state="blocked"] .rail {
        background: #f06464;
        box-shadow: 0 0 16px rgba(240, 100, 100, 0.34);
      }

      @media (prefers-reduced-motion: reduce) {
        button,
        .rail,
        .arrow {
          transition-duration: 0.001ms;
        }
      }
    </style>
    <button type="button" aria-label="Toggle Tab Canvas" title="Toggle Tab Canvas" data-state="closed" aria-expanded="false">
      <span class="rail" aria-hidden="true"></span>
      <span class="label">Canvas</span>
      <span class="arrow" aria-hidden="true">‹</span>
    </button>
  `;

  const button = shadow.querySelector("button");
  const label = shadow.querySelector(".label");
  let resetTimer = 0;
  let lastToggleAt = 0;

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

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "canvasToggleState") {
      setHandleState(message.state === "open" ? "open" : "closed");
      return;
    }
    if (message?.type !== "canvasToggleFailed") return;
    setHandleState("blocked");
    button.title = message.error || "Chrome blocked Tab Canvas.";
    resetButtonLabel(1800);
  });

  function triggerToggle() {
    const now = Date.now();
    if (now - lastToggleAt < 350) return;
    lastToggleAt = now;
    setHandleState("pending");

    chrome.runtime.sendMessage({ type: "toggleCanvasFromHandle" }).catch((error) => {
      setHandleState("blocked");
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
