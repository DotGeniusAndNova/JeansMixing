/* JeansMixing web — scan-parse.js
 * Template parser for the experimental Scan feature.
 *
 * The freeform "read everything and guess the structure" approach failed
 * on the real sheet (60 garbage rows): a tilted phone photo of a small
 * table is too noisy for that. The sheet's sizes are FIXED, though, so
 * the scanner works the other way around: it looks for each known size
 * in turn and reads the number after it as the quantity.
 *
 * Two classes of size:
 *  - CORE (always on every sheet, up to 48xODD): waists 28-36, then
 *    38,40,42,44,46,48, each with lengths 29,30,32,34,ODD. A core size
 *    that is not found means the reader misread it, so it comes back
 *    flagged (with the size pre-filled) for alex to type the quantity.
 *  - OPTIONAL (only sometimes on the sheet): even waists 50-64, each
 *    with lengths 29,30,32,34,ODD, plus 50x42. An optional size that is
 *    not found is skipped silently — it simply isn't on this sheet.
 * A found size with quantity 0 is also skipped: no row, no flag.
 *
 * Garbage lines are ignored, not flagged: only grid sizes matter, so
 * background clutter and misread fragments can't flood the review
 * screen the way they did with freeform parsing.
 *
 * No DOM here. Works in the browser (window.ScanParse) and in node
 * (module.exports) so the parser can be unit-tested like the model.
 */
(function (root) {
  'use strict';

  var CORE_WAISTS = ['28', '29', '30', '31', '32', '33', '34', '35', '36',
    '38', '40', '42', '44', '46', '48'];
  var CORE_LENGTHS = ['29', '30', '32', '34', '00']; // '00' prints as ODD
  /* Optional bigger sizes: only sometimes on the sheet, so a missing
     one is skipped silently. 50 also comes with an odd 42 length; every
     other bigger waist uses the standard five lengths. The run stops at
     64 — adding further waists later is one line in EXTRA_WAISTS. */
  var EXTRA_WAISTS = ['50', '52', '54', '56', '58', '60', '62', '64'];

  /** "30x32" or "30xODD" — same rule as the app's displaySize. */
  function displaySize(w, l) {
    return l === '00' ? w + 'xODD' : w + 'x' + l;
  }

  /** Every size the scanner looks for, in sheet order: the core grid,
     then the optional bigger sizes. */
  function gridSizes() {
    var out = [];
    CORE_WAISTS.forEach(function (w) {
      CORE_LENGTHS.forEach(function (l) {
        out.push({ waist: w, length: l, optional: false });
      });
    });
    EXTRA_WAISTS.forEach(function (w) {
      var lengths = w === '50'
        ? ['29', '30', '32', '42', '00'] // 50's lengths, as listed: 42 sits between 32 and ODD
        : CORE_LENGTHS;
      lengths.forEach(function (l) {
        out.push({ waist: w, length: l, optional: true });
      });
    });
    return out;
  }

  /* Normalize one OCR line into a single joined string, spaces ignored:
     uppercase, multiplication sign to X, punctuation stripped. A lone O
     inside a number is a misread 0 ("3O" -> "30") and a lone I/L inside a
     number is a misread 1 ("I5" -> "15") — but the word ODD is protected
     first (and "0DD", OCR misreading ODD's O as a zero), so its letters
     are never rewritten. Tokens without digits are left alone. */
  function normalizeLine(line) {
    var P = '\u0001'; // placeholder: survives the digit fixes, then becomes ODD again
    var toks = String(line == null ? '' : line).toUpperCase().replace(/×/g, 'X').split(/\s+/);
    var fixed = toks.map(function (tok) {
      var t = tok.replace(/[^A-Z0-9]/g, '');
      t = t.replace(/ODD/g, P).replace(/0DD/g, P);
      if (/[0-9]/.test(t)) t = t.replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1');
      return t.replace(new RegExp(P, 'g'), 'ODD');
    });
    return fixed.join('');
  }

  /* Find the first size + quantity in a line: two digits, X, two digits
     or ODD, then the quantity digits. Returns {waist, length, qty}
     (length '00' for ODD) or null when the line holds no size. */
  function extractFromLine(line) {
    var joined = normalizeLine(line);
    var m = joined.match(/(\d\d)X(\d\d|ODD)(\d+)/);
    if (!m) return null;
    return { waist: m[1], length: m[2] === 'ODD' ? '00' : m[2], qty: parseInt(m[3], 10) };
  }

  /* Run the template over text lines (all pages combined, in order).
     Returns {rows} in grid order: one entry per found size with qty > 0,
     plus one flagged row per missing CORE size (size pre-filled, qty 0,
     so alex only has to type the quantity). Optional sizes that are
     absent, and found sizes with qty 0, produce nothing at all. */
  function parseTemplateLines(lines) {
    var found = {}; // "waistxlength" -> qty, first occurrence wins
    (lines || []).forEach(function (line) {
      var c = extractFromLine(line);
      if (!c) return;
      var key = c.waist + 'x' + c.length;
      if (!(key in found)) found[key] = c.qty;
    });
    var rows = [];
    gridSizes().forEach(function (g) {
      var key = g.waist + 'x' + g.length;
      if (key in found) {
        if (found[key] > 0) {
          rows.push({ waist: g.waist, length: g.length, qty: found[key] });
        }
      } else if (!g.optional) {
        rows.push({
          flag: 'missing', raw: displaySize(g.waist, g.length),
          waist: g.waist, length: g.length
        });
      }
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

  /* Parse a Tesseract result object through the template. Prefers word
     boxes (they carry positions, so lines rebuild reliably); falls back
     to plain text lines when the engine only returned text. */
  function parseScanTemplate(data) {
    data = data || {};
    if (data.words && data.words.length) {
      var words = data.words.map(function (w) {
        var b = w.bbox || {};
        return { text: w.text, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
      });
      return parseTemplateLines(groupWords(words));
    }
    return parseTemplateLines(String(data.text || '').split(/\n/));
  }

  var api = {
    gridSizes: gridSizes,
    normalizeLine: normalizeLine,
    extractFromLine: extractFromLine,
    parseTemplateLines: parseTemplateLines,
    groupWords: groupWords,
    parseScanTemplate: parseScanTemplate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ScanParse = api;
  }
})(typeof self !== 'undefined' ? self : this);
