/*
	httpgraph.js
	@phreakocious - 2017

	Chrome extension to accompany the HTTP Graph plugin for Gephi
	Collects minimal details from http and https request/response headers and POSTs them to a REST API as you browse
	I'm not a JS programmer
*/

var url_backend = "http://127.0.0.1:65444/add_record"  // data will POST to here
var requests = []  // stores references to requests until their responses arrive

function sendLog(message, callback) {
	//console.log(message)
	var xhr = new XMLHttpRequest()
	xhr.open("POST", url_backend, true)
	xhr.send(message + "\r\n")
}

function setRefererFromTab(tabid, request) {
	chrome.tabs.get(tabid, function(tab) {
		if ( ! chrome.runtime.lastError )  // sometimes the tab does not exist
			request.referer = tab.url
	})
}

function logRequest(details) {
	if ( details.url == url_backend || details.tabId < 0 ) return  // avoid feedback loop and other ugliness

	var request = {
		url: details.url,
		reqid: details.requestId
	}

	var headers = details.requestHeaders
	for ( var i = 0, l = headers.length; i < l; ++i ) {
		if ( headers[i].name == 'Referer' ) {
			request.referer = headers[i].value
			break
		}
	}
	if ( ! request.referer )
		setRefererFromTab(details.tabId, request)

	requests[details.requestId] = request
}
chrome.webRequest.onSendHeaders.addListener(
	logRequest,
	{ urls: [ "http://*/*", "https://*/*" ] },
	[ "requestHeaders" ]
)

function logResponse(details) {
	if ( typeof requests[details.requestId] == "undefined" )  return
	var headers = details.responseHeaders
	var response = {
	  ip: details.ip,
	  method: details.method,
	  status: details.statusCode,
	  type: details.type
	}
	for ( var i = 0, l = headers.length; i < l; ++i ) {
		header = headers[i].name.toLowerCase()
		if ( header == 'content-length' ) {
			response.bytes = headers[i].value
		} else if ( header == 'content-type' ) {
			response.content_type = headers[i].value
		}
	}

	sendLog(JSON.stringify(Object.assign(requests[details.requestId], response)))
	delete requests[details.requestId]
}
chrome.webRequest.onCompleted.addListener(
	logResponse,
	{ urls: [ "http://*/*", "https://*/*" ] },
	[ "responseHeaders" ]
)
