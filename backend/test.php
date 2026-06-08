<?php
/**
 * test.php — Endpoint de test du backend (le "Pong" du Ping).
 * Ne touche PAS à la base de données : c'est juste un test de vie de l'API.
 */

// On annonce explicitement au client qu'on renvoie du JSON (et non du HTML).
header('Content-Type: application/json; charset=utf-8');

// CORS : ici front et back partagent la même origine (localhost:8088),
// donc ce n'est pas strictement nécessaire. On le laisse pour le test,
// on l'affinera proprement quand on construira le vrai routeur d'API.
header('Access-Control-Allow-Origin: *');

// La réponse de test.
$response = [
    'status'      => 'success',
    'message'     => 'Pong ! Le backend PHP répond correctement.',
    'service'     => 'os_perso_backend',
    'php_version' => PHP_VERSION,
    'timestamp'   => date('c'), // format ISO 8601
];

// JSON_PRETTY_PRINT pour une lecture facile pendant le dev,
// JSON_UNESCAPED_UNICODE pour garder les accents lisibles.
echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
