# Privacy Policy: YouTube Feed Blocker

**Last updated:** 2026-10-01
**Applies to:** YouTube Feed Blocker Chrome extension, versions 0.1.x and 0.2.x

## Summary

YouTube Feed Blocker does not collect, transmit, sell, or share any personal
data. It makes no network requests. Everything it stores stays in your own
browser.

## What the extension stores, and where

| Data | Where it is stored | Who can read it |
|---|---|---|
| Your selected feed mode (blank / widgets / AI), which page elements are hidden (home feed, Shorts, Up next, autoplay, comments), peek level, Shorts-blocking on/off, widget preferences, and the daily feed time setting (and any pending raise to a higher budget) | `chrome.storage.sync` | Only you. Chrome syncs it between your own signed-in Chrome installations. The developer has no access. |
| The optional free-text "feed instruction" you type in AI mode | `chrome.storage.sync` | Only you (as above). In this version it is never sent anywhere. It is stored for a feature that is not yet built. |
| Today's used feed minutes (date and a number) | `chrome.storage.sync` | Only you (as above). |
| Your to-do list items and their checked state | `chrome.storage.local` | Only you. Never leaves the device it was typed on. |

No other data is stored. There is no account, no login, and no identifier of
any kind.

The reason you type when peeking, and the end time of the current peek, are kept in the browser's session storage (`chrome.storage.session`) until the peek ends or the browser closes. They are never sent anywhere.

## What the extension does NOT do

- It does **not** make any network requests. It has no server, no backend, no
  analytics, and no third-party services.
- It does **not** collect browsing history, watch history, search queries, IP
  address, location, or any other personal or usage data.
- It does **not** read or transmit the contents of pages you visit.
- It does **not** contain ads, trackers, tracking pixels, or fingerprinting.
- It does **not** load or execute any remote code. All code ships inside the
  extension package and is reviewable.

## Permissions and why they are needed

- **`storage`**: to remember your settings (see the table above) between
  sessions and across your own Chrome installations. No data leaves the browser.
- **Access to `https://www.youtube.com/*`**: the extension's entire purpose is
  to modify `youtube.com` pages: hiding the home feed, Shorts, suggested videos,
  autoplay and comments, and showing its own panel in place of the home feed. It runs only on `www.youtube.com` and, again,
  makes no network requests from those pages.

## A note about the future "AI-curated feed" mode

A later version intends to let you filter your home feed with a written
instruction (e.g. "only coding tutorials, no clickbait"). Making that work will
require sending video metadata (such as titles and channel names visible on the
page) to a classification service. **That feature does not exist in this
version.** No such data is sent today. This policy will be updated, and the
change made clear, before any version that transmits data is released.

## Changes to this policy

If this policy changes, the "Last updated" date above will change and the new
version will be published at the same URL before the corresponding extension
update is released.

## Contact

Questions about this policy: [aasim.saeed063@gmail.com](mailto:aasim.saeed063@gmail.com)
