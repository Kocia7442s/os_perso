<?php
/**
 * Preferences.php — Préférences du foyer pour le générateur de menu.
 *
 * Table à ligne unique (id=1). Sert deux usages :
 *   - lecture/écriture via l'API (/backend/foyer/preferences)
 *   - injection dans le prompt par MenuGenerator::buildPrompt()
 */

require_once __DIR__ . '/../../core/Database.php';

class Preferences
{
    private Database $db;

    /** Valeurs par défaut (filet de sécurité si la table est vide). */
    private const DEFAULTS = [
        'household_size' => 2,
        'veggie_meals'   => 2,
        'max_pasta'      => 2,
        'avoid'          => '',
    ];

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Lit les préférences du foyer.
     * @return array { household_size, veggie_meals, max_pasta, avoid }
     */
    public function get(): array
    {
        $row = $this->db->query(
            'SELECT household_size, veggie_meals, max_pasta, avoid
               FROM user_preferences
              ORDER BY id ASC
              LIMIT 1'
        )->fetch();

        if (!$row) {
            return self::DEFAULTS;
        }

        // PDO renvoie des chaînes : on normalise les types pour le front et le prompt.
        return [
            'household_size' => (int) $row['household_size'],
            'veggie_meals'   => (int) $row['veggie_meals'],
            'max_pasta'      => (int) $row['max_pasta'],
            'avoid'          => (string) ($row['avoid'] ?? ''),
        ];
    }

    /**
     * Enregistre les préférences (valide et borne les valeurs reçues).
     * @param  array $input Données brutes (ex : corps JSON de la requête POST).
     * @return array        Les préférences finales, telles qu'enregistrées.
     */
    public function save(array $input): array
    {
        // Bornage défensif : on ne fait jamais confiance aux entrées.
        $household = $this->clampInt($input['household_size'] ?? null, 1, 20, self::DEFAULTS['household_size']);
        $veggie    = $this->clampInt($input['veggie_meals']   ?? null, 0, 9,  self::DEFAULTS['veggie_meals']);
        $maxPasta  = $this->clampInt($input['max_pasta']      ?? null, 0, 9,  self::DEFAULTS['max_pasta']);

        $avoid = trim((string) ($input['avoid'] ?? ''));
        if (mb_strlen($avoid) > 500) {
            $avoid = mb_substr($avoid, 0, 500);
        }

        // UPSERT sur la ligne unique (id=1).
        $this->db->query(
            'INSERT INTO user_preferences (id, household_size, veggie_meals, max_pasta, avoid)
                  VALUES (1, :h, :v, :p, :a)
             ON DUPLICATE KEY UPDATE
                  household_size = VALUES(household_size),
                  veggie_meals   = VALUES(veggie_meals),
                  max_pasta      = VALUES(max_pasta),
                  avoid          = VALUES(avoid)',
            [':h' => $household, ':v' => $veggie, ':p' => $maxPasta, ':a' => $avoid]
        );

        return $this->get();
    }

    /** Caste en entier puis borne dans [min, max] ; renvoie $default si non fourni. */
    private function clampInt($value, int $min, int $max, int $default): int
    {
        if ($value === null || $value === '') {
            return $default;
        }
        return max($min, min($max, (int) $value));
    }
}
