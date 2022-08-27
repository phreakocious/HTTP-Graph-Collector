## HTTP Graph Collector

This is the source code for a [Chrome extension](https://chrome.google.com/webstore/detail/http-graph-collector/lkkdeokncfjlinldgikoabgknklnnkoe) which collects data for the [HTTP Graph](https://github.com/phreakocious/gephi-plugins/tree/master/modules/HttpGraph) Gephi plugin.

It sends POSTs to http://localhost:65444/add_record with information from the HTTP headers of requests made by Chrome.

There is also [httpgraph-logger.py](httpgraph-logger.py), a Python console app which can receive the data in lieu of the Gephi plugin.  It will append to a .json file which can be imported later or analyzed with other tools like `jq`.  It also prints sparklines to the console so you can visualize how many requests are being made:

![sample of httpgraph-logger.py output](https://github.com/phreakocious/HTTP-Graph-Collector/blob/master/httpgraph-logger_screenshot.png?raw=true)