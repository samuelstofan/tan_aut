// Shared config schema/defaults, used by background.js, content.js and options.js.
// eslint-disable-next-line no-unused-vars
const DEFAULT_CONFIG = {
  enabled: true,
  urlRegex: "^https:\\/\\/.*\\.example\\.com\\/sso.*$",
  extractionRegex: "TEST!!!\\s*(\\d+)",
  targetSelector: "",
  postCopyButtonSelector: ""
};

// eslint-disable-next-line no-unused-vars
async function loadConfig() {
  const stored = await browser.storage.sync.get(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...stored };
}
