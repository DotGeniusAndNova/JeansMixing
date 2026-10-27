/* JeansMixing web — scan-parse.js
 * Pure OCR-result → size-row parser for the experimental Scan feature.
 *
 * The work sheet is printed text, one size per row: two digits, an X, two
 * digits or the word ODD, then a quantity — e.g. "34 x ODD 25". Spaces do
 * not matter ("34xODD25" and "3 4 x 3 0 2 5" are the same row). The only
 * letters that ever appear are X and ODD, so anything else in a row means
 * the row is flagged for alex to fix by hand, never silently guessed.
 *
 * Fail-closed on purpose: a row that does not fit the pattern exactly
 * comes back flagged (with its raw text) instead of becoming a wrong size.
 * Rows with no digits at all are skipped quietly — those are headers and
 * titles, not sizes.
 *
 * No DOM here. Works in the browser (window.ScanParse) and in node
 * (module.exports) so the parser can be unit-tested like the model.
 */
(function (root) {
  'use strict';

  /* Uppercase, turn a multiplication sign into X, drop punctuation. A lone
     O inside a number is a misread 0 ("3O" -> "30") — but the word ODD is
     protected first (and "0DD", OCR misreading ODD's O as a zero), so its
     O never becomes a 0. */
  function normalizeToken(tok) {
    var t = String(tok).toUpperCase().replace(/×/g, 'X');
    t = t.replace(/[^A-Z0-9]/g, '');
    var P = '\u0001';
    t = t.replace(/ODD/g, P).replace(/0DD/g, P);
    if (/[0-9]/.test(t)) t = t.replace(/O/g, '0');
    return t.replace(new RegExp(P, 'g'), 'ODD');
  }

  /* Split one whitespace token on X boundaries, keeping the X's. Each unit
     knows whether it directly followed an X inside the same token (no space
     between them) — that matters because "34x3025" is one merged token
     whose post-X digits split into length + quantity, while a standalone
     "300" token is a separate field that can never be a length. */
  function splitToken(tok) {
    var t = normalizeToken(tok);
    if (!t) return [];
    var parts = t.split(/(X)/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      out.push({ text: parts[i], attached: i > 0 && parts[i - 1] === 'X' });
    }
    return out;
  }

  /* Parse one row's units. Returns {waist, length, qty} (length '00' for
     ODD) or null when the row does not fit the pattern. */
  function parseRowUnits(units) {
    var xIdx = -1;
    for (var i = 0; i < units.length; i++) {
      if (units[i].text === 'X') { xIdx = i; break; }
    }
    if (xIdx < 0) return null;
    var waist = '';
    for (var w = 0; w < xIdx; w++) waist += units[w].text;
    if (!/^\d\d$/.test(waist)) return null;

    var j = xIdx + 1;
    if (j >= units.length) return null;
    var length = null, qtyUnits = [];
    var u = units[j];
    if (u.text === 'ODD') {
      length = '00';
      qtyUnits = units.slice(j + 1);
    } else if (u.text.indexOf('ODD') === 0 && u.text.length > 3) {
      // Merged token like "ODD25": ODD is the length, the rest starts qty.
      length = '00';
      qtyUnits = [{ text: u.text.slice(3), attached: u.attached }]
        .concat(units.slice(j + 1));
    } else if (/^\d+$/.test(u.text)) {
      if (u.text.length === 2) {
        length = u.text;
        qtyUnits = units.slice(j + 1);
      } else if (u.text.length === 1) {
        // Split digits ("3 0") accumulate until the length is 2 digits.
        var acc = u.text, k = j + 1;
        while (k < units.length && acc.length < 2) {
          if (!/^\d$/.test(units[k].text)) return null;
          acc += units[k].text;
          k++;
        }
        if (acc.length !== 2) return null;
        length = acc;
        qtyUnits = units.slice(k);
      } else if (u.attached) {
        // One merged token, e.g. "3025" from "34x3025".
        length = u.text.slice(0, 2);
        qtyUnits = [{ text: u.text.slice(2), attached: true }]
          .concat(units.slice(j + 1));
      } else {
        return null; // a standalone 3+ digit field can't be a length
      }
    } else {
      return null;
    }

    var qty = '';
    for (var q = 0; q < qtyUnits.length; q++) {
      if (!/^\d+$/.test(qtyUnits[q].text)) return null;
      qty += qtyUnits[q].text;
    }
    if (!qty) return null;
    return { waist: waist, length: length, qty: parseInt(qty, 10) };
  }

  /* Parse one raw text line. Returns {waist, length, qty}, or
     {skip: true} for digit-less header/title lines, or
     {flag: 'unreadable'|'duplicate'...} — duplicates are flagged by
     parseLines, not here. */
  function parseRowText(text) {
    var raw = String(text == null ? '' : text).trim();
    if (!/[0-9]/.test(raw)) return { skip: true, raw: raw };
    var units = [];
    raw.split(/\s+/).forEach(function (tok) {
      splitToken(tok).forEach(function (unit) { units.push(unit); });
    });
    var parsed = parseRowUnits(units);
    if (!parsed) return { flag: 'unreadable', raw: raw };
    parsed.raw = raw; // kept so later merges can flag repeats with their text
    return parsed;
  }

  /* Parse text lines in paper order. Returns {rows} where each row is
     either {waist, length, qty} or {flag, raw}. A second occurrence of a
     size already seen is flagged 'duplicate' — the review screen's
     no-duplicate rule applies to scanned rows too. */
  function parseLines(lines) {
    var rows = [], seen = {};
    (lines || []).forEach(function (line) {
      var r = parseRowText(line);
      if (r.skip) return;
      if (r.flag) { rows.push({ flag: r.flag, raw: r.raw }); return; }
      var key = r.waist + 'x' + r.length;
      if (seen[key]) { rows.push({ flag: 'duplicate', raw: String(line).trim() }); return; }
      seen[key] = true;
      rows.push(r);
    });
    return { rows: rows };
  }

  /* Group Tesseract words into text lines by vertical position, then sort
     each line left-to-right. Words arrive in reading order only loosely,
     and phone photos tilt, so grouping tolerates vertical jitter of about
     half a word height. */
  function groupWords(words) {
    var ws = (words || []).filter(function (w) {
      return w && w.text != null && String(w.text).trim() !== '';
    }).map(function (w) {
      return {
        text: String(w.text),
        x0: +w.x0 || 0, y0: +w.y0 || 0, x1: +w.x1 || 0, y1: +w.y1 || 0
      };
    });
    ws.sort(function (a, b) {
      return ((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) || (a.x0 - b.x0);
    });
    var rows = [];
    ws.forEach(function (w) {
      var cy = (w.y0 + w.y1) / 2, h = Math.max(1, w.y1 - w.y0);
      var row = null;
      for (var i = 0; i < rows.length; i++) {
        if (Math.abs(cy - rows[i].cy) <= Math.max(8, 0.6 * h)) { row = rows[i]; break; }
      }
      if (!row) { row = { cy: cy, words: [] }; rows.push(row); }
      row.words.push(w);
      row.cy = row.words.reduce(function (s, x) {
        return s + (x.y0 + x.y1) / 2;
      }, 0) / row.words.length;
    });
    rows.sort(function (a, b) { return a.cy - b.cy; });
    return rows.map(function (r) {
      r.words.sort(function (a, b) { return a.x0 - b.x0; });
      return r.words.map(function (w) { return w.text; }).join(' ');
    });
  }

  /* Merge several pages' results in page order. A size already seen on an
     earlier page is flagged 'duplicate' — a multi-page sheet lists each
     size once, so a repeat means a misread, not a second entry. */
  function mergeScanResults(results) {
    var rows = [], seen = {};
    (results || []).forEach(function (res) {
      (res.rows || []).forEach(function (r) {
        if (r.flag) { rows.push(r); return; }
        var key = r.waist + 'x' + r.length;
        if (seen[key]) { rows.push({ flag: 'duplicate', raw: r.raw || '' }); return; }
        seen[key] = true;
        rows.push(r);
      });
    });
    return { rows: rows };
  }

  /* Parse a Tesseract result object. Prefers word boxes (they carry
     positions, so rows rebuild reliably); falls back to plain text lines
     when the engine only returned text. */
  function parseScanResult(data) {
    data = data || {};
    if (data.words && data.words.length) {
      var words = data.words.map(function (w) {
        var b = w.bbox || {};
        return { text: w.text, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
      });
      return parseLines(groupWords(words));
    }
    return parseLines(String(data.text || '').split(/\n/));
  }

  var api = {
    parseRowText: parseRowText,
    parseLines: parseLines,
    groupWords: groupWords,
    mergeScanResults: mergeScanResults,
    parseScanResult: parseScanResult
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ScanParse = api;
  }
})(typeof self !== 'undefined' ? self : this);
