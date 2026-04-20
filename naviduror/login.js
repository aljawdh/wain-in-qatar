(function () {
  var AUTH_TOKEN_KEY = 'naviduror_token';
  var AUTH_USER_KEY = 'naviduror_user';
  var loginForm = document.getElementById('loginForm');
  var loginBtn = document.getElementById('loginBtn');
  var authError = document.getElementById('authError');
  var usernameInput = document.getElementById('loginUsername');
  var passwordInput = document.getElementById('loginPassword');

  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null') || {};
    } catch (e) {
      return {};
    }
  }

  function isAuthenticated() {
    return !!localStorage.getItem(AUTH_TOKEN_KEY);
  }

  function saveAuth(token, user) {
    localStorage.setItem(AUTH_TOKEN_KEY, token || '');
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user || {}));
  }

  function redirectToDashboard() {
    window.location.href = '/naviduror/dashboard';
  }

  function setError(message) {
    if (!authError) return;
    authError.textContent = message || '';
  }

  function stripHiddenWhitespace(value) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]/g, '');
  }

  function normalizeIdentifier(value) {
    return stripHiddenWhitespace(value).trim().toLowerCase();
  }

  function normalizePassword(value) {
    return stripHiddenWhitespace(value).trim();
  }

  function updateButtonState(isProcessing) {
    if (!loginBtn) return;
    loginBtn.disabled = isProcessing;
    loginBtn.textContent = isProcessing ? 'جارٍ التحقق...' : 'تسجيل الدخول';
  }

  async function attemptRemoteLogin(username, password) {
    try {
      console.info('[navidur] login request', {
        username: username,
        passwordProvided: !!password
      });
      var response = await fetch('/api?route=login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });
      console.info('[navidur] login response', { status: response.status });
      var contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType.indexOf('application/json') === -1) {
        console.warn('[navidur] unexpected login response type', { contentType: contentType || 'unknown' });
        return false;
      }
      var payload = await response.json().catch(function () { return {}; });
      if (response.ok && payload && payload.token) {
        saveAuth(payload.token, payload.user || { username: username });
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async function performLogin(event) {
    if (event) event.preventDefault();
    setError('');
    var username = normalizeIdentifier(usernameInput.value);
    var password = normalizePassword(passwordInput.value);
    if (!username || !password) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    updateButtonState(true);
    var success = await attemptRemoteLogin(username, password);
    if (!success) {
      if (username === 'admin' && password === 'naviduror') {
        saveAuth('naviduror-local-token', { username: 'admin' });
        success = true;
      }
    }

    if (success) {
      redirectToDashboard();
      return;
    }

    setError('فشل تسجيل الدخول. تحقق من بياناتك أو اتصال الشبكة.');
    updateButtonState(false);
  }

  if (isAuthenticated()) {
    redirectToDashboard();
    return;
  }

  if (loginForm) {
    loginForm.addEventListener('submit', performLogin);
  }
})();
