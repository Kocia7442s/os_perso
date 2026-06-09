<?php
/**
 * Pantry.php — Gestion des placards (table inventory_pantry).
 *
 * CRUD du stock d'ingrédients que l'IA utilise pour composer les menus et
 * déduire la liste de courses.
 */

require_once __DIR__ . '/../../core/Database.php';

class Pantry
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Tous les ingrédients : essentiels d'abord, puis ordre alphabétique.
     * @return array Liste de { id, item_name, quantity, is_essential:bool }.
     */
    public function getAll(): array
    {
        $rows = $this->db->query(
            'SELECT id, item_name, quantity, is_essential
               FROM inventory_pantry
              ORDER BY is_essential DESC, item_name ASC'
        )->fetchAll();

        return array_map(static function (array $r): array {
            return [
                'id'           => (int) $r['id'],
                'item_name'    => $r['item_name'],
                'quantity'     => (string) ($r['quantity'] ?? ''),
                'is_essential' => (bool) (int) $r['is_essential'],
            ];
        }, $rows);
    }

    /**
     * Indique si un ingrédient du même nom existe déjà (comparaison insensible
     * à la casse / aux espaces). Sert à éviter les doublons lors d'un "ranger au placard".
     */
    public function existsByName(string $name): bool
    {
        $name = trim($name);
        if ($name === '') {
            return false;
        }
        $row = $this->db->query(
            'SELECT 1 FROM inventory_pantry WHERE LOWER(item_name) = LOWER(:n) LIMIT 1',
            [':n' => $name]
        )->fetch();
        return (bool) $row;
    }

    /**
     * Ajoute un ingrédient.
     * @return array|null L'ingrédient créé, ou null si le nom est vide.
     */
    public function add(string $itemName, ?string $quantity = null, bool $isEssential = false): ?array
    {
        $itemName = trim($itemName);
        if ($itemName === '') {
            return null;
        }
        // quantity est NOT NULL DEFAULT '1' en base : on retombe sur '1' si vide.
        $qty = $quantity !== null ? trim($quantity) : '';
        if ($qty === '') {
            $qty = '1';
        }

        $this->db->query(
            'INSERT INTO inventory_pantry (item_name, quantity, is_essential)
                  VALUES (:n, :q, :e)',
            [':n' => $itemName, ':q' => $qty, ':e' => $isEssential ? 1 : 0]
        );
        $id = (int) $this->db->getConnection()->lastInsertId();

        return [
            'id'           => $id,
            'item_name'    => $itemName,
            'quantity'     => $qty,
            'is_essential' => $isEssential,
        ];
    }

    /**
     * Met à jour un ingrédient (seuls les champs fournis sont modifiés).
     * @param  array $fields { item_name?, quantity?, is_essential? }
     * @return array|null L'ingrédient mis à jour, ou null s'il n'existe pas.
     */
    public function update(int $id, array $fields): ?array
    {
        $row = $this->db->query(
            'SELECT id, item_name, quantity, is_essential FROM inventory_pantry WHERE id = :id',
            [':id' => $id]
        )->fetch();
        if (!$row) {
            return null;
        }

        // On part des valeurs existantes, puis on applique les champs fournis.
        $name = $row['item_name'];
        if (array_key_exists('item_name', $fields)) {
            $candidate = trim((string) $fields['item_name']);
            if ($candidate !== '') {
                $name = $candidate; // on ne vide jamais le nom
            }
        }
        $qty = array_key_exists('quantity', $fields)
            ? trim((string) $fields['quantity']) : (string) $row['quantity'];
        if ($qty === '') {
            $qty = '1';
        }
        $essential = array_key_exists('is_essential', $fields)
            ? (bool) $fields['is_essential'] : (bool) (int) $row['is_essential'];

        $this->db->query(
            'UPDATE inventory_pantry
                SET item_name = :n, quantity = :q, is_essential = :e
              WHERE id = :id',
            [':n' => $name, ':q' => $qty, ':e' => $essential ? 1 : 0, ':id' => $id]
        );

        return [
            'id'           => $id,
            'item_name'    => $name,
            'quantity'     => $qty,
            'is_essential' => $essential,
        ];
    }

    /**
     * Supprime un ingrédient.
     * @return bool true si une ligne a bien été supprimée.
     */
    public function delete(int $id): bool
    {
        $stmt = $this->db->query(
            'DELETE FROM inventory_pantry WHERE id = :id',
            [':id' => $id]
        );
        return $stmt->rowCount() > 0;
    }

    /**
     * Décrémente le stock d'un ingrédient consommé par un plat cuisiné.
     * Stratégie "intelligente" :
     *   - quantités comparables (même unité après normalisation) → soustraction ;
     *       reste > 0  → on met à jour ;
     *       reste ≤ 0  → essentiel : remis à "0" (jamais retiré) ; sinon retiré ;
     *   - quantités NON comparables (unités différentes / non numériques) →
     *       essentiel : laissé tel quel ; sinon retiré (considéré consommé).
     * Si l'ingrédient n'est pas au placard : aucune action.
     *
     * @return array{ingredient:string, found:bool, action?:string, from?:string, to?:string}
     */
    public function consume(string $name, ?string $neededQty = null): array
    {
        $name = trim($name);
        $row  = $this->db->query(
            'SELECT id, item_name, quantity, is_essential
               FROM inventory_pantry
              WHERE LOWER(item_name) = LOWER(:n)
              LIMIT 1',
            [':n' => $name]
        )->fetch();

        if (!$row) {
            return ['ingredient' => $name, 'found' => false];
        }

        $id        = (int) $row['id'];
        $fromQty   = (string) ($row['quantity'] ?? '');
        $essential = (bool) (int) $row['is_essential'];

        $stock = $this->parseQuantity($fromQty);
        $need  = $this->parseQuantity((string) ($neededQty ?? ''));

        // Cas comparable : même base d'unité et nombres exploitables.
        if ($stock !== null && $need !== null && $stock['base'] === $need['base']) {
            $remaining = $stock['value'] - $need['value'];

            if ($remaining > 0.0001) {
                $newQty = $this->formatQuantity($remaining, $stock['base']);
                $this->update($id, ['quantity' => $newQty]);
                return ['ingredient' => $row['item_name'], 'found' => true,
                        'action' => 'updated', 'from' => $fromQty, 'to' => $newQty];
            }

            // Épuisé.
            if ($essential) {
                $zero = $this->formatQuantity(0, $stock['base']);
                $this->update($id, ['quantity' => $zero]);
                return ['ingredient' => $row['item_name'], 'found' => true,
                        'action' => 'zeroed', 'from' => $fromQty, 'to' => $zero];
            }
            $this->delete($id);
            return ['ingredient' => $row['item_name'], 'found' => true,
                    'action' => 'removed', 'from' => $fromQty];
        }

        // Non comparable.
        if ($essential) {
            return ['ingredient' => $row['item_name'], 'found' => true,
                    'action' => 'kept', 'from' => $fromQty];
        }
        $this->delete($id);
        return ['ingredient' => $row['item_name'], 'found' => true,
                'action' => 'removed', 'from' => $fromQty];
    }

    /**
     * Analyse une quantité texte libre en { value, base } (valeur normalisée
     * vers une unité de base : g, ml, u=unité, ou l'unité brute si inconnue).
     * Renvoie null si aucun nombre exploitable.
     */
    private function parseQuantity(string $q): ?array
    {
        $q = trim($q);
        if ($q === '') {
            return null;
        }
        if (!preg_match('/^\s*([0-9]+(?:[.,][0-9]+)?)\s*(.*)$/u', $q, $m)) {
            return null;
        }
        $num  = (float) str_replace(',', '.', $m[1]);
        $unit = strtolower(trim($m[2]));

        // Unités connues -> [base, facteur vers la base].
        static $known = [
            'g' => ['g', 1], 'gr' => ['g', 1], 'gramme' => ['g', 1], 'grammes' => ['g', 1],
            'kg' => ['g', 1000], 'kilo' => ['g', 1000], 'kilos' => ['g', 1000],
            'mg' => ['g', 0.001],
            'l' => ['ml', 1000], 'litre' => ['ml', 1000], 'litres' => ['ml', 1000],
            'dl' => ['ml', 100], 'cl' => ['ml', 10], 'ml' => ['ml', 1],
        ];
        static $pieces = ['', 'pièce', 'pièces', 'piece', 'pieces', 'pc', 'pcs', 'unité', 'unités', 'u'];

        if (isset($known[$unit])) {
            return ['value' => $num * $known[$unit][1], 'base' => $known[$unit][0]];
        }
        if (in_array($unit, $pieces, true)) {
            return ['value' => $num, 'base' => 'u'];
        }
        // Unité inconnue (ex : "boîtes") : on singularise grossièrement (retrait du
        // "s" final) pour que "boîte"/"boîtes" ou "paquet"/"paquets" soient comparables.
        $singular = preg_replace('/s$/u', '', $unit);
        return ['value' => $num, 'base' => $singular !== '' ? $singular : $unit];
    }

    /** Reformate une valeur normalisée en quantité lisible ("300 g", "1.5 kg", "4"). */
    private function formatQuantity(float $value, string $base): string
    {
        $fmt = static function (float $v): string {
            // Jusqu'à 2 décimales, sans zéros inutiles.
            $s = rtrim(rtrim(number_format($v, 2, '.', ''), '0'), '.');
            return $s === '' ? '0' : $s;
        };

        if ($base === 'g') {
            return $value >= 1000 ? $fmt($value / 1000) . ' kg' : $fmt($value) . ' g';
        }
        if ($base === 'ml') {
            return $value >= 1000 ? $fmt($value / 1000) . ' l' : $fmt($value) . ' ml';
        }
        if ($base === 'u') {
            return $fmt($value);
        }
        return $fmt($value) . ' ' . $base; // unité brute conservée
    }
}
