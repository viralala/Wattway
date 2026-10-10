/* Dashboard UI: route planner, BFS, heap playground and self-checks (browser side). */
(function () {
  var graph = buildSampleGraph();
  var places = SAMPLE_NODES.filter(function (n) { return n.type === 'junction'; });
  var stations = SAMPLE_NODES.filter(function (n) { return n.type === 'station'; });
  var byId = {}; SAMPLE_NODES.forEach(function (n) { byId[n.id] = n; });

  var DEFAULT_WAITS = { ST1: 0, ST2: 5, ST3: 10, ST4: 0, ST5: 15, ST6: 0 };
  var state = {
    mode: 'plan', src: 'HJ', dst: 'HD', battery: 35, fullRange: 200, reserve: 10,
    charge: 30, priceW: 0.5, waits: Object.assign({}, DEFAULT_WAITS)
  };
  var lastRouteKey = '';
  var lastPlan = null;

  var LABEL = {
    HJ: [0, 28, 'middle'], WK: [-15, -14, 'end'], PM: [0, -16, 'middle'], BN: [-14, -12, 'end'],
    AU: [-14, -10, 'end'], KO: [0, 30, 'middle'], SN: [16, 30, 'start'], SW: [-14, 32, 'end'],
    VN: [0, -18, 'middle'], KH: [14, -12, 'start'], HD: [0, 30, 'middle'], KT: [0, 30, 'middle'],
    ST1: [0, 32, 'middle'], ST2: [0, -19, 'middle'], ST3: [0, 32, 'middle'], ST4: [0, -19, 'middle'],
    ST5: [0, 32, 'middle'], ST6: [0, 32, 'middle']
  };

  function $(id) { return document.getElementById(id); }
  function fmtMin(m) {
    var r = Math.round(m);
    if (r < 60) return r + ' min';
    return Math.floor(r / 60) + ' h ' + String(r % 60).padStart(2, '0') + ' min';
  }
  function fmtKm(k) { return (Math.round(k * 10) / 10).toFixed(1) + ' km'; }
  function usableNow() { return Math.max(0, (state.battery - state.reserve) / 100 * state.fullRange); }
  function edgeBetween(a, b) {
    for (var e of graph.neighbors(a)) if (e.to === b) return e;
    return null;
  }

  /* ---------- controls ---------- */
  function fillSelect(sel, value) {
    sel.innerHTML = places.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === value ? ' selected' : '') + '>' + p.name + '</option>';
    }).join('');
  }
  fillSelect($('src'), state.src);
  fillSelect($('dst'), state.dst);

  $('queues').innerHTML = stations.map(function (s) {
    return '<div class="qrow"><span title="' + s.name + '">' + s.name + '</span>' +
      '<input type="range" min="0" max="60" step="5" value="' + state.waits[s.id] + '" data-q="' + s.id + '" aria-label="Queue wait at ' + s.name + '">' +
      '<span class="val" id="qv-' + s.id + '"></span></div>';
  }).join('');

  $('legend').innerHTML =
    '<span><i style="background:var(--fg)"></i>Start</span>' +
    '<span><i style="background:var(--accent)"></i>Destination / route</span>' +
    '<span><i style="background:var(--stop)"></i>Charging stop</span>' +
    '<span><i style="border:2.5px solid var(--accent)"></i>Charging station</span>' +
    '<span><i style="background:var(--range)"></i>Reachable (BFS)</span>';

  $('src').addEventListener('change', function (e) { state.src = e.target.value; update(); });
  $('dst').addEventListener('change', function (e) { state.dst = e.target.value; update(); });
  $('battery').addEventListener('input', function (e) { state.battery = +e.target.value; update(); });
  $('fullrange').addEventListener('input', function (e) { state.fullRange = Math.max(1, +e.target.value || 1); update(); });
  $('reserve').addEventListener('input', function (e) { state.reserve = Math.min(50, Math.max(0, +e.target.value || 0)); update(); });
  $('charge').addEventListener('input', function (e) { state.charge = +e.target.value; update(); });
  $('pricew').addEventListener('input', function (e) { state.priceW = +e.target.value; update(); });
  $('queues').addEventListener('input', function (e) {
    var id = e.target.getAttribute('data-q');
    if (id) { state.waits[id] = +e.target.value; $('note').textContent = ''; update(); }
  });
  $('mode-plan').addEventListener('click', function () { state.mode = 'plan'; update(); });
  $('mode-reach').addEventListener('click', function () { state.mode = 'reach'; update(); });
  document.querySelectorAll('[data-preset]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.battery = +b.getAttribute('data-preset');
      state.src = 'HJ'; state.dst = 'HD'; state.fullRange = 200; state.reserve = 10;
      $('src').value = 'HJ'; $('dst').value = 'HD';
      $('note').textContent = '';
      update();
    });
  });
  $('reset-q').addEventListener('click', function () {
    state.waits = Object.assign({}, DEFAULT_WAITS); $('note').textContent = ''; update();
  });
  $('busy').addEventListener('click', function () {
    if (!lastPlan || !lastPlan.chargingStop) {
      $('note').textContent = 'Pick a trip that needs a charging stop first, for example "Needs a charge".';
      return;
    }
    var before = lastPlan.chargingStop;
    state.waits[before.stationId] = 45;
    var after = planRoute(graph, planInput(), { getWaitMinutes: getWait });
    if (after.chargingStop && after.chargingStop.stationId !== before.stationId) {
      $('note').textContent = 'A 45 min queue at ' + before.name + ' moved the stop to ' + after.chargingStop.name + '.';
    } else {
      $('note').textContent = 'A 45 min queue at ' + before.name + ' is still the best option for this trip.';
    }
    update();
  });

  function getWait(id) { return state.waits[id] || 0; }
  function planInput() {
    return { sourceId: state.src, destinationId: state.dst, batteryPercent: state.battery,
      fullRangeKm: state.fullRange, reservePercent: state.reserve, priceWeight: state.priceW,
      chargeMinutes: state.charge };
  }

  /* ---------- map ---------- */
  function boltAt(x, y, cls) {
    return '<polygon class="bolt ' + cls + '" transform="translate(' + x + ' ' + y + ')" points="2,-9 -5,1 -0.5,1 -2,9 5,-1 0.5,-1"/>';
  }
  function renderMap(plan, reach) {
    var s = '<defs><pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle class="dots" cx="2" cy="2" r="1.2"/></pattern></defs>';
    s += '<rect width="1000" height="640" fill="url(#dots)" opacity=".7"/>';

    SAMPLE_EDGES.forEach(function (e) {
      var a = byId[e[0]], b = byId[e[1]];
      var cls = 'edge';
      if (reach && reach.reachedIds.has(e[0]) && reach.reachedIds.has(e[1])) cls += ' reach';
      s += '<line class="' + cls + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>';
    });

    var stopId = plan && plan.chargingStop ? plan.chargingStop.stationId : null;
    if (plan && plan.feasible && plan.path.length > 1) {
      var key = state.src + '>' + state.dst + '>' + plan.path.join(',');
      var animate = key !== lastRouteKey; lastRouteKey = key;
      var pts = plan.path.map(function (id) { return byId[id].x + ',' + byId[id].y; }).join(' ');
      s += '<polyline class="route' + (animate ? ' animate' : '') + '" pathLength="1" points="' + pts + '"/>';
    }

    var srcId = state.src, dstId = state.mode === 'plan' ? state.dst : null;
    SAMPLE_NODES.forEach(function (n) {
      var cls = '';
      if (n.type === 'junction') {
        cls = 'place';
        if (reach && reach.reachedIds.has(n.id)) cls += ' reached';
        if (n.id === srcId) cls += ' src';
        if (n.id === dstId) cls += ' dst';
        var r = (n.id === srcId || n.id === dstId) ? 10 : 7;
        s += '<circle class="' + cls + '" cx="' + n.x + '" cy="' + n.y + '" r="' + r + '"/>';
      } else {
        cls = 'stn';
        if (reach && reach.reachedIds.has(n.id)) cls += ' reached';
        if (n.id === stopId) cls += ' stop';
        s += '<rect class="' + cls + '" x="' + (n.x - 13) + '" y="' + (n.y - 13) + '" width="26" height="26" rx="7"/>' + boltAt(n.x, n.y, '');
      }
    });

    SAMPLE_NODES.forEach(function (n) {
      var L = LABEL[n.id] || [0, 28, 'middle'];
      var x = n.x + L[0], y = n.y + L[1];
      var cls = n.type === 'station' ? 'lbl-stn' : 'lbl-place';
      var tag = '';
      if (n.id === srcId) tag = 'START'; else if (n.id === dstId) tag = 'END'; else if (n.id === stopId) tag = 'CHARGE HERE';
      s += '<text class="' + cls + '" x="' + x + '" y="' + y + '" text-anchor="' + L[2] + '">' + n.name +
        (tag ? '<tspan class="lbl-tag" x="' + x + '" dy="14">' + tag + '</tspan>' : '') + '</text>';
    });
    $('map').innerHTML = s;
  }

  /* ---------- results ---------- */
  function stat(k, v, small) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + (small ? ' <small>' + small + '</small>' : '') + '</div></div>';
  }
  function engineLine(plan) {
    var st = plan.stats;
    return '<div class="engine"><span>Dijkstra settled <b>' + plan.popOrder.length + '</b> nodes</span>' +
      '<span>Heap pushes <b>' + st.heapPushes + '</b></span><span>Heap pops <b>' + st.heapPops + '</b></span>' +
      '<span>Usable range now <b>' + fmtKm(st.usableNowKm) + '</b></span></div>';
  }
  function popOrderChips(plan) {
    var first = plan.popOrder.slice(0, 10).map(function (p) {
      return '<span>' + byId[p.id].name + ' ' + Math.round(p.time) + '</span>';
    }).join('');
    return '<h3 style="margin-top:14px">First nodes off the min-heap (name, minutes)</h3><div class="order">' + first + '</div>';
  }

  function renderPlan(plan) {
    var h = '<div class="card-head"><h2>Planned route</h2><span class="tag">dijkstra.ts · routePlanner.ts</span></div>';
    if (state.src === state.dst) {
      return h + '<span class="pill info">Start and destination are the same</span><p class="msg">Choose a different destination to plan a trip.</p>';
    }
    if (!plan.feasible) {
      return h + '<span class="pill bad">No route with this battery</span>' +
        '<p class="msg">' + plan.message + ' Usable range right now is ' + fmtKm(plan.stats.usableNowKm) +
        '. Raise the battery level or choose a closer destination.</p>' + engineLine(plan);
    }
    var pill = plan.needsCharging
      ? '<span class="pill warn">One charging stop</span>'
      : '<span class="pill good">Direct route, no charging needed</span>';
    var stats = stat('Total time', fmtMin(plan.totalTimeMin), plan.needsCharging ? 'drive + queue + charge' : '') +
      stat('Distance', fmtKm(plan.totalDistanceKm).replace(' km', ''), 'km') +
      stat('Battery used', Math.round(plan.totalDistanceKm / state.fullRange * 100), '% of a full charge');
    var steps = '';
    plan.path.forEach(function (id, i) {
      var n = byId[id], cls = '', meta = '';
      if (i > 0) { var e = edgeBetween(plan.path[i - 1], id); meta = e ? '+' + fmtKm(e.distanceKm) + ' · ' + fmtMin(e.timeMin) : ''; }
      if (i === 0) cls = 's-start';
      else if (i === plan.path.length - 1) cls = 's-end';
      else if (plan.chargingStop && id === plan.chargingStop.stationId) cls = 's-stop';
      else if (n.type === 'station') cls = 's-via';
      if (cls === 's-stop') {
        var cs = plan.chargingStop;
        meta = (meta ? meta + '<br>' : '') + 'Charge here: queue ' + fmtMin(cs.waitMin) + ', charging ' + fmtMin(cs.chargeMin) + ', ₹' + cs.pricePerKwh + '/kWh';
      }
      steps += '<li class="' + cls + '"><span class="step-name">' + n.name + '</span><span class="step-meta">' + meta + '</span></li>';
    });

    var right = '';
    if (plan.needsCharging) {
      var rows = plan.candidates.map(function (c, i) {
        var st = byId[c.id];
        return '<tr' + (i === 0 ? ' class="best"' : '') + '><td>' + st.name + (i === 0 ? ' <span class="pill good" style="padding:0 7px;font-size:11px">best</span>' : '') +
          '</td><td class="n">' + Math.round(c.t1) + '</td><td class="n">' + Math.round(c.wait) + '</td><td class="n">' + Math.round(c.t2) +
          '</td><td class="n">' + st.pricePerKwh + '</td><td class="n">' + c.cost.toFixed(1) + '</td></tr>';
      }).join('');
      right = '<h3>Stations ranked by the min-heap (minutes)</h3><div class="tablewrap"><table><thead><tr><th>Station</th><th class="n">To stop</th><th class="n">Queue</th><th class="n">Onward</th><th class="n">₹/kWh</th><th class="n">Score</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="formula">Score = drive to the station + queue wait + charging time + drive to the destination + price weight × ₹/kWh. The lowest score wins. Only stations the battery can reach, and that can reach the destination on a full charge, are ranked.</p>';
    } else {
      right = '<h3>How it was found</h3><p class="msg" style="margin-top:0">Dijkstra explored outward from the start, always taking the cheapest unvisited node off the min-heap. Any road that would push the trip past the usable range (' + fmtKm(plan.stats.usableNowKm) + ') was pruned, and the destination was still reachable, so no charging stop is needed. Lower the battery to see a stop being added.</p>';
    }
    return h + pill + '<div class="stats">' + stats + '</div>' +
      '<div class="res-cols"><div><h3>Route</h3><ol class="steps">' + steps + '</ol></div><div>' + right + '</div></div>' +
      engineLine(plan) + popOrderChips(plan);
  }

  function renderReach(reach) {
    var h = '<div class="card-head"><h2>Stations within range</h2><span class="tag">bfs.ts</span></div>';
    var range = usableNow();
    var pill = reach.stations.length
      ? '<span class="pill info">' + reach.stations.length + ' of ' + stations.length + ' stations reachable</span>'
      : '<span class="pill bad">No station within range</span>';
    var rows = reach.stations.map(function (s) {
      var n = byId[s.id];
      return '<tr><td>' + s.name + '</td><td class="n">' + fmtKm(s.distKm) + '</td><td class="n">₹' + n.pricePerKwh + '</td><td class="n">' + fmtMin(getWait(s.id)) + '</td></tr>';
    }).join('');
    var table = reach.stations.length
      ? '<div class="tablewrap"><table><thead><tr><th>Station</th><th class="n">By road</th><th class="n">Price/kWh</th><th class="n">Queue</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<p class="msg">Usable range is ' + fmtKm(range) + '. Raise the battery level to reach a station.</p>';
    return h + pill + '<div class="stats">' + stat('Usable range', Math.round(range), 'km') + stat('Nodes visited', reach.visits) + stat('Stations found', reach.stations.length) + '</div>' +
      table + '<p class="formula">Breadth-first search expands level by level from the start using a FIFO queue. A road is skipped when the distance from the start would go past the usable range. Reached roads are drawn in blue on the map.</p>';
  }

  /* ---------- main update ---------- */
  function update() {
    var plan = null, reach = null;
    var isPlan = state.mode === 'plan';
    $('mode-plan').setAttribute('aria-pressed', String(isPlan));
    $('mode-reach').setAttribute('aria-pressed', String(!isPlan));
    $('dst-field').hidden = !isPlan;
    document.querySelectorAll('[data-plan-only]').forEach(function (el) { el.hidden = !isPlan; });

    $('battery').value = state.battery;
    $('battery-val').textContent = state.battery + '%';
    $('usable-hint').textContent = 'Usable range now: ' + fmtKm(usableNow()) + ' (after the ' + state.reserve + '% reserve)';
    $('charge-val').textContent = state.charge + ' min';
    $('pricew-val').textContent = state.priceW.toFixed(1) + ' min per ₹';
    stations.forEach(function (s) {
      $('qv-' + s.id).textContent = state.waits[s.id] + ' min';
      var inp = document.querySelector('[data-q="' + s.id + '"]');
      if (inp && +inp.value !== state.waits[s.id]) inp.value = state.waits[s.id];
    });

    if (isPlan) {
      if (state.src === state.dst) { plan = { feasible: false, path: [], popOrder: [], stats: {}, message: '' }; }
      else plan = planRoute(graph, planInput(), { getWaitMinutes: getWait });
      lastPlan = plan;
      $('result').innerHTML = renderPlan(plan);
      renderMap(state.src === state.dst ? null : plan, null);
    } else {
      reach = reachableStations(graph, state.src, usableNow());
      $('result').innerHTML = renderReach(reach);
      renderMap(null, reach);
    }
  }

  /* ---------- heap playground ---------- */
  var heap = new MinHeap(function (a, b) { return a - b; });
  [5, 1, 9, 3, 7, 2].forEach(function (x) { heap.push(x); });
  function renderHeap(msg) {
    var d = heap.data;
    if (msg) $('heap-msg').textContent = msg;
    $('heap-arr').innerHTML = d.length ? d.map(function (v, i) {
      return '<div class="cell' + (i === 0 ? ' root' : '') + '">' + v + '<small>' + i + '</small></div>';
    }).join('') : '<p class="empty">The heap is empty. Push a number.</p>';
    var rows = '', lvl = 0, start = 0;
    while (start < d.length) {
      var end = Math.min(d.length, start * 2 + 1);
      var cells = d.slice(start, end).map(function (v, k) {
        return '<div class="cell' + (start + k === 0 ? ' root' : '') + '">' + v + '</div>';
      }).join('');
      rows += '<div class="row">' + cells + '</div>';
      start = end; lvl++;
    }
    $('heap-tree').innerHTML = rows || '';
  }
  $('heap-push').addEventListener('click', function () {
    var v = parseFloat($('heap-in').value);
    if (isNaN(v)) { renderHeap('Type a number first.'); return; }
    heap.push(v); renderHeap('Pushed ' + v + '. It moved up until its parent was smaller.');
  });
  $('heap-in').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('heap-push').click(); });
  $('heap-rand').addEventListener('click', function () {
    var v = Math.floor(Math.random() * 99) + 1;
    $('heap-in').value = v; heap.push(v); renderHeap('Pushed ' + v + '. It moved up until its parent was smaller.');
  });
  $('heap-pop').addEventListener('click', function () {
    var v = heap.pop();
    renderHeap(v === undefined ? 'Nothing to pop, the heap is empty.' : 'Popped ' + v + ' (the minimum). The last value moved to the root and sank down.');
  });
  $('heap-clear').addEventListener('click', function () { while (!heap.isEmpty()) heap.pop(); renderHeap('Heap cleared.'); });

  /* ---------- self-checks ---------- */
  var results = runSelfChecks({ Graph: Graph, MinHeap: MinHeap, dijkstra: dijkstra, buildPath: buildPath,
    reachableStations: reachableStations, planRoute: planRoute, buildSampleGraph: buildSampleGraph });
  var passed = results.filter(function (r) { return r.ok; }).length;
  $('chk-big').textContent = passed + '/' + results.length;
  $('chk-text').textContent = passed === results.length ? 'checks passing' : 'checks passing, some are failing';
  var html = '', group = '';
  results.forEach(function (r) {
    if (r.group !== group) { if (group) html += '</ul>'; html += '<div class="grp">' + r.group + '</div><ul class="plain">'; group = r.group; }
    html += '<li><span class="' + (r.ok ? 'ok' : 'fail') + '" aria-label="' + (r.ok ? 'passed' : 'failed') + '">' + (r.ok ? '✓' : '✗') + '</span><span>' + r.name + '</span></li>';
  });
  $('chk-list').innerHTML = html + '</ul>';

  renderHeap();

  /* ---------- hooks used by live.js (backend data) ---------- */
  var liveIds = {};
  window.WWPlanner = {
    stationIds: stations.map(function (s) { return s.id; }),
    /* data: { ST1: { pricePerKwh, waitMin, label } } */
    applyLive: function (data) {
      Object.keys(data).forEach(function (id) {
        if (!byId[id]) return;
        var d = data[id];
        byId[id].pricePerKwh = d.pricePerKwh;
        graph.getNode(id).pricePerKwh = d.pricePerKwh;
        state.waits[id] = Math.max(0, Math.min(60, Math.round(d.waitMin / 5) * 5));
        liveIds[id] = d.label || true;
      });
      markLive();
      $('note').textContent = '';
      update();
    },
    setFullRange: function (km) {
      state.fullRange = km; $('fullrange').value = km; update();
    }
  };
  function markLive() {
    stations.forEach(function (s) {
      var row = document.querySelector('[data-q="' + s.id + '"]');
      if (!row) return;
      var label = row.parentNode.firstChild;
      label.textContent = s.name + (liveIds[s.id] ? ' ● live' : '');
      label.style.color = liveIds[s.id] ? 'var(--accent)' : '';
    });
  }

  update();
})();
