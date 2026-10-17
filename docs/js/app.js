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
  var APP_VERSION = '1.2.3';

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
      uiScale: 1
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
      uiScale: (s.uiScale > 0) ? Math.min(2, Math.max(0.5, s.uiScale)) : d.uiScale
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
  // flipping on, with the default bundles.
  projects.forEach(function (p) {
    if (!(p.pairsPerBox > 0)) p.pairsPerBox = 25;
    if (!Array.isArray(p.bundles)) p.bundles = cloneBundles(defaultSettings().bundles);
    if (typeof p.flippingEnabled !== 'boolean') p.flippingEnabled = settings.flippingEnabled;
  });
  applySettings();

  /* ------------------------------------------------------------ navigation */
  var VIEWS = ['projects', 'entry', 'review', 'locked', 'placing', 'box', 'stapling', 'settings', 'bundles'];
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
      inputEl.setAttribute('inputmode', 'numeric');
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
    if (p.locked) showLocked();
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
    show('settings');
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
    el('newProjectBtn').onclick = function () {
      var name = M.Store.uniqueName(projects, M.projectDisplayName(new Date()));
      var p = M.Store.blankProject(name);
      p.pairsPerBox = settings.pairsPerBox;
      p.flippingEnabled = settings.flippingEnabled;
      p.bundles = cloneBundles(settings.bundles);
      projects.push(p);
      ui.activeId = p.id;
      persist();
      showEntry();
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
  }

  document.addEventListener('DOMContentLoaded', function () {
    wire();
    el('projectsTitle').textContent = 'Jeans Mixing ' + APP_VERSION;
    showProjects();
  });
})();
