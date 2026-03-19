(function () {
  "use strict";

  // graphology UMD exports the Graph constructor directly as the global
  const Graph = typeof graphology === "function" ? graphology : graphology.Graph;

  // ── Live Graph Builder ───────────────────────────────────────────
  function hsvToRgb(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    var r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function generatePalette() {
    var colors = [];
    var n = 26;
    for (var i = 0; i < n; i++) colors.push(hsvToRgb(i / n, 0.85, 0.93));
    for (var g = 32; g <= 200; g += 12) colors.push([g, g, g]);
    return colors;
  }

  var MULTI_TLDS = new Set([
    "co.uk","com.au","co.jp","co.nz","com.br","co.kr","co.in","com.mx",
    "com.cn","org.uk","net.au","ac.uk","gov.uk","com.sg","com.hk","co.za",
    "com.tw","com.ar","com.tr","com.ua","com.pk","co.id","com.my","com.ng",
    "com.eg","com.ph","com.vn","com.co","com.pe","co.th","or.jp","ne.jp"
  ]);

  function parseDomain(hostname) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname + ".";
    var parts = hostname.split(".");
    if (parts.length <= 2) return hostname + ".";
    var lastTwo = parts.slice(-2).join(".");
    if (MULTI_TLDS.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join(".") + ".";
    return parts.slice(-2).join(".") + ".";
  }

  var COLOR_LOCALDOMAIN = [236, 236, 236];
  var COLOR_DEFAULT = [212, 212, 212];
  var MAXLABEL = 32;

  function LiveGraphBuilder(g) {
    this.graph = g;
    this.palette = generatePalette();
    this.colorIdx = 0;
    this.colormap = {};
    this.edgeWeights = {};
  }

  LiveGraphBuilder.prototype.assignColor = function (domain) {
    if (!this.colormap[domain]) {
      this.colormap[domain] = this.colorIdx < this.palette.length
        ? this.palette[this.colorIdx++] : COLOR_DEFAULT;
    }
    return this.colormap[domain];
  };

  LiveGraphBuilder.prototype.rgbStr = function (c) {
    return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
  };

  LiveGraphBuilder.prototype.formatLabel = function (url) {
    var idx = url.indexOf("/");
    var label = idx >= 0 ? url.substring(idx) : url;
    if (label.length > MAXLABEL) label = "... " + label.substring(label.length - MAXLABEL);
    return label;
  };

  LiveGraphBuilder.prototype.addNode = function (nodeId, nodeType, domain, size, label, attrs, parentId) {
    if (this.graph.hasNode(nodeId)) {
      var v = this.graph.getNodeAttribute(nodeId, "visited") || 1;
      this.graph.setNodeAttribute(nodeId, "visited", v + 1);
      // Backfill attrs on nodes created bare (e.g. via ensureHierarchy)
      if (attrs) {
        var cur = this.graph.getNodeAttributes(nodeId);
        for (var k in attrs) {
          if (attrs[k] && !cur[k]) this.graph.setNodeAttribute(nodeId, k, attrs[k]);
        }
      }
      return;
    }
    var px, py;
    if (parentId && this.graph.hasNode(parentId)) {
      var pa = this.graph.getNodeAttributes(parentId);
      px = pa.x + (Math.random() - 0.5) * 50;
      py = pa.y + (Math.random() - 0.5) * 50;
    } else {
      px = (Math.random() - 0.5) * 1000;
      py = (Math.random() - 0.5) * 1000;
    }
    var color = domain === "localdomain" ? COLOR_LOCALDOMAIN : this.assignColor(domain);
    var nodeAttrs = {
      label: label || nodeId,
      node_type: nodeType,
      domain: domain,
      visited: 1,
      size: size,
      color: this.rgbStr(color),
      x: px,
      y: py,
    };
    if (attrs) Object.assign(nodeAttrs, attrs);
    this.graph.addNode(nodeId, nodeAttrs);
    originalSizes[nodeId] = size;
  };

  LiveGraphBuilder.prototype.addEdge = function (srcId, dstId) {
    if (srcId === dstId) return;
    if (!this.graph.hasNode(srcId) || !this.graph.hasNode(dstId)) return;
    var key = srcId + "\t" + dstId;
    if (this.edgeWeights[key]) {
      this.edgeWeights[key]++;
      var edges = this.graph.edges(srcId, dstId);
      if (edges.length > 0) this.graph.setEdgeAttribute(edges[0], "weight", this.edgeWeights[key]);
    } else if (this.graph.hasEdge(srcId, dstId)) {
      var existing = this.graph.edges(srcId, dstId);
      this.edgeWeights[key] = (this.graph.getEdgeAttribute(existing[0], "weight") || 1) + 1;
      this.graph.setEdgeAttribute(existing[0], "weight", this.edgeWeights[key]);
    } else {
      this.edgeWeights[key] = 1;
      this.graph.addEdge(srcId, dstId, { weight: 1 });
    }
  };

  LiveGraphBuilder.prototype.ensureHierarchy = function (url) {
    var parsed;
    try { parsed = new URL(url); } catch (e) { return null; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    var host = parsed.hostname;
    var domain = parseDomain(host);
    var resourceId = host + parsed.pathname;
    this.addNode(domain, "domain", domain, 6.0);
    this.addNode(host, "host", domain, 4.0, undefined, undefined, domain);
    this.addNode(resourceId, "resource", domain, 3.0, this.formatLabel(resourceId), undefined, host);
    this.addEdge(domain, host);
    this.addEdge(host, resourceId);
    return resourceId;
  };

  LiveGraphBuilder.prototype.processRecord = function (record) {
    if (record.edge_type === "redirect") {
      var srcRes = this.ensureHierarchy(record.url);
      var dstRes = this.ensureHierarchy(record.redirect_url);
      if (srcRes && dstRes) this.addEdge(srcRes, dstRes);
      return;
    }

    var url = record.url;
    if (!url) return;
    var parsed;
    try { parsed = new URL(url); } catch (e) { return; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    if (!parsed.hostname) return;

    var host = parsed.hostname;
    var domain = parseDomain(host);
    var resourceId = host + parsed.pathname;

    this.addNode(domain, "domain", domain, 6.0);
    this.addNode(host, "host", domain, 4.0, undefined, undefined, domain);

    var resourceAttrs = {
      method: record.method || "",
      protocol: parsed.protocol.replace(":", ""),
      request_type: record.type || "",
      content_type: record.content_type || "",
      status_code: record.status || 0,
      timestamp: record.ts || 0,
    };
    if (record.bytes) resourceAttrs.bytes = parseInt(record.bytes, 10) || 0;
    if (record.duration_ms != null) resourceAttrs.duration_ms = record.duration_ms;
    this.addNode(resourceId, "resource", domain, 3.0, this.formatLabel(resourceId), resourceAttrs, host);

    var clientId = record.client || "localhost";
    this.addNode(clientId, "client", "localdomain", 8.0);

    this.addEdge(clientId, resourceId);
    this.addEdge(domain, host);
    this.addEdge(host, resourceId);

    // Initiator
    if (record.initiator) {
      try {
        var ip = new URL(record.initiator);
        if ((ip.protocol === "http:" || ip.protocol === "https:") && ip.hostname) {
          var ih = ip.hostname, id = parseDomain(ih);
          this.addNode(id, "domain", id, 6.0);
          this.addNode(ih, "host", id, 4.0, undefined, undefined, id);
          this.addEdge(id, ih);
          this.addEdge(ih, resourceId);
        }
      } catch (e) {}
    }

    // Referer (only when no initiator)
    if (!record.initiator && record.referer) {
      try {
        var rp = new URL(record.referer);
        if ((rp.protocol === "http:" || rp.protocol === "https:") && rp.hostname) {
          var rh = rp.hostname, rd = parseDomain(rh), rr = rh + rp.pathname;
          this.addNode(rd, "domain", rd, 6.0);
          this.addNode(rh, "host", rd, 4.0, undefined, undefined, rd);
          this.addEdge(rd, rh);
          if (this.graph.hasNode(rr)) this.addEdge(rr, resourceId);
          else this.addEdge(rh, resourceId);
        }
      } catch (e) {}
    }
  };

  // ── State ──────────────────────────────────────────────────────────
  let graph = null;
  let renderer = null;
  let fa2Running = false;
  let fa2FrameId = null;
  let hoveredNode = null;
  let selectedNode = null;
  let focusSet = null;        // Set of node keys visible in focus mode
  let hiddenTypes = new Set(); // node_type values currently hidden
  let hiddenDomains = new Set();
  let hiddenContentGroups = new Set();
  let domainFilterText = "";
  let manuallyHidden = new Set(); // nodes hidden via right-click
  let showHidden = false;         // toggle to reveal manually hidden nodes
  let originalSizes = {};         // node key → original viz size
  let sizeMode = "default";       // "default" | "visited" | "visited-log"
  let liveBuilder = null;
  let livePort = null;
  let liveRefreshTimer = null;
  let liveMode = false;
  let graphGrew = false;
  let saveTimer = null;

  // ── IndexedDB persistence ─────────────────────────────────────────
  var DB_NAME = "httpgraph-viewer";
  var DB_STORE = "graph";
  var DB_KEY = "current";

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function saveGraph() {
    if (!graph || graph.order === 0) return;
    openDB().then(function (db) {
      var tx = db.transaction(DB_STORE, "readwrite");
      var data = { graph: graph.export(), originalSizes: originalSizes };
      tx.objectStore(DB_STORE).put(data, DB_KEY);
    }).catch(function () {});
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveGraph, 2000);
  }

  function loadSavedGraph() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readonly");
        var req = tx.objectStore(DB_STORE).get(DB_KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function clearSavedGraph() {
    openDB().then(function (db) {
      var tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(DB_KEY);
    }).catch(function () {});
  }

  // ── DOM refs ───────────────────────────────────────────────────────
  const fileInput = document.getElementById("file-input");
  const btnExport = document.getElementById("btn-export");
  const btnClear = document.getElementById("btn-clear");
  const graphStats = document.getElementById("graph-stats");
  const layoutSection = document.getElementById("layout-section");
  const btnFA2 = document.getElementById("btn-fa2");
  const btnCircular = document.getElementById("btn-circular");
  const btnHierarchical = document.getElementById("btn-hierarchical");
  const searchSection = document.getElementById("search-section");
  const searchInput = document.getElementById("search-input");
  const nodeList = document.getElementById("node-list");
  const focusSection = document.getElementById("focus-section");
  const hopSlider = document.getElementById("hop-slider");
  const hopValue = document.getElementById("hop-value");
  const btnFocus = document.getElementById("btn-focus");
  const filterSection = document.getElementById("filter-section");
  const typeFiltersDiv = document.getElementById("type-filters");
  const domainFilterInput = document.getElementById("domain-filter");
  const domainFiltersDiv = document.getElementById("domain-filters");
  const btnReset = document.getElementById("btn-reset");
  const infoPanel = document.getElementById("info-panel");
  const infoContent = document.getElementById("info-content");
  const tooltip = document.getElementById("tooltip");
  const contextMenu = document.getElementById("context-menu");
  const showHiddenCb = document.getElementById("show-hidden");
  const showHiddenLabel = document.getElementById("show-hidden-label");
  const hiddenCountSpan = document.getElementById("hidden-count");
  const container = document.getElementById("graph-container");
  const extIdInput = document.getElementById("ext-id");
  const btnLive = document.getElementById("btn-live");
  const liveStatus = document.getElementById("live-status");
  liveStatus.textContent = "Disconnected";
  liveStatus.className = "disconnected";

  // ── Custom hover renderer (nullphase dark theme) ───────────────────
  function drawNodeHover(context, data, settings) {
    var size = data.size;
    // Draw halo
    context.beginPath();
    context.arc(data.x, data.y, size + 2, 0, Math.PI * 2);
    context.fillStyle = "#3b82f640";
    context.fill();
    // Draw node
    context.beginPath();
    context.arc(data.x, data.y, size, 0, Math.PI * 2);
    context.fillStyle = data.color;
    context.fill();
    // Draw label with dark background
    if (data.label) {
      var fontSize = settings.labelSize || 14;
      var font = settings.labelFont || "sans-serif";
      context.font = fontSize + "px " + font;
      var textWidth = context.measureText(data.label).width;
      var x = data.x + size + 3;
      var y = data.y + fontSize / 3;
      var pad = 3;
      context.fillStyle = "#150533E0";
      context.beginPath();
      context.roundRect(x - pad, data.y - fontSize / 2 - pad, textWidth + pad * 2, fontSize + pad * 2, 3);
      context.fill();
      context.strokeStyle = "#3d1a7a";
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = "#f0e6ff";
      context.fillText(data.label, x, y);
    }
  }

  // ── GEXF Loading ───────────────────────────────────────────────────
  fileInput.addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) { loadGexf(ev.target.result); };
    reader.readAsText(file);
  });

  btnExport.addEventListener("click", function () {
    if (!graph) return;
    var gexfString = graphologyLibrary.gexf.write(graph);
    var blob = new Blob([gexfString], { type: "application/xml" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "httpgraph.gexf";
    a.click();
    URL.revokeObjectURL(url);
  });

  btnClear.addEventListener("click", function () {
    disconnectLive();
    stopFA2();
    killFA2Worker();
    if (renderer) { renderer.kill(); renderer = null; }
    graph = null;
    originalSizes = {};
    clearSavedGraph();
    graphStats.textContent = "";
    btnExport.classList.add("hidden");
    btnClear.classList.add("hidden");
    layoutSection.classList.add("hidden");
    document.getElementById("size-section").classList.add("hidden");
    searchSection.classList.add("hidden");
    focusSection.classList.add("hidden");
    filterSection.classList.add("hidden");
  });

  function initRenderer(opts) {
    opts = opts || {};
    if (renderer) { renderer.kill(); renderer = null; }

    hoveredNode = null;
    selectedNode = null;
    focusSet = null;
    hiddenTypes.clear();
    hiddenDomains.clear();
    hiddenContentGroups.clear();
    domainFilterText = "";
    manuallyHidden.clear();
    showHidden = false;
    showHiddenCb.checked = false;
    sizeMode = "default";
    updateHiddenCount();

    requestAnimationFrame(function () {
      var SigmaConstructor = typeof Sigma === "function" ? Sigma : Sigma.Sigma;
      renderer = new SigmaConstructor(graph, container, {
        nodeReducer: nodeReducer,
        edgeReducer: edgeReducer,
        allowInvalidContainer: true,
        labelRenderedSizeThreshold: 6,
        labelFont: "Oxanium, sans-serif",
        labelColor: { color: "#f0e6ff" },
        defaultEdgeColor: "#1a0a3e",
        defaultEdgeType: "arrow",
        defaultDrawNodeHover: drawNodeHover,
      });

      btnExport.classList.remove("hidden");
      btnClear.classList.remove("hidden");
      layoutSection.classList.remove("hidden");
      document.getElementById("size-section").classList.remove("hidden");
      searchSection.classList.remove("hidden");
      focusSection.classList.remove("hidden");
      filterSection.classList.remove("hidden");

      updateStats();

      setupSearch();
      setupTypeFilters();
      setupContentFilters();
      setupDomainFilters();
      setupHover();
      setupInfoPanel();
      setupContextMenu();

      if (opts.autoStartFA2 !== false && graph.order > 0) {
        initFA2Settings();
        startFA2();
      }
    });
  }

  function loadGexf(xmlString) {
    disconnectLive();
    stopFA2();
    killFA2Worker();

    graph = graphologyLibrary.gexf.parse(Graph, xmlString);

    graph.forEachNode(function (key, attrs) {
      if (attrs.type != null) {
        graph.setNodeAttribute(key, "request_type", attrs.type);
        graph.removeNodeAttribute(key, "type");
      }
      if (attrs.x == null || attrs.y == null) {
        graph.setNodeAttribute(key, "x", (Math.random() - 0.5) * 1000);
        graph.setNodeAttribute(key, "y", (Math.random() - 0.5) * 1000);
      }
      if (!attrs.color && attrs.viz && attrs.viz.color) {
        var c = attrs.viz.color;
        graph.setNodeAttribute(key, "color", "rgba(" + c.r + "," + c.g + "," + c.b + "," + (c.a != null ? c.a : 1) + ")");
      }
      if (!attrs.size && attrs.viz && attrs.viz.size) {
        graph.setNodeAttribute(key, "size", attrs.viz.size);
      }
    });

    originalSizes = {};
    graph.forEachNode(function (key, attrs) {
      originalSizes[key] = attrs.size || 3;
    });

    liveMode = false;
    initRenderer();
    scheduleSave();
  }

  // ── Node / Edge Reducers ───────────────────────────────────────────
  function isNodeHidden(key, attrs) {
    if (manuallyHidden.has(key) && !showHidden) return true;
    if (hiddenTypes.has(attrs.node_type)) return true;
    if (hiddenDomains.has(attrs.domain)) return true;
    if (hiddenContentGroups.size > 0 && attrs.node_type === "resource" && attrs.content_type) {
      if (hiddenContentGroups.has(classifyContent(attrs.content_type))) return true;
    }
    if (focusSet && !focusSet.has(key)) return true;
    return false;
  }

  function nodeReducer(key, attrs) {
    var res = Object.assign({}, attrs);

    if (isNodeHidden(key, attrs)) { res.hidden = true; return res; }
    if (manuallyHidden.has(key) && showHidden) { res.color = "#30363d"; }

    // Hover dimming
    if (hoveredNode && hoveredNode !== key && !graph.areNeighbors(hoveredNode, key)) {
      res.color = "#1c2129";
      res.label = "";
      res.zIndex = 0;
    } else if (hoveredNode && (hoveredNode === key || graph.areNeighbors(hoveredNode, key))) {
      res.highlighted = true;
      res.zIndex = 1;
    }

    // Selected highlight
    if (selectedNode === key) {
      res.highlighted = true;
      res.zIndex = 1;
    }

    return res;
  }

  function edgeReducer(edge, attrs) {
    var res = Object.assign({}, attrs);
    var source = graph.source(edge);
    var target = graph.target(edge);

    // Hide edges to manually hidden nodes
    if (!showHidden && (manuallyHidden.has(source) || manuallyHidden.has(target))) { res.hidden = true; return res; }

    // Hide edges connected to hidden nodes
    var sAttrs = graph.getNodeAttributes(source);
    var tAttrs = graph.getNodeAttributes(target);
    if (hiddenTypes.has(sAttrs.node_type) || hiddenTypes.has(tAttrs.node_type)) { res.hidden = true; return res; }
    if (hiddenDomains.has(sAttrs.domain) || hiddenDomains.has(tAttrs.domain)) { res.hidden = true; return res; }

    // Focus mode
    if (focusSet && (!focusSet.has(source) || !focusSet.has(target))) { res.hidden = true; return res; }

    // Hover dimming
    if (hoveredNode && source !== hoveredNode && target !== hoveredNode) {
      res.color = "#0d0221";
      res.zIndex = 0;
    } else if (hoveredNode) {
      res.color = "#b967ff";
      res.zIndex = 1;
    }

    return res;
  }

  // ── ForceAtlas2 ────────────────────────────────────────────────────
  var fa2Worker = null;
  var fa2NodeKeys = null;   // ordered node keys for position mapping
  var fa2UseWorker = false; // whether web worker is available
  var fa2Settings = {};     // current FA2 algorithm settings
  var fa2Iters = 5;         // iterations per tick
  var fa2SettleThreshold = 0.5; // avg displacement to go idle
  var fa2LayoutGraph = null; // filtered subgraph used for layout (visible nodes only)

  // DOM refs for FA2 settings panel
  var fa2SettingsDiv = document.getElementById("fa2-settings");
  var fa2ScalingSlider = document.getElementById("fa2-scaling");
  var fa2GravitySlider = document.getElementById("fa2-gravity");
  var fa2SlowdownSlider = document.getElementById("fa2-slowdown");
  var fa2ThetaSlider = document.getElementById("fa2-theta");
  var fa2ItersSlider = document.getElementById("fa2-iters");
  var fa2SettleSlider = document.getElementById("fa2-settle");
  var fa2SettleVal = document.getElementById("fa2-settle-val");
  var fa2BHCheck = document.getElementById("fa2-barneshut");
  var fa2SGCheck = document.getElementById("fa2-stronggrav");
  var fa2LLCheck = document.getElementById("fa2-linlog");
  var fa2ModeLabel = document.getElementById("fa2-mode");

  // CDN URLs (same as in index.html, fetched from cache for the worker)
  var CDN_GRAPHOLOGY = "https://unpkg.com/graphology@0.25.4/dist/graphology.umd.min.js";
  var CDN_LIBRARY = "https://cdn.jsdelivr.net/npm/graphology-library@0.8.0/dist/graphology-library.min.js";

  var FA2_WORKER_BODY = [
    "var Graph = typeof graphology === 'function' ? graphology : graphology.Graph;",
    "var fa2 = graphologyLibrary.layoutForceAtlas2;",
    "var graph = null, nodeKeys = [], running = false, settings = {}, iters = 5, settleThreshold = 0.5;",
    "var prevPos = null, tickCount = 0;",
    "self.onmessage = function(e) {",
    "  var m = e.data;",
    "  if (m.type === 'init') {",
    "    graph = new Graph(); graph.import(m.graph);",
    "    nodeKeys = []; graph.forEachNode(function(k) { nodeKeys.push(k); });",
    "    prevPos = null; tickCount = 0;",
    "    self.postMessage({ type: 'ready', nodeCount: nodeKeys.length });",
    "  } else if (m.type === 'start') {",
    "    settings = m.settings || settings; iters = m.iters || iters; if (m.settleThreshold != null) settleThreshold = m.settleThreshold;",
    "    running = true; runLoop();",
    "  } else if (m.type === 'stop') {",
    "    running = false;",
    "  } else if (m.type === 'settings') {",
    "    settings = m.settings || settings; iters = m.iters || iters; if (m.settleThreshold != null) settleThreshold = m.settleThreshold;",
    "  } else if (m.type === 'resume') {",
    "    if (!running) { running = true; runLoop(); }",
    "  }",
    "};",
    "function runLoop() {",
    "  if (!running) return;",
    "  tickCount++;",
    "  fa2.assign(graph, { iterations: iters, settings: settings });",
    "  var buf = new Float64Array(nodeKeys.length * 2);",
    "  var totalDisp = 0;",
    "  for (var i = 0; i < nodeKeys.length; i++) {",
    "    var a = graph.getNodeAttributes(nodeKeys[i]);",
    "    buf[i * 2] = a.x; buf[i * 2 + 1] = a.y;",
    "    if (prevPos) {",
    "      var dx = a.x - prevPos[i * 2], dy = a.y - prevPos[i * 2 + 1];",
    "      totalDisp += Math.sqrt(dx * dx + dy * dy);",
    "    }",
    "  }",
    "  var avgDisp = nodeKeys.length > 0 ? totalDisp / nodeKeys.length : 0;",
    "  prevPos = new Float64Array(buf);",
    "  self.postMessage({ type: 'positions', buffer: buf.buffer, avgDisp: avgDisp }, [buf.buffer]);",
    "  if (prevPos && tickCount > 50 && avgDisp < settleThreshold) {",
    "    running = false;",
    "    self.postMessage({ type: 'idle' });",
    "    return;",
    "  }",
    "  setTimeout(runLoop, 0);",
    "}"
  ].join("\n");

  // Check whether a node is currently hidden by any filter
  function isNodeHidden(key) {
    if (manuallyHidden.has(key) && !showHidden) return true;
    var attrs = graph.getNodeAttributes(key);
    if (hiddenTypes.has(attrs.node_type)) return true;
    if (hiddenDomains.has(attrs.domain)) return true;
    if (hiddenContentGroups.size > 0 && attrs.node_type === "resource" && attrs.content_type) {
      if (hiddenContentGroups.has(classifyContent(attrs.content_type))) return true;
    }
    if (focusSet && !focusSet.has(key)) return true;
    return false;
  }

  // Build a subgraph containing only visible nodes for layout
  function buildLayoutGraph() {
    var lg = new Graph();
    graph.forEachNode(function (key, attrs) {
      if (!isNodeHidden(key)) {
        lg.addNode(key, { x: attrs.x, y: attrs.y, size: attrs.size });
      }
    });
    graph.forEachEdge(function (edge, attrs, source, target) {
      if (lg.hasNode(source) && lg.hasNode(target) && !lg.hasEdge(source, target)) {
        lg.addEdge(source, target, { weight: attrs.weight || 1 });
      }
    });
    return lg;
  }

  // Copy positions from layout graph back to main graph
  function applyLayoutPositions(lg) {
    lg.forEachNode(function (key, attrs) {
      graph.mergeNodeAttributes(key, { x: attrs.x, y: attrs.y });
    });
  }

  // Try to create web worker by fetching CDN libs and inlining them
  async function createFA2Worker() {
    try {
      var codes = await Promise.all([
        fetch(CDN_GRAPHOLOGY).then(function (r) { return r.text(); }),
        fetch(CDN_LIBRARY).then(function (r) { return r.text(); })
      ]);
      // Stub DOM APIs — graphology-library's GEXF/GraphML parsers reference
      // these at init time but the worker never uses them
      var domStub = [
        "if(typeof DOMParser==='undefined'){var DOMParser=function(){};DOMParser.prototype.parseFromString=function(){return {};};}",
        "if(typeof Document==='undefined'){var Document=function(){};}",
        "if(typeof Node==='undefined'){var Node={ELEMENT_NODE:1,TEXT_NODE:3};}",
        "if(typeof XMLSerializer==='undefined'){var XMLSerializer=function(){};XMLSerializer.prototype.serializeToString=function(){return '';};}",
        "if(typeof document==='undefined'){var document={createElementNS:function(){return {}},implementation:{createDocument:function(){return {}}}};}",
      ].join("\n") + "\n";
      var blob = new Blob([domStub, codes[0], "\n", codes[1], "\n", FA2_WORKER_BODY], { type: "application/javascript" });
      var worker = new Worker(URL.createObjectURL(blob));
      return worker;
    } catch (e) {
      console.warn("FA2 web worker creation failed, using main thread:", e);
      return null;
    }
  }

  function initFA2Settings() {
    var inferred = graphologyLibrary.layoutForceAtlas2.inferSettings(graph);
    fa2Settings = {
      scalingRatio: inferred.scalingRatio || 10,
      gravity: inferred.gravity || 0.05,
      slowDown: inferred.slowDown || 1,
      barnesHutOptimize: inferred.barnesHutOptimize !== false,
      barnesHutTheta: inferred.barnesHutTheta || 0.5,
      strongGravityMode: inferred.strongGravityMode || false,
      linLogMode: inferred.linLogMode || false,
      adjustSizes: false,
      outboundAttractionDistribution: false,
    };
    fa2Iters = 5;

    // Sync sliders to inferred values
    fa2ScalingSlider.value = fa2Settings.scalingRatio;
    fa2GravitySlider.value = Math.round(fa2Settings.gravity * 100);
    fa2SlowdownSlider.value = Math.round(fa2Settings.slowDown);
    fa2ThetaSlider.value = Math.round(fa2Settings.barnesHutTheta * 10);
    fa2ItersSlider.value = fa2Iters;
    fa2BHCheck.checked = fa2Settings.barnesHutOptimize;
    fa2SGCheck.checked = fa2Settings.strongGravityMode;
    fa2LLCheck.checked = fa2Settings.linLogMode;
    updateFA2Labels();
  }

  function updateFA2Labels() {
    document.getElementById("fa2-scaling-val").textContent = fa2ScalingSlider.value;
    document.getElementById("fa2-gravity-val").textContent = (fa2GravitySlider.value / 100).toFixed(2);
    document.getElementById("fa2-slowdown-val").textContent = fa2SlowdownSlider.value;
    document.getElementById("fa2-theta-val").textContent = (fa2ThetaSlider.value / 10).toFixed(1);
    document.getElementById("fa2-iters-val").textContent = fa2ItersSlider.value;
    fa2SettleVal.textContent = Number(fa2SettleSlider.value).toFixed(1);
  }

  function readFA2Settings() {
    fa2Settings.scalingRatio = Number(fa2ScalingSlider.value);
    fa2Settings.gravity = Number(fa2GravitySlider.value) / 100;
    fa2Settings.slowDown = Number(fa2SlowdownSlider.value);
    fa2Settings.barnesHutTheta = Number(fa2ThetaSlider.value) / 10;
    fa2Settings.barnesHutOptimize = fa2BHCheck.checked;
    fa2Settings.strongGravityMode = fa2SGCheck.checked;
    fa2Settings.linLogMode = fa2LLCheck.checked;
    fa2Iters = Number(fa2ItersSlider.value);
    fa2SettleThreshold = Number(fa2SettleSlider.value);
    updateFA2Labels();
  }

  // Push settings to worker (if running in worker mode)
  function pushFA2Settings() {
    readFA2Settings();
    if (fa2Running && fa2UseWorker && fa2Worker) {
      fa2Worker.postMessage({ type: "settings", settings: fa2Settings, iters: fa2Iters, settleThreshold: fa2SettleThreshold });
    }
  }

  // Bind all FA2 settings controls
  [fa2ScalingSlider, fa2GravitySlider, fa2SlowdownSlider, fa2ThetaSlider, fa2ItersSlider, fa2SettleSlider].forEach(function (el) {
    el.addEventListener("input", pushFA2Settings);
  });
  [fa2BHCheck, fa2SGCheck, fa2LLCheck].forEach(function (el) {
    el.addEventListener("change", pushFA2Settings);
  });

  async function startFA2() {
    if (fa2Running || !graph) return;
    fa2Running = true;
    btnFA2.textContent = "Stop ForceAtlas2";
    btnFA2.classList.add("active");
    fa2SettingsDiv.classList.remove("hidden");

    readFA2Settings();

    // Build filtered layout graph (visible nodes only)
    fa2LayoutGraph = buildLayoutGraph();
    if (fa2LayoutGraph.order === 0) {
      fa2Running = false;
      btnFA2.textContent = "Start ForceAtlas2";
      btnFA2.classList.remove("active");
      return;
    }

    // Try web worker first
    if (!fa2Worker) {
      fa2Worker = await createFA2Worker();
    }

    if (fa2Worker) {
      fa2UseWorker = true;
      fa2ModeLabel.textContent = "web worker";

      // Build ordered key list matching worker iteration order
      fa2NodeKeys = [];
      fa2LayoutGraph.forEachNode(function (k) { fa2NodeKeys.push(k); });

      // Send filtered graph to worker
      fa2Worker.postMessage({ type: "init", graph: fa2LayoutGraph.export() });

      fa2Worker.onmessage = function (e) {
        if (e.data.type === "ready") {
          fa2Worker.postMessage({ type: "start", settings: fa2Settings, iters: fa2Iters, settleThreshold: fa2SettleThreshold });
        } else if (e.data.type === "positions") {
          var buf = new Float64Array(e.data.buffer);
          for (var i = 0; i < fa2NodeKeys.length; i++) {
            graph.mergeNodeAttributes(fa2NodeKeys[i], {
              x: buf[i * 2], y: buf[i * 2 + 1]
            });
          }
          if (renderer) renderer.refresh();
        } else if (e.data.type === "idle") {
          fa2Idle = true;
          fa2Running = false;
          killFA2Worker();
          fa2LayoutGraph = null;
          btnFA2.textContent = "Start ForceAtlas2";
          btnFA2.classList.remove("active");
          fa2ModeLabel.textContent = "idle — settled";
          fa2SettingsDiv.classList.remove("hidden");
        }
      };
    } else {
      // Fallback: synchronous batched FA2
      fa2UseWorker = false;
      fa2ModeLabel.textContent = "main thread";
      runFA2Sync();
    }
  }

  function stopFA2() {
    fa2Running = false;
    fa2Idle = false;
    if (fa2Worker && fa2UseWorker) {
      fa2Worker.postMessage({ type: "stop" });
    }
    if (fa2FrameId) { cancelAnimationFrame(fa2FrameId); fa2FrameId = null; }
    fa2LayoutGraph = null;
    btnFA2.textContent = "Start ForceAtlas2";
    btnFA2.classList.remove("active");
    fa2SettingsDiv.classList.add("hidden");
  }

  function killFA2Worker() {
    if (fa2Worker) { fa2Worker.terminate(); fa2Worker = null; }
    fa2UseWorker = false;
  }

  // Restart FA2 with updated filter state (rebuild layout graph)
  var fa2Idle = false;

  function restartFA2IfRunning() {
    if (!fa2Running && !fa2Idle) return;
    fa2Idle = false;
    stopFA2();
    killFA2Worker();
    startFA2();
  }

  // Synchronous fallback — runs on filtered layout graph
  function runFA2Sync() {
    if (!fa2Running || fa2UseWorker || !fa2LayoutGraph) return;
    readFA2Settings();
    graphologyLibrary.layoutForceAtlas2.assign(fa2LayoutGraph, { iterations: fa2Iters, settings: fa2Settings });
    applyLayoutPositions(fa2LayoutGraph);
    if (renderer) renderer.refresh();
    fa2FrameId = requestAnimationFrame(runFA2Sync);
  }

  btnFA2.addEventListener("click", function () {
    if (fa2Running) stopFA2(); else startFA2();
  });

  // ── Node Sizing ──────────────────────────────────────────────────
  var btnSizeDefault = document.getElementById("btn-size-default");
  var btnSizeVisited = document.getElementById("btn-size-visited");
  var btnSizeVisitedLog = document.getElementById("btn-size-visited-log");
  var sizeRangeDiv = document.getElementById("size-range");
  var sizeMinSlider = document.getElementById("size-min");
  var sizeMaxSlider = document.getElementById("size-max");
  var sizeMinVal = document.getElementById("size-min-val");
  var sizeMaxVal = document.getElementById("size-max-val");
  var sizeMultSlider = document.getElementById("size-mult");
  var sizeMultVal = document.getElementById("size-mult-val");

  function applySizeMode() {
    if (!graph) return;
    var minSize = Number(sizeMinSlider.value);
    var maxSize = Number(sizeMaxSlider.value);
    var mult = Number(sizeMultSlider.value);
    sizeMinVal.textContent = minSize;
    sizeMaxVal.textContent = maxSize;
    sizeMultVal.textContent = mult.toFixed(1);

    [btnSizeDefault, btnSizeVisited, btnSizeVisitedLog].forEach(function (b) { b.classList.remove("active"); });

    if (sizeMode === "default") {
      btnSizeDefault.classList.add("active");
      sizeRangeDiv.classList.add("hidden");
      graph.forEachNode(function (key) {
        graph.setNodeAttribute(key, "size", originalSizes[key] * mult);
      });
    } else {
      (sizeMode === "visited" ? btnSizeVisited : btnSizeVisitedLog).classList.add("active");
      sizeRangeDiv.classList.remove("hidden");

      // Find visited range
      var maxVisited = 1;
      graph.forEachNode(function (key, attrs) {
        var v = Number(attrs.visited) || 1;
        if (v > maxVisited) maxVisited = v;
      });

      var useLog = sizeMode === "visited-log";
      var logMax = useLog ? Math.log1p(maxVisited) : maxVisited;

      graph.forEachNode(function (key, attrs) {
        var v = Number(attrs.visited) || 1;
        var norm = logMax > 1 ? (useLog ? Math.log1p(v) : v) / logMax : 0;
        graph.setNodeAttribute(key, "size", (minSize + norm * (maxSize - minSize)) * mult);
      });
    }
    if (renderer) renderer.refresh();
  }

  btnSizeDefault.addEventListener("click", function () { sizeMode = "default"; applySizeMode(); });
  btnSizeVisited.addEventListener("click", function () { sizeMode = "visited"; applySizeMode(); });
  btnSizeVisitedLog.addEventListener("click", function () { sizeMode = "visited-log"; applySizeMode(); });
  sizeMinSlider.addEventListener("input", applySizeMode);
  sizeMaxSlider.addEventListener("input", applySizeMode);
  sizeMultSlider.addEventListener("input", applySizeMode);

  // ── Circular Layout ────────────────────────────────────────────────
  btnCircular.addEventListener("click", function () {
    if (!graph) return;
    stopFA2();
    killFA2Worker();

    // Sort nodes by domain then type for grouped circular layout
    var nodes = [];
    graph.forEachNode(function (key, attrs) {
      nodes.push({ key: key, domain: attrs.domain || "", type: attrs.node_type || "" });
    });
    nodes.sort(function (a, b) {
      var d = a.domain.localeCompare(b.domain);
      return d !== 0 ? d : a.type.localeCompare(b.type);
    });

    var n = nodes.length;
    for (var i = 0; i < n; i++) {
      var angle = (2 * Math.PI * i) / n;
      var radius = 500;
      graph.setNodeAttribute(nodes[i].key, "x", radius * Math.cos(angle));
      graph.setNodeAttribute(nodes[i].key, "y", radius * Math.sin(angle));
    }
    if (renderer) renderer.refresh();
  });

  // ── Hierarchical Layout ────────────────────────────────────────────
  var TYPE_DEPTH = { client: 0, domain: 1, host: 2, resource: 3, ip: 4, params: 4 };

  btnHierarchical.addEventListener("click", function () {
    if (!graph) return;
    stopFA2();
    killFA2Worker();

    // Group nodes by depth level
    var levels = {};
    graph.forEachNode(function (key, attrs) {
      var depth = TYPE_DEPTH[attrs.node_type] != null ? TYPE_DEPTH[attrs.node_type] : 3;
      if (!levels[depth]) levels[depth] = [];
      levels[depth].push(key);
    });

    // Sort within each level by domain for coherent grouping
    Object.keys(levels).forEach(function (d) {
      levels[d].sort(function (a, b) {
        var da = graph.getNodeAttribute(a, "domain") || "";
        var db = graph.getNodeAttribute(b, "domain") || "";
        return da.localeCompare(db);
      });
    });

    // Assign positions: y by depth, x spread evenly
    var ySpacing = 200;
    Object.keys(levels).forEach(function (d) {
      var nodes = levels[d];
      var totalWidth = nodes.length * 40;
      for (var i = 0; i < nodes.length; i++) {
        graph.setNodeAttribute(nodes[i], "x", -totalWidth / 2 + i * 40);
        graph.setNodeAttribute(nodes[i], "y", d * ySpacing);
      }
    });

    if (renderer) renderer.refresh();
  });

  // ── Search ─────────────────────────────────────────────────────────
  var labelMap = {};

  function setupSearch() {
    // Build datalist
    nodeList.innerHTML = "";
    labelMap = {};
    graph.forEachNode(function (key, attrs) {
      var opt = document.createElement("option");
      opt.value = attrs.label || key;
      opt.dataset.key = key;
      nodeList.appendChild(opt);
      labelMap[attrs.label || key] = key;
    });
    searchInput.value = "";
  }

  searchInput.addEventListener("input", function () {
    if (!graph || !renderer) return;
    var val = searchInput.value;
    var nodeKey = labelMap[val];
    if (!nodeKey) {
      if (graph.hasNode(val)) nodeKey = val;
    }
    if (nodeKey) {
      selectedNode = nodeKey;
      var pos = renderer.getNodeDisplayData(nodeKey);
      if (pos) {
        renderer.getCamera().animate(
          { x: pos.x, y: pos.y, ratio: 0.3 },
          { duration: 400 }
        );
      }
      renderer.refresh();
      showNodeInfo(nodeKey);
    }
  });

  // ── Focus ──────────────────────────────────────────────────────────
  hopSlider.addEventListener("input", function () {
    hopValue.textContent = hopSlider.value;
  });

  btnFocus.addEventListener("click", function () {
    if (!selectedNode || !graph) return;
    var maxHops = parseInt(hopSlider.value, 10);
    setFocus(selectedNode, maxHops);
  });

  function setFocus(nodeKey, maxHops) {
    focusSet = new Set();
    var queue = [{ node: nodeKey, depth: 0 }];
    focusSet.add(nodeKey);

    while (queue.length > 0) {
      var current = queue.shift();
      if (current.depth >= maxHops) continue;
      // Traverse both directions (undirected neighborhood)
      graph.forEachNeighbor(current.node, function (neighbor) {
        if (!focusSet.has(neighbor)) {
          focusSet.add(neighbor);
          queue.push({ node: neighbor, depth: current.depth + 1 });
        }
      });
    }

    if (renderer) renderer.refresh();
    restartFA2IfRunning();
  }

  // ── Type Filters ───────────────────────────────────────────────────
  var TYPE_COLORS = {
    client: "#ececec", domain: "#e94560", host: "#0f3460",
    resource: "#53a8b6", ip: "#f5a623", params: "#7b68ee"
  };

  function setupTypeFilters() {
    typeFiltersDiv.innerHTML = "";
    var types = new Set();
    graph.forEachNode(function (key, attrs) { if (attrs.node_type) types.add(attrs.node_type); });

    types.forEach(function (type) {
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !hiddenTypes.has(type);
      cb.dataset.type = type;
      var swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = TYPE_COLORS[type] || "#888";
      label.appendChild(cb);
      label.appendChild(swatch);
      label.appendChild(document.createTextNode(" " + type));
      typeFiltersDiv.appendChild(label);

      cb.addEventListener("change", function () {
        if (cb.checked) {
          hiddenTypes.delete(type);
        } else {
          hiddenTypes.add(type);
        }
        updateStats();
        if (renderer) renderer.refresh();
        restartFA2IfRunning();
      });
    });
  }

  // ── Content Group Filters ──────────────────────────────────────────
  var CONTENT_GROUPS = {
    "Scripts":    [/javascript/, /ecmascript/],
    "Styles":     [/css/],
    "Documents":  [/html/, /xhtml/],
    "Data":       [/json/, /xml/, /protobuf/, /graphql/],
    "Images":     [/image\//],
    "Fonts":      [/font\//, /woff/, /ttf/, /otf/],
    "Media":      [/video\//, /audio\//],
    "WASM":       [/wasm/],
  };

  function classifyContent(contentType) {
    if (!contentType) return "Unknown";
    var ct = contentType.toLowerCase().split(";")[0].trim();
    for (var group in CONTENT_GROUPS) {
      for (var i = 0; i < CONTENT_GROUPS[group].length; i++) {
        if (CONTENT_GROUPS[group][i].test(ct)) return group;
      }
    }
    return "Other";
  }

  var contentFiltersDiv = document.getElementById("content-filters");

  function setupContentFilters() {
    contentFiltersDiv.innerHTML = "";
    var groups = new Set();
    graph.forEachNode(function (key, attrs) {
      if (attrs.node_type === "resource" && attrs.content_type) {
        groups.add(classifyContent(attrs.content_type));
      }
    });

    var sorted = Array.from(groups).sort();
    sorted.forEach(function (group) {
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !hiddenContentGroups.has(group);
      cb.dataset.contentGroup = group;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + group));
      contentFiltersDiv.appendChild(label);

      cb.addEventListener("change", function () {
        if (cb.checked) {
          hiddenContentGroups.delete(group);
        } else {
          hiddenContentGroups.add(group);
        }
        updateStats();
        if (renderer) renderer.refresh();
        restartFA2IfRunning();
      });
    });
  }

  // ── Domain Filters ─────────────────────────────────────────────────
  function setupDomainFilters() {
    domainFiltersDiv.innerHTML = "";
    var domains = new Set();
    graph.forEachNode(function (key, attrs) { if (attrs.domain) domains.add(attrs.domain); });

    var sortedDomains = Array.from(domains).sort();
    sortedDomains.forEach(function (domain) {
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !hiddenDomains.has(domain);
      cb.dataset.domain = domain;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + domain));
      label.dataset.domain = domain;
      if (domainFilterText && !domain.toLowerCase().includes(domainFilterText)) {
        label.style.display = "none";
      }
      domainFiltersDiv.appendChild(label);

      cb.addEventListener("change", function () {
        if (cb.checked) {
          hiddenDomains.delete(domain);
        } else {
          hiddenDomains.add(domain);
        }
        updateStats();
        if (renderer) renderer.refresh();
        restartFA2IfRunning();
      });
    });
  }

  domainFilterInput.addEventListener("input", function () {
    domainFilterText = domainFilterInput.value.toLowerCase();
    var labels = domainFiltersDiv.querySelectorAll("label");
    labels.forEach(function (lbl) {
      var d = lbl.dataset.domain || "";
      lbl.style.display = d.toLowerCase().includes(domainFilterText) ? "" : "none";
    });
  });

  // ── Reset ──────────────────────────────────────────────────────────
  btnReset.addEventListener("click", function () {
    focusSet = null;
    hiddenTypes.clear();
    hiddenDomains.clear();
    hiddenContentGroups.clear();
    manuallyHidden.clear();
    showHidden = false;
    showHiddenCb.checked = false;
    updateHiddenCount();
    selectedNode = null;
    domainFilterInput.value = "";
    domainFilterText = "";
    searchInput.value = "";

    // Re-check all type checkboxes
    typeFiltersDiv.querySelectorAll("input").forEach(function (cb) { cb.checked = true; });
    contentFiltersDiv.querySelectorAll("input").forEach(function (cb) { cb.checked = true; });
    domainFiltersDiv.querySelectorAll("input").forEach(function (cb) { cb.checked = true; });
    domainFiltersDiv.querySelectorAll("label").forEach(function (lbl) { lbl.style.display = ""; });

    infoPanel.classList.add("hidden");
    updateStats();
    if (renderer) {
      renderer.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 300 });
      renderer.refresh();
    }
    restartFA2IfRunning();
  });

  // ── Hover ──────────────────────────────────────────────────────────
  // Tooltip follows cursor (one-time listener on container)
  container.addEventListener("mousemove", function (e) {
    if (hoveredNode) {
      tooltip.style.left = (e.clientX + 12) + "px";
      tooltip.style.top = (e.clientY + 12) + "px";
    }
  });

  function setupHover() {
    renderer.on("enterNode", function (payload) {
      hoveredNode = payload.node;
      container.style.cursor = "pointer";
      showTooltip(payload.node, payload.event);
      renderer.refresh();
    });

    renderer.on("leaveNode", function () {
      hoveredNode = null;
      container.style.cursor = "default";
      tooltip.classList.add("hidden");
      renderer.refresh();
    });
  }

  function showTooltip(nodeKey, event) {
    var attrs = graph.getNodeAttributes(nodeKey);
    var html = '<div class="tt-label">' + escapeHtml(attrs.label || nodeKey) + '</div>';

    var fields = ["node_type", "domain", "method", "protocol", "status_code", "content_type", "request_type", "bytes", "duration_ms"];
    fields.forEach(function (f) {
      if (attrs[f] != null && attrs[f] !== "") {
        html += '<div class="tt-row"><span class="tt-key">' + f + ':</span> ' + escapeHtml(String(attrs[f])) + '</div>';
      }
    });

    tooltip.innerHTML = html;
    tooltip.classList.remove("hidden");

    // Position near cursor
    var origEvent = event && (event.originalEvent || event.original);
    if (origEvent) {
      tooltip.style.left = (origEvent.clientX + 12) + "px";
      tooltip.style.top = (origEvent.clientY + 12) + "px";
    }
  }

  // ── Info Panel ─────────────────────────────────────────────────────
  function setupInfoPanel() {
    renderer.on("clickNode", function (event) {
      selectedNode = event.node;
      showNodeInfo(event.node);
      renderer.refresh();
    });

    renderer.on("clickStage", function () {
      selectedNode = null;
      infoPanel.classList.add("hidden");
      renderer.refresh();
    });
  }

  function showNodeInfo(nodeKey) {
    var attrs = graph.getNodeAttributes(nodeKey);
    var html = '<div class="info-row"><span class="attr-key">id</span><span class="attr-val">' + escapeHtml(nodeKey) + '</span></div>';

    var skip = new Set(["x", "y", "z", "size", "color", "viz", "hidden", "highlighted", "zIndex"]);
    Object.keys(attrs).forEach(function (k) {
      if (skip.has(k)) return;
      if (attrs[k] == null || attrs[k] === "") return;
      if (typeof attrs[k] === "object") return;
      html += '<div class="info-row"><span class="attr-key">' + escapeHtml(k) + '</span><span class="attr-val">' + escapeHtml(String(attrs[k])) + '</span></div>';
    });

    // Show neighbor count
    var neighbors = graph.neighbors(nodeKey).length;
    var inDeg = graph.inDegree(nodeKey);
    var outDeg = graph.outDegree(nodeKey);
    html += '<div class="info-row"><span class="attr-key">connections</span><span class="attr-val">' + neighbors + ' (in:' + inDeg + ' out:' + outDeg + ')</span></div>';

    infoContent.innerHTML = html;
    infoPanel.classList.remove("hidden");
  }

  // ── Context Menu (right-click) ──────────────────────────────────
  var contextTarget = null;

  function setupContextMenu() {
    renderer.on("rightClickNode", function (payload) {
      payload.event.original.preventDefault();
      contextTarget = payload.node;
      var attrs = graph.getNodeAttributes(payload.node);
      var isHidden = manuallyHidden.has(payload.node);
      contextMenu.innerHTML =
        '<div class="menu-label">' + escapeHtml(attrs.label || payload.node) + '</div>' +
        '<div class="menu-item" data-action="' + (isHidden ? "unhide" : "hide") + '">' +
          (isHidden ? "Unhide node" : "Hide node") +
        '</div>' +
        '<div class="menu-item" data-action="hide-neighbors">Hide neighbors</div>';
      contextMenu.classList.remove("hidden");
      contextMenu.style.left = payload.event.original.clientX + "px";
      contextMenu.style.top = payload.event.original.clientY + "px";
    });
  }

  // Dismiss context menu on any click
  document.addEventListener("click", function () {
    contextMenu.classList.add("hidden");
    contextTarget = null;
  });

  // Suppress browser context menu on the graph container
  container.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  // Handle menu item clicks
  contextMenu.addEventListener("click", function (e) {
    var item = e.target.closest(".menu-item");
    if (!item || !contextTarget) return;
    var action = item.dataset.action;

    if (action === "hide") {
      manuallyHidden.add(contextTarget);
    } else if (action === "unhide") {
      manuallyHidden.delete(contextTarget);
    } else if (action === "hide-neighbors") {
      graph.forEachNeighbor(contextTarget, function (neighbor) {
        manuallyHidden.add(neighbor);
      });
    }

    updateHiddenCount();
    contextMenu.classList.add("hidden");
    contextTarget = null;
    if (renderer) renderer.refresh();
    restartFA2IfRunning();
  });

  // Show/hide hidden nodes toggle
  showHiddenCb.addEventListener("change", function () {
    showHidden = showHiddenCb.checked;
    if (renderer) renderer.refresh();
    restartFA2IfRunning();
  });

  function updateHiddenCount() {
    hiddenCountSpan.textContent = manuallyHidden.size;
    if (manuallyHidden.size > 0) {
      showHiddenLabel.classList.remove("hidden");
    } else {
      showHiddenLabel.classList.add("hidden");
    }
  }

  function updateStats() {
    if (!graph) { graphStats.textContent = ""; return; }
    var total = graph.order;
    var visible = 0;
    graph.forEachNode(function (key, attrs) {
      if (!isNodeHidden(key, attrs)) visible++;
    });
    if (visible === total) {
      graphStats.textContent = total + " nodes, " + graph.size + " edges";
    } else {
      graphStats.textContent = visible + " / " + total + " nodes, " + graph.size + " edges";
    }
  }

  // ── Live Mode ────────────────────────────────────────────────────
  extIdInput.value = localStorage.getItem("httpgraph-ext-id") || "";

  function connectLive(extId) {
    if (!extId) {
      liveStatus.textContent = "Enter extension ID";
      liveStatus.className = "error";
      return;
    }
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.connect) {
      liveStatus.textContent = "chrome.runtime unavailable — serve via localhost";
      liveStatus.className = "error";
      return;
    }

    localStorage.setItem("httpgraph-ext-id", extId);

    disconnectLive();
    stopFA2();
    killFA2Worker();

    // Reuse existing graph if one is loaded (e.g. from GEXF), otherwise create new
    if (!graph) {
      graph = new Graph();
      originalSizes = {};
    }
    liveBuilder = new LiveGraphBuilder(graph);
    liveMode = true;

    try {
      livePort = chrome.runtime.connect(extId, { name: "httpgraph-viewer" });
    } catch (e) {
      liveStatus.textContent = "Failed: " + e.message;
      liveStatus.className = "error";
      liveMode = false;
      return;
    }

    livePort.onMessage.addListener(function (msg) {
      var before = graph.order;
      liveBuilder.processRecord(msg);
      if (graph.order > before && msg.url) {
        try {
          var p = new URL(msg.url);
          var rid = p.hostname + p.pathname;
          if (graph.hasNode(rid) && !isNodeHidden(rid, graph.getNodeAttributes(rid)))
            graphGrew = true;
        } catch (e) {}
      }
      scheduleLiveRefresh();
    });

    livePort.onDisconnect.addListener(function () {
      var err = chrome.runtime && chrome.runtime.lastError;
      liveStatus.textContent = err ? "Disconnected: " + err.message : "Disconnected";
      liveStatus.className = "disconnected";
      btnLive.textContent = "Connect";
      btnLive.classList.remove("active");
      livePort = null;
      liveMode = false;
    });

    liveStatus.textContent = "Connected";
    liveStatus.className = "connected";
    btnLive.textContent = "Disconnect";
    btnLive.classList.add("active");

    // Only create renderer if one doesn't exist (graph already loaded)
    if (!renderer) {
      initRenderer({ autoStartFA2: false });
    }

  }

  function disconnectLive() {
    if (livePort) {
      livePort.disconnect();
      livePort = null;
    }
    liveMode = false;
    if (liveRefreshTimer) {
      clearTimeout(liveRefreshTimer);
      liveRefreshTimer = null;
    }
  }

  function scheduleLiveRefresh() {
    if (liveRefreshTimer) return;
    liveRefreshTimer = setTimeout(function () {
      liveRefreshTimer = null;
      updateStats();
      if (renderer) {
        setupSearch();
        setupTypeFilters();
        setupContentFilters();
        setupDomainFilters();
        renderer.refresh();
      }
      // Wake FA2 only if new nodes were actually added
      if (fa2Idle && graphGrew) {
        restartFA2IfRunning();
      }
      graphGrew = false;
      scheduleSave();
    }, 100);
  }

  btnLive.addEventListener("click", function () {
    if (livePort) {
      disconnectLive();
      liveStatus.textContent = "Disconnected";
      liveStatus.className = "disconnected";
      btnLive.textContent = "Connect";
      btnLive.classList.remove("active");
    } else {
      connectLive(extIdInput.value.trim());
    }
  });

  // ── Auto-restore saved graph ──────────────────────────────────────
  loadSavedGraph().then(function (data) {
    if (data && data.graph) {
      graph = new Graph();
      graph.import(data.graph);
      originalSizes = data.originalSizes || {};
      graph.forEachNode(function (key, attrs) {
        if (originalSizes[key] == null) originalSizes[key] = attrs.size || 3;
      });
      initRenderer();
    }
  }).catch(function () {}).finally(function () {
    // Auto-connect if extension ID is saved (delay for chrome.runtime availability)
    var savedId = extIdInput.value.trim();
    if (savedId) {
      setTimeout(function () { connectLive(savedId); }, 500);
    }
  });

  // ── UI Tooltips ──────────────────────────────────────────────────
  (function () {
    var tip = document.getElementById("ui-tip");
    var showTimer = null;
    var current = null;

    function show(el) {
      tip.textContent = el.getAttribute("data-tip");
      var r = el.getBoundingClientRect();
      var x = r.left;
      var y = r.bottom + 6;
      // Keep within viewport
      tip.style.left = "0px";
      tip.style.top = "0px";
      tip.classList.add("visible");
      var tw = tip.offsetWidth;
      var th = tip.offsetHeight;
      if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
      if (x < 4) x = 4;
      if (y + th > window.innerHeight - 8) y = r.top - th - 6; // flip above
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    }

    function hide() {
      clearTimeout(showTimer);
      showTimer = null;
      current = null;
      tip.classList.remove("visible");
    }

    document.addEventListener("mouseover", function (e) {
      var el = e.target.closest("[data-tip]");
      if (!el || el === current) return;
      hide();
      current = el;
      showTimer = setTimeout(function () { show(el); }, 400);
    });

    document.addEventListener("mouseout", function (e) {
      var el = e.target.closest("[data-tip]");
      if (el && el === current) hide();
    });

    document.addEventListener("mousedown", function () { hide(); });
    document.addEventListener("scroll", function () { hide(); }, true);
  })();

  // ── Util ───────────────────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
})();
