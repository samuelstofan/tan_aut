(() => {
  const els = {
    enabled: document.getElementById("enabled"),
    urlRegex: document.getElementById("urlRegex"),
    extractionRegex: document.getElementById("extractionRegex"),
    targetSelector: document.getElementById("targetSelector"),
    postCopyButtonSelector: document.getElementById("postCopyButtonSelector"),
    pickerTabSelect: document.getElementById("pickerTabSelect"),
    pickBtn: document.getElementById("pickBtn"),
    pickButtonBtn: document.getElementById("pickButtonBtn"),
    saveBtn: document.getElementById("saveBtn"),
    resetBtn: document.getElementById("resetBtn"),
    status: document.getElementById("status"),
    targetTabInfo: document.getElementById("targetTabInfo")
  };

  function showStatus(message, isError) {
    els.status.textContent = message;
    els.status.className = isError ? "err" : "ok";
    if (message) {
      setTimeout(() => {
        if (els.status.textContent === message) els.status.textContent = "";
      }, 4000);
    }
  }

  function applyConfig(cfg) {
    els.enabled.checked = cfg.enabled;
    els.urlRegex.value = cfg.urlRegex;
    els.extractionRegex.value = cfg.extractionRegex;
    els.targetSelector.value = cfg.targetSelector;
    els.postCopyButtonSelector.value = cfg.postCopyButtonSelector;
  }

  function readForm() {
    return {
      enabled: els.enabled.checked,
      urlRegex: els.urlRegex.value.trim(),
      extractionRegex: els.extractionRegex.value.trim(),
      targetSelector: els.targetSelector.value.trim(),
      postCopyButtonSelector: els.postCopyButtonSelector.value.trim()
    };
  }

  function validateRegex(pattern, label) {
    if (!pattern) return `${label} cannot be empty.`;
    try {
      new RegExp(pattern);
      return null;
    } catch (e) {
      return `${label} is not a valid regex: ${e.message}`;
    }
  }

  async function save() {
    const cfg = readForm();
    const urlError = validateRegex(cfg.urlRegex, "URL regex");
    const extractionError = validateRegex(cfg.extractionRegex, "Extraction regex");
    const error = urlError || extractionError;
    if (error) {
      showStatus(error, true);
      return;
    }
    await browser.storage.sync.set(cfg);
    showStatus("Saved.", false);
  }

  async function reset() {
    applyConfig(DEFAULT_CONFIG);
    await browser.storage.sync.set(DEFAULT_CONFIG);
    showStatus("Reset to defaults.", false);
  }

  // content_scripts already declares matches:["<all_urls>"], which counts as
  // host permission for every http(s) page - so tabs.query() returns full
  // url/title here even though the manifest requests no separate "tabs" or
  // host_permissions entry.
  async function listPickableTabs() {
    let selfId = null;
    try {
      selfId = (await browser.tabs.getCurrent())?.id ?? null;
    } catch (e) {
      // getCurrent can fail if this page isn't running as a tab; ignore.
    }
    const allTabs = await browser.tabs.query({});
    return allTabs
      .filter((t) => t.id !== selfId && /^https?:/.test(t.url || ""))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  }

  async function refreshTabList() {
    const previouslySelected = els.pickerTabSelect.value;
    const tabs = await listPickableTabs();
    els.pickerTabSelect.innerHTML = "";

    if (tabs.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No open http(s) tabs found";
      els.pickerTabSelect.appendChild(opt);
      els.pickerTabSelect.disabled = true;
      els.pickBtn.disabled = true;
      els.pickButtonBtn.disabled = true;
      els.targetTabInfo.textContent =
        "Open the page you want to configure in another tab, then reopen this settings page.";
      return;
    }

    for (const tab of tabs) {
      const opt = document.createElement("option");
      opt.value = String(tab.id);
      opt.textContent = (tab.title || tab.url).slice(0, 80);
      els.pickerTabSelect.appendChild(opt);
    }
    if (tabs.some((t) => String(t.id) === previouslySelected)) {
      els.pickerTabSelect.value = previouslySelected;
    }
    els.pickerTabSelect.disabled = false;
    els.pickBtn.disabled = false;
    els.pickButtonBtn.disabled = false;
    els.targetTabInfo.textContent = "Pick element/Pick button will switch to the selected tab.";
  }

  async function ensureContentScript(tabId) {
    try {
      await browser.tabs.sendMessage(tabId, { type: "PING" });
      return true;
    } catch (e) {
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          files: ["lib/browser-polyfill.js", "lib/config.js", "content.js"]
        });
        return true;
      } catch (injectErr) {
        console.error("Could not inject content script:", injectErr);
        return false;
      }
    }
  }

  // field: "targetSelector" or "postCopyButtonSelector"; button: the
  // triggering <button> element, so we can restore its label when done.
  const pickers = {
    targetSelector: { button: els.pickBtn, label: "Pick element" },
    postCopyButtonSelector: { button: els.pickButtonBtn, label: "Pick button" }
  };
  let activeField = null;

  function resetPickerButtons() {
    for (const { button, label } of Object.values(pickers)) {
      button.disabled = false;
      button.textContent = label;
    }
    activeField = null;
  }

  async function pickElement(field) {
    const tabId = Number(els.pickerTabSelect.value);
    if (!tabId) return;

    activeField = field;
    const { button } = pickers[field];
    button.disabled = true;
    button.textContent = "Click an element on the page...";

    const ready = await ensureContentScript(tabId);
    if (!ready) {
      showStatus("Could not reach that tab (it may be a restricted browser page).", true);
      resetPickerButtons();
      return;
    }

    try {
      const tab = await browser.tabs.get(tabId);
      await browser.tabs.update(tabId, { active: true });
      await browser.windows.update(tab.windowId, { focused: true });
    } catch (e) {
      // Best-effort focus switch; picking still works if this fails.
    }

    try {
      await browser.tabs.sendMessage(tabId, { type: "START_PICKER", field });
    } catch (e) {
      showStatus("Could not start the picker on that tab.", true);
      resetPickerButtons();
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "ELEMENT_PICKED") {
      const field = message.field && els[message.field] ? message.field : activeField;
      if (field && els[field]) {
        els[field].value = message.selector;
      }
      resetPickerButtons();
      showStatus(`Selected: ${message.selector} - click Save to keep it.`, false);
    } else if (message?.type === "PICKER_CANCELLED") {
      resetPickerButtons();
      showStatus("Picking cancelled.", false);
    }
  });

  els.saveBtn.addEventListener("click", save);
  els.resetBtn.addEventListener("click", reset);
  els.pickBtn.addEventListener("click", () => pickElement("targetSelector"));
  els.pickButtonBtn.addEventListener("click", () => pickElement("postCopyButtonSelector"));
  els.pickerTabSelect.addEventListener("focus", refreshTabList);

  (async () => {
    applyConfig(await loadConfig());
    await refreshTabList();
  })();
})();
