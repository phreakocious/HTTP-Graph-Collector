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
function loadModule(overrides = {}) {
  const ctx = createContext({
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Math,
    Map,
    Set,
    URL,
    Date,
    JSON,
    Promise,
    fetch: () => {},
    setTimeout: () => {},
    ...overrides,
    chrome: overrides.chrome || {
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
  const wrapped = `(function() {\n${src}\nreturn { cyrb53, domainMatches, scrubber, passesDomainFilter, postToBackend, logResponse, requestTimings, requestInitiators };\n})()`;
  const script = new Script(wrapped, { filename: "httpgraph.js" });
  return script.runInContext(ctx);
}

const { cyrb53, domainMatches, scrubber, passesDomainFilter } = loadModule();

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

// ---------- passesDomainFilter ----------

describe("passesDomainFilter", () => {
  const lists = (inc = "", exc = "") => ({ domain_include: inc, domain_exclude: exc });

  it("passes everything when both lists are empty", () => {
    assert.equal(passesDomainFilter("https://example.com/a", lists()), true);
  });

  it("include list: keeps a match, drops a non-match", () => {
    const items = lists("example.com");
    assert.equal(passesDomainFilter("https://www.example.com/a", items), true);
    assert.equal(passesDomainFilter("https://other.org/a", items), false);
  });

  it("exclude list: drops a match, keeps a non-match", () => {
    const items = lists("", "ads.net");
    assert.equal(passesDomainFilter("https://ads.net/a", items), false);
    assert.equal(passesDomainFilter("https://example.com/a", items), true);
  });

  it("an include list disables the exclude list entirely", () => {
    // Documents the else-if precedence: a host on BOTH lists is kept.
    const items = lists("example.com", "example.com");
    assert.equal(passesDomainFilter("https://example.com/a", items), true);
  });

  it("passes URLs it cannot parse", () => {
    assert.equal(passesDomainFilter("not a url", lists("", "ads.net")), true);
  });
});

// ---------- postToBackend circuit breaker ----------

describe("postToBackend", () => {
  // Drives the breaker through a controllable clock and fetch.
  function harness({ failing }) {
    let calls = 0;
    let now = 1_000_000;
    const FakeDate = { now: () => now };
    const mod = loadModule({
      Date: FakeDate,
      fetch: () => {
        calls++;
        return failing() ? Promise.reject(new Error("ECONNREFUSED")) : Promise.resolve({});
      },
    });
    return { mod, calls: () => calls, advance: (ms) => { now += ms; } };
  }

  it("keeps posting while the backend answers", async () => {
    const h = harness({ failing: () => false });
    for (let i = 0; i < 20; i++) await h.mod.postToBackend("http://x/add_record", "65444", {});
    assert.equal(h.calls(), 20, "every call should reach fetch while the backend is up");
  });

  it("stops hammering a dead backend after the failure limit", async () => {
    const h = harness({ failing: () => true });
    for (let i = 0; i < 20; i++) await h.mod.postToBackend("http://x/add_record", "65444", {});
    // 5 failures trip it; the remaining 15 must not reach fetch.
    assert.equal(h.calls(), 5, "should mute after REST_FAILURE_LIMIT, not keep retrying");
  });

  it("probes again once the retry window passes", async () => {
    const h = harness({ failing: () => true });
    for (let i = 0; i < 20; i++) await h.mod.postToBackend("http://x/add_record", "65444", {});
    assert.equal(h.calls(), 5);
    h.advance(30_001);
    await h.mod.postToBackend("http://x/add_record", "65444", {});
    assert.equal(h.calls(), 6, "a muted breaker must still probe, or a late-started logger never connects");
  });

  it("recovers fully when a probe succeeds", async () => {
    let down = true;
    const h = harness({ failing: () => down });
    for (let i = 0; i < 20; i++) await h.mod.postToBackend("http://x/add_record", "65444", {});
    assert.equal(h.calls(), 5);
    down = false;
    h.advance(30_001);
    for (let i = 0; i < 10; i++) await h.mod.postToBackend("http://x/add_record", "65444", {});
    assert.equal(h.calls(), 15, "after a success the breaker should be closed again");
  });

  it("re-arms when the port changes", async () => {
    const h = harness({ failing: () => true });
    for (let i = 0; i < 20; i++) await h.mod.postToBackend("http://x/add_record", "65444", {});
    assert.equal(h.calls(), 5);
    await h.mod.postToBackend("http://x/add_record", "9999", {});
    assert.equal(h.calls(), 6, "a new port is a new backend and deserves a fresh try");
  });
});

// ---------- per-request map cleanup ----------

describe("logResponse request-map cleanup", () => {
  // onBeforeRequest populates these maps for EVERY request, unconditionally.
  // If logResponse returns early without draining them they grow for the life
  // of the service worker — which pausing collection used to do on every hit.
  function harness(settings) {
    const sent = [];
    const mod = loadModule({
      fetch: (_url, opts) => { sent.push(JSON.parse(opts.body)); return Promise.resolve({}); },
      chrome: {
        action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
        storage: { local: { get: () => Promise.resolve(settings), set: () => {} } },
        tabs: { get: (_id, cb) => cb({ url: "https://referer.example/page" }) },
        webRequest: {
          onBeforeRequest: { addListener: () => {} },
          onBeforeRedirect: { addListener: () => {} },
          onCompleted: { addListener: () => {} },
          onErrorOccurred: { addListener: () => {} },
        },
        runtime: {
          lastError: null,
          onInstalled: { addListener: () => {} },
          onStartup: { addListener: () => {} },
          onConnectExternal: { addListener: () => {} },
        },
      },
    });
    mod.requestTimings.set("req-1", 1000);
    mod.requestInitiators.set("req-1", "https://initiator.example");
    return { mod, sent };
  }

  const details = {
    requestId: "req-1",
    url: "https://tracked.example/asset.js",
    tabId: 7,
    timeStamp: 1250,
    responseHeaders: [{ name: "Content-Type", value: "application/javascript" }],
  };

  const settings = (over = {}) => ({
    rest_port: "65444",
    scrub_parameters: false,
    collecting: true,
    domain_include: "",
    domain_exclude: "",
    ...over,
  });

  it("drains the maps when collection is paused", async () => {
    const h = harness(settings({ collecting: false }));
    await h.mod.logResponse(details);
    assert.equal(h.mod.requestTimings.size, 0, "paused must not leak timing entries");
    assert.equal(h.mod.requestInitiators.size, 0, "paused must not leak initiator entries");
    assert.equal(h.sent.length, 0, "paused must not send anything");
  });

  it("drains the maps when the domain is filtered out", async () => {
    const h = harness(settings({ domain_exclude: "tracked.example" }));
    await h.mod.logResponse(details);
    assert.equal(h.mod.requestTimings.size, 0, "a filtered request must not leak a timing entry");
    assert.equal(h.mod.requestInitiators.size, 0, "a filtered request must not leak an initiator entry");
    assert.equal(h.sent.length, 0, "a filtered request must not be sent");
  });

  it("drains the maps and still uses the values on the happy path", async () => {
    const h = harness(settings());
    await h.mod.logResponse(details);
    assert.equal(h.mod.requestTimings.size, 0);
    assert.equal(h.mod.requestInitiators.size, 0);
    assert.equal(h.sent.length, 1);
    // The drained values must still reach the record, or the refactor that
    // moved the reads up would silently drop timing and initiator data.
    assert.equal(h.sent[0].duration_ms, 250);
    assert.equal(h.sent[0].initiator, "https://initiator.example");
    assert.equal(h.sent[0].content_type, "application/javascript");
  });
});
