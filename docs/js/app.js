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
  var APP_VERSION = '2.3.3';

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
  /** "HH:MM" -> minutes since midnight. */
  function toMins(hhmm) {
    var parts = String(hhmm || '').split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }
  /** "H:MM" -> "HH:MM". */
  function normTime(hhmm) {
    var parts = String(hhmm || '').split(':');
    var h = Math.max(0, Math.min(23, parseInt(parts[0], 10) || 0));
    var m = Math.max(0, Math.min(59, parseInt(parts[1], 10) || 0));
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
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
      experimental: false,
      // Set-and-forget break ranges. Scoring-only: they adjust the
      // leaderboard time, never the placing itself. No breaks by default —
      // a pull only counts breaks he actually took (set them in Settings,
      // or per pull from the done screen's Breaks button).
      breaks: []
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
      experimental: s.experimental === true,
      breaks: d.breaks
    };
    if (Array.isArray(s.breaks)) {
      out.breaks = s.breaks.filter(function (b) {
        return b && /^\d{1,2}:\d{2}$/.test(b.start || '') && /^\d{1,2}:\d{2}$/.test(b.end || '');
      }).map(function (b) {
        return { start: normTime(b.start), end: normTime(b.end) };
      }).filter(function (b) {
        return toMins(b.end) > toMins(b.start);
      }).slice(0, 6);
      // v2.1.0 shipped with his three usual breaks as the default; v2.2.0
      // has no breaks by default, so a stored copy of the untouched old
      // defaults migrates to empty (a schedule he edited stays as-is).
      if (out.breaks.length === 3 &&
        out.breaks[0].start === '10:00' && out.breaks[0].end === '10:30' &&
        out.breaks[1].start === '13:00' && out.breaks[1].end === '13:15' &&
        out.breaks[2].start === '15:00' && out.breaks[2].end === '15:15') {
        out.breaks = [];
      }
    }
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
    // Projects locked before origQty existed: their current counts are the
    // only baseline available — transfers from here on still get flagged.
    (p.entries || []).forEach(function (e) {
      if (e.origQty == null) e.origQty = e.qty;
    });
    if (!Array.isArray(p.bundles)) p.bundles = cloneBundles(defaultSettings().bundles);
    if (typeof p.flippingEnabled !== 'boolean') p.flippingEnabled = settings.flippingEnabled;
    if (p.mode === 'straight' && !Array.isArray(p.mixEntries)) p.mixEntries = [];
  });
  applySettings();

  /* ------------------------------------------------------------ navigation */
  var VIEWS = ['projects', 'entry', 'review', 'locked', 'placing', 'box', 'stapling', 'settings', 'bundles',
    'mixsizes', 'mixcapacity', 'mixboxes', 'mixplacing', 'mixbox', 'leaderboard'];
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
    box.classList.remove('qr-full');
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
    var primaryBtn = null;
    (o.buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      if (b.html) btn.innerHTML = b.html;
      else btn.textContent = b.label;
      if (b.primary) btn.classList.add('primary');
      if (b.danger) btn.classList.add('danger');
      if (b.disabled) btn.disabled = true;
      if (b.primary && b.onClick && !primaryBtn) primaryBtn = btn;
      btn.onclick = function () {
        var r = b.onClick ? b.onClick({ close: close, input: inputEl, inputs: inputEls }) : undefined;
        if (r !== false) close();
      };
      wrap.appendChild(btn);
    });
    // Enter in a single-input popup presses the primary button (e.g. "Done").
    if (inputEls.length === 1 && primaryBtn) {
      inputEls[0].addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        if (!primaryBtn.disabled) primaryBtn.onclick();
      });
    }
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
    // The camera button scans project QR codes — no longer experimental.
    el('entryScan').style.display = '';
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
    // Tapping the waist box clears the length box too, so fixing e.g.
    // 33 x 03 to 34 x 30 flows straight through the way he normally types.
    // (Trade: a length that was already right has to be retyped.)
    if (f === 0) { entry.waist = ''; entry.length = ''; }
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

  /* Size editing on the review screen (universal, not just for scans):
     tap a size to edit its two digits in place. While a row is being
     edited, renderReview draws the editor instead of the size text. */
  var reviewSizeEdit = null; // {pos, waist, length} or null

  /* A flagged (scanned, unparseable) row clears once it has a real
     two-digit size and a quantity — i.e. once alex has fixed it. */
  function maybeClearScanFlag(e) {
    if (e.scanFlag && /^\d\d$/.test(e.waist || '') &&
        /^\d\d$/.test(e.length || '') && e.qty > 0) {
      delete e.scanFlag;
      return true;
    }
    return false;
  }

  function renderReview() {
    var p = activeProject();
    if (!p) return showProjects();
    el('reviewTitle').textContent = 'Review sizes \u2014 ' + p.name;
    var rows = el('reviewRows');
    rows.innerHTML = '';
    p.entries.forEach(function (e, pos) {
      var row = document.createElement('div');
      row.className = 'trow' + (pos % 2 === 1 ? ' alt' : '') + (e.scanFlag ? ' flag' : '');
      if (reviewSizeEdit && reviewSizeEdit.pos === pos) {
        // In-place size editor: two 2-digit boxes + save/cancel.
        var wIn = document.createElement('input');
        wIn.className = 'szedit';
        wIn.type = 'text';
        wIn.setAttribute('inputmode', 'numeric');
        wIn.maxLength = 2;
        wIn.value = reviewSizeEdit.waist;
        var x = document.createElement('div');
        x.className = 'x';
        x.textContent = 'x';
        var lIn = document.createElement('input');
        lIn.className = 'szedit';
        lIn.type = 'text';
        lIn.setAttribute('inputmode', 'numeric');
        lIn.maxLength = 2;
        lIn.value = reviewSizeEdit.length;
        var okBtn = document.createElement('button');
        okBtn.className = 'szbtn primary';
        okBtn.textContent = '\u2713';
        okBtn.setAttribute('aria-label', 'Save size');
        var noBtn = document.createElement('button');
        noBtn.className = 'szbtn';
        noBtn.textContent = '\u2715';
        noBtn.setAttribute('aria-label', 'Cancel size edit');
        function saveSizeEdit() {
          var w = wIn.value, l = lIn.value;
          if (!/^\d\d$/.test(w) || !/^\d\d$/.test(l)) {
            toast('Sizes are two digits each');
            return;
          }
          for (var i = 0; i < p.entries.length; i++) {
            if (i !== pos && p.entries[i].waist === w && p.entries[i].length === l) {
              showModal({
                title: 'Duplicate size',
                message: M.displaySize(w, l) + ' is already in the list.',
                buttons: [{ label: 'OK', primary: true }]
              });
              return;
            }
          }
          e.waist = w;
          e.length = l;
          maybeClearScanFlag(e);
          reviewSizeEdit = null;
          persist();
          renderReview();
        }
        okBtn.onclick = saveSizeEdit;
        noBtn.onclick = function () { reviewSizeEdit = null; renderReview(); };
        wIn.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); lIn.focus(); }
        });
        lIn.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); saveSizeEdit(); }
        });
        row.appendChild(wIn);
        row.appendChild(x);
        row.appendChild(lIn);
        row.appendChild(okBtn);
        row.appendChild(noBtn);
        rows.appendChild(row);
        return;
      }
      var sz = document.createElement('div');
      sz.className = 'sz';
      if (e.scanFlag) {
        sz.textContent = '\u26A0 Check this row';
        var raw = document.createElement('div');
        raw.className = 'flag-raw';
        raw.textContent = 'Scanned as: ' + (e.scanFlag.raw || '(unreadable)') +
          (e.scanFlag.reason === 'duplicate' ? ' \u2014 already in the list' : '') +
          (e.scanFlag.reason === 'missing' ? ' \u2014 not found on the page' : '');
        sz.appendChild(raw);
      } else {
        sz.textContent = M.displaySize(e.waist, e.length);
      }
      sz.onclick = function () {
        reviewSizeEdit = { pos: pos, waist: e.waist, length: e.length };
        renderReview();
      };
      var qty = document.createElement('input');
      qty.className = 'qty';
      qty.type = 'number';
      qty.setAttribute('inputmode', 'numeric');
      if (!e.scanFlag) qty.min = '1';
      qty.value = (e.scanFlag && e.qty === 0) ? '' : e.qty;
      qty.addEventListener('input', function () {
        var v = parseInt(qty.value, 10);
        if (e.scanFlag) {
          if (!isNaN(v) && v >= 0) {
            if (e.scanFlag.reason === 'missing' && v === 0) {
              // A missing size confirmed at zero means "don't input
              // it": the row goes away instead of lingering as a 0.
              p.entries.splice(pos, 1);
              persist(); renderReview();
              return;
            }
            e.qty = v;
            if (maybeClearScanFlag(e)) { persist(); renderReview(); }
            else { persist(); updateReviewTotal(); }
          }
        } else if (v > 0) {
          e.qty = v;
          persist();
          updateReviewTotal();
        }
      });
      // If they leave junk in the box, put the last good value back.
      // A blank qty on a flagged row is fine — it still needs a quantity.
      qty.addEventListener('blur', function () {
        var v = parseInt(qty.value, 10);
        if (e.scanFlag) {
          if (qty.value === '') return;
          if (isNaN(v) || v < 0) qty.value = e.qty === 0 ? '' : e.qty;
        } else if (!(v > 0)) {
          qty.value = e.qty;
        }
      });
      var del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '\u2715';
      del.setAttribute('aria-label', 'Delete size');
      del.onclick = function () {
        showModal({
          title: 'Delete size?',
          message: 'Delete ' + (e.scanFlag ? 'scanned row "' + (e.scanFlag.raw || '') + '"' : M.displaySize(e.waist, e.length)) + ' from the list?',
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
    var flagged = p.entries.filter(function (e) { return e.scanFlag; }).length;
    el('reviewTotal').textContent = 'Total: ' + total + ' pairs' +
      (flagged ? ' \u2014 ' + flagged + ' row' + (flagged === 1 ? '' : 's') + ' need attention' : '');
  }

  function onConfirm() {
    var p = activeProject();
    if (p.entries.length === 0) {
      toast('Nothing to confirm \u2014 the list is empty');
      return;
    }
    var flagged = p.entries.filter(function (e) { return e.scanFlag; }).length;
    if (flagged) {
      showModal({
        title: 'Rows need attention',
        message: flagged + ' scanned row' + (flagged === 1 ? ' still needs' : 's still need') +
          ' a fix. Tap a flagged row to correct it, or delete it, then confirm.',
        buttons: [{ label: 'OK', primary: true }]
      });
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
            // The counts as typed, frozen at lock time. Placing may later
            // change a size's qty (transfers); origQty is how the UI knows
            // to flag the changed number (green y).
            p.entries.forEach(function (e) { e.origQty = e.qty; });
            persist();
            showLocked();
          }
        },
        { label: 'No' }
      ]
    });
  }

  /* ------------------------------------------------------------------- scan
   * Experimental input method for regular pull: photograph the printed
   * work sheet and let Tesseract.js (open source, runs on-device) read the
   * size rows into the review screen. The photo is never stored anywhere:
   * it lives as a canvas in memory during the scan and is dropped right
   * after parsing, so nothing lands in the phone's photo gallery either.
   * Tesseract itself loads on demand from its CDN the first time Scan is
   * tapped, so the normal app stays dependency-free; later scans reuse
   * the cached library and worker. */
  var scanLibPromise = null, scanWorker = null, scanInputs = null, scanPages = [];

  function showScan(text, pct) {
    el('scanStatus').textContent = text;
    el('scanBar').style.width = (pct || 0) + '%';
    el('scanOverlay').classList.add('open');
  }
  function hideScan() { el('scanOverlay').classList.remove('open'); }

  function ensureScanLib() {
    if (window.Tesseract) return Promise.resolve();
    if (scanLibPromise) return scanLibPromise;
    scanLibPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { scanLibPromise = null; reject(new Error('tesseract load failed')); };
      document.body.appendChild(s);
    });
    return scanLibPromise;
  }

  /* Manual corner crop: OpenCV.js loads on demand (same pattern as the
     text reader). The warp itself is the standard getPerspectiveTransform
     + warpPerspective; the corners come from alex's four dots, NOT from
     auto-detection, which guessed the wrong rectangle on both of his real
     photos. Any load or warp failure resolves to the original photo, so
     cropping can never break a scan.
     The download is metered: jsDelivr (the same CDN the text reader
     already uses) allows the page to count bytes, while the old docs host
     sends no CORS header and cannot be metered. The counted fetch warms
     the caches and the script then loads normally from the same URL. If
     metering fails, it falls back to a plain script tag from the docs host. */
  var cropLibPromise = null, cropLibLoaded = false;
  var cropLoadTotal = 0, cropLoadDone = 0;
  function cropLoadStatusText() {
    function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }
    if (cropLoadTotal > 0) return 'Downloading straightener… ' + mb(cropLoadDone) + ' / ' + mb(cropLoadTotal) +
      ' (' + Math.round(cropLoadDone / cropLoadTotal * 100) + '%)';
    if (cropLoadDone > 0) return 'Downloading straightener… ' + mb(cropLoadDone);
    return 'Loading straightener…';
  }
  function cropUpdateLoadLine() {
    var line = el('cropLoadStatus');
    if (!line) return;
    if (cropLibLoaded || !cropLibPromise) { line.style.display = 'none'; return; }
    line.textContent = cropLoadStatusText();
    line.style.display = 'block';
  }
  function loadCropLibScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error('opencv load timeout')); }
      }, 60000);
      s.onload = function () {
        var cv = window.cv;
        if (cv && cv.Mat) { done = true; clearTimeout(timer); resolve(cv); }
        else if (cv) cv['onRuntimeInitialized'] = function () {
          if (!done) { done = true; clearTimeout(timer); resolve(window.cv); }
        };
        else { done = true; clearTimeout(timer); reject(new Error('opencv missing')); }
      };
      s.onerror = function () {
        if (!done) { done = true; clearTimeout(timer); reject(new Error('opencv load failed')); }
      };
      s.src = src;
      document.body.appendChild(s);
    });
  }
  function loadCropLibMetered() {
    /* Count the download for progress, then load the script NORMALLY from
       the same URL: the counted fetch warms the browser and service-worker
       caches (jsDelivr marks it immutable, a year), so the script tag
       hits cache instantly. The earlier Blob-URL execution wedged on
       alex's phone (5 minutes stuck on "Straightening…" with no way out),
       while the plain script-tag path is the one that worked in v1.7.0. */
    var controller = null;
    try { controller = new AbortController(); } catch (e) { controller = null; }
    var idleTimer = null;
    function armIdle() {
      if (!controller) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, 60000);
    }
    function clearIdle() { clearTimeout(idleTimer); }
    var opts = controller ? { signal: controller.signal } : {};
    return fetch('https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.7.0-release.1/dist/opencv.js', opts).then(function (resp) {
      if (!resp.ok || !resp.body) throw new Error('metered fetch unavailable');
      /* The decoded size of this exact pinned file, verified by download.
         jsDelivr compresses the transfer, so when content-encoding is
         present the content-length header is the COMPRESSED size (~2.0 MB)
         while the reader yields DECODED bytes (8.6 MB) — dividing those
         showed a silly 437%. The pinned URL never changes, so its decoded
         size is the honest total whenever the header is compressed. */
      var CROP_LIB_DECODED_BYTES = 8980564;
      var encoded = resp.headers.get('content-encoding');
      var len = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
      cropLoadTotal = encoded ? CROP_LIB_DECODED_BYTES : len;
      cropLoadDone = 0; cropUpdateLoadLine();
      armIdle();
      var reader = resp.body.getReader();
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            clearIdle();
            return loadCropLibScript('https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.7.0-release.1/dist/opencv.js');
          }
          cropLoadDone += r.value.byteLength;
          cropUpdateLoadLine();
          armIdle();
          return pump();
        });
      }
      return pump();
    }).then(function (v) { clearIdle(); return v; }, function (e) { clearIdle(); throw e; });
  }
  function ensureCropLib() {
    if (window.cv && window.cv.Mat) { cropLibLoaded = true; return Promise.resolve(window.cv); }
    if (cropLibPromise) return cropLibPromise;
    cropLibPromise = loadCropLibMetered().catch(function () {
      return loadCropLibScript('https://docs.opencv.org/4.7.0/opencv.js');
    }).then(function (cv) {
      cropLibLoaded = true; cropUpdateLoadLine();
      return cv;
    }, function (err) {
      cropLibPromise = null; cropLibLoaded = false; cropUpdateLoadLine();
      throw err;
    });
    return cropLibPromise;
  }
  /* Warp the quad (corners in SOURCE canvas coords, order TL, TR, BR, BL)
     into a straight rectangle. Output size comes from the quad's own
     edge lengths, capped like the downscale step. */
  function warpQuad(srcCanvas, corners) {
    return ensureCropLib().then(function (cv) {
      var wTop = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
      var wBot = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
      var hLeft = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
      var hRight = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
      var w = Math.max(1, Math.round(Math.max(wTop, wBot)));
      var h = Math.max(1, Math.round(Math.max(hLeft, hRight)));
      var scale = Math.min(1, 2200 / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
      var src = cv.imread(srcCanvas);
      var srcTri = cv.matFromArray(4, 1, cv.CV_32FC2,
        [corners[0].x, corners[0].y, corners[1].x, corners[1].y,
         corners[2].x, corners[2].y, corners[3].x, corners[3].y]);
      var dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
      var M = cv.getPerspectiveTransform(srcTri, dstTri);
      var dst = new cv.Mat();
      cv.warpPerspective(src, dst, M, new cv.Size(w, h));
      var out = document.createElement('canvas');
      out.width = w; out.height = h;
      cv.imshow(out, dst);
      src.delete(); dst.delete(); srcTri.delete(); dstTri.delete(); M.delete();
      return out;
    });
  }

  /* Crop controller: one session at a time, wired once. Corners live in
     display coords (the canvas is sized so CSS px == canvas px); the
     warp converts them to source coords. */
  var cropState = null, cropWired = false;
  function cropFit(srcW, srcH) {
    var stageW = el('cropStage').clientWidth || 320;
    var maxH = window.innerHeight * 0.62;
    var scale = Math.min(1, stageW / srcW, maxH / srcH);
    return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)) };
  }
  function cropDrawEdit() {
    var st = cropState; if (!st) return;
    var canvas = el('cropCanvas'), ctx = canvas.getContext('2d');
    ctx.drawImage(st.off, 0, 0);
    ctx.beginPath();
    st.corners.forEach(function (c, i) { if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y); });
    ctx.closePath();
    ctx.fillStyle = 'rgba(57,73,171,0.15)'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
  }
  function cropPlaceHandles() {
    cropState.corners.forEach(function (c, i) {
      var h = el('cropHandle' + i);
      h.style.left = c.x + 'px'; h.style.top = c.y + 'px';
    });
  }
  /* Drag magnifier: a loupe above the finger showing the full-resolution
     photo around the held dot at 4x with smoothing off (discrete pixels)
     and a crosshair exactly on the point. Shown only while a dot is held;
     hidden the moment the drag ends or the mode changes. */
  var MAG_SIZE = 132, MAG_ZOOM = 4;
  function cropShowMag(fingerX, fingerY) {
    var st = cropState; if (!st || st.mode !== 'edit' || st.drag === null || st.drag === undefined) return;
    var canvas = el('cropCanvas');
    var fx = st.src.width / canvas.width, fy = st.src.height / canvas.height;
    var pt = st.corners[st.drag];
    var sx = pt.x * fx, sy = pt.y * fy;
    var half = MAG_SIZE / MAG_ZOOM / 2;
    half = Math.min(half, st.src.width / 2, st.src.height / 2);
    var ox = Math.max(0, Math.min(st.src.width - half * 2, sx - half));
    var oy = Math.max(0, Math.min(st.src.height - half * 2, sy - half));
    var m = el('cropMagCanvas').getContext('2d');
    m.imageSmoothingEnabled = false;
    m.drawImage(st.src, ox, oy, half * 2, half * 2, 0, 0, MAG_SIZE, MAG_SIZE);
    var cx = (sx - ox) * MAG_ZOOM, cy = (sy - oy) * MAG_ZOOM;
    m.strokeStyle = '#E53935'; m.lineWidth = 2;
    m.beginPath();
    m.moveTo(cx, 0); m.lineTo(cx, MAG_SIZE);
    m.moveTo(0, cy); m.lineTo(MAG_SIZE, cy);
    m.stroke();
    var mag = el('cropMag');
    var stage = el('cropStage');
    mag.style.left = Math.max(0, Math.min(stage.clientWidth - MAG_SIZE, fingerX - MAG_SIZE / 2)) + 'px';
    var top;
    if (fingerY - MAG_SIZE - 16 >= 0) top = fingerY - MAG_SIZE - 16;
    else top = Math.min(stage.clientHeight - MAG_SIZE, fingerY + 24);
    mag.style.top = Math.max(0, top) + 'px';
    mag.style.display = 'block';
  }
  function cropHideMag() { el('cropMag').style.display = 'none'; }
  function cropSetMode(mode) {
    var st = cropState; if (!st) return;
    st.mode = mode;
    el('cropBtnsEdit').style.display = mode === 'edit' ? 'flex' : 'none';
    el('cropBtnsPreview').style.display = mode === 'preview' ? 'flex' : 'none';
    for (var i = 0; i < 4; i++) el('cropHandle' + i).style.display = mode === 'edit' ? 'block' : 'none';
    el('cropTitle').textContent = mode === 'edit' ? 'Place the corners on the sheet' : 'Straightened preview';
    el('cropHint').textContent = mode === 'edit'
      ? 'Drag the four dots onto the corners of the sheet, then Straighten. Hold a dot to see it magnified.'
      : 'Scan this straightened page, or go back and adjust the corners.';
    if (mode !== 'edit') cropHideMag();
    ['cropStraighten', 'cropSkipEdit', 'cropScanThis', 'cropAdjust', 'cropSkipPreview'].forEach(function (id) {
      el(id).disabled = false;
    });
  }
  function cropFinish(canvas) {
    var resolve = cropState ? cropState.resolve : null;
    cropState = null;
    el('cropOverlay').classList.remove('open');
    if (resolve) resolve(canvas);
  }
  function cropStraighten() {
    var st = cropState; if (!st) return;
    el('cropTitle').textContent = 'Straightening…';
    /* Only Straighten is disabled: Skip stays live the whole wait, so a
       stuck load can never trap alex on this screen again — skipping
       finishes with the original photo, and the pending load resolving
       later is ignored (cropState is null by then) or warms the next run. */
    el('cropStraighten').disabled = true;
    var canvas = el('cropCanvas');
    var fx = st.src.width / canvas.width, fy = st.src.height / canvas.height;
    var srcCorners = st.corners.map(function (c) { return { x: c.x * fx, y: c.y * fy }; });
    warpQuad(st.src, srcCorners).then(function (warped) {
      if (!cropState) return; // user skipped while warping; that finish wins
      st.warped = warped;
      var fit = cropFit(warped.width, warped.height);
      canvas.width = fit.w; canvas.height = fit.h;
      canvas.style.width = fit.w + 'px'; canvas.style.height = fit.h + 'px';
      canvas.getContext('2d').drawImage(warped, 0, 0, fit.w, fit.h);
      cropSetMode('preview');
    }).catch(function () {
      if (!cropState) return;
      toast('Straightener could not load — scanning the original instead');
      cropFinish(st.src);
    });
  }
  function wireCrop() {
    for (var i = 0; i < 4; i++) (function (idx) {
      var h = el('cropHandle' + idx);
      h.addEventListener('pointerdown', function (e) {
        if (!cropState || cropState.mode !== 'edit') return;
        e.preventDefault();
        try { h.setPointerCapture(e.pointerId); } catch (err) {}
        cropState.drag = idx;
        cropShowMag(cropState.corners[idx].x, cropState.corners[idx].y);
      });
      h.addEventListener('pointermove', function (e) {
        var st = cropState;
        if (!st || st.drag !== idx) return;
        var rect = el('cropCanvas').getBoundingClientRect();
        var x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        var y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        st.corners[idx] = { x: x, y: y };
        cropPlaceHandles(); cropDrawEdit(); cropShowMag(x, y);
      });
      function endDrag() { if (cropState) cropState.drag = null; cropHideMag(); }
      h.addEventListener('pointerup', endDrag);
      h.addEventListener('pointercancel', endDrag);
    })(i);
    el('cropStraighten').addEventListener('click', cropStraighten);
    el('cropScanThis').addEventListener('click', function () {
      if (cropState && cropState.warped) cropFinish(cropState.warped);
    });
    el('cropAdjust').addEventListener('click', function () {
      if (!cropState) return;
      var canvas = el('cropCanvas');
      canvas.width = cropState.off.width; canvas.height = cropState.off.height;
      canvas.style.width = cropState.off.width + 'px'; canvas.style.height = cropState.off.height + 'px';
      cropPlaceHandles(); cropDrawEdit(); cropSetMode('edit');
    });
    el('cropSkipEdit').addEventListener('click', function () { if (cropState) cropFinish(cropState.src); });
    el('cropSkipPreview').addEventListener('click', function () { if (cropState) cropFinish(cropState.src); });
  }

  /* Show the crop screen for one photo; resolves to the canvas to scan:
     the warped image, or the original when skipped / straightening fails.
     The photo itself is never stored — only canvases in memory. */
  function cropStep(srcCanvas) {
    if (cropState) return Promise.resolve(srcCanvas);
    return new Promise(function (resolve) {
      if (!cropWired) { wireCrop(); cropWired = true; }
      hideScan();
      el('cropOverlay').classList.add('open');
      // Open first: the stage measures 0 while the overlay is hidden.
      var canvas = el('cropCanvas');
      var fit = cropFit(srcCanvas.width, srcCanvas.height);
      canvas.width = fit.w; canvas.height = fit.h;
      canvas.style.width = fit.w + 'px'; canvas.style.height = fit.h + 'px';
      var off = document.createElement('canvas');
      off.width = fit.w; off.height = fit.h;
      off.getContext('2d').drawImage(srcCanvas, 0, 0, fit.w, fit.h);
      var iw = fit.w * 0.08, ih = fit.h * 0.08;
      cropState = {
        resolve: resolve, src: srcCanvas, off: off, mode: 'edit', warped: null, drag: null,
        corners: [{ x: iw, y: ih }, { x: fit.w - iw, y: ih },
                  { x: fit.w - iw, y: fit.h - ih }, { x: iw, y: fit.h - ih }]
      };
      cropPlaceHandles(); cropDrawEdit(); cropSetMode('edit');
    });
  }

  function onScanTap() {
    // QR codes only now — the old text reading (OCR) is retired.
    startQrScanner();
  }

  /* ------------------------------------------------------------- QR scanner
   * The entry screen's camera button scans project QR codes. Live camera,
   * full-frame scanning (the corner guides are just a friendly target — a
   * code anywhere in frame scans), auto-capture on detect. A photo upload
   * stays as a fallback for when the camera can't be used. */
  var qrStream = null, qrRaf = null, qrCanvas = null, qrScanning = false;
  var qrPermTimer = null, qrLookTimer = null;
  function clearQrTimers() {
    if (qrPermTimer != null) { clearTimeout(qrPermTimer); qrPermTimer = null; }
    if (qrLookTimer != null) { clearTimeout(qrLookTimer); qrLookTimer = null; }
  }
  function qrOverlayOpen() { return el('qrOverlay').classList.contains('open'); }
  function qrStatus(text) { el('qrStatus').textContent = text; }
  function stopQrScanner() {
    qrScanning = false;
    clearQrTimers();
    if (qrRaf != null) {
      if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(qrRaf);
      else clearTimeout(qrRaf);
      qrRaf = null;
    }
    if (qrStream) {
      qrStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      qrStream = null;
    }
    var v = el('qrVideo');
    if (v) {
      if (typeof v.pause === 'function') { try { v.pause(); } catch (e) {} }
      v.srcObject = null;
    }
    el('qrOverlay').classList.remove('open');
  }
  /** Read a QR code from a canvas 2d context. Returns the text or null. */
  function decodeQrImageData(ctx, w, h) {
    if (typeof jsQR === 'undefined') return null;
    try {
      var img = ctx.getImageData(0, 0, w, h);
      var res = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
      return res ? res.data : null;
    } catch (e) { return null; }
  }
  function qrTick() {
    if (!qrScanning) return;
    var v = el('qrVideo');
    if (v && v.readyState >= 2 && v.videoWidth > 0) {
      if (!qrCanvas) qrCanvas = document.createElement('canvas');
      var scale = Math.min(1, 640 / v.videoWidth);
      qrCanvas.width = Math.round(v.videoWidth * scale);
      qrCanvas.height = Math.round(v.videoHeight * scale);
      var ctx = qrCanvas.getContext('2d');
      ctx.drawImage(v, 0, 0, qrCanvas.width, qrCanvas.height);
      var data = decodeQrImageData(ctx, qrCanvas.width, qrCanvas.height);
      if (data) {
        stopQrScanner();
        handleScannedText(data);
        return;
      }
    }
    qrRaf = (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 200); })(qrTick);
  }
  function startQrScanner() {
    qrStatus('Starting camera…');
    el('qrOverlay').classList.add('open');
    ensureJsQr().then(function (ok) {
      if (!qrOverlayOpen()) return; // cancelled while the reader loaded
      if (!ok) {
        qrStatus('Couldn’t load the QR reader — reload the app and try again, or use a photo instead.');
        return;
      }
      var nav = (typeof navigator !== 'undefined') ? navigator : null;
      if (!nav || !nav.mediaDevices || !nav.mediaDevices.getUserMedia) {
        qrStatus('This device has no camera to use here — use a photo instead.');
        return;
      }
      // The browser asks for camera permission here. The prompt can sit
      // unanswered, so say so plainly — and nudge if it still hasn't
      // answered after a while, instead of silently hanging.
      qrStatus('Waiting for camera permission — allow the camera when asked.');
      qrPermTimer = setTimeout(function () {
        if (qrOverlayOpen() && !qrStream) {
          qrStatus('Still waiting for camera permission — if you don’t see a prompt, tap Cancel and try again.');
        }
      }, 15000);
      nav.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then(function (stream) {
          clearQrTimers();
          if (!qrOverlayOpen()) {
            stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
            return;
          }
          qrStream = stream;
          var v = el('qrVideo');
          v.srcObject = stream;
          if (typeof v.play === 'function') {
            var pr = v.play();
            if (pr && pr.catch) pr.catch(function () {});
          }
          qrStatus('Point the camera at the project QR code');
          qrScanning = true;
          qrLookTimer = setTimeout(function () {
            if (qrScanning && qrOverlayOpen()) {
              qrStatus('Still looking — try moving closer, or hold the phone steady.');
            }
          }, 20000);
          qrRaf = (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 200); })(qrTick);
        })
        .catch(function (err) {
          clearQrTimers();
          if (!qrOverlayOpen()) return;
          var name = err && err.name;
          if (name === 'NotAllowedError' || name === 'SecurityError') {
            qrStatus('Camera access is blocked — allow the camera for this site, or use a photo instead.');
          } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
            qrStatus('No camera was found on this device — use a photo instead.');
          } else {
            qrStatus('The camera couldn’t start — use a photo instead.');
          }
        });
    });
  }
  function onQrPhotoChange(ev) {
    var files = (ev.target && ev.target.files) || [];
    if (!files.length) return;
    var file = files[0];
    ev.target.value = '';
    qrStatus('Reading the photo…');
    ensureJsQr().then(function (ok) {
      if (!qrOverlayOpen()) return;
      if (!ok) {
        qrStatus('Couldn’t load the QR reader — reload the app and try again.');
        return;
      }
      readQrPhoto(file);
    });
  }
  function readQrPhoto(file) {
    if (typeof FileReader === 'undefined' || typeof Image === 'undefined') {
      qrStatus('Photos can’t be read on this device — use the camera instead.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          if (!qrCanvas) qrCanvas = document.createElement('canvas');
          var scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
          qrCanvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          qrCanvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          var ctx = qrCanvas.getContext('2d');
          ctx.drawImage(img, 0, 0, qrCanvas.width, qrCanvas.height);
          var data = decodeQrImageData(ctx, qrCanvas.width, qrCanvas.height);
          stopQrScanner();
          if (data) handleScannedText(data);
          else showQrNoCode();
        } catch (e) {
          stopQrScanner();
          showQrNoCode();
        }
      };
      img.onerror = function () { stopQrScanner(); showQrNoCode(); };
      img.src = reader.result;
    };
    reader.onerror = function () { stopQrScanner(); showQrNoCode(); };
    reader.readAsDataURL(file);
  }
  function showQrNoCode() {
    showModal({
      title: 'No QR code found',
      message: 'There’s no readable project QR code in that photo. Try a clearer photo, or point the camera at the code.',
      buttons: [
        { label: 'Try again', primary: true, onClick: function () { startQrScanner(); } },
        { label: 'Cancel' }
      ]
    });
  }
  /** A QR code was read (camera or photo): validate it and offer the next step. */
  function handleScannedText(text) {
    var res = M.decodeProjectCode(text);
    if (res.error) {
      showModal({
        title: 'Invalid project',
        message: 'This QR code isn’t a JeansMixing project. Error code: ' + res.error +
          ' — send that code to Nova and she’ll take a look.',
        buttons: [
          { label: 'Try again', primary: true, onClick: function () { startQrScanner(); } },
          { label: 'Cancel' }
        ]
      });
      return;
    }
    var total = res.entries.reduce(function (s, e) { return s + e.qty; }, 0);
    var shown = res.entries.slice(0, 8).map(function (e) { return M.prettySize(e); });
    if (res.entries.length > 8) shown.push('and ' + (res.entries.length - 8) + ' more');
    showModal({
      title: 'Project scanned!',
      message: res.entries.length + ' sizes, ' + total + ' pairs: ' + shown.join(', ') + '.',
      buttons: [
        { label: 'Create project', primary: true, onClick: function () { createScannedProject(res.entries); } },
        { label: 'Retry', onClick: function () { startQrScanner(); } }
      ]
    });
  }
  /** A scanned project starts fresh and unlocked, at the review screen so
      the sizes can be checked before locking. */
  function createScannedProject(entries) {
    var name = M.Store.uniqueName(projects, M.projectDisplayName(new Date()));
    var p = M.Store.blankProject(name);
    p.mode = 'regular';
    p.pairsPerBox = settings.pairsPerBox;
    p.flippingEnabled = settings.flippingEnabled;
    p.bundles = cloneBundles(settings.bundles);
    p.entries = entries.map(function (e) {
      return e.anySize
        ? { waist: 'Any Size', length: '', qty: e.qty, anySize: true }
        : { waist: e.waist, length: e.length, qty: e.qty };
    });
    projects.push(p);
    ui.activeId = p.id;
    persist();
    showReview();
  }

  function showScanChooser() {
    showModal({
      title: 'Scan sizes',
      message: 'Take a photo of one page of the printed sheet, or choose photos. ' +
        'After each photo you place four corner dots on the sheet and see ' +
        'the straightened page before it is read. ' +
        'You can add more pages after each scan. ' +
        'Photos are read on this phone and discarded right after \u2014 nothing is saved or uploaded.',
      buttons: [
        { label: 'Take photo', primary: true, onClick: function () { pickScanFile(true); } },
        { label: 'Choose photo', onClick: function () { pickScanFile(false); } },
        { label: 'Cancel' }
      ]
    });
  }

  function pickScanFile(useCamera) {
    if (!scanInputs) {
      scanInputs = {};
      [true, false].forEach(function (cam) {
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        if (cam) inp.setAttribute('capture', 'environment');
        else inp.multiple = true; // one upload may cover several pages at once
        inp.style.display = 'none';
        inp.addEventListener('change', function () {
          var files = [];
          for (var i = 0; i < (inp.files || []).length; i++) files.push(inp.files[i]);
          inp.value = '';
          if (files.length) handleScanFiles(files);
        });
        document.body.appendChild(inp);
        scanInputs[cam ? 'camera' : 'file'] = inp;
      });
    }
    scanInputs[useCamera ? 'camera' : 'file'].click();
  }

  /* Shrink the photo before OCR: faster, less memory, and plenty of
     resolution left for big printed digits. (Measured on alex's real
     sheet photos: upscaling and contrast lifts both read WORSE than
     the plain photo, so no pixel cleanup is done here.) */
  function downscaleImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var max = 2200, w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * scale));
        cv.height = Math.max(1, Math.round(h * scale));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  function runScan(canvas, label) {
    showScan('Loading text reader…', 0);
    function recognize() { return scanWorker.recognize(canvas); }
    if (scanWorker) return recognize();
    return ensureScanLib().then(function () {
      return window.Tesseract.createWorker('eng', 1, {
        logger: function (m) {
          if (m.status === 'recognizing text') {
            showScan(label + ' ' + Math.round((m.progress || 0) * 100) + '%', Math.round((m.progress || 0) * 100));
          } else {
            showScan('Loading text reader…', 0);
          }
        }
      });
    }).then(function (w) {
      scanWorker = w;
      return recognize();
    });
  }

  /* Scan one or more photos in order (a camera capture is always one; an
     upload may select several pages at once). Pages accumulate in
     scanPages until alex reviews them, so a two-page sheet becomes one
     list. A failed photo keeps the pages already scanned. */
  function handleScanFiles(files) {
    if (!files.length) return;
    if (!window.ScanParse) {
      toast('Scanner is not loaded \u2014 reload the app and try again');
      return;
    }
    showScan('Preparing photo…', 0);
    var chain = Promise.resolve();
    files.forEach(function (file, idx) {
      chain = chain.then(function () {
        if (!file.type || file.type.indexOf('image/') !== 0) {
          throw new Error('not an image');
        }
        showScan('Preparing photo…', 0);
        return downscaleImage(file).then(function (canvas) {
          // Every photo, camera or upload, goes through the corner crop
          // first: alex places the four dots, sees the straightened page,
          // and only then does the reader run.
          return cropStep(canvas);
        }).then(function (canvas) {
          var label = files.length === 1 ? 'Reading your sheet'
            : 'Reading page ' + (idx + 1) + ' of ' + files.length;
          return runScan(canvas, label);
        }).then(function (result) {
          // The file, canvas and OCR result go out of scope here: discarded.
          // Pages store raw lines; the template runs once over ALL pages
          // combined, so core sizes are only flagged missing after every
          // page has been read.
          var data = result.data || {};
          if (data.words && data.words.length) {
            var words = data.words.map(function (w) {
              var b = w.bbox || {};
              return { text: w.text, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
            });
            scanPages.push(window.ScanParse.groupWords(words));
          } else {
            scanPages.push(String(data.text || '').split(/\n/));
          }
        });
      });
    });
    chain.then(function () {
      hideScan();
      showPageModal();
    }).catch(function () {
      hideScan();
      if (scanWorker) {
        try { scanWorker.terminate(); } catch (e) {}
        scanWorker = null;
      }
      showModal({
        title: 'Scan failed',
        message: 'Could not read that photo. The first scan needs an internet ' +
          'connection (to download the text reader), and a clear, straight ' +
          'photo of the printed sheet works best.',
        buttons: [{
          label: 'OK', primary: true, onClick: function () {
            if (scanPages.length) { showPageModal(); return false; }
          }
        }]
      });
    });
  }

  /* Between pages: running totals plus the choice to add another page,
     review what is scanned so far, or drop the whole session. */
  function showPageModal() {
    var allLines = [];
    scanPages.forEach(function (lines) { allLines = allLines.concat(lines); });
    var merged = window.ScanParse.parseTemplateLines(allLines);
    var rows = merged.rows || [];
    var ok = rows.filter(function (r) { return !r.flag; }).length;
    var bad = rows.length - ok;
    showModal({
      title: 'Scanned so far',
      message: ok + ' sizes found' + (bad ? ', ' + bad + ' row' + (bad === 1 ? '' : 's') + ' need attention' : '') +
        '. You can scan another page or review the list.',
      buttons: [
        // importScan returns true when it opened its own modal (which the
        // auto-close must not kill) and false when it navigated to review.
        { label: 'Review sizes', primary: true, onClick: function () { return importScan(merged) ? false : undefined; } },
        { label: 'Scan another page', onClick: function () { showScanChooser(); return false; } },
        { label: 'Cancel scan', onClick: function () { scanPages = []; } }
      ]
    });
  }

  /* Scanned rows land on the regular review screen, in grid order.
     Flagged rows become entries alex fixes or deletes; missing core
     sizes arrive with their size pre-filled, so only the quantity needs
     typing. Confirm refuses while any flagged row remains.
     Returns true when a modal was opened (the caller must not auto-close
     it) and false when it navigated straight to the review screen. */
  function importScan(parsed) {
    var p = activeProject();
    if (!p || p.locked) return false;
    var rows = parsed.rows || [];
    var ok = rows.filter(function (r) { return !r.flag; }).length;
    var bad = rows.length - ok;
    if (rows.length === 0) {
      showModal({
        title: 'Nothing found',
        message: 'No size rows were found in that photo. Try a clearer, straighter photo of the printed sheet.',
        buttons: [{ label: 'OK', primary: true }]
      });
      return true;
    }
    function doImport() {
      p.entries = rows.map(function (r) {
        if (r.flag) {
          return { waist: r.waist || '', length: r.length || '', qty: 0, scanFlag: { raw: r.raw, reason: r.flag } };
        }
        return { waist: r.waist, length: r.length, qty: r.qty };
      });
      p.entryDraft = null;
      entry = null;
      persist();
      showReview();
      if (bad > 0) {
        toast('Scanned ' + ok + ' sizes \u2014 ' + bad + ' row' + (bad === 1 ? '' : 's') + ' need attention');
      } else {
        toast('Scanned ' + ok + ' sizes \u2014 check them over');
      }
    }
    if (p.entries.length > 0) {
      showModal({
        title: 'Replace sizes?',
        message: 'This project already has ' + p.entries.length + ' sizes. Replace them with the scanned list?',
        rowButtons: true,
        buttons: [
          { label: 'Replace', primary: true, onClick: doImport },
          { label: 'Cancel' }
        ]
      });
      return true;
    } else {
      doImport();
      return false;
    }
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
      var live = M.effectiveQty(p, pos);
      q.textContent = live;
      // The list shows the LIVE count (matching the placing screens); when
      // a transfer changed it, the original sits next to it, struck through.
      // A shortfall counts too: the short size's qty is never rewritten,
      // so the rolled-out pairs come off here, or it would show pairs
      // that don't exist.
      if (e.origQty != null && e.origQty > 0 && live !== e.origQty) {
        var orig = document.createElement('span');
        orig.className = 'qorig';
        orig.textContent = e.origQty;
        q.appendChild(document.createTextNode(' '));
        q.appendChild(orig);
      }
      row.appendChild(sz);
      row.appendChild(q);
      rows.appendChild(row);
    });
    // The bottom line is frozen at the locked total: a rollover grows a
    // size's count but never the order total (or the box count).
    var total = origTotal(p);
    var cap = (p.pairsPerBox > 0) ? p.pairsPerBox : M.BOX_CAPACITY;
    el('lockedTotal').textContent = total + ' pairs \u2192 ' + (total / cap) + ' boxes';

    // Per-box contents live under the ☰ Boxes menu once placing begins.
  }

  /* ---------------------------------------------------------------- placing */
  var current = 0;

  /** Review a finished pull: the placing screen, read-only — every size,
      its history and its boxes, no edits, no undo. */
  var reviewing = false;
  function showPlacingReview() {
    var p = activeProject();
    if (!p) return;
    reviewing = true;
    current = 0;
    renderPlacing();
    show('placing');
  }

  function showPlacing() {
    var p = activeProject();
    if (!p || !p.locked) return showProjects();
    reviewing = false;
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
    // A confirmed shortfall (done but under) renders the whole line RED with
    // "(0 left)". A "y" changed by a transfer renders GREEN (just the digit)
    // in every branch — green wins over the inherited red inside .short.
    var left = Math.max(0, needed - placed);
    var pv = el('placedView');
    pv.innerHTML = '';
    var yChanged = e.origQty != null && needed !== e.origQty;
    function yNode() {
      if (!yChanged) return document.createTextNode(String(needed));
      var ys = document.createElement('span');
      ys.className = 'yadj';
      ys.textContent = String(needed);
      return ys;
    }
    if (placed > needed) {
      var s = document.createElement('span');
      s.className = 'over';
      s.textContent = placed;
      pv.appendChild(s);
      pv.appendChild(document.createTextNode(' out of '));
      pv.appendChild(yNode());
      pv.appendChild(document.createTextNode(' placed (' + left + ' left)'));
    } else if (placed < needed && p.doneSizes.indexOf(current) >= 0) {
      var ss = document.createElement('span');
      ss.className = 'short';
      ss.appendChild(document.createTextNode(placed + ' out of '));
      ss.appendChild(yNode());
      ss.appendChild(document.createTextNode(' placed (0 left)'));
      pv.appendChild(ss);
    } else {
      pv.appendChild(document.createTextNode(placed + ' out of '));
      pv.appendChild(yNode());
      pv.appendChild(document.createTextNode(' placed (' + left + ' left)'));
    }

    // Bundle/layer slot of the upcoming placement (next box in line).
    var inNext = r.boxCounts[r.nextBox];
    var boxNo = r.nextBox + 1;
    // Progress so far, floored against the frozen original total — 100%
    // only when the last pair is placed (e.g. 75 of 750 reads "(10%)").
    var placedTotal = r.placedPerSize.reduce(function (a, b) { return a + b; }, 0);
    var pctTxt = ' (' + Math.floor(placedTotal / Math.max(1, origTotal(p)) * 100) + '%)';
    var blv = el('bundleLayerView');
    var pFlip = projectFlip(p), pBundles = projectBundles(p);
    var fc = el('flipCue');
    // Preview mode: looking ahead at a size past the first unfinished one.
    // The flip cue's reserved space shows "(preview)" instead — no layout shift.
    if (current > firstOpenSize(p)) {
      blv.textContent = 'layer ' + (inNext + 1) + ', box ' + boxNo + pctTxt;
      fc.textContent = '(preview)';
      fc.style.visibility = 'visible';
    } else if (!pFlip) {
      blv.textContent = 'layer ' + (inNext + 1) + ', box ' + boxNo + pctTxt;
      fc.textContent = '\uD83D\uDD04 flip after this pair';
      fc.style.visibility = 'hidden';
    } else {
      var slot = bundleSlot(inNext, pBundles);
      fc.textContent = '\uD83D\uDD04 flip after this pair';
      if (!slot) {
        blv.textContent = 'layer ' + (inNext + 1) + ', box ' + boxNo + pctTxt;
        fc.style.visibility = 'hidden';
      } else {
        blv.textContent = (slot.layers === 1
          ? slot.name + ', box ' + boxNo
          : slot.name + ', layer ' + slot.layer + ', box ' + boxNo) + pctTxt;
        fc.style.visibility = (slot.lastLayer && !slot.isLast) ? 'visible' : 'hidden';
      }
    }

    renderQuickAdds(reviewing ? false : placed < needed);
    // Undo stays enabled while anything affecting this size can be reverted
    // — including a transfer into it, even at 0 placed (e.g. a fresh
    // Any Size whose creation is the thing to undo).
    setEnabled(el('placeUndo'), reviewing ? false : findUndoIndex(p) >= 0);
    setEnabled(el('placeLeft'), current > 0);
    setEnabled(el('placeRight'), current < p.entries.length - 1);
    // Review mode: the placing screen is read-only — Done, stapling and
    // Reset are hidden outright (their handlers guard too), and Back goes
    // to the done screen instead of the project.
    el('placeDone').style.display = reviewing ? 'none' : '';
    el('staplingBtn').style.display = reviewing ? 'none' : '';
    el('resetPlacingBtn').style.display = reviewing ? 'none' : '';
    el('placingBack').textContent = reviewing ? '\u2190 Back' : '\u2190 Project';

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
    // Frozen denominator: a rollover moves a pair between sizes, it never
    // adds one — so the end total stays e.g. 100/100, never 100/101.
    var sumQty = origTotal(p);
    el('completeTotal').textContent = sumPlaced + ' / ' + sumQty + ' pairs placed';
    // Leaderboard score: recorded once per project, from the placing log
    // (first pair to last pair, minus the set-and-forget breaks).
    var rec = p.scoreId ? null : recordScore(p);
    var entry = rec ? rec.entry : null;
    if (!entry && p.scoreId) {
      entry = loadLeaderboard().filter(function (s) { return s.id === p.scoreId; })[0] || null;
    }
    var rateEl = el('completeRate');
    if (entry) {
      rateEl.textContent = entry.rate.toFixed(2) + ' jeans/min • ' + fmtDuration(entry.minutes);
      rateEl.style.display = '';
    } else {
      rateEl.style.display = 'none';
    }
    if (rec && rec.madeTop10) {
      showModal({
        title: 'New leaderboard score!',
        message: 'You placed ' + rec.entry.rate.toFixed(2) + ' jeans/min — that\'s #' + rec.rank + ' on the leaderboard!',
        buttons: [
          { label: 'View leaderboard', primary: true, onClick: function () { showLeaderboard('complete'); } },
          { label: 'Nice' }
        ]
      });
    }
  }

  /** Break rows: two time inputs per range + delete. Shared by the Settings
      list (commit = saveSettings) and the per-pull editor (commit = noop —
      Save assigns the edited list). */
  function renderBreakRowsInto(wrap, list, commit) {
    wrap.innerHTML = '';
    if (!list.length) {
      var none = document.createElement('div');
      none.className = 'sub';
      none.textContent = 'No breaks — the score uses the full pull time.';
      wrap.appendChild(none);
    }
    list.forEach(function (b, i) {
      var row = document.createElement('div');
      row.className = 'set-row';
      var s = document.createElement('input');
      s.type = 'time'; s.value = b.start;
      s.addEventListener('change', function () {
        setBreakIn(list, i, 'start', s.value, commit, function () {
          renderBreakRowsInto(wrap, list, commit);
        });
      });
      var dash = document.createElement('div');
      dash.textContent = '–';
      var e = document.createElement('input');
      e.type = 'time'; e.value = b.end;
      e.addEventListener('change', function () {
        setBreakIn(list, i, 'end', e.value, commit, function () {
          renderBreakRowsInto(wrap, list, commit);
        });
      });
      var del = document.createElement('button');
      del.className = 'del danger';
      del.textContent = '✕';
      del.onclick = function () {
        list.splice(i, 1);
        commit();
        renderBreakRowsInto(wrap, list, commit);
      };
      row.appendChild(s);
      row.appendChild(dash);
      row.appendChild(e);
      row.appendChild(del);
      wrap.appendChild(row);
    });
  }
  function setBreakIn(list, i, which, v, commit, rerender) {
    var b = list[i];
    if (!b || !/^\d{2}:\d{2}$/.test(v || '')) { rerender(); return; }
    var old = b[which];
    b[which] = v;
    if (toMins(b.end) <= toMins(b.start)) {
      b[which] = old;
      rerender();
      toast('A break has to end after it starts');
      return;
    }
    commit();
  }
  function renderBreakRows() {
    renderBreakRowsInto(el('breakList'), settings.breaks, saveSettings);
  }

  /* ------------------------------------------------------- leaderboard view */
  var leaderboardReturn = 'settings';
  function showLeaderboard(returnTo) {
    leaderboardReturn = returnTo || 'settings';
    renderLeaderboard();
    show('leaderboard');
  }
  function renderLeaderboard() {
    var rows = el('leaderboardRows');
    rows.innerHTML = '';
    var list = loadLeaderboard();
    if (!list.length) {
      var d = document.createElement('div');
      d.className = 'sub';
      d.textContent = 'No scores yet — finish a regular pull to set your first time!';
      rows.appendChild(d);
      return;
    }
    // Highlight the most recent score (the one that just landed).
    var newest = list.reduce(function (a, b) { return b.date > a.date ? b : a; }, list[0]);
    list.forEach(function (s, i) {
      var row = document.createElement('div');
      row.className = 'trow' + (i % 2 === 1 ? ' alt' : '') + (s.id === newest.id ? ' lb-new' : '');
      var main = document.createElement('div');
      var r = document.createElement('div');
      r.className = 'sz';
      r.textContent = '#' + (i + 1) + '  ' + s.rate.toFixed(2) + ' jeans/min';
      var sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = M.projectDisplayName(new Date(s.date)) + ' • ' + s.pairs + ' pairs';
      main.appendChild(r);
      main.appendChild(sub);
      var del = document.createElement('button');
      del.className = 'del danger';
      del.textContent = '✕';
      del.onclick = function (ev) {
        ev.stopPropagation();
        showModal({
          title: 'Delete score?',
          message: 'Delete this ' + s.rate.toFixed(2) + ' jeans/min score from ' + M.projectDisplayName(new Date(s.date)) + '?',
          rowButtons: true,
          buttons: [
            {
              label: 'Delete', danger: true, onClick: function () {
                saveLeaderboard(loadLeaderboard().filter(function (x) { return x.id !== s.id; }));
                renderLeaderboard();
              }
            },
            { label: 'Cancel' }
          ]
        });
      };
      row.appendChild(main);
      row.appendChild(del);
      rows.appendChild(row);
    });
  }

  /** Share app: a fullscreen QR code that opens the site straight away. */
  function showSharePopup() {
    showModal({
      title: 'Share JeansMixing',
      htmlMessage: '<div class="qr-wrap"><img src="assets/share-qr.png?v=web-' + APP_VERSION +
        '" alt="QR code — scan to open JeansMixing"></div>' +
        '<div class="msg">Scan the code to open the app, then install it from your browser if you want it on your home screen.</div>',
      buttons: [{ label: 'Close', primary: true }]
    });
    el('modalBox').classList.add('qr-full');
  }

  /* ------------------------------------------------------------ QR libraries
   * The QR maker (qrcode-generator) and reader (jsQR) are bundled in the
   * app itself (js/qrcode.min.js, js/jsQR.min.js — small, MIT, no
   * dependencies) and on the service worker's precache list, so an app
   * update installs them. At scan time they load from the local cache —
   * no internet needed, and a stalled download can never leave the
   * scanner hanging the way the old CDN load did. */
  var QR_GEN_SRC = 'js/qrcode.min.js?v=web-v' + APP_VERSION;
  var QR_READ_SRC = 'js/jsQR.min.js?v=web-v' + APP_VERSION;
  var scriptCache = {};
  function loadScript(src, timeoutMs) {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { finish(true); };
      s.onerror = function () { finish(false); };
      setTimeout(function () { finish(false); }, timeoutMs || 10000);
      document.body.appendChild(s);
    });
    return scriptCache[src];
  }
  function ensureQrGen() {
    if (typeof qrcode !== 'undefined') return Promise.resolve(true);
    return loadScript(QR_GEN_SRC).then(function (ok) {
      return ok && typeof qrcode !== 'undefined';
    });
  }
  function ensureJsQr() {
    if (typeof jsQR !== 'undefined') return Promise.resolve(true);
    return loadScript(QR_READ_SRC).then(function (ok) {
      return ok && typeof jsQR !== 'undefined';
    });
  }

  /** Share project: a fullscreen QR code carrying this project's sizes and
      quantities, so another phone can scan it and copy the project. */
  function showShareProject(p) {
    var code = M.encodeProjectCode(p);
    var total = p.entries.reduce(function (s, e) { return s + e.qty; }, 0);
    showModal({
      title: 'Share project',
      message: p.entries.length + ' sizes, ' + total + ' pairs — scan it from another phone to copy this project.',
      buttons: [{ label: 'Close', primary: true }]
    });
    el('modalBox').classList.add('qr-full');
    var box = el('modalBox');
    var wrap = document.createElement('div');
    wrap.className = 'qr-wrap';
    var wait = document.createElement('div');
    wait.className = 'msg';
    wait.textContent = 'Generating the QR code…';
    wrap.appendChild(wait);
    var btns = box.querySelector('.mbtns');
    if (btns) box.insertBefore(wrap, btns);
    else box.appendChild(wrap);
    if (code.length > 2300) {
      wait.textContent = 'Too many sizes to fit in one QR code — split the project up first.';
      return;
    }
    ensureQrGen().then(function (ok) {
      if (!ok) {
        wait.textContent = 'Couldn’t load the QR maker — check your connection and try again.';
        return;
      }
      try {
        var qr = qrcode(0, 'M');
        qr.addData(code);
        qr.make();
        var img = document.createElement('img');
        img.src = qr.createDataURL(6, 8);
        img.alt = 'QR code for ' + p.name;
        wrap.innerHTML = '';
        wrap.appendChild(img);
      } catch (e) {
        wait.textContent = 'Couldn’t make the QR code — this project is too big to fit in one.';
      }
    });
  }

  /** Per-pull breaks: show this pull's breaks (its own, else the global
      schedule) and let him adjust them — skipped a break, took longer or
      shorter — then re-score the pull. */
  function showProjectBreaks(p) {    var editing = projectBreaks(p).map(function (b) {
      return { start: b.start, end: b.end };
    });
    showModal({
      title: 'Breaks for this pull',
      message: 'Adjust the breaks for this pull only — the score updates to match. Leave it empty if you skipped your breaks.',
      buttons: [
        {
          label: 'Save', primary: true, onClick: function () {
            p.breaks = editing;
            persist();
            refreshScore(p);
          }
        },
        { label: 'Cancel' }
      ]
    });
    var box = el('modalBox');
    var wrap = document.createElement('div');
    renderBreakRowsInto(wrap, editing, function () {});
    var btns = box.querySelector('.mbtns');
    if (btns) box.insertBefore(wrap, btns);
    else box.appendChild(wrap);
    var add = document.createElement('button');
    add.textContent = '+ Add break';
    add.onclick = function () {
      if (editing.length >= 6) { toast('Six breaks is plenty for one day'); return; }
      editing.push({ start: '12:00', end: '12:15' });
      renderBreakRowsInto(wrap, editing, function () {});
    };
    if (btns) box.insertBefore(add, btns);
    else box.appendChild(add);
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

  /** Find a button inside the open modal by its label prefix. */
  function findModalButton(prefix) {
    var found = null;
    (function walk(node) {
      (node.children || []).forEach(function (c) {
        if ((c.tagName || '').toLowerCase() === 'button' &&
            c.textContent.indexOf(prefix) === 0) found = c;
        walk(c);
      });
    })(el('modalBox'));
    return found;
  }
  /**
   * Placing on a size ahead of the first unfinished one: warn first.
   * Override is locked for 5 seconds (countdown on the button) because
   * it's almost never the right move.
   */
  function warnAhead(n) {
    var p = activeProject();
    showModal({
      title: 'Too far ahead?',
      message: 'There are unfinished sizes before ' + M.prettySize(p.entries[current]) +
        '. Placing here might be a mistake.',
      buttons: [
        {
          label: 'Go to current size', primary: true, onClick: function () {
            current = firstOpenSize(p); saveCurrent(); renderPlacing();
          }
        },
        {
          label: 'Override', onClick: function () {
            p.aheadOk = p.aheadOk || {};
            p.aheadOk[current] = true;
            persist();
            onAdd(n);
          }
        },
        { label: 'Cancel' }
      ]
    });
    var btn = findModalButton('Override');
    if (!btn) return;
    btn.disabled = true;
    var left = 5;
    btn.textContent = 'Override (' + left + ')';
    var iv = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(iv);
        btn.disabled = false;
        btn.textContent = 'Override';
      } else {
        btn.textContent = 'Override (' + left + ')';
      }
    }, 1000);
  }
  function onAdd(n) {
    if (reviewing) return;
    var p = activeProject();
    if (current > firstOpenSize(p) && !(p.aheadOk && p.aheadOk[current])) {
      warnAhead(n);
      return;
    }
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
  /** Most recent log entry affecting the viewed size — a placement on it,
      a transfer INTO it, or the creation of it (Any Size). A transfer's
      event belongs to its SOURCE size, so without the middle match an Undo
      pressed on the receiving size would eat one of its real placements
      instead and leave the transfer stranded. -1 when nothing to undo. */
  function findUndoIndex(p) {
    for (var i = p.placingEvents.length - 1; i >= 0; i--) {
      var ev = p.placingEvents[i];
      if (ev.size === current ||
          (ev.qtyTransfer && ev.qtyTransfer.idx === current) ||
          (ev.anySizeCreated != null && ev.anySizeCreated === current)) return i;
    }
    return -1;
  }

  function onUndo() {
    if (reviewing) return;
    var p = activeProject();
    var idx = findUndoIndex(p);
    if (idx < 0) return;
    var removed = p.placingEvents.splice(idx, 1)[0];
    if (removed.qtyTransfer) {
      // Undoing a Done: revert the quantity transfer into the next size AND
      // reopen the size it came from, so the pair of changes can never drift
      // apart. The SOURCE size reopens — which may not be the viewed one.
      var tr = removed.qtyTransfer;
      var beforeQty = p.entries[tr.idx].qty;
      p.entries[tr.idx].qty -= tr.delta;
      p.doneSizes = p.doneSizes.filter(function (i) { return i !== removed.size; });
      if (p.shortOk) delete p.shortOk[removed.size];
      p.timeline.push({ size: removed.size, t: Date.now(),
        text: 'undo transfer (' + M.prettySize(p.entries[tr.idx]) + ' back to ' +
          p.entries[tr.idx].qty + ')' });
      p.timeline.push({ size: tr.idx, t: Date.now(),
        text: 'changed total count from ' + beforeQty + ' back to ' + p.entries[tr.idx].qty });
    } else if (removed.anySizeCreated != null) {
      // Undoing a shortfall that created the Any Size catch-all: remove the
      // size itself and reopen the size the shortfall came from.
      var createdIdx = removed.anySizeCreated;
      if (p.entries[createdIdx] && p.entries[createdIdx].anySize) {
        p.entries.splice(createdIdx, 1);
      }
      p.doneSizes = p.doneSizes.filter(function (i) {
        return i !== removed.size && i !== createdIdx;
      });
      if (p.shortOk) delete p.shortOk[removed.size];
      if (current === createdIdx) { current = removed.size; saveCurrent(); }
      p.timeline.push({ size: removed.size, t: Date.now(),
        text: 'undo transfer (Any Size removed)' });
    } else {
      // Name the box the dealing has stepped back to: the box holding the
      // most recent remaining pair (the undone pair's predecessor).
      var rr = M.replay(p), nb = M.boxes(p), boxTxt = '';
      if (nb > 0) boxTxt = ', now at box ' + (((rr.nextBox - 1) % nb + nb) % nb + 1);
      p.timeline.push({ size: current, t: Date.now(),
        text: 'undo +' + removed.count + boxTxt });
      syncDone(p);
    }
    persist();
    renderPlacing();
  }

  function onArrow(dir) {
    var p = activeProject();
    var next = Math.max(0, Math.min(p.entries.length - 1, current + dir));
    if (next !== current) {
      current = next;
      // Reviewing leaves no trace — don't move the saved placing position.
      if (!reviewing) saveCurrent();
      renderPlacing();
    }
  }

  /** A size whose placed < needed is never "done" (e.g. after undo/edit). */
  function syncDone(p) {
    var r = M.replay(p);
    p.doneSizes = p.doneSizes.filter(function (i) {
      return r.placedPerSize[i] >= p.entries[i].qty || (p.shortOk && p.shortOk[i]);
    });
  }

  /** Original total, frozen at lock (origQty). Any Size pairs are part of
      that original total, so they contribute 0 — the denominator never grows. */
  function origTotal(p) {
    return p.entries.reduce(function (s, e) {
      return s + (e.origQty != null ? e.origQty : e.qty);
    }, 0);
  }

  /** First unfinished size after idx (finished sizes are never touched by
      a transfer); -1 when every size after it is finished. */
  function nextUnfinishedAfter(p, idx) {
    for (var i = idx + 1; i < p.entries.length; i++) {
      if (p.doneSizes.indexOf(i) < 0) return i;
    }
    return -1;
  }

  /** Pairs already transferred out of a size, split by direction, from its
      count:0 qtyTransfer events. Lets Done offer only what's still unmoved,
      so pressing Done twice can never transfer the same pair twice. */
  /** The existing Any Size catch-all entry, or -1. */
  function anySizeIndex(p) {
    for (var i = 0; i < p.entries.length; i++) {
      if (p.entries[i].anySize) return i;
    }
    return -1;
  }

  /** Where a shortfall from idx can go: the first unfinished size after it,
      the existing Any Size catch-all (never idx itself), a brand-new Any
      Size, or nowhere (idx IS the Any Size — its pairs have no home). */
  function shortfallDestination(p, idx) {
    var target = nextUnfinishedAfter(p, idx);
    if (target >= 0) return { kind: 'size', idx: target };
    var anyIdx = anySizeIndex(p);
    if (anyIdx >= 0 && anyIdx !== idx) return { kind: 'size', idx: anyIdx };
    if (!p.entries[idx].anySize) return { kind: 'create' };
    return { kind: 'none' };
  }

  /** Apply a transfer: the target's qty moves by delta, recorded as a
      count:0 qtyTransfer event in the placing log (replay ignores it) so
      Undo can revert it exactly. History lives on the receiving size. */
  function applyTransfer(p, fromIdx, targetIdx, delta) {
    var oldQty = p.entries[targetIdx].qty;
    p.entries[targetIdx].qty += delta;
    p.placingEvents.push({ size: fromIdx, count: 0, t: Date.now(),
      qtyTransfer: { idx: targetIdx, delta: delta } });
    p.timeline.push({ size: targetIdx, t: Date.now(),
      text: 'changed total count from ' + oldQty + ' to ' + p.entries[targetIdx].qty });
  }

  /** On Done, carry the box forward: if the size we're moving to has no
      history yet, forward the previous size's latest placement as time +
      box only (no +N) — so the fresh size shows where he left off. */
  function forwardHistory(p, fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= p.entries.length) return;
    var hasAny = p.timeline.some(function (t) { return t.size === toIdx; });
    if (hasAny) return;
    for (var i = p.timeline.length - 1; i >= 0; i--) {
      var t = p.timeline[i];
      if (t.size !== fromIdx) continue;
      var m = /Box (\d+)/.exec(t.text);
      if (m) {
        p.timeline.push({ size: toIdx, t: t.t, text: 'Box ' + m[1] });
        return;
      }
    }
  }

  /* ------------------------------------------------------- leaderboard
   * Jeans-per-minute scores for finished regular pulls. Stored on their
   * own key, separate from the projects — deleting a project never deletes
   * its scores. Breaks are scoring-only: they subtract from the pull's
   * time, never from the placing itself. */
  var LEADERBOARD_KEY = 'jmw.leaderboard.v1';
  function loadLeaderboard() {
    try {
      var v = JSON.parse(localStorage.getItem(LEADERBOARD_KEY));
      if (!Array.isArray(v)) return [];
      return v.filter(function (s) {
        return s && typeof s.rate === 'number' && typeof s.pairs === 'number';
      });
    } catch (e) { return []; }
  }
  function saveLeaderboard(list) {
    try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list)); } catch (e) {}
  }
  /** First/last pair placed, from the placing log (bulk sets count too;
      transfer records have count 0, so they never count as placements). */
  function pullTiming(p) {
    var first = null, last = null, pairs = 0;
    p.placingEvents.forEach(function (e) {
      if (!e || e.count <= 0) return;
      pairs += e.count;
      if (first == null || e.t < first) first = e.t;
      if (last == null || e.t > last) last = e.t;
    });
    if (first == null || pairs <= 0) return null;
    return { first: first, last: last, pairs: pairs };
  }
  /** Break minutes overlapping a pull window, from the set-and-forget
      schedule (mapped onto the pull's date; only the overlapping part of
      each range counts). */
  function breakOverlapMinutes(first, last, breaks) {
    var d = new Date(first);
    var dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var total = 0;
    (breaks || []).forEach(function (b) {
      var bs = dayStart + toMins(b.start) * 60000;
      var be = dayStart + toMins(b.end) * 60000;
      total += Math.max(0, Math.min(last, be) - Math.max(first, bs)) / 60000;
    });
    return total;
  }
  /** "2h 35m" / "1h" / "45m". */
  function fmtDuration(mins) {
    var m = Math.round(mins);
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  }
  /** Breaks that count for one pull: the project's own (set from the done
      screen's Breaks button) when it has them, else the global schedule. */
  function projectBreaks(p) {
    return (p && Array.isArray(p.breaks)) ? p.breaks : settings.breaks;
  }
  /** Jeans-per-minute for a finished regular pull, or null when the time
      can't be measured (no placements, or the breaks ate the whole pull). */
  function pullScore(p) {
    var tm = pullTiming(p);
    if (!tm) return null;
    var gross = (tm.last - tm.first) / 60000;
    var net = gross - breakOverlapMinutes(tm.first, tm.last, projectBreaks(p));
    if (net <= 0) return null;
    return {
      rate: Math.round(tm.pairs / net * 100) / 100,
      pairs: tm.pairs,
      minutes: Math.round(net * 10) / 10,
      date: tm.last
    };
  }
  /** Record a pull's score once (never twice for the same project), keep
      the top 10 by rate. Returns {entry, madeTop10, rank} or null. */
  function recordScore(p) {
    if (p.scoreId) return null;
    var s = pullScore(p);
    if (!s) return null;
    var list = loadLeaderboard();
    var entry = {
      id: 's' + Date.now() + '_' + Math.floor(Math.random() * 100000),
      projectId: p.id, rate: s.rate, pairs: s.pairs, minutes: s.minutes, date: s.date
    };
    list.push(entry);
    list.sort(function (a, b) { return b.rate - a.rate; });
    var rank = list.indexOf(entry) + 1;
    var madeTop10 = rank >= 1 && rank <= 10;
    list = list.slice(0, 10);
    saveLeaderboard(list);
    p.scoreId = entry.id;
    persist();
    return { entry: entry, madeTop10: madeTop10, rank: rank };
  }
  /** Re-score a finished pull after its breaks changed: update its
      leaderboard entry in place, re-sort, keep the top 10. A score that
      falls out of the top 10 loses its listed entry (the rate line hides,
      and recordScore won't resurrect it while scoreId is set). */
  function refreshScore(p) {
    var s = pullScore(p);
    var list = loadLeaderboard();
    var entry = null;
    list.forEach(function (x) { if (x.id === p.scoreId) entry = x; });
    if (!s) {
      if (entry) saveLeaderboard(list.filter(function (x) { return x !== entry; }));
      p.scoreId = null;
    } else if (entry) {
      entry.rate = s.rate; entry.pairs = s.pairs; entry.minutes = s.minutes;
      list.sort(function (a, b) { return b.rate - a.rate; });
      saveLeaderboard(list.slice(0, 10));
    } else if (!p.scoreId) {
      // No score yet — removing breaks can make an unmeasurable pull
      // measurable, so try recording fresh.
      recordScore(p);
    }
    // else: the score was deleted from the leaderboard on purpose — leave
    // it deleted.
    persist();
    renderComplete(p);
  }

  /** Surgically removes a size's K most recent placements from the log. */
  function removePlacements(p, sizeIdx, k) {
    var remaining = k;
    for (var i = p.placingEvents.length - 1; i >= 0 && remaining > 0; i--) {
      var e = p.placingEvents[i];
      // qtyTransfer records are not placements: never consume or drop them —
      // only an explicit Undo on their size reverts them.
      if (e.size === sizeIdx && !e.qtyTransfer) {
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
    if (reviewing) return;
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
            return applyManualEdit(Math.max(0, v));
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
    // Correcting a FINISHED size past its total: offer the transfer right
    // here. The Done press it used to wait for may never come — the count
    // popup's OK is the whole action for the user — so without this the
    // excess just sits there and nothing ever moves.
    // Returns false when the offer opens, so the count popup's button
    // wrapper doesn't close the offer right after it opens.
    if (p.doneSizes.indexOf(current) >= 0) {
      var needed = p.entries[current].qty;
      var excess = newVal - needed - M.transferredOut(p, current).over;
      if (excess > 0) {
        var target = nextUnfinishedAfter(p, current);
        if (target >= 0) {
          var label = M.prettySize(p.entries[target]);
          showModal({
            title: 'Extra pairs',
            message: 'You placed ' + newVal + ', but ' + needed + ' were needed \u2014 ' +
                     excess + ' extra. Subtract ' + excess + ' from ' + label + '?',
            rowButtons: true,
            buttons: [
              {
                label: 'Yes', primary: true, onClick: function () {
                  applyTransfer(p, current, target, -excess);
                  syncDone(p);
                  persist();
                  renderPlacing();
                }
              },
              { label: 'Keep it' }
            ]
          });
          return false;
        }
      }
    }
  }

  /** Per-size Done: advance, or handle a shortfall / overplacement via popup.
      Transfers aim at the first UNFINISHED size after this one (never a
      finished size), and only the pairs not already moved are offered —
      so pressing Done twice can never transfer the same pair twice. */
  function onSizeDone() {
    if (reviewing) return;
    var p = activeProject();
    var r = M.replay(p);
    var placed = r.placedPerSize[current];
    var needed = p.entries[current].qty;
    var tr = M.transferredOut(p, current);
    var shortfall = needed - placed - tr.short;
    var excess = placed - needed - tr.over;
    if (shortfall > 0) {
      var dest = shortfallDestination(p, current);
      var sfMsg = 'You only placed ' + placed + ' out of ' + needed + '.';
      if (dest.kind === 'size') {
        sfMsg += ' The missing ' + shortfall + ' will be added to ' +
          M.prettySize(p.entries[dest.idx]) + '.';
      } else if (dest.kind === 'create') {
        sfMsg += ' A new size, Any Size, will be added with the missing ' + shortfall + '.';
      }
      sfMsg += ' Are you sure?';
      showModal({
        title: 'Shortfall?',
        message: sfMsg,
        rowButtons: true,
        buttons: [
          { label: 'Yes', primary: true, onClick: function () { acceptShortfall(placed, needed); } },
          { label: 'No' }
        ]
      });
    } else if (excess > 0) {
      onOverplacement(placed, needed, excess);
    } else {
      if (p.doneSizes.indexOf(current) < 0) p.doneSizes.push(current);
      current++;
      forwardHistory(p, current - 1, current);
      persist();
      saveCurrent();
      renderPlacing();
    }
  }

  /**
   * Shortfall accepted: the size is done as-is. This size's qty is NEVER
   * rewritten — it keeps showing its true count in red with "(0 left)".
   * The shortfall itself rolls into the first unfinished size after this
   * one (or the Any Size catch-all when none is left), recorded as a
   * count:0 qtyTransfer event in the placing log (replay ignores it) so
   * Undo can revert the transfer exactly.
   * shortOk remembers the confirmation so syncDone doesn't un-mark it.
   */
  function acceptShortfall(placed, needed) {
    var p = activeProject();
    var shortfall = needed - placed - M.transferredOut(p, current).short;
    p.shortOk = p.shortOk || {};
    p.shortOk[current] = true;
    if (shortfall > 0) {
      var dest = shortfallDestination(p, current);
      if (dest.kind === 'size') {
        applyTransfer(p, current, dest.idx, shortfall);
      } else if (dest.kind === 'create') {
        // No unfinished size ahead: the leftover pairs get their own
        // catch-all size, created with the shortfall as its count. Its
        // origQty is 0 — the pairs are part of the original total, so the
        // frozen denominator must not count them twice.
        var newIdx = p.entries.length;
        p.entries.push({ waist: 'Any Size', length: '', qty: shortfall, origQty: 0, anySize: true });
        p.placingEvents.push({ size: current, count: 0, t: Date.now(),
          anySizeCreated: newIdx, delta: shortfall });
        p.timeline.push({ size: newIdx, t: Date.now(),
          text: 'created with ' + shortfall + ' pairs (shortfall from ' + M.prettySize(p.entries[current]) + ')' });
      }
      // kind 'none': this IS the Any Size — its pairs have nowhere to go;
      // it just stays done-short.
    }
    if (p.doneSizes.indexOf(current) < 0) p.doneSizes.push(current);
    current++;
    forwardHistory(p, current - 1, current);
    persist();
    saveCurrent();
    renderPlacing();
  }

  /**
   * Overplacement: the user placed more than needed. Offer to subtract the
   * excess from the first unfinished size after this one. No unfinished
   * size ahead: warn and let them keep it.
   */
  function onOverplacement(placed, needed, excess) {
    var p = activeProject();
    var target = nextUnfinishedAfter(p, current);
    if (target < 0) {
      showModal({
        title: 'Extra pairs',
        message: excess + ' extra, but there\'s no next size \u2014 ' +
                 'the total won\'t fill boxes evenly.',
        rowButtons: true,
        buttons: [
          {
            label: 'Keep it', primary: true, onClick: function () {
              if (p.doneSizes.indexOf(current) < 0) p.doneSizes.push(current);
              current++;
              forwardHistory(p, current - 1, current);
              persist();
              saveCurrent();
              renderPlacing();
            }
          },
          { label: 'Fix it' }
        ]
      });
    } else {
      var nextLabel = M.prettySize(p.entries[target]);
      showModal({
        title: 'Extra pairs',
        message: 'You placed ' + placed + ', but ' + needed + ' were needed \u2014 ' +
                 excess + ' extra. Subtract ' + excess + ' from ' + nextLabel + '?',
        rowButtons: true,
        buttons: [
          {
            label: 'Yes', primary: true, onClick: function () {
              applyTransfer(p, current, target, -excess);
              if (p.doneSizes.indexOf(current) < 0) p.doneSizes.push(current);
              syncDone(p);
              current++;
              forwardHistory(p, current - 1, current);
              persist();
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
      var doneShort = placed < needed && p.doneSizes.indexOf(i) >= 0;
      var yHtml = (e.origQty != null && needed !== e.origQty)
        ? '<span class="yadj">' + needed + '</span>' : String(needed);
      var html = M.prettySize(e) + ' \u2014 ' +
        (placed > needed
          ? '<span class="over">' + placed + '</span> out of ' + yHtml + ' placed (' + left + ' left)'
          : placed + ' out of ' + yHtml + ' placed (' + (doneShort ? 0 : left) + ' left)');
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
    if (reviewing) return;
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

  /* Check for updates, same pattern as Pantser's Info-screen button: read
     the live version straight from the served app.js (cache-busted, so the
     answer is about the server, not this device), pull a new service
     worker if there is one, and offer a restart when an update is ready.
     States live in updState so re-rendering Settings never loses them. */
  var updState = 'idle'; // 'idle' | 'checking' | 'ready'
  var updLatest = null;

  function renderUpdate() {
    var btn = el('checkUpdatesBtn'), st = el('updateStatus');
    if (!btn) return;
    if (updState === 'checking') {
      btn.disabled = true;
      btn.textContent = 'Checking\u2026';
    } else if (updState === 'ready') {
      btn.disabled = false;
      btn.textContent = 'Restart to update';
      if (st) st.textContent = 'Update available' + (updLatest ? ' (v' + updLatest + ')' : '');
    } else {
      btn.disabled = false;
      btn.textContent = 'Check for updates';
    }
  }

  function checkForUpdates() {
    var st = el('updateStatus');
    var nav = (typeof navigator !== 'undefined') ? navigator : {};
    if (!('serviceWorker' in nav)) {
      if (st) st.textContent = 'Update checking isn\u2019t available here.';
      return;
    }
    updState = 'checking';
    renderUpdate();
    if (st) st.textContent = '';
    var netFailed = false;
    nav.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) throw new Error('no registration');
      return fetch('js/app.js?u=' + Date.now(), { cache: 'no-store' }).then(function (res) {
        if (res && res.ok) {
          return res.text().then(function (txt) {
            var m = txt.match(/APP_VERSION = '([^']+)'/);
            return { reg: reg, latest: m ? m[1] : null };
          });
        }
        netFailed = true;
        return { reg: reg, latest: null };
      }).catch(function () {
        netFailed = true;
        return { reg: reg, latest: null };
      }).then(function (r) {
        return r.reg.update().then(function () { return r; });
      });
    }).then(function (r) {
      /* If a new worker appeared, wait until it has installed (it then
         activates itself) so the restart lands on the new version. */
      var w = r.reg.installing || r.reg.waiting;
      function finish() {
        if ((r.latest && r.latest !== APP_VERSION) || w) {
          updLatest = r.latest;
          updState = 'ready';
          renderUpdate();
        } else if (netFailed) {
          updState = 'idle';
          renderUpdate();
          if (st) st.textContent = 'Couldn\u2019t check for updates.';
        } else {
          updState = 'idle';
          renderUpdate();
          if (st) st.textContent = 'You\u2019re up to date (v' + APP_VERSION + ')';
        }
      }
      if (w && w.state !== 'installed' && w.state !== 'activated') {
        var done = false;
        var to = setTimeout(function () { if (!done) { done = true; finish(); } }, 8000);
        w.addEventListener('statechange', function () {
          if (!done && (w.state === 'installed' || w.state === 'activated')) {
            done = true; clearTimeout(to); finish();
          }
        });
        if (w.state === 'installed' || w.state === 'activated') {
          done = true; clearTimeout(to); finish();
        }
      } else {
        finish();
      }
    }).catch(function () {
      updState = 'idle';
      renderUpdate();
      if (st) st.textContent = 'Couldn\u2019t check for updates.';
    });
  }

  function onUpdateButton() {
    if (updState === 'ready') {
      try { location.reload(); } catch (e) {}
      return;
    }
    if (updState !== 'checking') checkForUpdates();
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
    // Breaks are app-global, not per-project — hide them on a project's
    // settings screen.
    el('breaksWrap').style.display = isProj ? 'none' : '';
    renderBreakRows();
    // Share project only makes sense with a project open.
    el('shareProjectWrap').style.display = isProj ? '' : 'none';
    // "Reset project" only for a finished regular-pull project: wipe the
    // placing, keep the plan and the lock.
    var rp = settingsCtx.project;
    var finished = isProj && rp && rp.mode !== 'straight' &&
      (rp.entries || []).length > 0 &&
      (rp.doneSizes || []).length >= rp.entries.length;
    el('resetProjectWrap').style.display = finished ? '' : 'none';
    renderUpdate();
  }
  function onResetProject() {
    showModal({
      title: 'Reset project?',
      message: 'This clears all placing progress, history and stapling counts. ' +
        'The size list stays, and the project stays locked.',
      rowButtons: true,
      buttons: [
        {
          label: 'Reset', danger: true, onClick: function () {
            var p = activeProject();
            p.placingEvents = [];
            p.timeline = [];
            p.doneSizes = [];
            p.stapled = [];
            p.shortOk = {};
            p.aheadOk = {};
            current = firstOpenSize(p);
            saveCurrent();
            persist();
            showPlacing();
          }
        },
        { label: 'Cancel' }
      ]
    });
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
  // part goes over .5 (undercount buffer) — unless alex overrode it off.
  function straightBoxMath(total, capacity, noSafety) {
    var exact = total / capacity;
    var frac = exact - Math.floor(exact);
    var safety = frac > 0.5;
    var boxes = Math.ceil(exact) + (safety && !noSafety ? 1 : 0);
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
  /** Focus the size input of the nth .mix-row on the straight-mix screen. */
  function focusMixRowSize(idx) {
    var rows = el('mixSizeList').children, seen = -1, k;
    for (k = 0; k < rows.length; k++) {
      if ((rows[k].className || '') === 'mix-row') {
        seen++;
        if (seen === idx) { rows[k].children[0].focus(); return; }
      }
    }
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
      // Enter in the size box hops to this row's quantity box
      sizeIn.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        qtyIn.focus();
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
      // Enter in the quantity box hops to the NEXT row's size box; on the
      // last row it adds a fresh row and lands there.
      qtyIn.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        if (i < p.mixEntries.length - 1) {
          focusMixRowSize(i + 1);
        } else {
          p.mixEntries.push({ size: '', qty: 0 });
          persist();
          renderMixSizes();
          focusMixRowSize(p.mixEntries.length - 1);
        }
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
    var m = straightBoxMath(mixTotal(p), p.boxCapacity, p.mixNoSafety);
    if (!m.safety) p.mixNoSafety = false; // override is moot without a safety box
    p.mixBoxes = m.boxes;
    persist();
    var html = m.total + ' ' + (p.itemName || 'items') + ' \u00f7 ' + m.capacity +
      ' per box = ' + m.exact.toFixed(2);
    if (m.safety && !p.mixNoSafety) html += '<div class="sub">Over .5, so one safety box is included.</div>';
    if (m.safety && p.mixNoSafety) html += '<div class="sub">Over .5, but you skipped the safety box.</div>';
    html += '<div class="mix-big">Make ' + m.boxes + ' box' + (m.boxes === 1 ? '' : 'es') + '</div>';
    el('mixBoxesMath').innerHTML = html;
    var ov = el('mixBoxesOverride');
    ov.style.display = m.safety ? '' : 'none';
    ov.textContent = p.mixNoSafety ? 'Add the safety box back' : 'Skip the safety box';
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
      if (momentumId != null) {
        // grabbed mid-spin: adopt the reel's CURRENT visual position so the
        // finger takes over exactly where the numbers are, no jump back
        stopMomentum();
        var m = /translateY\((-?[0-9.]+)px\)/.exec(strip.style.transform || '');
        if (m) {
          idx = Math.max(0, Math.min(values.length - 1,
            Math.round((ITEM_H - parseFloat(m[1])) / ITEM_H)));
          current = values[idx];
        }
      }
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
    el('entryScan').onclick = onScanTap;
    el('qrCancel').onclick = function () { stopQrScanner(); };
    el('qrUsePhoto').onclick = function () {
      var inp = el('qrFileInput');
      if (inp.click) inp.click();
    };
    el('qrFileInput').addEventListener('change', onQrPhotoChange);
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
    el('placingBack').onclick = function () {
      if (reviewing) {
        var rp = activeProject();
        reviewing = false;
        current = rp ? rp.entries.length : 0;
        renderPlacing();
        return;
      }
      showLocked();
    };
    el('sizeBig').onclick = onSizeJump;
    el('placedView').onclick = onPlacedTap;
    el('placeUndo').onclick = onUndo;
    el('placeLeft').onclick = function () { onArrow(-1); };
    el('placeRight').onclick = function () { onArrow(1); };
    el('placeDone').onclick = onSizeDone;
    el('boxMenuBtn').onclick = onBoxMenu;
    el('staplingBtn').onclick = showStapling;
    el('reviewSizesBtn').onclick = onPlacingMenu;
  /** Placing menu: review sizes, preparation (coming soon), go to current. */
  function onPlacingMenu() {
    var p = activeProject();
    if (!p) return;
    showModal({
      title: 'Menu',
      buttons: [
        {
          label: 'Review sizes', onClick: function () {
            current = 0; if (!reviewing) saveCurrent(); renderPlacing();
          }
        },
        { label: 'Preparation (coming soon)', disabled: true },
        {
          label: 'Go to current size', onClick: function () {
            current = firstOpenSize(p); if (!reviewing) saveCurrent(); renderPlacing();
          }
        },
        { label: 'Cancel' }
      ]
    });
  }
    el('resetPlacingBtn').onclick = onResetPlacing;
    el('completeBack').onclick = function () { showProjects(); };
    el('completeLeaderboardBtn').onclick = function () { showLeaderboard('complete'); };
    el('completeReviewBtn').onclick = function () { showPlacingReview(); };
    el('completeBoxesBtn').onclick = function () { onBoxMenu(); };
    el('completeBreaksBtn').onclick = function () {
      var p = activeProject();
      if (p) showProjectBreaks(p);
    };
    el('leaderboardBack').onclick = function () {
      if (leaderboardReturn === 'complete') showPlacing();
      else showSettings();
    };
    el('shareAppBtn').onclick = function () { showSharePopup(); };
    el('leaderboardBtn').onclick = function () { showLeaderboard('settings'); };
    el('breakAddBtn').onclick = function () {
      if (settings.breaks.length >= 6) { toast('Six breaks is plenty for one day'); return; }
      settings.breaks.push({ start: '12:00', end: '12:15' });
      saveSettings();
      renderBreakRows();
    };
    // Swipe right in Settings opens the leaderboard; swipe left there
    // comes back. (Buttons work too — the gesture is just the quick way.)
    (function () {
      var sx = null, sy = null;
      function start(ev) {
        var t = ev.touches && ev.touches[0];
        if (t) { sx = t.clientX; sy = t.clientY; }
      }
      function end(which) {
        return function (ev) {
          var t = ev.changedTouches && ev.changedTouches[0];
          if (t && sx != null && sy != null) {
            var dx = t.clientX - sx, dy = t.clientY - sy;
            if (Math.abs(dx) > 60 && Math.abs(dy) < 40) {
              if (which === 'settings' && dx > 0) showLeaderboard('settings');
              if (which === 'leaderboard' && dx < 0) {
                if (leaderboardReturn === 'complete') showPlacing();
                else showSettings();
              }
            }
          }
          sx = null; sy = null;
        };
      }
      el('view-settings').addEventListener('touchstart', start);
      el('view-settings').addEventListener('touchend', end('settings'));
      el('view-leaderboard').addEventListener('touchstart', start);
      el('view-leaderboard').addEventListener('touchend', end('leaderboard'));
    })();
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
    el('shareProjectBtn').onclick = function () {
      var p = settingsCtx.project;
      if (p) showShareProject(p);
    };
    el('checkUpdatesBtn').onclick = onUpdateButton;
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
    el('resetProjectBtn').onclick = onResetProject;
    el('resetDefaultsBtn').onclick = function () {
      var isProj = settingsCtx.mode === 'project' && !!settingsCtx.project;
      showModal({
        title: 'Reset to defaults?',
        message: isProj
          ? 'Reset this project\'s pairs per box, flipping and bundles to the current defaults?'
          : 'Restores pairs per box (25), bundles, quick-add buttons, UI scale, dark mode and break times to the original settings.',
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
    el('mixBoxesOverride').onclick = function () {
      var p = activeProject();
      if (!p) return showProjects();
      p.mixNoSafety = !p.mixNoSafety;
      persist();
      showMixBoxes();
    };
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
