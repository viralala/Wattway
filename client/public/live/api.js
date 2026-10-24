/* WattWay API client for the dashboard.
   Same-origin by default (the server hosts this page). Open the page from
   somewhere else with  ?api=http://localhost:4000  and the origin must be in CORS_ORIGIN. */
(function () {
  var params = new URLSearchParams(location.search);
  var base = (params.get('api') || (location.protocol.indexOf('http') === 0 ? '' : 'http://localhost:4000')).replace(/\/$/, '');

  function store(key, val) {
    try { if (val === undefined) return sessionStorage.getItem(key); if (val === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, val); } catch (e) { /* storage blocked */ }
    return null;
  }

  var session = { user: null, access: store('ww.access'), refresh: store('ww.refresh') };
  var listeners = [];
  function emit() { listeners.forEach(function (f) { f(session.user); }); }

  function ApiError(status, code, message, details) {
    var e = new Error(message || code || ('HTTP ' + status));
    e.status = status; e.code = code; e.details = details;
    return e;
  }

  function setTokens(payload) {
    session.access = payload.accessToken; session.refresh = payload.refreshToken;
    store('ww.access', session.access); store('ww.refresh', session.refresh);
  }
  function clearSession() {
    session.user = null; session.access = null; session.refresh = null;
    store('ww.access', null); store('ww.refresh', null);
    emit();
  }

  function raw(method, path, body, auth) {
    var headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && session.access) headers.Authorization = 'Bearer ' + session.access;
    return fetch(base + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (json) {
          if (res.ok && json && json.success) return json;
          var err = (json && json.error) || {};
          throw ApiError(res.status, err.code, err.message, err.details);
        });
      }, function () {
        throw ApiError(0, 'NETWORK', 'Cannot reach the backend at ' + (base || location.origin));
      });
  }

  var refreshing = null;
  function refreshTokens() {
    if (!session.refresh) return Promise.reject(ApiError(401, 'UNAUTHORIZED', 'Signed out'));
    if (!refreshing) {
      refreshing = raw('POST', '/api/auth/refresh', { refreshToken: session.refresh }, false)
        .then(function (r) { setTokens(r.data); })
        .finally(function () { refreshing = null; });
    }
    return refreshing;
  }

  /* TOKEN_EXPIRED means refresh and retry, never sign the user out (see docs/API.md). */
  function request(method, path, body, auth) {
    return raw(method, path, body, auth).catch(function (err) {
      if (auth && err.code === 'TOKEN_EXPIRED') {
        return refreshTokens().then(function () { return raw(method, path, body, auth); }, function (e2) { clearSession(); throw e2; });
      }
      throw err;
    });
  }

  function qs(obj) {
    var p = new URLSearchParams();
    Object.keys(obj).forEach(function (k) { if (obj[k] !== '' && obj[k] !== undefined && obj[k] !== null && obj[k] !== false) p.set(k, obj[k]); });
    var s = p.toString();
    return s ? '?' + s : '';
  }

  window.WW = {
    base: base || location.origin,
    session: session,
    onAuth: function (f) { listeners.push(f); },
    get: function (path, query, auth) { return request('GET', path + (query ? qs(query) : ''), undefined, !!auth); },
    send: function (method, path, body) { return request(method, path, body, true); },
    /* Resolve with the HTTP status instead of throwing; used for the status probes. */
    probe: function (method, path) {
      return raw(method, path, method === 'GET' ? undefined : {}, false).then(
        function (j) { return { status: 200, json: j }; },
        function (e) { return { status: e.status, code: e.code, message: e.message, details: e.details }; });
    },
    login: function (email, password) {
      return raw('POST', '/api/auth/login', { email: email, password: password }, false).then(function (r) {
        setTokens(r.data); session.user = r.data.user; emit(); return r.data.user;
      });
    },
    logout: function () {
      var p = session.access ? request('POST', '/api/auth/logout', {}, true).catch(function () {}) : Promise.resolve();
      return p.then(clearSession);
    },
    /* Restore a session from sessionStorage after a page reload. */
    restore: function () {
      if (!session.access && !session.refresh) return Promise.resolve(null);
      return request('GET', '/api/auth/me', undefined, true).then(function (r) {
        session.user = r.data.user; emit(); return session.user;
      }, function () { clearSession(); return null; });
    },
    qs: qs
  };
})();
