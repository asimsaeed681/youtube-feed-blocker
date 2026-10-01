# YouTube Feed Blocker

A Manifest V3 Chrome extension that:

1. **Hides what pulls you in**: the home feed, Shorts (tab, shelves, sidebar
   link, and `/shorts/<id>` redirected to `/watch?v=<id>`), Up next (sidebar,
   end screen, end cards; playlists stay), autoplay, and optionally comments.
   Each is a switch in the popup and applies live.
2. **Peeking with friction**: a "Show my feed anyway" link under the panel,
   gated by a 10 second pause, a pause plus a typed reason (shown afterwards
   as a "You came for" reminder), or no peeking at all. A peek lasts until you
   leave the home page.
3. **Replaces the home feed** with a blank page, productivity widgets, or an
   AI-curated preview (no classifier backend yet).
4. Persists all settings via `chrome.storage.sync`.

You can load this build unpacked (below). It is being prepared for an
**Unlisted** Chrome Web Store release (link-only, not searchable); see
`store-listing.md` for the listing copy and submission steps.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder
   (`youtube-feed-blocker/`, the one containing `manifest.json`).
4. Open YouTube. Click the extension icon to choose a feed mode.

To update after code changes: return to `chrome://extensions` and click the
reload icon on the extension card, then refresh YouTube.

## File layout

```
manifest.json
src/
  background.js          MV3 service worker: seeds default settings on install
  lib/defaults.js        shared constants + default settings
  lib/storage.js         chrome.storage.sync wrapper
  content/
    hide-shorts.css      static Shorts-hiding rules (pre-paint)
    overlay.css          styles for the injected home-feed panel
    shorts-blocker.js    Shorts UI removal + /shorts redirect + observer
    feed-widgets.js      to-do / quote widgets
    feed-replacer.js     hides the real home grid, injects the panel
    watch-page.css       Up next / autoplay / comments hiding (class-keyed)
    watch-page.js        mirrors those settings to <html> classes, turns autoplay off
    reason-banner.js     "You came for" reminder after a reason peek
  popup/                 popup UI (hide toggles, peek level, feed mode, widgets, AI instruction)
icons/                   placeholder icons
```

## Settings shape (`chrome.storage.sync`, key `settings`)

```js
{
  shortsBlocking: true,
  hideHomeFeed: true,
  hideUpNext: true,
  blockAutoplay: true,
  hideComments: false,
  peekLevel: "pause" | "reason" | "none",
  feedMode: "blank" | "widgets" | "ai",
  aiInstruction: "",
  widgets: { todo: true, quote: true }
}
```

## Testing

**Unit tests**: `node test/unit.mjs` checks the settings layer (upgrade from
v0.1, defaults, reason validation, concurrent writes) in plain Node.

**Signed-out smoke test** — `node test/e2e.mjs` loads the extension unpacked into
Playwright's Chromium and checks Shorts removal, the `/shorts` redirect, all
three feed modes, SPA re-mount, and live settings propagation (36 assertions).
Reuses the Playwright build the Playwright MCP already installed; screenshots to
`test/screenshots/`.

**Real logged-in QA** — Chrome stable disables unpacked extensions under
automation, so this route has you drive:

1. Run `C:\Users\aasim\yfb-chrome-test-profile\launch-for-qa.bat` (starts Chrome
   with a debug port on an isolated, non-synced profile).
2. In it: `chrome://extensions` → Developer mode → Load unpacked → this folder;
   sign into YouTube.
3. `node test/live-qa-cdp.mjs` — attaches over CDP, checks feed replacement on a
   real populated feed, Shorts removal in the sidebar and search results, the
   redirect, and blocking on/off. `test/live-qa-cdp-followup.mjs` adds
   dark-mode screenshots and reloads the extension first.

The isolated profile keeps its own copy of your session — it is deliberately
outside OneDrive and must never be committed.

## Not in this build

- AI feed classification (needs a backend proxy that holds the API key — no key
  ever ships in the client).
- Filtering feeds other than the home feed.
- A public (searchable) Chrome Web Store listing.
