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

    // ---- GET /backend/calendrier/events : agenda fusionné ----
    //   ?days=60                     → fenêtre de N jours à partir d'aujourd'hui
    //   ?from=AAAA-MM-JJ&to=AAAA-MM-JJ → plage explicite (navigation semaine/mois)
    case 'GET events':
        $cal  = new Calendar();
        $from = isset($_GET['from']) ? trim((string) $_GET['from']) : '';
        $to   = isset($_GET['to'])   ? trim((string) $_GET['to'])   : '';

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
            $tz   = new DateTimeZone(date_default_timezone_get());
            $dFrom = new DateTimeImmutable($from . ' 00:00:00', $tz);
            $dTo   = new DateTimeImmutable($to   . ' 00:00:00', $tz);
            // Garde-fou : on borne l'amplitude (max ~120 jours) et l'ordre.
            if ($dTo <= $dFrom) {
                $dTo = $dFrom->add(new DateInterval('P1D'));
            }
            if ($dTo->diff($dFrom)->days > 120) {
                $dTo = $dFrom->add(new DateInterval('P120D'));
            }
            $result = $cal->getEventsBetween($dFrom, $dTo);
        } else {
            $days   = isset($_GET['days']) ? (int) $_GET['days'] : 60;
            $result = $cal->getEvents($days);
        }

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
