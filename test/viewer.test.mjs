import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext } from "node:vm";
import { readFileSync } from "node:fs";

// viewer/app.js is one big IIFE that touches the DOM as it evaluates, so
// booting it whole would need a full DOM. Lift out just the two functions
// under test, straight from the shipped source, so this can't drift from it.
const src = readFileSync(new URL("../viewer/app.js", import.meta.url), "utf-8");

function extract(signature) {
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `could not find ${signature} in viewer/app.js`);
  const end = src.indexOf("\n  }\n", start);
  assert.notEqual(end, -1, `could not find the end of ${signature}`);
  return src.slice(start, end + "\n  }".length);
}

const ctx = createContext({ String });
new Script(extract("function escapeHtml(str) {")).runInContext(ctx);
new Script(extract("function infoClickable(label, type, value) {")).runInContext(ctx);
const { escapeHtml, infoClickable } = ctx;

describe("escapeHtml", () => {
  it("escapes the double quote", () => {
    // The regression: createTextNode/innerHTML escaped & < > but NOT ", and
    // the output is interpolated into data-value="..." by infoClickable().
    assert.equal(escapeHtml('a"b'), "a&quot;b");
  });

  it("still escapes the markup characters", () => {
    assert.equal(escapeHtml("<b>"), "&lt;b&gt;");
    assert.equal(escapeHtml("a&b"), "a&amp;b");
    assert.equal(escapeHtml("a'b"), "a&#39;b");
  });

  it("leaves ordinary text alone", () => {
    // The other direction: over-escaping would mangle every label in the UI.
    assert.equal(escapeHtml("cdn.example.com/lib/v2.1/main.js"), "cdn.example.com/lib/v2.1/main.js");
  });

  it("accepts non-strings", () => {
    assert.equal(escapeHtml(404), "404");
  });
});

describe("infoClickable", () => {
  it("keeps a hostile node key inside its attribute", () => {
    // A GEXF node key is attacker-controlled and lands in data-value.
    const key = 'x" data-injected="YES';
    const html = infoClickable("label", "domain", key);
    const attrs = html.match(/\s[a-z-]+="/g) || [];
    assert.equal(attrs.length, 3, `expected class/data-type/data-value only, got: ${html}`);
    assert.ok(!html.includes('data-injected="'), "the key broke out of its attribute");
  });

  it("escapes the label too", () => {
    assert.ok(infoClickable("<script>", "domain", "k").includes("&lt;script&gt;"));
  });
});
