# Timed peek design (ships in v0.2)

Status: approved in conversation 2026-10-01, pending written-spec review.
Builds on: `2026-09-29-v0.2-hide-and-peek-design.md` (peek levels, 10 second
pause, reason, banner). This spec replaces that spec's "the peek lasts until
the user leaves the home page" rule.

## Goal

A peek is a deliberate, time-boxed visit to the feed. The user picks how long
up front, sees a gentle warning near the end, and when time is up the video
pauses and asks them to choose: keep watching this one video, or go home.

## User flow

1. On the blocked home page, "Show my feed anyway" (hidden at peek level
   "none", as today).
2. Pick a duration: **5, 10, 15 or 30 minutes** (four buttons, no free input).
3. If peek level is "reason": type what you came for (validation unchanged).
4. The 10 second pause runs (unchanged: only counts while the tab is
   visible, "Never mind" cancels).
5. The peek session starts. In **every YouTube tab** the home feed and Up next
   are shown. Autoplay blocking and comments keep following their own
   settings. Shorts stay blocked.
6. The "You came for" banner shows during the session (all tabs) when a
   reason was given. Closing it hides it for the rest of the session.
7. When **5 minutes or less** remain, a small countdown chip appears in the
   bottom-right corner of every YouTube tab: "Feed closes in 4:32". For a
   5 minute peek it shows from the start.
8. When time is up:
   - **Watch page:** the video pauses and a "Time's up" card appears over the
     page with two buttons:
     - **Keep watching this video**: closes the card and resumes playback.
       The session is over, so Up next stays hidden; autoplay follows its
       setting.
     - **Back to Home**: goes to the (blocked) home page.
   - **Any other page:** the feed and Up next hide again. No card.
9. Peeking again goes through the same steps. No cooldown.

Navigation during a session (home, search, watch pages, new tabs, refresh)
does not end it. Only time running out ends it, or closing the browser.

## State

One object in `chrome.storage.session` under key `peekSession`:

```js
{ endsAt: 1727779200000, reason: "css grid layouts", bannerClosed: false }
```

- `chrome.storage.session` is shared by all tabs, survives page reloads, is
  cleared when the browser closes, and is not readable by YouTube's scripts.
- Content scripts cannot use `chrome.storage.session` by default. The service
  worker calls `chrome.storage.session.setAccessLevel({ accessLevel:
  "TRUSTED_AND_UNTRUSTED_CONTEXTS" })` at startup.
- A session is active while `Date.now() < endsAt`. Expired objects are ignored
  and removed by whichever tab notices first.
- The 10 second pause and the reason form stay per tab and in memory; only the
  started session is shared.

Constants in `defaults.js`: `YFB.PEEK_DURATIONS = [5, 10, 15, 30]` (minutes),
`YFB.PEEK_WARN_MINUTES = 5`.

## Components

- **`src/lib/peek-session.js` (new):** `YFB.PeekSession` with `get()`,
  `start(minutes, reason)`, `closeBanner()`, `clear()`, `onChange(cb)`, and a
  pure helper `YFB.peekRemainingMs(session, now)` (0 when no or expired
  session). Loaded in content scripts after `storage.js`.
- **`src/background.js`:** sets the session storage access level at startup.
- **`src/content/feed-replacer.js`:** the in-memory `peeked` flag is replaced by
  "session active". Adds the duration step before the reason step. Starting
  the session happens when the 10 second pause ends. Re-syncs on session
  changes.
- **`src/content/watch-page.js`:** `yfb-hide-upnext` is applied only when
  `hideUpNext` is on and no session is active.
- **`src/content/reason-banner.js`:** reads the reason and `bannerClosed`
  from the session instead of memory. Close sets `bannerClosed`.
- **`src/content/peek-timer.js` (new):** one per tab. Ticks once a second
  against `endsAt` (wall clock). Shows the countdown chip in the last
  `PEEK_WARN_MINUTES`. At expiry: clears the session, and on a watch page
  pauses the `<video>` and shows the Time's up card. The card is the
  extension's own element with its own styles; buttons are real `<button>`s,
  focus moves to "Keep watching", Escape acts as "Keep watching".
- **`src/content/overlay.css`:** styles for the duration buttons, countdown
  chip and Time's up card, reusing the existing tokens and the dark card +
  red accent of the banner. Rounded corners 8px, no pill buttons.

## Copy

All user-facing copy, no em dashes:

- Duration step label: "How long?" Buttons: "5 min", "10 min", "15 min",
  "30 min".
- Chip: "Feed closes in M:SS".
- Card title: "Time's up". Body: "Your feed time is over." Buttons: "Keep
  watching this video", "Back to Home".

## Privacy and store copy

- No network requests; permissions unchanged (`storage` covers
  `chrome.storage.session`).
- PRIVACY.md / privacy.html: the peek reason and timer are kept in the
  browser's session storage until the peek ends or the browser closes; never
  sent anywhere.
- store-listing.md "PEEK, BUT ON PURPOSE" section: mention choosing 5 to 30
  minutes, the closing countdown, and the Time's up pause.
- README features list updated to match.

## Testing

Unit (`test/unit.mjs`, with an in-memory `chrome.storage.session` stub):
- `peekRemainingMs` for no session, active session, expired session.
- `start(minutes, reason)` rejects a duration outside `PEEK_DURATIONS`.

E2E (`test/e2e.mjs`), replacing the "leaving Home brings the pause back"
check, which no longer matches the design:
- The duration step appears before the reason form; picking 5 min then the
  reason starts the 10 second pause.
- After the pause, the feed shows; navigating away and back (SPA) and
  reloading keep it shown.
- A second YouTube tab shows the feed while the session is active.
- Up next is visible on a watch page during the session.
- The countdown chip shows with 5 minutes or less remaining.
- Expiry on a watch page (session `endsAt` set a few seconds ahead from an
  extension page): video paused, card shown; "Keep watching" resumes and
  removes the card; Up next hidden again.
- Expiry on the home page: panel back, no card.

Live QA (`test/live-qa-cdp.mjs`): one signed-in pass of start, chip, expiry
on a real video.

## Out of scope

- Ending a peek early from the chip.
- Automatic grace for videos with little time left (replaced by the card).
- Cooldowns or daily limits.
