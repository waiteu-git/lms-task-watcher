document.querySelectorAll('.phase-header').forEach(function (header) {
  header.addEventListener('click', function () {
    header.closest('.phase-card').classList.toggle('open');
  });
});
