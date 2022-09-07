/*
	httpgraph.js
	@phreakocious - 2017-2022

	Chrome extension to accompany the HTTP Graph plugin for Gephi
	Collects minimal details from http and https request/response headers and POSTs them to a REST API as you browse
	I'm not a JS programmer
*/

var scrub_parameters
var url_backend
const default_rest_port = "65444"
const default_scrub_parameters = false

chrome.storage.local.get({
	rest_port: default_rest_port,
	scrub_parameters: default_scrub_parameters
}, function(items) {
	 rest_port = items.rest_port
	 scrub_parameters = items.scrub_parameters
     url_backend = "http://127.0.0.1:" + rest_port + "/add_record"  // data will POST to here
})

function sendLog(message, callback) {
	//console.log(message)
	var xhr = new XMLHttpRequest()
	xhr.open("POST", url_backend, true)
	xhr.send(message + "\r\n")
}

// hashing function courtesy of bryc  https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
const cyrb53 = function(str, seed = 42) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i)
        h1 = Math.imul(h1 ^ ch, 2654435761)
        h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909)
    h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909)
    return 4294967296 * (2097151 & h2) + (h1>>>0)
}

function scrubber(match, p1, offset, string) {
	return "?SCRUBBED_hash=" + cyrb53(p1)
}

function logResponse(details) {
 	if ( details.url == url_backend || details.tabId < 0 ) return  // avoid feedback loop and other ugliness
	//console.log(details)
	var headers = details.responseHeaders

	var data = {
	  url: details.url,
	  ts: details.timeStamp,
	  ip: details.ip,
	  method: details.method,
	  status: details.statusCode,
	  type: details.type
	}

	for ( var i = 0, l = headers.length; i < l; ++i ) {
		header = headers[i].name.toLowerCase()
		if ( header == 'content-length' ) {
			data.bytes = headers[i].value
		} else if ( header == 'content-type' ) {
			data.content_type = headers[i].value
		}
	}

	chrome.tabs.get(details.tabId, function(tab) {
		if ( ! chrome.runtime.lastError )  // sometimes the tab does not exist
			data.referer = tab.url

		if ( scrub_parameters ) {
			data.url = data.url.replace(/\?.*/, scrubber)
			if ( data.referer ) {
				data.referer = data.referer.replace(/\?.*/, scrubber)
			}
		}

		sendLog(JSON.stringify(Object.assign(data)))
	})
}

chrome.webRequest.onCompleted.addListener(
	logResponse,
	{ urls: [ "http://*/*", "https://*/*" ] },
	[ "responseHeaders" ]
)

chrome.runtime.onInstalled.addListener(function() {
	chrome.storage.local.set({
		rest_port: default_rest_port,
		scrub_parameters: default_scrub_parameters
	})
})