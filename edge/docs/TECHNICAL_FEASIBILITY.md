# Technical Feasibility Notes

## Edge extension route

Tab Canvas for Edge can be a real Microsoft Edge extension as a persistent side panel:

- It can read tab metadata, activate tabs, move tabs, close tabs, and save local layout state.
- It can capture visible page content with `tabs.captureVisibleTab` when host access is granted.
- It cannot directly snapshot hidden background tabs; the extension must activate a tab before capturing its visible content.
- It cannot hide or replace Edge's native tab strip, address bar, or bookmarks bar.
- It cannot force side panel placement; Edge controls the available side panel layout.
- It cannot live-render arbitrary existing tabs inside the extension UI. The practical extension version is a snapshot canvas plus fast switching to the real active tab.

The current implementation uses the Edge extension route for MVP validation.

For normal web pages, the MVP uses a content-script overlay instead of relying only on native Side Panel. This lets Tab Canvas restore the last user-resized width after closing and reopening. Native Side Panel remains useful as a fallback, but its width is browser-managed.

## Other browser extension routes

- Chrome supports the same Manifest V3 Side Panel style API, so the Chrome version can share most of this code.
- Firefox supports `sidebar_action`, but it is still a sidebar extension surface, not a full browser-chrome replacement.
- Vivaldi has stronger user-facing browser UI customization, including moving or hiding the tab bar. That can make Tab Canvas feel closer to the intended product, but an extension should not rely on being able to enforce those settings.
- Brave and Opera are Chromium-family browsers for extension purposes. They are useful compatibility targets, not a way around the core browser UI limits.

## Browser shell route

If replacing the native tab strip and bookmarks bar is non-negotiable, build a browser shell instead of a standard extension.

Electron is the fastest route for a product prototype:

- Use a custom window with our own title/tab/bookmark UI.
- Use `BaseWindow` plus `WebContentsView` for one or more real web views.
- Use `webContents.capturePage()` to generate snapshots without the extension capture permission model.
- Own the left canvas, navigation controls, keyboard shortcuts, and workspace model.

The cost is that we become responsible for browser-grade details: security hardening, downloads, permissions, cookies/sessions, popups, certificates, autofill/passwords, updates, profiles, crash handling, extension support, and OS integration.

CEF or a Chromium fork gives deeper native-browser control, but is heavier than Electron. It is better once the product direction is proven and we need more browser-level polish or distribution control.

## Recommended route

Keep the Edge extension MVP to validate the core behavior: spatial memory, snapshot freshness, tab switching speed, and side panel workflow. In parallel, build a small Electron spike only if the product thesis requires hiding/replacing the native browser chrome.
