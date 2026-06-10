-- =========================================================
--  OS Perso — Initialisation de la base de données
--
--  Ce script est joué AUTOMATIQUEMENT par MariaDB, mais UNIQUEMENT
--  au tout premier démarrage du conteneur (quand le volume de données
--  est encore vide). Voir le dossier /docker-entrypoint-initdb.d/.
--
--  Module FOYER — première brique : la liste de courses partagée.
-- =========================================================

CREATE TABLE IF NOT EXISTS shopping_items (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nom           VARCHAR(255) NOT NULL,
    quantite      VARCHAR(50)  DEFAULT NULL,          -- ex : "250 g", "2 boîtes" (libre)
    rayon         VARCHAR(50)  NOT NULL DEFAULT 'Autre', -- rayon magasin (tri des courses)
    statut_achete TINYINT(1)   NOT NULL DEFAULT 0,    -- 0 = à acheter, 1 = acheté
    date_ajout    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
--  Module FOYER — Sous-projet : Générateur de Menu Intelligent
--  (placards + historique des repas + plan de la semaine)
-- =========================================================

-- Contenu des placards / du frigo.
-- NB : quantity est en VARCHAR pour rester souple ("500 g", "2 boîtes", "6").
--      Passe-le en INT si tu préfères un comptage strict.
CREATE TABLE IF NOT EXISTS inventory_pantry (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    item_name    VARCHAR(255) NOT NULL,
    quantity     VARCHAR(50)  NOT NULL DEFAULT '1',
    is_essential TINYINT(1)   NOT NULL DEFAULT 0,   -- 1 = à toujours avoir en stock
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historique des repas déjà consommés (sert à éviter les répétitions).
CREATE TABLE IF NOT EXISTS meals_history (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    meal_name     VARCHAR(255) NOT NULL,
    category      VARCHAR(100) DEFAULT NULL,        -- ex : "Viande", "Végétarien", "Pâtes"
    date_consumed DATE         NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plan de repas de la semaine (résultat généré, modifiable).
CREATE TABLE IF NOT EXISTS weekly_plan (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    day_of_week VARCHAR(20)  NOT NULL,              -- ex : "Lundi"
    meal_type   VARCHAR(20)  NOT NULL,              -- ex : "Midi", "Soir"
    meal_name   VARCHAR(255) NOT NULL,
    cooked      TINYINT(1)   NOT NULL DEFAULT 0,    -- 1 = "j'ai cuisiné ce plat" (déclenche l'archivage historique)
    recipe      TEXT         DEFAULT NULL,          -- recette générée par l'IA (JSON), à la demande puis mise en cache
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ingrédients de chaque plat du plan (renseignés par l'IA à la génération).
-- Sert à décrémenter le placard quand un plat est marqué "cuisiné".
CREATE TABLE IF NOT EXISTS meal_ingredients (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    weekly_plan_id INT UNSIGNED NOT NULL,            -- repas concerné (weekly_plan.id)
    ingredient     VARCHAR(255) NOT NULL,
    quantity       VARCHAR(50)  DEFAULT NULL,        -- texte libre ("250 g", "2 boîtes")
    PRIMARY KEY (id),
    KEY idx_meal_ing_plan (weekly_plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Préférences du foyer pour le générateur de menu (table à ligne unique).
-- Injectées dans le prompt par MenuGenerator::buildPrompt().
CREATE TABLE IF NOT EXISTS user_preferences (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    household_size TINYINT UNSIGNED NOT NULL DEFAULT 2,   -- nb de personnes
    veggie_meals   TINYINT UNSIGNED NOT NULL DEFAULT 2,   -- repas végétariens / semaine (minimum)
    max_pasta      TINYINT UNSIGNED NOT NULL DEFAULT 2,   -- repas à base de pâtes / semaine (maximum)
    avoid          VARCHAR(500) DEFAULT NULL,             -- à éviter / allergies (texte libre)
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ligne unique (id=1) avec les valeurs par défaut.
INSERT INTO user_preferences (id, household_size, veggie_meals, max_pasta, avoid)
VALUES (1, 2, 2, 2, NULL);


-- =========================================================
--  Module FINANCES — Phase 1 : suivi des dépenses & revenus
--  Saisie manuelle. Champ "qui" = dimension couple (moi/partenaire/commun).
-- =========================================================
CREATE TABLE IF NOT EXISTS finance_transactions (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    date       DATE          NOT NULL,                       -- date de l'opération
    type       VARCHAR(10)   NOT NULL DEFAULT 'depense',     -- 'depense' | 'revenu'
    montant    DECIMAL(10,2) NOT NULL,                       -- positif ; le signe vient du type
    categorie  VARCHAR(50)   NOT NULL DEFAULT 'Autre',       -- depuis une liste prédéfinie
    qui        VARCHAR(20)   NOT NULL DEFAULT 'commun',      -- 'moi' | 'partenaire' | 'commun'
    libelle    VARCHAR(255)  DEFAULT NULL,                   -- ex : "Carrefour", "Resto"
    note       TEXT          DEFAULT NULL,
    created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_fin_date (date),
    KEY idx_fin_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
