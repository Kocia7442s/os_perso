# =========================================================
#  SCADA — Image PHP/Apache personnalisée
#  But : partir de l'image officielle et y ajouter PDO MySQL,
#        indispensable pour que PHP parle à MariaDB.
# =========================================================
FROM php:8.2-apache

# Installe l'extension PDO MySQL (pdo est sa dépendance, on l'ajoute explicitement).
# C'est le helper officiel des images PHP pour compiler/activer une extension.
RUN docker-php-ext-install pdo pdo_mysql

# Active mod_rewrite d'Apache : indispensable pour le routeur frontal
# (URLs propres type /backend/domotique/status au lieu de /backend/index.php?...).
RUN a2enmod rewrite

# IMPORTANT : l'image officielle met "AllowOverride None" sur le webroot, ce qui
# fait qu'Apache IGNORE les fichiers .htaccess. On autorise donc les overrides
# sur /var/www/html pour que notre .htaccess (RewriteRule) soit pris en compte.
RUN set -eux; { \
      echo '<Directory /var/www/html/>'; \
      echo '    AllowOverride All'; \
      echo '    Require all granted'; \
      echo '</Directory>'; \
    } > /etc/apache2/conf-available/zz-allow-override.conf; \
    a2enconf zz-allow-override
