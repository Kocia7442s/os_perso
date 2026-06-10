# 🧠 OS Perso — Mon Second Cerveau

Webapp centrale et modulaire pour gérer **tous les aspects de ma vie** : domotique,
foyer, activité freelance et finances. Un « système d'exploitation personnel »
auto-hébergé, pensé pour tourner à terme sur une infrastructure locale de Raspberry Pi.

---

## 🎯 Philosophie

- **100 % Vanilla.** Aucun framework front-end structurant (pas de React/Vue/Svelte/Angular),
  pas de bundler complexe. Front en **JS/HTML/CSS natifs** (Web Components, CSS Grid/Flexbox).
- **Librairies ciblées autorisées** uniquement pour des composants lourds et bien résolus
  (ex. Chart.js, Three.js, manipulation de dates), via `<script>` ou modules ES6.
- **Séparation stricte Front / Back.** Le frontend ne parle **jamais** directement à la BDD :
  il passe toujours par l'API.
- **Modularité.** Si un module casse, le reste de l'OS continue de tourner.

---

## 🏗️ Architecture

```
os_perso/
├── docker-compose.yml        # Orchestration (web + db)
├── .env / .env.example       # Secrets & configuration (le .env réel est gitignored)
│
├── docker/
│   ├── php/Dockerfile        # Image Apache/PHP 8.2 custom (pdo_mysql, mod_rewrite, AllowOverride)
│   └── database/init.sql     # Schéma des tables (rejoué sur volume neuf ; sans données de départ)
│
├── backend/                  # API RESTful — ne sert que du JSON
│   ├── .htaccess             # Front controller : réécrit tout vers index.php
│   ├── index.php             # Routeur frontal (CORS, JSON, switch des modules)
│   ├── core/
│   │   └── Database.php       # Connexion PDO MariaDB (Singleton)
│   └── modules/
│       ├── foyer/             # Module Foyer (menu IA, courses, placards, recettes…)
│       │   ├── router.php         # Sous-routeur (méthode + action)
│       │   ├── MenuGenerator.php   # Menu + recettes via Claude (cURL), cuisson, décrément stock
│       │   ├── ShoppingList.php    # CRUD liste de courses (rayons, anti-doublon)
│       │   ├── Pantry.php          # CRUD placards + décrément intelligent (consume)
│       │   └── Preferences.php     # Préférences du foyer
│       ├── calendrier/        # Module Calendrier (agenda iCal Apple, lecture seule)
│       │   ├── router.php         # Routes events / feeds
│       │   ├── Calendar.php        # Agrégation des flux .ics + cache fichier (TTL)
│       │   └── ICalParser.php      # Parseur iCalendar natif (RRULE, EXDATE, fuseaux)
│       ├── domotique/        # (à venir)
│       ├── pro/              # (à venir)
│       └── finances/         # (à venir)
│
└── frontend/                 # Interface client (Vanilla)
    ├── index.html            # Coquille : Sidebar + zone <main>
    ├── assets/css/style.css  # Thème dark "monitoring" + grille Bento responsive
    ├── components/
    │   └── bento-card.js      # Web Component <bento-card> (Shadow DOM, slot "actions")
    └── js/
        ├── api.js            # Couche réseau (aucun DOM) — helpers apiGet/apiSend
        └── app.js            # Routeur SPA Vanilla + rendu des vues + interactions
```

---

## 🧰 Stack technique

| Couche | Technologie |
|---|---|
| Serveur web | Apache + **PHP 8.2** (image officielle, customisée) |
| Base de données | **MariaDB 10.11** |
| Conteneurisation | **Docker** / Docker Compose |
| Frontend | **Vanilla** JS (ES6 modules, Web Components), HTML, CSS (Grid/Flexbox) |
| IA | API **Anthropic Claude** (Messages API, via cURL natif) |

---

## 🚀 Démarrage rapide

### Prérequis
- Docker + Docker Compose v2

### Installation

```bash
# 1. Cloner le dépôt puis créer son fichier d'environnement
cp .env.example .env
#    -> éditer .env et renseigner les secrets (mots de passe BDD, ANTHROPIC_API_KEY...)

# 2. Construire l'image custom et lancer la stack
docker compose up -d --build

# 3. Vérifier que les deux conteneurs tournent
docker compose ps
```

### Accès

| Service | URL / Port |
|---|---|
| Frontend (Dashboard) | http://localhost:8088/frontend/ |
| API (racine) | http://localhost:8088/backend/ |
| MariaDB (depuis l'hôte) | `localhost:3307` |

> Les ports hôte (`8088`, `3307`) sont configurables dans le `.env`
> (`WEB_PORT`, `DB_PORT`). Ils diffèrent des ports standards pour éviter les
> conflits avec d'éventuels services déjà installés sur la machine.

---

## 🔧 Configuration (`.env`)

| Variable | Rôle |
|---|---|
| `DB_ROOT_PASSWORD`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Identifiants MariaDB |
| `DB_HOST` | Hôte BDD vu par PHP (= `db`, le nom du service Docker) |
| `WEB_PORT`, `DB_PORT` | Ports exposés sur l'hôte |
| `ANTHROPIC_API_KEY` | Clé API Claude (https://console.anthropic.com/) |
| `ANTHROPIC_MODEL` | Modèle utilisé (`claude-haiku-4-5` par défaut, ou `claude-sonnet-4-6`) |
| `CAL_1_URL` … `CAL_6_URL` | Calendriers iCal publiés depuis Apple Agenda (+ `CAL_n_NAME`, `CAL_n_COLOR`) |
| `CAL_CACHE_TTL` | Durée de cache des flux calendrier en secondes (défaut 600) |
| `TZ` | Fuseau horaire |

> ⚠️ Le `.env` **réel n'est jamais commité** (il est dans le `.gitignore`).
> Seul `.env.example` sert de modèle versionné.

---

## 🗄️ Base de données

Le schéma est défini dans `docker/database/init.sql`, monté dans
`/docker-entrypoint-initdb.d/`. **Il n'est joué qu'au premier démarrage**
(quand le volume `db_data` est vide).

**Rejouer le script :**
```bash
# Option A — non destructive (garde le volume) : import manuel
docker compose exec -T db sh -c 'exec mariadb -uos_user -pospassword os_perso' < docker/database/init.sql

# Option B — repartir d'une base vierge (DÉTRUIT les données)
docker compose down -v && docker compose up -d
```

**Tables actuelles :** `shopping_items` (avec `rayon`), `inventory_pantry`, `meals_history`,
`weekly_plan` (avec `cooked` + `recipe`), `meal_ingredients` (ingrédients par plat), `user_preferences`.

---

## 🔌 API

Toutes les requêtes `/backend/...` passent par `index.php` (front controller) et
renvoient un JSON normalisé : `{ "status": "success" | "error", ... }`.

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/backend/` | Test de vie de l'API |
| `GET` | `/backend/test-db` | Test de connexion MariaDB (`SELECT 1`) |
| `POST` | `/backend/foyer/generate-menu` | Génère un menu via l'IA, le persiste, déduit la liste de courses (par rayon) |
| `GET` | `/backend/foyer/menu` | Dernier menu persistant (sans rappeler l'IA) |
| `PUT` | `/backend/foyer/cook/{id}` | « J'ai cuisiné » : archive l'historique **et** décrémente le stock |
| `GET` · `POST` | `/backend/foyer/recipe/{id}` | Recette d'un plat (cache) / la générer via l'IA |
| `GET` | `/backend/foyer/history` | Repas des 14 derniers jours |
| `GET` · `POST` | `/backend/foyer/shopping` | Liste de courses : lire / ajouter (nom, quantité, rayon) |
| `PUT` · `DELETE` | `/backend/foyer/shopping/{id}` | Cocher-décocher / supprimer un article |
| `POST` | `/backend/foyer/to-pantry` | Ranger un article acheté dans les placards |
| `GET` · `POST` | `/backend/foyer/stock` | Placards : lire / ajouter |
| `PUT` · `DELETE` | `/backend/foyer/stock/{id}` | Modifier (quantité, essentiel) / retirer |
| `GET` · `POST` | `/backend/foyer/preferences` | Préférences du foyer : lire / enregistrer |
| `GET` | `/backend/calendrier/events` | Agenda fusionné (`?days=N` ou `?from=&to=`) |
| `GET` | `/backend/calendrier/feeds` | Calendriers configurés (nom + couleur) |

**Ajouter un module** : créer `backend/modules/<nom>/router.php`, puis ajouter un
`case '<nom>'` dans le `switch` de `backend/index.php`. Le `core` ne bouge pas.

---

## 🖥️ Frontend

- **Dashboard « Bento Box »**, Mobile First (Sidebar ↔ Bottom Bar sous 768px), responsive
  vérifié sur téléphone / tablette / ordinateur.
- Navigation **SPA sans rechargement** (hash routing) gérée par `js/app.js`.
- Composant réutilisable `<bento-card title="..." icon="..." span="...">`.
- **Interactions par délégation d'événements** (un listener par conteneur, survit aux ré-rendus).
- Modales natives `<dialog>` : préférences du menu, **recette d'un plat**, **calendrier** (semaine/mois).
- Couche réseau isolée dans `js/api.js` (jamais de `fetch` ailleurs).

---

## 🗺️ Modules

| Module | Statut | Contenu |
|---|---|---|
| **Foyer** | 🟢 Fonctionnel | Menu IA (avec ingrédients par plat) ; **recettes détaillées** générées à la demande ; liste de courses **triée par rayon** (+ export texte) ; placards ; boucle complète *acheté → placard* et *cuisiné → décrément du stock + historique* ; préférences |
| **Calendrier** | 🟢 Fonctionnel | Agenda commun en **lecture seule** depuis les calendriers **Apple/iCal** publiés (parseur natif, cache) ; vues **jour / semaine / mois**, fusion multi-calendriers |
| **Domotique** | ⚪ Prévu | Home Assistant, capteurs Zigbee, monitoring RPi |
| **Pro & Freelance** | ⚪ Prévu | Facturation, suivi du CA, rappels Urssaf/CFE |
| **Finances** | ⚪ Prévu | Suivi des dépenses, tracker d'investissements |

---

## 🛠️ Commandes utiles

```bash
docker compose up -d --build   # (Re)construire et lancer
docker compose ps              # État des conteneurs
docker compose logs -f web     # Logs du serveur web
docker compose down            # Arrêter (les données BDD sont conservées)
docker compose down -v         # Arrêter + supprimer le volume BDD (reset complet)
```
