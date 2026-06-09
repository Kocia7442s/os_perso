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
require_once __DIR__ . '/Pantry.php';

// 2e segment d'URL = l'action ciblée : /backend/foyer/<action>
$action = $segments[1] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Le "cerveau" du module (accès BDD + future logique IA).
$generator = new MenuGenerator();

switch ("{$method} {$action}") {

    // ---- GET /backend/foyer/stock : contenu des placards ----
    case 'GET stock':
        $stock = (new Pantry())->getAll();
        respond(200, [
            'status' => 'success',
            'count'  => count($stock),
            'data'   => $stock,
        ]);
        break;

    // ---- POST /backend/foyer/stock : ajouter un ingrédient ----
    case 'POST stock':
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $item = (new Pantry())->add(
            (string) ($body['item_name'] ?? ''),
            isset($body['quantity']) ? (string) $body['quantity'] : null,
            !empty($body['is_essential'])
        );
        if ($item === null) {
            respond(400, ['status' => 'error', 'message' => "Nom d'ingrédient manquant."]);
        }
        respond(201, ['status' => 'success', 'data' => $item]);
        break;

    // ---- PUT /backend/foyer/stock/{id} : modifier (quantité, essentiel, nom) ----
    case 'PUT stock':
        $id   = (int) ($segments[2] ?? 0);
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $item = (new Pantry())->update($id, $body);
        if ($item === null) {
            respond(404, ['status' => 'error', 'message' => "Ingrédient #{$id} introuvable."]);
        }
        respond(200, ['status' => 'success', 'data' => $item]);
        break;

    // ---- DELETE /backend/foyer/stock/{id} : retirer un ingrédient ----
    case 'DELETE stock':
        $id = (int) ($segments[2] ?? 0);
        if (!(new Pantry())->delete($id)) {
            respond(404, ['status' => 'error', 'message' => "Ingrédient #{$id} introuvable."]);
        }
        respond(200, ['status' => 'success', 'message' => 'Ingrédient retiré.']);
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

    // ---- PUT /backend/foyer/cook/{id} : "j'ai cuisiné ce plat" (bascule) ----
    //      Archive (ou retire) le repas dans l'historique → anti-répétition réelle.
    case 'PUT cook':
        $id     = (int) ($segments[2] ?? 0);
        $body   = json_decode(file_get_contents('php://input'), true) ?? [];
        $cooked = array_key_exists('cooked', $body) ? (bool) $body['cooked'] : null;
        $meal   = $generator->setCooked($id, $cooked);
        if ($meal === null) {
            respond(404, ['status' => 'error', 'message' => "Repas #{$id} introuvable."]);
        }
        respond(200, ['status' => 'success', 'data' => $meal]);
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
        $body     = json_decode(file_get_contents('php://input'), true) ?? [];
        $quantite = isset($body['quantite']) ? (string) $body['quantite'] : null;
        $rayon    = isset($body['rayon']) ? (string) $body['rayon'] : null;
        $item     = (new ShoppingList())->add((string) ($body['nom'] ?? ''), $quantite, $rayon);
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

    // ---- POST /backend/foyer/to-pantry : "ranger au placard" (courses -> placards) ----
    //      Body { id }. Déplace l'article de la liste de courses vers inventory_pantry
    //      (avec sa quantité), sans doublon, puis le retire des courses. Transaction.
    case 'POST to-pantry':
        $body     = json_decode(file_get_contents('php://input'), true) ?? [];
        $id       = (int) ($body['id'] ?? 0);
        $shopping = new ShoppingList();
        $pantry   = new Pantry();

        $item = $shopping->get($id);
        if ($item === null) {
            respond(404, ['status' => 'error', 'message' => "Article #{$id} introuvable."]);
        }

        $pdo = Database::getInstance()->getConnection();
        $pdo->beginTransaction();
        try {
            $merged     = $pantry->existsByName($item['nom']);
            $pantryItem = null;
            if (!$merged) {
                // quantite vide -> null (Pantry retombe sur '1' par défaut).
                $pantryItem = $pantry->add($item['nom'], $item['quantite'] !== '' ? $item['quantite'] : null);
            }
            $shopping->delete($id);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        respond(200, [
            'status'  => 'success',
            'merged'  => $merged, // true = déjà présent au placard, on a juste retiré des courses
            'data'    => $pantryItem,
            'message' => $merged
                ? "« {$item['nom']} » est déjà au placard — retiré des courses."
                : "« {$item['nom']} » rangé au placard.",
        ]);
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
