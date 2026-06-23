(function initTabCanvasHandle() {
  const hostId = "tab-canvas-quick-toggle";
  if (document.getElementById(hostId)) return;
  if (!document.documentElement || document.documentElement.dataset.tabCanvasHandle === "off") return;

  const host = document.createElement("div");
  host.id = hostId;
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      button {
        position: fixed;
        z-index: 2147483646;
        left: 0;
        top: 50%;
        width: 22px;
        height: 88px;
        margin: 0;
        padding: 0;
        transform: translateY(-50%);
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-left: 0;
        border-radius: 0 9px 9px 0;
        background: rgba(17, 19, 18, 0.72);
        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.26);
        color: #f4f5ef;
        cursor: pointer;
        font: 750 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        opacity: 0.34;
        transition:
          opacity 160ms ease,
          background 160ms ease,
          transform 160ms ease;
        writing-mode: vertical-rl;
      }

      button:hover,
      button:focus-visible {
        background: rgba(17, 19, 18, 0.88);
        opacity: 0.92;
        outline: 0;
      }

      button:active,
      button.is-busy {
        transform: translateY(-50%) translateX(1px);
      }
    </style>
    <button type="button" aria-label="Toggle Tab Canvas" title="Toggle Tab Canvas">Canvas</button>
  `;

  const button = shadow.querySelector("button");
  button.addEventListener("click", async () => {
    button.classList.add("is-busy");
    try {
      const response = await chrome.runtime.sendMessage({ type: "toggleCanvasPanel" });
      if (!response?.ok) throw new Error(response?.error || "Toggle failed");
    } catch {
      // The handle is intentionally quiet; keyboard shortcut still works if this
      // page cannot open the side panel from a content-script gesture.
    } finally {
      window.setTimeout(() => button.classList.remove("is-busy"), 220);
    }
  });

  document.documentElement.appendChild(host);
})();
