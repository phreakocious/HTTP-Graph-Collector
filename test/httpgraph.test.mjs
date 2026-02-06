import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext } from "node:vm";
import { readFileSync } from "node:fs";

// Read the source file
const src = readFileSync(
  new URL("../dist/httpgraph.js", import.meta.url),
  "utf-8"
);

// Build a minimal sandbox with stubbed Chrome APIs so the top-level
// listeners in httpgraph.js don't throw when the script is evaluated.
// Wrap the source in an IIFE that returns the functions we want to test,
// since const/let declarations don't become context properties in vm.
function loadModule() {
  const ctx = createContext({
    console,
    Math,
    Map,
    Set,
    URL,
    fetch: () => {},
    setTimeout: () => {},
    chrome: {
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      storage: { local: { get: () => Promise.resolve({}), set: () => {} } },
      tabs: { get: (_id, cb) => cb(null) },
      webRequest: {
        onBeforeRequest: { addListener: () => {} },
        onBeforeRedirect: { addListener: () => {} },
        onCompleted: { addListener: () => {} },
        onErrorOccurred: { addListener: () => {} },
      },
      runtime: {
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onConnectExternal: { addListener: () => {} },
      },
    },
  });

  // Wrap source so we can extract const-declared values.
  // The IIFE runs the original source then returns the targets.
  const wrapped = `(function() {\n${src}\nreturn { cyrb53, domainMatches, scrubber };\n})()`;
  const script = new Script(wrapped, { filename: "httpgraph.js" });
  return script.runInContext(ctx);
}

const { cyrb53, domainMatches, scrubber } = loadModule();

// ---------- cyrb53 ----------

describe("cyrb53", () => {
  it("returns a number", () => {
    assert.equal(typeof cyrb53("hello"), "number");
  });

  it("is deterministic", () => {
    assert.equal(cyrb53("test"), cyrb53("test"));
  });

  it("produces different hashes for different inputs", () => {
    assert.notEqual(cyrb53("foo"), cyrb53("bar"));
  });

  it("respects the seed parameter", () => {
    assert.notEqual(cyrb53("hello", 1), cyrb53("hello", 2));
  });

  it("handles empty string", () => {
    assert.equal(typeof cyrb53(""), "number");
  });
});

// ---------- domainMatches ----------

describe("domainMatches", () => {
  it("matches exact domain", () => {
    assert.equal(domainMatches("example.com", ["example.com"]), true);
  });

  it("matches subdomain", () => {
    assert.equal(domainMatches("sub.example.com", ["example.com"]), true);
  });

  it("does not match partial domain name", () => {
    assert.equal(domainMatches("notexample.com", ["example.com"]), false);
  });

  it("returns false for empty list", () => {
    assert.equal(domainMatches("example.com", []), false);
  });

  it("matches any domain in the list", () => {
    assert.equal(
      domainMatches("foo.org", ["example.com", "foo.org"]),
      true
    );
  });

  it("does not match unrelated domains", () => {
    assert.equal(domainMatches("other.net", ["example.com", "foo.org"]), false);
  });
});

// ---------- scrubber ----------

describe("scrubber", () => {
  it("replaces query string with SCRUBBED_hash", () => {
    const result = scrubber("?key=value", "key=value", 0, "");
    assert.match(result, /^\?SCRUBBED_hash=\d+$/);
  });

  it("produces consistent hashes for same query", () => {
    const r1 = scrubber("?a=1", "a=1", 0, "");
    const r2 = scrubber("?a=1", "a=1", 0, "");
    assert.equal(r1, r2);
  });

  it("produces different hashes for different queries", () => {
    const r1 = scrubber("?a=1", "a=1", 0, "");
    const r2 = scrubber("?b=2", "b=2", 0, "");
    assert.notEqual(r1, r2);
  });

  it("works with String.replace as intended", () => {
    const url = "https://example.com/path?secret=abc&token=xyz";
    const scrubbed = url.replace(/\?(.*)/, scrubber);
    assert.match(scrubbed, /^https:\/\/example\.com\/path\?SCRUBBED_hash=\d+$/);
  });
});
