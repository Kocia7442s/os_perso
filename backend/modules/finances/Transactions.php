<?php
/**
 * Transactions.php — Dépenses & revenus du module FINANCES (table finance_transactions).
 *
 * Saisie 100 % manuelle. Chaque opération porte un "qui" (moi/partenaire/commun)
 * pour la dimension couple. Le montant est TOUJOURS positif : c'est le `type`
 * (depense|revenu) qui porte le signe.
 */

require_once __DIR__ . '/../../core/Database.php';

class Transactions
{
    private Database $db;

    /** Types d'opération valides. */
    public const TYPES = ['depense', 'revenu'];

    /** Propriétaires possibles (dimension couple). Libellés d'affichage côté front. */
    public const QUI = ['moi', 'partenaire', 'commun'];

    /**
     * Catégories prédéfinies, par type. Source de vérité (le front en a une copie
     * synchro via GET /finances/categories). Toute valeur inconnue → "Autre".
     */
    public const CATEGORIES = [
        'depense' => [
            'Courses', 'Logement', 'Transport', 'Loisirs & Sorties', 'Resto',
            'Santé', 'Abonnements', 'Shopping', 'Autre',
        ],
        'revenu' => [
            'Salaire', 'Remboursement', 'Autre',
        ],
    ];

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // ---------------------------------------------------------------------
    //  Normalisation des entrées (toujours retomber sur une valeur valide)
    // ---------------------------------------------------------------------

    public static function sanitizeType(?string $type): string
    {
        $type = strtolower(trim((string) $type));
        return in_array($type, self::TYPES, true) ? $type : 'depense';
    }

    public static function sanitizeQui(?string $qui): string
    {
        $qui = strtolower(trim((string) $qui));
        return in_array($qui, self::QUI, true) ? $qui : 'commun';
    }

    /** Normalise une catégorie vers la liste du type (insensible à la casse), défaut "Autre". */
    public static function sanitizeCategorie(string $type, ?string $cat): string
    {
        $cat  = trim((string) $cat);
        $list = self::CATEGORIES[$type] ?? self::CATEGORIES['depense'];
        if ($cat === '') {
            return 'Autre';
        }
        foreach ($list as $c) {
            if (mb_strtolower($c) === mb_strtolower($cat)) {
                return $c;
            }
        }
        return 'Autre';
    }

    /** Forme normalisée d'une ligne BDD pour le front (types castés proprement). */
    private static function normalize(array $r): array
    {
        return [
            'id'        => (int) $r['id'],
            'date'      => (string) $r['date'],
            'type'      => (string) $r['type'],
            'montant'   => round((float) $r['montant'], 2),
            'categorie' => (string) $r['categorie'],
            'qui'       => (string) $r['qui'],
            'libelle'   => (string) ($r['libelle'] ?? ''),
            'note'      => (string) ($r['note'] ?? ''),
        ];
    }

    // ---------------------------------------------------------------------
    //  Lecture
    // ---------------------------------------------------------------------

    /**
     * Liste filtrable. Filtres optionnels : month (AAAA-MM), type, qui, categorie.
     * Tri : date décroissante puis id décroissant (les plus récents en haut).
     * @return array Liste de transactions normalisées.
     */
    public function getAll(array $filters = []): array
    {
        $where  = [];
        $params = [];

        if (!empty($filters['month']) && preg_match('/^\d{4}-\d{2}$/', $filters['month'])) {
            $where[]            = "DATE_FORMAT(date, '%Y-%m') = :month";
            $params[':month']   = $filters['month'];
        }
        if (!empty($filters['type']) && in_array($filters['type'], self::TYPES, true)) {
            $where[]          = 'type = :type';
            $params[':type']  = $filters['type'];
        }
        if (!empty($filters['qui']) && in_array($filters['qui'], self::QUI, true)) {
            $where[]         = 'qui = :qui';
            $params[':qui']  = $filters['qui'];
        }
        if (!empty($filters['categorie'])) {
            $where[]              = 'categorie = :cat';
            $params[':cat']       = (string) $filters['categorie'];
        }

        $sql = 'SELECT id, date, type, montant, categorie, qui, libelle, note
                  FROM finance_transactions';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY date DESC, id DESC';

        $rows = $this->db->query($sql, $params)->fetchAll();
        return array_map([self::class, 'normalize'], $rows);
    }

    /** Lit une transaction par id. */
    public function get(int $id): ?array
    {
        $row = $this->db->query(
            'SELECT id, date, type, montant, categorie, qui, libelle, note
               FROM finance_transactions WHERE id = :id',
            [':id' => $id]
        )->fetch();
        return $row ? self::normalize($row) : null;
    }

    // ---------------------------------------------------------------------
    //  Écriture
    // ---------------------------------------------------------------------

    /**
     * Ajoute une transaction. Valide : montant > 0 et date AAAA-MM-JJ.
     * @return array|null La transaction créée (normalisée), ou null si invalide.
     */
    public function add(array $data): ?array
    {
        $type    = self::sanitizeType($data['type'] ?? null);
        $montant = self::parseMontant($data['montant'] ?? null);
        $date    = self::parseDate($data['date'] ?? null);
        if ($montant === null || $date === null) {
            return null;
        }
        $categorie = self::sanitizeCategorie($type, $data['categorie'] ?? null);
        $qui       = self::sanitizeQui($data['qui'] ?? null);
        $libelle   = self::clean($data['libelle'] ?? null, 255);
        $note      = self::clean($data['note'] ?? null, 2000);

        $this->db->query(
            'INSERT INTO finance_transactions (date, type, montant, categorie, qui, libelle, note)
             VALUES (:date, :type, :montant, :cat, :qui, :lib, :note)',
            [
                ':date' => $date, ':type' => $type, ':montant' => $montant,
                ':cat' => $categorie, ':qui' => $qui,
                ':lib' => $libelle, ':note' => $note,
            ]
        );
        return $this->get((int) $this->db->getConnection()->lastInsertId());
    }

    /**
     * Met à jour une transaction (champs partiels). Renvoie la version à jour ou null si absente.
     */
    public function update(int $id, array $data): ?array
    {
        $current = $this->get($id);
        if ($current === null) {
            return null;
        }

        // On part de l'existant, on n'écrase que ce qui est fourni.
        $type = array_key_exists('type', $data)
            ? self::sanitizeType($data['type']) : $current['type'];

        $montant = $current['montant'];
        if (array_key_exists('montant', $data)) {
            $parsed = self::parseMontant($data['montant']);
            if ($parsed === null) {
                return null; // montant fourni mais invalide
            }
            $montant = $parsed;
        }

        $date = $current['date'];
        if (array_key_exists('date', $data)) {
            $parsed = self::parseDate($data['date']);
            if ($parsed === null) {
                return null;
            }
            $date = $parsed;
        }

        $categorie = array_key_exists('categorie', $data)
            ? self::sanitizeCategorie($type, $data['categorie']) : $current['categorie'];
        // Si le type change, on revalide la catégorie existante contre le nouveau type.
        if (array_key_exists('type', $data) && !array_key_exists('categorie', $data)) {
            $categorie = self::sanitizeCategorie($type, $current['categorie']);
        }
        $qui     = array_key_exists('qui', $data) ? self::sanitizeQui($data['qui']) : $current['qui'];
        $libelle = array_key_exists('libelle', $data) ? self::clean($data['libelle'], 255) : $current['libelle'];
        $note    = array_key_exists('note', $data) ? self::clean($data['note'], 2000) : $current['note'];

        $this->db->query(
            'UPDATE finance_transactions
                SET date = :date, type = :type, montant = :montant,
                    categorie = :cat, qui = :qui, libelle = :lib, note = :note
              WHERE id = :id',
            [
                ':date' => $date, ':type' => $type, ':montant' => $montant,
                ':cat' => $categorie, ':qui' => $qui,
                ':lib' => $libelle !== '' ? $libelle : null,
                ':note' => $note !== '' ? $note : null,
                ':id' => $id,
            ]
        );
        return $this->get($id);
    }

    /** Supprime une transaction. @return bool true si une ligne a été supprimée. */
    public function delete(int $id): bool
    {
        $stmt = $this->db->query(
            'DELETE FROM finance_transactions WHERE id = :id',
            [':id' => $id]
        );
        return $stmt->rowCount() > 0;
    }

    // ---------------------------------------------------------------------
    //  Petits parseurs / nettoyeurs
    // ---------------------------------------------------------------------

    /** Montant → float positif arrondi à 2 décimales, ou null si invalide/≤0. Tolère la virgule. */
    private static function parseMontant($value): ?float
    {
        if (is_string($value)) {
            $value = str_replace([' ', ','], ['', '.'], trim($value));
        }
        if (!is_numeric($value)) {
            return null;
        }
        $m = round((float) $value, 2);
        return $m > 0 ? $m : null;
    }

    /** Date "AAAA-MM-JJ" valide → renvoyée telle quelle, sinon null. */
    private static function parseDate($value): ?string
    {
        $value = trim((string) $value);
        $d = DateTime::createFromFormat('Y-m-d', $value);
        return ($d && $d->format('Y-m-d') === $value) ? $value : null;
    }

    /** Trim + coupe à $max caractères (texte libre). */
    private static function clean($value, int $max): string
    {
        return mb_substr(trim((string) $value), 0, $max);
    }
}
