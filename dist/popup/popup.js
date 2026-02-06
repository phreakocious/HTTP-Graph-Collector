const defaults = {
  rest_port: "65444",
  scrub_parameters: false,
  collecting: true,
  domain_include: "",
  domain_exclude: ""
};

function updateToggleUI(collecting) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const sw = document.getElementById('toggle-switch');

  if (collecting) {
    dot.classList.remove('paused');
    text.textContent = 'Collecting';
    sw.classList.add('active');
  } else {
    dot.classList.add('paused');
    text.textContent = 'Paused';
    sw.classList.remove('active');
  }
}

function updateBadge(collecting) {
  if (collecting) {
    chrome.action.setBadgeText({ text: "" });
  } else {
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#cc0000" });
  }
}

async function toggleCollecting() {
  const items = await chrome.storage.local.get({ collecting: defaults.collecting });
  const newState = !items.collecting;
  await chrome.storage.local.set({ collecting: newState });
  updateToggleUI(newState);
  updateBadge(newState);
}

async function restoreOptions() {
  const items = await chrome.storage.local.get(defaults);
  document.getElementById('rest_port').value = items.rest_port;
  document.getElementById('scrub_parameters').checked = items.scrub_parameters;
  document.getElementById('domain_include').value = items.domain_include;
  document.getElementById('domain_exclude').value = items.domain_exclude;
  document.getElementById('url_port').textContent = items.rest_port;
  updateToggleUI(items.collecting);
}

function saveOptions() {
  chrome.storage.local.set({
    rest_port: document.getElementById('rest_port').value,
    scrub_parameters: document.getElementById('scrub_parameters').checked,
    domain_include: document.getElementById('domain_include').value,
    domain_exclude: document.getElementById('domain_exclude').value
  }, function() {
    const msg = document.getElementById('status-msg');
    msg.textContent = 'Settings saved.';
    setTimeout(function() { msg.textContent = ''; }, 1200);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  restoreOptions();
  const extIdEl = document.getElementById('ext-id');
  extIdEl.textContent = chrome.runtime.id;
  extIdEl.addEventListener('click', function() {
    navigator.clipboard.writeText(chrome.runtime.id).then(function() {
      extIdEl.textContent = 'Copied!';
      setTimeout(function() { extIdEl.textContent = chrome.runtime.id; }, 1200);
    });
  });
});
document.getElementById('toggle-row').addEventListener('click', toggleCollecting);
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('rest_port').addEventListener('input', function(e) {
  document.getElementById('url_port').textContent = e.target.value;
});
