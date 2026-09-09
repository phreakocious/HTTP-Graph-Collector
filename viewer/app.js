(function () {
  "use strict";

  // graphology UMD exports the Graph constructor directly as the global
  const Graph = typeof graphology === "function" ? graphology : graphology.Graph;

  let theme = {};
  function initTheme() {
    var style = getComputedStyle(document.documentElement);
    theme = {
      bgPage: style.getPropertyValue('--bg-page').trim() || "#0d0221",
      bgCard: style.getPropertyValue('--bg-card').trim() || "#150533",
      border: style.getPropertyValue('--border').trim() || "#3d1a7a",
      textPrimary: style.getPropertyValue('--text-primary').trim() || "#f0e6ff",
      textSecondary: style.getPropertyValue('--text-secondary').trim() || "#b8a0d4",
      textMuted: style.getPropertyValue('--text-muted').trim() || "#7a5fa0",
      accentPink: style.getPropertyValue('--accent-pink').trim() || "#ff71ce",
      accentCyan: style.getPropertyValue('--accent-cyan').trim() || "#01cdfe",
      accentViolet: style.getPropertyValue('--accent-violet').trim() || "#b967ff",
      accentYellow: style.getPropertyValue('--accent-yellow').trim() || "#fffb96",
      accentMint: style.getPropertyValue('--accent-mint').trim() || "#05ffa1",
      red: style.getPropertyValue('--red').trim() || "#ef4444",
    };
  }
  initTheme();

  // ── Live Graph Builder ───────────────────────────────────────────
  var PALETTE_GRADIENT = [
    [0, 240, 255],    // Cyan
    [45, 120, 255],   // Blue
    [138, 43, 226],   // Purple
    [255, 0, 128],    // Pink
    [255, 80, 0],     // Orange
    [255, 215, 0]     // Yellow
  ];

  function interpolateColor(color1, color2, factor) {
    return [
      Math.round(color1[0] + factor * (color2[0] - color1[0])),
      Math.round(color1[1] + factor * (color2[1] - color1[1])),
      Math.round(color1[2] + factor * (color2[2] - color1[2]))
    ];
  }

  function getGradientColor(t) {
    var segments = PALETTE_GRADIENT.length - 1;
    var scaled = t * segments;
    var index = Math.floor(scaled);
    var factor = scaled - index;
    if (index >= segments) return PALETTE_GRADIENT[segments];
    return interpolateColor(PALETTE_GRADIENT[index], PALETTE_GRADIENT[index + 1], factor);
  }

  function stringToColor(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    var t = Math.abs(hash % 1000) / 1000;
    return getGradientColor(t);
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

  var COLOR_LOCALDOMAIN = [0, 255, 204]; // Neon Mint
  var COLOR_DEFAULT = [113, 10, 255]; // Electric Purple
  var MAXLABEL = 32;

  function LiveGraphBuilder(g) {
    this.graph = g;
    this.colormap = {};
    this.edgeWeights = {};
  }

  LiveGraphBuilder.prototype.assignColor = function (domain) {
    if (!this.colormap[domain]) {
      this.colormap[domain] = stringToColor(domain);
    }
    return this.colormap[domain];
  };

  LiveGraphBuilder.prototype.rgbStr = function (c) {
    return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
  };

  LiveGraphBuilder.prototype.formatLabel = function (url) {
    var idx = url.indexOf("/");
    var label = idx >= 0 ? url.substring(idx) : url;
    if (label === "/") label = url;
    if (label.length > MAXLABEL) label = "... " + label.substring(label.length - MAXLABEL);
    return label;
  };

  LiveGraphBuilder.prototype.addNode = function (nodeId, nodeType, domain, size, label, attrs, parentId) {
    if (this.graph.hasNode(nodeId)) {
      var v = this.graph.getNodeAttribute(nodeId, "visited") || 1;
      this.graph.setNodeAttribute(nodeId, "visited", v + 1);
      if (v + 1 > maxVisitedCount) maxVisitedCount = v + 1;
      // Backfill attrs on nodes created bare (e.g. via ensureHierarchy)
      if (attrs) {
        var cur = this.graph.getNodeAttributes(nodeId);
        for (var k in attrs) {
          if (attrs[k] && !cur[k]) this.graph.setNodeAttribute(nodeId, k, attrs[k]);
        }
      }
      return;
    }
    var px, py, anchor;
    if (parentId && this.graph.hasNode(parentId)) {
      anchor = this.graph.getNodeAttributes(parentId);
    } else if (this.graph.hasNode("client:localhost")) {
      anchor = this.graph.getNodeAttributes("client:localhost");
    }
    if (anchor) {
      px = anchor.x + (Math.random() - 0.5) * 50;
      py = anchor.y + (Math.random() - 0.5) * 50;
    } else {
      px = (Math.random() - 0.5) * 100;
      py = (Math.random() - 0.5) * 100;
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

  LiveGraphBuilder.prototype.addEdge = function (srcId, dstId, attrs) {
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
      var edgeAttrs = { weight: 1 };
      if (attrs) Object.assign(edgeAttrs, attrs);
      this.graph.addEdge(srcId, dstId, edgeAttrs);
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
      if (srcRes && dstRes) {
        this.addEdge(srcRes, dstRes, {
          edge_type: "redirect",
          status_code: record.status || 0,
        });
        // Track redirect chain: srcRes → dstRes
        redirectNext[srcRes] = dstRes;
        if (!redirectPrev[dstRes]) redirectPrev[dstRes] = srcRes;
      }
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

    var clientName = record.client || "localhost";
    var clientId = "client:" + clientName;
    this.addNode(clientId, "client", "localdomain", 8.0, clientName);

    this.addEdge(clientId, resourceId);
    this.addEdge(domain, host);
    this.addEdge(host, resourceId);

    // Initiator
    if (record.initiator) {
      try {
        var ip = new URL(record.initiator);
        if ((ip.protocol === "http:" || ip.protocol === "https:") && ip.hostname) {
          var ih = ip.hostname, id = parseDomain(ih), ir = ih + ip.pathname;
          this.addNode(id, "domain", id, 6.0);
          this.addNode(ih, "host", id, 4.0, undefined, undefined, id);
          this.addNode(ir, "resource", id, 3.0, this.formatLabel(ir), undefined, ih);
          this.addEdge(id, ih);
          this.addEdge(ih, ir);
          this.addEdge(ir, resourceId);
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
  let redirectNext = {};          // resourceId → next resourceId in redirect chain
  let redirectPrev = {};          // resourceId → prev resourceId in redirect chain

  // ── ISAP Investigation State ────────────────────────────────────
  let operatorMap = {};       // operator_name → Set<domain_node_key>
  let clusterMap = {};        // cluster_name → Set<domain_node_key>
  let parentCluster = {};     // cluster_name → parent_cluster_name
  let roleSet = {};           // node_role → Set<resource_node_key>
  let sharedIPMap = {};       // ip_node_key → Set<domain_node_key>
  let sharedNSMap = {};       // ns_node_key → Set<domain_node_key>
  let sharesHostPairs = new Set(); // edge keys for shares_host edges

  let activeOperator = null;    // selected operator name or null
  let activeCluster = null;     // selected cluster name or null
  let activeColorMode = "domain"; // "domain"|"operator"|"cluster"|"role"|"infrastructure"
  let hiddenRoles = new Set();  // node_role values hidden via checkboxes
  let showInfrastructure = false; // toggle for IP/NS node visibility
  let investigationFocusSet = null; // Set<node_key> for operator/cluster subgraph
  let nodeToDomain = {};            // node_key → domain_node_key (for hosts/resources)

  // ── Highlight Map (hop-distance BFS from active node) ──────────
  // Maps node_key → hop distance (0 = the active node itself).
  // Rebuilt when hoveredNode, selectedNode, or hop slider changes.
  let highlightMap = null;          // Map<node_key, number> or null
  let highlightHops = 2;           // current hop slider value

  function rebuildHighlightMap() {
    var anchor = hoveredNode || selectedNode;
    if (!anchor || !graph || !graph.hasNode(anchor)) { highlightMap = null; return; }
    var maxHops = highlightHops;
    var map = new Map();
    map.set(anchor, 0);
    var queue = [{ node: anchor, depth: 0 }];
    while (queue.length > 0) {
      var cur = queue.shift();
      if (cur.depth >= maxHops) continue;
      graph.forEachNeighbor(cur.node, function (neighbor) {
        if (map.has(neighbor)) return;
        var nAttrs = graph.getNodeAttributes(neighbor);
        map.set(neighbor, cur.depth + 1);
        // Include client in the map (edge highlights) but don't traverse through it
        if (nAttrs.node_type !== "client") {
          queue.push({ node: neighbor, depth: cur.depth + 1 });
        }
      });
    }
    highlightMap = map;
  }

  function buildISAPIndexes() {
    nodeToDomain = {};
    operatorMap = {};
    clusterMap = {};
    parentCluster = {};
    roleSet = {};
    sharedIPMap = {};
    sharedNSMap = {};
    sharesHostPairs = new Set();

    graph.forEachNode(function (key, attrs) {
      if (attrs.node_role && attrs.node_role !== "") {
        if (!roleSet[attrs.node_role]) roleSet[attrs.node_role] = new Set();
        roleSet[attrs.node_role].add(key);
      }
    });

    graph.forEachEdge(function (edge, attrs, source, target) {
      var et = attrs.edge_type;
      if (et === "attribution") {
        var opAttrs = graph.getNodeAttributes(source);
        var opName = opAttrs.label || source;
        if (!operatorMap[opName]) operatorMap[opName] = new Set();
        operatorMap[opName].add(target);
      } else if (et === "membership") {
        var clAttrs = graph.getNodeAttributes(source);
        var clName = clAttrs.label || source;
        if (!clusterMap[clName]) clusterMap[clName] = new Set();
        clusterMap[clName].add(target);
      } else if (et === "parent_cluster") {
        var childAttrs = graph.getNodeAttributes(source);
        var parentAttrs = graph.getNodeAttributes(target);
        parentCluster[childAttrs.label || source] = parentAttrs.label || target;
      } else if (et === "hosted_on") {
        if (!sharedIPMap[target]) sharedIPMap[target] = new Set();
        sharedIPMap[target].add(source);
      } else if (et === "uses_ns") {
        if (!sharedNSMap[target]) sharedNSMap[target] = new Set();
        sharedNSMap[target].add(source);
      } else if (et === "shares_host") {
        sharesHostPairs.add(edge);
      }
    });

    // Prune non-shared IPs/NS (only keep those with 2+ domains)
    Object.keys(sharedIPMap).forEach(function (ip) {
      if (sharedIPMap[ip].size < 2) delete sharedIPMap[ip];
    });
    Object.keys(sharedNSMap).forEach(function (ns) {
      if (sharedNSMap[ns].size < 2) delete sharedNSMap[ns];
    });

    // Build node → domain mapping via hierarchy edges (domain→host→resource)
    graph.forEachNode(function (key, attrs) {
      if (attrs.node_type === "domain") {
        nodeToDomain[key] = key; // domain maps to itself
        graph.forEachOutNeighbor(key, function (hostKey) {
          var hAttrs = graph.getNodeAttributes(hostKey);
          if (hAttrs.node_type === "host") {
            nodeToDomain[hostKey] = key;
            graph.forEachOutNeighbor(hostKey, function (resKey) {
              var rAttrs = graph.getNodeAttributes(resKey);
              if (rAttrs.node_type === "resource") {
                nodeToDomain[resKey] = key;
              }
            });
          }
        });
      }
    });

    window._isap = { operatorMap: operatorMap, clusterMap: clusterMap, parentCluster: parentCluster, roleSet: roleSet, sharedIPMap: sharedIPMap, sharedNSMap: sharedNSMap, nodeToDomain: nodeToDomain, graph: graph }; // debug exposure — remove when stable
  }

  function buildInvestigationFocusSet() {
    if (!activeOperator && !activeCluster) {
      investigationFocusSet = null;
      return;
    }

    var focus = new Set();
    var domains = new Set();

    if (activeOperator) {
      // Add the operator node itself
      graph.forEachNode(function (key, attrs) {
        if (attrs.node_type === "operator" && (attrs.label === activeOperator || key === activeOperator)) {
          focus.add(key);
          // Also add technique and token nodes connected to this operator
          graph.forEachOutNeighbor(key, function (neighbor) {
            var nAttrs = graph.getNodeAttributes(neighbor);
            if (nAttrs.node_type === "technique" || nAttrs.node_type === "token") {
              focus.add(neighbor);
            }
          });
        }
      });
      // Add attributed domains
      var opDomains = operatorMap[activeOperator];
      if (opDomains) opDomains.forEach(function (d) { domains.add(d); });
    }

    if (activeCluster) {
      // Add the cluster node itself
      graph.forEachNode(function (key, attrs) {
        if (attrs.node_type === "cluster" && (attrs.label === activeCluster || key === activeCluster)) {
          focus.add(key);
        }
      });
      // Add member domains
      var clDomains = clusterMap[activeCluster];
      if (clDomains) clDomains.forEach(function (d) { domains.add(d); });

      // If meta-campaign, include child clusters and their domains
      var clusterAttrs = null;
      graph.forEachNode(function (key, attrs) {
        if (attrs.node_type === "cluster" && (attrs.label === activeCluster || key === activeCluster)) {
          clusterAttrs = attrs;
        }
      });
      if (clusterAttrs && clusterAttrs.is_meta === "true") {
        Object.keys(parentCluster).forEach(function (child) {
          if (parentCluster[child] === activeCluster) {
            // Add child cluster node
            graph.forEachNode(function (key, attrs) {
              if (attrs.node_type === "cluster" && (attrs.label === child || key === child)) {
                focus.add(key);
              }
            });
            // Add child cluster's domains
            var childDomains = clusterMap[child];
            if (childDomains) childDomains.forEach(function (d) { domains.add(d); });
          }
        });
      }
    }

    // Expand domains → hosts → resources via hierarchy edges
    domains.forEach(function (domainKey) {
      focus.add(domainKey);
      graph.forEachOutNeighbor(domainKey, function (hostKey) {
        var hAttrs = graph.getNodeAttributes(hostKey);
        if (hAttrs.node_type === "host") {
          focus.add(hostKey);
          graph.forEachOutNeighbor(hostKey, function (resKey) {
            var rAttrs = graph.getNodeAttributes(resKey);
            if (rAttrs.node_type === "resource") {
              focus.add(resKey);
              // Follow redirect chains from these resources
              var next = redirectNext[resKey];
              var seen = new Set();
              while (next && !seen.has(next)) {
                seen.add(next);
                focus.add(next);
                next = redirectNext[next];
              }
            }
          });
        }
      });
    });

    // Add clusters containing these domains (reverse lookup)
    if (activeOperator) {
      Object.keys(clusterMap).forEach(function (clName) {
        var members = clusterMap[clName];
        members.forEach(function (d) {
          if (domains.has(d)) {
            graph.forEachNode(function (key, attrs) {
              if (attrs.node_type === "cluster" && (attrs.label === clName || key === clName)) {
                focus.add(key);
              }
            });
          }
        });
      });
    }

    investigationFocusSet = focus;
  }

  function getRedirectChain(nodeKey) {
    if (!redirectNext[nodeKey] && !redirectPrev[nodeKey]) return [];
    // Walk back to chain start
    var start = nodeKey;
    var seen = new Set();
    while (redirectPrev[start] && !seen.has(start)) {
      seen.add(start);
      start = redirectPrev[start];
    }
    // Walk forward to build chain
    var chain = [start];
    seen.clear();
    seen.add(start);
    var cur = start;
    while (redirectNext[cur] && !seen.has(redirectNext[cur])) {
      cur = redirectNext[cur];
      seen.add(cur);
      chain.push(cur);
    }
    return chain;
  }
  let originalSizes = {};         // node key → original viz size
  let sizeMode = "default";       // "default" | "visited" | "visited-log"
  let bundleEnabled = true;       // collapse host resources into bundle nodes
  let bundledResources = new Set(); // resource IDs currently hidden in a bundle
  let expandedHosts = new Set();  // hosts manually expanded by user
  let liveBuilder = null;
  let livePort = null;
  let liveRefreshTimer = null;
  let liveMode = false;
  let graphGrew = false;
  let saveTimer = null;
  let maxVisitedCount = 1;
  let renderedSearchNodes = new Set();
  let renderedTypes = new Set();
  let renderedContentGroups = new Set();
  let renderedDomains = new Set();

  // ── Resource Bundling ────────────────────────────────────────────
  // Collapse a host's resources into a single "bundle" node unless a
  // resource has cross-host resource edges (making it "interesting").

  function hostOfResource(resourceId) {
    var idx = resourceId.indexOf("/");
    return idx >= 0 ? resourceId.substring(0, idx) : null;
  }

  function shouldExtract(resourceId, hostId) {
    // Extract only if connected to resources on 2+ different external hosts
    var externalHosts = new Set();
    graph.forEachNeighbor(resourceId, function (neighbor) {
      var nAttrs = graph.getNodeAttributes(neighbor);
      if (nAttrs.node_type === "resource") {
        var nHost = hostOfResource(neighbor);
        if (nHost && nHost !== hostId) externalHosts.add(nHost);
      }
    });
    return externalHosts.size > 1;
  }

  var bundlePositions = {}; // bundleId → {x, y}

  function rebuildBundles() {
    // Save positions and remove existing bundle nodes
    var toRemove = [];
    graph.forEachNode(function (key, attrs) {
      if (attrs.node_type === "bundle") {
        bundlePositions[key] = { x: attrs.x, y: attrs.y };
        toRemove.push(key);
      }
    });
    toRemove.forEach(function (k) { graph.dropNode(k); });
    bundledResources.clear();

    if (!bundleEnabled) return;

    // Group resources by host
    var hostResources = {};
    graph.forEachNode(function (key, attrs) {
      if (attrs.node_type !== "resource") return;
      var host = hostOfResource(key);
      if (!host) return;
      if (!hostResources[host]) hostResources[host] = [];
      hostResources[host].push(key);
    });

    for (var host in hostResources) {
      if (expandedHosts.has(host)) continue;
      var resources = hostResources[host];
      var toBundle = [];
      for (var i = 0; i < resources.length; i++) {
        if (!shouldExtract(resources[i], host)) toBundle.push(resources[i]);
      }
      if (toBundle.length <= 2) continue; // not worth collapsing

      var bundleId = "bundle:" + host;
      var hostAttrs = graph.hasNode(host) ? graph.getNodeAttributes(host) : {};
      var hx = hostAttrs.x || 0, hy = hostAttrs.y || 0;
      // Preserve position from previous bundle if it existed
      var prevPos = bundlePositions[bundleId];
      var bx = prevPos ? prevPos.x : hx + (Math.random() - 0.5) * 20;
      var by = prevPos ? prevPos.y : hy + (Math.random() - 0.5) * 20;

      graph.mergeNode(bundleId, {
        label: host + " (" + toBundle.length + ")",
        node_type: "bundle",
        domain: hostAttrs.domain || parseDomain(host),
        size: 3.0 + Math.log1p(toBundle.length),
        color: hostAttrs.color,
        x: bx,
        y: by,
        bundleHost: host,
        bundleCount: toBundle.length,
      });
      originalSizes[bundleId] = 3.0 + Math.log1p(toBundle.length);

      if (graph.hasNode(host) && !graph.hasEdge(host, bundleId)) {
        graph.addEdge(host, bundleId, { weight: toBundle.length });
      }

      for (var j = 0; j < toBundle.length; j++) {
        bundledResources.add(toBundle[j]);
      }
    }

    // Second pass: redirect external edges to bundle nodes.
    // For each bundled resource, find neighbors outside its host and
    // create a single weighted edge from that neighbor to the bundle.
    bundledResources.forEach(function (rid) {
      var host = hostOfResource(rid);
      var bundleId = "bundle:" + host;
      if (!graph.hasNode(bundleId)) return;
      graph.forEachNeighbor(rid, function (neighbor) {
        if (neighbor === host) return;
        if (bundledResources.has(neighbor)) return;
        var nAttrs = graph.getNodeAttributes(neighbor);
        if (nAttrs.node_type === "bundle") return;
        // Create or increment weighted edge from neighbor to bundle
        if (graph.hasEdge(neighbor, bundleId) || graph.hasEdge(bundleId, neighbor)) return;
        graph.addEdge(neighbor, bundleId, { weight: 1 });
      });
    });
  }

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
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveGraph();
    }, 30000);
  }

  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "hidden" && graph && graph.order > 0) {
      saveGraph();
    }
  });

  window.addEventListener("beforeunload", function() {
    if (graph && graph.order > 0) saveGraph();
  });

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
  const infoHeader = document.getElementById("info-header");
  const infoClose = document.getElementById("info-close");
  const infoContent = document.getElementById("info-content");
  const tooltip = document.getElementById("tooltip");
  const contextMenu = document.getElementById("context-menu");
  const bundleToggle = document.getElementById("bundle-toggle");
  const showHiddenCb = document.getElementById("show-hidden");
  const showHiddenLabel = document.getElementById("show-hidden-label");
  const hiddenCountSpan = document.getElementById("hidden-count");
  const container = document.getElementById("graph-container");
  const extIdInput = document.getElementById("ext-id");
  const btnLive = document.getElementById("btn-live");
  const autoConnectCb = document.getElementById("auto-connect");
  const liveStatus = document.getElementById("live-status");
  liveStatus.textContent = "Disconnected";
  liveStatus.className = "disconnected";

  // ── Draggable info panel ──────────────────────────────────────────
  (function () {
    var dragging = false, offX = 0, offY = 0;
    infoHeader.addEventListener("mousedown", function (e) {
      if (e.target === infoClose) return;
      dragging = true;
      var rect = infoPanel.getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      infoPanel.style.left = (e.clientX - offX) + "px";
      infoPanel.style.top = (e.clientY - offY) + "px";
      infoPanel.style.right = "auto";
    });
    document.addEventListener("mouseup", function () { dragging = false; });
    infoClose.addEventListener("click", function () {
      infoPanel.classList.add("hidden");
      selectedNode = null;
      rebuildHighlightMap();
      if (renderer) renderer.refresh();
    });
  })();

  // ── Custom hover renderer (nullphase dark theme) ───────────────────
  function drawNodeHover(context, data, settings) {
    var size = data.size;
    // Draw halo
    context.beginPath();
    context.arc(data.x, data.y, size + 2, 0, Math.PI * 2);
    context.fillStyle = theme.accentCyan + "40";
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
      context.fillStyle = theme.bgCard + "E0";
      context.beginPath();
      context.roundRect(x - pad, data.y - fontSize / 2 - pad, textWidth + pad * 2, fontSize + pad * 2, 3);
      context.fill();
      context.strokeStyle = theme.border;
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = theme.textPrimary;
      context.fillText(data.label, x, y);
    }
  }

  // ── GEXF Loading ───────────────────────────────────────────────────
  const dropOverlay = document.getElementById("drop-overlay");

  function handleFiles(files) {
    const file = files[0];
    if (!file) return;
    if (!file.name.endsWith(".gexf") && !file.type.includes("xml")) {
      console.warn("Unsupported file type dropped:", file.type);
      return;
    }
    const reader = new FileReader();
    reader.onload = function (ev) { loadGexf(ev.target.result); };
    reader.readAsText(file);
  }

  fileInput.addEventListener("change", function (e) {
    handleFiles(e.target.files);
  });

  // Drag and drop event listeners
  let dragCounter = 0;
  window.addEventListener("dragenter", function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    dropOverlay.classList.add("active");
    dropOverlay.classList.remove("hidden");
  });

  window.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("dragleave", function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
      dropOverlay.classList.remove("active");
      setTimeout(() => {
        if (dragCounter === 0) dropOverlay.classList.add("hidden");
      }, 250);
    }
  });

  window.addEventListener("drop", function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropOverlay.classList.remove("active");
    setTimeout(() => {
      if (dragCounter === 0) dropOverlay.classList.add("hidden");
    }, 250);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  btnExport.addEventListener("click", function () {
    if (!graph) return;
    // Export without synthetic bundle nodes
    var exportGraph = graph.copy();
    exportGraph.forEachNode(function (key, attrs) {
      if (attrs.node_type === "bundle") exportGraph.dropNode(key);
    });
    var gexfString = graphologyLibrary.gexf.write(exportGraph);
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
    highlightMap = null;
    focusSet = null;
    hiddenTypes.clear();
    hiddenDomains.clear();
    hiddenContentGroups.clear();
    domainFilterText = "";
    manuallyHidden.clear();
    showHidden = false;
    showHiddenCb.checked = false;
    sizeMode = "default";
    renderedSearchNodes.clear(); nodeList.innerHTML = "";
    renderedTypes.clear(); typeFiltersDiv.innerHTML = "";
    renderedContentGroups.clear(); contentFiltersDiv.innerHTML = "";
    renderedDomains.clear(); domainFiltersDiv.innerHTML = "";
    expandedHosts.clear();
    redirectNext = {};
    redirectPrev = {};
    activeOperator = null;
    activeCluster = null;
    activeColorMode = "domain";
    hiddenRoles = new Set();
    showInfrastructure = false;
    investigationFocusSet = null;
    rebuildBundles();
    updateHiddenCount();

    requestAnimationFrame(function () {
      var SigmaConstructor = typeof Sigma === "function" ? Sigma : Sigma.Sigma;
      if (!EdgeDashedProgram) EdgeDashedProgram = initEdgeDashedProgram();
      var programClasses = {};
      if (EdgeDashedProgram) programClasses.dashed = EdgeDashedProgram;
      renderer = new SigmaConstructor(graph, container, {
        nodeReducer: nodeReducer,
        edgeReducer: edgeReducer,
        edgeProgramClasses: programClasses,
        allowInvalidContainer: true,
        labelRenderedSizeThreshold: 6,
        labelFont: "Oxanium, sans-serif",
        labelColor: { color: "#f0e6ff" },
        defaultEdgeColor: theme.border,
        defaultEdgeType: "arrow",
        defaultDrawNodeHover: drawNodeHover,
        enableEdgeEvents: true,
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
      setupInvestigation();
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
    maxVisitedCount = 1;
    redirectNext = {};
    redirectPrev = {};
    graph.forEachNode(function (key, attrs) {
      originalSizes[key] = attrs.size || 3;
      var v = Number(attrs.visited) || 1;
      if (v > maxVisitedCount) maxVisitedCount = v;
    });
    // Rebuild redirect chains from edge attributes
    graph.forEachEdge(function (edge, attrs, source, target) {
      if (attrs.edge_type === "redirect") {
        redirectNext[source] = target;
        if (!redirectPrev[target]) redirectPrev[target] = source;
      }
    });

    buildISAPIndexes();

    liveMode = false;
    initRenderer();
    saveGraph();
  }

  // ── Node / Edge Reducers ───────────────────────────────────────────
  function isNodeHidden(key, attrs) {
    if (!attrs) attrs = graph.getNodeAttributes(key);
    if (manuallyHidden.has(key) && !showHidden) return true;
    if (hiddenTypes.has(attrs.node_type)) return true;
    if (hiddenDomains.has(attrs.domain)) return true;
    if (hiddenContentGroups.size > 0 && attrs.node_type === "resource" && attrs.content_type) {
      if (hiddenContentGroups.has(classifyContent(attrs.content_type))) return true;
    }
    // ISAP: hide IP/NS nodes unless infrastructure overlay is on; always hide orphans
    if (attrs.node_type === "ip_address" || attrs.node_type === "ns_provider") {
      if (!showInfrastructure || graph.degree(key) === 0) return true;
    }
    // ISAP: role filter (only affects resources)
    if (hiddenRoles.size > 0 && attrs.node_type === "resource" && attrs.node_role) {
      if (hiddenRoles.has(attrs.node_role)) return true;
    }
    // ISAP: operator/cluster subgraph filter
    if (investigationFocusSet && !investigationFocusSet.has(key)) return true;
    if (focusSet && !focusSet.has(key)) return true;
    if (bundledResources.has(key)) return true;
    return false;
  }

  var cachedSizeMult = 1, cachedSizeMin = 2, cachedSizeMax = 20;

  function getVisualSize(key, attrs) {
    var mult = cachedSizeMult;
    if (sizeMode !== "default") {
      var minSize = cachedSizeMin;
      var maxSize = cachedSizeMax;
      var v = Number(attrs.visited) || 1;
      var useLog = sizeMode === "visited-log";
      var logMax = useLog ? Math.log1p(maxVisitedCount) : maxVisitedCount;
      var norm = logMax > 1 ? (useLog ? Math.log1p(v) : v) / logMax : 0;
      return (minSize + norm * (maxSize - minSize)) * mult;
    } else {
      return (originalSizes[key] || 3) * mult;
    }
  }

  // ── ISAP Contextual Coloring ──────────────────────────────────────
  var ROLE_COLORS = {
    entry_point: "#05ffa1",       // mint/green
    redirect_hop: "#fffb96",      // yellow
    landing: "#ff9f43",           // orange
    monetization: "#ef4444",      // red
    commercial_relay: "#01cdfe",  // cyan/blue
  };

  var OPERATOR_PALETTE = [
    "#ff71ce", "#01cdfe", "#05ffa1", "#fffb96", "#b967ff",
    "#ff9f43", "#ef4444", "#7afcff", "#ffd700", "#ff6b6b",
  ];

  // Returns { color: <raw hex/named>, alpha: <0-1> } — never pre-blended.
  // Callers that need a final display color should pass through toRGBA themselves.
  function getNodeColorRaw(key, attrs) {
    if (activeColorMode === "domain" || !activeColorMode) {
      return { color: attrs.color || theme.accentViolet, alpha: 1 };
    }

    var myDomain = nodeToDomain[key];

    if (activeColorMode === "role") {
      if (attrs.node_type === "resource" && attrs.node_role) {
        return { color: ROLE_COLORS[attrs.node_role] || theme.textMuted, alpha: 1 };
      }
      return { color: theme.textMuted, alpha: 0.3 };
    }

    if (activeColorMode === "operator") {
      if (activeOperator) {
        var opDomains = operatorMap[activeOperator];
        if (attrs.node_type === "operator" && (attrs.label === activeOperator || key === activeOperator)) {
          return { color: theme.accentPink, alpha: 1 };
        }
        if (attrs.node_type === "technique" || attrs.node_type === "token") {
          return { color: theme.accentPink, alpha: 1 };
        }
        if (myDomain && opDomains && opDomains.has(myDomain)) {
          return { color: attrs.color || theme.accentViolet, alpha: 1 };
        }
        return { color: theme.textMuted, alpha: 0.25 };
      }
      var opNames = Object.keys(operatorMap);
      for (var i = 0; i < opNames.length; i++) {
        if (myDomain && operatorMap[opNames[i]].has(myDomain)) {
          return { color: OPERATOR_PALETTE[i % OPERATOR_PALETTE.length], alpha: 1 };
        }
      }
      return { color: theme.textMuted, alpha: 0.25 };
    }

    if (activeColorMode === "cluster") {
      if (activeCluster) {
        var clDomains = clusterMap[activeCluster];
        if (attrs.node_type === "cluster" && (attrs.label === activeCluster || key === activeCluster)) {
          return { color: theme.accentCyan, alpha: 1 };
        }
        if (myDomain && clDomains && clDomains.has(myDomain)) {
          return { color: attrs.color || theme.accentViolet, alpha: 1 };
        }
        return { color: theme.textMuted, alpha: 0.25 };
      }
      var clNames = Object.keys(clusterMap);
      for (var j = 0; j < clNames.length; j++) {
        if (myDomain && clusterMap[clNames[j]].has(myDomain)) {
          return { color: OPERATOR_PALETTE[j % OPERATOR_PALETTE.length], alpha: 1 };
        }
      }
      return { color: theme.textMuted, alpha: 0.25 };
    }

    if (activeColorMode === "infrastructure") {
      if (attrs.node_type === "ip_address") return { color: theme.accentYellow, alpha: 1 };
      if (attrs.node_type === "ns_provider") return { color: theme.accentCyan, alpha: 1 };
      var domKey = myDomain || key;
      var ipKeys = Object.keys(sharedIPMap);
      for (var k = 0; k < ipKeys.length; k++) {
        if (sharedIPMap[ipKeys[k]].has(domKey)) {
          return { color: OPERATOR_PALETTE[k % OPERATOR_PALETTE.length], alpha: 1 };
        }
      }
      return { color: theme.textMuted, alpha: 0.25 };
    }

    return { color: attrs.color || theme.accentViolet, alpha: 1 };
  }

  function getNodeColor(key, attrs) {
    var raw = getNodeColorRaw(key, attrs);
    if (raw.alpha >= 1) return raw.color;
    return toRGBA(raw.color, raw.alpha);
  }

  function nodeReducer(key, attrs) {
    var res = Object.assign({}, attrs);

    if (isNodeHidden(key, attrs)) { res.hidden = true; return res; }
    if (manuallyHidden.has(key) && showHidden) {
      res.color = theme.textMuted;
    } else {
      res.color = getNodeColor(key, attrs);
    }

    // Dynamic Size Scaling
    res.size = getVisualSize(key, attrs);

    // Hover/selection highlighting with hop-distance decay
    var anchor = hoveredNode || selectedNode;
    if (anchor && highlightMap) {
      var hopDist = highlightMap.get(key);
      if (hopDist !== undefined) {
        // Within highlight radius — decay intensity by hop
        if (hopDist === 0) {
          res.highlighted = true;
          res.zIndex = 2;
        } else {
          // Decay: hop 1 = 0.85, hop 2 = 0.65, hop 3 = 0.45, etc.
          var decay = Math.max(0.25, 1.0 - hopDist * 0.2);
          if (hoveredNode) {
            res.highlighted = true;
          }
          res.zIndex = 1;
          // Use raw color to avoid double-compositing
          var raw = getNodeColorRaw(key, attrs);
          res.color = toRGBA(raw.color, raw.alpha * (0.4 + 0.6 * decay));
        }
      } else if (hoveredNode) {
        // Outside highlight radius during hover → full dim
        res.color = theme.bgCard;
        res.label = "";
        res.zIndex = 0;
      }
      // Outside highlight radius during selection → leave nodes as-is
    }

    // Always highlight the selected node itself
    if (selectedNode === key) {
      res.highlighted = true;
      res.zIndex = 2;
    }

    return res;
  }

  function toRGBA(col, alpha) {
    var r = 113, g = 10, b = 255;
    if (col) {
      if (col.startsWith("rgba(") || col.startsWith("rgb(")) {
        var parts = col.match(/\d+/g);
        if (parts && parts.length >= 3) {
          r = parseInt(parts[0]);
          g = parseInt(parts[1]);
          b = parseInt(parts[2]);
        }
      } else if (col.startsWith("#") && col.length === 7) {
        r = parseInt(col.substring(1, 3), 16);
        g = parseInt(col.substring(3, 5), 16);
        b = parseInt(col.substring(5, 7), 16);
      }
    }
    // Manually mix with the page background color (#0d0221 / rgb(13, 2, 33)) 
    // to simulate opacity without relying on WebGL alpha blending.
    // This prevents bright hairballs where overlapping transparent edges add up to white.
    var bgR = 13, bgG = 2, bgB = 33;
    var finalR = Math.round(r * alpha + bgR * (1 - alpha));
    var finalG = Math.round(g * alpha + bgG * (1 - alpha));
    var finalB = Math.round(b * alpha + bgB * (1 - alpha));
    return "rgb(" + finalR + "," + finalG + "," + finalB + ")";
  }

  function edgeReducer(edge, attrs) {
    var res = Object.assign({}, attrs);
    var source = graph.source(edge);
    var target = graph.target(edge);

    // Hide edges to bundled or manually hidden nodes
    if (bundledResources.has(source) || bundledResources.has(target)) { res.hidden = true; return res; }
    if (!showHidden && (manuallyHidden.has(source) || manuallyHidden.has(target))) { res.hidden = true; return res; }

    // Hide edges connected to hidden nodes
    var sAttrs = graph.getNodeAttributes(source);
    var tAttrs = graph.getNodeAttributes(target);
    if (hiddenTypes.has(sAttrs.node_type) || hiddenTypes.has(tAttrs.node_type)) { res.hidden = true; return res; }
    if (hiddenDomains.has(sAttrs.domain) || hiddenDomains.has(tAttrs.domain)) { res.hidden = true; return res; }

    // Focus mode
    if (focusSet && (!focusSet.has(source) || !focusSet.has(target))) { res.hidden = true; return res; }
    // ISAP: investigation focus — hide edges outside subgraph
    if (investigationFocusSet && (!investigationFocusSet.has(source) || !investigationFocusSet.has(target))) {
      res.hidden = true; return res;
    }

    var isCrossDomain = (sAttrs.domain && tAttrs.domain && sAttrs.domain !== tAttrs.domain && sAttrs.node_type !== 'client' && tAttrs.node_type !== 'client');
    var isRedirect = attrs.edge_type === "redirect";
    var sColor = sAttrs.color || theme.border;

    // Hover/selection edge highlighting with hop-distance decay
    var anchor = hoveredNode || selectedNode;
    if (anchor && highlightMap) {
      var sDist = highlightMap.get(source);
      var tDist = highlightMap.get(target);
      // An edge is "in range" if both endpoints are in the highlight map
      // Its hop level = the max of the two endpoint distances
      if (sDist !== undefined && tDist !== undefined) {
        var edgeHop = Math.max(sDist, tDist);
        // Decay: hop 0-edge = full, then fading out
        // Hover mode: brighter (0.6 base), Selection mode: moderate (0.45 base)
        var baseAlpha = hoveredNode ? 0.6 : 0.45;
        var decay = Math.max(0.2, 1.0 - edgeHop * 0.25);
        var alpha = baseAlpha * decay;
        var sizeMult = hoveredNode ? 1.2 : 1.1;
        var sizeDecay = Math.max(0.5, 1.0 - edgeHop * 0.15);
        res.color = isRedirect ? theme.accentYellow : toRGBA(sColor, alpha);
        res.size = (res.size ? res.size * sizeMult : 1.5) * sizeDecay;
        res.zIndex = 2 - edgeHop;
      } else if (hoveredNode) {
        // Outside highlight radius during hover → dim
        res.color = theme.bgPage;
        res.zIndex = 0;
      } else {
        // Outside radius during selection → soft dim
        res.color = toRGBA(sColor, 0.10);
        res.zIndex = 0;
      }
      return res;
    }

    if (showInfrastructure && sharesHostPairs.has(edge)) {
      res.color = theme.accentMint;
      res.size = 2;
      res.zIndex = 3;
    } else if (isRedirect) {
      res.color = toRGBA(theme.accentYellow, 0.7);
      res.size = 1;
      res.zIndex = 2;
      if (EdgeDashedProgram) res.type = "dashed";
    } else {
      if (activeColorMode !== "domain") {
        // In investigation modes, use source node's raw contextual color
        var srcRaw = getNodeColorRaw(source, sAttrs);
        var tgtRaw = getNodeColorRaw(target, tAttrs);
        var bothHighlighted = srcRaw.alpha > 0.5 && tgtRaw.alpha > 0.5;
        res.color = bothHighlighted ? toRGBA(srcRaw.color, srcRaw.alpha * 0.4) : toRGBA(theme.textMuted, 0.05);
        res.zIndex = bothHighlighted ? 1 : 0;
      } else if (isCrossDomain) {
        res.color = toRGBA(sColor, 0.25);
        res.zIndex = 1;
      } else {
        res.color = toRGBA(sColor, 0.15);
        res.zIndex = 0;
      }
    }

    return res;
  }

  // ── Dashed Edge Program (WebGL) ──────────────────────────────────
  // Patches sigma's EdgeRectangleProgram shaders to add a dash pattern.
  // Uses ES6 class extends (required — sigma uses ES6 classes internally).

  var EdgeDashedProgram = null;

  function initEdgeDashedProgram() {
    var Base = (typeof Sigma !== "undefined" && Sigma.rendering)
      ? Sigma.rendering.EdgeRectangleProgram : null;
    if (!Base) { console.warn("EdgeRectangleProgram not found at Sigma.rendering"); return null; }

    var vertKey = "VERTEX_SHADER_SOURCE", fragKey = "FRAGMENT_SHADER_SOURCE";

    try {

      class DashedProgram extends Base {
        getDefinition() {
          var def = super.getDefinition();
          // Patch vertex shader: add v_dash varying and compute edge screen length
          def[vertKey] = def[vertKey]
            .replace(
              /varying\s+float\s+v_feather;/,
              "varying float v_feather;\nvarying float v_dash;"
            )
            .replace(
              /gl_Position\s*=/,
              "vec2 _ss = (u_matrix * vec3(a_positionStart, 1.0)).xy;\n" +
              "vec2 _se = (u_matrix * vec3(a_positionEnd, 1.0)).xy;\n" +
              "v_dash = a_positionCoef * length(_se - _ss) * 500.0;\n" +
              "gl_Position ="
            );
          // Patch fragment shader: add v_dash varying and discard in gaps
          def[fragKey] = def[fragKey]
            .replace(
              /varying\s+float\s+v_feather;/,
              "varying float v_feather;\nvarying float v_dash;"
            )
            .replace(
              /void\s+main\s*\(\s*void\s*\)\s*\{/,
              "void main(void) {\n" +
              "  float _dp = mod(v_dash, 14.0);\n" +
              "  if (_dp > 8.0) discard;\n"
            );
          return def;
        }
      }
      return DashedProgram;
    } catch (e) {
      console.warn("Failed to create dashed edge program:", e);
      return null;
    }
  }

  // ── ForceAtlas2 ────────────────────────────────────────────────────
  var fa2Worker = null;
  var fa2WorkerBlobUrl = null;
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
  var fa2MFCheck = document.getElementById("fa2-multifocal");
  var fa2ASCheck = document.getElementById("fa2-adjustsizes");
  var fa2ModeLabel = document.getElementById("fa2-mode");

  // CDN URLs (same as in index.html, fetched from cache for the worker)
  var CDN_GRAPHOLOGY = "https://unpkg.com/graphology@0.26.0/dist/graphology.umd.min.js";
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
    "  if (settings.multiFocal) {",
    "    for (var i = 0; i < nodeKeys.length; i++) {",
    "      var a = graph.getNodeAttributes(nodeKeys[i]);",
    "      if (a.domain && a.domain !== 'localdomain') {",
    "        var hash = 0; for(var j=0; j<a.domain.length; j++) hash = a.domain.charCodeAt(j) + ((hash << 5) - hash);",
    "        var h = ((hash % 360) + 360) % 360;",
    "        var angle = (h / 360) * 2 * Math.PI;",
    "        var tx = Math.cos(angle) * 800;",
    "        var ty = Math.sin(angle) * 800;",
    "        var pull = 0.004;",
    "        graph.setNodeAttribute(nodeKeys[i], 'x', a.x + (tx - a.x) * pull);",
    "        graph.setNodeAttribute(nodeKeys[i], 'y', a.y + (ty - a.y) * pull);",
    "      }",
    "    }",
    "  }",
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
    "  if (prevPos && tickCount > 20 && avgDisp < settleThreshold) {",
    "    running = false;",
    "    self.postMessage({ type: 'idle' });",
    "    return;",
    "  }",
    "  setTimeout(runLoop, 0);",
    "}"
  ].join("\n");

  // Build a subgraph containing only visible nodes for layout
  function buildLayoutGraph() {
    var lg = new Graph();
    graph.forEachNode(function (key, attrs) {
      if (!isNodeHidden(key)) {
        var vs = getVisualSize(key, attrs);
        lg.addNode(key, { x: attrs.x, y: attrs.y, size: vs * 3 + 2 });
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
      fa2WorkerBlobUrl = URL.createObjectURL(blob);
      var worker = new Worker(fa2WorkerBlobUrl);
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
      slowDown: Math.min(inferred.slowDown || 1, 3),
      barnesHutOptimize: inferred.barnesHutOptimize !== false,
      barnesHutTheta: inferred.barnesHutTheta || 0.5,
      strongGravityMode: inferred.strongGravityMode || false,
      linLogMode: inferred.linLogMode || false,
      multiFocal: fa2MFCheck ? fa2MFCheck.checked : true,
      adjustSizes: fa2ASCheck ? fa2ASCheck.checked : false,
      outboundAttractionDistribution: false,
    };
    fa2Iters = 10;

    // Sync sliders to inferred values
    fa2ScalingSlider.value = fa2Settings.scalingRatio;
    fa2GravitySlider.value = Math.round(fa2Settings.gravity * 100);
    fa2SlowdownSlider.value = Math.round(fa2Settings.slowDown);
    fa2ThetaSlider.value = Math.round(fa2Settings.barnesHutTheta * 10);
    fa2ItersSlider.value = fa2Iters;
    fa2BHCheck.checked = fa2Settings.barnesHutOptimize;
    fa2SGCheck.checked = fa2Settings.strongGravityMode;
    fa2LLCheck.checked = fa2Settings.linLogMode;
    if (fa2ASCheck) fa2ASCheck.checked = fa2Settings.adjustSizes;
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
    if (fa2MFCheck) fa2Settings.multiFocal = fa2MFCheck.checked;
    if (fa2ASCheck) fa2Settings.adjustSizes = fa2ASCheck.checked;
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
  [fa2BHCheck, fa2SGCheck, fa2LLCheck, fa2MFCheck, fa2ASCheck].forEach(function (el) {
    if (el) el.addEventListener("change", pushFA2Settings);
  });

  async function startFA2() {
    if (fa2Running || !graph) return;
    if (!fa2Settings.scalingRatio) initFA2Settings();
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
          fa2CooldownUntil = Date.now() + 8000;
          fa2Running = false;
          killFA2Worker();
          fa2LayoutGraph = null;
          btnFA2.textContent = "Start ForceAtlas2";
          btnFA2.classList.remove("active");
          fa2ModeLabel.textContent = "idle — settled";
          fa2SettingsDiv.classList.remove("hidden");
          saveGraph();
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
    var wasRunning = fa2Running;
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
    if (wasRunning) saveGraph();
  }

  function killFA2Worker() {
    if (fa2Worker) { fa2Worker.terminate(); fa2Worker = null; }
    if (fa2WorkerBlobUrl) { URL.revokeObjectURL(fa2WorkerBlobUrl); fa2WorkerBlobUrl = null; }
    fa2UseWorker = false;
  }

  // Restart FA2 with updated filter state (rebuild layout graph)
  var fa2Idle = false;
  var fa2CooldownUntil = 0;

  function restartFA2IfRunning() {
    if (!fa2Running && !fa2Idle) return;
    if (fa2Idle && Date.now() < fa2CooldownUntil) return;
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
    if (fa2Settings.multiFocal) {
      fa2LayoutGraph.forEachNode(function(key, a) {
        if (a.domain && a.domain !== 'localdomain') {
          var hash = 0; for(var j=0; j<a.domain.length; j++) hash = a.domain.charCodeAt(j) + ((hash << 5) - hash);
          var h = ((hash % 360) + 360) % 360;
          var angle = (h / 360) * 2 * Math.PI;
          var tx = Math.cos(angle) * 800;
          var ty = Math.sin(angle) * 800;
          var pull = 0.004;
          fa2LayoutGraph.setNodeAttribute(key, 'x', a.x + (tx - a.x) * pull);
          fa2LayoutGraph.setNodeAttribute(key, 'y', a.y + (ty - a.y) * pull);
        }
      });
    }
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
    cachedSizeMin = Number(sizeMinSlider.value);
    cachedSizeMax = Number(sizeMaxSlider.value);
    cachedSizeMult = Number(sizeMultSlider.value) || 1;
    sizeMinVal.textContent = cachedSizeMin;
    sizeMaxVal.textContent = cachedSizeMax;
    sizeMultVal.textContent = cachedSizeMult.toFixed(1);

    [btnSizeDefault, btnSizeVisited, btnSizeVisitedLog].forEach(function (b) { b.classList.remove("active"); });

    if (sizeMode === "default") {
      btnSizeDefault.classList.add("active");
      sizeRangeDiv.classList.add("hidden");
    } else {
      (sizeMode === "visited" ? btnSizeVisited : btnSizeVisitedLog).classList.add("active");
      sizeRangeDiv.classList.remove("hidden");
    }
    if (renderer) renderer.refresh();
    if (fa2Running && fa2Settings.adjustSizes) {
      restartFA2IfRunning(); // Sizes changed, physics need to recalculate
    }
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
    var fragment = document.createDocumentFragment();
    var added = false;
    graph.forEachNode(function (key, attrs) {
      var label = attrs.label || key;
      if (!renderedSearchNodes.has(label)) {
        renderedSearchNodes.add(label);
        labelMap[label] = key;
        var opt = document.createElement("option");
        opt.value = label;
        opt.dataset.key = key;
        fragment.appendChild(opt);
        added = true;
      }
    });
    if (added) nodeList.appendChild(fragment);
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
      rebuildHighlightMap();
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
    highlightHops = parseInt(hopSlider.value, 10);
    rebuildHighlightMap();
    if (renderer) renderer.refresh();
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
    client: theme.textPrimary, domain: theme.accentPink, host: theme.accentCyan,
    resource: theme.accentViolet, ip: theme.accentYellow, params: theme.accentMint,
    bundle: theme.textMuted
  };

  function setupTypeFilters() {
    var fragment = document.createDocumentFragment();
    var added = false;
    var types = new Set();
    graph.forEachNode(function (key, attrs) { if (attrs.node_type) types.add(attrs.node_type); });

    types.forEach(function (type) {
      if (renderedTypes.has(type)) return;
      // ip_address / ns_provider are owned by the Investigation sidebar's
      // infrastructure toggle. They used to get a type checkbox here as well,
      // seeded into hiddenTypes — and isNodeHidden tests hiddenTypes before it
      // tests showInfrastructure, so the toggle could never reveal them and
      // read as a dead control. One owner only; isNodeHidden already defaults
      // them hidden while the toggle is off.
      if (type === "ip_address" || type === "ns_provider") return;
      renderedTypes.add(type);
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
      fragment.appendChild(label);
      added = true;

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
    if (added) typeFiltersDiv.appendChild(fragment);
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
    var fragment = document.createDocumentFragment();
    var added = false;
    var groups = new Set();
    graph.forEachNode(function (key, attrs) {
      if (attrs.node_type === "resource" && attrs.content_type) {
        groups.add(classifyContent(attrs.content_type));
      }
    });

    var sorted = Array.from(groups).sort();
    sorted.forEach(function (group) {
      if (renderedContentGroups.has(group)) return;
      renderedContentGroups.add(group);
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !hiddenContentGroups.has(group);
      cb.dataset.contentGroup = group;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + group));
      fragment.appendChild(label);
      added = true;

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
    var contentSection = document.getElementById("content-section");
    if (added) {
      contentFiltersDiv.appendChild(fragment);
      var labels = Array.from(contentFiltersDiv.querySelectorAll("label"));
      labels.sort((a, b) => a.textContent.localeCompare(b.textContent));
      labels.forEach(lbl => contentFiltersDiv.appendChild(lbl));
      if (contentSection) contentSection.style.display = "";
    } else if (contentSection) {
      contentSection.style.display = "none";
    }
  }

  // ── Domain Filters ─────────────────────────────────────────────────
  function setupDomainFilters() {
    var fragment = document.createDocumentFragment();
    var added = false;
    var domains = new Set();
    graph.forEachNode(function (key, attrs) { if (attrs.domain) domains.add(attrs.domain); });

    var sortedDomains = Array.from(domains).sort();
    sortedDomains.forEach(function (domain) {
      if (renderedDomains.has(domain)) return;
      renderedDomains.add(domain);
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !hiddenDomains.has(domain);
      cb.dataset.domain = domain;
      var swatch = document.createElement("span");
      swatch.className = "swatch";
      var c = stringToColor(domain);
      swatch.style.background = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
      label.appendChild(cb);
      label.appendChild(swatch);
      label.appendChild(document.createTextNode(" " + domain));
      label.dataset.domain = domain;
      if (domainFilterText && !domain.toLowerCase().includes(domainFilterText)) {
        label.style.display = "none";
      }
      fragment.appendChild(label);
      added = true;

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
    if (added) {
      domainFiltersDiv.appendChild(fragment);
      var labels = Array.from(domainFiltersDiv.querySelectorAll("label"));
      labels.sort((a, b) => a.dataset.domain.localeCompare(b.dataset.domain));
      labels.forEach(lbl => domainFiltersDiv.appendChild(lbl));
    }
  }

  domainFilterInput.addEventListener("input", function () {
    domainFilterText = domainFilterInput.value.toLowerCase();
    var labels = domainFiltersDiv.querySelectorAll("label");
    labels.forEach(function (lbl) {
      var d = lbl.dataset.domain || "";
      lbl.style.display = d.toLowerCase().includes(domainFilterText) ? "" : "none";
    });
  });

  // ── Investigation Filters ──────────────────────────────────────────
  var ROLE_DISPLAY = ["entry_point", "redirect_hop", "landing", "monetization", "commercial_relay"];

  function setupInvestigation() {
    var opSelect = document.getElementById("operator-select");
    var clSelect = document.getElementById("cluster-select");
    var colorSelect = document.getElementById("color-select");
    var infraToggle = document.getElementById("infra-toggle");
    var roleFiltersDiv = document.getElementById("role-filters");
    var investigationSection = document.getElementById("investigation-section");

    if (!opSelect || !clSelect) return;

    // Surface the Investigation UI only when the graph actually carries ISAP
    // data — a plain HTTP-graph GEXF has none of these edge types and would
    // otherwise get an empty panel. Evaluated on every load rather than only
    // when it changes, so going back to a plain graph hides the panel again.
    var hasInfrastructure = graph.someNode(function (key, attrs) {
      return attrs.node_type === "ip_address" || attrs.node_type === "ns_provider";
    });
    var hasISAP = Object.keys(operatorMap).length > 0 ||
                  Object.keys(clusterMap).length > 0 ||
                  Object.keys(roleSet).length > 0 ||
                  hasInfrastructure;
    investigationSection.classList.toggle("hidden", !hasISAP);
    if (!hasISAP) return;

    // Populate operator dropdown
    opSelect.innerHTML = '<option value="">All</option>';
    Object.keys(operatorMap).sort().forEach(function (op) {
      var opt = document.createElement("option");
      opt.value = op;
      opt.textContent = op.replace(/^Operator-/, "");
      opSelect.appendChild(opt);
    });

    // Populate cluster dropdown (meta-campaigns first, then children indented)
    clSelect.innerHTML = '<option value="">All</option>';
    var metaClusters = [];
    var childClusters = {};
    var standaloneClusters = [];

    Object.keys(clusterMap).sort().forEach(function (cl) {
      if (parentCluster[cl]) {
        var parent = parentCluster[cl];
        if (!childClusters[parent]) childClusters[parent] = [];
        childClusters[parent].push(cl);
      } else {
        // Check if this is a meta-campaign
        var isMeta = false;
        graph.forEachNode(function (key, attrs) {
          if (attrs.node_type === "cluster" && (attrs.label === cl || key === cl) && attrs.is_meta === "true") {
            isMeta = true;
          }
        });
        if (isMeta) metaClusters.push(cl);
        else standaloneClusters.push(cl);
      }
    });

    metaClusters.forEach(function (meta) {
      var opt = document.createElement("option");
      opt.value = meta;
      opt.textContent = meta;
      opt.style.fontWeight = "bold";
      clSelect.appendChild(opt);
      if (childClusters[meta]) {
        childClusters[meta].sort().forEach(function (child) {
          var cOpt = document.createElement("option");
          cOpt.value = child;
          cOpt.textContent = "\u00A0\u00A0\u00A0" + child;
          clSelect.appendChild(cOpt);
        });
      }
    });
    standaloneClusters.forEach(function (cl) {
      var opt = document.createElement("option");
      opt.value = cl;
      opt.textContent = cl;
      clSelect.appendChild(opt);
    });

    // Populate role checkboxes: the roles ROLE_DISPLAY knows about first, in
    // that order, then any others the graph actually carries. Driving this off
    // roleSet rather than the literal list means a role the pipeline starts
    // emitting gets a filter instead of silently becoming unfilterable.
    roleFiltersDiv.innerHTML = "";
    var rolesToShow = ROLE_DISPLAY.filter(function (role) { return roleSet[role]; })
      .concat(Object.keys(roleSet).filter(function (role) {
        return ROLE_DISPLAY.indexOf(role) === -1;
      }).sort());
    rolesToShow.forEach(function (role) {
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.dataset.role = role;
      var swatch = document.createElement("span");
      swatch.className = "role-swatch";
      swatch.style.background = ROLE_COLORS[role] || "#888";
      label.appendChild(cb);
      label.appendChild(swatch);
      label.appendChild(document.createTextNode(" " + role.replace(/_/g, " ")));
      roleFiltersDiv.appendChild(label);

      cb.addEventListener("change", function () {
        if (cb.checked) {
          hiddenRoles.delete(role);
        } else {
          hiddenRoles.add(role);
        }
        updateStats();
        if (renderer) renderer.refresh();
      });
    });

    // Operator select
    opSelect.addEventListener("change", function () {
      activeOperator = opSelect.value || null;
      activeCluster = null;
      clSelect.value = "";
      if (activeOperator) {
        activeColorMode = "operator";
        colorSelect.value = "operator";
      } else if (!activeCluster) {
        activeColorMode = "domain";
        colorSelect.value = "domain";
      }
      buildInvestigationFocusSet();
      updateStats();
      if (renderer) renderer.refresh();
      restartFA2IfRunning();
    });

    // Cluster select
    clSelect.addEventListener("change", function () {
      activeCluster = clSelect.value || null;
      activeOperator = null;
      opSelect.value = "";
      if (activeCluster) {
        activeColorMode = "cluster";
        colorSelect.value = "cluster";
      } else if (!activeOperator) {
        activeColorMode = "domain";
        colorSelect.value = "domain";
      }
      buildInvestigationFocusSet();
      updateStats();
      if (renderer) renderer.refresh();
      restartFA2IfRunning();
    });

    // Color-by select. No updateStats() here: this only recolours nodes, it
    // never changes which are visible, unlike the four handlers above.
    colorSelect.addEventListener("change", function () {
      activeColorMode = colorSelect.value || "domain";
      if (renderer) renderer.refresh();
    });

    // Infrastructure toggle
    infraToggle.addEventListener("change", function () {
      showInfrastructure = infraToggle.checked;
      if (showInfrastructure && activeColorMode === "domain") {
        activeColorMode = "infrastructure";
        colorSelect.value = "infrastructure";
      } else if (!showInfrastructure && activeColorMode === "infrastructure") {
        activeColorMode = "domain";
        colorSelect.value = "domain";
      }
      updateStats();
      if (renderer) renderer.refresh();
      restartFA2IfRunning();
    });
  }

  // ── Reset ──────────────────────────────────────────────────────────
  btnReset.addEventListener("click", function () {
    focusSet = null;
    hiddenTypes.clear();
    hiddenDomains.clear();
    hiddenContentGroups.clear();
    manuallyHidden.clear();
    expandedHosts.clear();
    bundleEnabled = true;
    bundleToggle.checked = true;
    showHidden = false;
    showHiddenCb.checked = false;
    activeOperator = null;
    activeCluster = null;
    activeColorMode = "domain";
    hiddenRoles.clear();
    showInfrastructure = false;
    investigationFocusSet = null;
    rebuildBundles();
    updateHiddenCount();
    selectedNode = null;
    highlightMap = null;
    domainFilterInput.value = "";
    domainFilterText = "";
    searchInput.value = "";

    // Re-check all type checkboxes
    typeFiltersDiv.querySelectorAll("input").forEach(function (cb) { cb.checked = true; });
    contentFiltersDiv.querySelectorAll("input").forEach(function (cb) { cb.checked = true; });
    domainFiltersDiv.querySelectorAll("input").forEach(function (cb) { cb.checked = true; });
    domainFiltersDiv.querySelectorAll("label").forEach(function (lbl) { lbl.style.display = ""; });

    // Reset investigation controls
    var opSelect = document.getElementById("operator-select");
    var clSelect = document.getElementById("cluster-select");
    var colorSelect = document.getElementById("color-select");
    var infraToggle = document.getElementById("infra-toggle");
    if (opSelect) opSelect.value = "";
    if (clSelect) clSelect.value = "";
    if (colorSelect) colorSelect.value = "domain";
    if (infraToggle) infraToggle.checked = false;
    var roleChecks = document.querySelectorAll("#role-filters input");
    roleChecks.forEach(function (cb) { cb.checked = true; });

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
      rebuildHighlightMap();
      container.style.cursor = "pointer";
      showTooltip(payload.node, payload.event);
      renderer.refresh();
    });

    renderer.on("leaveNode", function () {
      hoveredNode = null;
      rebuildHighlightMap();
      container.style.cursor = "default";
      tooltip.classList.add("hidden");
      renderer.refresh();
    });
  }

  function showTooltip(nodeKey, event) {
    var attrs = graph.getNodeAttributes(nodeKey);
    var html = '<div class="tt-label">' + escapeHtml(attrs.label || nodeKey) + '</div>';

    var fields = ["node_type", "node_role", "domain", "operator", "cluster", "status_code", "content_type", "asn_org"];
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
      rebuildHighlightMap();
      showNodeInfo(event.node);
      renderer.refresh();
    });
    renderer.on("clickEdge", function (event) {
      showEdgeInfo(event.edge);
    });
  }

  function showEdgeInfo(edgeKey) {
    var infoTitle = document.getElementById("info-title");
    if (infoTitle) infoTitle.textContent = "Edge Info";
    var attrs = graph.getEdgeAttributes(edgeKey);
    var source = graph.source(edgeKey);
    var target = graph.target(edgeKey);
    var sAttrs = graph.getNodeAttributes(source);
    var tAttrs = graph.getNodeAttributes(target);
    var edgeType = attrs.edge_type || "";

    var html = "";
    html += '<div class="info-row"><span class="attr-key">edge type</span><span class="attr-val">' + infoBadge(edgeType, theme.accentYellow) + '</span></div>';
    html += '<div class="info-row"><span class="attr-key">source</span><span class="attr-val">' + infoClickable(sAttrs.label || source, sAttrs.node_type === "domain" ? "domain" : "node", source) + ' <span style="color:' + theme.textMuted + '">(' + (sAttrs.node_type || "") + ')</span></span></div>';
    html += '<div class="info-row"><span class="attr-key">target</span><span class="attr-val">' + infoClickable(tAttrs.label || target, tAttrs.node_type === "domain" ? "domain" : "node", target) + ' <span style="color:' + theme.textMuted + '">(' + (tAttrs.node_type || "") + ')</span></span></div>';

    if (attrs.status_code) html += '<div class="info-row"><span class="attr-key">status</span><span class="attr-val">' + escapeHtml(String(attrs.status_code)) + '</span></div>';
    if (attrs.redirect_type) html += '<div class="info-row"><span class="attr-key">redirect type</span><span class="attr-val">' + escapeHtml(attrs.redirect_type) + '</span></div>';
    if (attrs.chain_status) html += '<div class="info-row"><span class="attr-key">chain status</span><span class="attr-val">' + escapeHtml(attrs.chain_status) + '</span></div>';
    if (attrs.status) html += '<div class="info-row"><span class="attr-key">status</span><span class="attr-val">' + escapeHtml(attrs.status) + '</span></div>';
    if (attrs.shared_ip) html += '<div class="info-row"><span class="attr-key">shared IP</span><span class="attr-val">' + escapeHtml(attrs.shared_ip) + '</span></div>';
    if (attrs.shell_name) html += '<div class="info-row"><span class="attr-key">shell</span><span class="attr-val">' + escapeHtml(attrs.shell_name) + '</span></div>';
    if (attrs.weight && Number(attrs.weight) > 1) html += '<div class="info-row"><span class="attr-key">weight</span><span class="attr-val">' + escapeHtml(String(attrs.weight)) + '</span></div>';

    if (attrs.first_seen || attrs.last_seen) {
      html += infoSection("Temporal");
      if (attrs.first_seen) html += '<div class="info-row"><span class="attr-key">first seen</span><span class="attr-val">' + escapeHtml(attrs.first_seen) + '</span></div>';
      if (attrs.last_seen) html += '<div class="info-row"><span class="attr-key">last seen</span><span class="attr-val">' + escapeHtml(attrs.last_seen) + '</span></div>';
    }

    infoContent.innerHTML = html;
    infoPanel.classList.remove("hidden");

    // Wire up clickable links
    infoPanel.querySelectorAll(".info-link").forEach(function (link) {
      link.addEventListener("click", function () {
        var linkType = link.dataset.type;
        var linkValue = link.dataset.value;
        if (linkType === "domain") {
          selectedNode = linkValue;
          rebuildHighlightMap();
          var pos = renderer.getNodeDisplayData(linkValue);
          if (pos) renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.3 }, { duration: 400 });
          showNodeInfo(linkValue);
          renderer.refresh();
        } else if (linkType === "node") {
          selectedNode = linkValue;
          rebuildHighlightMap();
          var pos2 = renderer.getNodeDisplayData(linkValue);
          if (pos2) renderer.getCamera().animate({ x: pos2.x, y: pos2.y, ratio: 0.3 }, { duration: 400 });
          showNodeInfo(linkValue);
          renderer.refresh();
        } else if (linkType === "operator") {
          var opSelect = document.getElementById("operator-select");
          if (opSelect) { opSelect.value = linkValue; opSelect.dispatchEvent(new Event("change")); }
        } else if (linkType === "cluster") {
          var clSelect = document.getElementById("cluster-select");
          if (clSelect) { clSelect.value = linkValue; clSelect.dispatchEvent(new Event("change")); }
        }
      });
    });
  }

  function findOperatorForDomain(domainKey) {
    for (var op in operatorMap) {
      if (operatorMap[op].has(domainKey)) return op;
    }
    return null;
  }

  function findClustersForDomain(domainKey) {
    var clusters = [];
    for (var cl in clusterMap) {
      if (clusterMap[cl].has(domainKey)) clusters.push(cl);
    }
    return clusters;
  }

  function findIPsForDomain(domainKey) {
    var ips = [];
    graph.forEachOutNeighbor(domainKey, function (neighbor) {
      var nAttrs = graph.getNodeAttributes(neighbor);
      if (nAttrs.node_type === "ip_address") {
        ips.push({ key: neighbor, address: nAttrs.label || neighbor, asn_org: nAttrs.asn_org || "" });
      }
    });
    return ips;
  }

  function findNSForDomain(domainKey) {
    var ns = [];
    graph.forEachOutNeighbor(domainKey, function (neighbor) {
      var nAttrs = graph.getNodeAttributes(neighbor);
      if (nAttrs.node_type === "ns_provider") {
        ns.push({ key: neighbor, name: nAttrs.label || neighbor });
      }
    });
    return ns;
  }

  function findCoHosted(domainKey) {
    var cohosted = [];
    graph.forEachNeighbor(domainKey, function (neighbor) {
      var nAttrs = graph.getNodeAttributes(neighbor);
      if (nAttrs.node_type === "domain") {
        // Check if connected via shares_host edge
        var edges = graph.edges(domainKey, neighbor).concat(graph.edges(neighbor, domainKey));
        edges.forEach(function (e) {
          if (graph.getEdgeAttribute(e, "edge_type") === "shares_host") {
            var ip = graph.getEdgeAttribute(e, "shared_ip") || "";
            cohosted.push({ key: neighbor, name: nAttrs.label || neighbor, ip: ip });
          }
        });
      }
    });
    return cohosted;
  }

  function infoClickable(label, type, value) {
    return '<span class="info-link" data-type="' + type + '" data-value="' + escapeHtml(value) + '">' + escapeHtml(label) + '</span>';
  }

  function infoSection(title) {
    return '<div class="info-section-title">' + escapeHtml(title) + '</div>';
  }

  function infoBadge(text, color) {
    return '<span class="info-badge" style="background:' + color + '">' + escapeHtml(text) + '</span>';
  }

  function showNodeInfo(nodeKey) {
    var infoTitle = document.getElementById("info-title");
    if (infoTitle) infoTitle.textContent = "Node Info";
    var attrs = graph.getNodeAttributes(nodeKey);
    var html = "";
    var nodeType = attrs.node_type || "";

    // Header with node type badge
    var typeColor = TYPE_COLORS[nodeType] || theme.textMuted;
    html += '<div class="info-row"><span class="attr-key">id</span><span class="attr-val">' + escapeHtml(nodeKey) + '</span></div>';
    html += '<div class="info-row"><span class="attr-key">type</span><span class="attr-val">' + infoBadge(nodeType, typeColor) + '</span></div>';

    if (nodeType === "domain") {
      // Identity
      if (attrs.status) html += '<div class="info-row"><span class="attr-key">status</span><span class="attr-val">' + escapeHtml(attrs.status) + '</span></div>';
      if (attrs.domain_type) html += '<div class="info-row"><span class="attr-key">domain type</span><span class="attr-val">' + escapeHtml(attrs.domain_type) + '</span></div>';
      if (attrs.registrar) html += '<div class="info-row"><span class="attr-key">registrar</span><span class="attr-val">' + escapeHtml(attrs.registrar) + '</span></div>';
      if (attrs.creation_date) html += '<div class="info-row"><span class="attr-key">created</span><span class="attr-val">' + escapeHtml(attrs.creation_date) + '</span></div>';

      // Attribution
      html += infoSection("Attribution");
      var op = findOperatorForDomain(nodeKey);
      if (op) {
        html += '<div class="info-row"><span class="attr-key">operator</span><span class="attr-val">' + infoClickable(op.replace(/^Operator-/, ""), "operator", op) + '</span></div>';
      }
      var clusters = findClustersForDomain(nodeKey);
      if (clusters.length > 0) {
        html += '<div class="info-row"><span class="attr-key">clusters</span><span class="attr-val">' + clusters.map(function (c) { return infoClickable(c, "cluster", c); }).join(", ") + '</span></div>';
      }
      if (attrs.escalation === "true") {
        html += '<div class="info-row"><span class="attr-key">escalation</span><span class="attr-val">' + infoBadge("ESCALATED", theme.red) + '</span></div>';
      }
      if (attrs.techniques) {
        html += '<div class="info-row"><span class="attr-key">techniques</span><span class="attr-val">' + escapeHtml(attrs.techniques) + '</span></div>';
      }

      // Infrastructure
      var ips = findIPsForDomain(nodeKey);
      var ns = findNSForDomain(nodeKey);
      var cohosted = findCoHosted(nodeKey);
      if (ips.length > 0 || ns.length > 0 || cohosted.length > 0) {
        html += infoSection("Infrastructure");
        ips.forEach(function (ip) {
          html += '<div class="info-row"><span class="attr-key">IP</span><span class="attr-val">' + escapeHtml(ip.address) + (ip.asn_org ? ' <span style="color:' + theme.textMuted + '">(' + escapeHtml(ip.asn_org) + ')</span>' : '') + '</span></div>';
        });
        ns.forEach(function (n) {
          html += '<div class="info-row"><span class="attr-key">NS</span><span class="attr-val">' + escapeHtml(n.name) + '</span></div>';
        });
        cohosted.forEach(function (ch) {
          html += '<div class="info-row"><span class="attr-key">co-hosted</span><span class="attr-val">' + infoClickable(ch.name, "domain", ch.key) + (ch.ip ? ' <span style="color:' + theme.textMuted + '">(' + escapeHtml(ch.ip) + ')</span>' : '') + '</span></div>';
        });
      }

      // Temporal
      html += infoSection("Temporal");
      if (attrs.first_seen) html += '<div class="info-row"><span class="attr-key">first seen</span><span class="attr-val">' + escapeHtml(attrs.first_seen) + '</span></div>';
      if (attrs.last_seen) html += '<div class="info-row"><span class="attr-key">last seen</span><span class="attr-val">' + escapeHtml(attrs.last_seen) + '</span></div>';
      if (attrs.visited) html += '<div class="info-row"><span class="attr-key">visited</span><span class="attr-val">' + escapeHtml(String(attrs.visited)) + '</span></div>';

    } else if (nodeType === "resource") {
      // Identity
      if (attrs.status_code) html += '<div class="info-row"><span class="attr-key">status</span><span class="attr-val">' + escapeHtml(String(attrs.status_code)) + '</span></div>';
      if (attrs.node_role) {
        var roleColor = ROLE_COLORS[attrs.node_role] || theme.textMuted;
        html += '<div class="info-row"><span class="attr-key">role</span><span class="attr-val">' + infoBadge(attrs.node_role.replace(/_/g, " "), roleColor) + '</span></div>';
      }
      if (attrs.cloaking) html += '<div class="info-row"><span class="attr-key">cloaking</span><span class="attr-val">' + infoBadge("CLOAKED", theme.red) + '</span></div>';

      // Chain with role labels
      var chain = getRedirectChain(nodeKey);
      if (chain.length > 1) {
        var chainHtml = chain.map(function (rid, i) {
          var rAttrs = graph.getNodeAttributes(rid);
          var role = rAttrs.node_role || "";
          var roleTag = role ? infoBadge(role.replace(/_/g, " "), ROLE_COLORS[role] || theme.textMuted) + " " : "";
          var label = rid === nodeKey ? '<b>' + escapeHtml(rid) + '</b>' : escapeHtml(rid);
          var status = "";
          if (i < chain.length - 1) {
            var edges = graph.edges(rid, chain[i + 1]);
            if (edges.length > 0) {
              var sc = graph.getEdgeAttribute(edges[0], "status_code");
              if (sc) status = ' <span style="color:' + theme.accentYellow + '">[' + sc + ']</span>';
            }
          }
          return roleTag + label + status;
        }).join(' &rarr; ');
        html += '<div class="info-row" style="flex-direction:column"><span class="attr-key">redirect chain (' + chain.length + ' hops)</span><span class="attr-val" style="font-size:11px;line-height:1.6">' + chainHtml + '</span></div>';
      }

      // Temporal
      if (attrs.first_seen) html += '<div class="info-row"><span class="attr-key">first seen</span><span class="attr-val">' + escapeHtml(attrs.first_seen) + '</span></div>';
      if (attrs.last_seen) html += '<div class="info-row"><span class="attr-key">last seen</span><span class="attr-val">' + escapeHtml(attrs.last_seen) + '</span></div>';

    } else if (nodeType === "operator") {
      if (attrs.technique_set) html += '<div class="info-row"><span class="attr-key">techniques</span><span class="attr-val">' + escapeHtml(attrs.technique_set) + '</span></div>';
      if (attrs.infrastructure) html += '<div class="info-row"><span class="attr-key">infrastructure</span><span class="attr-val">' + escapeHtml(attrs.infrastructure) + '</span></div>';
      if (attrs.domain_count) html += '<div class="info-row"><span class="attr-key">domains</span><span class="attr-val">' + escapeHtml(String(attrs.domain_count)) + '</span></div>';

      // Attributed domains
      var opDomains = operatorMap[attrs.label || nodeKey];
      if (opDomains && opDomains.size > 0) {
        html += infoSection("Attributed Domains");
        opDomains.forEach(function (dKey) {
          var dAttrs = graph.getNodeAttributes(dKey);
          html += '<div class="info-row"><span class="attr-val">' + infoClickable(dAttrs.label || dKey, "domain", dKey) + '</span></div>';
        });
      }

      // Tokens
      var tokens = [];
      graph.forEachOutNeighbor(nodeKey, function (neighbor) {
        var nAttrs = graph.getNodeAttributes(neighbor);
        if (nAttrs.node_type === "token") tokens.push(nAttrs.label || neighbor);
      });
      if (tokens.length > 0) {
        html += infoSection("Tokens");
        tokens.forEach(function (t) {
          html += '<div class="info-row"><span class="attr-val">' + escapeHtml(t) + '</span></div>';
        });
      }

      if (attrs.last_active) html += '<div class="info-row"><span class="attr-key">last active</span><span class="attr-val">' + escapeHtml(attrs.last_active) + '</span></div>';

    } else if (nodeType === "cluster") {
      if (attrs.display_name) html += '<div class="info-row"><span class="attr-key">display name</span><span class="attr-val">' + escapeHtml(attrs.display_name) + '</span></div>';
      if (attrs.status) html += '<div class="info-row"><span class="attr-key">status</span><span class="attr-val">' + escapeHtml(attrs.status) + '</span></div>';
      if (attrs.target_sector) html += '<div class="info-row"><span class="attr-key">sector</span><span class="attr-val">' + escapeHtml(attrs.target_sector) + '</span></div>';
      if (attrs.geography) html += '<div class="info-row"><span class="attr-key">geography</span><span class="attr-val">' + escapeHtml(attrs.geography) + '</span></div>';
      if (attrs.is_meta === "true") html += '<div class="info-row"><span class="attr-key">type</span><span class="attr-val">' + infoBadge("META-CAMPAIGN", theme.accentCyan) + '</span></div>';

      // Member domains
      var clDomains = clusterMap[attrs.label || nodeKey];
      if (clDomains && clDomains.size > 0) {
        html += infoSection("Members (" + clDomains.size + " domains)");
        clDomains.forEach(function (dKey) {
          var dAttrs = graph.getNodeAttributes(dKey);
          html += '<div class="info-row"><span class="attr-val">' + infoClickable(dAttrs.label || dKey, "domain", dKey) + '</span></div>';
        });
      }

      // Parent meta-campaign
      var parent = parentCluster[attrs.label || nodeKey];
      if (parent) {
        html += '<div class="info-row"><span class="attr-key">parent</span><span class="attr-val">' + infoClickable(parent, "cluster", parent) + '</span></div>';
      }

    } else if (nodeType === "ip_address") {
      if (attrs.asn) html += '<div class="info-row"><span class="attr-key">ASN</span><span class="attr-val">' + escapeHtml(attrs.asn) + '</span></div>';
      if (attrs.asn_org) html += '<div class="info-row"><span class="attr-key">ASN org</span><span class="attr-val">' + escapeHtml(attrs.asn_org) + '</span></div>';
      // Domains hosted here
      var hostedDomains = [];
      graph.forEachInNeighbor(nodeKey, function (neighbor) {
        var nAttrs = graph.getNodeAttributes(neighbor);
        if (nAttrs.node_type === "domain") hostedDomains.push({ key: neighbor, name: nAttrs.label || neighbor });
      });
      if (hostedDomains.length > 0) {
        html += infoSection("Hosted Domains (" + hostedDomains.length + ")");
        hostedDomains.forEach(function (d) {
          html += '<div class="info-row"><span class="attr-val">' + infoClickable(d.name, "domain", d.key) + '</span></div>';
        });
      }

    } else if (nodeType === "ns_provider") {
      var nsDomains = [];
      graph.forEachInNeighbor(nodeKey, function (neighbor) {
        var nAttrs = graph.getNodeAttributes(neighbor);
        if (nAttrs.node_type === "domain") nsDomains.push({ key: neighbor, name: nAttrs.label || neighbor });
      });
      if (nsDomains.length > 0) {
        html += infoSection("Domains Using This NS (" + nsDomains.length + ")");
        nsDomains.forEach(function (d) {
          html += '<div class="info-row"><span class="attr-val">' + infoClickable(d.name, "domain", d.key) + '</span></div>';
        });
      }

    } else {
      // Generic fallback for other node types
      var skip = new Set(["x", "y", "z", "size", "color", "viz", "hidden", "highlighted", "zIndex", "node_type"]);
      Object.keys(attrs).forEach(function (k) {
        if (skip.has(k)) return;
        if (attrs[k] == null || attrs[k] === "") return;
        if (typeof attrs[k] === "object") return;
        html += '<div class="info-row"><span class="attr-key">' + escapeHtml(k) + '</span><span class="attr-val">' + escapeHtml(String(attrs[k])) + '</span></div>';
      });
    }

    // Connections (always shown)
    var neighbors = graph.neighbors(nodeKey).length;
    var inDeg = graph.inDegree(nodeKey);
    var outDeg = graph.outDegree(nodeKey);
    html += '<div class="info-row"><span class="attr-key">connections</span><span class="attr-val">' + neighbors + ' (in:' + inDeg + ' out:' + outDeg + ')</span></div>';

    infoContent.innerHTML = html;
    infoPanel.classList.remove("hidden");

    // Wire up clickable links in the panel
    infoPanel.querySelectorAll(".info-link").forEach(function (link) {
      link.addEventListener("click", function () {
        var linkType = link.dataset.type;
        var linkValue = link.dataset.value;

        if (linkType === "operator") {
          var opSelect = document.getElementById("operator-select");
          if (opSelect) { opSelect.value = linkValue; opSelect.dispatchEvent(new Event("change")); }
        } else if (linkType === "cluster") {
          var clSelect = document.getElementById("cluster-select");
          if (clSelect) { clSelect.value = linkValue; clSelect.dispatchEvent(new Event("change")); }
        } else if (linkType === "domain") {
          // Navigate to domain node
          selectedNode = linkValue;
          rebuildHighlightMap();
          var pos = renderer.getNodeDisplayData(linkValue);
          if (pos) {
            renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.3 }, { duration: 400 });
          }
          showNodeInfo(linkValue);
          renderer.refresh();
        }
      });
    });
  }

  // ── Context Menu (right-click) ──────────────────────────────────
  var contextTarget = null;

  function setupContextMenu() {
    renderer.on("rightClickNode", function (payload) {
      payload.event.original.preventDefault();
      contextTarget = payload.node;
      var attrs = graph.getNodeAttributes(payload.node);
      var isHidden = manuallyHidden.has(payload.node);
      var menuHtml =
        '<div class="menu-label">' + escapeHtml(attrs.label || payload.node) + '</div>' +
        '<div class="menu-item" data-action="' + (isHidden ? "unhide" : "hide") + '">' +
          (isHidden ? "Unhide node" : "Hide node") +
        '</div>' +
        '<div class="menu-item" data-action="hide-neighbors">Hide neighbors</div>';
      if (attrs.node_type === "bundle" && attrs.bundleHost) {
        menuHtml += '<div class="menu-item" data-action="expand-bundle">Expand resources</div>';
      } else if (attrs.node_type === "host" && bundleEnabled) {
        var isExpanded = expandedHosts.has(payload.node);
        menuHtml += '<div class="menu-item" data-action="' + (isExpanded ? "collapse-host" : "expand-host") + '">' +
          (isExpanded ? "Collapse resources" : "Expand resources") + '</div>';
      }
      contextMenu.innerHTML = menuHtml;
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
    } else if (action === "expand-bundle" || action === "expand-host") {
      var host = action === "expand-bundle"
        ? graph.getNodeAttribute(contextTarget, "bundleHost")
        : contextTarget;
      if (host) { expandedHosts.add(host); rebuildBundles(); }
    } else if (action === "collapse-host") {
      expandedHosts.delete(contextTarget);
      rebuildBundles();
    }

    updateHiddenCount();
    contextMenu.classList.add("hidden");
    contextTarget = null;
    if (renderer) renderer.refresh();
    restartFA2IfRunning();
  });

  // Bundle toggle
  bundleToggle.addEventListener("change", function () {
    bundleEnabled = bundleToggle.checked;
    rebuildBundles();
    updateStats();
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

  // The extension popup's "Open Viewer" button hands the extension ID over as
  // ?ext=<id> so it doesn't have to be copied by hand. Validate it against the
  // Chrome extension ID shape before trusting it — it goes to
  // chrome.runtime.connect(). Strip it from the URL afterwards so a reload or
  // bookmark can't silently override an ID the user later typed by hand.
  (function () {
    var urlExtId = new URLSearchParams(location.search).get("ext");
    if (!urlExtId) return;
    if (/^[a-p]{32}$/.test(urlExtId)) {
      extIdInput.value = urlExtId;
      localStorage.setItem("httpgraph-ext-id", urlExtId);
    } else {
      console.warn("Ignoring malformed ext id in URL:", urlExtId);
    }
    var url = new URL(location.href);
    url.searchParams.delete("ext");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  })();

  var liveReconnects = 0;

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
      liveReconnects = 0; // healthy — reset retry counter
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
      livePort = null;
      stopKeepAlive();
      if (liveMode && liveReconnects < 5) {
        liveReconnects++;
        liveStatus.textContent = "Reconnecting (" + liveReconnects + "/5)...";
        liveStatus.className = "error";
        setTimeout(function () { if (liveMode && !livePort) connectLive(extId); }, 2000);
        return;
      }
      liveStatus.textContent = err ? "Disconnected: " + err.message : "Disconnected";
      liveStatus.className = "disconnected";
      btnLive.textContent = "Connect";
      btnLive.classList.remove("active");
      liveMode = false;
    });

    startKeepAlive();
    liveStatus.textContent = "Connected";
    liveStatus.className = "connected";
    btnLive.textContent = "Disconnect";
    btnLive.classList.add("active");

    // Only create renderer if one doesn't exist (graph already loaded)
    if (!renderer) {
      initRenderer({ autoStartFA2: false });
    }

  }

  // Keep the extension service worker alive by pinging every 25s
  var keepAliveTimer = null;
  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(function () {
      if (livePort) {
        try { livePort.postMessage({ type: "ping" }); }
        catch (e) { /* onDisconnect will handle it */ }
      }
    }, 25000);
  }
  function stopKeepAlive() {
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
  }

  function disconnectLive() {
    liveMode = false; // set before disconnect to prevent auto-reconnect
    stopKeepAlive();
    if (livePort) {
      livePort.disconnect();
      livePort = null;
    }
    if (liveRefreshTimer) {
      clearTimeout(liveRefreshTimer);
      liveRefreshTimer = null;
    }
  }

  function scheduleLiveRefresh() {
    if (liveRefreshTimer) return;
    liveRefreshTimer = setTimeout(function () {
      liveRefreshTimer = null;
      if (graphGrew) rebuildBundles();
      updateStats();
      if (renderer) {
        setupSearch();
        setupTypeFilters();
        setupContentFilters();
        setupDomainFilters();
        renderer.refresh();
      }
      // Wake or restart FA2 when new visible nodes were added
      if (graphGrew && (fa2Idle || fa2Running)) {
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
      maxVisitedCount = 1;
      graph.forEachNode(function (key, attrs) {
        if (originalSizes[key] == null) originalSizes[key] = attrs.size || 3;
        var v = Number(attrs.visited) || 1;
        if (v > maxVisitedCount) maxVisitedCount = v;
      });
      // Rebuild redirect chains from edge attributes
      redirectNext = {};
      redirectPrev = {};
      graph.forEachEdge(function (edge, attrs, source, target) {
        if (attrs.edge_type === "redirect") {
          redirectNext[source] = target;
          if (!redirectPrev[target]) redirectPrev[target] = source;
        }
      });
      buildISAPIndexes();
      initRenderer({ autoStartFA2: false });
    }
  }).catch(function () {}).finally(function () {
    // Restore auto-connect preference (default to on for first visit)
    var acPref = localStorage.getItem("hg-auto-connect");
    autoConnectCb.checked = acPref === null ? true : acPref === "1";
    // Auto-connect if extension ID is saved and checkbox is on
    var savedId = extIdInput.value.trim();
    if (savedId && autoConnectCb.checked) {
      setTimeout(function () { connectLive(savedId); }, 500);
    }
  });

  autoConnectCb.addEventListener("change", function () {
    localStorage.setItem("hg-auto-connect", autoConnectCb.checked ? "1" : "0");
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
