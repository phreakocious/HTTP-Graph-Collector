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
import itertools
from urllib import request
from tqdm import tqdm
from argparse import ArgumentParser

batch_size = 500
url = "http://localhost:65444/add_record"

parser = ArgumentParser()
parser.add_argument("filename", nargs="?", default="httpgraph-requests.json")
args = parser.parse_args()

with open(args.filename, "r", encoding="utf-8") as f:
    pbar = tqdm(total=len(f.readlines()), unit=" URLs")
    f.seek(0)

    for lines in itertools.zip_longest(*[f] * batch_size, fillvalue=None):
        lines = tuple(line.rstrip("\r") for line in lines if line)
        data = "".join(map(str, lines)).encode("utf-8")
        req = request.Request(
            url=url, data=data, headers={"Content-Type": "application/json; charset=utf-8"}
        )
        with request.urlopen(req) as f:
            pbar.update(len(lines))
            time.sleep(0.1)
