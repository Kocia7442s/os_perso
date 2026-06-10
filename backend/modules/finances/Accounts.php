<?php
/**
 * Accounts.php — Comptes & patrimoine (table finance_accounts).
 *
 * Saisie manuelle des soldes. Valeur nette = Σ(soldes hors dette) − Σ(dettes).
 * Une "Dette" se saisit comme un montant dû positif ; elle est soustraite.
 */

require_once __DIR__ . '/../../core/Database.php';

class Accounts
{
    private Database $db;

    /** Types de comptes (source de vérité ; le front en a une copie). */
    public const TYPES = ['Courant', 'Épargne', 'Investissement', 'Crypto', 'Immobilier', 'Dette', 'Autre'];

    /** Types considérés comme des dettes (soustraits de la valeur nette). */
    public const DEBT_TYPES = ['Dette'];

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public static function sanitizeType(?string $type): string
    {
        $type = trim((string) $type);
        return in_array($type, self::TYPES, true) ? $type : 'Autre';
    }

    /** Solde → float signé arrondi à 2 décimales, ou null si non numérique. Tolère la virgule. */
    private static function parseSolde($value): ?float
    {
        if (is_string($value)) {
            $value = str_replace([' ', ','], ['', '.'], trim($value));
        }
        if ($value === '' || $value === null || !is_numeric($value)) {
            return null;
        }
        return round((float) $value, 2);
    }

    private static function normalize(array $r): array
    {
        $type = (string) $r['type'];
        return [
            'id'       => (int) $r['id'],
            'nom'      => (string) $r['nom'],
            'type'     => $type,
            'solde'    => round((float) $r['solde'], 2),
            'est_dette' => in_array($type, self::DEBT_TYPES, true),
        ];
    }

    // ---------------------------------------------------------------------
    //  Lecture
    // ---------------------------------------------------------------------

    /** Tous les comptes (dettes en bas, puis par solde décroissant). */
    public function getAll(): array
    {
        $rows = $this->db->query(
            "SELECT id, nom, type, solde
               FROM finance_accounts
              ORDER BY (type = 'Dette') ASC, solde DESC, nom ASC"
        )->fetchAll();
        return array_map([self::class, 'normalize'], $rows);
    }

    public function get(int $id): ?array
    {
        $row = $this->db->query(
            'SELECT id, nom, type, solde FROM finance_accounts WHERE id = :id',
            [':id' => $id]
        )->fetch();
        return $row ? self::normalize($row) : null;
    }

    /**
     * Vue patrimoine : liste des comptes + synthèse (actifs, dettes, valeur nette,
     * allocation par type pour les actifs positifs).
     */
    public function overview(): array
    {
        $comptes = $this->getAll();

        $actifs = 0.0;
        $dettes = 0.0;
        $parType = []; // type => total (actifs positifs seulement, pour l'allocation)

        foreach ($comptes as $c) {
            if ($c['est_dette']) {
                $dettes += $c['solde'];
            } else {
                $actifs += $c['solde'];
                if ($c['solde'] > 0) {
                    $parType[$c['type']] = ($parType[$c['type']] ?? 0) + $c['solde'];
                }
            }
        }

        // Allocation triée par montant décroissant.
        arsort($parType);
        $allocation = [];
        foreach ($parType as $type => $total) {
            $allocation[] = ['type' => $type, 'montant' => round($total, 2)];
        }

        return [
            'comptes' => $comptes,
            'resume'  => [
                'actifs'       => round($actifs, 2),
                'dettes'       => round($dettes, 2),
                'valeur_nette' => round($actifs - $dettes, 2),
                'allocation'   => $allocation,
            ],
        ];
    }

    // ---------------------------------------------------------------------
    //  Écriture
    // ---------------------------------------------------------------------

    /** Ajoute un compte. @return array|null Le compte créé, ou null si nom vide / solde invalide. */
    public function add(array $data): ?array
    {
        $nom = trim((string) ($data['nom'] ?? ''));
        $solde = self::parseSolde($data['solde'] ?? 0);
        if ($nom === '' || $solde === null) {
            return null;
        }
        $type = self::sanitizeType($data['type'] ?? null);

        $this->db->query(
            'INSERT INTO finance_accounts (nom, type, solde) VALUES (:n, :t, :s)',
            [':n' => mb_substr($nom, 0, 120), ':t' => $type, ':s' => $solde]
        );
        return $this->get((int) $this->db->getConnection()->lastInsertId());
    }

    /** Met à jour un compte (champs partiels). @return array|null null si absent / valeur invalide. */
    public function update(int $id, array $data): ?array
    {
        $current = $this->get($id);
        if ($current === null) {
            return null;
        }

        $nom = $current['nom'];
        if (array_key_exists('nom', $data)) {
            $nom = trim((string) $data['nom']);
            if ($nom === '') {
                return null;
            }
            $nom = mb_substr($nom, 0, 120);
        }

        $type = array_key_exists('type', $data) ? self::sanitizeType($data['type']) : $current['type'];

        $solde = $current['solde'];
        if (array_key_exists('solde', $data)) {
            $parsed = self::parseSolde($data['solde']);
            if ($parsed === null) {
                return null;
            }
            $solde = $parsed;
        }

        $this->db->query(
            'UPDATE finance_accounts SET nom = :n, type = :t, solde = :s WHERE id = :id',
            [':n' => $nom, ':t' => $type, ':s' => $solde, ':id' => $id]
        );
        return $this->get($id);
    }

    /** Supprime un compte. @return bool true si une ligne a été supprimée. */
    public function delete(int $id): bool
    {
        $stmt = $this->db->query('DELETE FROM finance_accounts WHERE id = :id', [':id' => $id]);
        return $stmt->rowCount() > 0;
    }

    // ---------------------------------------------------------------------
    //  Instantanés mensuels de la valeur nette (Phase 2.1)
    // ---------------------------------------------------------------------

    /**
     * Enregistre la valeur nette ACTUELLE comme instantané du mois (upsert : un
     * 2e appel le même mois écrase). Mois par défaut = mois courant.
     * @return array { mois, valeur_nette, actifs, dettes }
     */
    public function takeSnapshot(?string $month = null): array
    {
        $month = trim((string) $month);
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            $month = date('Y-m');
        }
        $r = $this->overview()['resume'];

        // VALUES(col) plutôt que de réutiliser les placeholders (prepared non émulés → HY093).
        $this->db->query(
            'INSERT INTO finance_networth_snapshots (mois, valeur_nette, actifs, dettes)
             VALUES (:m, :vn, :a, :d)
             ON DUPLICATE KEY UPDATE valeur_nette = VALUES(valeur_nette),
                                     actifs = VALUES(actifs), dettes = VALUES(dettes)',
            [':m' => $month, ':vn' => $r['valeur_nette'], ':a' => $r['actifs'], ':d' => $r['dettes']]
        );

        return [
            'mois'         => $month,
            'valeur_nette' => $r['valeur_nette'],
            'actifs'       => $r['actifs'],
            'dettes'       => $r['dettes'],
        ];
    }

    /**
     * Historique des instantanés, du plus ancien au plus récent (pour la courbe).
     * @param int $limit nombre max de mois remontés (borné 1..120).
     */
    public function snapshots(int $limit = 24): array
    {
        $limit = max(1, min($limit, 120)); // borné + casté int → interpolation SQL sûre
        $rows = $this->db->query(
            "SELECT mois, valeur_nette, actifs, dettes
               FROM finance_networth_snapshots
              ORDER BY mois DESC
              LIMIT {$limit}"
        )->fetchAll();

        // On renvoie en ordre chronologique croissant (sens de lecture du graphe).
        return array_map(static fn(array $r): array => [
            'mois'         => (string) $r['mois'],
            'valeur_nette' => round((float) $r['valeur_nette'], 2),
            'actifs'       => round((float) $r['actifs'], 2),
            'dettes'       => round((float) $r['dettes'], 2),
        ], array_reverse($rows));
    }
}
