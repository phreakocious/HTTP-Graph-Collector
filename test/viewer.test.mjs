import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext } from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// viewer/app.js is one big IIFE that touches the DOM as it evaluates, so
// booting it whole would need a full DOM. Lift out just the functions under
// test, straight from the shipped source, so tests can't drift from it.
const src = readFileSync(new URL("../viewer/app.js", import.meta.url), "utf-8");

// The vendored graphology build is the one the viewer runs on. Real graph
// semantics matter here: edges(a, b) returning both directions is a finding.
const require = createRequire(import.meta.url);
const Graph = require("../viewer/vendor/graphology.umd.min.js");

// Top-level functions in the IIFE are indented two spaces and end with
// "\n  }\n"; prototype methods end with "\n  };\n".
function extract(signature, end = "\n  }\n") {
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `could not find ${signature} in viewer/app.js`);
  const stop = src.indexOf(end, start);
  assert.notEqual(stop, -1, `could not find the end of ${signature}`);
  return src.slice(start, stop + end.length - 1);
}

// A vm context seeded with the module-level state the extracted functions
// reach for, plus the functions themselves. Tests read and write module
// state (fa2Worker, redirectNext, ...) through the returned context.
function sandbox(globals, signatures = []) {
  const ctx = createContext({ String, Number, Math, Set, Object, Array, Promise, Date, Graph, ...globals });
  const load = (sig) => new Script(extract(...(Array.isArray(sig) ? sig : [sig]))).runInContext(ctx);
  ["function escapeHtml(str) {", "function infoClickable(label, type, value) {",
    "function infoSection(title) {", "function infoBadge(text, color) {"].forEach(load);
  signatures.forEach(load);
  return ctx;
}

const el = () => ({ textContent: "", innerHTML: "", checked: false, style: {}, classList: { add() {}, remove() {} } });
const panel = () => ({ ...el(), querySelectorAll: () => [] });
const theme = { textMuted: "#888", accentYellow: "#ff0", red: "#f00", accentCyan: "#0ff", border: "#333" };
const HOSTILE = '<img src=x onerror="window.pwned=1">';

describe("escapeHtml", () => {
  const { escapeHtml } = sandbox({});

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
  const { infoClickable } = sandbox({});

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

describe("showEdgeInfo", () => {
  it("escapes the endpoint node types", () => {
    // node_type is a GEXF-controlled string and was interpolated raw next to
    // the (escaped) infoClickable output.
    const g = new Graph();
    g.addNode("a", { node_type: HOSTILE, label: "a" });
    g.addNode("b", { node_type: "host", label: "b" });
    const e = g.addEdge("a", "b", { edge_type: "redirect", status_code: 302 });
    const ctx = sandbox(
      { graph: g, infoPanel: panel(), infoContent: el(), document: { getElementById: () => null }, theme },
      ["function showEdgeInfo(edgeKey) {"]
    );
    ctx.showEdgeInfo(e);
    const html = ctx.infoContent.innerHTML;
    assert.ok(!html.includes("<img"), html);
    assert.ok(html.includes(ctx.escapeHtml(HOSTILE)), "the type must still be shown, escaped");
  });
});

describe("showNodeInfo (resource)", () => {
  function resourceCtx() {
    const g = new Graph();
    g.addNode("h.example", { node_type: "host", label: "h.example" });
    g.addNode("h.example/a", {
      node_type: "resource", label: "/a", domain: "example.", status_code: 200,
      method: "GET", protocol: "https", request_type: "script", content_type: "text/html",
      bytes: 456, timestamp: 1700000000000, duration_ms: 123, visited: 7,
    });
    g.addNode("h.example/b", { node_type: "resource", label: "/b" });
    g.addEdge("h.example", "h.example/a");
    g.addEdge("h.example/a", "h.example/b", { edge_type: "redirect", status_code: HOSTILE });
    return sandbox(
      {
        graph: g, infoPanel: panel(), infoContent: el(), document: { getElementById: () => null }, theme,
        TYPE_COLORS: {}, ROLE_COLORS: {},
        redirectNext: { "h.example/a": "h.example/b" }, redirectPrev: { "h.example/b": "h.example/a" },
      },
      ["function getRedirectChain(nodeKey) {", "function infoAttrRows(attrs, shown) {", "function showNodeInfo(nodeKey) {"]
    );
  }

  it("shows what the collector recorded", () => {
    // The specialised resource branch used to bypass the generic renderer, so
    // method/protocol/type/content type/bytes/timestamp/duration/visited vanished.
    const ctx = resourceCtx();
    ctx.showNodeInfo("h.example/a");
    const html = ctx.infoContent.innerHTML;
    for (const v of ["GET", "https", "script", "text/html", "456", "1700000000000", "123", "7"]) {
      assert.ok(html.includes(">" + v + "<"), `missing ${v} in ${html}`);
    }
    assert.equal((html.match(/>200</g) || []).length, 1, "status shown once, not again by the generic rows");
  });

  it("escapes the redirect status in the chain", () => {
    const ctx = resourceCtx();
    ctx.showNodeInfo("h.example/a");
    const html = ctx.infoContent.innerHTML;
    assert.ok(!html.includes("<img"), html);
    assert.ok(html.includes("&lt;img"));
  });
});

describe("initRenderer", () => {
  it("rebuilds the redirect index after resetting per-graph state", () => {
    // Regression: loadGexf and the IndexedDB restore built the index, then
    // called initRenderer, whose resetGraphState() emptied it again.
    const g = new Graph();
    g.addNode("a/x", { node_type: "resource" });
    g.addNode("b/y", { node_type: "resource" });
    g.addEdge("a/x", "b/y", { edge_type: "redirect", status_code: 301 });
    const ctx = sandbox(
      {
        graph: g, renderer: null, requestAnimationFrame: () => {},
        rebuildBundles: () => {}, updateHiddenCount: () => {},
        hiddenTypes: new Set(), hiddenDomains: new Set(), hiddenContentGroups: new Set(), manuallyHidden: new Set(),
        renderedSearchNodes: new Set(), renderedTypes: new Set(), renderedContentGroups: new Set(), renderedDomains: new Set(),
        expandedHosts: new Set(), showHiddenCb: el(), nodeList: el(), typeFiltersDiv: el(), contentFiltersDiv: el(), domainFiltersDiv: el(),
        redirectNext: {}, redirectPrev: {},
      },
      ["function resetGraphState() {", "function rebuildRedirectIndex() {", "function initRenderer(opts) {", "function getRedirectChain(nodeKey) {"]
    );
    ctx.initRenderer();
    // join: the chain array is from the vm realm and fails strict deep-equal on prototype alone
    assert.equal(ctx.getRedirectChain("a/x").join(","), "a/x,b/y");
  });
});

describe("startFA2 worker ownership", () => {
  const fakeWorker = () => ({
    terminated: false, posted: [],
    terminate() { this.terminated = true; },
    postMessage(m) { this.posted.push(m); },
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // createFA2Worker() awaits two fetches; here each call hands back a promise
  // the test resolves by hand, so Start/Stop can interleave with it.
  function deferred() {
    const pending = [];
    const ctx = sandbox(
      {
        fa2Running: false, graph: {}, fa2Settings: { scalingRatio: 1 }, fa2Generation: 0, fa2Idle: false, fa2FrameId: null,
        fa2Worker: null, fa2WorkerPromise: null, fa2WorkerBlobUrl: null, fa2UseWorker: false, fa2NodeKeys: null, fa2LayoutGraph: null,
        fa2Iters: 5, fa2SettleThreshold: 0.5, renderer: null,
        btnFA2: el(), fa2SettingsDiv: el(), fa2ModeLabel: el(),
        readFA2Settings() {}, initFA2Settings() {}, saveGraph() {}, cancelAnimationFrame() {}, runFA2Sync() {},
        buildLayoutGraph: () => ({ order: 1, forEachNode() {}, export: () => ({}) }),
        createFA2Worker: () => new Promise((resolve) => pending.push(resolve)),
        URL: { revokeObjectURL() {} },
      },
      ["async function startFA2() {", "function stopFA2() {", "function killFA2Worker() {"]
    );
    return { ctx, resolveNext: (w) => pending.shift()(w) };
  }

  it("Start-Stop-Start hands the worker to the second start alive", async () => {
    // Both starts await the same promise. The first, now stale, used to
    // terminate the worker; the second then claimed the corpse and posted
    // init into it: UI says running, no positions ever arrive.
    const { ctx, resolveNext } = deferred();
    const w = fakeWorker();
    ctx.startFA2(); ctx.stopFA2(); ctx.startFA2();
    resolveNext(w); await tick();
    assert.equal(ctx.fa2Running, true);
    assert.equal(ctx.fa2Worker, w);
    assert.equal(w.terminated, false, "the losing start must not terminate the worker the winner claims");
    assert.equal(w.posted[0] && w.posted[0].type, "init");
  });

  it("a restart during the fetch disposes of the superseded worker and claims the new one", async () => {
    const { ctx, resolveNext } = deferred();
    const w1 = fakeWorker(), w2 = fakeWorker();
    ctx.startFA2();
    ctx.stopFA2(); ctx.killFA2Worker(); ctx.startFA2(); // what restartFA2IfRunning() does
    resolveNext(w1); resolveNext(w2); await tick();
    assert.equal(ctx.fa2Worker, w2);
    assert.equal(w2.terminated, false);
    assert.equal(w1.terminated, true, "nobody will ever claim w1; it must not leak");
  });

  it("a start stopped before its worker arrives parks it for the next start", async () => {
    const { ctx, resolveNext } = deferred();
    const w = fakeWorker();
    ctx.startFA2(); ctx.stopFA2();
    resolveNext(w); await tick();
    assert.equal(ctx.fa2Worker, null);
    assert.equal(w.terminated, false);
    ctx.startFA2(); await tick();
    assert.equal(ctx.fa2Worker, w, "the parked worker is reused, not rebuilt");
    ctx.killFA2Worker();
    assert.equal(w.terminated, true);
  });

  it("a ready that lands after Stop does not start the worker", async () => {
    // The worker had init; Stop ran before its ready reached the page. The
    // unguarded handler then posted start: layout running behind a UI that
    // said stopped.
    const { ctx, resolveNext } = deferred();
    const w = fakeWorker();
    ctx.startFA2(); resolveNext(w); await tick();
    ctx.stopFA2();
    w.onmessage({ data: { type: "ready", gen: w.posted[0].gen } });
    assert.deepEqual(w.posted.map((m) => m.type), ["init", "stop"]);
    assert.equal(ctx.fa2Running, false);
  });

  it("a ready for the current run starts it", async () => {
    // The other direction: a guard that never matched would park every run at init.
    const { ctx, resolveNext } = deferred();
    const w = fakeWorker();
    ctx.startFA2(); resolveNext(w); await tick();
    w.onmessage({ data: { type: "ready", gen: w.posted[0].gen } });
    assert.deepEqual(w.posted.map((m) => m.type), ["init", "start"]);
  });

  it("a reused worker's stale ready is dropped and the current one starts it", async () => {
    const { ctx, resolveNext } = deferred();
    const w = fakeWorker();
    ctx.startFA2(); resolveNext(w); await tick();
    ctx.stopFA2(); ctx.startFA2(); // same worker, no fetch to await
    assert.deepEqual(w.posted.map((m) => m.type), ["init", "stop", "init"]);
    assert.notEqual(w.posted[0].gen, w.posted[2].gen);
    w.onmessage({ data: { type: "ready", gen: w.posted[0].gen } });
    assert.equal(w.posted.length, 3, "the first run's ready must not start the second");
    w.onmessage({ data: { type: "ready", gen: w.posted[2].gen } });
    assert.equal(w.posted[3].type, "start");
  });
});

// Hosts with three plain resources each; each collapses on its own. The
// sandbox gets rebuildBundles and what it calls, plus whatever a test adds.
function hostsGraph(hosts = ["h1", "h2"], globals = {}, signatures = []) {
  const g = new Graph();
  g.addNode("client:localhost", { node_type: "client" });
  for (const h of hosts) {
    g.addNode(h, { node_type: "host", domain: h + ".", x: 0, y: 0, color: "#fff" });
    for (const p of ["a", "b", "c"]) {
      g.addNode(h + "/" + p, { node_type: "resource", domain: h + "." });
      g.addEdge(h, h + "/" + p);
    }
  }
  const ctx = sandbox(
    { graph: g, expandedHosts: new Set(), bundlePositions: {}, bundledResources: new Set(), bundleEnabled: true, originalSizes: {}, parseDomain: (h) => h + ".", ...globals },
    ["function accumulateEdge(g, srcId, dstId, attrs, undirected) {", "function hostOfResource(resourceId) {",
      "function shouldExtract(resourceId, hostId) {", "function rebuildBundles() {", ...signatures]
  );
  return { g, ctx };
}

describe("rebuildBundles", () => {
  it("keeps a redirect between two collapsed hosts, with its direction and type", () => {
    // The redirect h1/a → h2/a has a bundled resource at BOTH ends; the old
    // neighbor walk skipped it, so the only relationship between the hosts
    // vanished from the visible graph.
    const { g, ctx } = hostsGraph();
    g.addEdge("h1/a", "h2/a", { edge_type: "redirect", status_code: 302, weight: 1 });
    g.addEdge("client:localhost", "h1/b", { weight: 3 });
    g.addEdge("client:localhost", "h1/c", { weight: 2 });
    ctx.rebuildBundles();
    assert.equal(ctx.bundledResources.size, 6);

    const e = g.edge("bundle:h1", "bundle:h2");
    assert.ok(e, "cross-bundle redirect must survive projection");
    assert.equal(g.getEdgeAttribute(e, "edge_type"), "redirect");
    assert.equal(g.getEdgeAttribute(e, "status_code"), 302);
    assert.ok(!g.edge("bundle:h2", "bundle:h1"), "direction must be preserved");

    // client → resource projects as client → bundle, not bundle → client, weights summed
    const c = g.edge("client:localhost", "bundle:h1");
    assert.ok(c);
    assert.equal(g.getEdgeAttribute(c, "weight"), 5);
    assert.ok(!g.edge("bundle:h1", "client:localhost"));

    // host → its own bundle comes from the first pass only, not doubled by projection
    assert.equal(g.getEdgeAttribute(g.edge("h1", "bundle:h1"), "weight"), 3);
  });

  it("keeps redirect metadata when plain and redirect edges share a projection, in either order", () => {
    // The first member to project used to own every attribute: a redirect
    // visited after a plain edge counted toward the weight but lost its type.
    const plain = ["h1/a", "h2/a", { weight: 2 }];
    const redirect = ["h1/b", "h2/b", { edge_type: "redirect", status_code: 302, weight: 3 }];
    for (const order of [[plain, redirect], [redirect, plain]]) {
      const { g, ctx } = hostsGraph();
      order.forEach((e) => g.addEdge(...e));
      ctx.rebuildBundles();
      assert.deepEqual({ ...g.getEdgeAttributes(g.edge("bundle:h1", "bundle:h2")) },
        { weight: 5, edge_type: "redirect", status_code: 302 });
    }
  });

  it("reports whether the collapsed set changed", () => {
    const { g, ctx } = hostsGraph(["h1", "h2", "h3"]);
    g.addEdge("h1/a", "h2/a");
    assert.equal(ctx.rebuildBundles(), true, "first pass collapses everything");
    assert.equal(ctx.rebuildBundles(), false, "nothing moved");
    // h1/a now touches two external hosts: extracted, and the two plain
    // resources left on h1 are too few for a bundle.
    g.addEdge("h1/a", "h3/a");
    assert.equal(ctx.rebuildBundles(), true);
    assert.ok(!g.hasNode("bundle:h1"));
    ctx.bundleEnabled = false;
    assert.equal(ctx.rebuildBundles(), true, "disabling drops every bundle");
    assert.equal(ctx.rebuildBundles(), false);
  });
});

describe("foldParallelEdges", () => {
  const ctx = sandbox({ LiveGraphBuilder: { prototype: {} } },
    ["function accumulateEdge(g, srcId, dstId, attrs, undirected) {", "function foldParallelEdges(g) {",
      ["LiveGraphBuilder.prototype.addEdge = function (srcId, dstId, attrs) {", "\n  };\n"]]);

  it("folds a parsed multigraph into one weighted edge per pair", () => {
    // The GEXF parser returns multi:true on the first parallel edge, and
    // graph.edge() -- rebuildBundles, live addEdge -- throws on multigraphs.
    const m = new Graph({ multi: true });
    m.addNode("a", { node_type: "resource" });
    m.addNode("b", { node_type: "resource" });
    m.addEdge("a", "b", { weight: 2 });
    m.addEdge("a", "b", { edge_type: "redirect", status_code: 302 });
    m.addEdge("b", "a", { weight: 4 });
    const g = ctx.foldParallelEdges(m);
    assert.equal(g.multi, false);
    assert.equal(g.size, 2);
    assert.equal(g.getNodeAttribute("a", "node_type"), "resource");
    assert.deepEqual({ ...g.getEdgeAttributes(g.edge("a", "b")) }, { weight: 3, edge_type: "redirect", status_code: 302 });
    assert.equal(g.getEdgeAttribute(g.edge("b", "a"), "weight"), 4);
    // live records can append to the loaded graph afterwards
    ctx.LiveGraphBuilder.prototype.addEdge.call({ graph: g }, "a", "b");
    assert.equal(g.getEdgeAttribute(g.edge("a", "b"), "weight"), 4);
  });

  it("returns a simple graph untouched", () => {
    const g = new Graph();
    g.addNode("a");
    assert.equal(ctx.foldParallelEdges(g), g);
  });

  it("keeps each edge's orientation in a mixed file", () => {
    // Parallel edges anywhere in a mixed file used to turn every undirected
    // edge in it directed, and that topology is what a later export wrote.
    const m = new Graph({ multi: true });
    for (const k of ["a", "b", "c"]) m.addNode(k);
    m.addDirectedEdge("a", "b", { weight: 1 });
    m.addDirectedEdge("a", "b", { weight: 2 });
    m.addUndirectedEdge("a", "b", { weight: 5 });
    m.addUndirectedEdge("b", "c", { weight: 3 });
    const g = ctx.foldParallelEdges(m);
    assert.equal(g.type, "mixed");
    assert.equal(g.directedSize, 1);
    assert.equal(g.undirectedSize, 2);
    assert.equal(g.getEdgeAttribute(g.directedEdge("a", "b"), "weight"), 3);
    assert.equal(g.getEdgeAttribute(g.undirectedEdge("a", "b"), "weight"), 5, "directed and undirected a-b stay apart");
    assert.equal(g.getEdgeAttribute(g.undirectedEdge("c", "b"), "weight"), 3);
  });

  it("keeps an undirected file undirected, and live records still append to it", () => {
    const m = new Graph({ multi: true, type: "undirected" });
    m.addNode("a"); m.addNode("b");
    m.addEdge("a", "b", { weight: 1 });
    m.addEdge("b", "a", { weight: 2 });
    const g = ctx.foldParallelEdges(m);
    assert.equal(g.type, "undirected");
    assert.equal(g.size, 1);
    assert.equal(g.getEdgeAttribute(g.edge("a", "b"), "weight"), 3);
    ctx.LiveGraphBuilder.prototype.addEdge.call({ graph: g }, "b", "a");
    assert.equal(g.getEdgeAttribute(g.edge("a", "b"), "weight"), 4);
  });
});

describe("scheduleLiveRefresh", () => {
  function flush(graphGrew) {
    const calls = [];
    let fire;
    const ctx = sandbox({
      liveRefreshTimer: null, graphGrew, renderer: null, fa2Idle: true, fa2Running: false,
      rebuildBundles: () => { calls.push("rebuildBundles"); return false; }, // no membership change
      restartFA2IfRunning: () => calls.push("restartFA2IfRunning"),
      updateStats() {}, scheduleSave() {}, setTimeout: (fn) => { fire = fn; return 1; },
    }, ["function scheduleLiveRefresh() {"]);
    ctx.scheduleLiveRefresh();
    fire();
    return calls;
  }

  it("rebuilds bundles when a record added an edge but no node", () => {
    // A redirect between two already-collapsed resources: the original edge
    // is hidden inside the bundles and only the projection can show it.
    assert.deepEqual(flush(false), ["rebuildBundles"]);
  });

  it("wakes the layout only for new visible nodes", () => {
    assert.deepEqual(flush(true), ["rebuildBundles", "restartFA2IfRunning"]);
  });

  it("restarts the layout when a record dissolves a bundle without adding a node", () => {
    // Real rebuildBundles here. A redirect between two existing resources
    // gives h1/a a second external host, so it leaves its bundle, and the
    // two plain resources left are too few: the bundle node is dropped. The
    // running layout's node list still names it, so its next positions
    // batch would throw unless the layout is rebuilt.
    const calls = [];
    let fire;
    const { g, ctx } = hostsGraph(["h1", "h2", "h3"], {
      liveRefreshTimer: null, graphGrew: false, renderer: null, fa2Idle: false, fa2Running: true,
      restartFA2IfRunning: () => calls.push("restartFA2IfRunning"), updateStats() {}, scheduleSave() {},
      setTimeout: (fn) => { fire = fn; return 1; },
    }, ["function scheduleLiveRefresh() {"]);
    g.addEdge("h1/a", "h2/a");
    ctx.rebuildBundles();
    assert.ok(g.hasNode("bundle:h1"));

    g.addEdge("h1/a", "h3/a", { edge_type: "redirect", status_code: 302, weight: 1 }); // what processRecord adds
    ctx.scheduleLiveRefresh(); fire();
    assert.ok(!g.hasNode("bundle:h1"));
    assert.deepEqual(calls, ["restartFA2IfRunning"]);

    // More traffic on an existing edge moves nothing: no restart.
    g.setEdgeAttribute(g.edge("h1/a", "h3/a"), "weight", 2);
    ctx.scheduleLiveRefresh(); fire();
    assert.deepEqual(calls, ["restartFA2IfRunning"]);
  });
});

describe("LiveGraphBuilder.addEdge", () => {
  function builder() {
    const g = new Graph();
    g.addNode("a");
    g.addNode("b");
    const ctx = sandbox({ LiveGraphBuilder: { prototype: {} } },
      ["function accumulateEdge(g, srcId, dstId, attrs, undirected) {",
        ["LiveGraphBuilder.prototype.addEdge = function (srcId, dstId, attrs) {", "\n  };\n"]]);
    const add = (s, d, attrs) => ctx.LiveGraphBuilder.prototype.addEdge.call({ graph: g }, s, d, attrs);
    const weight = (s, d) => g.getEdgeAttribute(g.edge(s, d), "weight");
    return { g, add, weight };
  }

  it("increments the edge in the requested direction when both directions exist", () => {
    // Regression: edges(src, dst) returns both directions and listed the
    // reverse edge first, so b→a traffic bumped a→b.
    const { g, add, weight } = builder();
    g.addEdge("a", "b", { weight: 10 });
    g.addEdge("b", "a", { weight: 20 });
    add("b", "a");
    assert.equal(weight("a", "b"), 10);
    assert.equal(weight("b", "a"), 21);
    add("a", "b");
    assert.equal(weight("a", "b"), 11);
    assert.equal(weight("b", "a"), 21);
  });

  it("creates, then counts, in either insertion order", () => {
    const { g, add, weight } = builder();
    add("b", "a", { edge_type: "redirect", status_code: 302 });
    add("a", "b");
    add("b", "a");
    add("b", "a");
    assert.equal(weight("b", "a"), 3);
    assert.equal(weight("a", "b"), 1);
    assert.equal(g.getEdgeAttribute(g.edge("b", "a"), "edge_type"), "redirect");
    assert.equal(g.getEdgeAttribute(g.edge("a", "b"), "edge_type"), undefined);
  });

  it("types an existing edge when a redirect is seen on it, first value wins", () => {
    const { g, add } = builder();
    add("a", "b");
    add("a", "b", { edge_type: "redirect", status_code: 302 });
    add("a", "b", { edge_type: "redirect", status_code: 301 });
    assert.equal(g.getEdgeAttribute(g.edge("a", "b"), "edge_type"), "redirect");
    assert.equal(g.getEdgeAttribute(g.edge("a", "b"), "status_code"), 302);
  });
});

describe("setupContentFilters", () => {
  function ctxFor(g) {
    const section = { style: { display: "none" } };
    const ctx = sandbox(
      {
        graph: g, renderedContentGroups: new Set(), hiddenContentGroups: new Set(), renderer: null,
        classifyContent: (ct) => ct.split("/")[0],
        contentFiltersDiv: { appendChild() {}, querySelectorAll: () => [] },
        document: {
          createDocumentFragment: () => ({ appendChild() {} }),
          createElement: () => ({ appendChild() {}, addEventListener() {}, dataset: {}, style: {} }),
          createTextNode: () => ({}),
          getElementById: () => section,
        },
      },
      ["function setupContentFilters() {"]
    );
    return { ctx, section };
  }

  it("stays visible on a refresh that adds no new group", () => {
    // Regression: "no new checkbox this call" was read as "no filters exist".
    const g = new Graph();
    g.addNode("h/x.js", { node_type: "resource", content_type: "application/javascript" });
    const { ctx, section } = ctxFor(g);
    ctx.setupContentFilters();
    assert.equal(section.style.display, "");
    ctx.setupContentFilters(); // the next live refresh, same groups
    assert.equal(section.style.display, "", "an existing filter must keep its section visible");
  });

  it("hides when the graph has no content types", () => {
    const g = new Graph();
    g.addNode("h", { node_type: "host" });
    const { ctx, section } = ctxFor(g);
    section.style.display = "";
    ctx.setupContentFilters();
    assert.equal(section.style.display, "none");
  });
});

describe("buildLayoutGraph", () => {
  it("carries domain into the layout graph so Multi-Focal has something to pull on", () => {
    // Both the worker and the sync path branch on a.domain; without it the
    // Multi-Focal checkbox changed a setting and nothing else.
    const g = new Graph();
    g.addNode("h", { x: 1, y: 2, size: 3, domain: "example.com." });
    const ctx = sandbox({ graph: g, isNodeHidden: () => false, getVisualSize: () => 1 }, ["function buildLayoutGraph() {"]);
    const lg = ctx.buildLayoutGraph();
    assert.equal(lg.getNodeAttribute("h", "domain"), "example.com.");
  });
});
