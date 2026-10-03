# Gestion des présences · Attendance Manager · 考勤管理

Petite application web de gestion des présences, disponible en **français**, **anglais** et **chinois**.

## Démarrer

Prérequis : Node.js 22.13 ou plus récent. SQLite est intégré à Node, il n'y a rien d'autre à installer.

```bash
npm install
npm start
```

Ouvrez ensuite <http://localhost:3000>.

- `npm run dev` relance le serveur automatiquement à chaque modification du code.
- `PORT=8080 npm start` change le port.
- Les données sont enregistrées dans `data/attendance.db`. Pour sauvegarder, copiez ce fichier.

## Fonctionnalités

- **Pointage** : feuille mensuelle. Une ligne par personne (matricule, nom complet, fonction, service), une colonne par jour du mois, et dans chaque cellule une liste de pointage (Présent, Absent, En retard, Excusé). En fin de ligne, le nombre de jours par statut et le taux de présence sont recalculés automatiquement, et la dernière ligne indique le nombre de présents par jour. Filtres par service et recherche, bouton pour marquer présentes toutes les personnes pas encore pointées un jour donné, export de la feuille en PDF et en Excel.
- **Personnel** : ajouter, modifier ou supprimer des personnes (matricule, nom complet, fonction, service / département). Un matricule ne peut être attribué qu'à une seule personne.
- **Statistiques** : bilan par personne sur une période, filtrage par service, taux de présence, export en PDF et en Excel.

## Langues

La langue est détectée automatiquement d'après le navigateur, puis mémorisée quand on la change avec le menu en haut à droite.

Tous les textes sont dans [`public/i18n.js`](public/i18n.js). L'adaptation à chaque langue va plus loin que la traduction :

- dates au format local (`samedi 3 octobre 2026` / `Saturday, October 3, 2026` / `2026年10月3日星期六`) ;
- pluriels gérés correctement (`1 personne` / `2 personnes`) ;
- tri des noms adapté à la langue (ordre pinyin en chinois) ;
- pourcentages et ponctuation au format local (`50 %` en français, `出勤：1` en chinois) ;
- fichiers PDF et Excel entièrement traduits (titres, colonnes, dates, numéros de page).

Le serveur renvoie uniquement des codes d'erreur (`NAME_REQUIRED`…). C'est le navigateur qui les traduit.

**Ajouter une langue** : ajoutez un bloc dans `MESSAGES` et son code dans `LANGS` (fichier `public/i18n.js`), puis une `<option>` dans le sélecteur de `public/index.html`.

## Structure

```
server.js         API REST (Express)
db.js             Base SQLite (node:sqlite)
export.js         Génération des fichiers PDF (PDFKit) et Excel (ExcelJS)
public/
  index.html      Interface
  app.js          Logique de l'interface
  i18n.js         Traductions FR / EN / 中文
  style.css       Styles (thème clair et sombre)
```

## Exports PDF et Excel

Les fichiers sont générés par le serveur avec les données affichées à l'écran (filtres et recherche compris).
Pour afficher le chinois, le PDF utilise une police chinoise du système : Microsoft YaHei sous Windows, PingFang sous macOS, Noto Sans CJK ou WenQuanYi sous Linux.
Pour en choisir une autre, définissez la variable `PDF_FONT` (et éventuellement `PDF_FONT_BOLD`) avec le chemin d'un fichier .ttf ou .otf.

## API

| Méthode | URL | Rôle |
|---|---|---|
| GET | `/api/people` | Liste des personnes |
| POST | `/api/people` | Ajouter `{ matricule, name, jobTitle, service }` |
| PUT | `/api/people/:id` | Modifier `{ matricule, name, jobTitle, service }` |
| DELETE | `/api/people/:id` | Supprimer, avec son historique |
| GET | `/api/attendance?month=AAAA-MM` | Personnel et pointages du mois |
| PUT | `/api/attendance` | Enregistrer `{ date, personId, status }` (`status: null` pour effacer, `note` facultatif) |
| PUT | `/api/attendance/bulk` | Enregistrer `{ date, personIds, status }` pour plusieurs personnes |
| GET | `/api/stats?from=…&to=…` | Bilan par personne sur la période |
| POST | `/api/export/pdf`, `/api/export/xlsx` | Génère un fichier à partir d'un tableau décrit par l'interface (voir `export.js`) |

Valeurs possibles pour `status` : `present`, `absent`, `late`, `excused`.
