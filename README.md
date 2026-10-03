# Gestion des présences · Attendance Manager · 考勤管理

Petite application web de gestion des présences, disponible en **français**, **anglais** et **chinois**.
Serveur en Python (Flask), base de données SQLite, interface en HTML/JavaScript.

## Démarrer en local

Prérequis : Python 3.10 ou plus récent.

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
python app.py
```

Créez ensuite un compte de connexion (voir plus bas), puis ouvrez <http://localhost:3000>.

- `PORT=8080 python app.py` change le port.
- Les données sont enregistrées dans `data/attendance.db`. Pour sauvegarder, copiez ce fichier.

## Base de données : SQLite ou MySQL

Par défaut, l'application utilise **SQLite** (`data/attendance.db`) : il n'y a rien à configurer.

Pour utiliser **MySQL**, copiez `.env.example` sous le nom `.env` et renseignez `MYSQL_DB`, `MYSQL_USER`, `MYSQL_PASSWORD` et `MYSQL_HOST`. Les tables sont créées automatiquement au démarrage. Le fichier `.env` est lu à la fois par le site et par les commandes en console, et il n'est jamais envoyé sur GitHub.

```bash
python db.py check          # teste toutes les opérations sur la base configurée, puis nettoie
python sqlite_to_mysql.py   # copie les données de data/attendance.db vers MySQL (base MySQL vide uniquement)
```

## Comptes de connexion

L'application est protégée par un identifiant et un mot de passe. Pour que personne ne puisse s'inscrire depuis Internet, les comptes se créent uniquement en ligne de commande, dans le dossier du projet avec l'environnement virtuel activé :

```bash
python users.py add NOM        # créer un compte (le mot de passe est demandé, 8 caractères minimum)
python users.py passwd NOM     # changer un mot de passe (déconnecte ce compte partout)
python users.py delete NOM     # supprimer un compte
python users.py list           # lister les comptes
```

Sécurité :
- les mots de passe sont enregistrés chiffrés (empreinte irréversible) ;
- après 5 mots de passe erronés, le compte est bloqué 15 minutes ;
- la session dure 12 heures ;
- la clé qui signe les sessions est créée automatiquement dans `data/secret_key`. On peut aussi la fournir avec la variable `SECRET_KEY` ;
- une fois le site en HTTPS, définissez `HTTPS_ONLY=1` pour que le cookie de session ne circule jamais en clair.

## Mettre en ligne sur PythonAnywhere

1. **Console Bash** : récupérer le code et créer l'environnement virtuel.
   ```bash
   git clone https://github.com/Faraleno2022/Gestiondesattendances.git
   cd Gestiondesattendances
   python3.12 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
2. **Onglet Web** → *Add a new web app* → votre domaine → **Manual configuration** → Python 3.12.
3. Renseigner :
   - *Source code* et *Working directory* : `/home/VOTRE_COMPTE/Gestiondesattendances`
   - *Virtualenv* : `/home/VOTRE_COMPTE/Gestiondesattendances/.venv`
4. Remplacer le contenu du **fichier WSGI** par :
   ```python
   import os
   import sys

   path = "/home/VOTRE_COMPTE/Gestiondesattendances"
   if path not in sys.path:
       sys.path.insert(0, path)

   os.environ["HTTPS_ONLY"] = "1"  # à ajouter une fois le HTTPS activé

   from app import app as application
   ```
5. **Console Bash** : créer le premier compte avec `python users.py add NOM`.
6. Cliquer sur **Reload**, puis activer le certificat HTTPS (Let's Encrypt) et *Force HTTPS*.

Mise à jour ultérieure : `cd ~/Gestiondesattendances && git pull`, puis **Reload** dans l'onglet Web.

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

## Exports PDF et Excel

Les fichiers sont générés par le serveur (ReportLab pour le PDF, openpyxl pour Excel) avec les données affichées à l'écran, filtres et recherche compris.

Pour afficher le chinois, le PDF intègre une police chinoise. Il la cherche dans cet ordre :

1. la variable d'environnement `PDF_FONT` (et éventuellement `PDF_FONT_BOLD`) : chemin d'un fichier `.ttf` ou `.ttc` ;
2. un fichier `.ttf` ou `.ttc` déposé dans le dossier `fonts/` du projet ;
3. les polices du système : Microsoft YaHei ou SimSun sous Windows, WenQuanYi, AR PL ou Droid Sans Fallback sous Linux.

Seules les polices à contours TrueType conviennent ; les polices OpenType/CFF comme Noto Sans CJK ne fonctionnent pas avec ReportLab.
Si aucune police n'est trouvée, le chinois utilise la police Adobe intégrée `STSong-Light`, que certains lecteurs PDF n'affichent pas.

## Structure

```
app.py            Serveur Flask : API REST, connexion et pages de l'interface
db.py             Base de données (SQLite ou MySQL) et autotest
users.py          Gestion des comptes de connexion (ligne de commande)
sqlite_to_mysql.py  Transfert des données de SQLite vers MySQL
.env.example      Modèle de configuration (MySQL, HTTPS)
exports.py        Génération des fichiers PDF (ReportLab) et Excel (openpyxl)
requirements.txt  Dépendances Python
public/
  index.html      Interface
  app.js          Logique de l'interface
  i18n.js         Traductions FR / EN / 中文
  style.css       Styles (thème clair et sombre)
```

## API

Toutes les adresses demandent d'être connecté, sauf `/api/login`. Sans session valide, elles répondent `401 UNAUTHORIZED`.

| Méthode | URL | Rôle |
|---|---|---|
| POST | `/api/login` | Connexion `{ username, password }` |
| GET | `/api/session` | Compte connecté |
| POST | `/api/logout` | Déconnexion |
| GET | `/api/people` | Liste des personnes |
| POST | `/api/people` | Ajouter `{ matricule, name, jobTitle, service }` |
| PUT | `/api/people/:id` | Modifier `{ matricule, name, jobTitle, service }` |
| DELETE | `/api/people/:id` | Supprimer, avec son historique |
| GET | `/api/attendance?month=AAAA-MM` | Personnel et pointages du mois |
| PUT | `/api/attendance` | Enregistrer `{ date, personId, status }` (`status: null` pour effacer, `note` facultatif) |
| PUT | `/api/attendance/bulk` | Enregistrer `{ date, personIds, status }` pour plusieurs personnes |
| GET | `/api/stats?from=…&to=…` | Bilan par personne sur la période |
| POST | `/api/export/pdf`, `/api/export/xlsx` | Génère un fichier à partir d'un tableau décrit par l'interface (voir `exports.py`) |

Valeurs possibles pour `status` : `present`, `absent`, `late`, `excused`.
