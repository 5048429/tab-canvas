# Tab Canvas for Edge Architecture

## Product shape

Tab Canvas for Edge is a Microsoft Edge Manifest V3 extension. On normal web pages, the whiteboard lives in a right-side extension overlay so its resized width can be restored exactly after closing and reopening. On restricted pages where content scripts cannot run, the extension can fall back to Edge Side Panel.

The first version is a spatial navigation layer, not a live webpage embedder:

- Cards represent real Edge tabs.
- Clicking a card activates the real tab.
- When the active Edge tab changes, the canvas scrolls to keep the matching card in view.
- Closing a card removes the real Edge tab and clears its cached layout/snapshot state.
- Cards can be dragged and resized.
- The board itself can be zoomed independently from individual cards.
- Clicking a card activates that tab and then attempts to refresh its cached screenshot.
- Layout and screenshots are stored locally.
- Screenshot access is declared as a core host permission because the product depends on reliable snapshots.
- The side panel UI is intentionally minimal: the whiteboard is primary, with search and board zoom as lightweight overlays.
- The canvas can be toggled from a slim right-edge content-script handle on normal web pages.
- The overlay canvas has a draggable left edge and saves the last width in extension storage.
- Active tabs are automatically snapshotted after activation or page load when no current screenshot exists for that URL.

## Side panel constraint

Edge controls where the native side panel appears. Extensions can open and close the panel when the relevant API is available, but cannot force a side, set the native side-panel width, or replace browser chrome. The normal-page overlay is used when exact width restoration matters.

## Browser chrome constraint

Edge extensions cannot hide or replace the native tab strip, address bar, or bookmarks bar. The extension can add a side panel, popup, content UI on allowed pages, and tab-management actions. A product that truly removes Edge's native tab strip needs a custom browser shell, Chromium fork, or a browser that supports that level of UI customization.

## Files

- `manifest.json`: MV3 manifest, permissions, action, and side panel entry.
- `background.js`: service worker, Edge/Chromium API bridge, tab sync, capture, storage.
- `content-handle.js`: in-page handle plus resizable overlay host for opening or closing Tab Canvas without using the Edge toolbar.
- `sidepanel.html`: side panel shell.
- `sidepanel.css`: side panel UI.
- `sidepanel.js`: canvas rendering and interactions.

Edge extension scripts intentionally use the Chromium extension `chrome.*` namespace.

## Agent execution plan

Use this decomposition when delegating:

- Extension API agent: owns `background.js` and `manifest.json`.
- Canvas UI agent: owns `sidepanel.html`, `sidepanel.css`, and rendering in `sidepanel.js`.
- Interaction agent: owns drag, resize, search, layout persistence in `sidepanel.js`.
- QA agent: loads unpacked extension in Edge, tests switching, capture, storage persistence, and side panel layout messaging.

Agents should avoid overlapping write scopes. Main integrator reviews permissions and MV3 constraints before merging.

## Next milestones

1. Add a real card minimap.
2. Add groups or clusters.
3. Add stale snapshot refresh indicators.
4. Add a snapshot delete button and storage budget UI.
5. Add Playwright or Edge manual QA checklist.
