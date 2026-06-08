// api.js — Couche de communication avec le backend.
// RÈGLE : ce fichier ne fait QUE parler à l'API. Aucune manipulation du DOM ici.
// C'est le seul point d'entrée vers le backend → si l'URL de l'API change,
// on ne modifie que ce fichier.

// Racine de l'API. Le webroot Apache = la racine du projet, donc /backend
// pointe bien vers le dossier backend/ (accessible sur http://localhost:8088).
const API_BASE = '/backend';

/**
 * Appelle l'endpoint de test du backend (le "Ping").
 * @returns {Promise<Object>} la réponse JSON décodée du serveur
 * @throws {Error} si la réponse HTTP n'est pas un succès (status hors 2xx)
 */
export async function ping() {
  const response = await fetch(`${API_BASE}/test.php`);

  // fetch() ne lève PAS d'erreur sur un 404/500 → on vérifie nous-mêmes.
  if (!response.ok) {
    throw new Error(`Réponse HTTP ${response.status} (${response.statusText})`);
  }

  return response.json();
}
