<?php
/**
 * router.php — Sous-routeur du module FOYER.
 *
 * Inclus par /backend/index.php quand l'URL commence par "foyer".
 * Variables héritées du contexte d'index.php :
 *   - $segments : l'URL découpée (ex : ['foyer', 'stock'])
 *   - respond() : helper de réponse JSON normalisée
 *
 * Convention de routage : on combine la MÉTHODE HTTP et l'ACTION (2e segment)
 * pour aiguiller. Ex : "GET stock", "POST generate-menu".
 */

require_once __DIR__ . '/MenuGenerator.php';
require_once __DIR__ . '/Preferences.php';
require_once __DIR__ . '/ShoppingList.php';

// 2e segment d'URL = l'action ciblée : /backend/foyer/<action>
$action = $segments[1] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Le "cerveau" du module (accès BDD + future logique IA).
$generator = new MenuGenerator();

switch ("{$method} {$action}") {

    // ---- GET /backend/foyer/stock : contenu des placards ----
    case 'GET stock':
        $stock = $generator->getAvailableStock();
        respond(200, [
            'status' => 'success',
            'count'  => count($stock),
            'data'   => $stock,
        ]);
        break;

    // ---- GET /backend/foyer/history : repas des 30 derniers jours ----
    case 'GET history':
        $history = $generator->getRecentHistory();
        respond(200, [
            'status' => 'success',
            'count'  => count($history),
            'data'   => $history,
        ]);
        break;

    // ---- POST /backend/foyer/generate-menu : génération (squelette) ----
    case 'POST generate-menu':
        $result = $generator->generateMenu();
        respond(200, [
            'status'  => 'success',
            'message' => 'Menu de la semaine généré et enregistré.',
            'data'    => $result,
        ]);
        break;

    // ---- GET /backend/foyer/menu : dernier menu persistant (sans régénérer) ----
    case 'GET menu':
        respond(200, [
            'status' => 'success',
            'data'   => ['menu' => $generator->getCurrentPlan()],
        ]);
        break;

    // ---- GET /backend/foyer/shopping : liste de courses ----
    case 'GET shopping':
        $list = new ShoppingList();
        respond(200, [
            'status' => 'success',
            'data'   => $list->getAll(),
        ]);
        break;

    // ---- POST /backend/foyer/shopping : ajouter un article ----
    case 'POST shopping':
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $item = (new ShoppingList())->add((string) ($body['nom'] ?? ''));
        if ($item === null) {
            respond(400, ['status' => 'error', 'message' => "Nom d'article manquant."]);
        }
        respond(201, ['status' => 'success', 'data' => $item]);
        break;

    // ---- PUT /backend/foyer/shopping/{id} : cocher / décocher ----
    case 'PUT shopping':
        $id     = (int) ($segments[2] ?? 0);
        $body   = json_decode(file_get_contents('php://input'), true) ?? [];
        $achete = array_key_exists('achete', $body) ? (bool) $body['achete'] : null;
        $item   = (new ShoppingList())->setStatus($id, $achete);
        if ($item === null) {
            respond(404, ['status' => 'error', 'message' => "Article #{$id} introuvable."]);
        }
        respond(200, ['status' => 'success', 'data' => $item]);
        break;

    // ---- DELETE /backend/foyer/shopping/{id} : supprimer ----
    case 'DELETE shopping':
        $id = (int) ($segments[2] ?? 0);
        if (!(new ShoppingList())->delete($id)) {
            respond(404, ['status' => 'error', 'message' => "Article #{$id} introuvable."]);
        }
        respond(200, ['status' => 'success', 'message' => 'Article supprimé.']);
        break;

    // ---- GET /backend/foyer/preferences : lire les préférences du foyer ----
    case 'GET preferences':
        $prefs = new Preferences();
        respond(200, [
            'status' => 'success',
            'data'   => $prefs->get(),
        ]);
        break;

    // ---- POST /backend/foyer/preferences : enregistrer les préférences ----
    case 'POST preferences':
        $body  = json_decode(file_get_contents('php://input'), true) ?? [];
        $prefs = new Preferences();
        respond(200, [
            'status'  => 'success',
            'message' => 'Préférences enregistrées.',
            'data'    => $prefs->save($body),
        ]);
        break;

    // ---- Action inconnue dans le module Foyer ----
    default:
        respond(404, [
            'status'  => 'error',
            'message' => "Action Foyer inconnue : {$method} /foyer/{$action}",
        ]);
}
