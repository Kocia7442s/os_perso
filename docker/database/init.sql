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
