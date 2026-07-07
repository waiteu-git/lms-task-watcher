var isEdge = navigator.userAgent.includes('Edg/');
document.querySelectorAll('[data-browser]').forEach(function (el) {
  var forEdge = el.getAttribute('data-browser') === 'edge';
  if (forEdge !== isEdge) el.hidden = true;
});
