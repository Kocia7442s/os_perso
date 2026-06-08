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
 * Récupère la liste de courses (GET /backend/foyer/shopping).
 * @returns {Promise<Object>} { status, data: [ { id, nom, achete }, ... ] }
 */
export function getShoppingList() {
  return apiGet('/foyer/shopping');
}

/** Ajoute un article à la liste de courses (POST /foyer/shopping). */
export function addShoppingItem(nom) {
  return apiSend('POST', '/foyer/shopping', { nom });
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
