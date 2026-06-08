// app.js — Logique d'interface (manipulation du DOM).
// Il délègue toute communication réseau à la couche api.js (import ci-dessous).
import { ping } from './api.js';

const output = document.getElementById('output');

/**
 * Lance le test de Ping vers le backend et affiche le résultat à l'écran.
 */
async function runPingTest() {
  output.className = '';          // reset des styles success/error
  output.textContent = 'Test en cours…';

  try {
    const data = await ping();
    output.classList.add('success');
    output.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    output.classList.add('error');
    output.textContent = `❌ Échec du Ping : ${err.message}`;
  }
}

// Lance le test automatiquement au chargement de la page…
runPingTest();

// …et permet de le relancer manuellement via le bouton.
document.getElementById('retry').addEventListener('click', runPingTest);
