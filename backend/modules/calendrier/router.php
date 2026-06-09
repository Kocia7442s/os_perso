<?php
/**
 * router.php — Sous-routeur du module CALENDRIER (lecture seule).
 *
 * Inclus par /backend/index.php quand l'URL commence par "calendrier".
 * Variables héritées d'index.php : $segments, respond().
 *
 * Convention de routage : "{MÉTHODE} {action}".
 */

require_once __DIR__ . '/Calendar.php';

$action = $segments[1] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

switch ("{$method} {$action}") {

    // ---- GET /backend/calendrier/events?days=60 : agenda fusionné ----
    case 'GET events':
        $days = isset($_GET['days']) ? (int) $_GET['days'] : 60;
        $result = (new Calendar())->getEvents($days);
        respond(200, [
            'status'    => 'success',
            'count'     => count($result['events']),
            'data'      => $result['events'],
            'calendars' => $result['calendars'],
            'errors'    => $result['errors'],
        ]);
        break;

    // ---- GET /backend/calendrier/feeds : calendriers configurés (sans contenu) ----
    case 'GET feeds':
        $calendars = array_map(
            static fn($f) => ['name' => $f['name'], 'color' => $f['color']],
            (new Calendar())->getFeeds()
        );
        respond(200, [
            'status' => 'success',
            'count'  => count($calendars),
            'data'   => $calendars,
        ]);
        break;

    // ---- Action inconnue ----
    default:
        respond(404, [
            'status'  => 'error',
            'message' => "Action Calendrier inconnue : {$method} /calendrier/{$action}",
        ]);
}
