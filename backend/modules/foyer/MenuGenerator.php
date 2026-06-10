<?php
/**
 * MenuGenerator.php — Le "cerveau" du Générateur de Menu Intelligent.
 *
 * Pipeline : rassemble le contexte (placards + historique) -> construit un
 * prompt strict -> appelle Claude (Anthropic) via cURL -> décode le JSON ->
 * persiste le menu de la semaine et la liste de courses déduite en BDD.
 */

require_once __DIR__ . '/../../core/Database.php';
require_once __DIR__ . '/Preferences.php';
require_once __DIR__ . '/Pantry.php';
require_once __DIR__ . '/ShoppingList.php';

class MenuGenerator
{
    /** @var Database Singleton de connexion (jamais une 2e connexion PDO). */
    private Database $db;

    /** @var Preferences Préférences du foyer (injectées dans le prompt). */
    private Preferences $prefs;

    /** Endpoint de l'API Messages d'Anthropic. */
    private const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

    public function __construct()
    {
        $this->db    = Database::getInstance();
        $this->prefs = new Preferences();
    }

    // ---------------------------------------------------------------------
    //  Lecture du contexte (BDD)
    // ---------------------------------------------------------------------

    /** Ingrédients disponibles dans les placards. */
    public function getAvailableStock(): array
    {
        return $this->db->query(
            'SELECT id, item_name, quantity, is_essential
               FROM inventory_pantry
              ORDER BY item_name ASC'
        )->fetchAll();
    }

    /** Repas consommés sur les 2 dernières semaines (pour éviter les répétitions). */
    public function getRecentHistory(): array
    {
        return $this->db->query(
            'SELECT id, meal_name, category, date_consumed
               FROM meals_history
              WHERE date_consumed >= (CURRENT_DATE - INTERVAL 14 DAY)
              ORDER BY date_consumed DESC'
        )->fetchAll();
    }

    /**
     * Reconstruit le plan de la semaine actuellement en base, au format attendu
     * par le front : { semaine: [ {jour, repas: {midi?, soir?}}, ... ] }.
     * Renvoie une semaine vide si aucun menu n'a encore été généré.
     */
    public function getCurrentPlan(): array
    {
        $rows = $this->db->query(
            'SELECT id, day_of_week, meal_type, meal_name, cooked
               FROM weekly_plan
              ORDER BY id ASC'
        )->fetchAll();

        // Regroupe par jour en conservant l'ordre d'insertion (= ordre des jours).
        // Chaque repas est exposé en objet { id, nom, cooked } pour permettre au
        // front de cibler le bouton "j'ai cuisiné" et d'afficher l'état.
        $byDay = [];
        foreach ($rows as $r) {
            $d = $r['day_of_week'];
            if (!isset($byDay[$d])) {
                $byDay[$d] = ['jour' => $d, 'repas' => []];
            }
            $byDay[$d]['repas'][$r['meal_type']] = [
                'id'     => (int) $r['id'],
                'nom'    => $r['meal_name'],
                'cooked' => (bool) (int) $r['cooked'],
            ];
        }

        return ['semaine' => array_values($byDay)];
    }

    /**
     * Normalise une valeur de repas issue de l'IA en { plat, ingredients }.
     * Tolère l'ancien format (plat = simple chaîne, sans ingrédients).
     * @return array{plat:string, ingredients:array}|null
     */
    private function extractMeal($value): ?array
    {
        if (is_array($value)) {
            $plat = trim((string) ($value['plat'] ?? $value['nom'] ?? ''));
            $ings = isset($value['ingredients']) && is_array($value['ingredients'])
                ? $value['ingredients'] : [];
            return $plat === '' ? null : ['plat' => $plat, 'ingredients' => $ings];
        }
        $plat = is_string($value) ? trim($value) : '';
        return $plat === '' ? null : ['plat' => $plat, 'ingredients' => []];
    }

    /** Ingrédients enregistrés pour un repas du plan (weekly_plan.id). */
    public function getMealIngredients(int $planId): array
    {
        return $this->db->query(
            'SELECT ingredient, quantity
               FROM meal_ingredients
              WHERE weekly_plan_id = :id
              ORDER BY id ASC',
            [':id' => $planId]
        )->fetchAll();
    }

    // ---------------------------------------------------------------------
    //  Recettes (à la demande, mises en cache dans weekly_plan.recipe)
    // ---------------------------------------------------------------------

    /**
     * Renvoie le plat, ses ingrédients et sa recette (ou null si pas encore générée).
     * @return array{id:int, plat:string, ingredients:array, recipe:?array}|null
     *         null si le repas n'existe pas.
     */
    public function getRecipe(int $planId): ?array
    {
        $row = $this->db->query(
            'SELECT id, meal_name, recipe FROM weekly_plan WHERE id = :id',
            [':id' => $planId]
        )->fetch();
        if (!$row) {
            return null;
        }

        $recipe = null;
        if (!empty($row['recipe'])) {
            $decoded = json_decode($row['recipe'], true);
            if (is_array($decoded)) {
                $recipe = $decoded;
            }
        }

        return [
            'id'          => (int) $row['id'],
            'plat'        => $row['meal_name'],
            'ingredients' => $this->getMealIngredients($planId),
            'recipe'      => $recipe,
        ];
    }

    /**
     * Génère (via l'IA) la recette d'un plat et la met en cache, OU renvoie la
     * recette déjà stockée sans rappeler l'IA. Renvoie null si le repas n'existe pas.
     * @throws Exception si l'IA échoue ou renvoie un JSON non conforme.
     */
    public function generateRecipe(int $planId): ?array
    {
        $current = $this->getRecipe($planId);
        if ($current === null) {
            return null;
        }
        // Cache : déjà générée → pas de nouvel appel IA.
        if ($current['recipe'] !== null) {
            return $current;
        }

        $raw    = $this->callLLM($this->buildRecipePrompt($current['plat'], $current['ingredients']));
        $recipe = $this->parseJsonResponse($raw);
        if ($recipe === null || empty($recipe['etapes']) || !is_array($recipe['etapes'])) {
            throw new Exception('Réponse IA invalide : recette non conforme au schéma attendu.');
        }

        $this->db->query(
            'UPDATE weekly_plan SET recipe = :r WHERE id = :id',
            [':r' => json_encode($recipe, JSON_UNESCAPED_UNICODE), ':id' => $planId]
        );

        $current['recipe'] = $recipe;
        return $current;
    }

    /** Construit le prompt de recette pour un plat + ses ingrédients. */
    private function buildRecipePrompt(string $plat, array $ingredients): string
    {
        $prefs = $this->prefs->get();

        $lines = [];
        foreach ($ingredients as $ing) {
            $l = '- ' . $ing['ingredient'];
            if (!empty($ing['quantity'])) {
                $l .= ' (' . $ing['quantity'] . ')';
            }
            $lines[] = $l;
        }
        $ingText = $lines ? implode("\n", $lines) : '(non précisés — déduis-les du plat)';

        $prompt  = "Donne la recette détaillée du plat : \"{$plat}\", "
                 . "pour {$prefs['household_size']} personne(s).\n\n";
        $prompt .= "Ingrédients prévus (complète si besoin) :\n{$ingText}\n\n";
        $prompt .= "Réponds STRICTEMENT avec un unique objet JSON valide : aucun texte avant "
                 . "ou après, AUCUN bloc de code markdown (pas de ```). Schéma EXACT :\n";
        $prompt .= <<<JSON
{
  "portions": "4 personnes",
  "temps_preparation": "15 min",
  "temps_cuisson": "20 min",
  "difficulte": "Facile",
  "ingredients": [{"ingredient": "Riz", "quantite": "300 g"}],
  "etapes": ["Première étape, claire et concise.", "Deuxième étape."]
}
JSON;
        $prompt .= "\n\"etapes\" : 4 à 10 étapes courtes, dans l'ordre, rédigées à l'impératif. "
                 . "\"ingredients\" : liste complète avec quantités pour le nombre de personnes indiqué. "
                 . "\"difficulte\" : uniquement \"Facile\", \"Moyen\" ou \"Difficile\".";

        return $prompt;
    }

    // ---------------------------------------------------------------------
    //  Orchestration : génération complète du menu
    // ---------------------------------------------------------------------

    /**
     * Génère un menu via l'IA et le persiste en BDD.
     * @return array Résumé de l'opération (compteurs + menu généré).
     */
    public function generateMenu(): array
    {
        $stock   = $this->getAvailableStock();
        $history = $this->getRecentHistory();
        $prompt  = $this->buildPrompt($stock, $history);

        // 1. Appel à l'IA (peut lever une Exception : remontée au routeur -> JSON 500).
        $raw = $this->callLLM($prompt);

        // 2. Décodage robuste de la réponse.
        $menu = $this->parseJsonResponse($raw);
        if ($menu === null || !isset($menu['semaine']) || !is_array($menu['semaine'])) {
            throw new Exception('Réponse IA invalide : JSON non conforme au schéma attendu.');
        }

        // 3. Persistance (transaction = tout ou rien).
        //    NB : on utilise DELETE et non TRUNCATE car TRUNCATE provoque un
        //    commit implicite en MySQL/MariaDB et casserait la transaction.
        $pdo = $this->db->getConnection();
        $pdo->beginTransaction();
        try {
            // a) On vide puis réinsère le plan de la semaine + les ingrédients par plat.
            $pdo->exec('DELETE FROM meal_ingredients');
            $pdo->exec('DELETE FROM weekly_plan');
            foreach ($menu['semaine'] as $jour) {
                $dayName = $jour['jour']  ?? '';
                $repas   = $jour['repas'] ?? [];
                foreach (['midi', 'soir'] as $type) {
                    $meal = $this->extractMeal($repas[$type] ?? null);
                    if ($meal === null) {
                        continue;
                    }
                    $this->db->query(
                        'INSERT INTO weekly_plan (day_of_week, meal_type, meal_name)
                         VALUES (:jour, :type, :nom)',
                        [':jour' => $dayName, ':type' => $type, ':nom' => $meal['plat']]
                    );
                    $planId = (int) $pdo->lastInsertId();

                    // Ingrédients du plat (pour le décompte du stock à la cuisson).
                    foreach ($meal['ingredients'] as $ing) {
                        $iName = trim((string) ($ing['ingredient'] ?? ''));
                        if ($iName === '') {
                            continue;
                        }
                        $iQty = trim((string) ($ing['quantite'] ?? ''));
                        $this->db->query(
                            'INSERT INTO meal_ingredients (weekly_plan_id, ingredient, quantity)
                             VALUES (:p, :i, :q)',
                            [':p' => $planId, ':i' => $iName, ':q' => $iQty !== '' ? $iQty : null]
                        );
                    }
                }
            }

            // b) Liste de courses déduite -> table shopping_items (colonne nom).
            //    Anti-doublon : on n'ajoute un ingrédient que s'il n'est pas déjà
            //    présent dans la liste "à acheter" (statut_achete = 0). Comme on est
            //    dans la même transaction, un ajout est visible par le SELECT suivant,
            //    donc les doublons internes au même menu sont aussi évités.
            $courses = $menu['liste_courses_deduite'] ?? [];
            foreach ($courses as $article) {
                // Nouveau format : { ingredient, quantite, rayon }. On tolère l'ancien (string).
                if (is_array($article)) {
                    $nom      = trim((string) ($article['ingredient'] ?? ''));
                    $quantite = trim((string) ($article['quantite'] ?? ''));
                    $rayon    = ShoppingList::sanitizeRayon($article['rayon'] ?? null);
                } else {
                    $nom      = is_string($article) ? trim($article) : '';
                    $quantite = '';
                    $rayon    = 'Autre';
                }
                if ($nom === '') {
                    continue;
                }
                $exists = $this->db->query(
                    'SELECT 1 FROM shopping_items
                      WHERE nom = :nom AND statut_achete = 0
                      LIMIT 1',
                    [':nom' => $nom]
                )->fetch();
                if (!$exists) {
                    $this->db->query(
                        'INSERT INTO shopping_items (nom, quantite, rayon) VALUES (:nom, :q, :r)',
                        [':nom' => $nom, ':q' => $quantite !== '' ? $quantite : null, ':r' => $rayon]
                    );
                }
            }

            // NB : on N'ARCHIVE PLUS les repas dans meals_history à la génération.
            //    L'archivage se fait désormais via cookMeal() quand l'utilisateur
            //    clique "J'ai cuisiné" → l'anti-répétition reflète ce qui a VRAIMENT
            //    été mangé (et non chaque menu généré/régénéré, qui faussait tout).

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e; // on laisse remonter pour une réponse d'erreur propre
        }

        return [
            'jours_planifies'  => count($menu['semaine']),
            'articles_ajoutes' => count($menu['liste_courses_deduite'] ?? []),
            'menu'             => $menu,
        ];
    }

    /**
     * "J'ai cuisiné ce plat" (bascule). C'est le SEUL déclencheur d'archivage
     * dans meals_history → l'anti-répétition reflète ce qui a vraiment été mangé.
     *
     * @param  int       $id     identifiant de la ligne weekly_plan.
     * @param  bool|null  $cooked true/false pour fixer ; null pour basculer.
     * @return array|null { id, nom, cooked:bool } ou null si l'id n'existe pas.
     */
    public function setCooked(int $id, ?bool $cooked = null): ?array
    {
        $row = $this->db->query(
            'SELECT id, meal_name, cooked FROM weekly_plan WHERE id = :id',
            [':id' => $id]
        )->fetch();
        if (!$row) {
            return null;
        }

        $current = (bool) (int) $row['cooked'];
        $target  = $cooked === null ? !$current : $cooked;

        // Pas de changement : rien à faire (évite un doublon/suppression en trop).
        if ($target === $current) {
            return ['id' => (int) $row['id'], 'nom' => $row['meal_name'], 'cooked' => $current];
        }

        $consumed = []; // résumé du décompte du stock (uniquement à la cuisson)

        $pdo = $this->db->getConnection();
        $pdo->beginTransaction();
        try {
            $this->db->query(
                'UPDATE weekly_plan SET cooked = :c WHERE id = :id',
                [':c' => $target ? 1 : 0, ':id' => $id]
            );

            if ($target) {
                // On archive le repas (consommé aujourd'hui).
                $this->db->query(
                    'INSERT INTO meals_history (meal_name, date_consumed)
                     VALUES (:nom, CURRENT_DATE)',
                    [':nom' => $row['meal_name']]
                );

                // …et on décrémente le placard pour chaque ingrédient du plat.
                // (Décrément unidirectionnel : décocher ne re-crédite PAS le stock.)
                $pantry = new Pantry();
                foreach ($this->getMealIngredients($id) as $ing) {
                    $res = $pantry->consume($ing['ingredient'], $ing['quantity'] ?? null);
                    if (!empty($res['found'])) {
                        $consumed[] = $res; // on ne remonte que ce qui était réellement au placard
                    }
                }
            } else {
                // Décoché : on retire l'archivage du jour pour ce plat (une ligne).
                $this->db->query(
                    'DELETE FROM meals_history
                      WHERE meal_name = :nom AND date_consumed = CURRENT_DATE
                      LIMIT 1',
                    [':nom' => $row['meal_name']]
                );
            }

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        return [
            'id'       => (int) $row['id'],
            'nom'      => $row['meal_name'],
            'cooked'   => $target,
            'consumed' => $consumed,
        ];
    }

    // ---------------------------------------------------------------------
    //  Édition manuelle du plan (sans IA) : ajouter / remplacer / retirer
    // ---------------------------------------------------------------------

    /** Jours valides du plan (doivent matcher ce que produit la génération IA). */
    public const VALID_DAYS  = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    /** Moments de repas valides. */
    public const VALID_TYPES = ['midi', 'soir'];

    /**
     * Ajoute ou remplace manuellement un repas (1 plat par créneau jour+moment).
     * Aucune IA. Si le créneau existe déjà, on remplace le nom et on repart à zéro
     * (cooked=0, recette + ingrédients effacés : c'est un autre plat).
     *
     * @return array{id:int,jour:string,type:string,nom:string,cooked:bool}|null
     *         null si l'entrée est invalide (nom vide, jour/moment hors liste).
     */
    public function setMeal(string $jour, string $type, string $nom): ?array
    {
        $jour = trim($jour);
        $type = strtolower(trim($type));
        $nom  = trim($nom);
        if ($nom === ''
            || !in_array($jour, self::VALID_DAYS, true)
            || !in_array($type, self::VALID_TYPES, true)) {
            return null;
        }

        $pdo = $this->db->getConnection();
        $pdo->beginTransaction();
        try {
            $existing = $this->db->query(
                'SELECT id FROM weekly_plan WHERE day_of_week = :j AND meal_type = :t LIMIT 1',
                [':j' => $jour, ':t' => $type]
            )->fetch();

            if ($existing) {
                $id = (int) $existing['id'];
                $this->db->query(
                    'UPDATE weekly_plan SET meal_name = :nom, cooked = 0, recipe = NULL WHERE id = :id',
                    [':nom' => $nom, ':id' => $id]
                );
                // Le plat change → ses anciens ingrédients ne valent plus rien.
                $this->db->query(
                    'DELETE FROM meal_ingredients WHERE weekly_plan_id = :id',
                    [':id' => $id]
                );
            } else {
                $this->db->query(
                    'INSERT INTO weekly_plan (day_of_week, meal_type, meal_name) VALUES (:j, :t, :nom)',
                    [':j' => $jour, ':t' => $type, ':nom' => $nom]
                );
                $id = (int) $pdo->lastInsertId();
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        return ['id' => $id, 'jour' => $jour, 'type' => $type, 'nom' => $nom, 'cooked' => false];
    }

    /**
     * Retire un repas du plan (et ses ingrédients). N'archive rien dans l'historique.
     * @return bool false si l'id n'existe pas.
     */
    public function deleteMeal(int $id): bool
    {
        $row = $this->db->query(
            'SELECT id FROM weekly_plan WHERE id = :id',
            [':id' => $id]
        )->fetch();
        if (!$row) {
            return false;
        }

        $pdo = $this->db->getConnection();
        $pdo->beginTransaction();
        try {
            $this->db->query('DELETE FROM meal_ingredients WHERE weekly_plan_id = :id', [':id' => $id]);
            $this->db->query('DELETE FROM weekly_plan WHERE id = :id', [':id' => $id]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return true;
    }

    // ---------------------------------------------------------------------
    //  Prompt engineering : on EXIGE un JSON strict, sans fioritures
    // ---------------------------------------------------------------------

    private function buildPrompt(array $stock, array $history): string
    {
        // Préférences du foyer (configurables via /backend/foyer/preferences).
        $prefs = $this->prefs->get();

        // --- Stock détaillé : nom + quantité + marqueur "essentiel" ---
        $stockLines = [];
        foreach ($stock as $item) {
            $line = '- ' . $item['item_name'];
            if (!empty($item['quantity'])) {
                $line .= ' (' . $item['quantity'] . ')';
            }
            if (!empty($item['is_essential'])) {
                $line .= ' [essentiel — à toujours avoir en stock]';
            }
            $stockLines[] = $line;
        }
        $stockText = $stockLines ? implode("\n", $stockLines) : '(placards vides)';

        // --- Historique : nom + catégorie (pour équilibrer) ---
        $histLines = [];
        foreach ($history as $h) {
            $label = $h['meal_name'];
            if (!empty($h['category'])) {
                $label .= ' (' . $h['category'] . ')';
            }
            $histLines[] = $label;
        }
        $recents = implode(', ', $histLines);

        $prompt  = "Génère un menu de la semaine pour un foyer de "
                 . "{$prefs['household_size']} personne(s).\n\n";
        $prompt .= "INGRÉDIENTS DISPONIBLES DANS LES PLACARDS "
                 . "(à utiliser EN PRIORITÉ pour limiter les achats ; "
                 . "la quantité disponible est entre parenthèses) :\n";
        $prompt .= $stockText . "\n";

        if ($recents !== '') {
            $prompt .= "\nREPAS DÉJÀ CONSOMMÉS CES 2 DERNIÈRES SEMAINES "
                     . "(à NE PAS répéter ; la catégorie est entre parenthèses) :\n";
            $prompt .= $recents . "\n";
        }

        // --- Règles d'équilibre et de variété ---
        $prompt .= "\nRÈGLES D'ÉQUILIBRE ET DE VARIÉTÉ :\n";
        $prompt .= "- Varie les catégories : maximum {$prefs['max_pasta']} repas à base de pâtes sur la semaine.\n";
        $prompt .= "- Inclus au moins {$prefs['veggie_meals']} repas végétariens.\n";
        $prompt .= "- N'utilise jamais le même ingrédient principal deux soirs de suite.\n";
        $prompt .= "- En semaine (le soir), privilégie des plats simples et rapides.\n";
        $prompt .= "- Le week-end, tu peux proposer des plats plus élaborés.\n";
        $prompt .= "- Pour CHAQUE repas, fournis \"plat\" (le nom du plat) ET \"ingredients\" : "
                 . "la liste COMPLÈTE des ingrédients du plat avec une quantité précise pour "
                 . "chacun (ex : \"250 g\", \"1 kg\", \"2 boîtes\", \"3 pièces\"), Y COMPRIS ceux "
                 . "déjà présents dans les placards (cette liste sert à décompter le stock après cuisson).\n";
        $prompt .= "- Dans \"liste_courses_deduite\", liste UNIQUEMENT les ingrédients à acheter "
                 . "(ceux qui ne sont PAS déjà dans les placards), AVEC une quantité précise "
                 . "pour chacun (ex : \"250 g\", \"1 kg\", \"2 boîtes\", \"3 pièces\").\n";
        $prompt .= "- Pour CHAQUE article de \"liste_courses_deduite\", indique aussi un \"rayon\" "
                 . "de magasin choisi STRICTEMENT dans cette liste (recopie le libellé exact) : "
                 . implode(', ', ShoppingList::RAYONS) . ".\n";
        if (!empty($prefs['avoid'])) {
            $prompt .= "- À ÉVITER ABSOLUMENT (allergies / interdits) : {$prefs['avoid']}.\n";
        }

        // --- RÈGLE MÉTIER (contrainte forte) ---
        $prompt .= "\nRÈGLE IMPÉRATIVE — je ne déjeune PAS chez moi en semaine :\n";
        $prompt .= "- Du LUNDI au VENDREDI : génère UNIQUEMENT le repas du \"soir\" "
                 . "(la clé \"midi\" ne doit PAS apparaître ces jours-là).\n";
        $prompt .= "- Le SAMEDI et le DIMANCHE : génère le \"midi\" ET le \"soir\".\n";
        $prompt .= "Soit 9 repas au total (5 soirs en semaine + 2 midis + 2 soirs le week-end), "
                 . "et surtout PAS 14.\n";

        $prompt .= "\nRéponds STRICTEMENT avec un unique objet JSON valide : "
                 . "aucun texte avant ou après, AUCUN bloc de code markdown (pas de ```). "
                 . "Respecte EXACTEMENT ce schéma (note bien la structure différente "
                 . "entre la semaine et le week-end) :\n";
        $prompt .= <<<JSON
{
  "semaine": [
    {"jour": "Lundi",    "repas": {"soir": {"plat": "Curry de lentilles", "ingredients": [{"ingredient": "Lentilles corail", "quantite": "250 g"}, {"ingredient": "Lait de coco", "quantite": "1 boîte"}]}}},
    {"jour": "Mardi",    "repas": {"soir": {"plat": "...", "ingredients": [{"ingredient": "...", "quantite": "..."}]}}},
    {"jour": "Mercredi", "repas": {"soir": {"plat": "...", "ingredients": [{"ingredient": "...", "quantite": "..."}]}}},
    {"jour": "Jeudi",    "repas": {"soir": {"plat": "...", "ingredients": [{"ingredient": "...", "quantite": "..."}]}}},
    {"jour": "Vendredi", "repas": {"soir": {"plat": "...", "ingredients": [{"ingredient": "...", "quantite": "..."}]}}},
    {"jour": "Samedi",   "repas": {"midi": {"plat": "...", "ingredients": [{"ingredient": "...", "quantite": "..."}]}, "soir": {"plat": "...", "ingredients": [{"ingredient": "...", "quantite": "..."}]}}},
    {"jour": "Dimanche", "repas": {"midi": {"plat": "...", "ingredients": [{"ingredient": "...", "quantite": "..."}]}, "soir": {"plat": "...", "ingredients": [{"ingredient": "...", "quantite": "..."}]}}}
  ],
  "liste_courses_deduite": [
    {"ingredient": "Beurre", "quantite": "250 g", "rayon": "Crémerie & frais"},
    {"ingredient": "Tomates", "quantite": "1 kg", "rayon": "Fruits & légumes"}
  ]
}
JSON;
        $prompt .= "\nLe tableau \"semaine\" doit contenir les 7 jours, de Lundi à Dimanche, "
                 . "en respectant exactement cette répartition des repas.";

        return $prompt;
    }

    /**
     * Décodage tolérant : isole l'objet JSON même si l'IA a ajouté du bruit
     * (texte ou ``` malgré la consigne). Renvoie null si rien d'exploitable.
     */
    private function parseJsonResponse(string $raw): ?array
    {
        $raw   = trim($raw);
        $start = strpos($raw, '{');
        $end   = strrpos($raw, '}');
        if ($start !== false && $end !== false && $end >= $start) {
            $raw = substr($raw, $start, $end - $start + 1);
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : null;
    }

    // ---------------------------------------------------------------------
    //  Appel à l'API Anthropic (Messages) via cURL natif
    // ---------------------------------------------------------------------

    /**
     * Envoie le prompt à Claude et renvoie le texte brut de la réponse.
     *
     * @param  string $prompt Le prompt utilisateur.
     * @return string         Le texte généré (censé être du JSON).
     * @throws Exception      Sur clé manquante, erreur cURL, ou HTTP != 200.
     */
    public function callLLM(string $prompt): string
    {
        // 1. Identifiants lus dans l'environnement (injectés par Docker).
        $apiKey = getenv('ANTHROPIC_API_KEY');
        if (!$apiKey || $apiKey === 'sk-ant-REMPLACE_MOI') {
            throw new Exception('Clé API Anthropic absente ou non configurée (ANTHROPIC_API_KEY).');
        }
        // Modèle configurable ; défaut = Haiku 4.5 (rapide/éco, JSON strict fiable).
        $model = getenv('ANTHROPIC_MODEL') ?: 'claude-haiku-4-5';

        // 2. Construction du payload (format Messages API).
        $payload = [
            'model'      => $model,
            // Sortie plus volumineuse depuis qu'on demande les ingrédients par plat.
            'max_tokens' => 4096,
            // Le rôle "system" renforce la contrainte de sortie JSON pure.
            'system'     => 'Tu es un chef cuisinier pragmatique qui planifie les repas '
                          . 'd\'un foyer : tu varies les plats, équilibres les apports '
                          . '(protéines, légumes, féculents), limites le gaspillage en '
                          . 'utilisant d\'abord les ingrédients déjà en stock, et proposes '
                          . 'des recettes simples en semaine. Tu réponds UNIQUEMENT avec un '
                          . 'objet JSON brut valide, sans texte autour et sans bloc de code markdown.',
            'messages'   => [
                ['role' => 'user', 'content' => $prompt],
            ],
        ];

        // 3. Requête cURL.
        $ch = curl_init(self::ANTHROPIC_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'x-api-key: ' . $apiKey,          // authentification Anthropic
                'anthropic-version: 2023-06-01',  // version d'API obligatoire
            ],
            CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_TIMEOUT        => 60,
        ]);

        $response = curl_exec($ch);

        // 4a. Erreur réseau / cURL (DNS, timeout, TLS...).
        if ($response === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new Exception("Erreur cURL lors de l'appel à l'API Anthropic : {$err}");
        }

        // 4b. Erreur applicative (HTTP != 200).
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($httpCode !== 200) {
            throw new Exception("L'API Anthropic a répondu HTTP {$httpCode} : {$response}");
        }

        // 5. Extraction du texte. La réponse Claude a la forme :
        //    { "content": [ { "type": "text", "text": "..." }, ... ], ... }
        $data = json_decode($response, true);
        $text = '';
        if (isset($data['content']) && is_array($data['content'])) {
            foreach ($data['content'] as $block) {
                if (($block['type'] ?? '') === 'text') {
                    $text .= $block['text'];
                }
            }
        }
        if ($text === '') {
            throw new Exception('Réponse de l\'API Anthropic vide ou inattendue.');
        }

        return $text;
    }
}
