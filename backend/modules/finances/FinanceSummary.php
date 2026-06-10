<?php
/**
 * FinanceSummary.php — Agrégations du module FINANCES (lecture seule).
 *
 * Calcule, pour un mois donné : totaux dépenses/revenus/solde, répartition par
 * catégorie, répartition par "qui", et l'évolution des derniers mois.
 * Tout est fait en SQL (SUM/CASE) pour rester rapide même avec beaucoup de lignes.
 */

require_once __DIR__ . '/../../core/Database.php';

class FinanceSummary
{
    private Database $db;

    /** Nombre de mois remontés dans l'évolution (mois courant inclus). */
    public const EVOLUTION_MONTHS = 6;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /** Mois "AAAA-MM" valide, sinon null. */
    private static function validMonth(?string $month): ?string
    {
        $month = trim((string) $month);
        return preg_match('/^\d{4}-\d{2}$/', $month) ? $month : null;
    }

    /**
     * Synthèse complète d'un mois.
     * @param string $month "AAAA-MM" (défaut : mois courant si invalide/absent).
     */
    public function forMonth(?string $month): array
    {
        $month = self::validMonth($month) ?? date('Y-m');

        return [
            'month'         => $month,
            'totaux'        => $this->totals($month),
            'par_categorie' => $this->byCategory($month),
            'par_qui'       => $this->byQui($month),
            'evolution'     => $this->evolution($month),
        ];
    }

    /** Totaux dépenses / revenus / solde du mois. */
    private function totals(string $month): array
    {
        $row = $this->db->query(
            "SELECT
                COALESCE(SUM(CASE WHEN type = 'depense' THEN montant ELSE 0 END), 0) AS depenses,
                COALESCE(SUM(CASE WHEN type = 'revenu'  THEN montant ELSE 0 END), 0) AS revenus
             FROM finance_transactions
             WHERE DATE_FORMAT(date, '%Y-%m') = :m",
            [':m' => $month]
        )->fetch();

        $depenses = round((float) $row['depenses'], 2);
        $revenus  = round((float) $row['revenus'], 2);
        return [
            'depenses' => $depenses,
            'revenus'  => $revenus,
            'solde'    => round($revenus - $depenses, 2),
        ];
    }

    /** Répartition des DÉPENSES du mois par catégorie (décroissant). */
    private function byCategory(string $month): array
    {
        $rows = $this->db->query(
            "SELECT categorie, SUM(montant) AS total
               FROM finance_transactions
              WHERE type = 'depense' AND DATE_FORMAT(date, '%Y-%m') = :m
              GROUP BY categorie
              ORDER BY total DESC",
            [':m' => $month]
        )->fetchAll();

        return array_map(static fn(array $r): array => [
            'categorie' => (string) $r['categorie'],
            'montant'   => round((float) $r['total'], 2),
        ], $rows);
    }

    /** Répartition par "qui" : dépenses ET revenus de chacun sur le mois. */
    private function byQui(string $month): array
    {
        $rows = $this->db->query(
            "SELECT qui,
                COALESCE(SUM(CASE WHEN type = 'depense' THEN montant ELSE 0 END), 0) AS depenses,
                COALESCE(SUM(CASE WHEN type = 'revenu'  THEN montant ELSE 0 END), 0) AS revenus
             FROM finance_transactions
             WHERE DATE_FORMAT(date, '%Y-%m') = :m
             GROUP BY qui",
            [':m' => $month]
        )->fetchAll();

        return array_map(static fn(array $r): array => [
            'qui'      => (string) $r['qui'],
            'depenses' => round((float) $r['depenses'], 2),
            'revenus'  => round((float) $r['revenus'], 2),
        ], $rows);
    }

    /**
     * Évolution des EVOLUTION_MONTHS derniers mois (jusqu'au mois donné inclus).
     * On construit la fenêtre en PHP pour garantir des mois "à zéro" même sans
     * transaction (le front a ainsi une série continue à tracer).
     */
    private function evolution(string $month): array
    {
        $end = DateTime::createFromFormat('Y-m-d', $month . '-01');
        if (!$end) {
            $end = new DateTime('first day of this month');
        }

        // Liste ordonnée des mois de la fenêtre (du plus ancien au plus récent).
        $months = [];
        $cursor = (clone $end)->modify('-' . (self::EVOLUTION_MONTHS - 1) . ' months');
        for ($i = 0; $i < self::EVOLUTION_MONTHS; $i++) {
            $months[$cursor->format('Y-m')] = ['mois' => $cursor->format('Y-m'), 'depenses' => 0.0, 'revenus' => 0.0];
            $cursor->modify('+1 month');
        }

        $from = (clone $end)->modify('-' . (self::EVOLUTION_MONTHS - 1) . ' months')->format('Y-m-d');
        $to   = (clone $end)->modify('+1 month')->format('Y-m-d'); // 1er du mois suivant (exclu)

        $rows = $this->db->query(
            "SELECT DATE_FORMAT(date, '%Y-%m') AS mois,
                COALESCE(SUM(CASE WHEN type = 'depense' THEN montant ELSE 0 END), 0) AS depenses,
                COALESCE(SUM(CASE WHEN type = 'revenu'  THEN montant ELSE 0 END), 0) AS revenus
             FROM finance_transactions
             WHERE date >= :from AND date < :to
             GROUP BY mois",
            [':from' => $from, ':to' => $to]
        )->fetchAll();

        foreach ($rows as $r) {
            $key = (string) $r['mois'];
            if (isset($months[$key])) {
                $months[$key]['depenses'] = round((float) $r['depenses'], 2);
                $months[$key]['revenus']  = round((float) $r['revenus'], 2);
            }
        }

        return array_values($months);
    }
}
