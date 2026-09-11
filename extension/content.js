(() => {
  // Guard against double-injection (e.g. options page re-injecting via
  // scripting.executeScript on top of the declarative content script).
  if (window.__ssoTestAutofillLoaded) return;
  window.__ssoTestAutofillLoaded = true;

  const LOG = "[SSO Test Auto-Fill]";
  let config = null;
  let lastFilledValue = null;
  let debounceHandle = null;

  function reportStatus(status, value) {
    browser.runtime.sendMessage({ type: "STATUS_UPDATE", status, value }).catch(() => {
      // No listener (e.g. background not ready yet) - safe to ignore.
    });
  }

  function testUrlMatch() {
    if (!config?.enabled) return false;
    if (!config.urlRegex) return false;
    try {
      return new RegExp(config.urlRegex).test(location.href);
    } catch (e) {
      return false;
    }
  }

  // innerText only covers rendered text nodes - it never includes form
  // control values, even though those are visible on the page - so scan
  // those separately and append them.
  function getScannableText() {
    const bodyText = document.body ? document.body.innerText : "";
    const fieldValues = Array.from(document.querySelectorAll("input, textarea"))
      .map((el) => el.value)
      .filter(Boolean)
      .join("\n");
    return fieldValues ? `${bodyText}\n${fieldValues}` : bodyText;
  }

  function extractNumber() {
    if (!config?.extractionRegex) return null;
    try {
      const re = new RegExp(config.extractionRegex);
      const match = getScannableText().match(re);
      return match && match[1] ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  // Uses the native property setter so React/Vue-style controlled inputs
  // (which override the plain `.value` setter) still notice the change.
  function setNativeValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const descriptor =
      Object.getOwnPropertyDescriptor(proto, "value") ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function fillInput(element, value) {
    element.focus();
    setNativeValue(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function copyToClipboard(text) {
    // The async Clipboard API silently rejects when the call isn't tied to a
    // user gesture (our fill runs from a MutationObserver, not a click), so
    // it will very often fail here - that's expected, not a bug on its own.
    // The "clipboardWrite" permission is what makes the execCommand fallback
    // below work without a gesture, so that's the path doing the real work.
    try {
      await navigator.clipboard.writeText(text);
      console.debug(`${LOG} copied via navigator.clipboard`, text);
      return true;
    } catch (e) {
      console.debug(`${LOG} navigator.clipboard.writeText failed, falling back to execCommand`, e);
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      console.debug(`${LOG} execCommand('copy') threw`, e);
    }
    textarea.remove();

    if (ok) {
      console.debug(`${LOG} copied via execCommand`, text);
    } else {
      console.warn(
        `${LOG} could not copy "${text}" to the clipboard - the document may not be focused. Click the page and check again.`
      );
    }
    return ok;
  }

  // Fires after either a successful fill or a successful copy.
  function clickPostCopyButton() {
    if (!config.postCopyButtonSelector) return;
    let button = null;
    try {
      button = document.querySelector(config.postCopyButtonSelector);
    } catch (e) {
      console.warn(`${LOG} invalid action button selector`, config.postCopyButtonSelector, e);
      return;
    }
    if (!button) {
      console.debug(`${LOG} action button selector matched nothing`, config.postCopyButtonSelector);
      return;
    }
    if (button.disabled) {
      console.warn(`${LOG} action button is disabled, click likely had no effect`, config.postCopyButtonSelector);
    }
    button.click();
    console.debug(`${LOG} clicked action button`, config.postCopyButtonSelector);
  }

  async function tryFill() {
    if (!config) return;

    if (!config.enabled) {
      reportStatus("disabled");
      return;
    }

    if (!testUrlMatch()) {
      console.debug(`${LOG} URL did not match`, config.urlRegex, location.href);
      reportStatus("no_match");
      return;
    }

    const value = extractNumber();
    if (!value) {
      console.debug(`${LOG} URL matched but extraction regex found nothing yet`, config.extractionRegex);
      return;
    }
    if (value === lastFilledValue) return;
    console.debug(`${LOG} extracted value`, value);

    let target = null;
    if (config.targetSelector) {
      try {
        target = document.querySelector(config.targetSelector);
      } catch (e) {
        console.warn(`${LOG} invalid target selector`, config.targetSelector, e);
        target = null;
      }
    }

    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      fillInput(target, value);
      lastFilledValue = value;
      console.debug(`${LOG} filled target input`, config.targetSelector, value);
      reportStatus("filled", value);
      clickPostCopyButton();
    } else {
      if (config.targetSelector) {
        console.debug(`${LOG} target selector "${config.targetSelector}" matched no <input>/<textarea> - copying instead`);
      }
      const copied = await copyToClipboard(value);
      if (copied) {
        lastFilledValue = value;
        reportStatus("copied", value);
        clickPostCopyButton();
      } else {
        reportStatus("copy_failed", value);
        // Don't lock in lastFilledValue - retry on the next mutation in case
        // the document regains focus.
      }
    }
  }

  function scheduleTryFill() {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(tryFill, 300);
  }

  async function init() {
    config = await loadConfig();
    scheduleTryFill();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" && area !== "local") return;
    lastFilledValue = null; // config changed - allow re-filling
    loadConfig().then((cfg) => {
      config = cfg;
      scheduleTryFill();
    });
  });

  // Re-check on DOM mutations (page content, including the TEST!!! text,
  // may load asynchronously) and on SPA-style navigation.
  const observer = new MutationObserver(scheduleTryFill);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  let lastUrl = location.href;
  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastFilledValue = null;
      scheduleTryFill();
    }
  }
  ["pushState", "replaceState"].forEach((fn) => {
    const original = history[fn];
    history[fn] = function (...args) {
      const result = original.apply(this, args);
      checkUrlChange();
      return result;
    };
  });
  window.addEventListener("popstate", checkUrlChange);
  window.addEventListener("hashchange", checkUrlChange);

  // ---- Element picker (invoked from the options page) ----

  let pickerActive = false;
  let pickerField = null;
  let hoveredElement = null;
  let pickerBanner = null;

  function pickerElementStyle(el, active) {
    if (!el) return;
    el.style.outline = active ? "2px solid #1a73e8" : "";
    el.style.outlineOffset = active ? "1px" : "";
  }

  function computeSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;

    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      if (node.id) {
        path.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let segment = node.tagName.toLowerCase();
      let sibling = node;
      let nth = 1;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === node.tagName) nth++;
      }
      segment += `:nth-of-type(${nth})`;
      path.unshift(segment);
      node = node.parentElement;
    }
    return path.join(" > ");
  }

  function onPointerMove(e) {
    if (hoveredElement && hoveredElement !== e.target) {
      pickerElementStyle(hoveredElement, false);
    }
    hoveredElement = e.target;
    pickerElementStyle(hoveredElement, true);
  }

  function onPickerClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const selector = computeSelector(e.target);
    const field = pickerField;
    stopPicker();
    browser.runtime.sendMessage({ type: "ELEMENT_PICKED", selector, field }).catch(() => {});
  }

  function onPickerKeydown(e) {
    if (e.key === "Escape") {
      stopPicker();
      browser.runtime.sendMessage({ type: "PICKER_CANCELLED" }).catch(() => {});
    }
  }

  function startPicker(field) {
    if (pickerActive) return;
    pickerActive = true;
    pickerField = field;

    const what = field === "postCopyButtonSelector" ? "button to click after filling/copying" : "target input field";
    pickerBanner = document.createElement("div");
    pickerBanner.textContent = `SSO Test Auto-Fill: click the ${what} (Esc to cancel)`;
    Object.assign(pickerBanner.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      zIndex: "2147483647",
      background: "#1a73e8",
      color: "#fff",
      font: "13px/1.4 system-ui, sans-serif",
      padding: "8px 12px",
      textAlign: "center",
      boxShadow: "0 1px 4px rgba(0,0,0,.3)"
    });
    document.documentElement.appendChild(pickerBanner);

    document.addEventListener("mousemove", onPointerMove, true);
    document.addEventListener("click", onPickerClick, true);
    document.addEventListener("keydown", onPickerKeydown, true);
  }

  function stopPicker() {
    pickerActive = false;
    pickerField = null;
    document.removeEventListener("mousemove", onPointerMove, true);
    document.removeEventListener("click", onPickerClick, true);
    document.removeEventListener("keydown", onPickerKeydown, true);
    pickerElementStyle(hoveredElement, false);
    hoveredElement = null;
    pickerBanner?.remove();
    pickerBanner = null;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "START_PICKER") {
      startPicker(message.field);
    } else if (message?.type === "PING") {
      return Promise.resolve({ pong: true });
    }
  });

  init();
})();
