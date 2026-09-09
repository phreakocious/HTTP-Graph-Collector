import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext } from "node:vm";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf-8");

const manifest = JSON.parse(read("../dist/manifest.json"));
const popupHtml = read("../dist/popup/popup.html");
const popupJs = read("../dist/popup/popup.js");

// Minimal DOM stub: popup.js only ever reads/writes textContent, value,
// checked and classList, and registers listeners.
function makeDom() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      els.set(id, {
        id, textContent: "", value: "", checked: false,
        classList: { add() {}, remove() {} },
        addEventListener() {},
      });
    }
    return els.get(id);
  };
  let onReady = null;
  return {
    els,
    fireReady: () => onReady && onReady(),
    document: {
      getElementById: el,
      addEventListener: (evt, fn) => { if (evt === "DOMContentLoaded") onReady = fn; },
    },
  };
}

function runPopup() {
  const dom = makeDom();
  const ctx = createContext({
    console,
    document: dom.document,
    setTimeout: () => {},
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    chrome: {
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      storage: { local: { get: () => Promise.resolve({}), set: () => {} } },
      runtime: {
        id: "abcdefghijklmnopabcdefghijklmnop",
        getManifest: () => manifest,
      },
    },
  });
  new Script(popupJs).runInContext(ctx);
  dom.fireReady();
  return dom;
}

describe("popup version display", () => {
  it("renders the version from the manifest, not a literal", () => {
    const dom = runPopup();
    // Fails if the line is deleted, the element id drifts, or the manifest
    // bumps without the popup following. manifest is currently 0.6.
    assert.equal(dom.els.get("version").textContent, "v" + manifest.version);
    assert.notEqual(manifest.version, undefined);
  });

  it("has no hardcoded version literal left in the markup", () => {
    // The drift this replaced: popup.html said v0.5 while the manifest said 0.6.
    const stray = popupHtml.match(/v\d+\.\d+/g);
    assert.equal(stray, null, `hardcoded version in popup.html: ${stray}`);
  });

  it("hands the extension ID to the viewer, and the viewer reads it back", () => {
    // The popup PRODUCES a URL param; viewer/app.js CONSUMES it. Neither half
    // is any use alone, and nothing else in the repo couples them, so assert
    // the handshake here — a rename on either side fails this test.
    const viewerUrl = popupJs.match(/VIEWER_URL\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(viewerUrl, "popup.js defines no VIEWER_URL");

    const param = popupJs.match(/VIEWER_URL\s*\+\s*['"]\?(\w+)=['"]/);
    assert.ok(param, "popup.js does not append a query param to VIEWER_URL");

    const viewerJs = read("../viewer/app.js");
    assert.match(
      viewerJs,
      new RegExp(`\\.get\\(\\s*["']${param[1]}["']`),
      `viewer/app.js never reads the "${param[1]}" param the popup sends`
    );

    // ...and the viewer origin must be one the extension will talk to.
    assert.ok(
      manifest.externally_connectable.matches.some((m) =>
        new RegExp("^" + m.replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$").test(viewerUrl[1])
      ),
      `${viewerUrl[1]} is not covered by externally_connectable`
    );
  });

  it("validates the incoming extension ID before connecting with it", () => {
    // It reaches chrome.runtime.connect(), so it is a trust boundary.
    const viewerJs = read("../viewer/app.js");
    assert.match(viewerJs, /\[a-p\]\{32\}/, "viewer does not shape-check the ext id from the URL");
  });
});
