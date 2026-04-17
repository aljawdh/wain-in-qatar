document.addEventListener('DOMContentLoaded', function () {
  try {
    var isAuth = sessionStorage.getItem('durur-control-authenticated') === 'true';
    if (!isAuth) {
      window.location.href = '/durur-control/login';
      return;
    }
  } catch (e) {
    window.location.href = '/durur-control/login';
    return;
  }

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      try {
        sessionStorage.removeItem('durur-control-authenticated');
      } catch (e) {
        // ignore
      }
      window.location.href = '/durur-control/login';
    });
  }
});
