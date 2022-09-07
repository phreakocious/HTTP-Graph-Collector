#!/usr/bin/env python3

##########################
# httpgraph-loader.py   #
# phreakocious, 8/2022 #
#######################

#
# POSTS a file of JSON blobs to a REST endpoint in batches
# Used for loading the logs from httpgraph-logger.py into Gephi/HTTP Graph
#

import time
from urllib import request
from tqdm import tqdm

batch_size = 500
file = "httpgraph-requests.json"
url = "http://localhost:65444/add_record"

with open(file) as f:
    line_gen = zip(*[f]*batch_size)
    for lines in tqdm(line_gen):
        lines = {line.rstrip("\r") for line in lines}
        data = ''.join(map(str, lines)).encode("utf-8")
        req = request.Request(url=url,
                              data=data,
                              headers={"Content-Type":
                                       "application/json; charset=utf-8"})
        with request.urlopen(req) as f:
            pass

        time.sleep(.1)
