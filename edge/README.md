# Tab Canvas for Edge

Spatial tab navigation for Microsoft Edge. This version runs as a Manifest V3 extension with a page overlay on normal web pages and a native side-panel fallback on restricted pages.

## Repository layout

This extension lives in the `edge/` folder of the shared `tab-canvas` repository.

## Load locally

1. Open `edge://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `edge/` folder.
5. Click the Tab Canvas for Edge toolbar icon.

Edge controls where the side panel appears. For the intended product layout, place the side panel on the left if that setting is available in your Edge build.

Edge extensions cannot hide Edge's native tab strip or bookmarks bar. This project uses Side Panel as a spatial navigation layer beside the real browser page.

## First version

- Syncs open tabs with title, URL, favicon, active state, and window ID.
- Click a card to activate the real browser tab.
- Automatically centers the canvas on the current active tab when it changes.
- Close a tab from its card with the small close control in the title bar.
- Drag cards to organize the tab map.
- Drag empty board space to pan around the canvas.
- Use the mouse wheel on a card to resize it.
- Use the compact zoom strip, or Ctrl/Command + wheel, to zoom the whole canvas.
- Toggle the canvas with the visible right-edge handle on normal web pages.
- Drag the overlay canvas left edge to resize it; closing and reopening restores the last saved width.
- Automatically snapshots the active tab the first time it is visited or when its URL changes.
- Clicking a card also refreshes that tab's snapshot after switching to it.
- Declares capture host access because screenshots are a core product capability.
- Saves card layout and snapshots in extension storage.

## Known platform limits

- The extension cannot force Side Panel to the left. Users must choose the available Edge side panel position themselves.
- The extension cannot replace or hide Edge's native tab strip or bookmarks bar.
- Native Side Panel width is browser-managed because Edge does not expose a direct width API. On normal web pages, Tab Canvas uses its own overlay surface so the resized width can be restored exactly.
- Screenshots require host access and capture page content, not Edge's browser UI.
- Edge can only capture visible tab content, so background tabs are snapshotted after they are activated.
- Edge internal pages such as `edge://extensions`, extension pages, DevTools pages, and some local `file://` pages cannot be captured from the side panel.
- Edge extensions still use the Chromium extension `chrome.*` namespace in the JavaScript API.

## Remote setup

Use the repository root for git operations. The Chrome and Edge builds are versioned together in the same remote.
