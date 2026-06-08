<?php
/**
 * index.php — Point d'entrée UNIQUE de l'API (front controller).
 *
 * Toutes les requêtes /backend/... arrivent ici grâce au .htaccess, qui passe
 * le chemin demandé dans $_GET['route']. Ce fichier lit la route, branche le
 * bon module, et renvoie TOUJOURS du JSON.
 */

// ---------------------------------------------------------------------------
// 1) Headers HTTP de base
// ---------------------------------------------------------------------------
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *'); // à restreindre plus tard
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

// Les navigateurs envoient une requête "préflight" OPTIONS avant un POST/PUT.
// On y répond immédiatement, sans exécuter de logique métier.
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ---------------------------------------------------------------------------
// 2) Dépendances
// ---------------------------------------------------------------------------
require_once __DIR__ . '/core/Database.php';

/**
 * Petit helper : renvoie une réponse JSON normalisée puis stoppe le script.
 * Toutes nos réponses partageront cette structure { status, ... }.
 */
function respond(int $httpCode, array $payload): void
{
    http_response_code($httpCode);
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// ---------------------------------------------------------------------------
// 3) Lecture et découpage de la route
// ---------------------------------------------------------------------------
// .htaccess nous donne ?route=domotique/status -> "domotique/status"
$route = isset($_GET['route']) ? trim($_GET['route'], '/') : '';

// On découpe en segments pour un routing modulaire :
//   "domotique/status" -> ['domotique', 'status']
$segments = ($route === '') ? [] : explode('/', $route);
$module   = $segments[0] ?? ''; // 1er segment = le module ciblé

// ---------------------------------------------------------------------------
// 4) Aiguillage (routing)
// ---------------------------------------------------------------------------
// Tout est encapsulé dans un try/catch : la moindre erreur (SQL, etc.)
// renvoie un JSON 500 propre au lieu d'une page d'erreur PHP brute.
try {
    switch ($module) {

        // ---- Racine de l'API : GET /backend/ ----
        case '':
            respond(200, [
                'status'  => 'success',
                'message' => 'API OS Perso opérationnelle.',
                'version' => '0.1.0',
            ]);
            break;

        // ---- Test de connexion BDD : GET /backend/test-db ----
        case 'test-db':
            $db     = Database::getInstance();
            $result = $db->query('SELECT 1 AS ping')->fetch();
            respond(200, [
                'status'      => 'success',
                'message'     => 'Connexion MariaDB OK (SELECT 1 exécuté via PDO).',
                'db_response' => $result, // ex : { "ping": 1 }
            ]);
            break;

        // ---- Module FOYER : /backend/foyer/... ----
        // On délègue tout le sous-routage au routeur dédié du module.
        // Il a accès à $segments (l'URL découpée) et à respond() définis ici.
        case 'foyer':
            require __DIR__ . '/modules/foyer/router.php';
            break;

        // ---- Autres modules à venir (à décommenter le moment venu) ----
        // case 'domotique':
        //     require __DIR__ . '/modules/domotique/router.php';
        //     break;
        // case 'pro':
        //     require __DIR__ . '/modules/pro/router.php';
        //     break;

        // ---- Route inconnue ----
        default:
            respond(404, [
                'status'  => 'error',
                'message' => "Route inconnue : /{$route}",
            ]);
    }

} catch (Throwable $e) {
    // En dev on renvoie le détail ; en prod il faudra le masquer/logger.
    respond(500, [
        'status'  => 'error',
        'message' => 'Erreur interne du serveur.',
        'detail'  => $e->getMessage(),
    ]);
}
