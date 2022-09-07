#!/usr/bin/env python3
# -*- coding: UTF-8 -*-

###########################
# httpgraph-logger.py    #
# phreakocious, 12/2020 #
########################

import time
import json
import logging
from getpass import getpass
from threading import Thread
from datetime import datetime
from sparklines import sparklines
from colorama import init, Fore, Back, Style
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

output_file = "httpgraph-requests.json"
hostname = "localhost"
listen_port = 65444
poll_secs = 2
spark_min = 2
spark_max = 30
hour_mark = "⁑"

print_styles = {
    "2xx":                Fore.CYAN + Style.NORMAL + Back.BLACK,
    "3xx":       Fore.LIGHTWHITE_EX + Style.NORMAL + Back.BLACK,
    "4xx":     Fore.LIGHTMAGENTA_EX + Style.BRIGHT + Back.BLUE,
    "5xx":         Fore.LIGHTRED_EX + Style.BRIGHT + Back.BLACK,
    "other":    Fore.LIGHTYELLOW_EX + Style.BRIGHT + Back.GREEN,
    "hour_mark": Fore.LIGHTWHITE_EX + Style.BRIGHT + Back.BLACK
}

# TODO: add timestamps to the JSON


def p(thing):
    print(thing, flush=True, end="")


class Server(BaseHTTPRequestHandler):
    response_count = 0
    status_counts = {x: 0 for x in print_styles.keys()}

    def count_response(response_code):
        status = "other"
        if response_code in range(200, 300):
            status = "2xx"
        if response_code in range(300, 400):
            status = "3xx"
        elif response_code in range(400, 500):
            status = "4xx"
        elif response_code in range(500, 600):
            status = "5xx"
        Server.status_counts[status] += 1
        Server.response_count += 1

    def reset_counts():
        Server.status_counts = {x: 0 for x in Server.status_counts}
        Server.response_count = 0

    def do_POST(self):
        self.send_response(200)
        self.end_headers()

    # this function is called by the web server for every request
    def log_message(self, format, *args):
        post_length = int(self.headers["Content-Length"])
        post_body = self.rfile.read(post_length)
        response_code = int(json.loads(post_body)["status"])
        Server.count_response(response_code)
        logging.info(post_body.decode("utf-8").rstrip("\n"))


class SparksPrinter(Thread):
    def run(self):
        hour_check = datetime.now().hour
        while True:
            this_hour = datetime.now().hour
            if this_hour != hour_check:
                p(hour_mark)
                hour_check = this_hour

            if Server.response_count >= spark_min:
                for status, count in Server.status_counts.items():
                    if count > 0:
                        sparks = sparklines([count],
                                            minimum=spark_min, maximum=spark_max)
                        p(print_styles[status] + "".join(sparks))
            # reset every interval to prevent count carrying over between
            # polls and breaking the comparison against spark_min
            Server.reset_counts()

            time.sleep(poll_secs)


if __name__ == "__main__":
    init(autoreset=True)
    hour_mark = print_styles["hour_mark"] + hour_mark
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    log_handler = logging.FileHandler(filename=output_file, mode="a")
    log_handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(log_handler)
    with open(output_file, 'rb') as file:
        file_lines = len(file.readlines())
        file.seek(0, 2)
        file_size = file.tell()

    print("started at %s .. listening on %s:%i" %
          (datetime.now(), hostname, listen_port))

    print("appending to '%s' (%s entries, %s bytes)" %
          (output_file, "{:,d}".format(file_lines), "{:,d}".format(file_size)))

    print("sparks range %i-%i .. %i second polling .. hour mark: %s" %
          (spark_min, spark_max, poll_secs, hour_mark))

    http_server = ThreadingHTTPServer((hostname, listen_port), Server)
    sparks_printer = SparksPrinter(daemon=True)

    try:
        sparks_printer.start()
        http_server.serve_forever()
        # keep the main thread busy and don't echo user input
    except KeyboardInterrupt:
        pass

    http_server.server_close()
    print("")
