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
- Drag empty board space to pan around the canvas.
- Use the mouse wheel on a card to resize it.
- Use the compact zoom strip, or Ctrl/Command + wheel, to zoom the whole canvas.
- Clicking a card also refreshes that tab's snapshot after switching to it.
- Declares capture host access because screenshots are a core product capability.
- Saves card layout and snapshots in extension storage.

## Known platform limits

- The extension cannot force Side Panel to the left. Users must set that in Chrome.
- The extension cannot replace or hide Chrome's native tab strip or bookmarks bar.
- Screenshots require host access and capture page content, not Chrome's browser UI.
- Chrome can only capture visible tab content, so background tabs are snapshotted after they are activated.
- Chrome internal pages such as `chrome://extensions`, extension pages, DevTools pages, and some local `file://` pages cannot be captured from the side panel.

## Remote setup

After creating the remote repository:

```powershell
git remote add origin https://github.com/<your-org-or-user>/tab-canvas.git
git branch -M main
git add .
git commit -m "Initial Tab Canvas extension"
git push -u origin main
```
