<?php
/**
 * router.php — Sous-routeur du module FINANCES.
 *
 * Inclus par /backend/index.php quand l'URL commence par "finances".
 * Variables héritées : $segments (URL découpée) et respond() (réponse JSON).
 * Convention : on aiguille sur "{METHODE} {action}" ; id éventuel = $segments[2].
 */

require_once __DIR__ . '/Transactions.php';
require_once __DIR__ . '/FinanceSummary.php';
require_once __DIR__ . '/Budgets.php';
require_once __DIR__ . '/Accounts.php';

$action = $segments[1] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

switch ("{$method} {$action}") {

    // ---- GET /backend/finances/transactions?month=AAAA-MM&qui=&categorie=&type= ----
    case 'GET transactions':
        $list = (new Transactions())->getAll([
            'month'     => $_GET['month']     ?? null,
            'type'      => $_GET['type']      ?? null,
            'qui'       => $_GET['qui']        ?? null,
            'categorie' => $_GET['categorie'] ?? null,
        ]);
        respond(200, ['status' => 'success', 'count' => count($list), 'data' => $list]);
        break;

    // ---- POST /backend/finances/transactions : ajouter ----
    case 'POST transactions':
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $tx   = (new Transactions())->add($body);
        if ($tx === null) {
            respond(400, ['status' => 'error',
                'message' => 'Transaction invalide : un montant > 0 et une date (AAAA-MM-JJ) sont requis.']);
        }
        respond(201, ['status' => 'success', 'data' => $tx]);
        break;

    // ---- PUT /backend/finances/transactions/{id} : modifier ----
    case 'PUT transactions':
        $id   = (int) ($segments[2] ?? 0);
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $tx   = (new Transactions())->update($id, $body);
        if ($tx === null) {
            // null = id inconnu OU valeur fournie invalide. On distingue par un GET.
            if ((new Transactions())->get($id) === null) {
                respond(404, ['status' => 'error', 'message' => "Transaction #{$id} introuvable."]);
            }
            respond(400, ['status' => 'error', 'message' => 'Valeur fournie invalide (montant ou date).']);
        }
        respond(200, ['status' => 'success', 'data' => $tx]);
        break;

    // ---- DELETE /backend/finances/transactions/{id} : supprimer ----
    case 'DELETE transactions':
        $id = (int) ($segments[2] ?? 0);
        if (!(new Transactions())->delete($id)) {
            respond(404, ['status' => 'error', 'message' => "Transaction #{$id} introuvable."]);
        }
        respond(200, ['status' => 'success', 'message' => 'Transaction supprimée.']);
        break;

    // ---- GET /backend/finances/summary?month=AAAA-MM : agrégats du mois ----
    case 'GET summary':
        $summary = (new FinanceSummary())->forMonth($_GET['month'] ?? null);
        respond(200, ['status' => 'success', 'data' => $summary]);
        break;

    // ---- GET /backend/finances/budgets?month=AAAA-MM : budgets + réalisé du mois ----
    case 'GET budgets':
        respond(200, [
            'status' => 'success',
            'data'   => (new Budgets())->forMonth($_GET['month'] ?? null),
        ]);
        break;

    // ---- POST /backend/finances/budgets : définir/modifier (montant ≤ 0 supprime) ----
    case 'POST budgets':
        $body   = json_decode(file_get_contents('php://input'), true) ?? [];
        $budget = (new Budgets())->set($body['categorie'] ?? null, $body['montant'] ?? null);
        respond(200, [
            'status'  => 'success',
            'data'    => $budget,                 // null = budget supprimé / catégorie invalide
            'cleared' => $budget === null,
        ]);
        break;

    // ---- GET /backend/finances/categories : listes prédéfinies (front synchro) ----
    case 'GET categories':
        respond(200, [
            'status' => 'success',
            'data'   => [
                'categories'    => Transactions::CATEGORIES,
                'types'         => Transactions::TYPES,
                'qui'           => Transactions::QUI,
                'account_types' => Accounts::TYPES,
            ],
        ]);
        break;

    // ---- GET /backend/finances/comptes : comptes + synthèse patrimoine ----
    case 'GET comptes':
        respond(200, ['status' => 'success', 'data' => (new Accounts())->overview()]);
        break;

    // ---- POST /backend/finances/comptes : ajouter un compte ----
    case 'POST comptes':
        $body    = json_decode(file_get_contents('php://input'), true) ?? [];
        $compte  = (new Accounts())->add($body);
        if ($compte === null) {
            respond(400, ['status' => 'error',
                'message' => 'Compte invalide : un nom et un solde numérique sont requis.']);
        }
        respond(201, ['status' => 'success', 'data' => $compte]);
        break;

    // ---- PUT /backend/finances/comptes/{id} : modifier un compte ----
    case 'PUT comptes':
        $id     = (int) ($segments[2] ?? 0);
        $body   = json_decode(file_get_contents('php://input'), true) ?? [];
        $accts  = new Accounts();
        $compte = $accts->update($id, $body);
        if ($compte === null) {
            if ($accts->get($id) === null) {
                respond(404, ['status' => 'error', 'message' => "Compte #{$id} introuvable."]);
            }
            respond(400, ['status' => 'error', 'message' => 'Valeur fournie invalide (nom ou solde).']);
        }
        respond(200, ['status' => 'success', 'data' => $compte]);
        break;

    // ---- DELETE /backend/finances/comptes/{id} : supprimer un compte ----
    case 'DELETE comptes':
        $id = (int) ($segments[2] ?? 0);
        if (!(new Accounts())->delete($id)) {
            respond(404, ['status' => 'error', 'message' => "Compte #{$id} introuvable."]);
        }
        respond(200, ['status' => 'success', 'message' => 'Compte supprimé.']);
        break;

    // ---- GET /backend/finances/snapshots : historique valeur nette (courbe) ----
    case 'GET snapshots':
        respond(200, [
            'status' => 'success',
            'data'   => ['snapshots' => (new Accounts())->snapshots()],
        ]);
        break;

    // ---- POST /backend/finances/snapshots : enregistrer l'instantané du mois ----
    case 'POST snapshots':
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $snap = (new Accounts())->takeSnapshot($body['month'] ?? null);
        respond(201, ['status' => 'success', 'data' => $snap]);
        break;

    // ---- Action inconnue dans le module Finances ----
    default:
        respond(404, [
            'status'  => 'error',
            'message' => "Action Finances inconnue : {$method} /finances/{$action}",
        ]);
}
