# =========================================================
#  OS Perso — Image PHP/Apache personnalisée
#  But : partir de l'image officielle et y ajouter PDO MySQL,
#        indispensable pour que PHP parle à MariaDB.
# =========================================================
FROM php:8.2-apache

# Installe l'extension PDO MySQL (pdo est sa dépendance, on l'ajoute explicitement).
# C'est le helper officiel des images PHP pour compiler/activer une extension.
RUN docker-php-ext-install pdo pdo_mysql

# Active mod_rewrite d'Apache : utile pour le futur routeur d'API
# (URLs propres type /api/factures au lieu de /backend/index.php?...).
RUN a2enmod rewrite
