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
