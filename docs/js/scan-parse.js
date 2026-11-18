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

  /* ------------------------------------------------- per-size lookup (Stage 2)
   * The PaddleOCR text scanner reads the other way around from the old
   * line parser: for each known size it finds that size's token on the
   * page and reads the number immediately to its right on the same row.
   * Proven on alex's real sheets: 23/23 (Jeds 750) and 32/32 (Reg 875),
   * zero wrong numbers. Row spacing on the photos is ~21px and true
   * size/qty pairs sit within ~2px, so the +-10px band keeps every true
   * pair and kills cross-row grabs. Never pool pages: the lookup runs
   * per page, and pages merge afterwards. */
  /* A tilted photo slopes every row: the quantity sits a few pixels
     above or below the size's centre, by (qty.x - size.x) * slope,
     where slope is the size column's lean. The band is centred on
     that sloped line instead of flat. Proven on alex's Reg 750 sheet:
     the flat band reads 16/28 at 3 degrees of tilt and 0/28 at 5
     degrees (every size found, no quantity beside it — the exact
     "it kept saying blurry" symptom); the sloped band reads 28/28
     at both, with zero wrong numbers. The sign is settled by that
     test: the other sign reads 0/28. */
  var LOOKUP_BAND = 10; // px, same-row band around the size token's centre
  var LOOKUP_REACH = 300; // px, how far right of the size token a qty may sit
  /* Qty-slot letters: a letter in the QUANTITY slot only is a misread
     digit — the slot must always be a number. C, O, Q and D are all
     round like 0, so each maps to 0. The result is a GUESS, flagged for
     review, never silently trusted. (No 'n' — alex's call: 'n' is not
     a 0.) Never applied to the size token itself: ODD has a real O. */
  var QTY_LETTERS = { C: '0', O: '0', Q: '0', D: '0' };

  /* Size tokens: uppercase, runs of x-like chars (x/X/×) collapse to one
     X, whitespace stripped. So "44x×32" reads as "44x32". */
  function normalizeSizeToken(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/[X×]+/g, 'X').replace(/\s+/g, '');
  }

  /* A quantity token, normalized: pure digits pass through; a token of
     digits plus round letters (C/O/Q/D) becomes its digit form — a
     guess. Anything else (a letter that isn't a round 0, like B) is not
     a quantity at all, so it returns null. In-token too: "o0" -> "00". */
  function normalizeQtyToken(s) {
    var up = String(s == null ? '' : s).toUpperCase();
    if (up === '') return null;
    var out = '';
    for (var i = 0; i < up.length; i++) {
      var ch = up[i];
      if (ch >= '0' && ch <= '9') out += ch;
      else if (QTY_LETTERS[ch]) out += QTY_LETTERS[ch];
      else return null;
    }
    return out;
  }

  /* PaddleOCR items carry a polygon; reduce one to its bounding box. */
  function itemBox(it) {
    var poly = (it && it.poly) || [];
    if (!poly.length) return null;
    var xs = poly.map(function (p) { return p[0]; });
    var ys = poly.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    return {
      text: it.text, score: it.score,
      x0: x0, y0: y0, x1: x1, y1: y1,
      cx: (x0 + x1) / 2, cy: (y0 + y1) / 2
    };
  }

  /** How much the size column leans on this page, as the expected
      quantity offset per pixel of horizontal distance (dy per dx).
      The sizes share one left-aligned column, so their left edge (x0)
      is stable across sizes of different widths — a least-squares fit
      of x0 against cy over the detected size tokens. Fewer than two
      sizes on the page -> 0, the flat band. */
  function pageSlopeK(items) {
    var boxes = (items || []).map(itemBox).filter(function (b) { return !!b; });
    var grid = {};
    gridSizes().forEach(function (g) { grid[normalizeSizeToken(displaySize(g.waist, g.length))] = true; });
    var pts = boxes.filter(function (b) { return grid[normalizeSizeToken(b.text)]; });
    var n = pts.length;
    if (n < 2) return 0;
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += pts[i].cy; my += pts[i].x0; }
    mx /= n; my /= n;
    var sxx = 0, sxy = 0;
    for (i = 0; i < n; i++) { sxx += (pts[i].cy - mx) * (pts[i].cy - mx); sxy += (pts[i].cy - mx) * (pts[i].x0 - my); }
    if (!sxx) return 0;
    return -(sxy / sxx);
  }

  /* Look one size up on one page of OCR items. Returns:
       {found:false} — the size token isn't on this page;
       {found:true, qty:null, sizeText, box} — size found, no number
         beside it (the lone-0 weak spot: the engine misses the 0 or
         reads it as a letter, so the row comes back flagged, never as
         a wrong number);
       {found:true, qty, exact:true, raw, box} — a pure-number quantity;
       {found:true, qty, exact:false, raw, box} — a letter-normalized
         guess.
     box is the row's bounding box in the page image's pixels (the
     size token's box widened to the quantity's), so the single-size
     review can crop the row straight out of the photo. The engine
     returns polygons in full-resolution image space (verified on
     alex's sheets: y up to 1888 on a 2048-tall photo), so the box
     maps 1:1 onto the photo as the browser shows it.
     slopeK (optional) is the page's row slope from pageSlopeK: the
     quantity is expected at dy = slopeK * (qty.cx - size.cx), so a
     tilted photo still pairs each size with its own quantity. Omit
     it and the band stays flat, as before. */
  function unionBox(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return {
      x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1)
    };
  }
  function lookupSize(items, sizeText, slopeK) {
    var boxes = (items || []).map(itemBox).filter(function (b) { return !!b; });
    var want = normalizeSizeToken(sizeText);
    var s = null;
    for (var i = 0; i < boxes.length; i++) {
      if (normalizeSizeToken(boxes[i].text) === want) { s = boxes[i]; break; }
    }
    if (!s) return { found: false };
    var k = slopeK || 0;
    var cands = boxes.filter(function (it) {
      var n = /^\d+$/.test(it.text) ? it.text : normalizeQtyToken(it.text);
      if (n === null) return false;
      var expDy = k * (it.cx - s.cx);
      return it.cx > s.x1 && Math.abs((it.cy - s.cy) - expDy) < LOOKUP_BAND && (it.x0 - s.x1) < LOOKUP_REACH;
    }).sort(function (a, b) { return a.x0 - b.x0; });
    if (!cands.length) return { found: true, qty: null, sizeText: s.text, box: { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 } };
    var first = cands[0];
    var box = unionBox(s, first);
    /* The quantity token's own box, apart from the union: lookupPages
       uses the page's quantity boxes to find the quantity column, so
       a row whose quantity the engine missed entirely can still have
       its crop widened to where the number should be. */
    var qtyBox = { x0: first.x0, y0: first.y0, x1: first.x1, y1: first.y1 };
    if (/^\d+$/.test(first.text)) {
      return { found: true, qty: parseInt(first.text, 10), exact: true, raw: first.text, box: box, qtyBox: qtyBox };
    }
    return { found: true, qty: parseInt(normalizeQtyToken(first.text), 10), exact: false, raw: first.text, box: box, qtyBox: qtyBox };
  }

  /* Median of a list of numbers (for the quantity column's right edge). */
  function median(ns) {
    if (!ns.length) return null;
    var s = ns.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  }

  /* Run the lookup over pages (each a list of OCR items, in page order).
     Returns {rows} in the parseTemplateLines shape, in grid order: a
     found qty above 0 becomes a row (guessed ones carry flag 'guessed'
     and the raw token); a found qty of 0 exactly produces nothing; a
     guessed 0, or a size found with no number beside it, becomes a
     flagged qty-0 row for alex to confirm; a missing CORE size becomes
     a flagged 'missing' row; a missing OPTIONAL size is skipped. */
  function lookupPages(pages) {
    /* Pass 1: find every size (as before) and, per page, the quantity
       column — the median right edge of the quantities that WERE read.
       The quantities are right-aligned on the sheet, so that edge is
       stable across digit counts (on alex's Jeds page 2: 625–641).
       Each page's row slope is fitted once here and handed to every
       lookup on that page, so a tilted photo still pairs sizes with
       their own quantities. sizesSeen counts grid sizes whose token
       was detected on any page, quantities or not — the app uses it
       to tell a tilted photo (sizes seen, quantities missing) from a
       blurry one (nothing seen at all). */
    var found = [];
    var qtyRight = {}; // page index -> [qtyBox.x1, ...]
    var pageSlopes = (pages || []).map(pageSlopeK);
    var sizesSeen = 0;
    gridSizes().forEach(function (g) {
      var sizeText = displaySize(g.waist, g.length);
      var r = null, rPage = -1;
      for (var p = 0; p < (pages || []).length; p++) {
        var rr = lookupSize(pages[p], sizeText, pageSlopes[p]);
        if (rr.found) {
          r = rr; rPage = p;
          if (rr.qty !== null) break;
        }
      }
      if (r) sizesSeen++;
      found.push({ g: g, sizeText: sizeText, r: r, rPage: rPage });
      if (r && r.qtyBox) {
        (qtyRight[rPage] = qtyRight[rPage] || []).push(r.qtyBox.x1);
      }
    });
    /* Pass 2: build the rows. A row whose quantity the engine missed
       entirely (the lone-0 weak spot: no token beside the size at all)
       gets its crop widened from the size out to the page's quantity
       column, so the single-size review shows the spot where the
       number should be instead of just the size. A page with no
       quantities read at all falls back to twice the size's width —
       roughly the gap on his sheets. */
    var rows = [];
    found.forEach(function (f) {
      var g = f.g, sizeText = f.sizeText, r = f.r, rPage = f.rPage;
      if (!r) {
        if (!g.optional) {
          rows.push({ flag: 'missing', raw: sizeText, waist: g.waist, length: g.length });
        }
        return;
      }
      /* Every found row carries where it was read (page + box), so the
         single-size review can crop it out of the photo. A missing row
         has neither — the size wasn't on any page. */
      var box = r.box;
      if (r.qty === null && box) {
        var col = median(qtyRight[rPage] || []);
        var reach = (col !== null) ? col : (box.x1 + 2 * (box.x1 - box.x0));
        box = { x0: box.x0, y0: box.y0, x1: Math.max(box.x1, reach), y1: box.y1 };
      }
      if (r.qty === null) {
        rows.push({ flag: 'unreadable', raw: r.sizeText || sizeText, waist: g.waist, length: g.length, qty: 0, box: box, page: rPage });
        return;
      }
      if (r.qty === 0) {
        if (!r.exact) {
          rows.push({ flag: 'guessed', raw: r.raw, waist: g.waist, length: g.length, qty: 0, box: r.box, page: rPage });
        }
        return;
      }
      if (r.exact) {
        rows.push({ waist: g.waist, length: g.length, qty: r.qty, box: r.box, page: rPage });
      } else {
        rows.push({ flag: 'guessed', raw: r.raw, waist: g.waist, length: g.length, qty: r.qty, box: r.box, page: rPage });
      }
    });
    return { rows: rows, sizesSeen: sizesSeen };
  }

  /* One page, summarized for the after-scan modal: how many sizes were
     found on THIS page, their total, and how many rows need attention.
     Sizes not on this page at all are ignored here — they may be on the
     next page; only the merged lookup (lookupPages over all pages) can
     call a size missing. sizesSeen counts every size token detected on
     the page, quantities or not, so the app can tell a tilted photo
     (sizes seen, quantities missing) from a blurry one (nothing seen). */
  function summarizePage(items) {
    var k = pageSlopeK(items);
    var found = 0, total = 0, flagged = 0, sizes = [], sizesSeen = 0;
    gridSizes().forEach(function (g) {
      var r = lookupSize(items, displaySize(g.waist, g.length), k);
      if (!r.found) return;
      sizesSeen++;
      if (r.qty === null) { flagged++; return; }
      if (r.qty > 0) {
        found++; total += r.qty;
        sizes.push(displaySize(g.waist, g.length));
        if (!r.exact) flagged++;
      } else if (!r.exact) {
        flagged++;
      }
    });
    return { found: found, total: total, flagged: flagged, sizes: sizes, sizesSeen: sizesSeen };
  }

  var api = {
    gridSizes: gridSizes,
    normalizeLine: normalizeLine,
    extractFromLine: extractFromLine,
    parseTemplateLines: parseTemplateLines,
    groupWords: groupWords,
    parseScanTemplate: parseScanTemplate,
    normalizeSizeToken: normalizeSizeToken,
    normalizeQtyToken: normalizeQtyToken,
    lookupSize: lookupSize,
    lookupPages: lookupPages,
    summarizePage: summarizePage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ScanParse = api;
  }
})(typeof self !== 'undefined' ? self : this);
