function save_options() {
  var rest_port = document.getElementById('rest_port').value
  var scrub_parameters = document.getElementById('scrub_parameters').checked
  chrome.storage.local.set({
    rest_port: rest_port,
    scrub_parameters: scrub_parameters
  }, function() {
    var status = document.getElementById('status')
    status.textContent = 'Options saved.'
    setTimeout(function() {
      status.innerHTML = '&nbsp;'
    }, 750)
    chrome.extension.getBackgroundPage().window.location.reload()
  })
}

function restore_options() {
  chrome.storage.local.get({
    rest_port,
    scrub_parameters
  }, function(items) {
    document.getElementById('rest_port').value = items.rest_port
    document.getElementById('scrub_parameters').checked = items.scrub_parameters
  })
}

const url_port = document.getElementById('url_port')

document.addEventListener('DOMContentLoaded', restore_options)
document.getElementById('save').addEventListener('click', save_options)
document.getElementById('rest_port').addEventListener('input', function(e) {
    url_port.textContent = e.target.value
})
