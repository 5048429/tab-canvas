# Tab Canvas

Spatial tab navigation for Chrome. The first version runs as a Manifest V3 side panel: the whiteboard stays open while the real browser tab changes.

## Repository name

Use `tab-canvas` for the remote repository.

## Load locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.
5. Click the Tab Canvas toolbar icon.

For the intended product layout, set Chrome's side panel to the left in browser settings.

Chrome extensions cannot hide Chrome's native tab strip or bookmarks bar. This project uses Side Panel as a spatial navigation layer beside the real browser page.

## First version

- Syncs open tabs with title, URL, favicon, active state, and window ID.
- Click a card to activate the real browser tab.
- Drag cards to organize the tab map.
- Use the mouse wheel on a card to resize it.
- Capture the active tab as a cached visual snapshot.
- Request optional capture permission only when the user needs reliable screenshots.
- Saves card layout and snapshots in extension storage.

## Known platform limits

- The extension cannot force Side Panel to the left. Users must set that in Chrome.
- The extension cannot replace or hide Chrome's native tab strip or bookmarks bar.
- Screenshots require user-triggered capture permission and capture page content, not Chrome's browser UI.

## Remote setup

After creating the remote repository:

```powershell
git remote add origin https://github.com/<your-org-or-user>/tab-canvas.git
git branch -M main
git add .
git commit -m "Initial Tab Canvas extension"
git push -u origin main
```
