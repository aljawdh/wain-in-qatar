document.addEventListener('DOMContentLoaded', function () {
  var loginBtn = document.getElementById('loginBtn');
  var usernameInput = document.getElementById('username');
  var passwordInput = document.getElementById('password');
  var errorMessage = document.getElementById('errorMessage');

  function showError(text) {
    errorMessage.textContent = text;
    errorMessage.style.display = 'block';
  }

  loginBtn.addEventListener('click', function () {
    var username = usernameInput.value.trim();
    var password = passwordInput.value;

    if (username === 'admin' && password === '1234') {
      try {
        sessionStorage.setItem('durur-control-authenticated', 'true');
      } catch (e) {
        // ignore storage errors
      }
      window.location.href = '/durur-control/dashboard';
      return;
    }

    showError('بيانات الدخول غير صحيحة. حاول مرة أخرى.');
  });
});
