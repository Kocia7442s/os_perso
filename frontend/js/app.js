// =========================================================
//  app.js — Point d'entrée du frontend + routeur "SPA" Vanilla.
//
//  Rôle :
//   1. Importer le Web Component <bento-card> et la couche API.
//   2. Intercepter les clics sur la Sidebar (sans recharger la page).
//   3. Injecter les <bento-card> de la vue demandée dans le <main>.
// =========================================================

import '../components/bento-card.js';        // enregistre <bento-card>
import { getSystemStatus } from './api.js';   // couche réseau

const main     = document.getElementById('main');
const navItems = document.querySelectorAll('.nav-item');

// ---------------------------------------------------------------------------
// 1) Définition des VUES
//    Chaque vue = un titre + une liste de cartes (title, icon, span, body…).
//    Pour ajouter un module plus tard : on ajoute une entrée ici, c'est tout.
// ---------------------------------------------------------------------------
const VIEWS = {
  dashboard: {
    title: 'Tableau de bord',
    cards: [
      { title: 'État du système', icon: '🩺', span: 2, id: 'system-status',
        body: '<p class="muted">Connexion à l\'API…</p>' },
      { title: 'Liste de courses', icon: '🛒',
        body: '<p class="muted">Module Foyer — bientôt connecté à la BDD.</p>' },
      { title: 'Domotique',       icon: '💡',
        body: '<p class="muted">Capteurs Zigbee — à venir.</p>' },
      { title: 'Chiffre d\'affaires', icon: '📈',
        body: '<p class="muted">Suivi auto-entrepreneur — à venir.</p>' },
    ],
  },
  foyer: {
    title: 'Foyer',
    cards: [
      { title: 'Liste de courses', icon: '🛒', span: 2,
        body: '<p class="muted">La table <code>shopping_items</code> existe déjà côté BDD.</p>' },
      { title: 'Calendrier commun', icon: '📅',
        body: '<p class="muted">À venir.</p>' },
    ],
  },
  domotique: {
    title: 'Domotique',
    cards: [
      { title: 'Home Assistant', icon: '🏠', body: '<p class="muted">À connecter.</p>' },
      { title: 'Capteurs Zigbee', icon: '📡', body: '<p class="muted">À venir.</p>' },
      { title: 'Monitoring RPi',  icon: '🖥️', body: '<p class="muted">À venir.</p>' },
    ],
  },
  pro: {
    title: 'Pro & Freelance',
    cards: [
      { title: 'Factures', icon: '🧾', body: '<p class="muted">À venir.</p>' },
      { title: 'Rappels Urssaf', icon: '⏰', body: '<p class="muted">À venir.</p>' },
    ],
  },
  finances: {
    title: 'Finances',
    cards: [
      { title: 'Dépenses',        icon: '💶', body: '<p class="muted">À venir.</p>' },
      { title: 'Investissements', icon: '📊', body: '<p class="muted">À venir.</p>' },
    ],
  },
};

// ---------------------------------------------------------------------------
// 2) Rendu d'une vue : on vide le <main> et on injecte les cartes.
// ---------------------------------------------------------------------------
function renderView(name) {
  const view = VIEWS[name] || VIEWS.dashboard;

  // Titre de la vue
  main.innerHTML = `<h1 class="view-title">${view.title}</h1>`;

  // Grille Bento
  const grid = document.createElement('div');
  grid.className = 'bento-grid';

  view.cards.forEach(def => {
    const card = document.createElement('bento-card');
    card.setAttribute('title', def.title);
    if (def.icon) card.setAttribute('icon', def.icon);
    if (def.span) card.setAttribute('span', def.span);
    if (def.id)   card.id = def.id;
    card.innerHTML = def.body || ''; // contenu projeté dans le <slot>
    grid.appendChild(card);
  });

  main.appendChild(grid);

  // Met à jour l'état "actif" de la Sidebar
  setActiveNav(name);

  // Hook post-rendu : remplir les cartes "live" (qui dépendent de l'API)
  if (name === 'dashboard') loadSystemStatus();
}

// ---------------------------------------------------------------------------
// 3) Carte "live" : on interroge réellement le backend pour l'état système.
// ---------------------------------------------------------------------------
async function loadSystemStatus() {
  const card = document.getElementById('system-status');
  if (!card) return;

  try {
    const data = await getSystemStatus();
    const dbOk = data?.status === 'success';
    card.innerHTML = `
      <ul class="kv">
        <li><span>API backend</span><strong class="ok">● en ligne</strong></li>
        <li><span>Base MariaDB</span><strong class="${dbOk ? 'ok' : 'error'}">${dbOk ? '● connectée' : '● erreur'}</strong></li>
        <li><span>Test SQL</span><strong>SELECT 1 → ${data?.db_response?.ping ?? '—'}</strong></li>
      </ul>`;
  } catch (err) {
    card.innerHTML = `<p class="error">⚠️ API injoignable : ${err.message}</p>`;
  }
}

// ---------------------------------------------------------------------------
// 4) Helpers de navigation
// ---------------------------------------------------------------------------
function setActiveNav(name) {
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.view === name);
  });
}

function currentView() {
  return location.hash.replace('#', '') || 'dashboard';
}

// Interception des clics sur la Sidebar : on empêche le rechargement et on
// pilote la navigation via le hash (#foyer, #domotique…).
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const view = item.dataset.view;
    if (currentView() === view) {
      renderView(view);             // déjà sur la vue → on re-rend manuellement
    } else {
      location.hash = view;         // sinon on change le hash (déclenche hashchange)
    }
  });
});

// Navigation au clavier / boutons précédent-suivant du navigateur.
window.addEventListener('hashchange', () => renderView(currentView()));

// Rendu initial au chargement de la page.
renderView(currentView());
