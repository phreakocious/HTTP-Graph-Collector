#!/usr/bin/env python3

import http.server
import socketserver

PORT = 65444

class ServerHandler(http.server.SimpleHTTPRequestHandler):

    def do_POST(self):
        self.send_response(200)
        content_len = int(self.headers.get('content-length', 0))
        post = self.rfile.read(content_len)
        print(post)



with socketserver.TCPServer(("", PORT), ServerHandler) as httpd:
    print("server listening on port", PORT)
    httpd.serve_forever()