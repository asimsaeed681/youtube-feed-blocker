# Chrome Web Store listing — YouTube Feed Blocker (Unlisted)

Draft copy and console field values for the Web Store submission. **Unlisted**
visibility: reachable by direct link, not shown in search or category browsing.

---

## Single purpose (required by Google's review)

> YouTube Feed Blocker has one purpose: to reduce distraction on YouTube by
> removing Shorts and letting the user replace the home feed with a calmer view.

Keep this phrasing (or close to it) consistent between the console's "single
purpose" field and the description below — reviewers compare them.

---

## Item name

```
YouTube Feed Blocker
```

## Short description (max 132 characters)

```
Remove YouTube Shorts everywhere and replace the home feed with a blank page, focus widgets, or (soon) an AI-curated feed.
```
(119 characters.)

## Detailed description

```
YouTube Feed Blocker cuts the two biggest sources of "I only meant to watch one
video" on YouTube.

REMOVE SHORTS, EVERYWHERE
- Hides the Shorts entry in the sidebar and the Shorts tab on channel pages
- Hides Shorts shelves and Shorts tiles in the home feed, search results, and
  channel pages
- Sends any /shorts/ link to the normal video player instead of the Shorts feed
- Keeps working as you navigate, because YouTube re-adds these elements as you
  browse

REPLACE THE HOME FEED
Pick what the YouTube home page shows you, from the toolbar popup:
- Blank - a calm, empty home page
- Focus widgets - a to-do list, a focus timer, and a daily quote
- AI-curated - describe the feed you want in plain words (preview only for now;
  see below)

Every setting is a switch in the popup. Turn Shorts blocking off any time and
everything comes back with no reload.

PRIVACY
No data is collected. No network requests. Your settings are stored in your
browser (chrome.storage) and synced only across your own Chrome by Chrome
itself. Full policy: https://asimsaeed681.github.io/youtube-feed-blocker/privacy.html

ABOUT "AI-CURATED" MODE
The instruction box works and your text is saved, but the classification service
that would actually filter the feed is not built yet, so this mode currently
shows a preview of the control rather than a filtered feed. A future update will
add the real filtering; the privacy policy will be updated before any version
that sends data is released.

This is an early build shared with a small group for feedback.
```

## Category

```
Productivity  (alternative: Tools)
```

## Language

```
English
```

---

## Privacy practices tab (console)

**Single purpose description:** (same as "Single purpose" above)

**Permission justifications:**

- `storage`
  ```
  Stores the user's chosen feed mode, Shorts-blocking on/off state, optional
  feed-instruction text, and widget preferences so they persist between sessions
  and sync across the user's own Chrome installations. No data is transmitted;
  storage is local to the browser.
  ```

- Host permission `https://www.youtube.com/*` (from the content script match)
  ```
  The extension's only function is modifying youtube.com pages - hiding Shorts
  UI and replacing the home feed. It runs exclusively on www.youtube.com and
  makes no network requests.
  ```

- Remote code: **No**, the extension does not use remote code.

**Data usage disclosures (the checklist):**

- Does this item collect or use personal or sensitive user data?
  **No.** The extension stores only user-chosen settings via chrome.storage and
  transmits nothing.
- Sale of data: No.
- Use for purposes unrelated to core functionality: No.
- Use for creditworthiness / lending: No.

**Certifications (checkboxes):**
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## Assets still needed for the listing

| Asset | Requirement | Status |
|---|---|---|
| Store icon | 128x128 PNG | Have `icons/icon128.png` (placeholder red-slash mark) |
| Screenshots | 1-5, 1280x800 or 640x400 PNG/JPEG | Done - five 1280x800 PNGs in `store-assets/screenshots/` |
| Small promo tile | 440x280 PNG (optional for Unlisted) | Optional, skip for now |
| Privacy policy URL | public, reachable | Done - https://asimsaeed681.github.io/youtube-feed-blocker/privacy.html (GitHub Pages) |
| Contact email (verified) | in the developer account | You set this in the account |

---

## What only you can do (in order)

1. **Create a Chrome Web Store developer account.**
   Go to https://chrome.google.com/webstore/devconsole , sign in with the Google
   account you want to own this, pay the **one-time $5 USD** registration fee,
   and verify a contact email. (The email gets shown to users on the listing.)

2. **Host the privacy policy.**
   Put `privacy.html` somewhere public with a stable URL (GitHub Pages, a gist's
   "raw" won't render as a page - use Pages or Netlify Drop or your own site).
   Add your real contact email to it first (replace the placeholder). Tell me the
   URL if you want me to drop it into the listing text and PRIVACY.md.

3. **Add screenshots.**
   Tell me and I'll produce 1280x800 PNGs from the extension (widgets mode, blank
   mode, AI mode, a Shorts before/after). Then you upload them in the console.

4. **Create the item and upload the package.**
   In the dev console: "Add new item" -> upload
   `youtube-feed-blocker-v0.1.0.zip` (built, see below).

5. **Fill the store listing tab** with the name / short description / detailed
   description / category / language / icon / screenshots above.

6. **Fill the privacy practices tab** with the single-purpose text, permission
   justifications, and data-usage checklist above. Tick the three certification
   boxes.

7. **Set visibility to "Unlisted"** on the distribution tab. Leave regions at
   "all regions" (or restrict if you want).

8. **Submit for review.** Unlisted items still go through Google's review;
   turnaround is usually hours to a few days. You'll get an email on approval or
   rejection. Once approved, the item has a permanent URL like
   `https://chromewebstore.google.com/detail/<id>` that you can send to friends.

9. **Send the link to your friends.** They click "Add to Chrome" - no developer
   mode, no unpacked folder.

### If review pushes back

Most likely snags for this extension and the pre-written answer:
- *"Single purpose unclear"* -> point to the single-purpose text; the two
  features (remove Shorts, replace feed) are one purpose: reducing YouTube
  distraction.
- *"Broad host permissions"* -> it's a single specific host, `www.youtube.com`,
  and there are no network requests; that's in the justification.
- *"Privacy policy"* -> the hosted URL; it states no collection, no transmission.
