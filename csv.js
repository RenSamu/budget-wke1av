/* Lecture de relevés bancaires CSV : détection automatique des colonnes,
   nombres et dates au format suisse, catégorisation par règles.
   Aucune donnée ne quitte l'appareil. */
(function (root) {
  'use strict';

  function stripAccents(s) {
    return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
  }
  function norm(s) {
    return stripAccents(String(s == null ? '' : s)).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /* ---------- Lecture du fichier ---------- */
  function decode(buf) {
    var u8 = new Uint8Array(buf);
    var text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (e) {
      text = new TextDecoder('windows-1252').decode(u8);
    }
    return text.replace(/^﻿/, '');
  }

  function detectDelimiter(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; }).slice(0, 30);
    var best = ';', bestScore = 0;
    [';', ',', '\t'].forEach(function (d) {
      var counts = lines.map(function (l) {
        var n = 0, q = false;
        for (var i = 0; i < l.length; i++) {
          var ch = l.charAt(i);
          if (ch === '"') q = !q;
          else if (ch === d && !q) n++;
        }
        return n;
      });
      var freq = {};
      counts.forEach(function (c) { if (c > 0) freq[c] = (freq[c] || 0) + 1; });
      Object.keys(freq).forEach(function (k) {
        var score = freq[k] * Number(k);
        if (score > bestScore) { bestScore = score; best = d; }
      });
    });
    return best;
  }

  function parse(text, delim) {
    var rows = [], row = [], cell = '', q = false, i = 0, n = text.length;
    while (i < n) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"') {
        q = true;
      } else if (ch === delim) {
        row.push(cell); cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
      i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(function (r) { return r.map(function (c) { return c.trim(); }); });
  }

  /* ---------- Nombres et dates ---------- */
  function parseNumber(s) {
    if (s == null) return NaN;
    s = String(s).trim();
    if (!s) return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (/^[-−]/.test(s)) { neg = !neg; s = s.slice(1); }
    s = s.replace(/^\+/, '').replace(/CHF|EUR/gi, '').replace(/\s/g, '').replace(/[’'`´]/g, '');
    if (!/^\d[\d.,]*$/.test(s)) return NaN;
    var lastDot = s.lastIndexOf('.'), lastCom = s.lastIndexOf(',');
    if (lastDot > -1 && lastCom > -1) {
      var dec = lastDot > lastCom ? '.' : ',';
      var th = dec === '.' ? ',' : '.';
      s = s.split(th).join('').replace(dec, '.');
    } else if (lastCom > -1) {
      s = /^\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    } else if (lastDot > -1 && s.split('.').length > 2) {
      s = s.replace(/\./g, '');
    }
    var v = parseFloat(s);
    if (!isFinite(v)) return NaN;
    return neg ? -v : v;
  }

  function validYMD(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    var t = new Date(y, m - 1, d);
    if (t.getMonth() !== m - 1) return null;
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  function parseDate(s) {
    s = String(s == null ? '' : s).trim();
    var m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(s))) return validYMD(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s))) {
      var y = +m[3]; if (m[3].length === 2) y += 2000;
      return validYMD(y, +m[2], +m[1]);
    }
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return validYMD(+m[1], +m[2], +m[3]);
    return null;
  }
  function isAmount(s) {
    s = String(s == null ? '' : s).trim();
    if (!s || s.length > 22 || !/\d/.test(s)) return false;
    if (/^\d{9,}$/.test(s)) return false; // références, numéros
    if (parseDate(s)) return false;
    return !isNaN(parseNumber(s));
  }

  /* ---------- Analyse : où sont la date, le libellé, le montant ? ---------- */
  function analyze(text) {
    var delim = detectDelimiter(text);
    var rows = parse(text, delim).filter(function (r) {
      return r.some(function (c) { return c !== ''; });
    });
    if (!rows.length) return { ok: false, error: 'Le fichier est vide' };

    var qual = rows.map(function (r) {
      var d = false, a = false;
      for (var j = 0; j < r.length; j++) {
        if (parseDate(r[j])) d = true; else if (isAmount(r[j])) a = true;
      }
      return d && a;
    });
    var first = -1, bestLen = 0, i = 0;
    while (i < rows.length) {
      if (qual[i]) {
        var s = i;
        while (i < rows.length && qual[i]) i++;
        if (i - s > bestLen) { bestLen = i - s; first = s; }
      } else i++;
    }
    if (first < 0) return { ok: false, error: 'Aucune ligne avec une date et un montant trouvée' };

    var headerIdx = -1;
    for (i = first - 1; i >= 0; i--) {
      if (rows[i].filter(Boolean).length >= 2) {
        var hasDate = rows[i].some(function (c) { return !!parseDate(c); });
        if (!hasDate) headerIdx = i;
        break;
      }
    }

    var data = rows.slice(first);
    var ncols = 0;
    data.forEach(function (r) { if (r.length > ncols) ncols = r.length; });
    var hdr = function (c) { return headerIdx >= 0 ? norm(rows[headerIdx][c] || '') : ''; };

    var stats = [];
    for (var c = 0; c < ncols; c++) {
      var dc = 0, ac = 0, len = 0, ne = 0;
      data.forEach(function (r) {
        var v = r[c] || '';
        if (v) { ne++; len += v.length; }
        if (parseDate(v)) dc++; else if (isAmount(v)) ac++;
      });
      stats.push({ dateR: dc / data.length, amtN: ac, amtR: ac / data.length, avgLen: ne ? len / ne : 0 });
    }

    // Date
    var dateCols = [];
    for (c = 0; c < ncols; c++) if (stats[c].dateR >= 0.6) dateCols.push(c);
    var dateCol = -1;
    dateCols.forEach(function (k) {
      if (dateCol < 0 && /comptab|booking|buchung|operation|^date$|datum/.test(hdr(k)) && !/valeur|valuta|value/.test(hdr(k))) dateCol = k;
    });
    if (dateCol < 0 && dateCols.length) dateCol = dateCols[0];

    // Montants
    var isBal = function (k) { return /solde|saldo|balance|kontostand/.test(hdr(k)); };
    var debitCol = -1, creditCol = -1, amountCol = -1;
    for (c = 0; c < ncols; c++) {
      if (c === dateCol || stats[c].amtN === 0) continue;
      var h = hdr(c);
      if (debitCol < 0 && /debit|soll|retrait|sortie|belastung/.test(h)) debitCol = c;
      else if (creditCol < 0 && /credit|haben|versement|entree|gutschrift|encaissement/.test(h)) creditCol = c;
    }
    var mode = 'signed';
    if (debitCol >= 0 && creditCol >= 0) {
      mode = 'split';
    } else {
      debitCol = -1; creditCol = -1;
      var cands = [];
      for (c = 0; c < ncols; c++) {
        if (c !== dateCol && stats[c].amtR >= 0.5 && !isBal(c)) cands.push(c);
      }
      cands.forEach(function (k) {
        if (amountCol < 0 && /montant|amount|betrag/.test(hdr(k))) amountCol = k;
      });
      if (amountCol < 0 && cands.length) amountCol = cands[0];
    }

    // Libellé
    var used = {};
    [dateCol, amountCol, debitCol, creditCol].forEach(function (k) { if (k >= 0) used[k] = 1; });
    var descCol = -1, rest = [];
    for (c = 0; c < ncols; c++) {
      if (used[c] || isBal(c) || stats[c].dateR >= 0.6 || stats[c].amtR >= 0.5) continue;
      rest.push(c);
    }
    rest.forEach(function (k) {
      if (descCol < 0 && /texte|libelle|description|detail|beneficiaire|motif|text|avis|intitule|communication|mitteilung|verwendungszweck/.test(hdr(k))) descCol = k;
    });
    if (descCol < 0 && rest.length) {
      descCol = rest.reduce(function (best, k) { return stats[k].avgLen > stats[best].avgLen ? k : best; }, rest[0]);
    }

    var headers = [];
    for (c = 0; c < ncols; c++) {
      var label = headerIdx >= 0 && rows[headerIdx][c] ? rows[headerIdx][c] : 'Colonne ' + (c + 1);
      var sample = (data[0] && data[0][c]) ? String(data[0][c]).slice(0, 16) : '';
      headers.push(label + (sample ? ' (' + sample + ')' : ''));
    }

    var map = { date: dateCol, desc: descCol, mode: mode, amount: amountCol, debit: debitCol, credit: creditCol, invert: false };
    var confident = dateCol >= 0 && descCol >= 0 && (mode === 'split' || amountCol >= 0);
    return { ok: true, delim: delim, rows: rows, headerIdx: headerIdx, firstDataIdx: first, ncols: ncols, headers: headers, map: map, confident: confident };
  }

  /* ---------- Lignes -> mouvements ---------- */
  function records(rows, first, map) {
    var out = [];
    for (var i = first; i < rows.length; i++) {
      var r = rows[i];
      var date = map.date >= 0 ? parseDate(r[map.date] || '') : null;
      if (!date) continue;
      var amt;
      if (map.mode === 'split') {
        var c = map.credit >= 0 ? parseNumber(r[map.credit] || '') : NaN;
        var d = map.debit >= 0 ? parseNumber(r[map.debit] || '') : NaN;
        amt = (isNaN(c) ? 0 : Math.abs(c)) - (isNaN(d) ? 0 : Math.abs(d));
      } else {
        var v = map.amount >= 0 ? parseNumber(r[map.amount] || '') : NaN;
        amt = isNaN(v) ? 0 : v;
      }
      if (map.invert) amt = -amt;
      amt = Math.round(amt * 100) / 100;
      if (!amt) continue;
      out.push({
        date: date,
        amount: amt,
        desc: (map.desc >= 0 ? (r[map.desc] || '') : '').replace(/\s+/g, ' ').trim()
      });
    }
    return out;
  }

  /* ---------- Catégorisation ---------- */
  var RULES = [
    ['Charges prévues', /loyer|hypoth|impot|contribution|steuer|serafe|billag|lamal|\bprimes?\b|assurance|versicherung|helsana|\bcss\b|groupe mutuel|sanitas|visana|assura\b|swica|concordia|mobiliere|\baxa\b|vaudoise|generali|helvetia|allianz|swiss life|baloise|swisscom|sunrise|salt mobile|romande energie|electricite|energie|3e pilier|pilier 3a|prevoyance|pensionskasse|caisse de pension/],
    ['Transport', /\bcff\b|\bsbb\b|transports publics|postauto|carpostal|parking|parkplatz|autoroute|vignette|\buber\b|taxi|\bbolt\b|mobility|swisspass|flixbus|blablacar|easypark|pay by phone|\bshell\b|\bavia\b|\bbp\b|migrol|tamoil|\besso\b|station[- ]service|tankstelle|garage/],
    ['Santé', /pharmacie|amavita|sun ?store|apotheke|medecin|\bdr\.?\s|docteur|cabinet medical|hopital|spital|clinique|dentiste|zahnarzt|physio|osteo|opticien|visilab|laboratoire|medisuisse|hirslanden/],
    ['Animaux', /veterinaire|\bvet\b|qualipet|fressnapf|zooplus|animalerie|\bzoo\b|tierarzt|animal/],
    ['Courses', /migros|\bcoop\b|denner|\baldi\b|\blidl\b|manor food|\bvolg\b|\bspar\b|epicerie|boulangerie|boucherie|primeur|fromagerie|\bpam\b|\bmpreis\b/],
    ['Sorties', /restaurant|resto\b|cafe\b|\bbar\b|pizz|brasserie|mcdonald|burger|kebab|sushi|starbucks|cinema|pathe|\bkino\b|theatre|concert|ticketcorner|starticket|just eat|uber eats|smood|bistro|snack|\bpub\b|\bclub\b|hotel|airbnb|booking\.com/],
    ['Maison', /ikea|jumbo|bauhaus|hornbach|conforama|micasa|landi|digitec|galaxus|\bfust\b|interdiscount|melectronics|brico|\bobi\b|pfister|meubles/]
  ];
  var INTERNAL = /virement (interne|entre comptes)|transfert (interne|entre)|compte d.?epargne|\bepargne\b|uebertrag|eigenes konto|eigene konten/;
  var STOP = {};
  ('paiement carte cartes achat debit credit twint ebanking virement ordre permanent lsv retrait bancomat '
    + 'maestro mastercard visa bcvs point vente pos sarl gmbh').split(' ').forEach(function (w) { STOP[w] = 1; });

  function merchantKey(desc) {
    var words = norm(desc).replace(/[^a-z\s]/g, ' ').split(' ').filter(function (w) {
      return w.length >= 3 && !STOP[w];
    });
    return words.slice(0, 2).join(' ');
  }

  function categorize(desc, amount, rules, incCats, expCats) {
    var n = norm(desc);
    var allowed = amount > 0 ? incCats : expCats;
    var k, parts;
    for (k in (rules || {})) {
      parts = k.split(' ');
      if (parts.every(function (w) { return n.indexOf(w) !== -1; }) && allowed.indexOf(rules[k]) !== -1) return rules[k];
    }
    if (amount > 0) {
      if (/salaire|\blohn\b|gehalt/.test(n)) return 'Salaire';
      if (/remboursement|rueckerstattung|storno/.test(n)) return 'Remboursement';
      return 'Extra';
    }
    for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(n)) return RULES[i][0];
    return 'Autre';
  }

  function isInternal(desc) { return INTERNAL.test(norm(desc)); }

  var api = {
    decode: decode, parse: parse, detectDelimiter: detectDelimiter,
    parseNumber: parseNumber, parseDate: parseDate, isAmount: isAmount,
    analyze: analyze, records: records, categorize: categorize,
    merchantKey: merchantKey, isInternal: isInternal, norm: norm
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BudgetCSV = api;
})(typeof window !== 'undefined' ? window : this);
