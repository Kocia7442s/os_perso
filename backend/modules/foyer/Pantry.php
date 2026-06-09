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
}
