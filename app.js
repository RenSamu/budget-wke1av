(function () {
  'use strict';

  /* ---------- Constantes ---------- */
  var KEY = 'budget.v1';
  // « Charges prévues » = déjà couvertes par le prévisionnel : elles ne réduisent pas le reste à vivre.
  // « Salaire » = déjà compté dans les revenus mensuels : il n'ajoute rien au disponible.
  var PLANNED = 'Charges prévues';
  var SALARY = 'Salaire';
  var CATS_EXP = ['Courses', 'Sorties', 'Transport', 'Santé', 'Animaux', 'Maison', PLANNED, 'Autre'];
  var CATS_INC = ['Extra', 'Remboursement', SALARY, 'Autre'];
  var P = window.BudgetPlan;
  var PROV_CATS = P.CATS;
  var MS = P.MS;
  var ML = P.ML;
  var P3_CAP_DEFAULT = 7258; // à vérifier chaque année (petit 3a, salarié affilié à une caisse de pension)

  /* ---------- Utilitaires ---------- */
  var root = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var fileInput = document.getElementById('file-import');
  var fileCsv = document.getElementById('file-csv');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function mkOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function parseDate(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function shortDate(d) { return d.getDate() + ' ' + MS[d.getMonth()]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function thousands(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, '’'); }
  function f0(n) { return (n < 0 ? '−' : '') + thousands(String(Math.round(Math.abs(n)))); }
  function f2(n) {
    var p = Math.abs(n).toFixed(2).split('.');
    return (n < 0 ? '−' : '') + thousands(p[0]) + '.' + p[1];
  }
  function num(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[’'\s]/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function sum(arr, fn) { return arr.reduce(function (a, x) { return a + fn(x); }, 0); }
  function relDate(s) {
    var t = ymd(new Date());
    if (s === t) return 'aujourd’hui';
    var y = new Date(); y.setDate(y.getDate() - 1);
    if (s === ymd(y)) return 'hier';
    return shortDate(parseDate(s));
  }
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  var ICONS = {
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
    chart: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>'
  };
  function icon(n, size) {
    var s = size || 22;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>';
  }

  /* ---------- Données ---------- */
  function emptyState() { return { v: 1, income: 0, items: [], tx: [], p3: null, lastExport: null, rules: {}, reserve: 0 }; }
  function normState(r) {
    if (!r.rules) r.rules = {};
    if (typeof r.reserve !== 'number' || !(r.reserve >= 0)) r.reserve = 0;
    var y = new Date().getFullYear();
    r.items = r.items.map(function (it) { return P.migrateItem(it, y); });
    return r;
  }
  function load() {
    try {
      var r = JSON.parse(localStorage.getItem(KEY));
      if (r && r.v === 1 && Array.isArray(r.items) && Array.isArray(r.tx)) return normState(r);
    } catch (e) { /* ignore */ }
    return emptyState();
  }
  var S = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('Sauvegarde impossible sur cet appareil'); }
  }

  var ui = { route: 'home', planView: 'list', month: mkOf(new Date()), sheet: null, bilanYear: new Date().getFullYear(), bilanMonth: null };

  /* ---------- Calculs ---------- */
  function totals() {
    var mon = S.items.filter(P.isMonthly);
    var prov = S.items.filter(function (i) { return !P.isMonthly(i); });
    var annual = sum(prov, P.annualCost);
    return {
      annualTotal: annual,
      prov: annual / 12,
      fixed: sum(mon, function (i) { return i.amount; })
    };
  }
  function monthStats(mk) {
    var tx = S.tx.filter(function (t) { return t.date.indexOf(mk) === 0; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.ts < b.ts ? 1 : -1); });
    var spent = sum(tx.filter(function (t) { return t.kind === 'expense' && t.cat !== PLANNED; }), function (t) { return t.amount; });
    var planned = sum(tx.filter(function (t) { return t.kind === 'expense' && t.cat === PLANNED; }), function (t) { return t.amount; });
    var extra = sum(tx.filter(function (t) { return t.kind === 'income' && t.cat !== SALARY; }), function (t) { return t.amount; });
    var T = totals();
    var available = S.income - T.fixed - T.prov + extra;
    return { tx: tx, spent: spent, planned: planned, extra: extra, fixed: T.fixed, prov: T.prov, available: available, rest: available - spent };
  }
  function curYM() { var n = new Date(); return { y: n.getFullYear(), m: n.getMonth() + 1 }; }
  function isPaid(id, occ) {
    return S.tx.some(function (t) { return t.item === id && t.occ === occ; });
  }
  // Échéances à venir (et récemment dépassées) non encore marquées payées.
  function dueList(daysBack, daysAhead) {
    var now = new Date(), t0 = parseDate(ymd(now));
    var from = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - daysBack);
    var to = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + daysAhead);
    var curIdx = now.getFullYear() * 12 + now.getMonth() + 1;
    var out = [];
    S.items.forEach(function (it) {
      if (P.isMonthly(it) || !P.isScheduled(it)) return;
      P.occurrencesBetween(it, from, to, now.getFullYear()).forEach(function (o) {
        if (isPaid(it.id, o.key)) return;
        var days = Math.round((o.date - t0) / 864e5);
        var overdue = o.dayKnown ? days < 0 : (o.y * 12 + o.m) < curIdx;
        out.push({ it: it, o: o, days: days, overdue: overdue });
      });
    });
    out.sort(function (a, b) { return a.o.date - b.o.date; });
    return out;
  }
  function togglePaid(id, occ) {
    var it = S.items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    var ex = S.tx.filter(function (t) { return t.item === id && t.occ === occ; })[0];
    if (ex) {
      S.tx = S.tx.filter(function (t) { return t !== ex; });
      toast('Paiement retiré');
    } else {
      if (!it.amount) { toast('Renseigne d’abord le montant'); openItem(id); return; }
      S.tx.push({ id: uid(), kind: 'expense', amount: it.amount, cat: PLANNED, date: ymd(new Date()), note: it.name, ts: Date.now(), item: id, occ: occ });
      toast('Marquée payée · ' + f0(it.amount) + ' CHF');
    }
    save();
    render();
  }

  /* ---------- Vues ---------- */
  function tabsHTML() {
    function tab(r, ic, label) {
      return '<button class="tab' + (ui.route === r ? ' on' : '') + '" data-a="go" data-r="' + r + '" aria-label="' + label + '">' + icon(ic) + '<span>' + label + '</span></button>';
    }
    return '<nav class="tabs">' +
      tab('home', 'home', 'Accueil') +
      tab('bilan', 'chart', 'Bilan') +
      '<button class="fab" data-a="new-tx" aria-label="Saisir une dépense ou un revenu">' + icon('plus', 24) + '</button>' +
      tab('plan', 'cal', 'Prévisionnel') +
      tab('settings', 'gear', 'Réglages') +
      '</nav>';
  }

  function txRowHTML(t) {
    var inc = t.kind === 'income';
    return '<button class="row" data-a="edit-tx" data-id="' + esc(t.id) + '">' +
      '<div class="l"><span class="n">' + esc(t.note || t.cat) + '</span><span class="s">' + esc(t.cat) + ' · ' + esc(relDate(t.date)) + '</span></div>' +
      '<span class="r' + (inc ? ' pos' : '') + '">' + (inc ? '+' : '−') + f2(t.amount) + '</span></button>';
  }

  function homeHTML() {
    var now = new Date();
    var isCur = ui.month === mkOf(now);
    var p = ui.month.split('-').map(Number);
    var label = cap(new Date(p[0], p[1] - 1, 1).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' }));
    var st = monthStats(ui.month);
    var daysLeft = isCur ? new Date(p[0], p[1], 0).getDate() - now.getDate() : null;
    var pct = st.available > 0 ? Math.max(0, Math.min(1, st.rest / st.available)) : 0;
    var setup = S.income === 0 && S.items.length === 0;
    var h = '';

    h += '<div class="top"><div class="month-nav">' +
      '<button class="icon-btn" data-a="month" data-d="-1" aria-label="Mois précédent">' + icon('left') + '</button>' +
      '<span class="title">' + esc(label) + '</span>' +
      '<button class="icon-btn" data-a="month" data-d="1" aria-label="Mois suivant"' + (isCur ? ' disabled' : '') + '>' + icon('right') + '</button>' +
      '</div></div>';

    if (setup) {
      h += '<div class="card"><h3>Pour commencer</h3>' +
        '<p class="md muted" style="line-height:1.5">Renseigne tes revenus et tes charges dans le prévisionnel : l’app calcule ce qu’il reste pour vivre chaque mois.</p>' +
        '<button class="cta" data-a="go" data-r="plan">Ouvrir le prévisionnel</button></div>';
    }

    h += '<div class="hero"><span class="md muted">Reste à vivre ce mois</span>' +
      '<div class="amount"><span class="num' + (st.rest < 0 ? ' neg' : '') + '">' + f0(st.rest) + '</span><span class="cur">CHF</span></div>' +
      '<span class="md muted">sur ' + f0(st.available) + ' disponibles' + (daysLeft != null ? ' · ' + daysLeft + ' jour' + (daysLeft > 1 ? 's' : '') + ' restant' + (daysLeft > 1 ? 's' : '') : '') + '</span>' +
      '<div class="bar"><div style="width:' + Math.round(pct * 100) + '%"></div></div></div>';

    h += '<div class="stats">' +
      '<div class="stat"><span class="sm muted">Revenus</span><span class="v">' + f0(S.income + st.extra) + '</span></div>' +
      '<div class="stat"><span class="sm muted">Fixes &amp; provisions</span><span class="v">' + f0(st.fixed + st.prov) + '</span></div>' +
      '<div class="stat"><span class="sm muted">Dépensé</span><span class="v">' + f0(st.spent) + '</span></div></div>';

    if (isCur) {
      var t0 = parseDate(ymd(now));
      var due = dueList(30, 60);
      var shown = due.slice(0, 4);
      var rows = shown.map(function (x) {
        var o = x.o, when;
        if (x.overdue) when = '<span class="neg">En retard · ' + esc(o.dayKnown ? shortDate(o.date) : ML[o.m - 1]) + '</span>';
        else if (o.dayKnown) when = esc(x.days === 0 ? 'aujourd’hui' : x.days === 1 ? 'demain' : shortDate(o.date));
        else when = esc(o.y === now.getFullYear() && o.m === now.getMonth() + 1 ? 'ce mois-ci' : 'en ' + ML[o.m - 1]);
        return '<div class="row" style="min-height:52px"><div class="l"><span class="n">' + esc(x.it.name) + '</span><span class="s">' + when + '</span></div>' +
          '<div class="rr"><span class="r">' + (x.it.amount ? f0(x.it.amount) : '—') + '</span>' +
          '<button class="pay-btn" data-a="pay" data-id="' + esc(x.it.id) + '" data-occ="' + o.key + '">Payé</button></div></div>';
      });
      if (S.p3 && S.p3.cap - S.p3.paid > 0) {
        var end = new Date(now.getFullYear(), 11, 31);
        var dd = Math.round((end - t0) / 864e5);
        rows.push('<div class="row" style="min-height:0"><div class="l"><span class="n">3e pilier (3a)</span><span class="s warn">Avant le 31 déc. · ' + f0(S.p3.cap - S.p3.paid) + ' restants' + (dd <= 60 ? ' · ' + dd + ' j' : '') + '</span></div><span class="r">' + f0(S.p3.paid) + ' / ' + f0(S.p3.cap) + '</span></div>');
      }
      if (rows.length) {
        h += '<div class="card"><h3>À venir</h3>' + rows.join('<div class="divider"></div>') +
          (due.length > shown.length ? '<button class="link" style="text-align:left" data-a="plan-view" data-v="cal">Voir le calendrier · ' + (due.length - shown.length) + ' autre' + (due.length - shown.length > 1 ? 's' : '') + '</button>' : '') + '</div>';
      }
    }

    h += '<div class="group"><span class="section-title">' + (isCur ? 'Récent' : 'Mouvements') + '</span>';
    if (st.tx.length) {
      h += '<div class="list">' + st.tx.slice(0, 12).map(txRowHTML).join('') + '</div>';
    } else {
      h += '<p class="empty">Aucun mouvement ce mois-ci.<br>Touche + pour en ajouter, ou importe un relevé dans Réglages.</p>';
    }
    h += '</div>';
    return h;
  }

  function itemRowHTML(it) {
    var mon = P.isMonthly(it), sched = P.isScheduled(it);
    var sub;
    if (!it.amount) sub = 'Montant à renseigner';
    else if (!sched && !mon) sub = f0(it.amount) + (it.everyYears > 1 ? ' tous les ' + it.everyYears + ' ans' : ' par an') + ' · échéance à planifier';
    else sub = f0(it.amount) + ' · ' + P.describe(it);
    var right = !it.amount ? '—' : f0(mon ? it.amount : P.annualCost(it) / 12) + '<small>/ mois</small>';
    var warnIt = !it.amount || (!sched && !mon);
    return '<button class="row" data-a="edit-item" data-id="' + esc(it.id) + '">' +
      '<div class="l"><span class="n">' + esc(it.name) + '</span><span class="s' + (warnIt ? ' warn' : '') + '">' + esc(sub) + '</span></div>' +
      '<span class="r">' + right + '</span></button>';
  }

  function planHTML() {
    var T = totals(), now = curYM();
    var cf = P.cashflow(S.items, now.y, now.m, S.reserve, now.y);
    var h = '<div class="top"><span style="font-size:15px;font-weight:600;letter-spacing:-0.01em">Prévisionnel</span></div>';
    h += '<div class="seg full"><button class="' + (ui.planView !== 'cal' ? 'on' : '') + '" data-a="plan-view" data-v="list">Charges</button>' +
      '<button class="' + (ui.planView === 'cal' ? 'on' : '') + '" data-a="plan-view" data-v="cal">Calendrier</button></div>';
    h += ui.planView === 'cal' ? planCalHTML(cf, now) : planListHTML(T, cf);
    return h;
  }

  function minLabel(cf, now) {
    var r = cf.minRow;
    if (!r) return '';
    return ML[r.m - 1] + (r.y !== now.y ? ' ' + r.y : '');
  }

  function planListHTML(T, cf) {
    var free = S.income - T.fixed - T.prov;
    var now = curYM();
    var h = '<div class="hero"><span class="md muted">À mettre de côté chaque mois</span>' +
      '<div class="amount"><span class="num mid">' + f0(T.prov) + '</span><span class="cur">CHF / mois</span></div>' +
      '<span class="md muted">pour ' + f0(T.annualTotal) + ' de charges irrégulières par an</span></div>';

    if (S.income > 0) {
      h += '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<div class="stack"><div style="flex:' + T.fixed + ' 1 0;background:var(--track-a)"></div>' +
        '<div style="flex:' + T.prov + ' 1 0;background:var(--accent)"></div>' +
        '<div style="flex:' + Math.max(free, 0) + ' 1 0;background:var(--track-c)"></div></div>' +
        '<div class="stats">' +
        '<div class="stat"><span class="sm muted">Charges fixes</span><span class="v" style="font-size:14px">' + f0(T.fixed) + '</span></div>' +
        '<div class="stat"><span class="sm muted">Provisions</span><span class="v" style="font-size:14px">' + f0(T.prov) + '</span></div>' +
        '<div class="stat"><span class="sm muted">Quotidien</span><span class="v' + (free < 0 ? ' neg' : '') + '" style="font-size:14px">' + f0(free) + '</span></div></div>' +
        '<button class="link" style="text-align:left;min-height:32px" data-a="edit-income">Sur ' + f0(S.income) + ' de revenus mensuels · modifier</button></div>';
    } else {
      h += '<button class="ghost" data-a="edit-income">Renseigner mes revenus mensuels</button>';
    }

    // Résumé de trésorerie
    if (cf.scheduledAnnual > 0 || cf.unscheduledItems.length) {
      h += '<button class="card" style="text-align:left" data-a="plan-view" data-v="cal"><h3>Factures des 12 prochains mois</h3>';
      if (cf.scheduledAnnual > 0) {
        h += cf.covered
          ? '<p class="md">Toutes tes factures planifiées sont couvertes : ' + f0(cf.billsTotal) + ' CHF à payer.</p>'
          : '<p class="md warn">Il manquerait ' + f0(cf.neededReserve) + ' CHF en ' + esc(minLabel(cf, now)) + '. Mets ' + f0(cf.recommended) + ' CHF de côté par mois pour éviter le découvert.</p>';
      }
      if (cf.unscheduledItems.length) {
        h += '<p class="sm muted">' + cf.unscheduledItems.length + ' charge' + (cf.unscheduledItems.length > 1 ? 's' : '') + ' sans échéance : lissée' + (cf.unscheduledItems.length > 1 ? 's' : '') + ' sur 12 mois mais absente' + (cf.unscheduledItems.length > 1 ? 's' : '') + ' du calendrier.</p>';
      }
      h += '<span class="link" style="min-height:0">Voir le calendrier</span></button>';
    }

    var prov = S.items.filter(function (i) { return !P.isMonthly(i); });
    var mon = S.items.filter(P.isMonthly);
    var cats = PROV_CATS.slice();
    prov.forEach(function (i) { if (cats.indexOf(i.cat) === -1) cats.push(i.cat); });
    function ord(it) { return it.months.length ? it.months[0] : 13; }
    cats.forEach(function (c) {
      var list = prov.filter(function (i) { return i.cat === c; }).sort(function (a, b) { return ord(a) - ord(b); });
      if (!list.length) return;
      h += '<div class="group"><span class="section-title">' + esc(c) + ' <span class="muted" style="font-weight:400">· ' + f0(sum(list, P.annualCost)) + ' / an</span></span><div class="list">' + list.map(itemRowHTML).join('') + '</div></div>';
    });
    if (mon.length) {
      h += '<div class="group"><span class="section-title">Charges fixes mensuelles <span class="muted" style="font-weight:400">· ' + f0(T.fixed) + ' / mois</span></span><div class="list">' + mon.map(itemRowHTML).join('') + '</div></div>';
    }
    if (!S.items.length) {
      h += '<p class="empty">Aucune charge pour l’instant.<br>Pioche dans la bibliothèque suisse et valaisanne : impôts, Serafe, chien, véhicule, 3e pilier…</p>';
    }

    // 3e pilier
    if (S.p3) {
      var pc = Math.max(0, Math.min(1, S.p3.cap > 0 ? S.p3.paid / S.p3.cap : 0));
      h += '<div class="card"><h3>3e pilier (3a) cette année</h3>' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:22px;font-weight:600;letter-spacing:-0.02em">' + f0(S.p3.paid) + '</span><span class="md muted">sur ' + f0(S.p3.cap) + ' CHF</span></div>' +
        '<div class="bar" style="margin-top:0"><div style="width:' + Math.round(pc * 100) + '%"></div></div>' +
        '<span class="sm muted">Versement possible jusqu’au 31 décembre. Vérifie ton plafond selon ta situation.</span>' +
        '<button class="ghost" data-a="edit-p3">Mettre à jour</button></div>';
    } else {
      h += '<button class="ghost" data-a="edit-p3">Suivre mon 3e pilier (3a)</button>';
    }

    h += '<div class="actions"><button class="cta" data-a="lib">Ajouter une charge</button>' +
      '<button class="ghost" data-a="new-item">Charge personnalisée</button></div>';
    return h;
  }

  function planCalHTML(cf, now) {
    if (!S.items.length) {
      return '<p class="empty">Le calendrier se remplit dès que tu ajoutes des charges avec leur échéance.</p>' +
        '<div class="actions"><button class="cta" data-a="lib">Ajouter une charge</button></div>';
    }
    var h = '<div class="card"><h3>Trésorerie</h3><div class="stats">' +
      '<div class="stat"><span class="sm muted">Mis de côté</span><span class="v">' + f0(cf.setAside) + '<small class="muted" style="font-size:11px;font-weight:400"> /mois</small></span></div>' +
      '<button class="stat" style="text-align:left" data-a="edit-reserve"><span class="sm muted">Réserve ›</span><span class="v">' + f0(S.reserve) + '</span></button>' +
      '<div class="stat"><span class="sm muted">Point bas</span><span class="v' + (cf.min < -0.005 ? ' neg' : '') + '">' + f0(cf.min) + '</span></div></div>';
    if (cf.scheduledAnnual > 0) {
      h += cf.covered
        ? '<p class="md" style="line-height:1.5">Avec ' + f0(S.reserve) + ' de réserve et ' + f0(cf.setAside) + ' mis de côté par mois, toutes les factures des 12 prochains mois sont couvertes. Point le plus bas : ' + esc(minLabel(cf, now)) + '.</p>'
        : '<p class="md warn" style="line-height:1.5">Il manquerait ' + f0(cf.neededReserve) + ' CHF en ' + esc(minLabel(cf, now)) + '. Pour l’éviter : mets ' + f0(cf.recommended) + ' CHF de côté par mois, ou constitue une réserve de ' + f0(S.reserve + cf.neededReserve) + ' CHF.</p>';
    } else {
      h += '<p class="md muted" style="line-height:1.5">Aucune facture planifiée pour l’instant. Indique les mois d’échéance de tes charges pour les voir ici.</p>';
    }
    if (cf.unscheduledAnnual > 0) {
      h += '<p class="sm muted" style="line-height:1.5">' + f0(cf.unscheduledAnnual) + ' CHF par an de charges sans échéance ne figurent pas dans ce calendrier.</p>';
    }
    h += '</div>';

    var max = 1;
    cf.rows.forEach(function (r) { max = Math.max(max, r.total); });
    var nextIdx = now.y * 12 + now.m;
    h += '<div class="group">';
    cf.rows.forEach(function (r, idx) {
      var showPay = r.y * 12 + r.m <= nextIdx + 1;
      h += '<div class="cm' + (idx === 0 ? ' cur' : '') + '"><div class="cm-h"><div class="l"><span class="n">' + esc(cap(ML[r.m - 1])) + ' ' + r.y + '</span><span class="s">' +
        (r.bills.length ? r.bills.length + ' facture' + (r.bills.length > 1 ? 's' : '') : 'Rien à payer') + '</span></div><span class="r">' + (r.total ? f0(r.total) : '—') + '</span></div>';
      if (r.total) h += '<div class="mini"><div style="width:' + Math.round(r.total / max * 100) + '%"></div></div>';
      r.bills.forEach(function (b) {
        var paid = isPaid(b.it.id, r.key);
        h += '<div class="row bill"><button class="l" data-a="edit-item" data-id="' + esc(b.it.id) + '"><span class="n">' + esc(b.it.name) + '</span><span class="s">' +
          esc(b.it.day ? b.it.day + ' ' + MS[r.m - 1] : 'jour à préciser') + '</span></button>' +
          '<div class="rr"><span class="r' + (paid ? ' muted' : '') + '">' + (b.amount ? f0(b.amount) : '—') + '</span>' +
          (showPay ? '<button class="pay-btn' + (paid ? ' on' : '') + '" data-a="pay" data-id="' + esc(b.it.id) + '" data-occ="' + r.key + '">' + (paid ? '✓ Payé' : 'Payé') + '</button>' : '') + '</div></div>';
      });
      h += '<div class="cm-f sm ' + (r.balance < -0.005 ? 'neg' : 'muted') + '">Provisions disponibles : ' + f0(r.balance) + ' CHF</div></div>';
    });
    h += '</div>';
    h += '<p class="sm muted" style="line-height:1.5">Hypothèse : tu mets de côté le même montant au début de chaque mois et les factures tombent pendant le mois. Les charges fixes mensuelles ne figurent pas ici : elles sortent de ton budget courant. Les dates sont celles que tu as saisies ; vérifie-les sur tes factures.</p>';
    return h;
  }

  function settingsHTML() {
    var le = S.lastExport ? 'le ' + shortDate(parseDate(S.lastExport)) : 'jamais';
    var h = '<div class="top"><span style="font-size:15px;font-weight:600;letter-spacing:-0.01em">Réglages</span></div>';
    h += '<div class="card"><h3>Importer un relevé bancaire</h3>' +
      '<p class="md muted" style="line-height:1.5">Exporte tes mouvements en CSV depuis le e-banking, puis charge le fichier ici. Le fichier est lu sur ton téléphone et n’est envoyé nulle part. Les doublons sont repérés, et l’app apprend tes catégories.</p>' +
      '<button class="cta" data-a="import-csv">Choisir un fichier CSV</button></div>';
    h += '<div class="card"><h3>Revenus mensuels nets</h3><div class="row" style="min-height:0"><span style="font-size:22px;font-weight:600;letter-spacing:-0.02em">' + f0(S.income) + ' <span class="md muted" style="font-weight:400">CHF</span></span><button class="link" data-a="edit-income">Modifier</button></div></div>';
    h += '<div class="card"><h3>Sauvegarde</h3>' +
      '<p class="md muted" style="line-height:1.5">Tes données restent uniquement sur cet appareil, dans le navigateur. Exporte-les régulièrement : vider le cache ou changer de téléphone les efface.</p>' +
      '<span class="sm muted">Dernière sauvegarde : ' + esc(le) + '</span>' +
      '<div class="actions" style="margin-top:0"><button class="cta" data-a="export">Exporter mes données</button>' +
      '<button class="ghost" data-a="import">Importer une sauvegarde</button></div></div>';
    h += '<button class="ghost danger" data-a="reset">Tout effacer</button>';
    h += '<p class="sm muted" style="text-align:center">Budget · V3</p>';
    return h;
  }

  /* ---------- Feuilles ---------- */
  function txSheetHTML() {
    var d = ui.sheet.data;
    var cats = d.kind === 'expense' ? CATS_EXP : CATS_INC;
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];
    var h = '<div class="overlay" role="dialog" aria-modal="true" aria-label="Saisie">' +
      '<div class="sheet-top"><button class="icon-btn close" data-a="close" aria-label="Fermer">' + icon('close') + '</button>' +
      '<div class="seg"><button class="' + (d.kind === 'expense' ? 'on' : '') + '" data-a="tx-kind" data-k="expense">Dépense</button>' +
      '<button class="' + (d.kind === 'income' ? 'on' : '') + '" data-a="tx-kind" data-k="income">Revenu</button></div><span class="spacer"></span></div>' +
      '<div class="amount-block"><span class="md muted">Montant</span>' +
      '<div class="hero"><div class="amount" style="justify-content:center"><span class="num">' + fmtInput(d.amount) + '</span><span class="cur">CHF</span></div></div></div>' +
      '<div class="chips">' + cats.map(function (c) {
        return '<button class="chip' + (c === d.cat ? ' on' : '') + '" data-a="tx-cat" data-c="' + esc(c) + '" aria-pressed="' + (c === d.cat) + '">' + esc(c) + '</button>';
      }).join('') + '</div>' +
      '<div class="meta"><input type="date" id="tx-date" value="' + esc(d.date) + '" aria-label="Date"><input type="text" id="tx-note" value="' + esc(d.note) + '" placeholder="Note (facultatif)" maxlength="60" aria-label="Note"></div>' +
      '<div class="keypad">' + keys.map(function (k) {
        return '<button data-a="key" data-k="' + k + '" aria-label="' + (k === 'del' ? 'Effacer' : k === ',' ? 'Virgule' : k) + '">' + (k === 'del' ? '⌫' : k) + '</button>';
      }).join('') + '</div>' +
      '<div class="actions"><button class="cta" data-a="tx-save">Enregistrer</button>' +
      (d.id ? '<button class="ghost danger" data-a="tx-del">Supprimer</button>' : '') + '</div></div>';
    return h;
  }
  function fmtInput(a) {
    var p = a.split('.');
    return thousands(p[0]) + (p.length > 1 ? ',' + p[1] : '');
  }

  /* Formulaire d'une charge */
  function reAmount(d) {
    if (d.mode === 'year') d.amount = d.total * (d.everyYears || 1) / Math.max(1, d.months.length);
  }
  function syncItemForm(f) {
    var d = ui.sheet && ui.sheet.data;
    f = f || root.querySelector('form[data-form="item"]');
    if (!d || !f) return;
    var g = function (n) { var el = f.elements[n]; return el ? el.value : null; };
    if (g('name') !== null) d.name = g('name');
    if (g('cat')) d.cat = g('cat');
    if (g('note') !== null) d.note = g('note');
    var ev = Number(g('every'));
    if (ev > 0) d.everyYears = ev;
    if (g('day') !== null) {
      var dy = parseInt(g('day'), 10);
      d.day = isFinite(dy) ? Math.max(0, Math.min(31, dy)) : 0;
    }
    if (g('anchor') !== null) {
      var an = parseInt(g('anchor'), 10);
      if (an > 1900 && an < 2200) d.anchorYear = an;
    }
    if (g('amount') !== null) {
      var v = Math.max(0, num(g('amount')));
      if (d.mode === 'year') { d.total = v; reAmount(d); } else d.amount = v;
    }
  }
  function applyPreset(d, kind) {
    var first = d.months.length ? d.months[0] : new Date().getMonth() + 1, m;
    if (kind === 'monthly') m = P.ALL.slice();
    else if (kind === 'quarter') { var s3 = ((first - 1) % 3) + 1; m = [s3, s3 + 3, s3 + 6, s3 + 9]; }
    else if (kind === 'half') { var s6 = ((first - 1) % 6) + 1; m = [s6, s6 + 6]; }
    else if (kind === 'year') m = [first];
    else m = [];
    d.months = m;
    reAmount(d);
  }
  function itemPreviewHTML() {
    var d = ui.sheet.data, mon = P.isMonthly(d), ann = P.annualCost(d), y = new Date().getFullYear();
    var h = '<span style="font-size:14px;font-weight:600">' + esc(P.describe(d)) + '</span>';
    if (d.amount > 0) {
      h += mon
        ? '<span class="md">' + f0(d.amount) + ' CHF par mois, prélevés directement sur ton budget courant.</span>'
        : '<span class="md">' + f0(ann) + ' CHF par an · ' + f0(ann / 12) + ' CHF à mettre de côté chaque mois.</span>';
    } else {
      h += '<span class="md muted">Renseigne le montant pour calculer la provision.</span>';
    }
    if (P.isScheduled(d) && !mon) {
      var nx = P.nextOccurrence(d, new Date(), y);
      if (nx) h += '<span class="sm muted">Prochaine échéance : ' + esc(d.day ? nx.date.getDate() + ' ' + ML[nx.m - 1] + ' ' + nx.y : ML[nx.m - 1] + ' ' + nx.y) + '</span>';
    } else if (!P.isScheduled(d)) {
      h += '<span class="sm muted">Sans mois d’échéance, la charge est lissée sur 12 mois mais n’apparaît pas dans le calendrier.</span>';
    }
    return h;
  }

  function itemSheetHTML() {
    var d = ui.sheet.data, yr = d.mode === 'year';
    var cats = PROV_CATS.concat(PROV_CATS.indexOf(d.cat) === -1 ? [d.cat] : []);
    var catOpts = cats.map(function (c) { return '<option' + (c === d.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var evs = [1, 2, 3, 4, 5, 10];
    if (evs.indexOf(d.everyYears) === -1) evs.push(d.everyYears);
    var everyOpts = evs.map(function (n) {
      return '<option value="' + n + '"' + (n === d.everyYears ? ' selected' : '') + '>' + (n === 1 ? 'Chaque année' : 'Tous les ' + n + ' ans') + '</option>';
    }).join('');
    var monthChips = MS.map(function (l, i) {
      var on = d.months.indexOf(i + 1) !== -1;
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-a="month-tog" data-m="' + (i + 1) + '" aria-pressed="' + on + '">' + esc(cap(l)) + '</button>';
    }).join('');
    var presets = [['monthly', 'Chaque mois'], ['quarter', 'Trimestriel'], ['half', 'Semestriel'], ['year', 'Une fois par an'], ['none', 'Aucun']].map(function (x) {
      return '<button type="button" class="chip" data-a="preset" data-p="' + x[0] + '">' + x[1] + '</button>';
    }).join('');
    var amountVal = yr ? d.total : d.amount;
    return '<form class="overlay form" data-form="item" role="dialog" aria-modal="true" aria-label="Charge">' +
      '<div class="sheet-top"><button type="button" class="icon-btn close" data-a="close" aria-label="Fermer">' + icon('close') + '</button><h2>' + (d.id ? 'Modifier la charge' : 'Nouvelle charge') + '</h2><span class="spacer"></span></div>' +
      '<label>Nom<input class="field" name="name" required maxlength="70" value="' + esc(d.name) + '"></label>' +
      '<label>Catégorie<select class="field" name="cat">' + catOpts + '</select></label>' +
      '<div class="form-sec"><span class="lbl">Quand est-elle facturée ?</span><div class="chips">' + presets + '</div><div class="mgrid">' + monthChips + '</div>' +
      '<p class="hint">Touche les mois d’échéance. Plusieurs mois = plusieurs factures par an (acomptes d’impôts, primes trimestrielles).</p></div>' +
      '<label>Jour du mois (facultatif)<input class="field" name="day" type="number" inputmode="numeric" min="1" max="31" placeholder="Ex. 31" value="' + (d.day ? d.day : '') + '"></label>' +
      '<label>Récurrence<select class="field" name="every">' + everyOpts + '</select></label>' +
      (d.everyYears > 1 ? '<label>Première échéance : année<input class="field" name="anchor" type="number" inputmode="numeric" min="1900" max="2200" value="' + esc(String(d.anchorYear || new Date().getFullYear())) + '"></label>' : '') +
      '<div class="form-sec"><span class="lbl">Montant</span><div class="seg full"><button type="button" class="' + (yr ? '' : 'on') + '" data-a="amt-mode" data-m="pay">Par facture</button><button type="button" class="' + (yr ? 'on' : '') + '" data-a="amt-mode" data-m="year">Total annuel</button></div>' +
      '<input class="field" name="amount" inputmode="decimal" aria-label="Montant en CHF" value="' + esc(amountVal ? String(Math.round(amountVal * 100) / 100) : '') + '" placeholder="0">' +
      '<p class="hint">' + (yr ? 'Le total est réparti automatiquement sur les mois choisis.' : 'Montant d’une facture, en CHF. Le total annuel est calculé pour toi.') + '</p></div>' +
      '<label>Note (facultatif)<textarea class="field" name="note" maxlength="300" rows="3">' + esc(d.note || '') + '</textarea></label>' +
      '<div class="card" id="item-prev" style="gap:6px">' + itemPreviewHTML() + '</div>' +
      '<div class="actions"><button class="cta" type="submit">Enregistrer</button>' +
      (d.id ? '<button class="ghost danger" type="button" data-a="item-del">Supprimer</button>' : '') + '</div></form>';
  }

  /* Bibliothèque suisse et valaisanne */
  function libEntryHTML(e) {
    var have = S.items.some(function (i) { return i.src === e.id; });
    var tpl = P.fromCatalog(e, new Date().getFullYear());
    var sub = e.cat + ' · ' + (e.months.length ? P.describe(tpl) : 'échéance à planifier') +
      (e.tags.indexOf('VS') !== -1 ? ' · Valais' : '') + (e.verify ? ' · à vérifier' : '');
    return '<button class="row" data-a="lib-pick" data-id="' + esc(e.id) + '"><div class="l"><span class="n">' + esc(e.name) + '</span><span class="s">' + esc(sub) + '</span></div>' +
      '<span class="r' + (have ? ' pos' : '') + '">' + (have ? '✓' : '+') + '</span></button>';
  }
  function libListHTML(q) {
    var words = P.norm(q).split(' ').filter(Boolean);
    var list = P.CATALOG.filter(function (e) {
      var t = P.searchText(e);
      return words.every(function (w) { return t.indexOf(w) !== -1; });
    });
    if (!list.length) return '<p class="empty">Aucune charge ne correspond.<br>Crée une charge personnalisée ci-dessous.</p>';
    return P.CATS.map(function (c) {
      var l = list.filter(function (e) { return e.cat === c; });
      return l.length ? '<div class="group"><span class="section-title">' + esc(c) + '</span><div class="list">' + l.map(libEntryHTML).join('') + '</div></div>' : '';
    }).join('');
  }
  function libSheetHTML() {
    var q = ui.sheet.data.q || '';
    var packs = P.PACKS.map(function (k) {
      var fresh = k.ids.filter(function (id) { return !S.items.some(function (i) { return i.src === id; }); }).length;
      return '<div class="row" style="min-height:56px"><div class="l"><span class="n">' + esc(k.name) + '</span><span class="s" style="white-space:normal">' + esc(k.desc) + '</span></div>' +
        (fresh ? '<button class="link" data-a="pack-add" data-id="' + esc(k.id) + '">Ajouter ' + fresh + '</button>' : '<span class="sm pos">✓ Ajouté</span>') + '</div>';
    }).join('');
    return '<div class="overlay" role="dialog" aria-modal="true" aria-label="Bibliothèque">' +
      '<div class="sheet-top"><button class="icon-btn close" data-a="close" aria-label="Fermer">' + icon('close') + '</button><h2>Bibliothèque de charges</h2><span class="spacer"></span></div>' +
      '<p class="md muted" style="line-height:1.5">Les charges courantes en Suisse et en Valais, avec leur échéance habituelle. Choisis-en une, ajuste le montant avec ta facture, c’est prêt.</p>' +
      '<div class="group"><span class="section-title">Packs</span><div class="list">' + packs + '</div></div>' +
      '<input class="field" id="lib-q" type="search" placeholder="Rechercher : serafe, chien, 3a, véhicule…" value="' + esc(q) + '" aria-label="Rechercher">' +
      '<div id="lib-list" style="display:flex;flex-direction:column;gap:22px">' + libListHTML(q) + '</div>' +
      '<button class="ghost" data-a="new-item">Charge personnalisée</button></div>';
  }

  function incomeSheetHTML() {
    return '<form class="overlay form" data-form="income" role="dialog" aria-modal="true" aria-label="Revenus">' +
      '<div class="sheet-top"><button type="button" class="icon-btn close" data-a="close" aria-label="Fermer">' + icon('close') + '</button><h2>Revenus mensuels</h2><span class="spacer"></span></div>' +
      '<label>Revenu net mensuel (CHF)<input class="field" name="income" inputmode="decimal" value="' + esc(S.income ? String(S.income) : '') + '" placeholder="0"></label>' +
      '<p class="hint">Montant net régulier (salaire après déductions). Les revenus ponctuels se saisissent avec le bouton + .</p>' +
      '<div class="actions"><button class="cta" type="submit">Enregistrer</button></div></form>';
  }

  function reserveSheetHTML() {
    return '<form class="overlay form" data-form="reserve" role="dialog" aria-modal="true" aria-label="Réserve">' +
      '<div class="sheet-top"><button type="button" class="icon-btn close" data-a="close" aria-label="Fermer">' + icon('close') + '</button><h2>Réserve actuelle</h2><span class="spacer"></span></div>' +
      '<label>Montant déjà mis de côté (CHF)<input class="field" name="reserve" inputmode="decimal" value="' + esc(S.reserve ? String(S.reserve) : '') + '" placeholder="0"></label>' +
      '<p class="hint">Somme déjà disponible sur ton compte épargne pour payer ces factures. Elle sert à vérifier que tes provisions couvrent les 12 prochains mois, sans modifier ton reste à vivre.</p>' +
      '<div class="actions"><button class="cta" type="submit">Enregistrer</button></div></form>';
  }

  function p3SheetHTML() {
    var p = S.p3 || { cap: P3_CAP_DEFAULT, paid: 0 };
    return '<form class="overlay form" data-form="p3" role="dialog" aria-modal="true" aria-label="3e pilier">' +
      '<div class="sheet-top"><button type="button" class="icon-btn close" data-a="close" aria-label="Fermer">' + icon('close') + '</button><h2>3e pilier (3a)</h2><span class="spacer"></span></div>' +
      '<label>Déjà versé cette année (CHF)<input class="field" name="paid" inputmode="decimal" value="' + esc(p.paid ? String(p.paid) : '') + '" placeholder="0"></label>' +
      '<label>Plafond annuel (CHF)<input class="field" name="cap" inputmode="decimal" value="' + esc(String(p.cap)) + '"></label>' +
      '<p class="hint">Le plafond dépend de ta situation (affiliation à une caisse de pension ou non) et change selon les années. Vérifie la valeur officielle avant de t’y fier.</p>' +
      '<div class="actions"><button class="cta" type="submit">Enregistrer</button>' +
      (S.p3 ? '<button class="ghost danger" type="button" data-a="p3-del">Ne plus suivre</button>' : '') + '</div></form>';
  }

  /* ---------- Bilan ---------- */
  var MI = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  function monthName(i) {
    return cap(new Date(2000, i - 1, 1).toLocaleDateString('fr-CH', { month: 'long' }));
  }
  function catTotals(txs) {
    var map = {};
    txs.forEach(function (t) {
      if (t.kind !== 'expense' || t.cat === PLANNED) return;
      map[t.cat] = (map[t.cat] || 0) + t.amount;
    });
    return Object.keys(map).map(function (k) { return { cat: k, v: map[k] }; })
      .sort(function (a, b) { return b.v - a.v; });
  }

  function bilanHTML() {
    var now = new Date(), curY = now.getFullYear(), curMk = mkOf(now);
    var years = S.tx.map(function (t) { return Number(t.date.slice(0, 4)); });
    var minY = years.length ? Math.min.apply(null, years) : curY;
    var y = ui.bilanYear;
    var months = [], i;
    for (i = 1; i <= 12; i++) {
      var mk = y + '-' + pad(i);
      months.push({ i: i, mk: mk, st: monthStats(mk), future: mk > curMk });
    }
    var withData = months.filter(function (m) { return m.st.tx.length > 0; });
    var spentY = sum(months, function (m) { return m.st.spent; });
    var plannedY = sum(months, function (m) { return m.st.planned; });
    var extraY = sum(months, function (m) { return m.st.extra; });
    var avg = withData.length ? spentY / withData.length : 0;
    var maxV = 1;
    months.forEach(function (m) {
      maxV = Math.max(maxV, m.st.spent, m.future ? 0 : Math.max(m.st.available, 0));
    });
    var selM = ui.bilanMonth ? months.filter(function (m) { return m.mk === ui.bilanMonth; })[0] : null;

    var h = '<div class="top"><div class="month-nav">' +
      '<button class="icon-btn" data-a="bilan-year" data-d="-1" aria-label="Année précédente"' + (y <= minY ? ' disabled' : '') + '>' + icon('left') + '</button>' +
      '<span class="title">Bilan ' + y + '</span>' +
      '<button class="icon-btn" data-a="bilan-year" data-d="1" aria-label="Année suivante"' + (y >= curY ? ' disabled' : '') + '>' + icon('right') + '</button>' +
      '</div></div>';

    var heroLabel, heroVal, heroSub;
    if (selM) {
      var over = selM.st.available > 0 && selM.st.spent > selM.st.available;
      heroLabel = 'Dépensé en ' + monthName(selM.i).toLowerCase();
      heroVal = selM.st.spent;
      heroSub = 'sur ' + f0(Math.max(selM.st.available, 0)) + ' disponibles' +
        (over ? ' · <span class="neg">dépassement de ' + f0(selM.st.spent - selM.st.available) + '</span>' : '');
    } else {
      heroLabel = 'Dépensé en ' + y;
      heroVal = spentY;
      heroSub = withData.length ? 'moyenne de ' + f0(avg) + ' par mois sur ' + withData.length + ' mois' : 'Aucun mouvement enregistré';
    }
    h += '<div class="hero"><span class="md muted">' + esc(heroLabel) + '</span>' +
      '<div class="amount"><span class="num mid">' + f0(heroVal) + '</span><span class="cur">CHF</span></div>' +
      '<span class="md muted">' + heroSub + '</span></div>';

    h += '<div style="display:flex;flex-direction:column;gap:10px"><div class="chart" role="group" aria-label="Dépenses par mois en ' + y + '">' +
      months.map(function (m) {
        var hs = Math.round(m.st.spent / maxV * 100);
        var hb = Math.round(Math.max(m.st.available, 0) / maxV * 100);
        var ov = m.st.available > 0 && m.st.spent > m.st.available;
        var on = selM && selM.mk === m.mk;
        var aria = monthName(m.i) + ' : ' + f0(m.st.spent) + ' CHF dépensés' +
          (m.st.available > 0 ? ' sur ' + f0(m.st.available) + ' disponibles' : '') + (ov ? ', dépassement' : '');
        return '<button class="col' + (on ? ' on' : '') + '" data-a="bilan-month" data-m="' + m.mk + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc(aria) + '"' + (m.future ? ' disabled' : '') + '>' +
          '<span class="plot"><span class="bv' + (ov ? ' over' : '') + '" style="height:' + hs + '%"></span>' +
          (!m.future && hb > 0 && (m.st.tx.length > 0 || m.mk === curMk) ? '<span class="tick" style="bottom:' + hb + '%"></span>' : '') +
          '</span><span class="lab">' + MI[m.i - 1] + '</span></button>';
      }).join('') + '</div>' +
      '<div class="legend"><span><i class="sw bar"></i>Dépensé</span><span><i class="sw tk"></i>Disponible pour le quotidien</span></div>' +
      (selM ? '<button class="link" style="text-align:left;min-height:32px" data-a="bilan-month" data-m="' + selM.mk + '">Voir toute l’année</button>' : '<span class="sm muted">Touche un mois pour le détailler.</span>') +
      '</div>';

    var scopeTx = selM ? selM.st.tx : S.tx.filter(function (t) { return t.date.indexOf(y + '-') === 0; });
    var cats = catTotals(scopeTx);
    var totalCat = sum(cats, function (c) { return c.v; });
    var plannedScope = selM ? selM.st.planned : plannedY;

    if (!selM) {
      var top = null;
      months.forEach(function (m) { if (m.st.spent > 0 && (!top || m.st.spent > top.st.spent)) top = m; });
      h += '<div class="stats">' +
        '<div class="stat"><span class="sm muted">Charges prévues</span><span class="v">' + f0(plannedY) + '</span></div>' +
        '<div class="stat"><span class="sm muted">Revenus extra</span><span class="v">' + f0(extraY) + '</span></div>' +
        '<div class="stat"><span class="sm muted">Mois le + cher</span><span class="v">' + (top ? esc(monthName(top.i).slice(0, 4)) : '—') + '</span></div></div>';
    }

    if (cats.length) {
      h += '<div class="group"><span class="section-title">Par catégorie</span><div class="list">' + cats.map(function (c) {
        var pct = totalCat > 0 ? c.v / totalCat : 0;
        return '<div class="row cat-row"><div class="l"><span class="n">' + esc(c.cat) + '</span><div class="mini"><div style="width:' + Math.round(pct * 100) + '%"></div></div></div>' +
          '<span class="r">' + f0(c.v) + '<small>' + Math.round(pct * 100) + ' %</small></span></div>';
      }).join('') + '</div></div>';
    } else {
      h += '<p class="empty">Rien à afficher pour cette période.<br>Saisis des dépenses ou importe un relevé dans Réglages.</p>';
    }
    if (plannedScope > 0) {
      h += '<div class="row" style="min-height:0"><div class="l"><span class="n">Charges prévues payées</span><span class="s">Hors reste à vivre : déjà dans ton prévisionnel</span></div><span class="r">' + f0(plannedScope) + '</span></div>';
    }
    return h;
  }

  /* ---------- Import CSV ---------- */
  var CSV = window.BudgetCSV;

  function openCsv(file) {
    if (!CSV) { toast('Module d’import indisponible'); return; }
    var r = new FileReader();
    r.onload = function () {
      try {
        var an = CSV.analyze(CSV.decode(r.result));
        if (!an.ok) { toast(an.error); return; }
        ui.sheet = { type: 'csv', data: { name: file.name, an: an, map: an.map, rows: [], showMap: !an.confident } };
        csvBuild();
        render();
      } catch (e) {
        toast('Lecture du fichier impossible');
      }
    };
    r.readAsArrayBuffer(file);
  }

  function csvBuild() {
    var d = ui.sheet.data;
    var recs = CSV.records(d.an.rows, d.an.firstDataIdx, d.map);
    var existing = {}, manual = {};
    S.tx.forEach(function (t) {
      if (t.h) existing[t.h] = 1;
      else manual[t.date + '|' + t.kind + '|' + t.amount.toFixed(2)] = 1;
    });
    var seen = {};
    d.rows = recs.map(function (x) {
      var base = x.date + '|' + x.amount.toFixed(2) + '|' + CSV.norm(x.desc);
      seen[base] = (seen[base] || 0) + 1;
      var h = base + '#' + seen[base];
      var kind = x.amount > 0 ? 'income' : 'expense';
      var abs = Math.abs(x.amount);
      var cat = CSV.categorize(x.desc, x.amount, S.rules, CATS_INC, CATS_EXP);
      var flag = '', sel = true;
      if (existing[h]) { flag = 'déjà importé'; sel = false; }
      else if (manual[x.date + '|' + kind + '|' + abs.toFixed(2)]) { flag = 'doublon probable'; sel = false; }
      else if (CSV.isInternal(x.desc)) { flag = 'virement interne probable'; sel = false; }
      return { date: x.date, desc: x.desc, kind: kind, amount: abs, cat: cat, autoCat: cat, h: h, flag: flag, sel: sel };
    });
  }

  function csvSheetHTML() {
    var d = ui.sheet.data, an = d.an, m = d.map;
    function opts(cur, none) {
      var o = none ? '<option value="-1"' + (cur < 0 ? ' selected' : '') + '>(aucune)</option>' : '';
      an.headers.forEach(function (c, i) {
        o += '<option value="' + i + '"' + (i === cur ? ' selected' : '') + '>' + esc(c) + '</option>';
      });
      return o;
    }
    function sel(label, f, cur, none) {
      return '<label>' + label + '<select class="field" data-a="map" data-f="' + f + '">' + opts(cur, none) + '</select></label>';
    }
    function nm(i) { return i >= 0 ? an.headers[i] : '?'; }

    var picked = d.rows.filter(function (r) { return r.sel; });
    var exp = sum(picked.filter(function (r) { return r.kind === 'expense'; }), function (r) { return r.amount; });
    var inc = sum(picked.filter(function (r) { return r.kind === 'income'; }), function (r) { return r.amount; });

    var h = '<div class="overlay" role="dialog" aria-modal="true" aria-label="Importer un relevé">' +
      '<div class="sheet-top"><button class="icon-btn close" data-a="close" aria-label="Fermer">' + icon('close') + '</button><h2>Importer un relevé</h2><span class="spacer"></span></div>' +
      '<p class="md muted" style="margin-top:-6px">' + esc(d.name) + ' · ' + d.rows.length + ' mouvement' + (d.rows.length > 1 ? 's' : '') + ' lu' + (d.rows.length > 1 ? 's' : '') + '</p>';

    h += '<div class="card">';
    if (!an.confident) h += '<p class="md warn">Je n’ai pas reconnu toutes les colonnes avec certitude : vérifie-les ci-dessous.</p>';
    if (d.showMap) {
      h += '<div class="form">' +
        sel('Date', 'date', m.date, false) +
        sel('Libellé', 'desc', m.desc, false) +
        '<label>Montants<select class="field" data-a="map" data-f="mode"><option value="signed"' + (m.mode === 'signed' ? ' selected' : '') + '>Une colonne (négatif = dépense)</option><option value="split"' + (m.mode === 'split' ? ' selected' : '') + '>Deux colonnes : débit et crédit</option></select></label>' +
        (m.mode === 'signed'
          ? sel('Montant', 'amount', m.amount, false)
          : sel('Débit (sorties)', 'debit', m.debit, true) + sel('Crédit (entrées)', 'credit', m.credit, true)) +
        '<label style="flex-direction:row;align-items:center;gap:10px"><input type="checkbox" data-a="map" data-f="invert"' + (m.invert ? ' checked' : '') + ' style="width:20px;height:20px;accent-color:var(--accent)">Inverser dépenses et revenus</label>' +
        '</div><button class="link" style="text-align:left" data-a="map-toggle">Masquer les colonnes</button>';
    } else {
      h += '<div class="row" style="min-height:0"><div class="l"><span class="n">Colonnes reconnues</span><span class="s">Date : ' + esc(nm(m.date)) + ' · Libellé : ' + esc(nm(m.desc)) + ' · ' +
        (m.mode === 'split' ? 'Débit : ' + esc(nm(m.debit)) + ' · Crédit : ' + esc(nm(m.credit)) : 'Montant : ' + esc(nm(m.amount))) + '</span></div>' +
        '<button class="link" data-a="map-toggle">Modifier</button></div>';
    }
    h += '</div>';

    if (!d.rows.length) {
      h += '<p class="empty">Aucun mouvement lisible avec ces colonnes.<br>Modifie le choix des colonnes ci-dessus.</p>';
    } else {
      h += '<div class="stats">' +
        '<div class="stat"><span class="sm muted">Sélectionnés</span><span class="v">' + picked.length + ' / ' + d.rows.length + '</span></div>' +
        '<div class="stat"><span class="sm muted">Dépenses</span><span class="v">' + f0(exp) + '</span></div>' +
        '<div class="stat"><span class="sm muted">Revenus</span><span class="v">' + f0(inc) + '</span></div></div>' +
        '<p class="sm muted" style="line-height:1.5">« Charges prévues » (loyer, impôts, assurances) et « Salaire » sont déjà couverts par ton prévisionnel : ils ne faussent pas ton reste à vivre. Décoche les virements entre tes propres comptes. Si tu corriges une catégorie, l’app s’en souvient.</p>' +
        '<div style="display:flex;gap:8px"><button class="ghost" style="height:40px" data-a="imp-all" data-v="1">Tout cocher</button><button class="ghost" style="height:40px" data-a="imp-all" data-v="0">Tout décocher</button></div>' +
        '<div class="list">' + d.rows.map(function (r, i) {
          var cats = r.kind === 'expense' ? CATS_EXP : CATS_INC;
          return '<div class="imp' + (r.sel ? '' : ' off') + '"><label class="imp-main"><input type="checkbox" data-a="imp-chk" data-i="' + i + '"' + (r.sel ? ' checked' : '') + '>' +
            '<div class="l"><span class="n">' + esc(r.desc || '(sans libellé)') + '</span><span class="s">' + esc(r.date.split('-').reverse().join('.')) +
            (r.flag ? ' · <span class="warn">' + esc(r.flag) + '</span>' : '') + '</span></div>' +
            '<span class="r' + (r.kind === 'income' ? ' pos' : '') + '">' + (r.kind === 'income' ? '+' : '−') + f2(r.amount) + '</span></label>' +
            '<select class="field imp-cat" data-a="imp-cat" data-i="' + i + '" aria-label="Catégorie">' +
            cats.map(function (c) { return '<option' + (c === r.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>';
        }).join('') + '</div>' +
        '<div class="sticky-bar"><button class="cta" data-a="csv-confirm"' + (picked.length ? '' : ' disabled') + '>Importer ' + picked.length + ' mouvement' + (picked.length > 1 ? 's' : '') + '</button></div>';
    }
    return h + '</div>';
  }

  function csvConfirm() {
    var d = ui.sheet.data, n = 0, maxDate = '';
    d.rows.forEach(function (r) {
      if (!r.sel) return;
      S.tx.push({ id: uid(), kind: r.kind, amount: r.amount, cat: r.cat, date: r.date, note: r.desc.slice(0, 80), ts: Date.now() + n, h: r.h });
      n++;
      if (r.date > maxDate) maxDate = r.date;
      if (r.cat !== r.autoCat) {
        var k = CSV.merchantKey(r.desc);
        if (k) S.rules[k] = r.cat;
      }
    });
    if (!n) { toast('Aucun mouvement sélectionné'); return; }
    var skipped = d.rows.length - n;
    save();
    var cur = mkOf(new Date());
    ui.month = maxDate.slice(0, 7) > cur ? cur : maxDate.slice(0, 7);
    ui.bilanYear = Number(maxDate.slice(0, 4));
    ui.bilanMonth = null;
    ui.sheet = null;
    ui.route = 'home';
    render();
    toast(n + ' mouvement' + (n > 1 ? 's' : '') + ' importé' + (n > 1 ? 's' : '') + (skipped ? ' · ' + skipped + ' ignoré' + (skipped > 1 ? 's' : '') : ''));
  }

  /* ---------- Rendu ---------- */
  function render() {
    var body;
    if (ui.route === 'bilan') body = bilanHTML();
    else if (ui.route === 'plan') body = planHTML();
    else if (ui.route === 'settings') body = settingsHTML();
    else body = homeHTML();
    var overlay = '';
    if (ui.sheet) {
      if (ui.sheet.type === 'tx') overlay = txSheetHTML();
      else if (ui.sheet.type === 'item') overlay = itemSheetHTML();
      else if (ui.sheet.type === 'income') overlay = incomeSheetHTML();
      else if (ui.sheet.type === 'p3') overlay = p3SheetHTML();
      else if (ui.sheet.type === 'csv') overlay = csvSheetHTML();
      else if (ui.sheet.type === 'lib') overlay = libSheetHTML();
      else if (ui.sheet.type === 'reserve') overlay = reserveSheetHTML();
    }
    var oldMain = root.querySelector('main'), oldOv = root.querySelector('.overlay');
    var keepScroll = oldMain ? oldMain.scrollTop : 0;
    var keepOv = oldOv ? oldOv.scrollTop : 0;
    root.innerHTML = '<main>' + body + '</main>' + tabsHTML() + overlay;
    var m = root.querySelector('main');
    if (m) m.scrollTop = keepScroll;
    var ov = root.querySelector('.overlay');
    if (ov && keepOv) ov.scrollTop = keepOv;
  }

  /* ---------- Actions ---------- */
  function openTx(id) {
    var t = id && S.tx.filter(function (x) { return x.id === id; })[0];
    ui.sheet = {
      type: 'tx',
      data: t
        ? { id: t.id, kind: t.kind, amount: String(t.amount), cat: t.cat, date: t.date, note: t.note || '' }
        : { id: null, kind: 'expense', amount: '0', cat: CATS_EXP[0], date: ymd(new Date()), note: '' }
    };
    render();
  }
  function pressKey(k) {
    var d = ui.sheet.data;
    var a = d.amount;
    if (k === 'del') {
      a = a.length > 1 ? a.slice(0, -1) : '0';
    } else if (k === ',' || k === '.') {
      if (a.indexOf('.') === -1) a += '.';
    } else if (/^\d$/.test(k)) {
      var dot = a.indexOf('.');
      if (dot !== -1 && a.length - dot > 2) return;
      if (a.replace('.', '').length >= 8) return;
      a = a === '0' ? k : a + k;
    } else return;
    d.amount = a;
    render();
  }
  function saveTx() {
    var d = ui.sheet.data;
    var amount = Math.round(num(d.amount) * 100) / 100;
    if (!(amount > 0)) { toast('Saisis un montant'); return; }
    if (!d.date) { toast('Choisis une date'); return; }
    var rec = { id: d.id || uid(), kind: d.kind, amount: amount, cat: d.cat, date: d.date, note: (d.note || '').trim(), ts: Date.now() };
    var prev = d.id && S.tx.filter(function (t) { return t.id === d.id; })[0];
    if (prev && prev.item) { rec.item = prev.item; rec.occ = prev.occ; }
    if (d.id) {
      S.tx = S.tx.map(function (t) { return t.id === d.id ? rec : t; });
    } else {
      S.tx.push(rec);
    }
    save();
    ui.month = d.date.slice(0, 7);
    ui.route = ui.route === 'settings' ? 'home' : ui.route;
    ui.sheet = null;
    render();
    toast(d.id ? 'Modifié' : 'Enregistré');
  }
  function openItem(id, tpl) {
    var it = id && S.items.filter(function (x) { return x.id === id; })[0];
    var b = it || tpl || { name: '', cat: PROV_CATS[0], amount: 0, months: [], day: 0, everyYears: 1, note: '', src: '' };
    ui.sheet = {
      type: 'item',
      data: {
        id: it ? it.id : null, name: b.name, cat: b.cat, amount: b.amount || 0, months: (b.months || []).slice(),
        day: b.day || 0, everyYears: b.everyYears || 1, anchorYear: b.anchorYear || new Date().getFullYear(),
        note: b.note || '', src: b.src || '', mode: 'pay', total: 0
      }
    };
    render();
  }
  function addPack(id) {
    var pack = P.PACKS.filter(function (k) { return k.id === id; })[0];
    if (!pack) return;
    var y = new Date().getFullYear(), added = 0;
    pack.ids.forEach(function (cid) {
      if (S.items.some(function (i) { return i.src === cid; })) return;
      var e = P.catalogById(cid);
      if (!e) return;
      var rec = P.fromCatalog(e, y);
      rec.id = uid();
      S.items.push(P.migrateItem(rec, y));
      added++;
    });
    save();
    ui.sheet = null;
    ui.route = 'plan';
    ui.planView = 'list';
    render();
    toast(added ? added + ' charge' + (added > 1 ? 's' : '') + ' ajoutée' + (added > 1 ? 's' : '') + ' : renseigne les montants' : 'Déjà ajouté');
  }
  function exportData() {
    S.lastExport = ymd(new Date());
    save();
    var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'budget-' + S.lastExport + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    render();
    toast('Sauvegarde exportée');
  }
  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var o = JSON.parse(r.result);
        if (!o || o.v !== 1 || !Array.isArray(o.items) || !Array.isArray(o.tx)) throw new Error('format');
        if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
        S = normState(o);
        if (typeof S.income !== 'number') S.income = 0;
        save();
        ui.route = 'home';
        ui.month = mkOf(new Date());
        render();
        toast('Sauvegarde importée');
      } catch (e) {
        toast('Fichier invalide');
      }
    };
    r.readAsText(file);
  }

  /* ---------- Événements ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-a]') : null;
    if (!el) return;
    var a = el.getAttribute('data-a');
    var id = el.getAttribute('data-id');
    switch (a) {
      case 'go': ui.route = el.getAttribute('data-r'); ui.sheet = null; render(); break;
      case 'month':
        var p = ui.month.split('-').map(Number);
        var d = new Date(p[0], p[1] - 1 + Number(el.getAttribute('data-d')), 1);
        if (mkOf(d) > mkOf(new Date())) break;
        ui.month = mkOf(d); render(); break;
      case 'new-tx': openTx(null); break;
      case 'edit-tx': openTx(id); break;
      case 'close': ui.sheet = null; render(); break;
      case 'key': pressKey(el.getAttribute('data-k')); break;
      case 'tx-kind':
        ui.sheet.data.kind = el.getAttribute('data-k');
        ui.sheet.data.cat = (ui.sheet.data.kind === 'expense' ? CATS_EXP : CATS_INC)[0];
        render(); break;
      case 'tx-cat': ui.sheet.data.cat = el.getAttribute('data-c'); render(); break;
      case 'tx-save': saveTx(); break;
      case 'tx-del':
        if (confirm('Supprimer ce mouvement ?')) {
          S.tx = S.tx.filter(function (t) { return t.id !== ui.sheet.data.id; });
          save(); ui.sheet = null; render(); toast('Supprimé');
        } break;
      case 'new-item': openItem(null); break;
      case 'edit-item': openItem(id); break;
      case 'item-del':
        if (confirm('Supprimer cette charge ?')) {
          S.items = S.items.filter(function (t) { return t.id !== ui.sheet.data.id; });
          save(); ui.sheet = null; render(); toast('Supprimée');
        } break;
      case 'lib': ui.sheet = { type: 'lib', data: { q: '' } }; render(); break;
      case 'lib-pick':
        var ce = P.catalogById(id);
        var have = S.items.filter(function (i) { return i.src === id; })[0];
        if (have) openItem(have.id);
        else if (ce) openItem(null, P.fromCatalog(ce, new Date().getFullYear()));
        break;
      case 'pack-add': addPack(id); break;
      case 'plan-view': ui.planView = el.getAttribute('data-v') === 'cal' ? 'cal' : 'list'; ui.route = 'plan'; ui.sheet = null; render(); break;
      case 'month-tog':
        syncItemForm();
        var mn = Number(el.getAttribute('data-m')), md = ui.sheet.data, ix = md.months.indexOf(mn);
        if (ix === -1) md.months.push(mn); else md.months.splice(ix, 1);
        md.months.sort(function (a, b) { return a - b; });
        reAmount(md); render(); break;
      case 'preset': syncItemForm(); applyPreset(ui.sheet.data, el.getAttribute('data-p')); render(); break;
      case 'amt-mode':
        syncItemForm();
        var ad = ui.sheet.data, nm2 = el.getAttribute('data-m');
        if (nm2 !== ad.mode) {
          if (nm2 === 'year') { ad.total = P.annualCost(ad); ad.mode = 'year'; } else { ad.mode = 'pay'; }
        }
        render(); break;
      case 'pay': togglePaid(id, el.getAttribute('data-occ')); break;
      case 'edit-reserve': ui.sheet = { type: 'reserve' }; render(); break;
      case 'edit-income': ui.sheet = { type: 'income' }; render(); break;
      case 'edit-p3': ui.sheet = { type: 'p3' }; render(); break;
      case 'p3-del':
        if (confirm('Arrêter le suivi du 3e pilier ?')) { S.p3 = null; save(); ui.sheet = null; render(); }
        break;
      case 'export': exportData(); break;
      case 'import': fileInput.value = ''; fileInput.click(); break;
      case 'import-csv': fileCsv.value = ''; fileCsv.click(); break;
      case 'map-toggle': ui.sheet.data.showMap = !ui.sheet.data.showMap; render(); break;
      case 'imp-all':
        var allOn = el.getAttribute('data-v') === '1';
        ui.sheet.data.rows.forEach(function (r) { r.sel = allOn; });
        render(); break;
      case 'csv-confirm': csvConfirm(); break;
      case 'bilan-year':
        ui.bilanYear += Number(el.getAttribute('data-d'));
        ui.bilanMonth = null; render(); break;
      case 'bilan-month':
        var bm = el.getAttribute('data-m');
        ui.bilanMonth = ui.bilanMonth === bm ? null : bm;
        render(); break;
      case 'reset':
        if (confirm('Effacer toutes les données de cet appareil ? Cette action est définitive.')) {
          S = emptyState(); save(); ui.route = 'home'; ui.sheet = null; render(); toast('Données effacées');
        } break;
    }
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    var kind = f.getAttribute && f.getAttribute('data-form');
    if (!kind) return;
    e.preventDefault();
    var fd = new FormData(f);
    if (kind === 'item') {
      syncItemForm(f);
      var d = ui.sheet.data, yr = new Date().getFullYear();
      var name = String(d.name || '').trim();
      if (!name) { toast('Donne un nom à la charge'); return; }
      var rec = P.migrateItem({
        id: d.id || uid(), name: name, cat: d.cat || 'Autre',
        amount: Math.round(Math.max(0, d.amount) * 100) / 100,
        months: d.months.slice(), day: d.day, everyYears: d.everyYears,
        anchorYear: d.everyYears > 1 ? (d.anchorYear || yr) : undefined,
        note: String(d.note || '').trim(), src: d.src || ''
      }, yr);
      if (d.id) S.items = S.items.map(function (x) { return x.id === d.id ? rec : x; });
      else S.items.push(rec);
      toast('Enregistré');
    } else if (kind === 'income') {
      S.income = Math.max(0, Math.round(num(fd.get('income')) * 100) / 100);
      toast('Revenus mis à jour');
    } else if (kind === 'reserve') {
      S.reserve = Math.max(0, Math.round(num(fd.get('reserve')) * 100) / 100);
      toast('Réserve mise à jour');
    } else if (kind === 'p3') {
      S.p3 = {
        cap: Math.max(0, num(fd.get('cap')) || P3_CAP_DEFAULT),
        paid: Math.max(0, Math.round(num(fd.get('paid')) * 100) / 100)
      };
      toast('3e pilier mis à jour');
    }
    save();
    ui.sheet = null;
    render();
  });

  document.addEventListener('input', function (e) {
    if (!ui.sheet) return;
    if (ui.sheet.type === 'tx') {
      if (e.target.id === 'tx-date') ui.sheet.data.date = e.target.value;
      if (e.target.id === 'tx-note') ui.sheet.data.note = e.target.value;
    } else if (ui.sheet.type === 'item') {
      if (!e.target.closest || !e.target.closest('form')) return;
      syncItemForm();
      var pv = document.getElementById('item-prev');
      if (pv) pv.innerHTML = itemPreviewHTML();
    } else if (ui.sheet.type === 'lib' && e.target.id === 'lib-q') {
      ui.sheet.data.q = e.target.value;
      var ll = document.getElementById('lib-list');
      if (ll) ll.innerHTML = libListHTML(e.target.value);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (!ui.sheet) return;
    if (e.key === 'Escape') { ui.sheet = null; render(); return; }
    if (ui.sheet.type !== 'tx') return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (/^\d$/.test(e.key) || e.key === ',' || e.key === '.') { e.preventDefault(); pressKey(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); pressKey('del'); }
    else if (e.key === 'Enter') { e.preventDefault(); saveTx(); }
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) importData(fileInput.files[0]);
  });
  fileCsv.addEventListener('change', function () {
    if (fileCsv.files && fileCsv.files[0]) openCsv(fileCsv.files[0]);
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (ui.sheet && ui.sheet.type === 'item' && el.tagName === 'SELECT') {
      syncItemForm();
      if (el.name === 'every') render();
      else { var pv2 = document.getElementById('item-prev'); if (pv2) pv2.innerHTML = itemPreviewHTML(); }
      return;
    }
    var a = el.getAttribute && el.getAttribute('data-a');
    if (!a || !ui.sheet || ui.sheet.type !== 'csv') return;
    var d = ui.sheet.data;
    var i = Number(el.getAttribute('data-i'));
    if (a === 'imp-chk') d.rows[i].sel = el.checked;
    else if (a === 'imp-cat') d.rows[i].cat = el.value;
    else if (a === 'map') {
      var f = el.getAttribute('data-f');
      if (f === 'mode') d.map.mode = el.value;
      else if (f === 'invert') d.map.invert = el.checked;
      else d.map[f] = Number(el.value);
      csvBuild();
    } else return;
    render();
  });

  /* ---------- Démarrage ---------- */
  render();
  if (navigator.storage && navigator.storage.persist) {
    try { navigator.storage.persist(); } catch (e) { /* ignore */ }
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* hors ligne non disponible */ });
    });
  }
})();
