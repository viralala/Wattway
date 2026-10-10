/* Live backend features: health, sign-in, Trie/BST search, port control, index stats, status probes. */
(function () {
  var W = window.WW;
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); };
  }
  function msg(err) { return err && err.message ? err.message : 'Something went wrong'; }

  var me = null;          // signed-in user
  var where = null;       // { lat, lng } from the browser, when shared
  var seq = 0;            // discards out-of-order search responses

  /* ---------- health ---------- */
  var online = false;
  function checkHealth() {
    return W.get('/api/health').then(function (r) {
      var d = r.data;
      online = true;
      $('api-status').className = 'pill good';
      $('api-status').textContent = 'Backend online · ' + d.index.stations + ' stations indexed';
    }, function (e) {
      online = false;
      $('api-status').className = 'pill bad';
      $('api-status').textContent = e.status === 0 ? 'Backend offline' : e.status === 429 ? 'Backend busy (rate limit), retrying' : 'Backend: ' + e.code;
    });
  }

  /* ---------- auth ---------- */
  var QUICK = [
    ['Driver', 'driver@wattway.dev'],
    ['Operator', 'operator@wattway.dev'],
    ['Admin', 'admin@wattway.dev']
  ];
  function renderAuth() {
    var box = $('auth-box');
    if (me) {
      var v = me.vehicle;
      box.innerHTML = '<p class="sect">Signed in</p>' +
        '<div class="who"><b>' + esc(me.name) + '</b><span class="pill info">' + esc(me.role) + '</span></div>' +
        '<div class="hint" style="margin:0">' + esc(me.email) + '</div>' +
        (v && v.rangeKm ? '<button type="button" class="btn" id="use-vehicle">Use my ' + esc(v.make) + ' ' + esc(v.model) + ' (' + esc(v.rangeKm) + ' km)</button>' : '') +
        '<button type="button" class="btn" id="logout">Sign out</button>';
      $('logout').addEventListener('click', function () { W.logout(); });
      var uv = $('use-vehicle');
      if (uv) uv.addEventListener('click', function () { window.WWPlanner.setFullRange(v.rangeKm); });
    } else {
      box.innerHTML = '<p class="sect">Sign in to the API</p>' +
        '<div class="btnrow">' + QUICK.map(function (q, i) {
          return '<button type="button" class="btn" data-quick="' + i + '">' + q[0] + '</button>';
        }).join('') + '</div>' +
        '<form id="login-form" class="stack" style="gap:6px"><input type="email" id="lg-email" placeholder="email" autocomplete="username" required>' +
        '<input type="password" id="lg-pass" placeholder="password" autocomplete="current-password" required>' +
        '<button type="submit" class="btn primary">Sign in</button></form>' +
        '<p class="note" id="auth-note" aria-live="polite"></p>' +
        '<p class="hint" style="margin:0">Seeded demo accounts are one click away. Operators and admins can change port status; admins can rebuild the index.</p>';
      box.querySelectorAll('[data-quick]').forEach(function (b) {
        b.addEventListener('click', function () { signIn(QUICK[+b.getAttribute('data-quick')][1], 'kothimbir123'); });
      });
      $('login-form').addEventListener('submit', function (e) { e.preventDefault(); signIn($('lg-email').value, $('lg-pass').value); });
    }
  }
  function signIn(email, pass) {
    var note = $('auth-note'); if (note) note.textContent = 'Signing in…';
    W.login(email, pass).catch(function (e) { if ($('auth-note')) $('auth-note').textContent = msg(e); });
  }
  W.onAuth(function (u) {
    me = u; renderAuth(); renderDetail(); loadIndex(); runProbes();
  });

  /* ---------- station search ---------- */
  function filters() {
    var f = {
      minPrice: $('f-minp').value, maxPrice: $('f-maxp').value, minRating: $('f-rate').value,
      connectorType: $('f-conn').value, city: $('f-city').value,
      onlyWithFreePorts: $('f-free').checked ? 'true' : '', sort: $('f-sort').value, explain: 'true', limit: 50
    };
    if (where) { f.lat = where.lat; f.lng = where.lng; }
    return f;
  }
  function search() {
    var mine = ++seq;
    if ($('f-sort').value === 'distance_asc' && !where) {
      $('s-table').innerHTML = '<tbody><tr><td class="empty">Share your location to sort by distance.</td></tr></tbody>';
      return;
    }
    return W.get('/api/search/range', filters()).then(function (r) {
      if (mine !== seq) return;
      renderResults(r.data.stations, r.meta);
    }, function (e) {
      if (mine !== seq) return;
      $('s-explain').hidden = true;
      $('s-table').innerHTML = '<tbody><tr><td class="fail">' + esc(msg(e)) + (e.details && e.details[0] ? ' · ' + esc(e.details[0].message || '') : '') + '</td></tr></tbody>';
    });
  }
  function renderResults(list, meta) {
    var ex = meta.explain, pg = meta.pagination;
    var box = $('s-explain');
    if (ex) {
      box.hidden = false;
      box.innerHTML = '<span class="pill info">' + esc(meta.dataStructure) + '</span> ' +
        '<span><b>' + esc(ex.drivingIndex) + '</b> index drove the scan</span>' +
        '<span>scanned <b>' + ex.candidatesScanned + '</b>, matched <b>' + ex.matched + '</b></span>' +
        '<span>' + ex.tookMs + ' ms</span><span class="why">' + esc(ex.reason) + '</span>';
    }
    if (!list.length) {
      $('s-table').innerHTML = '<tbody><tr><td class="empty">No station matches these filters. Widen the price band.</td></tr></tbody>';
      return;
    }
    var rows = list.map(function (s) {
      return '<tr class="pick" tabindex="0" data-id="' + esc(s.id) + '"><td>' + esc(s.name) + '<small class="sub2">' + esc(s.address.locality) + ', ' + esc(s.address.city) + ' · ' + esc(s.operator) + '</small></td>' +
        '<td class="n">₹' + s.pricePerKwh.toFixed(2) + '</td><td class="n">' + (s.rating ? s.rating.toFixed(1) + ' ★' : '–') + '</td>' +
        '<td>' + s.connectorTypes.map(esc).join(', ') + '</td>' +
        '<td class="n"><span class="pill ' + (s.freePorts ? 'good' : 'bad') + '">' + s.freePorts + '/' + s.totalPorts + '</span></td>' +
        '<td class="n">' + s.queueLength + '</td>' +
        (where ? '<td class="n">' + (s.distanceKm !== undefined ? s.distanceKm.toFixed(1) + ' km' : '–') + '</td>' : '') + '</tr>';
    }).join('');
    $('s-table').innerHTML = '<thead><tr><th>Station</th><th class="n">₹/kWh</th><th class="n">Rating</th><th>Connectors</th><th class="n">Free</th><th class="n">Queue</th>' +
      (where ? '<th class="n">Away</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody>' +
      '<caption class="cap">' + (pg ? pg.total : list.length) + ' stations · click a row for ports</caption>';
  }
  $('s-table').addEventListener('click', function (e) {
    var tr = e.target.closest('tr.pick'); if (tr) openDetail(tr.getAttribute('data-id'));
  });
  $('s-table').addEventListener('keydown', function (e) {
    var tr = e.target.closest('tr.pick'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(tr.getAttribute('data-id')); }
  });
  ['f-minp', 'f-maxp'].forEach(function (id) { $(id).addEventListener('input', debounce(search, 300)); });
  ['f-rate', 'f-conn', 'f-city', 'f-sort', 'f-free'].forEach(function (id) { $(id).addEventListener('change', search); });
  $('s-run').addEventListener('click', search);
  $('s-reset').addEventListener('click', function () {
    ['f-minp', 'f-maxp', 'f-rate', 'f-conn', 'f-city', 'q'].forEach(function (id) { $(id).value = ''; });
    $('f-free').checked = false; $('f-sort').value = 'price_asc'; closeAc(); search();
  });
  $('s-near').addEventListener('click', function () {
    if (!navigator.geolocation) { $('s-where').textContent = 'Location is not available in this browser.'; return; }
    $('s-where').textContent = 'Asking for your location…';
    navigator.geolocation.getCurrentPosition(function (p) {
      where = { lat: +p.coords.latitude.toFixed(4), lng: +p.coords.longitude.toFixed(4) };
      $('s-where').textContent = 'Using ' + where.lat + ', ' + where.lng;
      $('f-sort').value = 'distance_asc'; search();
    }, function () { $('s-where').textContent = 'Location was not shared.'; }, { timeout: 8000 });
  });

  /* ---------- Trie autocomplete ---------- */
  var acItems = [], acActive = -1, acSeq = 0;
  function closeAc() { $('ac-list').hidden = true; $('q').setAttribute('aria-expanded', 'false'); acActive = -1; }
  function paintAc() {
    var ul = $('ac-list');
    ul.innerHTML = acItems.map(function (s, i) {
      return '<li role="option" id="ac-' + i + '" data-i="' + i + '" aria-selected="' + (i === acActive) + '"' + (i === acActive ? ' class="on"' : '') + '><span>' + esc(s.name) + '</span><small>' + esc(s.locality) + ', ' + esc(s.city) + ' · ₹' + s.pricePerKwh + '</small></li>';
    }).join('') || '<li class="none">No match</li>';
    ul.hidden = false; $('q').setAttribute('aria-expanded', 'true');
  }
  var runAc = debounce(function () {
    var q = $('q').value.trim();
    if (q.length < 2) { closeAc(); return; }
    var mine = ++acSeq;
    var query = { q: q, limit: 8 };
    if (where) { query.lat = where.lat; query.lng = where.lng; }
    W.get('/api/search/autocomplete', query).then(function (r) {
      if (mine !== acSeq) return;
      acItems = r.data.suggestions; acActive = -1; paintAc();
    }, closeAc);
  }, 150);
  $('q').addEventListener('input', runAc);
  $('q').addEventListener('keydown', function (e) {
    if ($('ac-list').hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); acActive = Math.min(acItems.length - 1, acActive + 1); paintAc(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acActive = Math.max(0, acActive - 1); paintAc(); }
    else if (e.key === 'Enter' && acActive >= 0) { e.preventDefault(); pickAc(acActive); }
    else if (e.key === 'Escape') closeAc();
  });
  $('ac-list').addEventListener('mousedown', function (e) {
    var li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pickAc(+li.getAttribute('data-i')); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.ac')) closeAc(); });
  function pickAc(i) {
    var s = acItems[i]; if (!s) return;
    $('q').value = s.name; closeAc();
    // narrow the table to the picked station's city and open it
    $('f-city').value = s.city; if ($('f-city').value !== s.city) $('f-city').value = '';
    Promise.resolve(search()).then(function () { openDetail(s.id); });
  }

  /* ---------- station detail: ports (Array) + rating ---------- */
  var detail = null;
  var NEXT = { free: 'occupied', occupied: 'faulted', faulted: 'free' };
  function openDetail(id) {
    W.get('/api/stations/' + encodeURIComponent(id)).then(function (r) {
      detail = r.data.station; detail._note = ''; renderDetail();
      $('s-detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, function (e) { detail = null; $('s-detail').hidden = false; $('s-detail').innerHTML = '<p class="fail">' + esc(msg(e)) + '</p>'; });
  }
  function canControl() { return me && (me.role === 'operator' || me.role === 'admin'); }
  function renderDetail() {
    var box = $('s-detail');
    if (!detail) { box.hidden = true; return; }
    var s = detail;
    box.hidden = false;
    box.innerHTML = '<div class="card-head"><h3 style="margin:0">' + esc(s.name) + '</h3><button type="button" class="btn" id="d-close">Close</button></div>' +
      '<p class="hint" style="margin:0 0 10px">' + esc(s.address.line1) + ', ' + esc(s.address.locality) + ', ' + esc(s.address.city) + ' ' + esc(s.address.pincode) + ' · ' + esc(s.operator) + ' · ' + esc((s.amenities || []).join(', ')) + '</p>' +
      '<h3>Ports <span class="tag">' + (canControl() ? 'click a port to change its status' : 'sign in as an operator or admin to change status') + '</span></h3>' +
      '<div class="ports">' + s.ports.map(function (p) {
        return '<button type="button" class="port ' + esc(p.status) + '" data-p="' + p.index + '"' + (canControl() ? '' : ' disabled') + '><b>#' + p.index + '</b> ' + esc(p.connectorType) + ' · ' + p.powerKw + ' kW<span>' + esc(p.status) + '</span></button>';
      }).join('') + '</div>' +
      '<h3 style="margin-top:14px">Rate this station <span class="tag">' + esc(s.rating.average.toFixed(2)) + ' from ' + s.rating.count + ' ratings</span></h3>' +
      '<div class="btnrow">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button type="button" class="btn" data-r="' + n + '"' + (me ? '' : ' disabled') + '>' + n + ' ★</button>';
      }).join('') + (me ? '' : '<span class="hint" style="margin:0;align-self:center">Sign in to rate.</span>') + '</div>' +
      '<p class="note" id="d-note" aria-live="polite">' + esc(s._note || '') + '</p>';
    $('d-close').addEventListener('click', function () { detail = null; renderDetail(); });
    box.querySelectorAll('[data-p]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-p'), cur = s.ports[i].status;
        setNote('Updating port #' + i + '…');
        W.send('PATCH', '/api/stations/' + encodeURIComponent(s.id) + '/ports/' + i, { status: NEXT[cur] }).then(function () {
          return W.get('/api/stations/' + encodeURIComponent(s.id));
        }).then(function (r) {
          detail = r.data.station; detail._note = 'Port #' + i + ' is now ' + NEXT[cur] + '. The index updated in O(1).'; renderDetail();
          search(); loadIndex();
        }, function (e) { setNote(msg(e)); });
      });
    });
    box.querySelectorAll('[data-r]').forEach(function (b) {
      b.addEventListener('click', function () {
        setNote('Saving rating…');
        W.send('POST', '/api/stations/' + encodeURIComponent(s.id) + '/rating', { rating: +b.getAttribute('data-r') }).then(function (r) {
          s.rating = r.data.rating; s._note = 'Thanks. The station moved in the rating BST.'; renderDetail();
          search(); loadIndex();
        }, function (e) { setNote(msg(e)); });
      });
    });
  }
  function setNote(t) { var n = $('d-note'); if (n) n.textContent = t; }

  /* ---------- index stats ---------- */
  function treeRow(name, t) {
    var pct = Math.min(100, Math.round(t.idealHeight / Math.max(1, t.height) * 100));
    return '<div class="trow"><div><b>' + name + '</b> <span class="tag">' + t.values + ' stations · ' + t.keys + ' keys · ₹/★ ' + t.minKey + ' to ' + t.maxKey + '</span></div>' +
      '<div class="bar" title="ideal height ' + t.idealHeight + ', actual ' + t.height + '"><i style="width:' + pct + '%"></i></div>' +
      '<div class="tag">height ' + t.height + ' (ideal ' + t.idealHeight + ') · ' + (t.balanced ? '<span class="ok">balanced</span>' : '<span class="fail">drifting</span>') + '</div></div>';
  }
  function loadIndex() {
    return W.get('/api/index/stats').then(function (r) {
      var d = r.data;
      $('idx-body').innerHTML = treeRow('Price BST', d.priceIndex) + treeRow('Rating BST', d.ratingIndex) +
        '<div class="trow"><div><b>Name Trie</b></div><div class="tag">' + d.nameIndex.terms + ' terms · ' + d.nameIndex.entries + ' entries · ' + d.nameIndex.nodes + ' nodes · depth ' + d.nameIndex.maxDepth + '</div>' +
        '<div class="tag">built in ' + d.lastBuildMs + ' ms · ' + d.buildCount + ' build(s)</div></div>';
    }, function (e) { $('idx-body').innerHTML = '<p class="fail">' + esc(msg(e)) + '</p>'; });
  }
  function adminAction(path, label) {
    var note = $('idx-note');
    if (!me) { note.textContent = 'Sign in as admin first.'; return; }
    note.textContent = label + '…';
    W.send('POST', path, {}).then(function () { note.textContent = label + ' done.'; loadIndex(); search(); },
      function (e) { note.textContent = e.status === 403 ? 'Admin only. You are signed in as ' + me.role + '.' : msg(e); });
  }
  $('idx-refresh').addEventListener('click', function () { loadIndex(); $('idx-note').textContent = ''; });
  $('idx-rebalance').addEventListener('click', function () { adminAction('/api/index/rebalance', 'Rebalance'); });
  $('idx-rebuild').addEventListener('click', function () { adminAction('/api/index/rebuild', 'Rebuild'); });

  /* ---------- live data into the route planner ---------- */
  var MAP = {
    ST1: 'Hinjewadi Phase 1 Charge Park', ST2: 'Baner Highway Charge Stop',
    ST4: 'Shivajinagar Bus Depot Charge', ST5: 'Koregaon Park EV Station'
  };
  function syncLive() {
    var hint = $('live-hint');
    return W.get('/api/stations', { city: 'Pune', limit: 100 }).then(function (r) {
      var byName = {}; r.data.stations.forEach(function (s) { byName[s.name] = s; });
      var data = {}, n = 0;
      Object.keys(MAP).forEach(function (id) {
        var s = byName[MAP[id]]; if (!s) return;
        // Queue module is not live yet: estimate the wait from queue length and free ports.
        data[id] = { pricePerKwh: s.pricePerKwh, waitMin: s.queueLength * 8 + (s.freePorts === 0 ? 10 : 0), label: s.name };
        n++;
      });
      window.WWPlanner.applyLive(data);
      hint.textContent = n + ' stations now use live prices and queues (wait = 8 min per car queued, +10 min when every port is busy). Make a port busy in the search table and press this again.';
    }, function (e) { hint.textContent = 'Could not load live data: ' + msg(e); });
  }
  $('sync-live').addEventListener('click', syncLive);

  /* ---------- module status, from real requests ---------- */
  function row(name, code, pill, text) {
    return '<li><span>' + name + ' <code>' + code + '</code></span><span class="pill ' + pill + '">' + text + '</span></li>';
  }
  function runProbes() {
    var out = [];
    Promise.all([
      W.probe('GET', '/api/health'),
      W.probe('GET', '/api/search/autocomplete?q=ba'),
      W.probe('GET', '/api/search/range?minPrice=9&maxPrice=14'),
      W.probe('GET', '/api/index/stats'),
      W.probe('GET', '/api/stations?limit=1'),
      W.probe('POST', '/api/routes/plan'),
      W.probe('GET', '/api/queue/probe'),
      W.probe('GET', '/api/trips')
    ]).then(function (p) {
      function live(r, name, code) { return row(name, code, r.status === 200 ? 'good' : 'bad', r.status === 200 ? 'Live' : (r.status || 'Down')); }
      function pending(r, name, code) {
        var mod = r.details && r.details.module;
        return row(name, code, r.status === 501 ? 'info' : (r.status === 200 ? 'good' : 'bad'), r.status === 501 ? 'Next' + (mod ? ' · ' + esc(mod) : '') : (r.status === 200 ? 'Live' : r.status || 'Down'));
      }
      out.push(live(p[0], 'Health and database', 'GET /api/health'));
      out.push(live(p[4], 'Station listing', 'GET /api/stations'));
      out.push(live(p[1], 'Trie autocomplete', 'GET /api/search/autocomplete'));
      out.push(live(p[2], 'BST range search', 'GET /api/search/range'));
      out.push(live(p[3], 'Index statistics', 'GET /api/index/stats'));
      out.push(row('Sign-in and tokens', 'POST /api/auth/login', me ? 'good' : 'info', me ? 'Signed in' : 'Sign in to test'));
      out.push('<li><span>Graph, Min-Heap, Dijkstra, BFS <code>in this browser</code></span><span class="pill good">Working</span></li>');
      out.push(pending(p[5], 'Route planning endpoint', 'POST /api/routes/plan'));
      out.push(pending(p[6], 'Live queue waits', 'GET /api/queue/:id'));
      out.push(pending(p[7], 'Trip history', 'GET /api/trips'));
      $('status-list').innerHTML = out.join('');
      var ok = p.slice(0, 5).filter(function (r) { return r.status === 200; }).length;
      $('status-tag').textContent = ok + '/5 endpoints live';
    });
  }

  /* ---------- boot ---------- */
  function fillCities() {
    return W.get('/api/stations', { limit: 100 }).then(function (r) {
      var cities = {}; r.data.stations.forEach(function (s) { cities[s.address.city] = true; });
      var sel = $('f-city');
      Object.keys(cities).sort().forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
    }, function () {});
  }
  renderAuth();
  checkHealth().then(function () {
    if (!online) { $('idx-body').innerHTML = '<p class="fail">The backend is not reachable. Start it with <code>npm run demo</code> in <code>server/</code>.</p>'; runProbes(); return; }
    return Promise.all([fillCities(), W.restore()]).then(function () {
      renderAuth(); search(); loadIndex(); runProbes(); syncLive();
    });
  });
  setInterval(function () { if (!document.hidden) checkHealth(); }, 60000);
})();
