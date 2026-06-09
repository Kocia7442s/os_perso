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
    /** Durée de vie du cache d'un flux, en secondes (surchargeable via CAL_CACHE_TTL). */
    private const CACHE_TTL = 600; // 10 min

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

        return $this->getEventsBetween($from, $to);
    }

    /**
     * Variante explicite : événements fusionnés dans la plage [$from, $to].
     * Sert à la navigation calendrier (semaine / mois) côté front.
     *
     * @return array{events: array, calendars: array, errors: array}
     */
    public function getEventsBetween(DateTimeImmutable $from, DateTimeImmutable $to): array
    {
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

    /**
     * Renvoie le contenu d'un flux, via cache fichier (TTL) avec repli :
     *   1. cache frais (< TTL)        → renvoyé tel quel (rapide, pas de réseau) ;
     *   2. sinon fetch réseau réussi  → mis en cache puis renvoyé ;
     *   3. fetch échoué mais cache    → on sert le cache PÉRIMÉ (mieux que rien) ;
     *   4. ni l'un ni l'autre         → null (flux réellement injoignable).
     */
    private function fetch(string $url): ?string
    {
        $cacheFile = $this->cacheFile($url);
        $ttl = (int) (getenv('CAL_CACHE_TTL') ?: self::CACHE_TTL);

        // 1) Cache encore frais ?
        if (is_file($cacheFile) && (time() - (int) filemtime($cacheFile)) < $ttl) {
            $cached = @file_get_contents($cacheFile);
            if ($cached !== false && $cached !== '') {
                return $cached;
            }
        }

        // 2) Récupération réseau (avec une nouvelle tentative).
        $body = $this->fetchLive($url);
        if ($body !== null) {
            $this->writeCache($cacheFile, $body);
            return $body;
        }

        // 3) Échec réseau : on sert le dernier cache disponible, même périmé.
        if (is_file($cacheFile)) {
            $stale = @file_get_contents($cacheFile);
            if ($stale !== false && $stale !== '') {
                return $stale;
            }
        }

        // 4) Rien à servir.
        return null;
    }

    /** Téléchargement réseau pur (2 tentatives). Renvoie null en cas d'échec. */
    private function fetchLive(string $url): ?string
    {
        for ($attempt = 1; $attempt <= 2; $attempt++) {
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

            if ($body !== false && $body !== '' && $code >= 200 && $code < 300) {
                return (string) $body;
            }
        }
        return null;
    }

    /** Chemin du fichier de cache pour une URL (dossier temporaire du conteneur). */
    private function cacheFile(string $url): string
    {
        $dir = sys_get_temp_dir() . '/os_perso_cal_cache';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        return $dir . '/' . md5($url) . '.ics';
    }

    /** Écrit le cache de façon atomique (écriture temporaire puis renommage). */
    private function writeCache(string $cacheFile, string $body): void
    {
        $tmp = $cacheFile . '.' . getmypid() . '.tmp';
        if (@file_put_contents($tmp, $body, LOCK_EX) !== false) {
            @rename($tmp, $cacheFile);
        }
    }
}
