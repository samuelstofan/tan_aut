// Chrome loads only "background.service_worker" (this file) inside a real
// ServiceWorkerGlobalScope, so pull in the polyfill + shared config there.
// Firefox instead loads "background.scripts" (all three files) directly as
// a classic event-page script, where importScripts does not exist.
if (typeof importScripts === "function") {
  importScripts("lib/browser-polyfill.js", "lib/config.js");
}

// Clicking the toolbar icon (there is no default_popup) opens the options
// page, reusing an already-open options tab if there is one. The options
// page itself lists open tabs to target for "Pick element" - content_scripts
// already declares <all_urls>, so no extra "tabs" permission is needed for
// that (see options.js).
browser.action.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const existing = await browser.storage.sync.get(null);
    if (Object.keys(existing).length === 0) {
      await browser.storage.sync.set(DEFAULT_CONFIG);
    }
  }
});

// Badge feedback: content scripts report their fill status per tab.
browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "STATUS_UPDATE" || !sender.tab?.id) return;

  const tabId = sender.tab.id;
  const badges = {
    filled: { text: "OK", color: "#2e7d32" },
    copied: { text: "CB", color: "#1565c0" },
    copy_failed: { text: "!!", color: "#c62828" },
    no_match: { text: "", color: "#000000" },
    disabled: { text: "", color: "#000000" }
  };
  const badge = badges[message.status] ?? { text: "", color: "#000000" };

  browser.action.setBadgeText({ tabId, text: badge.text });
  browser.action.setBadgeBackgroundColor({ tabId, color: badge.color });
});

// Clear the badge as soon as a tab starts navigating somewhere new.
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    browser.action.setBadgeText({ tabId, text: "" });
  }
});
