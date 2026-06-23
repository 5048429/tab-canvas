# Tab Canvas Architecture

## Product shape

Tab Canvas is a Chrome Manifest V3 extension. The whiteboard lives in Chrome Side Panel and is intended to be placed on the left by the user. The page area remains the real browser tab.

The first version is a spatial navigation layer, not a live webpage embedder:

- Cards represent real Chrome tabs.
- Clicking a card activates the real tab.
- When the active Chrome tab changes, the canvas scrolls to keep the matching card in view.
- Closing a card removes the real Chrome tab and clears its cached layout/snapshot state.
- Cards can be dragged and resized.
- The board itself can be zoomed independently from individual cards.
- Clicking a card activates that tab and then attempts to refresh its cached screenshot.
- Layout and screenshots are stored locally.
- Screenshot access is declared as a core host permission because the product depends on reliable snapshots.
- The side panel UI is intentionally minimal: the whiteboard is primary, with search and board zoom as lightweight overlays.
- The canvas can be toggled from a keyboard command or a slim content-script handle on normal web pages.

## Left side panel constraint

Chrome controls whether the side panel appears on the left or right. Extensions can read layout with `chrome.sidePanel.getLayout()`, but cannot force the side. The UI detects the side and tells the user to set Chrome Side Panel to Left for this product.

## Browser chrome constraint

Chrome extensions cannot hide or replace the native tab strip, address bar, or bookmarks bar. The extension can add a side panel, popup, content UI on allowed pages, shortcut commands, and tab-management actions. A product that truly removes Chrome's native tab strip needs a custom browser shell, Chromium fork, or a browser that supports that level of UI customization.

## Files

- `manifest.json`: MV3 manifest, permissions, action, side panel, command.
- `background.js`: service worker, Chrome API bridge, tab sync, capture, storage.
- `content-handle.js`: tiny in-page handle for opening or closing the side panel without using the Chrome toolbar.
- `sidepanel.html`: side panel shell.
- `sidepanel.css`: side panel UI.
- `sidepanel.js`: canvas rendering and interactions.

## Agent execution plan

Use this decomposition when delegating:

- Extension API agent: owns `background.js` and `manifest.json`.
- Canvas UI agent: owns `sidepanel.html`, `sidepanel.css`, and rendering in `sidepanel.js`.
- Interaction agent: owns drag, resize, search, layout persistence in `sidepanel.js`.
- QA agent: loads unpacked extension, tests switching, capture, storage persistence, and side panel layout messaging.

Agents should avoid overlapping write scopes. Main integrator reviews permissions and MV3 constraints before merging.

## Next milestones

1. Add a real card minimap.
2. Add groups or clusters.
3. Add stale snapshot refresh indicators.
4. Add a snapshot delete button and storage budget UI.
5. Add Playwright or Chrome manual QA checklist.
