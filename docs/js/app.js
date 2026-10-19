/* JeansMixing web — app.js
 * All screens, ported from the Android activities:
 *   MainActivity, EntryActivity, ReviewActivity, LockedActivity,
 *   PlacingActivity, BoxDetailActivity, StaplingActivity.
 */
(function () {
  'use strict';
  var M = window.JM;
  // Single source of truth for the displayed version (Projects title).
  // Bump this with every release, alongside the ?v= cache-busters.
  var APP_VERSION = '1.2.7';

  function el(id) { return document.getElementById(id); }

  var projects = M.Store.load();
  var ui = M.Store.loadUI();

  function persist() { M.Store.save(projects); M.Store.saveUI(ui); }
  function activeProject() {
    for (var i = 0; i < projects.length; i++) {
      if (projects[i].id === ui.activeId) return projects[i];
    }
    return null;
  }
  function setEnabled(b, on) { b.disabled = !on; }

  /* ---------------------------------------------------------------- settings
     Global preferences (localStorage 'jm_settings_v1'). Defaults reproduce the
     app exactly as-is; everything here is opt-in customization. */
  var SETTINGS_KEY = 'jm_settings_v1';
  function defaultSettings() {
    return {
      pairsPerBox: 25,
      flippingEnabled: true,
      bundles: [
        { name: 'bundle 1', layers: 6 },
        { name: 'bundle 2', layers: 6 },
        { name: 'bundle 3', layers: 6 },
        { name: 'bundle 4', layers: 6 },
        { name: 'top pair', layers: 1 }
      ],
      quickAdds: [1, 5, 10],
      darkMode: false,
      uiScale: 1,
      experimental: false
    };
  }
  function loadSettings() {
    var d = defaultSettings(), s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { s = {}; }
    var out = {
      pairsPerBox: (s.pairsPerBox > 0) ? Math.floor(s.pairsPerBox) : d.pairsPerBox,
      flippingEnabled: s.flippingEnabled !== false,
      bundles: d.bundles,
      quickAdds: d.quickAdds,
      darkMode: s.darkMode === true,
      uiScale: (s.uiScale > 0) ? Math.min(2, Math.max(0.5, s.uiScale)) : d.uiScale,
      experimental: s.experimental === true
    };
    if (Array.isArray(s.bundles) && s.bundles.length) {
      out.bundles = s.bundles.filter(function (b) {
        return b && typeof b.name === 'string' && b.layers > 0;
      }).map(function (b) {
        return { name: String(b.name).slice(0, 24) || 'bundle', layers: Math.max(1, Math.floor(b.layers)) };
      });
      if (!out.bundles.length) out.bundles = d.bundles;
    } else if (Array.isArray(s.bundles)) {
      out.bundles = []; // user deleted them all: flipping gets disabled below
    }
    if (Array.isArray(s.quickAdds) && s.quickAdds.length) {
      out.quickAdds = s.quickAdds.filter(function (q) { return q > 0; })
        .slice(0, 5).map(function (q) { return Math.floor(q); });
      if (!out.quickAdds.length) out.quickAdds = d.quickAdds;
    }
    if (!out.bundles.length) out.flippingEnabled = false;
    return out;
  }
  var settings = loadSettings();
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
    applySettings();
  }
  function applySettings() {
    // UI scale: root font-size drives every rem in the stylesheet, so the whole
    // app shrinks/grows and reflows naturally. body stays 100dvh (viewport units
    // don't care about font-size), so there's never a blank gap, and smaller
    // content genuinely means less scrolling. (CSS `zoom` can't do this: it just
    // shrinks the box inside an unchanged viewport — the v1.2.1/v1.2.2 bug.)
    document.documentElement.style.setProperty('--scale', settings.uiScale);
    document.documentElement.setAttribute('data-theme', settings.darkMode ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', settings.darkMode ? '#121212' : '#3949AB');
  }
  function bundleLayersTotal(t) {
    return (t || settings).bundles.reduce(function (s, b) { return s + b.layers; }, 0);
  }
  function cloneBundles(list) {
    return list.map(function (b) { return { name: b.name, layers: b.layers }; });
  }
  /* The project (or global settings) whose pairs/bundles/flipping the settings
     screens are currently editing. */
  var settingsCtx = { mode: 'defaults', project: null };
  function settingsTarget() {
    if (settingsCtx.mode === 'project' && settingsCtx.project) return settingsCtx.project;
    return settings;
  }
  function saveSettingsTarget() {
    if (settingsCtx.mode === 'project' && settingsCtx.project) persist();
    else saveSettings();
  }
  function projectFlip(p) {
    return (typeof p.flippingEnabled === 'boolean') ? p.flippingEnabled : settings.flippingEnabled;
  }
  function projectBundles(p) {
    return Array.isArray(p.bundles) ? p.bundles : settings.bundles;
  }
  /* Which bundle/layer is pair #inBox (0-based) inside its box?
     Returns {name, layer, layers, isLast, lastLayer} or null when past the end. */
  function bundleSlot(inBox, bundles) {
    var acc = 0;
    for (var i = 0; i < bundles.length; i++) {
      var L = Math.max(1, bundles[i].layers | 0);
      if (inBox < acc + L) {
        var layer = inBox - acc + 1;
        return { name: bundles[i].name, layer: layer, layers: L,
                 isLast: i === bundles.length - 1, lastLayer: layer === L };
      }
      acc += L;
    }
    return null;
  }
  // Older saved projects predate per-project settings: they were all 25/box,
  // flipping on, with the default bundles — and every old project is a regular pull.
  projects.forEach(function (p) {
    if (p.mode !== 'straight') p.mode = 'regular';
    if (!(p.pairsPerBox > 0)) p.pairsPerBox = 25;
    if (!Array.isArray(p.bundles)) p.bundles = cloneBundles(defaultSettings().bundles);
    if (typeof p.flippingEnabled !== 'boolean') p.flippingEnabled = settings.flippingEnabled;
    if (p.mode === 'straight' && !Array.isArray(p.mixEntries)) p.mixEntries = [];
  });
  applySettings();

  /* ------------------------------------------------------------ navigation */
  var VIEWS = ['projects', 'entry', 'review', 'locked', 'placing', 'box', 'stapling', 'settings', 'bundles',
    'mixsizes', 'mixcapacity', 'mixboxes', 'mixplacing', 'mixbox'];
  // Where Back from Settings should return to ('projects' or 'entry').
  var settingsReturn = 'projects';
  function show(name) {
    VIEWS.forEach(function (v) { el('view-' + v).classList.toggle('active', v === name); });
    window.scrollTo(0, 0);
    padQueue.length = 0; // drop any in-flight multi-touch presses on navigation
  }

  /* ------------------------------------------------------------------ modal */
  function showModal(o) {
    var ov = el('modalOverlay'), box = el('modalBox');
    box.innerHTML = '';
    box.scrollTop = 0;
    function close() { ov.classList.remove('open'); box.innerHTML = ''; }
    if (o.title) {
      var h = document.createElement('h3');
      h.textContent = o.title;
      box.appendChild(h);
    }
    if (o.message || o.htmlMessage) {
      var m = document.createElement('div');
      m.className = 'msg';
      if (o.htmlMessage) m.innerHTML = o.htmlMessage;
      else m.textContent = o.message;
      box.appendChild(m);
    }
    var inputEls = [];
    var inputs = o.inputs || (o.input ? [o.input] : []);
    inputs.forEach(function (inp) {
      if (inp.label) {
        var lab = document.createElement('div');
        lab.className = 'mlabel';
        lab.textContent = inp.label;
        box.appendChild(lab);
      }
      var inputEl = document.createElement('input');
      inputEl.type = inp.numeric ? 'number' : 'text';
      if (inp.numeric) inputEl.setAttribute('inputmode', 'numeric');
      inputEl.value = inp.value || '';
      if (inp.hint != null) inputEl.placeholder = inp.hint;
      box.appendChild(inputEl);
      inputEls.push(inputEl);
    });
    var inputEl = inputEls[0] || null;
    var wrap = document.createElement('div');
    wrap.className = 'mbtns' + (o.rowButtons ? ' row2' : '');
    box.appendChild(wrap);
    (o.buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      if (b.html) btn.innerHTML = b.html;
      else btn.textContent = b.label;
      if (b.primary) btn.classList.add('primary');
      if (b.danger) btn.classList.add('danger');
      btn.onclick = function () {
        var r = b.onClick ? b.onClick({ close: close, input: inputEl, inputs: inputEls }) : undefined;
        if (r !== false) close();
      };
      wrap.appendChild(btn);
    });
    ov.classList.add('open');
    if (inputEl) { inputEl.focus(); inputEl.select(); }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* --------------------------------------------------------------- projects */
  function projectSubtitle(p) {
    if (p.mode === 'straight') {
      var mt = (p.mixEntries || []).reduce(function (s, e) { return s + (e.qty || 0); }, 0);
      var sub = 'straight mix \u2022 ' + (p.itemName || 'items');
      if ((p.mixEntries || []).length) sub += ' \u2022 ' + mt + ' counted';
      if (p.mixBoxes > 0) sub += ' \u2022 ' + p.mixBoxes + ' boxes';
      if (p.locked) sub += ' \u2022 locked';
      return sub;
    }
    var total = p.entries.reduce(function (s, e) { return s + e.qty; }, 0);
    var sub = p.entries.length + ' sizes \u2022 ' + total + ' pairs';
    if (p.locked) sub += ' \u2022 locked';
    var placing = M.totalPlaced(p);
    if (placing > 0) sub += ' \u2022 placing ' + placing + '/' + total;
    return sub;
  }

  function showProjects() {
    var list = el('projectList');
    list.innerHTML = '';
    var sorted = projects.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    el('noProjects').style.display = sorted.length ? 'none' : '';
    sorted.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'proj-row';
      var meta = document.createElement('div');
      meta.className = 'meta';
      var nm = document.createElement('div');
      nm.className = 'name';
      nm.textContent = p.name;
      var sb = document.createElement('div');
      sb.className = 'sub2';
      sb.textContent = projectSubtitle(p);
      meta.appendChild(nm);
      meta.appendChild(sb);
      var del = document.createElement('button');
      del.className = 'del danger';
      del.textContent = 'Delete';
      del.onclick = function (ev) {
        ev.stopPropagation();
        showModal({
          title: 'Delete project?',
          message: 'Delete "' + p.name + '"? This can\'t be undone.',
          rowButtons: true,
          buttons: [
            {
              label: 'Delete', danger: true, onClick: function () {
                projects = projects.filter(function (x) { return x.id !== p.id; });
                if (ui.activeId === p.id) ui.activeId = null;
                persist();
                showProjects();
              }
            },
            { label: 'Cancel' }
          ]
        });
      };
      row.appendChild(meta);
      row.appendChild(del);
      row.onclick = function () { openProject(p); };
      list.appendChild(row);
    });
    show('projects');
  }

  function openProject(p) {
    ui.activeId = p.id;
    M.Store.saveUI(ui);
    if (p.mode === 'straight') {
      if (p.locked) { ensureMixPlacing(p); persist(); showMixPlacing(); }
      else showMixSizes();
    } else if (p.locked) showLocked();
    else showEntry();
  }

  /* ------------------------------------------------------------------ entry */
  var entry = null; // {waist, length, qty, index, focused}

  function showEntry() {
    var p = activeProject();
    if (!p) return showProjects();
    if (p.locked) return showLocked(); // safety net, like Android
    var d = p.entryDraft;
    if (d && d.index < p.entries.length) {
      var e = p.entries[d.index];
      entry = { waist: e.waist, length: e.length, qty: String(e.qty), index: d.index, focused: 0 };
    } else if (d) {
      entry = {
        waist: d.waist || '', length: d.length || '', qty: d.qty || '',
        index: p.entries.length, focused: d.focused || 0
      };
    } else {
      entry = { waist: '', length: '', qty: '', index: p.entries.length, focused: 0 };
    }
    el('entryProjectName').textContent = p.name;
    renderEntry();
    show('entry');
  }

  function saveDraft() {
    var p = activeProject();
    if (p && entry) {
      p.entryDraft = {
        waist: entry.waist, length: entry.length, qty: entry.qty,
        index: entry.index, focused: entry.focused
      };
      persist();
    }
  }

  function entryComplete() {
    return entry.waist.length === 2 && entry.length.length === 2 && entry.qty.length > 0;
  }

  function renderEntry() {
    var p = activeProject();
    el('waistField').textContent = entry.waist;
    el('lengthField').textContent = entry.length === '00' ? 'ODD' : entry.length;
    el('qtyField').textContent = entry.qty;
    el('waistField').classList.toggle('focused', entry.focused === 0);
    el('lengthField').classList.toggle('focused', entry.focused === 1);
    el('qtyField').classList.toggle('focused', entry.focused === 2);
    var canNext = entryComplete();
    setEnabled(el('entryRight'), canNext);
    setEnabled(el('padEnter'), canNext);
    setEnabled(el('entryLeft'), entry.index > 0);
    var n = p.entries.length, i = entry.index;
    el('entryCounter').textContent =
      i < n ? 'Entry ' + (i + 1) + ' of ' + n : (n === 0 ? 'Entry 1' : 'Entry ' + (n + 1) + ' (new)');
  }

  function onDigit(d) {
    if (entry.focused === 0) {
      if (entry.waist.length < 2) {
        entry.waist += d;
        if (entry.waist.length === 2) entry.focused = 1;
      }
    } else if (entry.focused === 1) {
      if (entry.length.length < 2) {
        entry.length += d;
        if (entry.length.length === 2) entry.focused = 2;
      }
    } else {
      entry.qty += d;
    }
    saveDraft();
    renderEntry();
  }

  function onBackspace() {
    var buf = entry.focused === 0 ? 'waist' : entry.focused === 1 ? 'length' : 'qty';
    if (entry[buf].length > 0) {
      entry[buf] = entry[buf].slice(0, -1);
    } else if (entry.focused > 0) {
      entry.focused--;
    }
    saveDraft();
    renderEntry();
  }

  function tapField(f) {
    if (f === 0) entry.waist = '';
    else if (f === 1) entry.length = '';
    else entry.qty = '';
    entry.focused = f;
    saveDraft();
    renderEntry();
  }

  /** Saves the buffered entry (adding or replacing at entry.index).
   *  Returns false if a duplicate warning was shown (nothing saved). */
  function tryCommitEntry() {
    var p = activeProject();
    var w = entry.waist, l = entry.length;
    var q = parseInt(entry.qty, 10);
    if (isNaN(q)) return true;
    for (var i = 0; i < p.entries.length; i++) {
      if (i !== entry.index && p.entries[i].waist === w && p.entries[i].length === l) {
        showModal({
          title: 'Duplicate size',
          message: M.displaySize(w, l) + ' is already in the list.',
          buttons: [{ label: 'OK', primary: true }]
        });
        return false;
      }
    }
    var e = { waist: w, length: l, qty: q };
    if (entry.index < p.entries.length) p.entries[entry.index] = e;
    else p.entries.push(e);
    persist();
    return true;
  }

  function loadEntryBuffers(i) {
    var p = activeProject();
    var e = p.entries[i];
    entry.waist = e.waist;
    entry.length = e.length;
    entry.qty = String(e.qty);
  }

  function clearBuffers() { entry.waist = ''; entry.length = ''; entry.qty = ''; }

  /** Right arrow / Enter: commit the current entry, then move to the next one. */
  function onEntryNext() {
    if (!entryComplete()) return;
    if (!tryCommitEntry()) return; // duplicate warning shown; stay put
    var p = activeProject();
    entry.index++;
    if (entry.index < p.entries.length) loadEntryBuffers(entry.index);
    else clearBuffers();
    entry.focused = 0;
    saveDraft();
    renderEntry();
  }

  function onEntryPrev() {
    if (entry.index > 0) {
      entry.index--;
      loadEntryBuffers(entry.index);
      entry.focused = 0;
      saveDraft();
      renderEntry();
    }
  }

  function onEntryDone() {
    var p = activeProject();
    if (entryComplete()) {
      if (!tryCommitEntry()) return;
      entry.index = p.entries.length;
      clearBuffers();
      entry.focused = 0;
      saveDraft();
    }
    if (p.entries.length === 0) {
      toast('Add at least one size first');
      return;
    }
    showReview();
  }

  /* ----------------------------------------------------------------- review */
  function showReview() { renderReview(); show('review'); }

  function renderReview() {
    var p = activeProject();
    if (!p) return showProjects();
    el('reviewTitle').textContent = 'Review sizes \u2014 ' + p.name;
    var rows = el('reviewRows');
    rows.innerHTML = '';
    p.entries.forEach(function (e, pos) {
      var row = document.createElement('div');
      row.className = 'trow' + (pos % 2 === 1 ? ' alt' : '');
      var sz = document.createElement('div');
      sz.className = 'sz';
      sz.textContent = M.displaySize(e.waist, e.length);
      var qty = document.createElement('input');
      qty.className = 'qty';
      qty.type = 'number';
      qty.setAttribute('inputmode', 'numeric');
      qty.min = '1';
      qty.value = e.qty;
      qty.addEventListener('input', function () {
        var v = parseInt(qty.value, 10);
        if (v > 0) {
          e.qty = v;
          persist();
          updateReviewTotal();
        }
      });
      // If they leave junk in the box, put the last good value back.
      qty.addEventListener('blur', function () {
        var v = parseInt(qty.value, 10);
        if (!(v > 0)) qty.value = e.qty;
      });
      var del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '\u2715';
      del.setAttribute('aria-label', 'Delete size');
      del.onclick = function () {
        showModal({
          title: 'Delete size?',
          message: 'Delete ' + M.displaySize(e.waist, e.length) + ' from the list?',
          rowButtons: true,
          buttons: [
            {
              label: 'Delete', danger: true, onClick: function () {
                p.entries.splice(pos, 1);
                persist();
                renderReview();
              }
            },
            { label: 'Cancel' }
          ]
        });
      };
      row.appendChild(sz);
      row.appendChild(qty);
      row.appendChild(del);
      rows.appendChild(row);
    });
    updateReviewTotal();
  }

  function updateReviewTotal() {
    var p = activeProject();
    var total = p.entries.reduce(function (s, e) { return s + e.qty; }, 0);
    el('reviewTotal').textContent = 'Total: ' + total + ' pairs';
  }

  function onConfirm() {
    var p = activeProject();
    if (p.entries.length === 0) {
      toast('Nothing to confirm \u2014 the list is empty');
      return;
    }
    var total = p.entries.reduce(function (s, e) { return s + e.qty; }, 0);
    var cap = (p.pairsPerBox > 0) ? p.pairsPerBox : M.BOX_CAPACITY;
    if (total % cap !== 0) {
      showModal({
        title: "Something's wrong",
        message: 'The total is ' + total + ' pairs, which isn\'t divisible by ' + cap + '. ' +
                 'Check your quantities and try again.',
        buttons: [{ label: 'OK', primary: true }]
      });
      return;
    }
    var boxes = total / cap;
    showModal({
      title: 'Confirm box count',
      message: total + ' pairs \u2192 ' + boxes + ' boxes. Is this correct?',
      rowButtons: true,
      buttons: [
        {
          label: 'Yes', primary: true, onClick: function () {
            p.locked = true;
            p.lockedBoxCount = boxes;
            p.entryDraft = null;
            persist();
            showLocked();
          }
        },
        { label: 'No' }
      ]
    });
  }

  /* ----------------------------------------------------------------- locked */
  function showLocked() { renderLocked(); show('locked'); }

  function renderLocked() {
    var p = activeProject();
    if (!p) return showProjects();
    el('lockedTitle').textContent = p.name;
    var rows = el('lockedRows');
    rows.innerHTML = '';
    p.entries.forEach(function (e, pos) {
      var row = document.createElement('div');
      row.className = 'trow' + (pos % 2 === 1 ? ' alt' : '');
      var sz = document.createElement('div');
      sz.className = 'sz';
      sz.textContent = M.displaySize(e.waist, e.length);
      var q = document.createElement('div');
      q.className = 'q';
      q.textContent = e.qty;
      row.appendChild(sz);
      row.appendChild(q);
      rows.appendChild(row);
    });
    var total = p.entries.reduce(function (s, e) { return s + e.qty; }, 0);
    var cap = (p.pairsPerBox > 0) ? p.pairsPerBox : M.BOX_CAPACITY;
    el('lockedTotal').textContent = total + ' pairs \u2192 ' + (total / cap) + ' boxes';

    // Per-box contents live under the ☰ Boxes menu once placing begins.
  }

  /* ---------------------------------------------------------------- placing */
  var current = 0;

  function showPlacing() {
    var p = activeProject();
    if (!p || !p.locked) return showProjects();
    var saved = (ui.placingCurrent || {})[p.id];
    current = typeof saved === 'number' ? saved : firstOpenSize(p);
    if (current > p.entries.length) current = firstOpenSize(p);
    renderPlacing();
    show('placing');
  }

  function saveCurrent() {
    ui.placingCurrent = ui.placingCurrent || {};
    var p = activeProject();
    if (p) ui.placingCurrent[p.id] = current;
    M.Store.saveUI(ui);
  }

  /** First size that isn't finished yet; entries.length means "show the summary". */
  function firstOpenSize(p) {
    for (var i = 0; i < p.entries.length; i++) {
      if (p.doneSizes.indexOf(i) < 0) return i;
    }
    return p.entries.length;
  }

  function renderPlacing() {
    var p = activeProject();
    if (!p) return showProjects();
    var main = el('placingMain'), complete = el('placingComplete');
    if (current >= p.entries.length) {
      main.style.display = 'none';
      complete.style.display = '';
      renderComplete(p);
      return;
    }
    main.style.display = '';
    complete.style.display = 'none';

    var r = M.replay(p);
    var e = p.entries[current];
    var placed = r.placedPerSize[current];
    var needed = e.qty;

    el('placingSubtitle').textContent = p.name + ' \u2022 Size ' + (current + 1) + ' of ' + p.entries.length;
    el('sizeBig').textContent = M.prettySize(e);

    // "13 out of 24 placed (11 left)". Overplaced renders RED and UNDERLINED.
    var left = Math.max(0, needed - placed);
    var pv = el('placedView');
    pv.innerHTML = '';
    if (placed > needed) {
      var s = document.createElement('span');
      s.className = 'over';
      s.textContent = placed;
      pv.appendChild(s);
      pv.appendChild(document.createTextNode(' out of ' + needed + ' placed (' + left + ' left)'));
    } else {
      pv.textContent = placed + ' out of ' + needed + ' placed (' + left + ' left)';
    }

    // Bundle/layer slot of the upcoming placement (next box in line).
    var inNext = r.boxCounts[r.nextBox];
    var boxNo = r.nextBox + 1;
    var blv = el('bundleLayerView');
    var pFlip = projectFlip(p), pBundles = projectBundles(p);
    if (!pFlip) {
      blv.textContent = 'layer ' + (inNext + 1) + ', box ' + boxNo;
      el('flipCue').style.visibility = 'hidden';
    } else {
      var slot = bundleSlot(inNext, pBundles);
      if (!slot) {
        blv.textContent = 'layer ' + (inNext + 1) + ', box ' + boxNo;
        el('flipCue').style.visibility = 'hidden';
      } else {
        blv.textContent = slot.layers === 1
          ? slot.name + ', box ' + boxNo
          : slot.name + ', layer ' + slot.layer + ', box ' + boxNo;
        el('flipCue').style.visibility = (slot.lastLayer && !slot.isLast) ? 'visible' : 'hidden';
      }
    }

    renderQuickAdds(placed < needed);
    setEnabled(el('placeUndo'), placed > 0);
    setEnabled(el('placeLeft'), current > 0);
    setEnabled(el('placeRight'), current < p.entries.length - 1);

    renderTimeline(p);
  }

  function renderTimeline(p) {
    var rows = el('timelineRows');
    rows.innerHTML = '';
    p.timeline.forEach(function (t) {
      if (t.size !== current) return;
      var d = document.createElement('div');
      d.textContent = M.fmtTime(t.t) + ' \u2014 ' + t.text;
      rows.appendChild(d);
    });
    rows.scrollTop = rows.scrollHeight;
  }

  function renderComplete(p) {
    var r = M.replay(p);
    var rows = el('completeRows');
    rows.innerHTML = '';
    p.entries.forEach(function (e, i) {
      var row = document.createElement('div');
      row.className = 'trow' + (i % 2 === 1 ? ' alt' : '');
      var sz = document.createElement('div');
      sz.className = 'sz';
      sz.textContent = M.prettySize(e);
      var q = document.createElement('div');
      q.className = 'q';
      q.textContent = r.placedPerSize[i] + ' / ' + e.qty;
      row.appendChild(sz);
      row.appendChild(q);
      rows.appendChild(row);
    });
    var sumPlaced = r.placedPerSize.reduce(function (a, b) { return a + b; }, 0);
    var sumQty = p.entries.reduce(function (s, e) { return s + e.qty; }, 0);
    el('completeTotal').textContent = sumPlaced + ' / ' + sumQty + ' pairs placed';
  }

  /** Quick-add: record N placements into the next N boxes. Caps at remaining. */
  function renderQuickAdds(canPlace) {
    var row = el('addRow');
    row.innerHTML = '';
    var qs = settings.quickAdds.length ? settings.quickAdds : [1, 5, 10];
    row.style.gridTemplateColumns = 'repeat(' + qs.length + ', 1fr)';
    qs.forEach(function (q) {
      var b = document.createElement('button');
      b.textContent = '+' + q;
      b.onclick = function () { onAdd(q); };
      setEnabled(b, canPlace);
      row.appendChild(b);
    });
  }

  function onAdd(n) {
    var p = activeProject();
    var r = M.replay(p);
    var remaining = p.entries[current].qty - r.placedPerSize[current];
    if (remaining <= 0) return;
    var actual = Math.min(n, remaining);
    var now = Date.now();
    var lastBox = (r.nextBox + actual - 1) % M.boxes(p) + 1;
    p.placingEvents.push({ size: current, count: actual, t: now });
    p.timeline.push({ size: current, t: now, text: '+' + actual + ' \u2014 Box ' + lastBox });
    persist();
    renderPlacing();
  }

  /** Undo: remove this size's most recent press. No-op at 0 placed. */
  function onUndo() {
    var p = activeProject();
    var idx = -1;
    for (var i = p.placingEvents.length - 1; i >= 0; i--) {
      if (p.placingEvents[i].size === current) { idx = i; break; }
    }
    if (idx < 0) return;
    var removed = p.placingEvents.splice(idx, 1)[0];
    p.timeline.push({ size: current, t: Date.now(), text: 'undo +' + removed.count });
    syncDone(p);
    persist();
    renderPlacing();
  }

  function onArrow(dir) {
    var p = activeProject();
    var next = Math.max(0, Math.min(p.entries.length - 1, current + dir));
    if (next !== current) {
      current = next;
      saveCurrent();
      renderPlacing();
    }
  }

  /** A size whose placed < needed is never "done" (e.g. after undo/edit). */
  function syncDone(p) {
    var r = M.replay(p);
    p.doneSizes = p.doneSizes.filter(function (i) {
      return r.placedPerSize[i] >= p.entries[i].qty;
    });
  }

  /** Surgically removes a size's K most recent placements from the log. */
  function removePlacements(p, sizeIdx, k) {
    var remaining = k;
    for (var i = p.placingEvents.length - 1; i >= 0 && remaining > 0; i--) {
      var e = p.placingEvents[i];
      if (e.size === sizeIdx) {
        if (e.count <= remaining) {
          remaining -= e.count;
          p.placingEvents.splice(i, 1);
        } else {
          e.count -= remaining;
          remaining = 0;
        }
      }
    }
  }

  /**
   * Tapping "X out of Y": pure counter correction. Sets placed to the typed
   * value; never cascades — the shortfall cascade lives only in the
   * per-size Done popup.
   */
  function onPlacedTap() {
    var p = activeProject();
    var e = p.entries[current];
    var placed = M.replay(p).placedPerSize[current];
    showModal({
      title: 'Set placed count',
      message: M.prettySize(e) + ' \u2014 how many are actually placed?',
      input: { value: String(placed), numeric: true },
      rowButtons: true,
      buttons: [
        {
          label: 'OK', primary: true, onClick: function (api) {
            var v = parseInt(api.input.value, 10);
            if (isNaN(v)) return;
            applyManualEdit(Math.max(0, v));
          }
        },
        { label: 'Cancel' }
      ]
    });
  }

  function applyManualEdit(newVal) {
    var p = activeProject();
    var old = M.replay(p).placedPerSize[current];
    if (newVal === old) return;
    var now = Date.now();
    if (newVal > old) {
      p.placingEvents.push({ size: current, count: newVal - old, t: now });
    } else {
      removePlacements(p, current, old - newVal);
    }
    p.timeline.push({ size: current, t: now, text: 'set ' + old + ' \u2192 ' + newVal + ' (manual)' });
    syncDone(p);
    persist();
    renderPlacing();
  }

  /** Per-size Done: advance, or handle a shortfall / overplacement via popup. */
  function onSizeDone() {
    var p = activeProject();
    var r = M.replay(p);
    var placed = r.placedPerSize[current];
    var needed = p.entries[current].qty;
    if (placed < needed) {
      showModal({
        title: 'Shortfall?',
        message: 'You only placed ' + placed + ' out of ' + needed + '. Are you sure?',
        rowButtons: true,
        buttons: [
          { label: 'Yes', primary: true, onClick: function () { acceptShortfall(placed, needed); } },
          { label: 'No' }
        ]
      });
    } else if (placed > needed) {
      onOverplacement(placed, needed);
    } else {
      if (p.doneSizes.indexOf(current) < 0) p.doneSizes.push(current);
      persist();
      current++;
      saveCurrent();
      renderPlacing();
    }
  }

  /**
   * Controlled edit of the locked plan: this size's needed := placed, the
   * shortfall moves to the NEXT size's needed (total preserved, box math stays
   * valid). Last size: just accept, the user handles it IRL.
   */
  function acceptShortfall(placed, needed) {
    var p = activeProject();
    var shortfall = needed - placed;
    p.entries[current].qty = placed;
    if (current < p.entries.length - 1) {
      p.entries[current + 1].qty += shortfall;
    }
    if (p.doneSizes.indexOf(current) < 0) p.doneSizes.push(current);
    syncDone(p);
    persist();
    current++;
    saveCurrent();
    renderPlacing();
  }

  /**
   * Overplacement: the user placed more than needed. Offer to subtract the
   * excess from the next size's needed. Last size: warn and let them keep it.
   */
  function onOverplacement(placed, needed) {
    var p = activeProject();
    var excess = placed - needed;
    if (current >= p.entries.length - 1) {
      showModal({
        title: 'Extra pairs',
        message: excess + ' extra, but there\'s no next size \u2014 ' +
                 'the total won\'t fill boxes evenly.',
        rowButtons: true,
        buttons: [
          {
            label: 'Keep it', primary: true, onClick: function () {
              if (p.doneSizes.indexOf(current) < 0) p.doneSizes.push(current);
              persist();
              current++;
              saveCurrent();
              renderPlacing();
            }
          },
          { label: 'Fix it' }
        ]
      });
    } else {
      var nextLabel = M.prettySize(p.entries[current + 1]);
      showModal({
        title: 'Extra pairs',
        message: 'You placed ' + placed + ', but ' + needed + ' were needed \u2014 ' +
                 excess + ' extra. Subtract ' + excess + ' from ' + nextLabel + '?',
        rowButtons: true,
        buttons: [
          {
            label: 'Yes', primary: true, onClick: function () {
              p.entries[current + 1].qty -= excess;
              if (p.doneSizes.indexOf(current) < 0) p.doneSizes.push(current);
              syncDone(p);
              persist();
              current++;
              saveCurrent();
              renderPlacing();
            }
          },
          { label: 'Fix it' }
        ]
      });
    }
  }

  /** Tap the big size text: jump straight to any size's placing screen. */
  function onSizeJump() {
    var p = activeProject();
    var r = M.replay(p);
    var buttons = p.entries.map(function (e, i) {
      var placed = r.placedPerSize[i];
      var needed = e.qty;
      var left = Math.max(0, needed - placed);
      var html = M.prettySize(e) + ' \u2014 ' +
        (placed > needed
          ? '<span class="over">' + placed + '</span> out of ' + needed + ' placed (' + left + ' left)'
          : placed + ' out of ' + needed + ' placed (' + left + ' left)');
      return {
        html: html,
        onClick: function () { current = i; saveCurrent(); renderPlacing(); }
      };
    });
    buttons.push({ label: 'Cancel' });
    showModal({ title: 'Jump to size', buttons: buttons });
  }

  function onBoxMenu() {
    var p = activeProject();
    var n = M.boxes(p);
    var buttons = [];
    for (var i = 0; i < n; i++) {
      (function (i) {
        buttons.push({ label: 'Box ' + (i + 1), onClick: function () { showBox(i); } });
      })(i);
    }
    buttons.push({ label: 'Cancel' });
    showModal({ title: 'Pick a box', buttons: buttons });
  }

  function onResetPlacing() {
    showModal({
      title: 'Reset placing?',
      message: 'This clears all +1/+5/+10 presses, history and stapling counts ' +
               'for this project. The size list stays.',
      rowButtons: true,
      buttons: [
        {
          label: 'Reset', danger: true, onClick: function () {
            var p = activeProject();
            p.placingEvents = [];
            p.timeline = [];
            p.doneSizes = [];
            p.stapled = [];
            current = firstOpenSize(p);
            saveCurrent();
            persist();
            renderPlacing();
          }
        },
        { label: 'Cancel' }
      ]
    });
  }

  /* -------------------------------------------------------------- box detail */
  var boxIdx = 0;

  function showBox(i) {
    boxIdx = i;
    renderBox();
    show('box');
  }

  function renderBox() {
    var p = activeProject();
    if (!p) return showProjects();
    var sim = M.simulateLive(p);
    if (boxIdx < 0 || boxIdx >= sim.length) return;
    el('boxTitle').textContent = 'Box ' + (boxIdx + 1) + ' of ' + sim.length;
    var tb = el('boxRows');
    tb.innerHTML = '';
    sim[boxIdx].forEach(function (si, pos) {
      var e = p.entries[si];
      var tr = document.createElement('tr');
      if (pos % 2 === 1) tr.className = 'alt';
      var bundle, layer;
      var pFlip = projectFlip(p), pBundles = projectBundles(p);
      if (!pFlip) {
        bundle = '\u2013';
        layer = String(pos + 1);
      } else {
        var bslot = bundleSlot(pos, pBundles);
        if (!bslot) {
          bundle = '\u2013';
          layer = String(pos + 1);
        } else if (bslot.layers === 1 && bslot.isLast) {
          bundle = '\u2013';
          layer = 'top';
        } else {
          bundle = bslot.name;
          layer = String(bslot.layer);
        }
      }
      [String(pos + 1), M.displaySize(e.waist, e.length), bundle, layer].forEach(function (v) {
        var td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }

  /* ---------------------------------------------------------------- stapling */
  var stapleIdx = 0;

  function showStapling() {
    stapleIdx = current;
    refreshStapling();
    el('stapleInput').value = '';
    show('stapling');
  }

  /** Returns Z (remaining to staple); also refreshes the labels. */
  function refreshStapling() {
    var p = activeProject();
    var e = p.entries[stapleIdx];
    var placed = M.replay(p).placedPerSize[stapleIdx];
    var stapled = p.stapled[stapleIdx] || 0;
    var z = Math.max(0, e.qty - placed - stapled);
    el('stapleTitle').textContent = M.prettySize(e);
    el('stapleLine').textContent = placed + ' out of ' + e.qty + ' placed, ' + z + ' left to staple';
    el('stapleInput').placeholder = String(z);
    return z;
  }

  function recordStaple(n) {
    if (n <= 0) { showPlacing(); return; }
    var p = activeProject();
    while (p.stapled.length <= stapleIdx) p.stapled.push(0);
    p.stapled[stapleIdx] += n;
    p.timeline.push({ size: stapleIdx, t: Date.now(), text: n + ' stapled' });
    persist();
    showPlacing();
  }

  function onStapleDone() {
    var z = refreshStapling();
    var raw = el('stapleInput').value.trim();
    // Blank (or junk) = assume all remaining.
    var n = raw === '' ? z : parseInt(raw, 10);
    if (isNaN(n)) n = z;
    n = Math.max(0, Math.min(z, n));
    if (n < z) {
      showModal({
        title: 'Stapling',
        message: 'You stapled ' + n + ' out of ' + z + '. Are you sure?',
        rowButtons: true,
        buttons: [
          { label: 'Yes', primary: true, onClick: function () { recordStaple(n); } },
          { label: 'No' }
        ]
      });
    } else {
      recordStaple(n);
    }
  }

  /* ---------------------------------------------------------------- settings */
  // Two modes: 'defaults' (from the main menu — edits what new projects start
  // with) and 'project' (from inside a project — edits that project's own
  // pairs/bundles/flipping; app-wide prefs stay global in both modes).
  function showSettings(mode, project) {
    if (mode) settingsCtx = { mode: mode, project: project || null };
    renderSettings();
    updateInstallBtn();
    show('settings');
  }
  /* PWA install: service worker for offline, beforeinstallprompt for the
     native install dialog, iOS/manual fallback instructions. */
  var installPromptEvt = null;
  function isStandalone() {
    var nav = window.navigator || {};
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      nav.standalone === true;
  }
  function updateInstallBtn() {
    var w = el('installWrap');
    if (w) w.style.display = isStandalone() ? 'none' : '';
  }
  function onInstallApp() {
    if (installPromptEvt) {
      installPromptEvt.prompt();
      if (installPromptEvt.userChoice) {
        installPromptEvt.userChoice.then(function (choice) {
          if (choice && choice.outcome === 'accepted') installPromptEvt = null;
          updateInstallBtn();
        }).catch(function () {});
      }
    } else if (/iphone|ipad|ipod/i.test((window.navigator || {}).userAgent || '')) {
      showModal({
        title: 'Install the app',
        message: 'Tap Share, then "Add to Home Screen". It opens full-screen and works offline.',
        buttons: [{ label: 'Got it', primary: true }]
      });
    } else {
      showModal({
        title: 'Install the app',
        message: 'Use your browser\u2019s menu \u2192 "Install app" or "Add to Home Screen". It opens full-screen and works offline.',
        buttons: [{ label: 'Got it', primary: true }]
      });
    }
  }

  function renderSettings() {
    var t = settingsTarget();
    var isProj = settingsCtx.mode === 'project' && !!settingsCtx.project;
    var locked = isProj && !!settingsCtx.project.locked;
    el('settingsTitle').textContent = isProj ? 'Project settings' : 'Settings';
    el('projectSectionLabel').textContent = isProj ? 'This project' : 'Defaults for new projects';
    el('settingsDisclaimer').textContent = !isProj
      ? 'Changing these settings will affect new projects, not current ones.'
      : (locked
        ? 'These were locked in with the project.'
        : 'Changing these settings will affect this project only.');
    var sp = el('setPairs');
    sp.value = t.pairsPerBox;
    sp.disabled = locked;
    var ft = el('setFlipToggle');
    ft.textContent = t.flippingEnabled ? 'On' : 'Off';
    ft.classList.toggle('on', t.flippingEnabled);
    ft.disabled = locked;
    el('manageBundlesWrap').style.display = t.flippingEnabled ? '' : 'none';
    el('manageBundlesBtn').disabled = locked;
    el('qCount').textContent = settings.quickAdds.length;
    renderQuickAddInputs();
    var dt = el('setDarkToggle');
    dt.textContent = settings.darkMode ? 'On' : 'Off';
    dt.classList.toggle('on', settings.darkMode);
    el('scaleVal').textContent = Math.round(settings.uiScale * 100) + '%';
    var xt = el('setExperimentalToggle');
    xt.textContent = settings.experimental ? 'On' : 'Off';
    xt.classList.toggle('on', settings.experimental);
    el('resetWrap').style.display = locked ? 'none' : '';
  }

  function bumpScale(d) {
    var v = Math.round((settings.uiScale + d) * 100) / 100;
    settings.uiScale = Math.min(2, Math.max(0.5, v));
    saveSettings();
    renderSettings();
  }

  function renderQuickAddInputs() {
    var wrap = el('quickAddInputs');
    wrap.innerHTML = '';
    settings.quickAdds.forEach(function (q, i) {
      var row = document.createElement('div');
      row.className = 'set-row';
      var lab = document.createElement('div');
      lab.className = 'sub';
      lab.textContent = 'Button ' + (i + 1);
      var inp = document.createElement('input');
      inp.className = 'num-input-sm';
      inp.type = 'number';
      inp.min = '1';
      inp.setAttribute('inputmode', 'numeric');
      inp.value = q;
      inp.addEventListener('change', function () {
        var v = Math.max(1, parseInt(inp.value, 10) || q);
        settings.quickAdds[i] = v;
        inp.value = v;
        saveSettings();
      });
      row.appendChild(lab);
      row.appendChild(inp);
      wrap.appendChild(row);
    });
  }

  function bumpQuickAdds(d) {
    var q = settings.quickAdds.slice();
    if (d < 0 && q.length > 1) q.pop();
    else if (d > 0 && q.length < 5) q.push((q[q.length - 1] || 0) + 5);
    settings.quickAdds = q;
    saveSettings();
    renderSettings();
  }

  /* ----------------------------------------------------------------- bundles */
  function showBundles() { renderBundles(); show('bundles'); }

  function renderBundles() {
    var t = settingsTarget();
    var list = el('bundleList');
    list.innerHTML = '';
    t.bundles.forEach(function (b, i) {
      var btn = document.createElement('button');
      btn.className = 'bundle-row';
      var meta = document.createElement('div');
      meta.className = 'meta';
      var nm = document.createElement('div');
      nm.className = 'name';
      nm.textContent = b.name;
      var sb = document.createElement('div');
      sb.className = 'sub2';
      sb.textContent = b.layers + (b.layers === 1 ? ' layer' : ' layers');
      meta.appendChild(nm);
      meta.appendChild(sb);
      var chev = document.createElement('div');
      chev.className = 'chev';
      chev.textContent = '\u203a';
      btn.appendChild(meta);
      btn.appendChild(chev);
      btn.onclick = function () { openBundleEditor(i); };
      list.appendChild(btn);
    });
    if (!t.bundles.length) {
      var em = document.createElement('div');
      em.className = 'empty';
      em.textContent = 'No bundles \u2014 add one with \uff0b, or go back and flipping will be turned off.';
      list.appendChild(em);
    }
    var total = bundleLayersTotal(t);
    el('bundleTotalHint').textContent =
      total + ' layers total \u00b7 each box holds ' + t.pairsPerBox +
      (total === t.pairsPerBox ? ' \u2713' : ' \u2014 doesn\'t match');
  }

  function openBundleEditor(i) {
    var t = settingsTarget();
    var b = t.bundles[i];
    if (!b) return;
    showModal({
      title: 'Edit bundle',
      inputs: [
        { label: 'Name', value: b.name },
        { label: 'Layers per bundle', numeric: true, value: String(b.layers) }
      ],
      buttons: [
        {
          label: 'Save', primary: true, onClick: function (o) {
            b.name = (o.inputs[0].value.trim() || b.name).slice(0, 24);
            b.layers = Math.max(1, parseInt(o.inputs[1].value, 10) || b.layers);
            saveSettingsTarget();
            renderBundles();
          }
        },
        {
          label: 'Delete', danger: true, onClick: function () {
            t.bundles.splice(i, 1);
            saveSettingsTarget();
            renderBundles();
          }
        },
        { label: 'Cancel' }
      ]
    });
  }

  function onBundlesDone() {
    var t = settingsTarget();
    if (!t.bundles.length) {
      // Deleting them all just means no bundles: turn flipping off.
      t.flippingEnabled = false;
      saveSettingsTarget();
      toast('Bundles turned off');
      showSettings();
      return;
    }
    var total = bundleLayersTotal(t);
    if (total !== t.pairsPerBox) {
      showModal({
        title: 'Layers don\'t match',
        message: 'Your bundles add up to ' + total + ' layers, but each box holds ' +
                 t.pairsPerBox + ' pairs.',
        rowButtons: true,
        buttons: [
          {
            label: 'Use ' + total + ' per box', primary: true, onClick: function () {
              t.pairsPerBox = total;
              saveSettingsTarget();
              showSettings();
            }
          },
          { label: 'Keep ' + t.pairsPerBox, onClick: function () { showSettings(); } }
        ]
      });
      return;
    }
    showSettings();
  }

  /* ------------------------------------------------------- straight mix */
  // Box math: ceil(total/capacity), plus one safety box when the fractional
  // part goes over .5 (undercount buffer).
  function straightBoxMath(total, capacity) {
    var exact = total / capacity;
    var frac = exact - Math.floor(exact);
    var safety = frac > 0.5;
    var boxes = Math.ceil(exact) + (safety ? 1 : 0);
    return { total: total, capacity: capacity, exact: exact, boxes: boxes, safety: safety };
  }
  function mixTotal(p) {
    return (p.mixEntries || []).reduce(function (s, e) { return s + (e.qty || 0); }, 0);
  }

  function showMixSizes() {
    var p = activeProject();
    if (!p || p.mode !== 'straight') return showProjects();
    renderMixSizes();
    show('mixsizes');
  }
  function renderMixSizes() {
    var p = activeProject();
    if (!p) return showProjects();
    el('mixSizesTitle').textContent = p.itemName ? ('Sizes \u2014 ' + p.itemName) : 'Sizes';
    var list = el('mixSizeList');
    list.innerHTML = '';
    (p.mixEntries || []).forEach(function (e, i) {
      var row = document.createElement('div');
      row.className = 'mix-row';
      var sizeIn = document.createElement('input');
      sizeIn.type = 'text';
      sizeIn.className = 'mix-size';
      sizeIn.placeholder = 'Size';
      sizeIn.setAttribute('aria-label', 'Size');
      sizeIn.value = e.size || '';
      sizeIn.addEventListener('input', function () {
        // sizes are always caps: s -> S
        var v = sizeIn.value.toUpperCase();
        if (v !== sizeIn.value) sizeIn.value = v;
        e.size = v;
        persist();
      });
      // tapping a box clears it for fast re-entry
      sizeIn.addEventListener('focus', function () {
        if (!sizeIn.value) return;
        sizeIn.value = '';
        e.size = '';
        persist();
      });
      var qtyIn = document.createElement('input');
      qtyIn.type = 'number';
      qtyIn.className = 'mix-qty';
      qtyIn.placeholder = 'Qty';
      qtyIn.setAttribute('aria-label', 'Quantity');
      qtyIn.setAttribute('inputmode', 'numeric');
      qtyIn.min = '1';
      qtyIn.value = e.qty || '';
      qtyIn.addEventListener('input', function () {
        e.qty = Math.max(0, parseInt(qtyIn.value, 10) || 0);
        persist();
        updateMixTotal();
      });
      qtyIn.addEventListener('focus', function () {
        if (!qtyIn.value) return;
        qtyIn.value = '';
        e.qty = 0;
        persist();
        updateMixTotal();
      });
      var del = document.createElement('button');
      del.className = 'icon-btn danger';
      del.setAttribute('aria-label', 'Delete size');
      del.textContent = '\u00d7';
      del.onclick = function () {
        p.mixEntries.splice(i, 1);
        persist();
        renderMixSizes();
      };
      row.appendChild(sizeIn);
      row.appendChild(qtyIn);
      row.appendChild(del);
      list.appendChild(row);
    });
    if (!(p.mixEntries || []).length) {
      var em = document.createElement('div');
      em.className = 'mix-empty';
      em.textContent = 'Tap \uff0b to add the sizes you counted.';
      list.appendChild(em);
    }
    updateMixTotal();
  }
  function updateMixTotal() {
    var p = activeProject();
    if (!p) return;
    el('mixTotalLine').textContent = mixTotal(p) + ' ' + (p.itemName || 'items') + ' counted';
  }

  function showMixCapacity() {
    var p = activeProject();
    if (!p || p.mode !== 'straight') return showProjects();
    el('mixCapTotal').textContent = mixTotal(p) + ' ' + (p.itemName || 'items') + ' counted';
    el('mixCapLabel').textContent = 'How many ' + (p.itemName || 'items') + ' fit in each box?';
    el('mixCapInput').value = p.boxCapacity > 0 ? p.boxCapacity : '';
    show('mixcapacity');
  }

  function showMixBoxes() {
    var p = activeProject();
    if (!p || p.mode !== 'straight' || !(p.boxCapacity > 0)) return showProjects();
    var m = straightBoxMath(mixTotal(p), p.boxCapacity);
    p.mixBoxes = m.boxes;
    persist();
    var html = m.total + ' ' + (p.itemName || 'items') + ' \u00f7 ' + m.capacity +
      ' per box = ' + m.exact.toFixed(2);
    if (m.safety) html += '<div class="sub">Over .5, so one safety box is included.</div>';
    html += '<div class="mix-big">Make ' + m.boxes + ' box' + (m.boxes === 1 ? '' : 'es') + '</div>';
    el('mixBoxesMath').innerHTML = html;
    show('mixboxes');
  }

  /* -------------------------------------------- straight-mix placing */
  // Guidance for one size: even-up one-by-one from the pointer, then bulk per
  // box, then the remainder one-by-one from box 1. One sentence, everything
  // upfront, so alex knows the full plan before lifting a shirt.
  function mixGuideText(p, idx) {
    var N = p.mixBoxes, e = p.mixEntries[idx];
    var ptr = mixPointer(p), Q = e.qty;
    var euNeed = (ptr === 1) ? 0 : (N - ptr + 1);
    if (Q <= euNeed) {
      return 'Put 1 each in boxes ' + ptr + '\u2013' + (ptr + Q - 1) + ' (evening up).';
    }
    var eu = Math.min(Q, euNeed), R = Q - eu;
    var base = Math.floor(R / N), rem = R % N;
    var s = '';
    if (eu > 0) s += 'Even out boxes ' + ptr + '\u2013' + N + ' (+1 each)';
    if (base > 0) s += (s ? ', then ' : '') + 'add ' + base + ' per box';
    if (rem > 0) {
      if (base > 0) s += ' \u2014 ' + rem + ' will remain';
      else s += (s ? ', then ' : '') + 'put 1 each in boxes 1\u2013' + rem;
    }
    return s + '.';
  }
  // Where the app expects a size to end: {layer, box} with boxes 1..box at
  // layer and the rest at layer-1. Used as the slot picker's default.
  function mixPlannedEnd(p, idx) {
    var N = p.mixBoxes, mx = mixMaxLevel(p), ptr = mixPointer(p);
    var Q = p.mixEntries[idx].qty;
    var euNeed = (ptr === 1) ? 0 : (N - ptr + 1);
    if (Q <= euNeed) return { layer: mx, box: ptr + Q - 1 };
    var R = Q - Math.min(Q, euNeed);
    var base = Math.floor(R / N), rem = R % N;
    return { layer: mx + base + (rem > 0 ? 1 : 0), box: rem > 0 ? rem : N };
  }
  // Commit a finished size: snapshot for undo, set absolute box levels from
  // the confirmed (layer, box), record the per-box delta for the Boxes view.
  function commitMixFinish(p, idx, L, k) {
    p.mixUndoStack.push({
      sizeIdx: p.mixSizeIdx,
      levels: p.mixLevels.slice(),
      finishes: p.mixFinishes.slice(),
      timelineLen: p.timeline.length
    });
    var N = p.mixBoxes, old = p.mixLevels, nw = [], counts = [], i;
    for (i = 0; i < N; i++) {
      nw[i] = (i < k) ? L : L - 1;
      counts[i] = Math.max(0, nw[i] - old[i]);
    }
    p.mixLevels = nw;
    p.mixFinishes[idx] = { layer: L, box: k, counts: counts, t: Date.now() };
    p.timeline.push({ t: Date.now(), text: 'Finished ' + p.mixEntries[idx].size + ' \u2014 layer ' + L + ', box ' + k });
    p.mixSizeIdx = idx + 1;
    p.mixViewIdx = p.mixSizeIdx;
    persist();
    renderMixPlacing();
  }
  function onMixUndo() {
    var p = activeProject();
    if (!p || p.mode !== 'straight') return;
    var s = p.mixUndoStack.pop();
    if (!s) { toast('Nothing to undo'); return; }
    p.mixLevels = s.levels;
    p.mixFinishes = s.finishes;
    p.mixSizeIdx = s.sizeIdx;
    p.mixViewIdx = s.sizeIdx;
    p.timeline.length = s.timelineLen;
    persist();
    renderMixPlacing();
    toast('Undid finish');
  }
  // Per-size per-box counts: confirmed deltas for finished sizes, projected
  // from the estimate for the rest. Powers the Boxes preview.
  function mixProjection(p) {
    var N = p.mixBoxes, lv = p.mixLevels.slice(), out = [], idx, b;
    for (idx = 0; idx < p.mixEntries.length; idx++) {
      var fin = p.mixFinishes[idx];
      if (fin) { out[idx] = { size: p.mixEntries[idx].size, counts: fin.counts, done: true }; continue; }
      var Q = p.mixEntries[idx].qty, counts = [];
      for (b = 0; b < N; b++) counts.push(0);
      var mx = lv[0] || 0, ptr = 1, i;
      for (i = 1; i < N; i++) if (lv[i] > mx) mx = lv[i];
      for (i = 0; i < N; i++) if (lv[i] < mx) { ptr = i + 1; break; }
      var euNeed = (ptr === 1) ? 0 : (N - ptr + 1);
      var eu = Math.min(Q, euNeed);
      for (b = ptr - 1; b < ptr - 1 + eu; b++) { counts[b]++; lv[b]++; }
      var R = Q - eu, base = Math.floor(R / N), rem = R % N;
      for (b = 0; b < N; b++) { counts[b] += base; lv[b] += base; }
      for (b = 0; b < rem; b++) { counts[b]++; lv[b]++; }
      out[idx] = { size: p.mixEntries[idx].size, counts: counts, done: false };
    }
    return out;
  }

  function showMixPlacing() {
    var p = activeProject();
    if (!p || p.mode !== 'straight') return showProjects();
    ensureMixPlacing(p);
    renderMixPlacing();
    show('mixplacing');
  }
  function renderMixPlacing() {
    var p = activeProject();
    if (!p) return showProjects();
    var done = p.mixSizeIdx >= p.mixEntries.length;
    el('mixPlacingMain').style.display = done ? 'none' : '';
    el('mixConsolidate').style.display = done ? '' : 'none';
    if (done) renderMixConsolidate(p);
    else renderMixPlacingMain(p);
  }
  function renderMixPlacingMain(p) {
    if (p.mixViewIdx < 0) p.mixViewIdx = 0;
    if (p.mixViewIdx >= p.mixEntries.length) p.mixViewIdx = p.mixEntries.length - 1;
    var idx = p.mixViewIdx, e = p.mixEntries[idx];
    var isCurrent = idx === p.mixSizeIdx;
    var fin = p.mixFinishes[idx];
    el('mixPlacingTitle').textContent = p.itemName ? p.itemName + ' \u2014 ' + (idx + 1) + '/' + p.mixEntries.length : 'Placing';
    el('mixSizeBig').textContent = e.size;
    var status = el('mixSizeStatus'), guide = el('mixGuide'), finishBtn = el('mixFinishSize');
    if (isCurrent) {
      guide.textContent = mixGuideText(p, idx);
      status.textContent = e.qty + ' counted';
      finishBtn.style.display = '';
    } else if (fin) {
      guide.textContent = '';
      status.textContent = 'Finished at layer ' + fin.layer + ', box ' + fin.box;
      finishBtn.style.display = 'none';
    } else {
      guide.textContent = '';
      status.textContent = e.qty + ' counted \u2014 not started';
      finishBtn.style.display = 'none';
    }
    el('mixUndo').disabled = !p.mixUndoStack.length;
    renderMixTimeline(p);
  }
  function renderMixTimeline(p) {
    var rows = el('mixTimelineRows');
    rows.innerHTML = '';
    p.timeline.forEach(function (t) {
      var d = document.createElement('div');
      d.textContent = M.fmtTime(t.t) + ' \u2014 ' + t.text;
      rows.appendChild(d);
    });
    rows.scrollTop = rows.scrollHeight;
  }
  function onMixSizeJump() {
    var p = activeProject();
    if (!p) return;
    var buttons = p.mixEntries.map(function (e, i) {
      var fin = p.mixFinishes[i];
      var st = fin ? 'done \u2014 layer ' + fin.layer + ', box ' + fin.box
        : (i === p.mixSizeIdx ? 'placing now' : 'not started');
      return {
        html: e.size + ' \u2014 ' + e.qty + ' <span class="sub2">' + st + '</span>',
        onClick: function () { p.mixViewIdx = i; persist(); renderMixPlacing(); }
      };
    });
    buttons.push({ label: 'Cancel' });
    showModal({ title: 'Jump to size', buttons: buttons });
  }
  function renderMixConsolidate(p) {
    var N = p.mixBoxes, C = p.boxCapacity, lv = p.mixLevels;
    var T = lv.reduce(function (s, x) { return s + x; }, 0);
    var item = p.itemName || 'items';
    var m = Math.max(0, N - Math.floor(T / C));
    var html = '<div><b>' + T + '</b> ' + item + ' placed.</div>';
    if (m === 0) {
      html += '<div class="mix-big">Every box is full \u2014 nothing to move.</div>';
    } else {
      var firstEmpty = N - m + 1;
      var need = 0, avail = 0, i, rows = '';
      for (i = 0; i < N - m; i++) {
        var add = Math.max(0, C - lv[i]);
        need += add;
        if (add > 0) rows += '<div class="trow' + (i % 2 ? ' alt' : '') + '"><div class="sz">Box ' + (i + 1) + '</div><div>add ' + add + '</div></div>';
      }
      for (i = N - m; i < N; i++) avail += lv[i];
      var back = avail - need;
      html += '<div class="mix-big">Empty box' + (m === 1 ? '' : 'es') + ' ' + firstEmpty + (m === 1 ? '' : '\u2013' + N) +
        ' (' + m + ' box' + (m === 1 ? '' : 'es') + ')</div>';
      html += '<div class="sub" style="margin-bottom:0.5rem">' + avail + ' ' + item + ' to redistribute.</div>';
      html += rows;
      html += '<div class="sub" style="margin-top:0.5rem">' + back + ' go back into box ' + firstEmpty + '.</div>';
    }
    el('mixConsolidateBody').innerHTML = html;
  }

  /* Slot-machine picker: vertical strip, smallest on top. Drag with the
     finger — the strip tracks 1:1 — release and it snaps to the nearest
     number. The default the app computed stays bold so it's always obvious. */
  function makeSlotPicker(min, max, initial, label) {
    var rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 18;
    // exact fractional height — rounding here drifts a full row by ~150 items
    // at non-100% UI scales, misaligning the highlight from the selected value
    var ITEM_H = rootFont * 3; // matches .slot-item height (3rem)
    var values = [], v;
    for (v = min; v <= max; v++) values.push(v);
    var wrap = document.createElement('div');
    wrap.classList.add('slot-picker');
    var lab = document.createElement('div');
    lab.classList.add('slot-label');
    lab.textContent = label;
    var viewport = document.createElement('div');
    viewport.classList.add('slot-viewport');
    var strip = document.createElement('div');
    strip.classList.add('slot-strip');
    values.forEach(function (n) {
      var d = document.createElement('div');
      d.classList.add('slot-item');
      if (n === initial) d.classList.add('slot-default');
      d.textContent = n;
      strip.appendChild(d);
    });
    var highlight = document.createElement('div');
    highlight.classList.add('slot-highlight');
    viewport.appendChild(strip);
    viewport.appendChild(highlight);
    wrap.appendChild(lab);
    wrap.appendChild(viewport);

    var idx = initial - min, current = initial;
    function yFor(i) { return ITEM_H - i * ITEM_H; } // 3 visible, selected in the middle
    function paint(animate) {
      strip.style.transition = animate ? 'transform 0.16s ease-out' : 'none';
      strip.style.transform = 'translateY(' + yFor(idx) + 'px)';
      var items = strip.children, k;
      for (k = 0; k < items.length; k++) items[k].classList.toggle('sel', k === idx);
    }
    paint(false);

    var startY = 0, startT = 0, dragging = false, pid = null;
    var moveHist = [], momentumId = null;
    function stopMomentum() {
      if (momentumId != null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(momentumId);
        momentumId = null;
      }
    }
    function snapTo(t) {
      idx = Math.round((ITEM_H - t) / ITEM_H);
      idx = Math.max(0, Math.min(values.length - 1, idx));
      current = values[idx];
      paint(true);
    }
    function spin(t0, v0) {
      // flick inertia: decelerate, stop at the ends, then snap
      if (typeof requestAnimationFrame !== 'function') { snapTo(t0); return; }
      var t = t0, v = v0; // v in px per 60fps frame
      var lo = yFor(values.length - 1), hi = yFor(0);
      var last = Date.now();
      function frame() {
        var dt = Math.min(50, Date.now() - last) / 16.7;
        last = Date.now();
        v *= Math.pow(0.95, dt);
        t += v * dt;
        if (t <= lo) { t = lo; v = 0; }
        if (t >= hi) { t = hi; v = 0; }
        strip.style.transition = 'none';
        strip.style.transform = 'translateY(' + t + 'px)';
        if (Math.abs(v) < 0.6) { momentumId = null; snapTo(t); }
        else momentumId = requestAnimationFrame(frame);
      }
      momentumId = requestAnimationFrame(frame);
    }
    viewport.style.touchAction = 'none';
    viewport.addEventListener('pointerdown', function (e) {
      stopMomentum();
      dragging = true; pid = e.pointerId;
      startY = e.clientY; startT = yFor(idx);
      moveHist = [{ t: Date.now(), y: e.clientY }];
      strip.style.transition = 'none';
      if (viewport.setPointerCapture) try { viewport.setPointerCapture(pid); } catch (err) {}
      e.preventDefault();
    });
    viewport.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== pid) return;
      var t = startT + (e.clientY - startY);
      var lo = yFor(values.length - 1), hi = yFor(0);
      if (t < lo) t = lo + (t - lo) * 0.25; // rubber-band past the ends
      if (t > hi) t = hi + (t - hi) * 0.25;
      strip.style.transform = 'translateY(' + t + 'px)';
      var now = Date.now();
      moveHist.push({ t: now, y: e.clientY });
      while (moveHist.length > 2 && now - moveHist[0].t > 120) moveHist.shift();
      e.preventDefault();
    });
    function release(e) {
      if (!dragging || (e.pointerId !== undefined && e.pointerId !== pid)) return;
      dragging = false;
      var t = startT + (e.clientY - startY);
      var v = 0; // px per ms, from the last ~120ms of the drag
      if (moveHist.length >= 2) {
        var a = moveHist[0], b = moveHist[moveHist.length - 1], dt = b.t - a.t;
        if (dt > 0) v = (b.y - a.y) / dt;
      }
      moveHist = [];
      if (Math.abs(v) > 0.35) spin(t, v * 16.7);
      else snapTo(t);
    }
    viewport.addEventListener('pointerup', release);
    viewport.addEventListener('pointercancel', release);
    return { el: wrap, get: function () { return current; } };
  }
  function askMixLeftOff() {
    var p = activeProject();
    if (!p || p.mode !== 'straight') return;
    var idx = p.mixSizeIdx;
    if (idx >= p.mixEntries.length) return;
    var plan = mixPlannedEnd(p, idx);
    var layerPicker = makeSlotPicker(1, 999, plan.layer, 'Layer');
    var boxPicker = makeSlotPicker(1, p.mixBoxes, plan.box, 'Box');
    showModal({
      title: p.mixEntries[idx].size + ' \u2014 where did you leave off?',
      buttons: [
        {
          label: 'Done', primary: true, onClick: function () {
            commitMixFinish(p, idx, layerPicker.get(), boxPicker.get());
          }
        },
        { label: 'Cancel' }
      ]
    });
    // slot pickers go above the buttons
    var boxEl = el('modalBox');
    var row = document.createElement('div');
    row.classList.add('slots-row');
    row.appendChild(layerPicker.el);
    row.appendChild(boxPicker.el);
    boxEl.insertBefore(row, boxEl.children[boxEl.children.length - 1]);
  }
  function onMixBoxMenu() {
    var p = activeProject();
    if (!p) return;
    var buttons = [];
    for (var i = 0; i < p.mixBoxes; i++) {
      (function (i) {
        buttons.push({
          label: 'Box ' + (i + 1) + ' \u2014 ' + p.mixLevels[i],
          onClick: function () { showMixBox(i); }
        });
      })(i);
    }
    buttons.push({ label: 'Cancel' });
    showModal({ title: 'Pick a box', buttons: buttons });
  }
  var mixBoxIdx = 0;
  function showMixBox(i) {
    mixBoxIdx = i;
    renderMixBox();
    show('mixbox');
  }
  function renderMixBox() {
    var p = activeProject();
    if (!p || p.mode !== 'straight') return showProjects();
    var proj = mixProjection(p);
    el('mixBoxTitle').textContent = 'Box ' + (mixBoxIdx + 1) + ' of ' + p.mixBoxes;
    var anyProjected = proj.some(function (s) { return !s.done; });
    el('mixBoxNote').textContent = anyProjected
      ? 'Preview \u2014 unfinished sizes are projected from your counts.'
      : 'Final \u2014 all sizes finished.';
    var tb = el('mixBoxRows');
    tb.innerHTML = '';
    var total = 0, i;
    proj.forEach(function (s, si) {
      var c = s.counts[mixBoxIdx];
      if (!c) return;
      total += c;
      var row = document.createElement('div');
      row.className = 'trow' + (si % 2 ? ' alt' : '');
      var sz = document.createElement('div');
      sz.className = 'sz';
      sz.textContent = s.size;
      var ct = document.createElement('div');
      ct.textContent = '\u00d7' + c + (s.done ? '' : ' *');
      row.appendChild(sz);
      row.appendChild(ct);
      tb.appendChild(row);
    });
    var tr = document.createElement('div');
    tr.className = 'trow total';
    var tl = document.createElement('div');
    tl.className = 'sz';
    tl.textContent = 'Total';
    var tv = document.createElement('div');
    tv.textContent = total;
    tr.appendChild(tl);
    tr.appendChild(tv);
    tb.appendChild(tr);
  }

  // Straight-mix placing state: per-box levels, first unfinished size,
  // viewed size (arrows), per-size finish records, undo snapshots.
  function ensureMixPlacing(p) {
    var N = p.mixBoxes > 0 ? p.mixBoxes : 1;
    if (!Array.isArray(p.mixLevels) || p.mixLevels.length !== N) {
      p.mixLevels = [];
      for (var i = 0; i < N; i++) p.mixLevels.push(0);
    }
    if (!Array.isArray(p.mixFinishes)) p.mixFinishes = [];
    if (!Array.isArray(p.mixUndoStack)) p.mixUndoStack = [];
    if (!(p.mixSizeIdx >= 0)) p.mixSizeIdx = 0;
    if (!(p.mixViewIdx >= 0)) p.mixViewIdx = p.mixSizeIdx;
    if (!Array.isArray(p.timeline)) p.timeline = [];
  }
  // 1-indexed box of the first box below the max level; 1 when all are level.
  function mixPointer(p) {
    var lv = p.mixLevels, mx = lv[0] || 0, i;
    for (i = 1; i < lv.length; i++) if (lv[i] > mx) mx = lv[i];
    for (i = 0; i < lv.length; i++) if (lv[i] < mx) return i + 1;
    return 1;
  }
  function mixMaxLevel(p) {
    var mx = 0, i;
    for (i = 0; i < p.mixLevels.length; i++) if (p.mixLevels[i] > mx) mx = p.mixLevels[i];
    return mx;
  }

  /* ------------------------------------------------------------------- wiring */

  /* Multi-touch pad: presses commit in touch-START order, no matter the lift
     order. Each finger's press is queued on pointerdown; the queue flushes
     head-first on pointerup/cancel, so the first finger down always wins.
     Handles any number of simultaneous touches. */
  var padQueue = []; // [{pid, elm, run, done}]

  function padFlush() {
    while (padQueue.length && padQueue[0].done) {
      var item = padQueue.shift();
      item.elm.classList.remove('pressed');
      item.run();
      item.elm._padCommitAt = Date.now();
    }
  }

  /* Release: a press only counts if the finger is still on its button —
     sliding off cancels it (nothing commits, nothing stays highlighted).
     pointercancel always cancels. */
  function padRelease(pid, x, y) {
    for (var i = 0; i < padQueue.length; i++) {
      var item = padQueue[i];
      if (item.pid !== pid) continue;
      item.elm.classList.remove('pressed');
      var onButton = false;
      if (x !== undefined) {
        var t = document.elementFromPoint(x, y);
        onButton = !!t && item.elm.contains(t);
      }
      if (onButton) {
        item.done = true;
      } else {
        padQueue.splice(i, 1); // slid off (or cancelled): the press never happened
        item.elm._padCancelledAt = Date.now();
      }
      break;
    }
    padFlush();
  }

  function wirePadButton(elm, run) {
    elm.style.touchAction = 'none';
    elm.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      for (var i = 0; i < padQueue.length; i++) {
        if (padQueue[i].pid === e.pointerId) return; // already tracking this finger
      }
      padQueue.push({ pid: e.pointerId, elm: elm, run: run, done: false });
      elm.classList.add('pressed');
    });
    // Keyboard / assistive tech: a click with no preceding pointer press still works.
    elm.addEventListener('click', function () {
      var now = Date.now();
      // Already committed via pointer, or the press was slid off and cancelled.
      if (now - (elm._padCommitAt || 0) < 600 || now - (elm._padCancelledAt || 0) < 600) return;
      run();
    });
  }

  function wire() {
    // Pad releases are heard at document level so a finger lifting off-button
    // still resolves its queued press instead of jamming the queue.
    document.addEventListener('pointerup', function (e) { padRelease(e.pointerId, e.clientX, e.clientY); });
    document.addEventListener('pointercancel', function (e) { padRelease(e.pointerId); });
    // Live pressed feedback while sliding: leaving the button un-highlights it.
    document.addEventListener('pointermove', function (e) {
      if (!padQueue.length) return;
      for (var i = 0; i < padQueue.length; i++) {
        var item = padQueue[i];
        if (item.pid !== e.pointerId || item.done) continue;
        var t = document.elementFromPoint(e.clientX, e.clientY);
        item.elm.classList.toggle('pressed', !!t && item.elm.contains(t));
      }
    });
    // projects
    function createRegularProject() {
      var name = M.Store.uniqueName(projects, M.projectDisplayName(new Date()));
      var p = M.Store.blankProject(name);
      p.mode = 'regular';
      p.pairsPerBox = settings.pairsPerBox;
      p.flippingEnabled = settings.flippingEnabled;
      p.bundles = cloneBundles(settings.bundles);
      projects.push(p);
      ui.activeId = p.id;
      persist();
      showEntry();
    }
    function createStraightProject(itemName) {
      var name = M.Store.uniqueName(projects, M.projectDisplayName(new Date()));
      var p = M.Store.blankProject(name);
      p.mode = 'straight';
      p.itemName = itemName;
      p.mixEntries = []; // [{size, qty}] — the counted sizes
      p.boxCapacity = 0;
      p.mixBoxes = 0;
      projects.push(p);
      ui.activeId = p.id;
      persist();
      showMixSizes();
    }
    function askMixItem() {
      showModal({
        title: 'What item are you mixing?',
        inputs: [{ label: 'Item', hint: 'shirts, hoodies, jackets\u2026' }],
        buttons: [
          {
            label: 'Done', primary: true, onClick: function (o) {
              var name = (o.input.value || '').trim().slice(0, 24);
              if (!name) { toast('Name the item first'); return false; }
              createStraightProject(name);
            }
          },
          { label: 'Cancel' }
        ]
      });
    }
    el('newProjectBtn').onclick = function () {
      if (!settings.experimental) { createRegularProject(); return; }
      showModal({
        title: 'New project',
        rowButtons: true,
        buttons: [
          { label: 'Regular pull', primary: true, onClick: function () { createRegularProject(); } },
          // return false: askMixItem opens its own modal in the same overlay,
          // so the first modal must not auto-close (which would kill the second).
          { label: 'Straight mix', onClick: function () { askMixItem(); return false; } }
        ]
      });
    };
    el('projectsSettings').onclick = function () { settingsReturn = 'projects'; showSettings('defaults'); };
    // entry
    el('entryBack').onclick = function () { saveDraft(); showProjects(); };
    el('entrySettings').onclick = function () { saveDraft(); settingsReturn = 'entry'; showSettings('project', activeProject()); };
    // settings from anywhere: project mode (read-only after lock), back where you came from
    el('reviewSettings').onclick = function () { settingsReturn = 'review'; showSettings('project', activeProject()); };
    el('lockedSettings').onclick = function () { settingsReturn = 'locked'; showSettings('project', activeProject()); };
    el('placingSettings').onclick = function () { settingsReturn = 'placing'; showSettings('project', activeProject()); };
    el('boxSettings').onclick = function () { settingsReturn = 'box'; showSettings('project', activeProject()); };
    el('stapleSettings').onclick = function () { settingsReturn = 'stapling'; showSettings('project', activeProject()); };
    el('entryDone').onclick = onEntryDone;
    el('entryLeft').onclick = onEntryPrev;
    el('entryRight').onclick = onEntryNext;
    el('waistField').onclick = function () { tapField(0); };
    el('lengthField').onclick = function () { tapField(1); };
    el('qtyField').onclick = function () { tapField(2); };
    var digits = ['pad0', 'pad1', 'pad2', 'pad3', 'pad4', 'pad5', 'pad6', 'pad7', 'pad8', 'pad9'];
    digits.forEach(function (id, d) {
      wirePadButton(el(id), function () { onDigit(String(d)); });
    });
    wirePadButton(el('padBack'), onBackspace);
    wirePadButton(el('padEnter'), onEntryNext);
    // review
    el('reviewBack').onclick = function () { showEntry(); };
    el('confirmBtn').onclick = onConfirm;
    // locked
    el('lockedBack').onclick = function () { showProjects(); };
    el('printBtn').onclick = function () { window.print(); };
    el('startPlacingBtn').onclick = function () { showPlacing(); };
    // placing
    el('placingBack').onclick = function () { showLocked(); };
    el('sizeBig').onclick = onSizeJump;
    el('placedView').onclick = onPlacedTap;
    el('placeUndo').onclick = onUndo;
    el('placeLeft').onclick = function () { onArrow(-1); };
    el('placeRight').onclick = function () { onArrow(1); };
    el('placeDone').onclick = onSizeDone;
    el('boxMenuBtn').onclick = onBoxMenu;
    el('staplingBtn').onclick = showStapling;
    el('reviewSizesBtn').onclick = function () { current = 0; saveCurrent(); renderPlacing(); };
    el('resetPlacingBtn').onclick = onResetPlacing;
    el('completeBack').onclick = function () { showProjects(); };
    // box detail
    el('boxBack').onclick = function () { showPlacing(); };
    // stapling
    el('stapleBack').onclick = function () { showPlacing(); };
    el('stapleDone').onclick = onStapleDone;
    el('stapleCancel').onclick = function () { showPlacing(); };
    // settings
    el('settingsBack').onclick = function () {
      switch (settingsReturn) {
        case 'entry': showEntry(); break;
        case 'review': showReview(); break;
        case 'locked': showLocked(); break;
        case 'placing': showPlacing(); break;
        case 'box': showBox(boxIdx); break;
        case 'stapling': showStapling(); break;
        case 'mixplacing': showMixPlacing(); break;
        case 'mixbox': showMixBox(mixBoxIdx); break;
        default: showProjects();
      }
    };
    el('setPairs').addEventListener('change', function () {
      var t = settingsTarget();
      var v = Math.max(1, parseInt(el('setPairs').value, 10) || t.pairsPerBox);
      t.pairsPerBox = v;
      el('setPairs').value = v;
      saveSettingsTarget();
    });
    el('setFlipToggle').onclick = function () {
      var t = settingsTarget();
      t.flippingEnabled = !t.flippingEnabled;
      saveSettingsTarget();
      renderSettings();
    };
    el('manageBundlesBtn').onclick = function () { showBundles(); };
    el('qDown').onclick = function () { bumpQuickAdds(-1); };
    el('qUp').onclick = function () { bumpQuickAdds(1); };
    el('setDarkToggle').onclick = function () {
      settings.darkMode = !settings.darkMode;
      saveSettings();
      renderSettings();
    };
    el('scaleDown').onclick = function () { bumpScale(-0.05); };
    el('scaleUp').onclick = function () { bumpScale(0.05); };
    el('setExperimentalToggle').onclick = function () {
      settings.experimental = !settings.experimental;
      saveSettings();
      renderSettings();
      toast(settings.experimental ? 'Experimental features on' : 'Experimental features off');
    };
    el('installAppBtn').onclick = onInstallApp;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installPromptEvt = e;
      updateInstallBtn();
    });
    window.addEventListener('appinstalled', function () {
      installPromptEvt = null;
      updateInstallBtn();
      toast('App installed');
    });
    var nav = window.navigator || {};
    if ('serviceWorker' in nav) {
      nav.serviceWorker.register('sw.js').catch(function () {});
    }
    el('resetDefaultsBtn').onclick = function () {
      var isProj = settingsCtx.mode === 'project' && !!settingsCtx.project;
      showModal({
        title: 'Reset to defaults?',
        message: isProj
          ? 'Reset this project\'s pairs per box, flipping and bundles to the current defaults?'
          : 'Restores pairs per box (25), bundles, quick-add buttons, UI scale and dark mode to the original settings.',
        rowButtons: true,
        buttons: [
          {
            label: 'Reset', danger: true, onClick: function () {
              if (isProj) {
                var p = settingsCtx.project;
                p.pairsPerBox = settings.pairsPerBox;
                p.flippingEnabled = settings.flippingEnabled;
                p.bundles = cloneBundles(settings.bundles);
                persist();
              } else {
                settings = defaultSettings();
                saveSettings();
              }
              renderSettings();
              toast('Settings reset');
            }
          },
          { label: 'Cancel' }
        ]
      });
    };
    // bundles
    el('bundleAdd').onclick = function () {
      var t = settingsTarget();
      var n = t.bundles.length + 1;
      t.bundles.push({ name: 'bundle ' + n, layers: 6 });
      saveSettingsTarget();
      renderBundles();
    };
    el('bundlesBack').onclick = onBundlesDone;
    el('bundlesDone').onclick = onBundlesDone;
    // straight mix
    el('mixSizesBack').onclick = function () { showProjects(); };
    el('mixSizesAdd').onclick = function () {
      var p = activeProject();
      if (!p) return;
      p.mixEntries.push({ size: '', qty: 0 });
      persist();
      renderMixSizes();
    };
    el('mixSizesDone').onclick = function () {
      var p = activeProject();
      if (!p) return showProjects();
      var rows = p.mixEntries || [];
      var partial = rows.some(function (e) {
        var hasSize = (e.size || '').trim().length > 0, hasQty = (e.qty || 0) > 0;
        return hasSize !== hasQty;
      });
      if (partial) { toast('Every row needs a size and a quantity'); return; }
      p.mixEntries = rows.filter(function (e) {
        return (e.size || '').trim().length > 0 && (e.qty || 0) > 0;
      });
      if (!p.mixEntries.length) { toast('Add at least one size'); return; }
      persist();
      showMixCapacity();
    };
    el('mixCapBack').onclick = function () { showMixSizes(); };
    el('mixCapDone').onclick = function () {
      var p = activeProject();
      if (!p) return showProjects();
      var v = Math.max(0, parseInt(el('mixCapInput').value, 10) || 0);
      if (!(v > 0)) { toast('Enter how many fit in each box'); return; }
      p.boxCapacity = v;
      persist();
      showMixBoxes();
    };
    el('mixBoxesBack').onclick = function () { showMixCapacity(); };
    el('mixBoxesSave').onclick = function () {
      var p = activeProject();
      if (!p) return showProjects();
      p.locked = true;
      ensureMixPlacing(p);
      persist();
      toast('Project saved');
      showMixPlacing();
    };
    el('mixPlacingBack').onclick = function () { showProjects(); };
    el('mixSizeBig').onclick = onMixSizeJump;
    el('mixPlacingTitle').onclick = onMixSizeJump;
    el('mixLeft').onclick = function () {
      var p = activeProject();
      if (!p) return;
      p.mixViewIdx = Math.max(0, p.mixViewIdx - 1);
      persist();
      renderMixPlacing();
    };
    el('mixRight').onclick = function () {
      var p = activeProject();
      if (!p) return;
      p.mixViewIdx = Math.min(p.mixEntries.length - 1, p.mixViewIdx + 1);
      persist();
      renderMixPlacing();
    };
    el('mixUndo').onclick = onMixUndo;
    el('mixFinishSize').onclick = askMixLeftOff;
    el('mixBoxMenuBtn').onclick = onMixBoxMenu;
    el('mixBoxBack').onclick = function () { showMixPlacing(); };
    el('mixConsolidateBack').onclick = function () { showProjects(); };
    el('mixPlacingSettings').onclick = function () { settingsReturn = 'mixplacing'; showSettings('project', activeProject()); };
    el('mixBoxSettings').onclick = function () { settingsReturn = 'mixbox'; showSettings('project', activeProject()); };
  }

  document.addEventListener('DOMContentLoaded', function () {
    wire();
    el('projectsTitle').textContent = 'Jeans Mixing ' + APP_VERSION;
    showProjects();
  });
})();
