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
    statut_achete TINYINT(1)   NOT NULL DEFAULT 0,   -- 0 = à acheter, 1 = acheté
    date_ajout    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quelques articles de départ pour avoir de quoi afficher côté front.
INSERT INTO shopping_items (nom, statut_achete) VALUES
    ('Lait',  0),
    ('Pain',  0),
    ('Café',  1);


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
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quelques ingrédients de base dans les placards pour nos futurs tests.
INSERT INTO inventory_pantry (item_name, quantity, is_essential) VALUES
    ('Pâtes',        '500 g',    1),
    ('Riz',          '1 kg',     1),
    ('Sauce tomate', '2 boîtes', 0),
    ('Œufs',         '6',        1);

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
