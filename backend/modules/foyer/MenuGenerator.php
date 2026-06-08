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
            // a) On vide puis réinsère le plan de la semaine.
            $pdo->exec('DELETE FROM weekly_plan');
            foreach ($menu['semaine'] as $jour) {
                $dayName = $jour['jour']  ?? '';
                $repas   = $jour['repas'] ?? [];
                foreach (['midi', 'soir'] as $type) {
                    if (!empty($repas[$type])) {
                        $this->db->query(
                            'INSERT INTO weekly_plan (day_of_week, meal_type, meal_name)
                             VALUES (:jour, :type, :nom)',
                            [':jour' => $dayName, ':type' => $type, ':nom' => $repas[$type]]
                        );
                    }
                }
            }

            // b) Liste de courses déduite -> table shopping_items (colonne nom).
            $courses = $menu['liste_courses_deduite'] ?? [];
            foreach ($courses as $article) {
                if (is_string($article) && trim($article) !== '') {
                    $this->db->query(
                        'INSERT INTO shopping_items (nom) VALUES (:nom)',
                        [':nom' => trim($article)]
                    );
                }
            }

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
        $prompt .= "- Dans \"liste_courses_deduite\", ne mets QUE les ingrédients nécessaires "
                 . "aux repas qui ne sont PAS déjà dans les placards ci-dessus.\n";
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
    {"jour": "Lundi",    "repas": {"soir": "..."}},
    {"jour": "Mardi",    "repas": {"soir": "..."}},
    {"jour": "Mercredi", "repas": {"soir": "..."}},
    {"jour": "Jeudi",    "repas": {"soir": "..."}},
    {"jour": "Vendredi", "repas": {"soir": "..."}},
    {"jour": "Samedi",   "repas": {"midi": "...", "soir": "..."}},
    {"jour": "Dimanche", "repas": {"midi": "...", "soir": "..."}}
  ],
  "liste_courses_deduite": ["Ingrédient 1", "Ingrédient 2"]
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
            'max_tokens' => 2048,
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
