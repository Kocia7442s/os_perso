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

    /**
     * Rayons canoniques, dans l'ordre d'un parcours de magasin.
     * Source de vérité partagée (l'IA et le front doivent s'y tenir).
     * Le front en a une copie (app.js) — garder les deux listes synchronisées.
     */
    public const RAYONS = [
        'Fruits & légumes',
        'Boucherie & poissonnerie',
        'Crémerie & frais',
        'Épicerie salée',
        'Épicerie sucrée',
        'Boulangerie',
        'Surgelés',
        'Boissons',
        'Hygiène & entretien',
        'Autre',
    ];

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Normalise un rayon vers l'un des rayons canoniques (insensible à la casse).
     * Toute valeur inconnue ou vide retombe sur "Autre".
     */
    public static function sanitizeRayon(?string $rayon): string
    {
        $rayon = trim((string) $rayon);
        if ($rayon === '') {
            return 'Autre';
        }
        foreach (self::RAYONS as $r) {
            if (mb_strtolower($r) === mb_strtolower($rayon)) {
                return $r;
            }
        }
        return 'Autre';
    }

    /**
     * Renvoie tous les articles : "à acheter" d'abord, puis par ordre alphabétique.
     * @return array Liste de { id:int, nom:string, achete:bool }.
     */
    public function getAll(): array
    {
        $rows = $this->db->query(
            'SELECT id, nom, quantite, rayon, statut_achete
               FROM shopping_items
              ORDER BY statut_achete ASC, nom ASC'
        )->fetchAll();

        // Normalisation des types pour le front (PDO renvoie des chaînes).
        return array_map(static function (array $r): array {
            return [
                'id'       => (int) $r['id'],
                'nom'      => $r['nom'],
                'quantite' => (string) ($r['quantite'] ?? ''),
                'rayon'    => (string) ($r['rayon'] ?? 'Autre'),
                'achete'   => (bool) (int) $r['statut_achete'],
            ];
        }, $rows);
    }

    /**
     * Lit un article par son id.
     * @return array|null { id, nom, quantite, achete:bool } ou null s'il n'existe pas.
     */
    public function get(int $id): ?array
    {
        $row = $this->db->query(
            'SELECT id, nom, quantite, rayon, statut_achete FROM shopping_items WHERE id = :id',
            [':id' => $id]
        )->fetch();
        if (!$row) {
            return null;
        }
        return [
            'id'       => (int) $row['id'],
            'nom'      => $row['nom'],
            'quantite' => (string) ($row['quantite'] ?? ''),
            'rayon'    => (string) ($row['rayon'] ?? 'Autre'),
            'achete'   => (bool) (int) $row['statut_achete'],
        ];
    }

    /**
     * Ajoute un article (à acheter).
     * @param  string      $nom
     * @param  string|null $quantite quantité libre ("250 g", "2 boîtes"…) ou null.
     * @param  string|null $rayon    rayon magasin (normalisé ; défaut "Autre").
     * @return array|null L'article créé { id, nom, quantite, rayon, achete:false }, ou null si nom vide.
     */
    public function add(string $nom, ?string $quantite = null, ?string $rayon = null): ?array
    {
        $nom = trim($nom);
        if ($nom === '') {
            return null;
        }
        $quantite = $quantite !== null ? trim($quantite) : '';
        $rayon    = self::sanitizeRayon($rayon);

        $this->db->query(
            'INSERT INTO shopping_items (nom, quantite, rayon) VALUES (:nom, :q, :r)',
            [':nom' => $nom, ':q' => $quantite !== '' ? $quantite : null, ':r' => $rayon]
        );
        $id = (int) $this->db->getConnection()->lastInsertId();

        return ['id' => $id, 'nom' => $nom, 'quantite' => $quantite, 'rayon' => $rayon, 'achete' => false];
    }

    /**
     * Modifie le statut d'achat d'un article.
     * @param  int       $id
     * @param  bool|null $achete true/false pour fixer la valeur ; null pour basculer.
     * @return array|null L'article mis à jour, ou null s'il n'existe pas.
     */
    public function setStatus(int $id, ?bool $achete = null): ?array
    {
        $row = $this->db->query(
            'SELECT id, nom, quantite, rayon, statut_achete FROM shopping_items WHERE id = :id',
            [':id' => $id]
        )->fetch();

        if (!$row) {
            return null;
        }

        $new = $achete === null ? !((bool) (int) $row['statut_achete']) : $achete;

        $this->db->query(
            'UPDATE shopping_items SET statut_achete = :s WHERE id = :id',
            [':s' => $new ? 1 : 0, ':id' => $id]
        );

        return [
            'id'       => $id,
            'nom'      => $row['nom'],
            'quantite' => (string) ($row['quantite'] ?? ''),
            'rayon'    => (string) ($row['rayon'] ?? 'Autre'),
            'achete'   => $new,
        ];
    }

    /**
     * Supprime un article.
     * @return bool true si une ligne a bien été supprimée.
     */
    public function delete(int $id): bool
    {
        $stmt = $this->db->query(
            'DELETE FROM shopping_items WHERE id = :id',
            [':id' => $id]
        );
        return $stmt->rowCount() > 0;
    }
}
