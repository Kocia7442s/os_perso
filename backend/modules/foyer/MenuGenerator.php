<?php
/**
 * MenuGenerator.php — Le "cerveau" du Générateur de Menu Intelligent.
 *
 * Classe Vanilla dédiée au module Foyer. Elle rassemble le contexte
 * (placards + historique des repas), construira un prompt, et appellera
 * un LLM pour proposer un menu de la semaine.
 *
 * NB : pour l'instant on pose l'ARCHITECTURE et les requêtes SQL de base ;
 *      la logique complexe (prompt fin + appel IA + parsing) viendra ensuite.
 */

require_once __DIR__ . '/../../core/Database.php';

class MenuGenerator
{
    /** @var Database Notre Singleton de connexion (jamais une 2e connexion PDO). */
    private Database $db;

    public function __construct()
    {
        // On réutilise l'unique instance PDO partagée.
        $this->db = Database::getInstance();
    }

    /**
     * Récupère tous les ingrédients disponibles dans les placards.
     * @return array Liste de lignes [{id, item_name, quantity, is_essential}, ...]
     */
    public function getAvailableStock(): array
    {
        return $this->db->query(
            'SELECT id, item_name, quantity, is_essential
               FROM inventory_pantry
              ORDER BY item_name ASC'
        )->fetchAll();
    }

    /**
     * Récupère les repas consommés sur les 30 derniers jours.
     * Sert à demander à l'IA d'éviter les répétitions récentes.
     * @return array Liste de lignes [{id, meal_name, category, date_consumed}, ...]
     */
    public function getRecentHistory(): array
    {
        return $this->db->query(
            'SELECT id, meal_name, category, date_consumed
               FROM meals_history
              WHERE date_consumed >= (CURRENT_DATE - INTERVAL 30 DAY)
              ORDER BY date_consumed DESC'
        )->fetchAll();
    }

    /**
     * Orchestrateur (SQUELETTE) : assemble le contexte, construit le prompt,
     * appellera l'IA puis renverra le menu. Logique complète à venir.
     * @return array
     */
    public function generateMenu(): array
    {
        $stock   = $this->getAvailableStock();
        $history = $this->getRecentHistory();

        // Construction du prompt à partir du contexte réel.
        $prompt = $this->buildPrompt($stock, $history);

        // TODO (prochaine étape) :
        //   $raw  = $this->callLLM($prompt);
        //   $menu = $this->parseLLMResponse($raw);
        // Pour l'instant on renvoie le contexte assemblé, pour vérifier la chaîne.
        return [
            'stock_count'    => count($stock),
            'history_count'  => count($history),
            'prompt_preview' => $prompt,
            'menu'           => null, // sera rempli par l'IA
        ];
    }

    /**
     * Construit le texte du prompt envoyé à l'IA (version simple pour l'instant).
     */
    private function buildPrompt(array $stock, array $history): string
    {
        $ingredients = implode(', ', array_column($stock, 'item_name'));
        $recents     = implode(', ', array_column($history, 'meal_name'));

        $prompt  = "Tu es un assistant culinaire. Propose un menu pour la semaine.\n";
        $prompt .= "Ingrédients à privilégier (déjà en stock) : {$ingredients}.\n";
        if ($recents !== '') {
            $prompt .= "Évite de répéter ces repas récents : {$recents}.\n";
        }
        return $prompt;
    }

    /**
     * Appel à l'API d'un LLM via cURL natif.
     *
     * VIDE pour le moment : l'URL d'endpoint, les headers d'authentification
     * et le format du payload JSON dépendent du fournisseur choisi
     * (Gemini / Anthropic / OpenAI). On les codera à l'étape suivante.
     *
     * @param  string $prompt Le prompt à soumettre au modèle.
     * @return string         La réponse texte brute du modèle (à parser ensuite).
     */
    public function callLLM(string $prompt): string
    {
        // TODO (prochaine étape) :
        //   1. $apiKey = getenv('LLM_API_KEY');               // clé via .env / Docker
        //   2. $ch = curl_init($endpointUrl);                 // URL du fournisseur
        //   3. curl_setopt_array($ch, [...]) : méthode POST, headers, payload JSON
        //   4. $response = curl_exec($ch); gérer curl_errno() / code HTTP
        //   5. curl_close($ch); json_decode($response) ; extraire le texte généré
        //   6. return $texteGenere;
        return '';
    }
}
