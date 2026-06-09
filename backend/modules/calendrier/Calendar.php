<?php
/**
 * Calendar.php — Agrégateur de calendriers iCal (lecture seule).
 *
 * Lit la liste des flux .ics dans l'environnement (.env), les récupère en HTTP,
 * les fait parser par ICalParser, fusionne et trie les occurrences, puis renvoie
 * une sortie NORMALISÉE prête pour le frontend (dates en ISO 8601, types castés).
 *
 * Convention .env (jusqu'à 6 calendriers, indices 1..6) :
 *   CAL_1_NAME=Simon
 *   CAL_1_URL=https://pXX-calendars.icloud.com/published/2/....ics
 *   CAL_1_COLOR=#4f8cff
 *
 * Le frontend ne parle JAMAIS aux flux directement : tout passe par l'API.
 */

require_once __DIR__ . '/ICalParser.php';

class Calendar
{
    private const MAX_FEEDS = 6;
    /** Couleurs de repli si CAL_n_COLOR n'est pas défini. */
    private const FALLBACK_COLORS = ['#4f8cff', '#ff5c8a', '#28c76f', '#ff9f43', '#a66bff', '#00cfe8'];

    private ICalParser $parser;

    public function __construct()
    {
        $this->parser = new ICalParser();
    }

    /**
     * Lit la configuration des flux depuis l'environnement.
     * @return array<int, array{name:string, url:string, color:string}>
     */
    public function getFeeds(): array
    {
        $feeds = [];
        for ($i = 1; $i <= self::MAX_FEEDS; $i++) {
            $url = trim((string) getenv("CAL_{$i}_URL"));
            if ($url === '') {
                continue;
            }
            $name  = trim((string) getenv("CAL_{$i}_NAME"));
            $color = trim((string) getenv("CAL_{$i}_COLOR"));
            $feeds[] = [
                'name'  => $name !== '' ? $name : "Calendrier {$i}",
                'url'   => $this->normalizeUrl($url),
                'color' => $color !== '' ? $color : self::FALLBACK_COLORS[($i - 1) % count(self::FALLBACK_COLORS)],
            ];
        }
        return $feeds;
    }

    /**
     * Récupère et fusionne les événements de tous les flux, dans une fenêtre
     * de $days jours à partir d'aujourd'hui.
     *
     * @return array{events: array, calendars: array, errors: array}
     */
    public function getEvents(int $days = 60): array
    {
        $days = max(1, min(365, $days)); // borne raisonnable
        $tz   = new DateTimeZone(date_default_timezone_get());
        $from = new DateTimeImmutable('today 00:00:00', $tz);
        $to   = $from->add(new DateInterval("P{$days}D"));

        $feeds     = $this->getFeeds();
        $events    = [];
        $calendars = [];
        $errors    = [];

        foreach ($feeds as $feed) {
            $calendars[] = ['name' => $feed['name'], 'color' => $feed['color']];

            $ics = $this->fetch($feed['url']);
            if ($ics === null) {
                $errors[] = "Flux injoignable : {$feed['name']}";
                continue;
            }

            try {
                foreach ($this->parser->parse($ics, $from, $to) as $occ) {
                    $events[] = $this->normalize($occ, $feed);
                }
            } catch (Throwable $e) {
                $errors[] = "Flux illisible : {$feed['name']}";
            }
        }

        // Tri chronologique sur le début (clé ISO triable lexicographiquement).
        usort($events, static fn($a, $b) => strcmp($a['start'], $b['start']));

        return [
            'events'    => $events,
            'calendars' => $calendars,
            'errors'    => $errors,
        ];
    }

    /** Normalise une occurrence pour le front (ISO 8601, types castés). */
    private function normalize(array $occ, array $feed): array
    {
        /** @var DateTimeImmutable $start */
        $start = $occ['start'];
        /** @var DateTimeImmutable $end */
        $end   = $occ['end'];
        $allDay = (bool) $occ['all_day'];

        return [
            'uid'      => (string) ($occ['uid'] ?? ''),
            'title'    => (string) $occ['title'],
            'location' => $occ['location'] !== null ? (string) $occ['location'] : null,
            'all_day'  => $allDay,
            // Journée entière : on expose une simple date ; sinon l'instant complet.
            'start'    => $allDay ? $start->format('Y-m-d') : $start->format('c'),
            'end'      => $allDay ? $end->format('Y-m-d')   : $end->format('c'),
            'calendar' => $feed['name'],
            'color'    => $feed['color'],
        ];
    }

    /** webcal:// -> https:// (Apple publie en webcal, équivalent HTTPS). */
    private function normalizeUrl(string $url): string
    {
        if (str_starts_with($url, 'webcal://')) {
            return 'https://' . substr($url, strlen('webcal://'));
        }
        return $url;
    }

    /** Télécharge le contenu d'un flux. Renvoie null en cas d'échec. */
    private function fetch(string $url): ?string
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION  => true,
            CURLOPT_MAXREDIRS       => 5,
            CURLOPT_CONNECTTIMEOUT  => 8,
            CURLOPT_TIMEOUT         => 15,
            CURLOPT_USERAGENT       => 'OS-Perso-Calendar/1.0',
            CURLOPT_HTTPHEADER      => ['Accept: text/calendar, */*'],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($body === false || $code < 200 || $code >= 300) {
            return null;
        }
        return (string) $body;
    }
}
