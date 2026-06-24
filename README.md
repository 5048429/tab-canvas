# Tab Canvas

Tab Canvas now keeps the Chrome and Microsoft Edge extension builds side by side.

## Extensions

- `chrome/`: Chrome Manifest V3 extension.
- `edge/`: Microsoft Edge Manifest V3 extension.

Both builds share the same core behavior:

- Spatial tab canvas with draggable cards.
- Cached tab snapshots.
- Right-edge Canvas handle on normal web pages.
- Resizable overlay canvas that restores its last width after closing and reopening.
- Native side-panel fallback for browser pages where content scripts cannot run.

## Load Locally

Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `chrome/` folder.

Edge:

1. Open `edge://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `edge/` folder.

Each browser-specific folder has its own README and technical notes.
