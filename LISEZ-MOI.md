# Budget — V3

Application web installable (PWA) : budget prévisionnel lissé sur 12 mois + saisie quotidienne, pensée pour la Suisse (3e pilier, impôts, LAMal, assurances, animaux).
Les données restent **uniquement sur ton appareil** (stockage du navigateur). Aucun compte, aucun serveur.

## Mise en ligne automatique sur GitHub Pages (recommandé)
1. Installe git et le CLI GitHub : `winget install Git.Git` et `winget install GitHub.cli`, puis rouvre PowerShell.
2. Dans le dossier de l'app : `.\deploy.ps1` (Windows) ou `./deploy.sh` (Linux/Mac).
3. Première fois : le script ouvre la connexion GitHub, crée un dépôt public au nom aléatoire (`budget-xxxxxx`), envoie le code et active Pages.
4. Il affiche l'adresse finale. Pour mettre à jour plus tard, relance simplement le script.

Notes : le dépôt est public (obligatoire pour Pages en gratuit) mais ne contient aucune donnée personnelle ; `deploy.*` et tes exports `budget-*.json` ne sont jamais envoyés (voir `.gitignore`). Le script utilise l'adresse « noreply » de GitHub pour ne pas exposer ton e-mail.

## Autres options d'hébergement (5 minutes, gratuit)

Une PWA doit être servie en HTTPS pour s'installer sur le téléphone.

**Option la plus simple : Netlify Drop**
1. Va sur app.netlify.com/drop
2. Glisse-y le dossier `budget-app` décompressé
3. Tu obtiens une adresse `https://…netlify.app`

**Option GitHub Pages** : crée un dépôt, envoie-y ces fichiers, active Pages dans les réglages du dépôt.

## Installer sur Android
Ouvre l'adresse dans Chrome, menu ⋮ → « Installer l'application » (ou « Ajouter à l'écran d'accueil »).

## Tester sur ordinateur
Dans le dossier : `python3 -m http.server 8080`, puis ouvre http://localhost:8080

## Contenu de la V1
- Accueil : reste à vivre du mois, à venir, mouvements récents, navigation par mois
- Saisie rapide : dépense ou revenu, clavier numérique, catégories, date, note
- Prévisionnel : voir « Prévisionnel V3 » ci-dessous
- Suivi du 3e pilier (3a) avec plafond modifiable
- Export / import de sauvegarde (fichier JSON)
- **Import de relevé bancaire CSV** (Réglages) : détection automatique du séparateur, des colonnes et des formats suisses, catégorisation automatique, repérage des doublons (réimport sans risque), apprentissage de tes corrections
- **Bilan** : dépensé par mois face au disponible, répartition par catégorie, navigation par année

## Prévisionnel V3 (Suisse et Valais)
- **Bibliothèque de ~65 charges** (Prévisionnel > Ajouter une charge) : acomptes d'impôts valaisans, IFD, Serafe, impôt et RC chien, impôt véhicule (31 janvier), vignette, contrôle technique, LAMal, franchise, 3a, Rega, etc. Recherche par mot (« chien », « valais », « 3a »).
- **Packs** : Essentiel, Locataire, Propriétaire, Véhicule, Chien, Prévoyance, Abonnements. Un appui ajoute toutes les charges, tu renseignes ensuite les montants d'après tes factures.
- **Échéancier libre pour chaque charge** : un ou plusieurs mois (trimestriel, semestriel, 5 acomptes…), jour du mois facultatif, récurrence tous les 2, 3, 4, 5 ou 10 ans (contrôle technique, passeport), montant par facture ou total annuel.
- **Calendrier sur 12 mois glissants** : factures par mois, solde des provisions, point le plus bas, mise de côté mensuelle conseillée et réserve nécessaire. Le champ « Réserve » sert à tester ta couverture sans changer ton reste à vivre.
- **Bouton « Payé »** (accueil et calendrier) : crée un mouvement « Charges prévues » lié à la facture ; un second appui l'annule. Les échéances dépassées apparaissent « En retard ».
- Tes anciennes charges sont converties automatiquement (annuelle avec date = un mois d'échéance ; sans date = « à planifier »).

### Données à contrôler sur tes propres documents
Les montants et dates de la bibliothèque sont des repères, pas des vérités : marqués « à vérifier » dans la liste. En particulier : dates des acomptes valaisans (10 févr., avr., juin, août, oct.), date de l'IFD, mois de facturation Serafe (335 CHF/an en 2026, selon ton groupe), montant de l'impôt sur le chien (fixé par ta commune), taxe véhicule (selon la cylindrée), plafond 3a (7'258 CHF en 2026 pour un salarié avec LPP).

## Comment fonctionne l'import CSV
1. Dans le e-banking, exporte les mouvements en CSV.
2. Réglages > Importer un relevé bancaire > choisis le fichier.
3. Vérifie les colonnes reconnues (modifiables), décoche ce que tu ne veux pas (virements entre tes comptes, déjà décochés quand c'est détectable), corrige les catégories.
4. Importer. Tu peux réimporter une période qui se chevauche : les lignes déjà importées sont ignorées.

Deux catégories spéciales évitent de compter deux fois : **Charges prévues** (loyer, impôts, assurances : déjà dans le prévisionnel, elles ne baissent pas ton reste à vivre) et **Salaire** (déjà dans tes revenus mensuels).

## Sécurité
- L'app est publique mais ne contient aucune donnée : tout reste dans ton navigateur.
- `noindex` + `robots.txt` : les moteurs de recherche n'indexent pas la page.
- `_headers` (Netlify) : CSP stricte, anti-framing, HSTS, etc. Sur GitHub Pages ce fichier est ignoré, mais la CSP de base est aussi dans `index.html`.
- **Active la double authentification** sur ton compte d'hébergement : c'est le vrai point sensible.
- Choisis une adresse non devinable et ne la partage pas.

## Points d'attention
- **Sauvegarde** : vider les données du navigateur ou changer de téléphone efface tout. Exporte régulièrement (Réglages).
- **Plafond 3a** : la valeur proposée (7’258 CHF) est à vérifier chaque année selon ta situation.
- **Mise à jour de l'app** : après modification d'un fichier, change `CACHE` dans `sw.js` (ex. `budget-v5`).

## Prochaine phase
Import CSV bancaire avec catégorisation automatique, puis simulateur de franchise LAMal et rappels.
