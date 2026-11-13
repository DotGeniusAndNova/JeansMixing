/* JeansMixing web — model.js
 * Pure logic ported from the Android app's PlacingModel.kt / ProjectStore.kt.
 * No DOM here: every function takes a project object and returns data.
 * Works in the browser (exposes window.JM) and in node (module.exports)
 * so the dealing algorithm can be unit-tested.
 */
(function (root) {
  'use strict';

  var BOX_CAPACITY = 25;
  var BUNDLE_SIZE = 6;

  /** "30x32" or "30xODD" — waist/length kept as raw 2-digit strings.
      An "Any Size" catch-all entry carries no length: it renders as-is. */
  function displaySize(w, l) {
    if (!l) return w;
    return l === '00' ? w + 'xODD' : w + 'x' + l;
  }

  /** "30 x 32" / "30 x ODD" — the spaced label used on placing screens. */
  function prettySize(e) {
    if (e.anySize) return 'Any Size';
    return e.waist + ' x ' + (e.length === '00' ? 'ODD' : e.length);
  }

  /** Boxes implied by the current plan; -1 if the total isn't divisible by the
      project's pairs-per-box (defaults to 25). */
  function boxCount(p) {
    var cap = (p.pairsPerBox > 0) ? p.pairsPerBox : BOX_CAPACITY;
    var total = p.entries.reduce(function (s, e) { return s + e.qty; }, 0);
    return total % cap === 0 ? total / cap : -1;
  }

  /**
   * The physical box count. Frozen at lock time (lockedBoxCount) because the
   * plan total can stop being divisible by 25 after overplacement cascades.
   */
  function boxes(p) {
    var frozen = p.lockedBoxCount || 0;
    return frozen > 0 ? frozen : Math.max(1, boxCount(p));
  }

  /** Replays the append-only press log in order. */
  function replay(p) {
    var n = boxes(p);
    var placed = p.entries.map(function () { return 0; });
    var boxCounts = [];
    for (var i = 0; i < n; i++) boxCounts.push(0);
    var pointer = 0;
    for (var k = 0; k < p.placingEvents.length; k++) {
      var e = p.placingEvents[k];
      if (e.size < 0 || e.size >= placed.length || e.count <= 0) continue;
      placed[e.size] += e.count;
      for (var j = 0; j < e.count; j++) {
        boxCounts[pointer]++;
        pointer = (pointer + 1) % n;
      }
    }
    return { placedPerSize: placed, boxCounts: boxCounts, nextBox: pointer };
  }

  /**
   * Full expected dealing from the CURRENT plan: for each box, the size indices
   * in placement order. Round-robin from box 1; each new size starts at the box
   * AFTER where the last size left off (the pointer is never reset per size).
   */
  function simulate(p) {
    var n = boxes(p);
    var out = [];
    for (var i = 0; i < n; i++) out.push([]);
    var b = 0;
    p.entries.forEach(function (e, si) {
      for (var j = 0; j < e.qty; j++) {
        out[b].push(si);
        b = (b + 1) % n;
      }
    });
    return out;
  }

  /**
   * LIVE box contents: ACTUAL placements from the event log, PLUS the remaining
   * plan simulated round-robin from the current next-box pointer, where
   * remaining[i] = max(0, needed[i] - placed[i]) in size order.
   */
  function simulateLive(p) {
    var n = boxes(p);
    var out = [];
    for (var i = 0; i < n; i++) out.push([]);
    var b = 0;
    for (var k = 0; k < p.placingEvents.length; k++) {
      var e = p.placingEvents[k];
      if (e.size < 0 || e.size >= p.entries.length || e.count <= 0) continue;
      for (var j = 0; j < e.count; j++) {
        out[b].push(e.size);
        b = (b + 1) % n;
      }
    }
    var r = replay(p); // b === r.nextBox here: the log above is replayed identically.
    p.entries.forEach(function (entry, si) {
      var rem = Math.max(0, entry.qty - r.placedPerSize[si]);
      for (var j = 0; j < rem; j++) {
        out[b].push(si);
        b = (b + 1) % n;
      }
    });
    return out;
  }

  function totalPlaced(p) {
    return p.placingEvents.reduce(function (s, e) { return s + e.count; }, 0);
  }

  /** "14:05:09" — timeline timestamps, matches the Android HH:mm:ss format. */
  function fmtTime(ms) {
    var d = new Date(ms);
    function z(x) { return (x < 10 ? '0' : '') + x; }
    return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
  }

  /** "Oct 16, 2026 3:15 PM" — auto project names, matches Android's format. */
  function projectDisplayName(date) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var h = date.getHours();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    var m = date.getMinutes();
    return months[date.getMonth()] + ' ' + date.getDate() + ', ' +
           date.getFullYear() + ' ' + h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }

  /* ------------------------------------------------------- project QR codes
   * Sharing a project as a QR code: sizes + quantities packed into one
   * short string. Format v1: "JM1|waist/length/qty|waist/length/qty|...".
   * An "Any Size" catch-all entry encodes as-is; an empty length encodes
   * as an empty field ("30//425"). Only the plan travels — never the
   * placing progress, so a scanned project always starts fresh — but the
   * quantities are the CURRENT ones: a shortfall rolled forward lowers
   * the short size (its qty is never rewritten), so the code carries the
   * pairs that actually exist, and the total stays divisible by the box
   * size. */
  var QR_MAX_SIZES = 200;
  var QR_MAX_QTY = 99999;
  /** Pairs already rolled OUT of a size, split by direction: .short is a
      shortfall (missing pairs that moved to the next size), .over is an
      over-placement (extra pairs that turned out to belong to the next
      size). Read from the count:0 qtyTransfer events in the placing log. */
  function transferredOut(p, idx) {
    var out = { over: 0, short: 0 };
    (p.placingEvents || []).forEach(function (e) {
      if (e.size === idx && e.qtyTransfer) {
        if (e.qtyTransfer.delta < 0) out.over += -e.qtyTransfer.delta;
        else out.short += e.qtyTransfer.delta;
      }
      // A last-size shortfall creates the Any Size catch-all instead of a
      // transfer event — same pairs leaving, same count coming off.
      if (e.size === idx && e.anySizeCreated != null && e.delta > 0) out.short += e.delta;
    });
    return out;
  }
  /** The pairs a size will actually place: its current qty minus any
      shortfall already rolled forward. The receiving size's qty already
      includes the rolled-in pairs, and an over-placement never changes
      the source's own count, so only .short comes off. */
  function effectiveQty(p, idx) {
    return p.entries[idx].qty - transferredOut(p, idx).short;
  }
  /** The count a size is aiming for: its qty, minus a shortfall already
      rolled out, plus an over-placement already rolled out, plus any
      preparation recorded with nowhere to roll (prepDelta). A preparation
      WITH a target is just a transfer, so it already shows up in .short
      / .over — prepDelta only ever carries the no-target remainder, so
      the terms never double-count. The placing view, the Done flow, the
      locked review and the QR code all read this number, so the total
      they show together always equals the pairs that actually exist. */
  function placeTarget(p, idx) {
    var tr = transferredOut(p, idx);
    var prep = 0;
    (p.placingEvents || []).forEach(function (e) {
      if (e.size === idx && typeof e.prepDelta === 'number') prep += e.prepDelta;
    });
    return p.entries[idx].qty - tr.short + tr.over + prep;
  }
  function encodeProjectCode(p) {
    return 'JM1|' + (p.entries || []).map(function (e, i) {
      return (e.anySize ? 'Any Size' : e.waist) + '/' + (e.length || '') + '/' + placeTarget(p, i);
    }).join('|');
  }
  /** Decode a scanned string. Returns {entries} or {error: 'E1'..'E6'}:
      E1 not a JeansMixing code, E2 unsupported version, E3 malformed entry,
      E4 no sizes, E5 bad quantity, E6 too many sizes. */
  function decodeProjectCode(text) {
    if (typeof text !== 'string' || text.slice(0, 2) !== 'JM') return { error: 'E1' };
    var parts = text.split('|');
    if (parts[0] !== 'JM1') return { error: 'E2' };
    var segs = parts.slice(1);
    if (!segs.length || (segs.length === 1 && segs[0] === '')) return { error: 'E4' };
    if (segs.length > QR_MAX_SIZES) return { error: 'E6' };
    var entries = [];
    for (var i = 0; i < segs.length; i++) {
      var f = segs[i].split('/');
      if (f.length !== 3) return { error: 'E3' };
      var waist = f[0], length = f[1], qty = parseInt(f[2], 10);
      if (!waist || (length && !/^\d{1,3}$/.test(length))) return { error: 'E3' };
      if (!/^\d+$/.test(f[2]) || qty < 1 || qty > QR_MAX_QTY) return { error: 'E5' };
      entries.push(waist === 'Any Size'
        ? { waist: 'Any Size', length: '', qty: qty, anySize: true }
        : { waist: waist, length: length, qty: qty });
    }
    if (!entries.length) return { error: 'E4' };
    return { entries: entries };
  }

  /* ------------------------------------------------------------------ store
   * Projects persist in localStorage as one JSON array (same shape as the
   * Android JSON files, plus an additive `entryDraft` for the web entry
   * screen). UI state (active project, per-project placing cursor) lives in
   * a second key so a refresh mid-shift loses nothing.
   */
  var Store = (function () {
    var KEY = 'jmw.projects.v1';
    var UI_KEY = 'jmw.ui.v1';

    function load() {
      try {
        var v = JSON.parse(localStorage.getItem(KEY));
        return Array.isArray(v) ? v : [];
      } catch (e) { return []; }
    }
    function save(list) {
      localStorage.setItem(KEY, JSON.stringify(list));
    }
    function loadUI() {
      try {
        var v = JSON.parse(localStorage.getItem(UI_KEY));
        return v && typeof v === 'object' ? v : {};
      } catch (e) { return {}; }
    }
    function saveUI(u) {
      localStorage.setItem(UI_KEY, JSON.stringify(u));
    }
    function blankProject(name) {
      return {
        id: 'p' + Date.now() + '_' + Math.floor(Math.random() * 100000),
        name: name,
        createdAt: Date.now(),
        locked: false,
        entries: [],
        placingEvents: [],
        timeline: [],
        doneSizes: [],
        lockedBoxCount: 0,
        stapled: [],
        entryDraft: null
      };
    }
    function uniqueName(list, base) {
      var names = {};
      list.forEach(function (p) { names[p.name] = true; });
      var name = base, n = 2;
      while (names[name]) { name = base + ' (' + n + ')'; n++; }
      return name;
    }
    return {
      load: load, save: save, loadUI: loadUI, saveUI: saveUI,
      blankProject: blankProject, uniqueName: uniqueName
    };
  })();

  var api = {
    BOX_CAPACITY: BOX_CAPACITY,
    BUNDLE_SIZE: BUNDLE_SIZE,
    displaySize: displaySize,
    prettySize: prettySize,
    boxCount: boxCount,
    boxes: boxes,
    replay: replay,
    simulate: simulate,
    simulateLive: simulateLive,
    totalPlaced: totalPlaced,
    fmtTime: fmtTime,
    projectDisplayName: projectDisplayName,
    encodeProjectCode: encodeProjectCode,
    decodeProjectCode: decodeProjectCode,
    transferredOut: transferredOut,
    effectiveQty: effectiveQty,
    placeTarget: placeTarget,
    Store: Store
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.JM = api;
  }
})(typeof self !== 'undefined' ? self : this);
