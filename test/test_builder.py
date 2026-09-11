"""Offline builder: a redirect followed by its completed response, through a GEXF round trip.

Run with:  python3 -m unittest discover -s test -p "test_*.py"
"""

import importlib.util
import os
import tempfile
import unittest

import networkx as nx

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location("httpgraph_builder", os.path.join(HERE, "..", "httpgraph-builder.py"))
builder_mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder_mod)

REDIRECT = {
    "edge_type": "redirect",
    "url": "https://a.example/start",
    "redirect_url": "https://b.example/landing",
    "ts": 1000,
    "method": "GET",
    "status": 302,
    "type": "main_frame",
}
COMPLETED = {
    "url": "https://b.example/landing",
    "ts": 1250,
    "method": "GET",
    "status": 200,
    "type": "main_frame",
    "content_type": "text/html",
    "bytes": "456",
    "duration_ms": 123,
}


def round_trip(records):
    builder = builder_mod.GraphBuilder()
    for record in records:
        builder.process_record(record)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "out.gexf")
        builder.write_gexf(path)
        return nx.read_gexf(path)


class RedirectThenCompletion(unittest.TestCase):
    def setUp(self):
        self.G = round_trip([REDIRECT, COMPLETED])

    def test_destination_gets_its_response_metadata(self):
        # The redirect created b.example/landing bare; add_node() used to only
        # bump `visited` for an existing node, so the response never landed.
        node = self.G.nodes["b.example/landing"]
        self.assertEqual(node["status_code"], 200)
        self.assertEqual(node["method"], "GET")
        self.assertEqual(node["content_type"], "text/html")
        self.assertEqual(node["bytes"], 456)
        self.assertEqual(node["duration_ms"], 123)
        self.assertEqual(node["timestamp"], 1250)
        self.assertEqual(node["visited"], 2)

    def test_redirect_edge_keeps_its_type_and_status(self):
        # Exported as {id, weight} only, the viewer could neither style the edge
        # nor walk the chain after loading a GEXF from the offline workflow.
        edge = self.G.edges["a.example/start", "b.example/landing"]
        self.assertEqual(edge["edge_type"], "redirect")
        self.assertEqual(edge["status_code"], 302)
        self.assertEqual(edge["weight"], 1)

    def test_first_observation_still_wins(self):
        # Backfill fills gaps only: a second, different response must not overwrite.
        G = round_trip([REDIRECT, COMPLETED, dict(COMPLETED, status=500, bytes="1")])
        node = G.nodes["b.example/landing"]
        self.assertEqual(node["status_code"], 200)
        self.assertEqual(node["bytes"], 456)
        self.assertEqual(node["visited"], 3)


if __name__ == "__main__":
    unittest.main()
