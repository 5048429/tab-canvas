# Technical Feasibility Notes

## Chrome extension route

Tab Canvas can be a real Chrome extension as a persistent side panel:

- It can read tab metadata, activate tabs, move tabs, close tabs, and save local layout state.
- It can capture visible page content with `tabs.captureVisibleTab` when host access is granted.
- It cannot directly snapshot hidden background tabs; the extension must activate a tab before capturing its visible content.
- It cannot hide or replace Chrome's native tab strip, address bar, or bookmarks bar.
- It cannot force the side panel to the left; Chrome exposes the current side but the user chooses the side in browser settings.
- It cannot live-render arbitrary existing tabs inside the extension UI. The practical extension version is a snapshot canvas plus fast switching to the real active tab.

The current implementation uses the extension route for MVP validation.

## Other browser extension routes

- Microsoft Edge supports sidebar extensions through the same `chrome.sidePanel` style API. This helps with a persistent side panel, but does not unlock replacing Edge's native tab strip.
- Firefox supports `sidebar_action`, but it is still a sidebar extension surface, not a full browser-chrome replacement.
- Vivaldi has stronger user-facing browser UI customization, including moving or hiding the tab bar. That can make Tab Canvas feel closer to the intended product, but an extension should not rely on being able to enforce those settings.
- Brave and Opera are Chromium-family browsers for extension purposes. They are useful compatibility targets, not a way around the core browser UI limits.

## Browser shell route

If replacing the native tab strip and bookmarks bar is non-negotiable, build a browser shell instead of a standard extension.

Electron is the fastest route for a product prototype:

- Use a custom window with our own title/tab/bookmark UI.
- Use `BaseWindow` plus `WebContentsView` for one or more real web views.
- Use `webContents.capturePage()` to generate snapshots without the Chrome extension capture permission model.
- Own the left canvas, navigation controls, keyboard shortcuts, and workspace model.

The cost is that we become responsible for browser-grade details: security hardening, downloads, permissions, cookies/sessions, popups, certificates, autofill/passwords, updates, profiles, crash handling, extension support, and OS integration.

CEF or a Chromium fork gives deeper native-browser control, but is heavier than Electron. It is better once the product direction is proven and we need more browser-level polish or distribution control.

## Recommended route

Keep the Chrome extension MVP to validate the core behavior: spatial memory, snapshot freshness, tab switching speed, and left-side workflow. In parallel, build a small Electron spike only if the product thesis requires hiding/replacing the native browser chrome.
