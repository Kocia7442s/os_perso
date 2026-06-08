// =========================================================
//  app.js — Point d'entrée du frontend + routeur "SPA" Vanilla.
//
//  Rôle :
//   1. Importer le Web Component <bento-card> et la couche API.
//   2. Intercepter les clics sur la Sidebar (sans recharger la page).
//   3. Injecter les <bento-card> de la vue demandée dans le <main>.
// =========================================================

import '../components/bento-card.js';        // enregistre <bento-card>
import { getSystemStatus, generateWeeklyMenu } from './api.js';   // couche réseau

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
      { title: 'Menu de la Semaine', icon: '🍽️', span: 2, id: 'card-menu',
        body: `
          <button id="btn-generate-menu" class="btn-primary">Générer le menu (IA)</button>
          <div id="menu-result"></div>
        ` },
      { title: 'Liste de courses', icon: '🛒',
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

  // Hook post-rendu : câbler / remplir les cartes interactives ou "live"
  if (name === 'dashboard') loadSystemStatus();
  if (name === 'foyer')     initFoyerView();
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
//  Module FOYER — génération et affichage du menu de la semaine
// ---------------------------------------------------------------------------

/** Câble le bouton de génération après le rendu de la vue Foyer. */
function initFoyerView() {
  const btn = document.getElementById('btn-generate-menu');
  if (btn) btn.addEventListener('click', handleMenuGeneration);
}

/**
 * Gère le clic "Générer le menu" : désactive le bouton pendant l'appel,
 * affiche un état de chargement, puis injecte le résultat (ou l'erreur).
 */
async function handleMenuGeneration() {
  const btn    = document.getElementById('btn-generate-menu');
  const result = document.getElementById('menu-result');
  if (!btn || !result) return;

  // --- État "chargement" ---
  const originalLabel = btn.textContent;
  btn.disabled    = true;
  btn.textContent = '⏳ Génération en cours…';
  result.innerHTML = '<p class="muted">L\'IA compose ton menu, quelques secondes…</p>';

  try {
    const response = await generateWeeklyMenu();
    result.innerHTML = renderMenu(response.data);
  } catch (err) {
    result.innerHTML = `<p class="error">❌ Échec de la génération : ${escapeHtml(err.message)}</p>`;
  } finally {
    // Toujours réactiver le bouton, succès comme échec.
    btn.disabled    = false;
    btn.textContent = originalLabel;
  }
}

/**
 * Construit le HTML d'affichage du menu à partir des données du backend.
 * @param {Object} data { jours_planifies, articles_ajoutes, menu: {semaine, liste_courses_deduite} }
 */
function renderMenu(data) {
  if (!data || !data.menu || !Array.isArray(data.menu.semaine)) {
    return '<p class="error">Réponse inattendue du serveur.</p>';
  }

  const WEEKEND = ['Samedi', 'Dimanche'];
  const semaine = data.menu.semaine;
  const enSemaine = semaine.filter(j => !WEEKEND.includes(j.jour));
  const weekend   = semaine.filter(j =>  WEEKEND.includes(j.jour));

  // --- Soirs de la semaine (Lundi -> Vendredi) ---
  let html = '<div class="menu-block"><h3 class="menu-title">🌙 Soirs de la semaine</h3><ul class="menu-list">';
  enSemaine.forEach(j => {
    const soir = j.repas?.soir ?? '—';
    html += `<li><span class="menu-day">${escapeHtml(j.jour)}</span>`
          + `<span class="menu-meal">${escapeHtml(soir)}</span></li>`;
  });
  html += '</ul></div>';

  // --- Week-end (midi + soir) ---
  html += '<div class="menu-block"><h3 class="menu-title">🥐 Week-end</h3><ul class="menu-list">';
  weekend.forEach(j => {
    if (j.repas?.midi) {
      html += `<li><span class="menu-day">${escapeHtml(j.jour)} midi</span>`
            + `<span class="menu-meal">${escapeHtml(j.repas.midi)}</span></li>`;
    }
    if (j.repas?.soir) {
      html += `<li><span class="menu-day">${escapeHtml(j.jour)} soir</span>`
            + `<span class="menu-meal">${escapeHtml(j.repas.soir)}</span></li>`;
    }
  });
  html += '</ul></div>';

  // --- Notification liste de courses ---
  const nb = data.articles_ajoutes ?? (data.menu.liste_courses_deduite?.length ?? 0);
  html += `<p class="menu-notif">🛒 Liste de courses mise à jour : `
        + `<strong>${nb}</strong> article(s) ajouté(s).</p>`;

  return html;
}

/** Échappe le HTML — le contenu vient d'un LLM, on ne l'injecte jamais brut. */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
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
