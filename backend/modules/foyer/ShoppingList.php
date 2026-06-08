<?php
/**
 * ShoppingList.php — Liste de courses du foyer (table shopping_items).
 *
 * Pour l'instant : lecture seule (getAll). Le CRUD (ajout / cocher / supprimer)
 * viendra à l'étape suivante.
 */

require_once __DIR__ . '/../../core/Database.php';

class ShoppingList
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Renvoie tous les articles : "à acheter" d'abord, puis par ordre alphabétique.
     * @return array Liste de { id:int, nom:string, achete:bool }.
     */
    public function getAll(): array
    {
        $rows = $this->db->query(
            'SELECT id, nom, statut_achete
               FROM shopping_items
              ORDER BY statut_achete ASC, nom ASC'
        )->fetchAll();

        // Normalisation des types pour le front (PDO renvoie des chaînes).
        return array_map(static function (array $r): array {
            return [
                'id'     => (int) $r['id'],
                'nom'    => $r['nom'],
                'achete' => (bool) (int) $r['statut_achete'],
            ];
        }, $rows);
    }
}
