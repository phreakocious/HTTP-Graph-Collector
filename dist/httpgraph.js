/*
	httpgraph.js
	@phreakocious - 2017-2026

	Collects minimal details from http and https request/response headers as you browse.
	Streams them to the live viewer, and POSTs them to a localhost REST API for the
	bundled Python tools or the HTTP Graph plugin for Gephi. All three are optional.
	I'm not a JS programmer
*/

const default_rest_port = "65444";
const default_scrub_parameters = false;
const default_collecting = true;
const default_domain_include = "";
const default_domain_exclude = "";

// Request timing map — stores start times keyed by requestId
const requestTimings = new Map();

// Initiator map — stores the origin that triggered each request
const requestInitiators = new Map();

// Connected viewer ports for live streaming
const viewerPorts = new Set();

function broadcastToViewers(data) {
    for (const port of viewerPorts) {
        try {
            port.postMessage(data);
        } catch (_e) {
            viewerPorts.delete(port);
        }
    }
}

// hashing function courtesy of bryc https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
const cyrb53 = (str, seed = 42) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

function scrubber(match, p1, _offset, _string) {
	return "?SCRUBBED_hash=" + cyrb53(p1);
}

function updateBadge(collecting) {
	if (collecting) {
		chrome.action.setBadgeText({ text: "" });
	} else {
		chrome.action.setBadgeText({ text: "OFF" });
		chrome.action.setBadgeBackgroundColor({ color: "#cc0000" });
	}
}

function domainMatches(hostname, domainList) {
	return domainList.some(domain => hostname === domain || hostname.endsWith("." + domain));
}

// An include list wins outright: setting one disables the exclude list.
// Unparseable URLs pass, same as before.
function passesDomainFilter(url, items) {
	try {
		const hostname = new URL(url).hostname.toLowerCase();
		const includeList = items.domain_include.split("\n").map(s => s.trim().toLowerCase()).filter(Boolean);
		const excludeList = items.domain_exclude.split("\n").map(s => s.trim().toLowerCase()).filter(Boolean);

		if (includeList.length > 0) return domainMatches(hostname, includeList);
		if (excludeList.length > 0) return !domainMatches(hostname, excludeList);
	} catch (_e) {
		// If URL parsing fails, proceed anyway
	}
	return true;
}

// The REST backend is optional: most users only run the live viewer, and with
// nothing listening on the port every single request cost a rejected fetch and
// a console error. Stop trying after a run of failures; any success, or a port
// change, arms it again.
const REST_FAILURE_LIMIT = 5;
const REST_RETRY_MS = 30000;
let restFailures = 0;
let restMutedUntil = 0;
let restLastPort = null;

async function postToBackend(url_backend, port, data) {
	if (port !== restLastPort) { restLastPort = port; restFailures = 0; restMutedUntil = 0; }
	// Muted, but never permanently: a logger started after the browser gets
	// picked up on the next probe rather than needing a restart.
	if (restMutedUntil && Date.now() < restMutedUntil) return;
	try {
		await fetch(url_backend, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data) + "\r\n"
		});
		restFailures = 0;
		restMutedUntil = 0;
	} catch (error) {
		restFailures++;
		if (restFailures === REST_FAILURE_LIMIT) {
			console.warn(`HTTP Graph: no REST backend on port ${port} — probing every ${REST_RETRY_MS / 1000}s instead of every request.`);
		} else if (restFailures < REST_FAILURE_LIMIT) {
			console.error("HTTP Graph Error: Could not send data to backend.", error);
		}
		if (restFailures >= REST_FAILURE_LIMIT) restMutedUntil = Date.now() + REST_RETRY_MS;
	}
}

async function logResponse(details) {
    // Drain the per-request maps first, before any await or early return.
    // These are populated unconditionally by onBeforeRequest, so returning
    // early (paused, or domain-filtered) used to leave every entry behind and
    // grow both maps for the life of the service worker.
    const startTime = requestTimings.get(details.requestId);
    const initiator = requestInitiators.get(details.requestId);
    requestTimings.delete(details.requestId);
    requestInitiators.delete(details.requestId);

    // Get settings from storage every time, as the service worker can be terminated.
    const items = await chrome.storage.local.get({
        rest_port: default_rest_port,
        scrub_parameters: default_scrub_parameters,
        collecting: default_collecting,
        domain_include: default_domain_include,
        domain_exclude: default_domain_exclude
    });

    // If collection is paused, do nothing
    if (!items.collecting) return;

    const url_backend = `http://127.0.0.1:${items.rest_port}/add_record`;

    // Avoid feedback loop and internal browser requests
 	if ( details.url.startsWith(url_backend) || details.tabId < 0 ) return;

    if (!passesDomainFilter(details.url, items)) return;

	const headers = details.responseHeaders;
	let data = {
	  url: details.url,
	  ts: details.timeStamp,
	  ip: details.ip,
	  method: details.method,
	  status: details.statusCode,
	  type: details.type
	};

    // Compute request duration if we have a start time
    if (startTime !== undefined) {
        data.duration_ms = Math.round(details.timeStamp - startTime);
    }

    // Attach initiator origin if captured from onBeforeRequest
    if (initiator) {
        data.initiator = initiator;
    }

	for (const header of headers) {
        const headerName = header.name.toLowerCase();
		if (headerName === 'content-length') {
			data.bytes = header.value;
		} else if (headerName === 'content-type') {
			data.content_type = header.value;
		}
	}

    // Since chrome.tabs.get uses a callback, we wrap the final part of our logic in a new Promise
    // to keep the async/await flow clean.
    const finalizeAndSend = new Promise(resolve => {
        chrome.tabs.get(details.tabId, (tab) => {
            // Check lastError because the tab might have closed before this callback runs
            if (!chrome.runtime.lastError && tab) {
                data.referer = tab.url;
            }

            if (items.scrub_parameters) {
                data.url = data.url.replace(/\?.*/, scrubber);
                if (data.referer) {
                    data.referer = data.referer.replace(/\?.*/, scrubber);
                }
            }
            resolve(data);
        });
    });

    const finalData = await finalizeAndSend;

    broadcastToViewers(finalData);
    await postToBackend(url_backend, items.rest_port, finalData);
}

const requestFilter = { urls: [ "http://*/*", "https://*/*" ] };

chrome.webRequest.onBeforeRequest.addListener(
	(details) => {
		requestTimings.set(details.requestId, details.timeStamp);
		if (details.initiator && details.initiator !== "null") {
			requestInitiators.set(details.requestId, details.initiator);
		}
	},
	requestFilter
);

chrome.webRequest.onCompleted.addListener(
	logResponse,
	requestFilter,
	[ "responseHeaders" ]
);

chrome.webRequest.onBeforeRedirect.addListener(
	async (details) => {
		const items = await chrome.storage.local.get({
			rest_port: default_rest_port,
			collecting: default_collecting,
			domain_include: default_domain_include,
			domain_exclude: default_domain_exclude
		});

		if (!items.collecting) return;

		const url_backend = `http://127.0.0.1:${items.rest_port}/add_record`;
		if (details.url.startsWith(url_backend) || details.tabId < 0) return;

		// Domain filtering on the source URL
		if (!passesDomainFilter(details.url, items)) return;

		const data = {
			edge_type: "redirect",
			url: details.url,
			redirect_url: details.redirectUrl,
			ts: details.timeStamp,
			ip: details.ip,
			method: details.method,
			status: details.statusCode,
			type: details.type
		};

		broadcastToViewers(data);
		await postToBackend(url_backend, items.rest_port, data);
	},
	requestFilter,
	[ "responseHeaders" ]
);

chrome.webRequest.onErrorOccurred.addListener(
	(details) => {
		requestTimings.delete(details.requestId);
		requestInitiators.delete(details.requestId);
	},
	requestFilter
);

chrome.runtime.onInstalled.addListener(() => {
	chrome.storage.local.set({
		rest_port: default_rest_port,
		scrub_parameters: default_scrub_parameters,
		collecting: default_collecting,
		domain_include: default_domain_include,
		domain_exclude: default_domain_exclude
	});
	updateBadge(default_collecting);
});

chrome.runtime.onStartup.addListener(async () => {
	const items = await chrome.storage.local.get({ collecting: default_collecting });
	updateBadge(items.collecting);
});

// ── Live Viewer Streaming ──
chrome.runtime.onConnectExternal.addListener((port) => {
	if (port.name !== "httpgraph-viewer") return;
	console.log("HTTP Graph: Viewer connected");
	viewerPorts.add(port);
	port.onDisconnect.addListener(() => {
		viewerPorts.delete(port);
		console.log("HTTP Graph: Viewer disconnected");
	});
});
