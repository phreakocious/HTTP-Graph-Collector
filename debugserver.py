import SimpleHTTPServer
import SocketServer

PORT = 65444

class ServerHandler(SimpleHTTPServer.SimpleHTTPRequestHandler):

    def do_POST(self):
		self.send_response(200)
 		content_len = int(self.headers.getheader('content-length', 0))
		post = self.rfile.read(content_len)
		print post

Handler = ServerHandler

httpd = SocketServer.TCPServer(("", PORT), Handler)

print "server listening on port", PORT
httpd.serve_forever()
