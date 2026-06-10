// api.js — Couche de communication avec le backend.
// RÈGLE : ce fichier ne fait QUE parler à l'API. Aucune manipulation du DOM ici.
// C'est le seul point d'entrée vers le backend → si l'URL de l'API change,
// on ne modifie que ce fichier.

// Racine de l'API. Le webroot Apache = la racine du projet, donc /backend
// pointe bien vers le routeur frontal (accessible sur http://localhost:8088).
const API_BASE = '/backend';

/**
 * Petit helper interne : fetch + vérification du status + parsing JSON.
 * @param {string} path chemin relatif à l'API (ex : '/test-db')
 */
async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);
  // fetch() ne lève PAS d'erreur sur un 404/500 → on vérifie nous-mêmes.
  if (!response.ok) {
    throw new Error(`Réponse HTTP ${response.status} (${response.statusText})`);
  }
  return response.json();
}

/**
 * Helper interne : envoi avec corps JSON (POST/PUT/DELETE) + vérif + parsing.
 * @param {string} method 'POST' | 'PUT' | 'DELETE'
 * @param {string} path   chemin relatif à l'API
 * @param {Object} [body] corps optionnel (sérialisé en JSON)
 */
async function apiSend(method, path, body) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err.detail || err.message || detail;
    } catch (_) { /* réponse non-JSON */ }
    throw new Error(detail);
  }
  return response.json();
}

/**
 * Interroge la racine de l'API (test de vie).
 * @returns {Promise<Object>}
 */
export function getApiInfo() {
  return apiGet('/');
}

/**
 * Vérifie la connexion à la base de données (route /test-db du backend).
 * @returns {Promise<Object>} ex : { status, message, db_response: { ping: 1 } }
 */
export function getSystemStatus() {
  return apiGet('/test-db');
}

/**
 * Lance la génération du menu de la semaine (appel IA côté backend).
 * POST /backend/foyer/generate-menu — peut prendre quelques secondes.
 * @returns {Promise<Object>} ex : { status, message, data: { jours_planifies,
 *                                   articles_ajoutes, menu: { semaine, liste_courses_deduite } } }
 * @throws {Error} avec le message d'erreur du backend si la réponse n'est pas 2xx.
 */
export async function generateWeeklyMenu() {
  const response = await fetch(`${API_BASE}/foyer/generate-menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    // Le backend renvoie un JSON { status, message, detail } même en erreur :
    // on essaie de remonter le message le plus parlant (ex : crédits API épuisés).
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err.detail || err.message || detail;
    } catch (_) { /* réponse non-JSON : on garde le code HTTP */ }
    throw new Error(detail);
  }

  return response.json();
}

/**
 * Récupère le dernier menu persistant en base (GET /backend/foyer/menu),
 * sans relancer l'IA.
 * @returns {Promise<Object>} { status, data: { menu: { semaine } } }
 */
export function getCurrentMenu() {
  return apiGet('/foyer/menu');
}

/**
 * Récupère le plat, ses ingrédients et sa recette (GET /foyer/recipe/{id}).
 * `recipe` est null tant qu'elle n'a pas été générée.
 * @returns {Promise<Object>} { status, data: { id, plat, ingredients, recipe } }
 */
export function getRecipe(id) {
  return apiGet(`/foyer/recipe/${id}`);
}

/**
 * Génère la recette d'un plat via l'IA puis la met en cache (POST /foyer/recipe/{id}).
 * @returns {Promise<Object>} { status, data: { id, plat, ingredients, recipe } }
 * @throws {Error} message backend si l'IA échoue (ex : crédits insuffisants).
 */
export function generateRecipe(id) {
  return apiSend('POST', `/foyer/recipe/${id}`);
}

/**
 * Bascule l'état "j'ai cuisiné" d'un repas du plan (PUT /foyer/cook/{id}).
 * Archive (ou retire) le repas dans l'historique côté backend.
 * @param {number} id     identifiant du repas (weekly_plan).
 * @param {boolean} cooked état cible.
 * @returns {Promise<Object>} { status, data: { id, nom, cooked } }
 */
export function cookMeal(id, cooked) {
  return apiSend('PUT', `/foyer/cook/${id}`, { cooked });
}

/**
 * Ajoute ou remplace manuellement un repas du plan (POST /foyer/meal, sans IA).
 * Un seul plat par créneau jour+moment : si le créneau existe, son nom est remplacé.
 * @param {string} jour  ex. "Lundi" … "Dimanche".
 * @param {string} type  "midi" ou "soir".
 * @param {string} nom   nom du plat.
 * @returns {Promise<Object>} { status, data: { id, jour, type, nom, cooked } }
 */
export function addMeal(jour, type, nom) {
  return apiSend('POST', '/foyer/meal', { jour, type, nom });
}

/**
 * Retire un repas du plan (DELETE /foyer/meal/{id}).
 * @param {number} id identifiant du repas (weekly_plan).
 * @returns {Promise<Object>} { status, message }
 */
export function deleteMeal(id) {
  return apiSend('DELETE', `/foyer/meal/${id}`);
}

/**
 * Récupère la liste de courses (GET /backend/foyer/shopping).
 * @returns {Promise<Object>} { status, data: [ { id, nom, achete }, ... ] }
 */
export function getShoppingList() {
  return apiGet('/foyer/shopping');
}

/** Ajoute un article à la liste de courses (POST /foyer/shopping). */
export function addShoppingItem(nom, quantite, rayon) {
  return apiSend('POST', '/foyer/shopping', { nom, quantite, rayon });
}

/** Coche/décoche un article (PUT /foyer/shopping/{id}). */
export function setShoppingItemStatus(id, achete) {
  return apiSend('PUT', `/foyer/shopping/${id}`, { achete });
}

/** Supprime un article (DELETE /foyer/shopping/{id}). */
export function deleteShoppingItem(id) {
  return apiSend('DELETE', `/foyer/shopping/${id}`);
}

/**
 * Range un article acheté dans les placards (POST /foyer/to-pantry).
 * L'ajoute à inventory_pantry (sans doublon) et le retire de la liste de courses.
 * @param {number} id identifiant de l'article de courses.
 * @returns {Promise<Object>} { status, merged, data, message }
 */
export function stockBoughtItem(id) {
  return apiSend('POST', '/foyer/to-pantry', { id });
}

/* ----- Placards (inventory_pantry) ----- */

/** Liste des ingrédients en stock (GET /foyer/stock). */
export function getPantry() {
  return apiGet('/foyer/stock');
}

/** Ajoute un ingrédient au stock (POST /foyer/stock). */
export function addPantryItem(item_name, quantity, is_essential) {
  return apiSend('POST', '/foyer/stock', { item_name, quantity, is_essential });
}

/** Modifie un ingrédient (PUT /foyer/stock/{id}) — champs partiels. */
export function updatePantryItem(id, fields) {
  return apiSend('PUT', `/foyer/stock/${id}`, fields);
}

/** Retire un ingrédient (DELETE /foyer/stock/{id}). */
export function deletePantryItem(id) {
  return apiSend('DELETE', `/foyer/stock/${id}`);
}

/* ----- Calendrier commun (flux iCal, lecture seule) ----- */

/**
 * Agenda fusionné des calendriers configurés (GET /backend/calendrier/events).
 * @param {number} [days=60] fenêtre en jours à partir d'aujourd'hui.
 * @returns {Promise<Object>} { status, count, data: [ { title, start, end,
 *          all_day, location, calendar, color }, ... ], calendars, errors }
 */
export function getCalendarEvents(days = 60) {
  return apiGet(`/calendrier/events?days=${encodeURIComponent(days)}`);
}

/**
 * Agenda fusionné sur une plage explicite (navigation semaine / mois).
 * @param {string} from date de début incluse, format "AAAA-MM-JJ".
 * @param {string} to   date de fin exclue, format "AAAA-MM-JJ".
 * @returns {Promise<Object>} même forme que getCalendarEvents.
 */
export function getCalendarRange(from, to) {
  return apiGet(`/calendrier/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

/**
 * Récupère les préférences du foyer (GET /backend/foyer/preferences).
 * @returns {Promise<Object>} { status, data: { household_size, veggie_meals, max_pasta, avoid } }
 */
export function getPreferences() {
  return apiGet('/foyer/preferences');
}

/**
 * Enregistre les préférences du foyer (POST /backend/foyer/preferences).
 * @param {Object} prefs { household_size, veggie_meals, max_pasta, avoid }
 * @returns {Promise<Object>} les préférences finales (bornées) renvoyées par le backend.
 * @throws {Error} avec le message du backend si la réponse n'est pas 2xx.
 */
export async function savePreferences(prefs) {
  const response = await fetch(`${API_BASE}/foyer/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err.detail || err.message || detail;
    } catch (_) { /* réponse non-JSON */ }
    throw new Error(detail);
  }

  return response.json();
}

/* ----- Module FINANCES (dépenses & revenus, saisie manuelle) ----- */

/**
 * Liste des transactions, filtrable (GET /finances/transactions).
 * @param {Object} [filters] { month:"AAAA-MM", type, qui, categorie } — champs optionnels.
 * @returns {Promise<Object>} { status, count, data: [ { id, date, type, montant,
 *          categorie, qui, libelle, note }, ... ] }
 */
export function getTransactions(filters = {}) {
  const qs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v != null && v !== '')
  ).toString();
  return apiGet(`/finances/transactions${qs ? `?${qs}` : ''}`);
}

/** Ajoute une transaction (POST /finances/transactions). */
export function addTransaction(tx) {
  return apiSend('POST', '/finances/transactions', tx);
}

/** Met à jour une transaction (PUT /finances/transactions/{id}). */
export function updateTransaction(id, fields) {
  return apiSend('PUT', `/finances/transactions/${id}`, fields);
}

/** Supprime une transaction (DELETE /finances/transactions/{id}). */
export function deleteTransaction(id) {
  return apiSend('DELETE', `/finances/transactions/${id}`);
}

/**
 * Agrégats d'un mois (GET /finances/summary).
 * @param {string} month "AAAA-MM".
 * @returns {Promise<Object>} { status, data: { month, totaux:{depenses,revenus,solde},
 *          par_categorie:[{categorie,montant}], par_qui:[{qui,depenses,revenus}],
 *          evolution:[{mois,depenses,revenus}] } }
 */
export function getFinanceSummary(month) {
  return apiGet(`/finances/summary?month=${encodeURIComponent(month)}`);
}

/** Listes prédéfinies (catégories par type, types, qui) — GET /finances/categories. */
export function getFinanceCategories() {
  return apiGet('/finances/categories');
}

/**
 * Budgets + réalisé du mois (GET /finances/budgets).
 * @param {string} month "AAAA-MM".
 * @returns {Promise<Object>} { status, data: { month,
 *          budgets:[{categorie,montant,depense,reste,pourcentage,depassement}],
 *          resume:{budget_total,depense_total,reste_total,depassements} } }
 */
export function getBudgets(month) {
  return apiGet(`/finances/budgets?month=${encodeURIComponent(month)}`);
}

/** Définit/modifie un budget (POST /finances/budgets ; montant vide/≤0 supprime). */
export function setBudget(categorie, montant) {
  return apiSend('POST', '/finances/budgets', { categorie, montant });
}

/* ----- Patrimoine : comptes & valeur nette (Phase 2) ----- */

/**
 * Comptes + synthèse patrimoine (GET /finances/comptes).
 * @returns {Promise<Object>} { status, data: { comptes:[{id,nom,type,solde,est_dette}],
 *          resume:{actifs,dettes,valeur_nette,allocation:[{type,montant}]} } }
 */
export function getAccounts() {
  return apiGet('/finances/comptes');
}

/** Ajoute un compte (POST /finances/comptes). */
export function addAccount(compte) {
  return apiSend('POST', '/finances/comptes', compte);
}

/** Met à jour un compte (PUT /finances/comptes/{id}). */
export function updateAccount(id, fields) {
  return apiSend('PUT', `/finances/comptes/${id}`, fields);
}

/** Supprime un compte (DELETE /finances/comptes/{id}). */
export function deleteAccount(id) {
  return apiSend('DELETE', `/finances/comptes/${id}`);
}
