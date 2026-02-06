#!/usr/bin/env python3

##########################
# httpgraph-builder.py  #
# phreakocious, 2/2025 #
#######################

#
# Reads JSON logs from httpgraph-logger.py and builds a GEXF graph file
# Portable replacement for the Gephi/HTTP Graph Java plugin graph model
#

import json
import hashlib
import colorsys
from collections import deque
from urllib.parse import urlparse
from argparse import ArgumentParser

import tldextract
import networkx as nx
from tqdm import tqdm

MAXLABEL = 32


def generate_colors():
    """Generate the color palette matching HttpGraph.java (26 HSB hues + 15 grayscale)."""
    colors = deque()
    n = 26
    for i in range(n):
        r, g, b = colorsys.hsv_to_rgb(i / n, 0.85, 0.93)
        colors.append((int(r * 255), int(g * 255), int(b * 255)))
    for i in range(32, 201, 12):
        colors.append((i, i, i))
    return colors


COLOR_LOCALDOMAIN = (236, 236, 236)
COLOR_DEFAULT = (212, 212, 212)


class GraphBuilder:
    DEFAULT_CLIENT = "localhost"

    def __init__(self, include_ip=False, include_params=False):
        self.G = nx.DiGraph()
        self.colors = generate_colors()
        self.colormap = {"localdomain": COLOR_LOCALDOMAIN}
        self.include_ip = include_ip
        self.include_params = include_params
        self.edge_weights = {}
        self.skipped_json = 0
        self.skipped_url = 0

    def assign_color(self, domain):
        """Assign a color to a domain, first-come-first-served from the palette."""
        if domain not in self.colormap:
            if self.colors:
                self.colormap[domain] = self.colors.popleft()
            else:
                self.colormap[domain] = COLOR_DEFAULT
        return self.colormap[domain]

    def parse_domain(self, hostname):
        """Extract registered domain using tldextract, with '.' suffix to prevent ID collision."""
        ext = tldextract.extract(hostname)
        registered = ext.top_domain_under_public_suffix
        if registered:
            return registered + "."
        # bare IP or single-label hostname
        if hostname:
            return hostname + "."
        return "localdomain"

    def format_label(self, url):
        """Truncate label to MAXLABEL chars, matching Java formatLabel()."""
        label = url.split("/", 1)
        label = "/" + label[1] if len(label) > 1 else url
        if len(label) > MAXLABEL:
            label = "... " + label[-MAXLABEL:]
        return label

    def make_edge_id(self, src_id, dst_id):
        """Deterministic edge ID from src+dst using sha256."""
        return hashlib.sha256((src_id + dst_id).encode()).hexdigest()[:16]

    def add_node(self, node_id, node_type, domain, size, label=None, **attrs):
        """Add a node if it doesn't exist (FIRST wins). Increment visited count."""
        if node_id in self.G:
            self.G.nodes[node_id]["visited"] = self.G.nodes[node_id].get("visited", 1) + 1
            return
        color = self.assign_color(domain)
        if label is None:
            label = node_id
        self.G.add_node(
            node_id,
            label=label,
            node_type=node_type,
            domain=domain,
            visited=1,
            viz={"color": {"r": color[0], "g": color[1], "b": color[2], "a": 1.0}, "size": size},
            **attrs,
        )

    def add_edge(self, src_id, dst_id):
        """Add a directed edge, incrementing weight on duplicates. Skip self-loops."""
        if src_id == dst_id:
            return
        # both nodes must exist
        if src_id not in self.G or dst_id not in self.G:
            return
        edge_key = (src_id, dst_id)
        if edge_key in self.edge_weights:
            self.edge_weights[edge_key] += 1
            self.G[src_id][dst_id]["weight"] = self.edge_weights[edge_key]
        else:
            self.edge_weights[edge_key] = 1
            eid = self.make_edge_id(src_id, dst_id)
            self.G.add_edge(src_id, dst_id, id=eid, weight=1)

    def _ensure_resource_hierarchy(self, url_str):
        """Parse a URL and ensure its domain, host, and resource nodes exist.
        Returns (resource_id, host, domain) or None if the URL is invalid."""
        parsed = urlparse(url_str)
        if parsed.scheme not in ("http", "https"):
            return None
        hostname = parsed.hostname or ""
        if not hostname:
            return None

        host = hostname
        domain = self.parse_domain(host)
        resource_id = host + parsed.path

        self.add_node(domain, "domain", domain, 6.0)
        self.add_node(host, "host", domain, 4.0)
        self.add_node(
            resource_id, "resource", domain, 3.0,
            label=self.format_label(resource_id),
        )
        self.add_edge(domain, host)
        self.add_edge(host, resource_id)

        return resource_id, host, domain

    def process_record(self, record):
        """Process one JSON record into graph nodes and edges."""
        edge_type = record.get("edge_type")
        if edge_type == "redirect":
            self._process_redirect(record)
            return

        url_str = record.get("url")
        if not url_str:
            return

        parsed = urlparse(url_str)
        if parsed.scheme not in ("http", "https"):
            return

        hostname = parsed.hostname or ""
        if not hostname:
            return

        # strip port from hostname
        host = hostname
        domain = self.parse_domain(host)

        method = record.get("method", "")
        protocol = parsed.scheme
        resource_id = host + parsed.path

        # bytes can be string in JSON
        try:
            nbytes = int(record.get("bytes", 0))
        except (ValueError, TypeError):
            nbytes = 0

        req_type = record.get("type", "")
        content_type = record.get("content_type", "")
        status_code = record.get("status", 0)
        timestamp = record.get("ts", 0)
        duration_ms = record.get("duration_ms")
        ip = record.get("ip", "")

        # domain node
        self.add_node(domain, "domain", domain, 6.0)
        # host node
        self.add_node(host, "host", domain, 4.0)
        # resource node
        resource_attrs = {
            "method": method,
            "protocol": protocol,
            "bytes": nbytes,
            "type": req_type,
            "content_type": content_type,
            "status_code": status_code,
            "timestamp": timestamp,
        }
        if duration_ms is not None:
            resource_attrs["duration_ms"] = duration_ms
        self.add_node(
            resource_id,
            "resource",
            domain,
            3.0,
            label=self.format_label(resource_id),
            **resource_attrs,
        )

        # client node — from "client" field if present, else localhost
        # matches SnarfData.java: type "client", domain "localdomain", size 8.0
        client_id = record.get("client") or self.DEFAULT_CLIENT
        self.add_node(client_id, "client", "localdomain", 8.0)

        # edges: client → resource, domain → host → resource
        self.add_edge(client_id, resource_id)
        self.add_edge(domain, host)
        self.add_edge(host, resource_id)

        # IP node (optional)
        if self.include_ip and ip:
            self.add_node(ip, "ip", domain, 3.5)
            self.add_edge(host, ip)

        # params node (optional)
        if self.include_params and parsed.query:
            params_id = resource_id + "?" + parsed.query
            self.add_node(
                params_id,
                "params",
                domain,
                2.0,
                label=self.format_label(parsed.query),
            )
            self.add_edge(resource_id, params_id)

        # initiator — more accurate than referer for cross-origin dependencies
        # Chrome's initiator is an origin (scheme://host), not a full URL,
        # so we edge from the host node directly rather than creating a phantom resource.
        initiator_str = record.get("initiator")
        if initiator_str:
            init_parsed = urlparse(initiator_str)
            if init_parsed.scheme in ("http", "https") and init_parsed.hostname:
                init_host = init_parsed.hostname
                init_domain = self.parse_domain(init_host)

                self.add_node(init_domain, "domain", init_domain, 6.0)
                self.add_node(init_host, "host", init_domain, 4.0)

                self.add_edge(init_domain, init_host)
                self.add_edge(init_host, resource_id)

        # referer — only used when no initiator is present
        # The referer is the tab URL (from chrome.tabs.get), not a request we observed.
        # If the referer resource already exists from a real request, edge from it;
        # otherwise edge from the host to avoid hollow resource nodes.
        if not initiator_str:
            referer_str = record.get("referer")
            if referer_str:
                ref_parsed = urlparse(referer_str)
                if ref_parsed.scheme in ("http", "https") and ref_parsed.hostname:
                    ref_host = ref_parsed.hostname
                    ref_domain = self.parse_domain(ref_host)
                    ref_resource_id = ref_host + ref_parsed.path

                    self.add_node(ref_domain, "domain", ref_domain, 6.0)
                    self.add_node(ref_host, "host", ref_domain, 4.0)
                    self.add_edge(ref_domain, ref_host)

                    if ref_resource_id in self.G:
                        self.add_edge(ref_resource_id, resource_id)
                    else:
                        self.add_edge(ref_host, resource_id)

    def _process_redirect(self, record):
        """Process a redirect record: resource → resource edge for the redirect chain."""
        src_url = record.get("url")
        dst_url = record.get("redirect_url")
        if not src_url or not dst_url:
            return

        src = self._ensure_resource_hierarchy(src_url)
        dst = self._ensure_resource_hierarchy(dst_url)
        if not src or not dst:
            return

        src_resource_id = src[0]
        dst_resource_id = dst[0]
        self.add_edge(src_resource_id, dst_resource_id)

    def write_gexf(self, output_path):
        """Write the graph to a GEXF file."""
        nx.write_gexf(self.G, output_path, version="1.2draft")

    def summary(self):
        """Return a summary string of the graph."""
        type_counts = {}
        for _, data in self.G.nodes(data=True):
            t = data.get("node_type", "unknown")
            type_counts[t] = type_counts.get(t, 0) + 1
        parts = [f"  {t}: {c}" for t, c in sorted(type_counts.items())]
        return (
            f"Nodes: {self.G.number_of_nodes()}\n"
            + "\n".join(parts)
            + f"\nEdges: {self.G.number_of_edges()}"
            + f"\nDomains colored: {len(self.colormap)}"
            + (f"\nSkipped (bad JSON): {self.skipped_json}" if self.skipped_json else "")
            + (f"\nSkipped (bad URL): {self.skipped_url}" if self.skipped_url else "")
        )


def main():
    parser = ArgumentParser(description="Build a GEXF graph from HTTP Graph Collector JSON logs")
    parser.add_argument(
        "-i",
        "--input",
        default="httpgraph-requests.json",
        help="JSON log file (default: httpgraph-requests.json)",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="httpgraph.gexf",
        help="GEXF output file (default: httpgraph.gexf)",
    )
    parser.add_argument("--ip", action="store_true", help="Include IP address nodes")
    parser.add_argument("--params", action="store_true", help="Include URL parameter nodes")
    args = parser.parse_args()

    builder = GraphBuilder(include_ip=args.ip, include_params=args.params)

    with open(args.input, "r", encoding="utf-8") as f:
        lines = f.readlines()

    for line in tqdm(lines, unit=" records", desc="Building graph"):
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            builder.skipped_json += 1
            continue

        try:
            builder.process_record(record)
        except Exception:
            builder.skipped_url += 1

    builder.write_gexf(args.output)
    print(f"\nWrote {args.output}")
    print(builder.summary())


if __name__ == "__main__":
    main()
