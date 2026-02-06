function save_options() {
  var rest_port = document.getElementById('rest_port').value
  var scrub_parameters = document.getElementById('scrub_parameters').checked
  var domain_include = document.getElementById('domain_include').value
  var domain_exclude = document.getElementById('domain_exclude').value
  chrome.storage.local.set({
    rest_port: rest_port,
    scrub_parameters: scrub_parameters,
    domain_include: domain_include,
    domain_exclude: domain_exclude
  }, function() {
    var status = document.getElementById('status')
    status.textContent = 'Options saved.'
    setTimeout(function() {
      status.innerHTML = '&nbsp;'
    }, 750)
  })
}

function restore_options() {
  chrome.storage.local.get({
    rest_port: "65444",
    scrub_parameters: false,
    domain_include: "",
    domain_exclude: ""
  }, function(items) {
    document.getElementById('rest_port').value = items.rest_port
    document.getElementById('scrub_parameters').checked = items.scrub_parameters
    document.getElementById('domain_include').value = items.domain_include
    document.getElementById('domain_exclude').value = items.domain_exclude
  })
}

const url_port = document.getElementById('url_port')

document.addEventListener('DOMContentLoaded', restore_options)
document.getElementById('save').addEventListener('click', save_options)
document.getElementById('rest_port').addEventListener('input', function(e) {
    url_port.textContent = e.target.value
})
