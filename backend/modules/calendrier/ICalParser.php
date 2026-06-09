<?php
/**
 * ICalParser.php — Parseur iCalendar (RFC 5545) minimal, en PHP natif.
 *
 * But : transformer le texte brut d'un flux .ics (publié depuis Apple Agenda)
 *       en une liste d'événements normalisés, occurrences récurrentes incluses,
 *       bornées à une fenêtre temporelle [from, to].
 *
 * Périmètre ASSUMÉ (lecture seule, agenda simple) :
 *   - Dépliage des lignes repliées (RFC 5545 §3.1 : continuation = espace/tab).
 *   - Blocs VEVENT uniquement (VTODO, VALARM… ignorés).
 *   - Propriétés : UID, SUMMARY, DTSTART, DTEND, LOCATION, RRULE, EXDATE.
 *   - Dates : VALUE=DATE (journée entière), TZID=... (fuseau nommé IANA),
 *             suffixe Z (UTC), sinon heure locale du conteneur.
 *   - RRULE : FREQ=DAILY|WEEKLY|MONTHLY|YEARLY + INTERVAL, COUNT, UNTIL,
 *             BYDAY (utile surtout en WEEKLY). Expansion BORNÉE à la fenêtre.
 *
 * LIMITES connues (à upgrader vers sabre/vobject si besoin un jour) :
 *   - RECURRENCE-ID (instances modifiées d'une série) non fusionnées finement.
 *   - BYSETPOS / BYMONTHDAY / BYMONTH avancés non gérés.
 *   - VTIMEZONE custom ignoré : on s'appuie sur le nom IANA du TZID
 *     (ce qu'Apple émet, ex « Europe/Paris ») via DateTimeZone.
 */

class ICalParser
{
    /** Garde-fou anti-boucle sur l'expansion d'une règle de récurrence. */
    private const MAX_OCCURRENCES = 750;

    /** Correspondance jours iCal -> jours PHP (pour BYDAY). */
    private const BYDAY_MAP = [
        'MO' => 'Monday', 'TU' => 'Tuesday', 'WE' => 'Wednesday',
        'TH' => 'Thursday', 'FR' => 'Friday', 'SA' => 'Saturday', 'SU' => 'Sunday',
    ];

    /**
     * Parse un flux .ics et renvoie les occurrences comprises dans [from, to].
     *
     * @param string   $ics  contenu brut du fichier .ics
     * @param DateTimeImmutable $from début de la fenêtre (incluse)
     * @param DateTimeImmutable $to   fin de la fenêtre (incluse)
     * @return array<int, array{uid:string,title:string,start:DateTimeImmutable,
     *               end:DateTimeImmutable,all_day:bool,location:?string}>
     */
    public function parse(string $ics, DateTimeImmutable $from, DateTimeImmutable $to): array
    {
        $lines  = $this->unfold($ics);
        $events = [];
        $current = null; // VEVENT en cours d'accumulation

        foreach ($lines as $line) {
            if ($line === 'BEGIN:VEVENT') {
                $current = [];
                continue;
            }
            if ($line === 'END:VEVENT') {
                if ($current !== null) {
                    foreach ($this->expand($current, $from, $to) as $occ) {
                        $events[] = $occ;
                    }
                }
                $current = null;
                continue;
            }
            if ($current === null) {
                continue; // on est en-dehors d'un VEVENT
            }

            // Découpe "NOM;PARAM=...:VALEUR" -> [nom, params[], valeur]
            [$name, $params, $value] = $this->splitProperty($line);
            if ($name === '') {
                continue;
            }

            switch ($name) {
                case 'UID':       $current['uid']      = $value; break;
                case 'SUMMARY':   $current['summary']  = $this->unescapeText($value); break;
                case 'LOCATION':  $current['location'] = $this->unescapeText($value); break;
                case 'DTSTART':   $current['dtstart']  = $this->parseDate($value, $params); break;
                case 'DTEND':     $current['dtend']    = $this->parseDate($value, $params); break;
                case 'RRULE':     $current['rrule']    = $this->parseRRule($value); break;
                case 'EXDATE':
                    foreach (explode(',', $value) as $ex) {
                        $d = $this->parseDate($ex, $params);
                        if ($d) {
                            $current['exdate'][$d['dt']->format('Y-m-d H:i:s')] = true;
                        }
                    }
                    break;
            }
        }

        return $events;
    }

    /**
     * RFC 5545 §3.1 : une ligne repliée continue sur la suivante si celle-ci
     * commence par un espace ou une tabulation. On recolle d'abord, on découpe ensuite.
     */
    private function unfold(string $ics): array
    {
        // Normalise les fins de ligne (CRLF / CR -> LF) puis recolle les continuations.
        $normalized = str_replace(["\r\n", "\r"], "\n", $ics);
        $normalized = preg_replace("/\n[ \t]/", '', $normalized);
        $lines = explode("\n", $normalized);
        return array_values(array_filter($lines, static fn($l) => $l !== ''));
    }

    /**
     * Découpe une ligne de propriété en nom, paramètres et valeur.
     * Ex : "DTSTART;TZID=Europe/Paris:20260610T180000"
     *   -> ['DTSTART', ['TZID' => 'Europe/Paris'], '20260610T180000']
     */
    private function splitProperty(string $line): array
    {
        $colon = strpos($line, ':');
        if ($colon === false) {
            return ['', [], ''];
        }
        $head  = substr($line, 0, $colon);
        $value = substr($line, $colon + 1);

        $parts  = explode(';', $head);
        $name   = strtoupper(array_shift($parts));
        $params = [];
        foreach ($parts as $p) {
            $eq = strpos($p, '=');
            if ($eq !== false) {
                $params[strtoupper(substr($p, 0, $eq))] = substr($p, $eq + 1);
            }
        }
        return [$name, $params, $value];
    }

    /**
     * Convertit une valeur de date/heure iCal en structure normalisée.
     * @return array{dt: DateTimeImmutable, all_day: bool}|null
     */
    private function parseDate(string $value, array $params): ?array
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }

        // Journée entière : VALUE=DATE -> "20260610"
        $isAllDay = (($params['VALUE'] ?? '') === 'DATE') || preg_match('/^\d{8}$/', $value);

        try {
            if ($isAllDay) {
                $dt = new DateTimeImmutable(
                    substr($value, 0, 4) . '-' . substr($value, 4, 2) . '-' . substr($value, 6, 2)
                    . ' 00:00:00',
                    new DateTimeZone('UTC')
                );
                return ['dt' => $dt, 'all_day' => true];
            }

            // Date-heure. Suffixe Z = UTC ; sinon TZID si présent ; sinon local.
            if (str_ends_with($value, 'Z')) {
                $tz = new DateTimeZone('UTC');
            } elseif (!empty($params['TZID'])) {
                $tz = $this->safeTimezone($params['TZID']);
            } else {
                $tz = new DateTimeZone(date_default_timezone_get());
            }

            // Format compact iCal : 20260610T180000(Z)
            $clean = rtrim($value, 'Z');
            $dt = DateTimeImmutable::createFromFormat('Ymd\THis', $clean, $tz);
            if ($dt === false) {
                return null;
            }
            return ['dt' => $dt, 'all_day' => false];
        } catch (Exception $e) {
            return null;
        }
    }

    /** TZID -> DateTimeZone, avec repli sur le fuseau local si nom inconnu. */
    private function safeTimezone(string $tzid): DateTimeZone
    {
        try {
            return new DateTimeZone($tzid);
        } catch (Exception $e) {
            return new DateTimeZone(date_default_timezone_get());
        }
    }

    /** "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1" -> tableau associatif. */
    private function parseRRule(string $value): array
    {
        $rule = [];
        foreach (explode(';', $value) as $pair) {
            $eq = strpos($pair, '=');
            if ($eq !== false) {
                $rule[strtoupper(substr($pair, 0, $eq))] = strtoupper(substr($pair, $eq + 1));
            }
        }
        return $rule;
    }

    /**
     * Développe un VEVENT en occurrences comprises dans [from, to].
     * Sans RRULE : 0 ou 1 occurrence. Avec RRULE : expansion bornée.
     */
    private function expand(array $ev, DateTimeImmutable $from, DateTimeImmutable $to): array
    {
        if (empty($ev['dtstart'])) {
            return []; // un VEVENT sans début n'est pas exploitable
        }

        $startInfo = $ev['dtstart'];
        $start     = $startInfo['dt'];
        $allDay    = $startInfo['all_day'];

        // Durée de l'événement (par défaut : ponctuel, ou 1 jour si journée entière).
        if (!empty($ev['dtend'])) {
            $duration = $start->diff($ev['dtend']['dt']);
        } else {
            $duration = $allDay ? new DateInterval('P1D') : new DateInterval('PT0S');
        }

        $exdate = $ev['exdate'] ?? [];
        $base = [
            'uid'      => $ev['uid'] ?? '',
            'title'    => $ev['summary'] ?? '(sans titre)',
            'location' => $ev['location'] ?? null,
            'all_day'  => $allDay,
        ];

        // --- Cas simple : pas de récurrence ---
        if (empty($ev['rrule'])) {
            return $this->emitIfInWindow($start, $duration, $base, $exdate, $from, $to);
        }

        // --- Récurrence : on génère des débuts d'occurrence jusqu'à sortir de la fenêtre ---
        return $this->expandRecurring($start, $duration, $base, $ev['rrule'], $exdate, $from, $to);
    }

    /** Émet une occurrence unique si elle chevauche la fenêtre (et n'est pas exclue). */
    private function emitIfInWindow(
        DateTimeImmutable $start, DateInterval $duration, array $base,
        array $exdate, DateTimeImmutable $from, DateTimeImmutable $to
    ): array {
        if (isset($exdate[$start->format('Y-m-d H:i:s')])) {
            return [];
        }
        $end = $start->add($duration);
        // Chevauchement : l'événement finit après le début de fenêtre et commence avant la fin.
        if ($end < $from || $start > $to) {
            return [];
        }
        return [$base + ['start' => $start, 'end' => $end]];
    }

    /**
     * Expansion d'une RRULE, bornée à [from, to] et plafonnée par MAX_OCCURRENCES.
     * Gère FREQ + INTERVAL + COUNT + UNTIL + BYDAY (BYDAY surtout pertinent en WEEKLY).
     */
    private function expandRecurring(
        DateTimeImmutable $start, DateInterval $duration, array $base, array $rule,
        array $exdate, DateTimeImmutable $from, DateTimeImmutable $to
    ): array {
        $freq     = $rule['FREQ'] ?? '';
        $interval = max(1, (int) ($rule['INTERVAL'] ?? 1));
        $count    = isset($rule['COUNT']) ? (int) $rule['COUNT'] : null;
        $until    = null;
        if (!empty($rule['UNTIL'])) {
            $u = $this->parseDate($rule['UNTIL'], []);
            $until = $u['dt'] ?? null;
        }

        // BYDAY : liste de jours (on ignore les préfixes type "2MO" pour rester simple).
        $byday = [];
        if (!empty($rule['BYDAY'])) {
            foreach (explode(',', $rule['BYDAY']) as $d) {
                $code = preg_replace('/^[+-]?\d+/', '', $d); // retire un éventuel "2", "-1"…
                if (isset(self::BYDAY_MAP[$code])) {
                    $byday[] = $code;
                }
            }
        }

        $occurrences = [];
        $emitted     = 0; // compte les occurrences LOGIQUES (pour COUNT, avant filtrage fenêtre)
        $guard       = 0;
        $cursor      = $start;

        $stepInterval = $this->frequencyInterval($freq, $interval);
        if ($stepInterval === null) {
            // Fréquence non gérée -> on émet au moins l'occurrence de base.
            return $this->emitIfInWindow($start, $duration, $base, $exdate, $from, $to);
        }

        while ($guard++ < self::MAX_OCCURRENCES) {
            // Pour WEEKLY + BYDAY, chaque "pas" couvre une semaine de plusieurs jours.
            $slots = ($freq === 'WEEKLY' && $byday)
                ? $this->weeklySlots($cursor, $byday)
                : [$cursor];

            foreach ($slots as $slotStart) {
                if ($slotStart < $start) {
                    continue; // un slot BYDAY peut tomber avant DTSTART dans la 1re semaine
                }
                if ($until !== null && $slotStart > $until) {
                    return $occurrences;
                }
                if ($count !== null && $emitted >= $count) {
                    return $occurrences;
                }
                $emitted++;

                if (isset($exdate[$slotStart->format('Y-m-d H:i:s')])) {
                    continue;
                }
                $end = $slotStart->add($duration);
                if ($end >= $from && $slotStart <= $to) {
                    $occurrences[] = $base + ['start' => $slotStart, 'end' => $end];
                }
            }

            // Au-delà de la fenêtre : inutile de continuer à dérouler.
            if ($cursor > $to) {
                break;
            }
            $cursor = $cursor->add($stepInterval);
        }

        return $occurrences;
    }

    /** Pas d'avancement entre deux "cycles" de récurrence selon la fréquence. */
    private function frequencyInterval(string $freq, int $interval): ?DateInterval
    {
        return match ($freq) {
            'DAILY'   => new DateInterval("P{$interval}D"),
            'WEEKLY'  => new DateInterval("P" . ($interval * 7) . "D"),
            'MONTHLY' => new DateInterval("P{$interval}M"),
            'YEARLY'  => new DateInterval("P{$interval}Y"),
            default   => null,
        };
    }

    /**
     * Pour une semaine donnée (représentée par $cursor) et une liste BYDAY,
     * renvoie les débuts d'occurrence en conservant l'heure de $cursor.
     */
    private function weeklySlots(DateTimeImmutable $cursor, array $byday): array
    {
        $slots = [];
        // Lundi de la semaine du curseur (la RFC commande sur WKST=MO par défaut).
        $monday = $cursor->modify('Monday this week');
        $time   = $cursor->format('H:i:s');
        foreach ($byday as $code) {
            $day = $monday->modify(self::BYDAY_MAP[$code] . ' this week')->modify($time);
            $slots[] = $day;
        }
        usort($slots, static fn($a, $b) => $a <=> $b);
        return $slots;
    }

    /** Dé-échappe le texte iCal (\, \; \n …). */
    private function unescapeText(string $value): string
    {
        return str_replace(
            ['\\n', '\\N', '\\,', '\\;', '\\\\'],
            ["\n", "\n", ',', ';', '\\'],
            $value
        );
    }
}
