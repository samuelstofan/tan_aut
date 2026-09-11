# SSO Test Auto-Fill

MV3 browser extension (Chrome + Firefox) that watches a tab's URL against a
configurable regex, scans the page for a `TEST!!! <number>` code, and either
fills it into a target `<input>` or copies it to the clipboard.

## Files

- `manifest.json` - MV3 manifest (works in Chrome and Firefox via a dual
  `background.service_worker` / `background.scripts` declaration).
- `background.js` - service worker: opens the options page from the toolbar
  icon, sets badge feedback (`OK` = filled, `CB` = copied to clipboard).
- `content.js` - injected on every page; does the URL match, text extraction,
  input fill (using the native value setter + `input`/`change` events so
  React/Vue pick it up), clipboard fallback, and the "pick element" mode.
- `options.html` / `options.js` - full configuration UI (opens as a tab).
- `lib/config.js` - shared defaults/schema used by all three contexts.
- `lib/browser-polyfill.js` - official `webextension-polyfill` build, so the
  code uses the promise-based `browser.*` API in both browsers.
- `icons/` - placeholder toolbar/store icons (`icons/make-icons.js` is the
  generator script that produced them; safe to delete or regenerate).

## Configuration

Open the options page (click the toolbar icon) to set:

- **Enabled** - master on/off toggle.
- **URL regex** - default `^https:\/\/.*\.example\.com\/sso.*$`.
- **Extraction regex** - default `TEST!!!\s*(\d+)`, capture group 1 is used.
- **Target input CSS selector** - where to insert the value; leave blank to
  copy to the clipboard instead.
- **Button to click after filling/copying** (optional) - fires after the
  code is successfully placed, whether that was filling the target input or
  copying to the clipboard. Useful for a "Continue"/"Submit" button.
- **Pick element** / **Pick button** - pick the page to work on from the
  dropdown (it lists your other open http/https tabs), click the matching
  **Pick...** button, then click the element on that page (Esc cancels), and
  **Save** once the selector is filled in.

Settings are stored in `browser.storage.sync`.

## Load unpacked - Chrome / Edge

1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** -> select this `extension/` folder.

## Load temporary - Firefox

1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on...** -> select `manifest.json` inside this folder.

(Temporary add-ons don't need the `browser_specific_settings.gecko.id`; it's
included for permanent installs / signing.)

## Notes / limitations

- Permissions requested: `activeTab`, `scripting`, `storage`,
  `clipboardWrite`. No `host_permissions` entry is declared, but
  `content_scripts` matching `<all_urls>` implicitly grants host access to
  every http(s) page - that's what lets the options page's tab picker see
  real titles/URLs and what lets the clipboard fallback below work.
- The content script re-checks on DOM mutations and on SPA navigation
  (`pushState`/`replaceState`/`popstate`/`hashchange`), so it also works on
  client-rendered SSO pages where the code appears after an XHR/fetch.
- **Clipboard fallback**: auto-fill runs automatically (not from a click), so
  the browser's async Clipboard API (`navigator.clipboard.writeText`) will
  often reject - browsers require a user gesture for that API. The extension
  falls back to `document.execCommand('copy')`, which the `clipboardWrite`
  permission allows to run without a gesture. If copying still fails (e.g.
  the tab/window isn't focused when the code appears), the toolbar badge
  shows `!!` and it retries on the next detected page change.
- **Debugging**: open DevTools on the target page (F12 -> Console) - the
  content script logs each step under the `[SSO Test Auto-Fill]` prefix
  (URL match result, extraction result, fill/copy outcome). The toolbar icon
  badge also reflects the last outcome for that tab: `OK` = filled the
  input, `CB` = copied to clipboard, `!!` = copy failed, blank = disabled or
  URL didn't match.
- If you change the manifest/permissions (as happened when `clipboardWrite`
  was added), reload the extension: `chrome://extensions` -> reload icon, or
  in Firefox remove and re-**Load Temporary Add-on...**.
