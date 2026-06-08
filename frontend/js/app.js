// =========================================================
//  app.js — Point d'entrée du frontend + routeur "SPA" Vanilla.
//
//  Rôle :
//   1. Importer le Web Component <bento-card> et la couche API.
//   2. Intercepter les clics sur la Sidebar (sans recharger la page).
//   3. Injecter les <bento-card> de la vue demandée dans le <main>.
// =========================================================

import '../components/bento-card.js';        // enregistre <bento-card>
import { getSystemStatus, generateWeeklyMenu, getCurrentMenu,
         getShoppingList, addShoppingItem, setShoppingItemStatus, deleteShoppingItem,
         getPreferences, savePreferences } from './api.js';   // couche réseau

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
          <button class="card-action" slot="actions" id="btn-menu-settings"
                  title="Réglages du menu" aria-label="Réglages du menu">⚙️</button>
          <button id="btn-generate-menu" class="btn-primary">Générer le menu (IA)</button>
          <div id="menu-result"></div>
        ` },
      { title: 'Liste de courses', icon: '🛒', id: 'card-shopping',
        body: '<div id="shopping-result"><p class="muted">Chargement…</p></div>' },
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

/** Câble les boutons interactifs après le rendu de la vue Foyer. */
function initFoyerView() {
  const btn = document.getElementById('btn-generate-menu');
  if (btn) btn.addEventListener('click', handleMenuGeneration);

  const settingsBtn = document.getElementById('btn-menu-settings');
  if (settingsBtn) settingsBtn.addEventListener('click', openPrefsDialog);

  // Affiche d'emblée le dernier menu enregistré (sans rappeler l'IA).
  loadCurrentMenu();
  // …et la liste de courses, avec ses interactions.
  loadShoppingList();
  initShoppingInteractions();
}

/** Charge et affiche la liste de courses dans sa carte. */
async function loadShoppingList() {
  const result = document.getElementById('shopping-result');
  if (!result) return;

  try {
    const { data } = await getShoppingList();
    result.innerHTML = renderShoppingList(data ?? []);
  } catch (err) {
    result.innerHTML = `<p class="error">Liste indisponible : ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Construit le HTML de la liste de courses (interactive).
 * @param {Array} items [ { id, nom, achete }, ... ] (déjà triée côté backend)
 */
function renderShoppingList(items) {
  let html = '';

  if (!Array.isArray(items) || items.length === 0) {
    html += '<p class="muted">Liste de courses vide.</p>';
  } else {
    const toBuy = items.filter(i => !i.achete).length;
    html += `<p class="shopping-count">${toBuy} article(s) à acheter</p>`;
    html += '<ul class="shopping-list">';
    items.forEach(item => {
      const cls  = item.achete ? 'shopping-item bought' : 'shopping-item';
      const mark = item.achete ? '☑' : '☐';
      html += `<li class="${cls}" data-id="${item.id}">`
            + `<button type="button" class="shopping-toggle" aria-label="Cocher / décocher">`
            + `<span class="mark">${mark}</span>`
            + `<span class="label">${escapeHtml(item.nom)}</span>`
            + `</button>`
            + `<button type="button" class="shopping-delete" aria-label="Supprimer" title="Supprimer">✕</button>`
            + `</li>`;
    });
    html += '</ul>';
  }

  // Champ d'ajout (toujours présent, même si la liste est vide).
  html += `
    <form class="shopping-add" autocomplete="off">
      <input type="text" name="nom" placeholder="Ajouter un article…" maxlength="255" required>
      <button type="submit" class="btn-primary" aria-label="Ajouter">+</button>
    </form>`;

  return html;
}

/**
 * Câble les interactions de la liste de courses par DÉLÉGATION sur le conteneur
 * (#shopping-result persiste pendant que son innerHTML est ré-rendu après chaque action).
 */
function initShoppingInteractions() {
  const container = document.getElementById('shopping-result');
  if (!container) return;

  // Clics : cocher/décocher (bouton toggle) ou supprimer (croix).
  container.addEventListener('click', async (e) => {
    const li = e.target.closest('.shopping-item');
    if (!li) return;
    const id = Number(li.dataset.id);

    try {
      if (e.target.closest('.shopping-delete')) {
        await deleteShoppingItem(id);
        await loadShoppingList();
      } else if (e.target.closest('.shopping-toggle')) {
        const achete = !li.classList.contains('bought'); // état cible
        await setShoppingItemStatus(id, achete);
        await loadShoppingList();
      }
    } catch (err) {
      console.error('Action liste de courses échouée :', err.message);
    }
  });

  // Ajout d'un article.
  container.addEventListener('submit', async (e) => {
    if (!e.target.classList.contains('shopping-add')) return;
    e.preventDefault();
    const nom = e.target.nom.value.trim();
    if (!nom) return;
    try {
      await addShoppingItem(nom);
      await loadShoppingList();
      // Re-focus sur le champ recréé, pour enchaîner les ajouts.
      const input = container.querySelector('.shopping-add input');
      if (input) input.focus();
    } catch (err) {
      console.error('Ajout article échoué :', err.message);
    }
  });
}

/** Charge et affiche le dernier menu persistant au chargement de la vue Foyer. */
async function loadCurrentMenu() {
  const result = document.getElementById('menu-result');
  if (!result) return;

  try {
    const { data } = await getCurrentMenu();
    const semaine = data?.menu?.semaine ?? [];
    if (!semaine.length) {
      result.innerHTML = '<p class="muted">Aucun menu pour l\'instant — clique sur « Générer le menu ».</p>';
      return;
    }
    // On masque la notif "liste de courses" : pertinente uniquement après une génération.
    result.innerHTML = renderMenu(data, { showShoppingNotif: false });
  } catch (_) {
    result.innerHTML = ''; // chargement silencieux : pas d'erreur bloquante à l'arrivée
  }
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
function renderMenu(data, { showShoppingNotif = true } = {}) {
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

  // --- Notification liste de courses (uniquement juste après une génération) ---
  if (showShoppingNotif) {
    const nb = data.articles_ajoutes ?? (data.menu.liste_courses_deduite?.length ?? 0);
    html += `<p class="menu-notif">🛒 Liste de courses mise à jour : `
          + `<strong>${nb}</strong> article(s) ajouté(s).</p>`;
  }

  return html;
}

/** Échappe le HTML — le contenu vient d'un LLM, on ne l'injecte jamais brut. */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
//  Réglages du menu — <dialog> natif (préférences du foyer)
// ---------------------------------------------------------------------------

/**
 * Crée le <dialog> de réglages une seule fois (puis le réutilise) et câble
 * ses boutons. Renvoie l'élément <dialog>.
 */
function ensurePrefsDialog() {
  let dialog = document.getElementById('prefs-dialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'prefs-dialog';
  dialog.className = 'app-dialog';
  dialog.innerHTML = `
    <form id="prefs-form" method="dialog">
      <h2 class="dialog-title">⚙️ Réglages du menu</h2>

      <label class="field">
        <span>Nombre de personnes</span>
        <input type="number" name="household_size" min="1" max="20" required>
      </label>
      <label class="field">
        <span>Repas végétariens / semaine (minimum)</span>
        <input type="number" name="veggie_meals" min="0" max="9" required>
      </label>
      <label class="field">
        <span>Repas à base de pâtes / semaine (maximum)</span>
        <input type="number" name="max_pasta" min="0" max="9" required>
      </label>
      <label class="field">
        <span>À éviter / allergies</span>
        <textarea name="avoid" rows="2" maxlength="500"
                  placeholder="ex : champignons, fruits de mer"></textarea>
      </label>

      <p class="dialog-error" id="prefs-error" hidden></p>

      <div class="dialog-actions">
        <button type="button" class="btn-ghost" id="prefs-cancel">Annuler</button>
        <button type="submit" class="btn-primary" id="prefs-save">Enregistrer</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);

  // Annuler : on ferme sans rien sauvegarder.
  dialog.querySelector('#prefs-cancel')
        .addEventListener('click', () => dialog.close());

  // Enregistrer : on sauvegarde via l'API, puis on ferme.
  dialog.querySelector('#prefs-form').addEventListener('submit', async (e) => {
    e.preventDefault(); // on gère la sauvegarde nous-mêmes (sinon le dialog fermerait avant)
    const form     = e.target;
    const saveBtn  = form.querySelector('#prefs-save');
    const errorEl  = form.querySelector('#prefs-error');

    errorEl.hidden  = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement…';

    try {
      await savePreferences({
        household_size: Number(form.household_size.value),
        veggie_meals:   Number(form.veggie_meals.value),
        max_pasta:      Number(form.max_pasta.value),
        avoid:          form.avoid.value.trim(),
      });
      dialog.close();
    } catch (err) {
      errorEl.textContent = `Échec de l'enregistrement : ${err.message}`;
      errorEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Enregistrer';
    }
  });

  return dialog;
}

/** Ouvre la modale de réglages, pré-remplie avec les préférences actuelles. */
async function openPrefsDialog() {
  const dialog = ensurePrefsDialog();
  const form   = dialog.querySelector('#prefs-form');

  // Pré-remplissage depuis le backend (valeurs par défaut si l'appel échoue).
  try {
    const { data = {} } = await getPreferences();
    form.household_size.value = data.household_size ?? 2;
    form.veggie_meals.value   = data.veggie_meals   ?? 2;
    form.max_pasta.value      = data.max_pasta      ?? 2;
    form.avoid.value          = data.avoid          ?? '';
  } catch (_) {
    form.household_size.value = 2;
    form.veggie_meals.value   = 2;
    form.max_pasta.value      = 2;
    form.avoid.value          = '';
  }

  dialog.showModal();
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
