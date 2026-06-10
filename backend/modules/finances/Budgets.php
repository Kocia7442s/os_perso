<?php
/**
 * Budgets.php — Budgets mensuels par catégorie (table finance_budgets).
 *
 * Un budget = un plafond mensuel RÉCURRENT pour une catégorie de dépense
 * (un seul par catégorie). On le compare au réalisé du mois demandé pour
 * produire progression + alerte de dépassement.
 */

require_once __DIR__ . '/../../core/Database.php';
require_once __DIR__ . '/Transactions.php';

class Budgets
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /** Mois "AAAA-MM" valide, sinon mois courant. */
    private static function month(?string $month): string
    {
        $month = trim((string) $month);
        return preg_match('/^\d{4}-\d{2}$/', $month) ? $month : date('Y-m');
    }

    /**
     * Définit (ou met à jour) le budget d'une catégorie. Un montant ≤ 0 SUPPRIME
     * le budget (catégorie "dé-budgétée"). La catégorie doit exister côté dépenses.
     *
     * @return array|null Le budget { categorie, montant } ; null si supprimé/invalide.
     */
    public function set(?string $categorie, $montant): ?array
    {
        $categorie = trim((string) $categorie);
        // On n'accepte que les catégories de dépense connues (sinon rien à budgéter).
        if (!in_array($categorie, Transactions::CATEGORIES['depense'], true)) {
            return null;
        }

        $m = self::parseMontant($montant);
        if ($m === null) {
            // Montant absent / ≤ 0 / invalide → on supprime un éventuel budget existant.
            $this->db->query('DELETE FROM finance_budgets WHERE categorie = :c', [':c' => $categorie]);
            return null;
        }

        // NB : on n'utilise pas deux fois le placeholder :m (les prepared statements
        // ne sont pas émulés → HY093). VALUES(montant) reprend la valeur insérée.
        $this->db->query(
            'INSERT INTO finance_budgets (categorie, montant) VALUES (:c, :m)
             ON DUPLICATE KEY UPDATE montant = VALUES(montant)',
            [':c' => $categorie, ':m' => $m]
        );
        return ['categorie' => $categorie, 'montant' => $m];
    }

    /**
     * Vue d'ensemble pour un mois : chaque budget enrichi du réalisé + une synthèse.
     *
     * @return array {
     *   month: string,
     *   budgets: [ { categorie, montant, depense, reste, pourcentage, depassement:bool } ],
     *   resume:  { budget_total, depense_total, reste_total, depassements:int }
     * }
     */
    public function forMonth(?string $month): array
    {
        $month = self::month($month);

        $rows = $this->db->query(
            "SELECT b.categorie, b.montant,
                COALESCE((
                    SELECT SUM(t.montant) FROM finance_transactions t
                     WHERE t.type = 'depense' AND t.categorie = b.categorie
                       AND DATE_FORMAT(t.date, '%Y-%m') = :m
                ), 0) AS depense
             FROM finance_budgets b
             ORDER BY b.categorie ASC",
            [':m' => $month]
        )->fetchAll();

        $budgets       = [];
        $budgetTotal   = 0.0;
        $depenseTotal  = 0.0;
        $depassements  = 0;

        foreach ($rows as $r) {
            $montant = round((float) $r['montant'], 2);
            $depense = round((float) $r['depense'], 2);
            $reste   = round($montant - $depense, 2);
            $pct     = $montant > 0 ? (int) round(($depense / $montant) * 100) : 0;
            $over    = $depense > $montant;

            $budgetTotal  += $montant;
            $depenseTotal += $depense;
            if ($over) {
                $depassements++;
            }

            $budgets[] = [
                'categorie'    => (string) $r['categorie'],
                'montant'      => $montant,
                'depense'      => $depense,
                'reste'        => $reste,
                'pourcentage'  => $pct,
                'depassement'  => $over,
            ];
        }

        return [
            'month'   => $month,
            'budgets' => $budgets,
            'resume'  => [
                'budget_total'  => round($budgetTotal, 2),
                'depense_total' => round($depenseTotal, 2),
                'reste_total'   => round($budgetTotal - $depenseTotal, 2),
                'depassements'  => $depassements,
            ],
        ];
    }

    /** Montant → float positif arrondi, ou null si ≤ 0 / invalide. Tolère la virgule. */
    private static function parseMontant($value): ?float
    {
        if (is_string($value)) {
            $value = str_replace([' ', ','], ['', '.'], trim($value));
        }
        if ($value === '' || $value === null || !is_numeric($value)) {
            return null;
        }
        $m = round((float) $value, 2);
        return $m > 0 ? $m : null;
    }
}
