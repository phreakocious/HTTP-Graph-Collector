/*
	httpgraph.js
	@phreakocious - 2017-2025

	Chrome extension to accompany the HTTP Graph plugin for Gephi
	Collects minimal details from http and https request/response headers and POSTs them to a REST API as you browse
	I'm not a JS programmer
*/

const default_rest_port = "65444";
const default_scrub_parameters = false;

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

function scrubber(match, p1, offset, string) {
	return "?SCRUBBED_hash=" + cyrb53(p1);
}

async function logResponse(details) {
    // Get settings from storage every time, as the service worker can be terminated.
    const items = await chrome.storage.local.get({
        rest_port: default_rest_port,
        scrub_parameters: default_scrub_parameters
    });

    const url_backend = `http://127.0.0.1:${items.rest_port}/add_record`;

    // Avoid feedback loop and internal browser requests
 	if ( details.url.startsWith(url_backend) || details.tabId < 0 ) return;

	const headers = details.responseHeaders;
	let data = {
	  url: details.url,
	  ts: details.timeStamp,
	  ip: details.ip,
	  method: details.method,
	  status: details.statusCode,
	  type: details.type
	};

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

    try {
        await fetch(url_backend, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(finalData) + "\r\n"
        });
    } catch (error) {
        console.error("HTTP Graph Error: Could not send data to backend.", error);
    }
}

chrome.webRequest.onCompleted.addListener(
	logResponse,
	{ urls: [ "http://*/*", "https://*/*" ] },
	[ "responseHeaders" ]
);

chrome.runtime.onInstalled.addListener(() => {
	chrome.storage.local.set({
		rest_port: default_rest_port,
		scrub_parameters: default_scrub_parameters
	});
});