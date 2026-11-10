/* Prévisionnel : échéancier flexible, trésorerie des provisions et bibliothèque
   de charges suisses / valaisannes. Logique pure, sans accès à l'écran. */
(function (root) {
  'use strict';

  var MS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var ML = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var CATS = ['Impôts', 'Logement', 'Assurances', 'Santé', 'Animaux', 'Véhicule', 'Redevances et taxes',
    'Prévoyance', 'Télécom et abonnements', 'Transports', 'Cotisations et dons', 'Autre'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function sum(arr, fn) { return arr.reduce(function (a, x) { return a + fn(x); }, 0); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function norm(s) {
    s = String(s == null ? '' : s).toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/\s+/g, ' ').trim();
  }

  /* ---------- Modèle d'une charge ----------
     { id, name, cat, amount (par échéance), months [1..12], day (0 = inconnu),
       everyYears (1 = chaque année), anchorYear, note, src } */

  function migrateItem(it, refYear) {
    if (!it) return it;
    var ref = refYear || new Date().getFullYear();
    if (!Array.isArray(it.months)) {
      var m = 0, d = 0;
      if (it.due && /^\d{4}-\d{2}-\d{2}$/.test(it.due)) { m = Number(it.due.slice(5, 7)); d = Number(it.due.slice(8, 10)); }
      it.months = it.kind === 'monthly' ? ALL.slice() : (m ? [m] : []);
      it.day = d;
      delete it.kind;
      delete it.due;
    }
    it.months = it.months.filter(function (x, i, a) { return x >= 1 && x <= 12 && a.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
    it.everyYears = Math.max(1, Math.round(Number(it.everyYears) || 1));
    it.day = Math.max(0, Math.min(31, Math.round(Number(it.day) || 0)));
    it.amount = Math.max(0, Number(it.amount) || 0);
    it.note = it.note || '';
    if (it.everyYears > 1 && !it.anchorYear) it.anchorYear = ref;
    if (it.cat === 'Redevances') it.cat = 'Redevances et taxes';
    return it;
  }

  function perYear(it) { return (it.months && it.months.length) || 1; }
  function annualCost(it) { return (Number(it.amount) || 0) * perYear(it) / (it.everyYears || 1); }
  function isMonthly(it) { return !!it.months && it.months.length === 12 && (it.everyYears || 1) === 1; }
  function isScheduled(it) { return !!it.months && it.months.length > 0; }

  function occursIn(it, year, month, ref) {
    if (!it.months || it.months.indexOf(month) === -1) return false;
    var n = it.everyYears || 1;
    if (n <= 1) return true;
    var a = it.anchorYear || ref || new Date().getFullYear();
    return (((year - a) % n) + n) % n === 0;
  }

  function dateOf(it, y, m) {
    return new Date(y, m - 1, Math.min(it.day || 15, new Date(y, m, 0).getDate()));
  }

  function occurrencesBetween(it, from, to, ref) {
    var out = [];
    if (!isScheduled(it)) return out;
    var f = startOfDay(from), t = startOfDay(to);
    var y = f.getFullYear(), m = f.getMonth() + 1, guard = 0;
    while ((y < t.getFullYear() || (y === t.getFullYear() && m <= t.getMonth() + 1)) && guard++ < 1200) {
      if (occursIn(it, y, m, ref)) {
        var d = dateOf(it, y, m);
        if (d >= f && d <= t) out.push({ date: d, y: y, m: m, key: y + '-' + pad(m), dayKnown: !!it.day });
      }
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  function nextOccurrence(it, from, ref) {
    var f = startOfDay(from);
    var to = new Date(f.getFullYear() + (it.everyYears || 1) + 1, f.getMonth(), f.getDate());
    var o = occurrencesBetween(it, f, to, ref);
    return o.length ? o[0] : null;
  }

  /* ---------- Description lisible de l'échéancier ---------- */
  function describe(it) {
    var months = (it.months || []).slice().sort(function (a, b) { return a - b; });
    var n = it.everyYears || 1;
    if (!months.length) return 'Échéance à planifier';
    var prefix = n === 2 ? 'Tous les 2 ans · ' : n > 2 ? 'Tous les ' + n + ' ans · ' : '';
    if (months.length === 12) return 'Chaque mois' + (it.day ? ', le ' + it.day : '');
    var lab = function (m) { return it.day ? it.day + ' ' + MS[m - 1] : MS[m - 1]; };
    if (months.length === 1) return prefix + (it.day ? it.day + ' ' + MS[months[0] - 1] : 'en ' + ML[months[0] - 1]);
    var even = function (step) {
      for (var i = 1; i < months.length; i++) if (months[i] - months[i - 1] !== step) return false;
      return months[0] + step * months.length === months[0] + 12;
    };
    if (months.length === 4 && even(3)) return prefix + 'Chaque trimestre (' + months.map(lab).join(', ') + ')';
    if (months.length === 2 && even(6)) return prefix + 'Chaque semestre (' + months.map(lab).join(', ') + ')';
    return prefix + months.length + ' fois par an (' + months.map(lab).join(', ') + ')';
  }

  /* ---------- Calendrier et trésorerie ---------- */
  function addMonths(y, m, k) {
    var idx = y * 12 + (m - 1) + k;
    return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
  }

  // 12 mois glissants. Les charges mensuelles fixes ne sont pas incluses : elles sortent du budget courant.
  function schedule(items, y0, m0, count, ref) {
    var out = [];
    for (var i = 0; i < (count || 12); i++) {
      var ym = addMonths(y0, m0, i);
      var bills = [];
      items.forEach(function (it) {
        if (isMonthly(it) || !isScheduled(it)) return;
        if (occursIn(it, ym.y, ym.m, ref)) bills.push({ it: it, amount: Number(it.amount) || 0 });
      });
      bills.sort(function (a, b) { return (a.it.day || 15) - (b.it.day || 15); });
      out.push({ y: ym.y, m: ym.m, key: ym.y + '-' + pad(ym.m), bills: bills, total: sum(bills, function (b) { return b.amount; }) });
    }
    return out;
  }

  // On suppose que la mise de côté est versée en début de mois, et que les factures tombent pendant le mois.
  function cashflow(items, y0, m0, reserve, ref) {
    var res = Math.max(0, Number(reserve) || 0);
    var prov = items.filter(function (it) { return !isMonthly(it); });
    var scheduledItems = prov.filter(isScheduled);
    var unscheduledItems = prov.filter(function (it) { return !isScheduled(it); });
    var scheduledAnnual = sum(scheduledItems, annualCost);
    var unscheduledAnnual = sum(unscheduledItems, annualCost);
    var setAside = scheduledAnnual / 12;
    var rows = schedule(items, y0, m0, 12, ref);
    var bal = res, cum = 0, need = 0, min = Infinity, minRow = null;
    rows.forEach(function (r, i) {
      bal += setAside;
      bal -= r.total;
      cum += r.total;
      need = Math.max(need, (cum - res) / (i + 1));
      r.balance = bal;
      if (bal < min) { min = bal; minRow = r; }
    });
    if (min === Infinity) min = res;
    return {
      rows: rows,
      setAside: setAside,
      scheduledAnnual: scheduledAnnual,
      unscheduledAnnual: unscheduledAnnual,
      unscheduledItems: unscheduledItems,
      min: min,
      minRow: minRow,
      covered: min >= -0.005,
      neededReserve: Math.max(0, -min),
      recommended: Math.ceil(Math.max(setAside, need) - 1e-9),
      billsTotal: sum(rows, function (r) { return r.total; })
    };
  }

  /* ---------- Bibliothèque de charges ---------- */
  function E(id, name, cat, months, o) {
    o = o || {};
    return {
      id: id, name: name, cat: cat, months: months, day: o.day || 0, every: o.every || 1,
      amount: o.amount || 0, tags: o.tags || ['CH'], note: o.note || '', verify: !!o.verify
    };
  }

  var CATALOG = [
    // Impôts
    E('imp-acomptes', 'Impôts cantonaux et communaux (acomptes)', 'Impôts', [2, 4, 6, 8, 10], { day: 10, tags: ['VS'], verify: true,
      note: 'Valais : cinq acomptes (10 févr., 10 avr., 10 juin, 10 août, 10 oct.), calculés sur ta dernière taxation, payables sous 30 jours. Contrôle les dates sur ton bordereau. Astuce : saisis le total annuel.' }),
    E('imp-ifd', 'Impôt fédéral direct (IFD)', 'Impôts', [3], { day: 31, verify: true,
      note: 'Facture fédérale annuelle, en général due vers la fin mars. Date à contrôler sur ta facture.' }),
    E('imp-solde', 'Solde d’impôt (décompte définitif)', 'Impôts', [], { tags: ['VS'],
      note: 'Bordereau définitif communal après la taxation : la différence avec les acomptes peut être un supplément ou un remboursement. Date variable.' }),
    E('imp-foncier', 'Impôt foncier (commune)', 'Impôts', [], { tags: ['VS'],
      note: 'Propriétaires : perçu par la commune, avec le bordereau ou séparément selon la commune.' }),

    // Logement
    E('loyer', 'Loyer', 'Logement', ALL.slice(), { day: 1, note: 'En général payable d’avance, le 1er du mois.' }),
    E('charges', 'Acomptes de charges et de chauffage', 'Logement', ALL.slice(), { note: 'Acomptes mensuels, avec décompte annuel.' }),
    E('decompte-charges', 'Décompte de charges (solde annuel)', 'Logement', [], { note: 'Selon la consommation : supplément ou remboursement.' }),
    E('electricite', 'Électricité', 'Logement', ALL.slice(), { note: 'Acomptes mensuels chez ton fournisseur, avec décompte annuel.' }),
    E('eau', 'Eau, égouts et épuration', 'Logement', [], { tags: ['VS'], note: 'Taxes communales, souvent facturées une ou deux fois par an. Dates et montants propres à ta commune.' }),
    E('dechets', 'Taxe déchets (commune)', 'Logement', [], { tags: ['VS'], note: 'Taxe de base communale ; les sacs taxés s’achètent à part.' }),
    E('parking', 'Place de parc ou garage', 'Logement', ALL.slice(), {}),
    E('hypo', 'Intérêts hypothécaires', 'Logement', [3, 6, 9, 12], { note: 'Souvent trimestriels ou semestriels selon le contrat.' }),
    E('ppe', 'Charges de PPE et fonds de rénovation', 'Logement', [1, 4, 7, 10], { note: 'Appels de fonds trimestriels habituels en copropriété.' }),
    E('entretien-log', 'Entretien du logement (chaudière, ramonage)', 'Logement', [], {}),

    // Assurances
    E('lamal', 'Prime LAMal (assurance de base)', 'Assurances', ALL.slice(), {
      note: 'Facturée au mois, au trimestre, au semestre ou à l’année selon ta caisse. Les primes de l’année suivante sont annoncées en automne ; changement de caisse possible jusqu’au 30 novembre (franchise ordinaire).' }),
    E('lca', 'Assurance complémentaire (LCA)', 'Assurances', ALL.slice(), {}),
    E('menage', 'Assurance ménage et RC privée', 'Assurances', [], { note: 'Souvent facturée en début d’année ; vérifie ta police.' }),
    E('juridique', 'Protection juridique', 'Assurances', [], {}),
    E('dentaire', 'Assurance dentaire', 'Assurances', [], {}),
    E('vie', 'Assurance risque décès et invalidité', 'Assurances', [], {}),
    E('voyage', 'Assurance annulation et voyage', 'Assurances', [], {}),
    E('ass-batiment', 'Assurance bâtiment (propriétaire)', 'Assurances', [], {}),

    // Santé
    E('franchise', 'Franchise LAMal (réserve)', 'Santé', [], {
      note: 'Niveaux pour un adulte : 300, 500, 1’000, 1’500, 2’000 ou 2’500 CHF. Tu ne la paies que si tu te soignes : garde la franchise choisie en réserve.' }),
    E('quote-part', 'Quote-part de 10 % (réserve)', 'Santé', [], {
      note: '10 % des frais au-delà de la franchise, plafonnés à 700 CHF par an pour un adulte.' }),
    E('dentiste', 'Contrôle dentaire et hygiène', 'Santé', [], { note: 'Les soins dentaires ne sont en général pas remboursés par la LAMal.' }),
    E('optique', 'Lunettes et lentilles', 'Santé', [], { every: 2 }),
    E('medic', 'Médicaments et soins non remboursés', 'Santé', [], {}),

    // Animaux
    E('chien-impot', 'Impôt sur le chien', 'Animaux', [], { tags: ['VS'],
      note: 'Perçu par la commune : le montant est fixé par chaque commune, par chien. Souvent facturé une fois par an, consulte ton avis communal.' }),
    E('chien-rc', 'Assurance RC chien', 'Animaux', [], { tags: ['VS'],
      note: 'En Valais, tout détenteur de chien doit avoir une assurance responsabilité civile couvrant les risques liés au chien.' }),
    E('animal-sante', 'Assurance maladie et accident de l’animal', 'Animaux', [], { note: 'Mensuelle ou annuelle selon le contrat.' }),
    E('veto', 'Frais vétérinaires courants (vaccins, contrôles)', 'Animaux', [], { note: 'Prévois une moyenne annuelle et un coussin pour les imprévus.' }),
    E('chien-cours', 'Éducation canine et cours', 'Animaux', [], { tags: ['VS'],
      note: 'Cours obligatoires pour les nouveaux détenteurs de chien depuis le 1er janvier 2020 en Valais ; ensuite facultatifs.' }),
    E('animal-pension', 'Pension ou garde pendant les vacances', 'Animaux', [], {}),
    E('animal-nourriture', 'Nourriture et litière', 'Animaux', ALL.slice(), {}),

    // Véhicule
    E('taxe-vehicule', 'Impôt sur les véhicules à moteur', 'Véhicule', [1], { day: 31, tags: ['VS'],
      note: 'Valais : impôt annuel perçu pour l’année civile entière, à payer jusqu’au 31 janvier. Calculé selon la cylindrée (la puissance pour l’électrique). Une révision du calcul est en consultation en 2026.' }),
    E('vignette', 'Vignette autoroutière', 'Véhicule', [12], { amount: 40,
      note: '40 CHF ; valable du 1er décembre de l’année précédente au 31 janvier de l’année suivante (14 mois).' }),
    E('ass-auto', 'Assurance véhicule (RC et casco)', 'Véhicule', [], { note: 'Prime annuelle ou semestrielle : indique le mois de ta facture.' }),
    E('controle-technique', 'Contrôle technique du véhicule', 'Véhicule', [], { every: 2, tags: ['VS'],
      note: 'Premier contrôle après 4 ans, puis 3 ans plus tard, puis tous les 2 ans. Convocation du Service de la circulation routière et de la navigation.' }),
    E('pneus', 'Changement ou stockage des pneus', 'Véhicule', [4, 10], { note: 'Montage au printemps et à l’automne.' }),
    E('entretien-auto', 'Service et entretien annuel', 'Véhicule', [], {}),
    E('leasing', 'Leasing ou crédit véhicule', 'Véhicule', ALL.slice(), {}),

    // Redevances et taxes
    E('serafe', 'Redevance radio-télévision (Serafe)', 'Redevances et taxes', [], { amount: 335, verify: true,
      note: '335 CHF par an et par ménage (OFCOM). Le mois de facturation dépend de ton groupe : regarde ta dernière facture. Facture annuelle payable sous 60 jours, ou trimestrielle sur demande (30 jours).' }),
    E('identite', 'Passeport et carte d’identité', 'Redevances et taxes', [], { every: 10, note: 'Validité de 10 ans pour un adulte.' }),

    // Prévoyance
    E('3a', '3e pilier A (versement annuel)', 'Prévoyance', [12], { day: 31, amount: 7258, verify: true,
      note: 'Plafond 2026 pour un salarié affilié à une caisse de pension : 7’258 CHF. À verser avant le 31 décembre pour la déduction de l’année.' }),
    E('lpp-rachat', 'Rachat LPP (2e pilier)', 'Prévoyance', [12], { note: 'Rachat volontaire déductible du revenu imposable ; à voir avec ta caisse de pension.' }),
    E('3b', 'Épargne ou assurance 3b', 'Prévoyance', ALL.slice(), {}),

    // Télécom et abonnements
    E('mobile', 'Abonnement mobile', 'Télécom et abonnements', ALL.slice(), {}),
    E('internet', 'Internet, TV et téléphonie fixe', 'Télécom et abonnements', ALL.slice(), {}),
    E('streaming', 'Streaming (vidéo, musique)', 'Télécom et abonnements', ALL.slice(), {}),
    E('cloud', 'Cloud, domaine et logiciels', 'Télécom et abonnements', [], { note: 'Souvent annuels : domaine, hébergement, licences.' }),
    E('presse', 'Presse et magazines', 'Télécom et abonnements', [], {}),

    // Transports
    E('demi-tarif', 'Abonnement demi-tarif', 'Transports', [], { verify: true, note: 'Abonnement annuel : indique le mois de renouvellement et le montant de ta facture.' }),
    E('ag', 'Abonnement général ou de parcours', 'Transports', [], {}),
    E('abo-regional', 'Abonnement de transports régionaux', 'Transports', [], {}),

    // Cotisations et dons
    E('rega', 'Rega (donateur)', 'Cotisations et dons', [], { amount: 40, verify: true, note: 'Cotisation de donateur individuel : 40 CHF par an. À vérifier selon ta catégorie.' }),
    E('tcs', 'TCS ou assistance routière', 'Cotisations et dons', [], {}),
    E('club', 'Cotisations de club et d’association', 'Cotisations et dons', [], {}),
    E('syndicat', 'Cotisation professionnelle ou syndicale', 'Cotisations et dons', [], {}),
    E('dons', 'Dons à des institutions d’utilité publique', 'Cotisations et dons', [12], { note: 'Déductibles des impôts dans les limites fixées par la loi.' }),

    // Autre
    E('noel', 'Fêtes de fin d’année et cadeaux', 'Autre', [12], {}),
    E('vacances', 'Vacances', 'Autre', [], {}),
    E('formation', 'Formation continue et certifications', 'Autre', [], {}),
    E('banque', 'Frais bancaires et de cartes', 'Autre', [], {}),
    E('imprevus', 'Fonds d’imprévus (réparations, pannes)', 'Autre', ALL.slice(), { note: 'Mise de côté mensuelle pour les imprévus.' })
  ];

  var PACKS = [
    { id: 'base', name: 'Essentiel Suisse et Valais', desc: 'Impôts, assurance de base, redevance, téléphone et 3e pilier.',
      ids: ['imp-acomptes', 'imp-ifd', 'lamal', 'franchise', 'menage', 'serafe', 'mobile', 'internet', '3a'] },
    { id: 'locataire', name: 'Locataire', desc: 'Loyer, charges, électricité et taxes communales.',
      ids: ['loyer', 'charges', 'electricite', 'dechets', 'eau'] },
    { id: 'proprietaire', name: 'Propriétaire', desc: 'Hypothèque, copropriété, impôt foncier et entretien.',
      ids: ['hypo', 'ppe', 'ass-batiment', 'imp-foncier', 'eau', 'dechets', 'entretien-log', 'electricite'] },
    { id: 'vehicule', name: 'Véhicule', desc: 'Impôt valaisan, vignette, assurance, contrôle et pneus.',
      ids: ['taxe-vehicule', 'vignette', 'ass-auto', 'controle-technique', 'pneus', 'entretien-auto'] },
    { id: 'chien', name: 'Chien', desc: 'Impôt communal, RC obligatoire, assurance, vétérinaire et cours.',
      ids: ['chien-impot', 'chien-rc', 'animal-sante', 'veto', 'chien-cours'] },
    { id: 'prevoyance', name: 'Prévoyance', desc: '3e pilier A, rachat LPP et épargne 3b.',
      ids: ['3a', 'lpp-rachat', '3b'] },
    { id: 'loisirs', name: 'Abonnements et loisirs', desc: 'Streaming, transports, Rega, vacances et fêtes.',
      ids: ['streaming', 'demi-tarif', 'rega', 'tcs', 'vacances', 'noel'] }
  ];

  function catalogById(id) {
    for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i];
    return null;
  }

  function fromCatalog(e, ref) {
    var it = {
      name: e.name, cat: e.cat, amount: e.amount || 0, months: e.months.slice(), day: e.day || 0,
      everyYears: e.every || 1, note: e.note || '', src: e.id
    };
    if (it.everyYears > 1) it.anchorYear = ref || new Date().getFullYear();
    return it;
  }

  function searchText(e) {
    return norm(e.name + ' ' + e.cat + ' ' + e.note + ' ' + (e.tags.indexOf('VS') !== -1 ? 'valais vs' : '') + ' suisse');
  }

  var api = {
    MS: MS, ML: ML, ALL: ALL, CATS: CATS, CATALOG: CATALOG, PACKS: PACKS,
    migrateItem: migrateItem, perYear: perYear, annualCost: annualCost, isMonthly: isMonthly, isScheduled: isScheduled,
    occursIn: occursIn, occurrencesBetween: occurrencesBetween, nextOccurrence: nextOccurrence,
    describe: describe, schedule: schedule, cashflow: cashflow, addMonths: addMonths,
    catalogById: catalogById, fromCatalog: fromCatalog, searchText: searchText, norm: norm
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BudgetPlan = api;
})(typeof window !== 'undefined' ? window : this);
