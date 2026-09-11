## HTTP Graph Collector

**HTTP Graph Collector** builds a live, interactive graph of web relationships as you browse. Watch domains, hosts, and resources connect in real time — see how sites load dependencies, where redirects go, and which third parties are involved.

### Live Viewer

Click **Open Viewer** in the extension popup. It opens [nullphase.net/hg](https://nullphase.net/hg) with your extension ID already handed over, so all that is left is Connect — tick Auto-connect and even that goes away. Opening the viewer on its own still works: click the ID in the popup to copy it, and paste it in. Every HTTP request you make instantly appears as a node in the graph. Domains are automatically colored, and the force-directed layout organizes the structure as it grows. All data stays local to your browser — the viewer page talks directly to the extension through Chrome's messaging API. Nothing is sent over the network.

Install the extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/http-graph-collector/lkkdeokncfjlinldgikoabgknklnnkoe).

### Viewer Features

- ForceAtlas2 force-directed layout with adjustable repulsion, gravity, and Barnes-Hut optimization (runs in a web worker for large graphs)
- Circular and hierarchical layout options
- Search with autocomplete — camera flies to matching nodes
- Focus mode — isolate any node's N-hop neighborhood
- Filter by node type (client, domain, host, resource) or by domain
- Right-click nodes to hide them or their neighbors
- Size nodes by visit count (linear or logarithmic scale)
- Hover for tooltips, click for full attribute detail
- Export your graph as GEXF — reopen it here, or take it to Gephi
- Handles large graphs — tested with 300K+ nodes

### GEXF File Loading

Already have a GEXF file? Load it directly into the viewer without the extension. The viewer preserves colors, sizes, and all node attributes from the file.

### Offline Collection

The extension also POSTs JSON request records to a configurable localhost REST API (default port 65444). Run [httpgraph-logger.py](httpgraph-logger.py) to collect them and [httpgraph-builder.py](httpgraph-builder.py) to turn the log into a GEXF file — no Gephi required, and the viewer above will open the result. The same records are accepted by the original [HTTP Graph](https://github.com/phreakocious/gephi-plugins/tree/master/modules/HttpGraph) plugin if you do want Gephi. Nothing listening? The extension backs off after a few failed attempts and keeps probing, so leaving the port unused costs nothing.

![sample of httpgraph-logger.py output](https://github.com/phreakocious/HTTP-Graph-Collector/blob/main/httpgraph-logger_screenshot.png?raw=true)

### Collection Controls

- Pause and resume collection with one click
- Domain include/exclude lists to focus on specific sites or filter out noise (an include list takes precedence — set one and the exclude list is ignored)
- URL parameter scrubbing to reduce exposure of sensitive query strings
- Request timing (duration in milliseconds)

### Privacy

The extension reads HTTP request metadata as you browse — URLs, status codes, content types, timing — and that is what the graph is built from. It goes to two places, both of them yours: the viewer tab, over Chrome's extension messaging API, which never crosses the network; and `127.0.0.1` if you are running the included Python collector. No remote server, no analytics in the extension, no account. Broad host permissions are needed to see requests across all sites, but nothing is collected while collection is paused, and the domain lists narrow what is collected at all.

The only thing the extension stores is your settings — port, scrub toggle, pause state, and the two domain lists — in Chrome's local extension storage. Your traffic is never written there. The viewer holds the current graph and your extension ID in the browser's own storage, on your device: Clear erases the graph, and uninstalling the extension deletes its settings.

Opening the viewer at `nullphase.net/hg` pulls the page and the app itself, and nothing else. No fonts, no libraries, no analytics, no trackers from anywhere — every file the page needs is served beside it. No graph data is part of that request, and none is ever uploaded. If you would rather not make the request at all, the viewer runs from localhost straight out of the repository.

### Graph Structure

Each browsed page creates a hierarchy of nodes: client → domain → host → resource, with edges representing the relationships between them. Initiator and referer data connect cross-origin dependencies. Redirects create resource-to-resource edges. Each domain gets a unique color from a 41-color palette, making clusters visually distinct.

### License

MIT — see [LICENSE](LICENSE).
