import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext } from "node:vm";
import { readFileSync } from "node:fs";

// Read the source file
const src = readFileSync(
  new URL("../dist/httpgraph.js", import.meta.url),
  "utf-8"
);

// Stubbed Chrome APIs. Every addListener captures its callback in
// chrome.listeners so a test can fire the shipped handler directly.
function makeChrome(over = {}) {
  const listeners = {};
  const capture = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  return {
    listeners,
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    storage: { local: { get: () => Promise.resolve({}), set: () => {} } },
    tabs: { get: (_id, cb) => cb(null) },
    webRequest: {
      onBeforeRequest: capture("onBeforeRequest"),
      onBeforeRedirect: capture("onBeforeRedirect"),
      onCompleted: capture("onCompleted"),
      onErrorOccurred: capture("onErrorOccurred"),
    },
    runtime: {
      lastError: null,
      onInstalled: capture("onInstalled"),
      onStartup: capture("onStartup"),
      onConnectExternal: capture("onConnectExternal"),
    },
    ...over,
  };
}

// Mirrors chrome.storage.local.get(defaults): stored keys win, defaults fill the rest.
function makeStorage(stored, written = []) {
  return { local: {
    get: (defaults) => Promise.resolve({ ...defaults, ...stored }),
    set: (obj) => { written.push(obj); return Promise.resolve(); },
  } };
}

// Build a minimal sandbox so the top-level listeners in httpgraph.js don't
// throw when the script is evaluated. Wrap the source in an IIFE that returns
// the functions we want to test, since const/let declarations don't become
// context properties in vm.
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
    chrome: overrides.chrome || makeChrome(),
  });

  // Wrap source so we can extract const-declared values.
  // The IIFE runs the original source then returns the targets.
  const wrapped = `(function() {\n${src}\nreturn { cyrb53, domainMatches, scrubUrl, passesDomainFilter, postToBackend, logResponse, requestTimings, requestInitiators };\n})()`;
  const script = new Script(wrapped, { filename: "httpgraph.js" });
  return script.runInContext(ctx);
}

const { cyrb53, domainMatches, scrubUrl, passesDomainFilter } = loadModule();


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

// ---------- scrubUrl ----------

describe("scrubUrl", () => {
  it("replaces the query string with a hash", () => {
    const scrubbed = scrubUrl("https://example.com/path?secret=abc&token=xyz");
    assert.match(scrubbed, /^https:\/\/example\.com\/path\?SCRUBBED_hash=\d+$/);
  });

  it("is stable for the same query and distinct for different ones", () => {
    // The old scrubber hashed the regex match offset, not the query, so every
    // query on a resource collapsed to one constant. Tested through the real
    // replace call, not a regex copied into the test.
    assert.equal(scrubUrl("https://e.com/p?a=1"), scrubUrl("https://e.com/p?a=1"));
    assert.notEqual(scrubUrl("https://e.com/p?a=1"), scrubUrl("https://e.com/p?a=2"));
  });

  it("leaves a URL without a query alone", () => {
    assert.equal(scrubUrl("https://example.com/path"), "https://example.com/path");
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
      chrome: makeChrome({
        storage: makeStorage(settings),
        tabs: { get: (_id, cb) => cb({ url: "https://referer.example/page?tab=1" }) },
      }),
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

  it("scrubs the URL and the referer, and keeps different queries distinct", async () => {
    const h = harness(settings({ scrub_parameters: true }));
    await h.mod.logResponse({ ...details, url: "https://tracked.example/a?q=1" });
    await h.mod.logResponse({ ...details, url: "https://tracked.example/a?q=2" });
    assert.match(h.sent[0].url, /^https:\/\/tracked\.example\/a\?SCRUBBED_hash=\d+$/);
    assert.match(h.sent[0].referer, /^https:\/\/referer\.example\/page\?SCRUBBED_hash=\d+$/);
    assert.notEqual(h.sent[0].url, h.sent[1].url, "two queries on one resource must not hash alike");
  });
});

// ---------- onInstalled ----------

describe("onInstalled", () => {
  // Fires on updates too. The old listener wrote every default unconditionally,
  // so upgrading un-paused collection, turned scrubbing off and wiped the lists.
  const chosen = { rest_port: "55555", scrub_parameters: true, collecting: false, domain_include: "", domain_exclude: "ads.net" };
  const defaults = { rest_port: "65444", scrub_parameters: false, collecting: true, domain_include: "", domain_exclude: "" };

  function harness(stored) {
    const written = [];
    const badge = [];
    const chrome = makeChrome({
      storage: makeStorage(stored, written),
      action: { setBadgeText: (o) => badge.push(o.text), setBadgeBackgroundColor: () => {} },
    });
    loadModule({ chrome });
    return { fire: chrome.listeners.onInstalled, written, badge };
  }

  it("keeps every user setting across an update", async () => {
    const h = harness(chosen);
    await h.fire({ reason: "update", previousVersion: "0.6" });
    assert.deepEqual(h.written, [chosen]);
    assert.deepEqual(h.badge, ["OFF"], "badge must reflect the kept paused state, not the default");
  });

  it("writes the defaults on a clean install", async () => {
    const h = harness({});
    await h.fire({ reason: "install" });
    assert.deepEqual(h.written, [defaults]);
    assert.deepEqual(h.badge, [""]);
  });
});

// ---------- onBeforeRedirect ----------

describe("onBeforeRedirect", () => {
  const redirect = {
    requestId: "r1", tabId: 3, timeStamp: 1, statusCode: 302, method: "GET", type: "main_frame", ip: "10.0.0.1",
    url: "https://example.com/login?source=secret1",
    redirectUrl: "https://example.com/cb?token=secret2",
  };

  function harness(scrub) {
    const sent = [];
    const chrome = makeChrome({ storage: makeStorage({ scrub_parameters: scrub }) });
    loadModule({
      chrome,
      fetch: (_url, opts) => { sent.push(JSON.parse(opts.body)); return Promise.resolve({}); },
    });
    return { fire: chrome.listeners.onBeforeRedirect, sent };
  }

  it("scrubs both ends of a redirect when scrubbing is on", async () => {
    // The redirect record used to skip scrubbing entirely, leaking auth
    // callback codes that scrubbing the eventual completed request cannot undo.
    const h = harness(true);
    await h.fire(redirect);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].edge_type, "redirect");
    assert.match(h.sent[0].url, /^https:\/\/example\.com\/login\?SCRUBBED_hash=\d+$/);
    assert.match(h.sent[0].redirect_url, /^https:\/\/example\.com\/cb\?SCRUBBED_hash=\d+$/);
    assert.ok(!JSON.stringify(h.sent[0]).includes("secret"), "no secret may survive in the record");
  });

  it("sends both URLs verbatim when scrubbing is off", async () => {
    const h = harness(false);
    await h.fire(redirect);
    assert.equal(h.sent[0].url, redirect.url);
    assert.equal(h.sent[0].redirect_url, redirect.redirectUrl);
  });
});
