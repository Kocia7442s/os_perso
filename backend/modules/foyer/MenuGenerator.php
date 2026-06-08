<?php
/**
 * MenuGenerator.php — Le "cerveau" du Générateur de Menu Intelligent.
 *
 * Pipeline : rassemble le contexte (placards + historique) -> construit un
 * prompt strict -> appelle Claude (Anthropic) via cURL -> décode le JSON ->
 * persiste le menu de la semaine et la liste de courses déduite en BDD.
 */

require_once __DIR__ . '/../../core/Database.php';

class MenuGenerator
{
    /** @var Database Singleton de connexion (jamais une 2e connexion PDO). */
    private Database $db;

    /** Endpoint de l'API Messages d'Anthropic. */
    private const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

    public function __construct()
    {
        $this->db = Database::getInstance();
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

    /** Repas consommés sur les 30 derniers jours (pour éviter les répétitions). */
    public function getRecentHistory(): array
    {
        return $this->db->query(
            'SELECT id, meal_name, category, date_consumed
               FROM meals_history
              WHERE date_consumed >= (CURRENT_DATE - INTERVAL 30 DAY)
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
        $ingredients = implode(', ', array_column($stock, 'item_name'));
        $recents     = implode(', ', array_column($history, 'meal_name'));

        $prompt  = "Génère un menu pour la semaine (7 jours, midi et soir).\n";
        $prompt .= "Privilégie ces ingrédients déjà en stock : {$ingredients}.\n";
        if ($recents !== '') {
            $prompt .= "Évite de répéter ces repas récents : {$recents}.\n";
        }
        $prompt .= "\nRéponds STRICTEMENT avec un unique objet JSON valide : "
                 . "aucun texte avant ou après, AUCUN bloc de code markdown (pas de ```). "
                 . "Respecte EXACTEMENT ce schéma :\n";
        $prompt .= <<<JSON
{
  "semaine": [
    {"jour": "Lundi", "repas": {"midi": "...", "soir": "..."}}
  ],
  "liste_courses_deduite": ["Ingrédient 1", "Ingrédient 2"]
}
JSON;
        $prompt .= "\nLe tableau \"semaine\" doit contenir les 7 jours, de Lundi à Dimanche.";

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
            'system'     => 'Tu es un assistant de planification de repas. Tu réponds '
                          . 'UNIQUEMENT avec un objet JSON brut valide, sans texte autour '
                          . 'et sans bloc de code markdown.',
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
