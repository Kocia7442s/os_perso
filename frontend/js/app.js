// =========================================================
//  app.js — Point d'entrée du frontend + routeur "SPA" Vanilla.
//
//  Rôle :
//   1. Importer le Web Component <bento-card> et la couche API.
//   2. Intercepter les clics sur la Sidebar (sans recharger la page).
//   3. Injecter les <bento-card> de la vue demandée dans le <main>.
// =========================================================

import '../components/bento-card.js';        // enregistre <bento-card>
import { getSystemStatus, generateWeeklyMenu, getCurrentMenu, cookMeal, addMeal, deleteMeal, getRecipe, generateRecipe,
         getShoppingList, addShoppingItem, setShoppingItemStatus, deleteShoppingItem, stockBoughtItem,
         getPantry, addPantryItem, updatePantryItem, deletePantryItem,
         getPreferences, savePreferences,
         getCalendarEvents, getCalendarRange,
         getTransactions, addTransaction, updateTransaction, deleteTransaction,
         getFinanceSummary, getFinanceCategories } from './api.js';   // couche réseau

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
      { title: 'Foyer aujourd\'hui', icon: '☀️', span: 2, id: 'card-today',
        body: '<div id="today-result"><p class="muted">Chargement…</p></div>' },
      { title: 'État du système', icon: '🩺', span: 2, id: 'system-status',
        body: '<p class="muted">Connexion à l\'API…</p>' },
    ],
  },
  foyer: {
    title: 'Foyer',
    cards: [
      { title: 'Menu de la Semaine', icon: '🍽️', span: 2, id: 'card-menu',
        body: `
          <button class="card-action" slot="actions" id="btn-menu-settings"
                  title="Réglages du menu" aria-label="Réglages du menu">⚙️</button>
          <div class="menu-toolbar">
            <button id="btn-generate-menu" class="btn-primary">Générer le menu (IA)</button>
            <button id="btn-add-meal" class="btn-ghost">➕ Ajouter un repas</button>
          </div>
          <div id="menu-result"></div>
        ` },
      { title: 'Liste de courses', icon: '🛒', id: 'card-shopping',
        body: '<div id="shopping-result"><p class="muted">Chargement…</p></div>' },
      { title: 'Mes placards', icon: '🧺', id: 'card-pantry',
        body: '<div id="pantry-result"><p class="muted">Chargement…</p></div>' },
      { title: 'Calendrier commun', icon: '📅', span: 2, id: 'card-calendar',
        body: '<div id="calendar-result"><p class="muted">Chargement…</p></div>' },
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
      { title: 'Saisie rapide', icon: '➕', id: 'card-fin-add',
        body: '<div id="fin-add"><p class="muted">Chargement…</p></div>' },
      { title: 'Ce mois-ci', icon: '💶', id: 'card-fin-month',
        body: '<div id="fin-month"><p class="muted">Chargement…</p></div>' },
      { title: 'Répartition', icon: '🍩', id: 'card-fin-cats',
        body: '<div id="fin-cats"><p class="muted">Chargement…</p></div>' },
      { title: 'Transactions', icon: '📋', span: 2, id: 'card-fin-list',
        body: '<div id="fin-list"><p class="muted">Chargement…</p></div>' },
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
  if (name === 'dashboard') { loadSystemStatus(); loadTodaySummary(); initTodayInteractions(); }
  if (name === 'foyer')     initFoyerView();
  if (name === 'finances')  initFinancesView();
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

  const addMealBtn = document.getElementById('btn-add-meal');
  if (addMealBtn) addMealBtn.addEventListener('click', () => openMealDialog());

  // Affiche d'emblée le dernier menu enregistré (sans rappeler l'IA).
  loadCurrentMenu();
  initMenuInteractions();
  // …la liste de courses, avec ses interactions.
  loadShoppingList();
  initShoppingInteractions();
  // …et les placards.
  loadPantry();
  initPantryInteractions();
  // …et l'agenda commun (calendriers Apple publiés).
  loadCalendar();
}

// ---------------------------------------------------------------------------
//  Carte "Foyer aujourd'hui" — résumé en un coup d'œil (repas, agenda, courses)
//  100 % côté front : agrège les 3 endpoints déjà existants, aucun appel IA.
// ---------------------------------------------------------------------------

// Index getDay() (0 = dimanche) → nom de jour tel que stocké dans weekly_plan.
const WEEKDAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** Charge en parallèle menu + agenda du jour + courses, puis rend le résumé. */
async function loadTodaySummary() {
  const result = document.getElementById('today-result');
  if (!result) return;

  const today = startOfDay(new Date());
  // Promise.allSettled : une carte qui échoue ne fait pas tomber les deux autres.
  const [menuRes, calRes, shopRes] = await Promise.allSettled([
    getCurrentMenu(),
    getCalendarRange(ymd(today), ymd(addDays(today, 1))),
    getShoppingList(),
  ]);

  const semaine  = menuRes.value?.data?.menu?.semaine ?? [];
  const calData  = calRes.value ?? null;
  const shopList = shopRes.value?.data ?? [];

  result.innerHTML = `<div class="today-grid">`
    + todayMealTile(semaine, today)
    + todayAgendaTile(calData, today, calRes.status === 'rejected')
    + todayShoppingTile(shopList, shopRes.status === 'rejected')
    + `</div>`;
}

/** Tuile "repas du jour" : le soir en semaine, midi + soir le week-end. */
function todayMealTile(semaine, today) {
  const jourNom = WEEKDAYS_FR[today.getDay()];
  const isWeekend = today.getDay() === 0 || today.getDay() === 6;
  const entry = semaine.find(d => d.jour === jourNom);
  const repas = entry?.repas ?? {};

  // Réutilise mealRow() (même rendu que la carte Menu) : libellé + plat cliquable
  // + bouton "J'ai cuisiné". En semaine on ne montre que le soir.
  const rows = isWeekend
    ? [['Midi', repas.midi], ['Soir', repas.soir]]
    : [['Ce soir', repas.soir]];

  const inner = entry
    ? `<ul class="menu-list">${rows.map(([lbl, m]) => mealRow(lbl, m)).join('')}</ul>`
    : `<p class="muted">Pas de menu planifié pour aujourd'hui.</p>`;

  return `<div class="today-tile">`
    + `<h3 class="today-tile-h">🍽️ Au menu</h3>`
    + inner
    + `</div>`;
}

/** Tuile "agenda du jour" : événements d'aujourd'hui (clic → modale calendrier). */
function todayAgendaTile(calData, today, failed) {
  const calendars = Array.isArray(calData?.calendars) ? calData.calendars : [];
  const events    = Array.isArray(calData?.data) ? calData.data : [];

  let inner;
  if (failed) {
    inner = `<p class="muted">Agenda indisponible.</p>`;
  } else if (calendars.length === 0) {
    inner = `<p class="muted">Aucun calendrier configuré.</p>`;
  } else {
    const todays = events.filter(e => occursOnDay(e, today));
    if (todays.length === 0) {
      inner = `<p class="muted">Rien de prévu aujourd'hui. 🎉</p>`;
    } else {
      const allDay = todays.filter(e => e.all_day);
      const timed  = todays.filter(e => !e.all_day)
        .sort((a, b) => evStart(a) - evStart(b));
      let html = '';
      html += allDay.map(e =>
        `<div class="today-ev"><span class="today-ev-time">jour</span>`
        + `<span class="today-ev-title">${escapeHtml(e.title)}</span></div>`).join('');
      html += timed.slice(0, 3).map(e =>
        `<div class="today-ev"><span class="today-ev-time">${formatTime(e.start)}</span>`
        + `<span class="today-ev-title">${escapeHtml(e.title)}</span></div>`).join('');
      const extra = timed.length - 3;
      if (extra > 0) html += `<p class="today-more">+ ${extra} autre${extra > 1 ? 's' : ''}…</p>`;
      inner = html;
    }
  }

  return `<button type="button" class="today-tile today-tile-btn" id="today-agenda" `
    + `title="Ouvrir le calendrier">`
    + `<h3 class="today-tile-h">📅 Aujourd'hui</h3>${inner}</button>`;
}

/** Tuile "courses" : nombre d'articles restant à acheter (clic → carte courses). */
function todayShoppingTile(shopList, failed) {
  let inner;
  if (failed) {
    inner = `<p class="muted">Liste indisponible.</p>`;
  } else {
    const toBuy = shopList.filter(i => !i.achete).length;
    inner = toBuy === 0
      ? `<p class="today-big ok">À jour ✓</p>`
      : `<p class="today-big">${toBuy}</p>`
        + `<p class="muted">article${toBuy > 1 ? 's' : ''} à acheter</p>`;
  }

  return `<button type="button" class="today-tile today-tile-btn" id="today-shopping" `
    + `title="Aller à la liste de courses">`
    + `<h3 class="today-tile-h">🛒 Courses</h3>${inner}</button>`;
}

/** Délégation des clics de la carte résumé (recette, cuisiné, agenda, courses). */
function initTodayInteractions() {
  const container = document.getElementById('today-result');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    // Nom du plat → recette (réutilise la modale existante).
    const recipeBtn = e.target.closest('.meal-recipe');
    if (recipeBtn) { openRecipeModal(Number(recipeBtn.dataset.id)); return; }

    // Bouton "j'ai cuisiné" → bascule, puis on rafraîchit résumé + menu + placards.
    const cookBtn = e.target.closest('.meal-cook');
    if (cookBtn) {
      const id = Number(cookBtn.dataset.id);
      const target = !cookBtn.classList.contains('on');
      cookBtn.disabled = true;
      try {
        await cookMeal(id, target);
        await Promise.all([loadTodaySummary(), loadCurrentMenu()]);
        if (target) await loadPantry();
      } catch (err) {
        console.error('Bascule "cuisiné" (résumé) échouée :', err.message);
        cookBtn.disabled = false;
      }
      return;
    }

    // Tuile agenda → ouvre la modale calendrier.
    if (e.target.closest('#today-agenda')) { openCalendarModal(); return; }

    // Tuile courses → bascule sur la vue Foyer (liste de courses détaillée).
    if (e.target.closest('#today-shopping')) { location.hash = 'foyer'; return; }
  });
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
/**
 * Rayons de magasin, dans l'ordre d'un parcours (doit rester synchronisé avec
 * ShoppingList::RAYONS côté backend).
 */
const SHOPPING_RAYONS = [
  'Fruits & légumes',
  'Boucherie & poissonnerie',
  'Crémerie & frais',
  'Épicerie salée',
  'Épicerie sucrée',
  'Boulangerie',
  'Surgelés',
  'Boissons',
  'Hygiène & entretien',
  'Autre',
];

/** Construit le `<li>` interactif d'un article de courses. */
function renderShoppingItem(item) {
  const cls  = item.achete ? 'shopping-item bought' : 'shopping-item';
  const mark = item.achete ? '☑' : '☐';
  const qty  = item.quantite ? `<span class="qty">${escapeHtml(item.quantite)}</span>` : '';
  // Bouton "ranger au placard" : seulement pour un article déjà acheté.
  const stock = item.achete
    ? `<button type="button" class="shopping-stock" aria-label="Ranger au placard" title="Ranger au placard">🧺</button>`
    : '';
  return `<li class="${cls}" data-id="${item.id}">`
       + `<button type="button" class="shopping-toggle" aria-label="Cocher / décocher">`
       + `<span class="mark">${mark}</span>`
       + `<span class="label">${escapeHtml(item.nom)}</span>`
       + qty
       + `</button>`
       + stock
       + `<button type="button" class="shopping-delete" aria-label="Supprimer" title="Supprimer">✕</button>`
       + `</li>`;
}

function renderShoppingList(items) {
  let html = '';
  const list = Array.isArray(items) ? items : [];

  if (list.length === 0) {
    html += '<p class="muted">Liste de courses vide.</p>';
  } else {
    const toBuy  = list.filter(i => !i.achete);
    const bought = list.filter(i => i.achete);

    // En-tête : compteur + bouton "copier" (export texte).
    html += `<div class="shopping-head">`
          + `<span class="shopping-count">${toBuy.length} article(s) à acheter</span>`
          + `<button type="button" class="shopping-export" title="Copier la liste">📋 Copier</button>`
          + `</div>`;

    // Articles à acheter, groupés par rayon (ordre du parcours magasin).
    const byRayon = new Map();
    toBuy.forEach(it => {
      const r = SHOPPING_RAYONS.includes(it.rayon) ? it.rayon : 'Autre';
      if (!byRayon.has(r)) byRayon.set(r, []);
      byRayon.get(r).push(it);
    });
    SHOPPING_RAYONS.forEach(rayon => {
      const group = byRayon.get(rayon);
      if (!group || !group.length) return;
      html += `<h4 class="shopping-rayon">${escapeHtml(rayon)}</h4>`;
      html += '<ul class="shopping-list">' + group.map(renderShoppingItem).join('') + '</ul>';
    });

    // Articles déjà achetés : section repliée en bas (toujours actionnable).
    if (bought.length) {
      html += `<h4 class="shopping-rayon done">✓ Achetés (${bought.length})</h4>`;
      html += '<ul class="shopping-list">' + bought.map(renderShoppingItem).join('') + '</ul>';
    }
  }

  // Champ d'ajout (toujours présent, même si la liste est vide) avec choix du rayon.
  const options = SHOPPING_RAYONS.map(r =>
    `<option value="${escapeAttr(r)}"${r === 'Autre' ? ' selected' : ''}>${escapeHtml(r)}</option>`).join('');
  html += `
    <form class="shopping-add" autocomplete="off">
      <input type="text" name="nom" placeholder="Ajouter un article…" maxlength="255" required>
      <input type="text" name="quantite" placeholder="Qté" maxlength="50" class="qty-input">
      <select name="rayon" class="rayon-select" aria-label="Rayon">${options}</select>
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

  // Clics : export (copier), puis cocher/décocher / ranger / supprimer.
  container.addEventListener('click', async (e) => {
    // Bouton "Copier" : hors de toute ligne d'article → géré en premier.
    if (e.target.closest('.shopping-export')) {
      await copyShoppingList(e.target.closest('.shopping-export'));
      return;
    }

    const li = e.target.closest('.shopping-item');
    if (!li) return;
    const id = Number(li.dataset.id);

    try {
      if (e.target.closest('.shopping-stock')) {
        await stockBoughtItem(id);
        await loadShoppingList(); // l'article quitte les courses…
        await loadPantry();       // …et apparaît (ou est déjà) au placard
      } else if (e.target.closest('.shopping-delete')) {
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
    const nom      = e.target.nom.value.trim();
    const quantite = e.target.quantite.value.trim();
    const rayon    = e.target.rayon ? e.target.rayon.value : 'Autre';
    if (!nom) return;
    try {
      await addShoppingItem(nom, quantite, rayon);
      await loadShoppingList();
      // Re-focus sur le champ recréé, pour enchaîner les ajouts.
      const input = container.querySelector('.shopping-add input');
      if (input) input.focus();
    } catch (err) {
      console.error('Ajout article échoué :', err.message);
    }
  });
}

/**
 * Construit le texte de la liste (articles à acheter, groupés par rayon) et le
 * copie dans le presse-papier. Donne un retour visuel bref sur le bouton.
 */
async function copyShoppingList(btn) {
  let text = '';
  try {
    const { data } = await getShoppingList();
    const toBuy = (Array.isArray(data) ? data : []).filter(i => !i.achete);
    if (!toBuy.length) {
      flashButton(btn, 'Liste vide');
      return;
    }
    const lines = ['🛒 Liste de courses', ''];
    SHOPPING_RAYONS.forEach(rayon => {
      const group = toBuy.filter(i => (SHOPPING_RAYONS.includes(i.rayon) ? i.rayon : 'Autre') === rayon);
      if (!group.length) return;
      lines.push(`${rayon} :`);
      group.forEach(i => lines.push(`  • ${i.nom}${i.quantite ? ` (${i.quantite})` : ''}`));
      lines.push('');
    });
    text = lines.join('\n').trim();
    flashButton(btn, await copyText(text) ? '✓ Copié' : '⚠️ Échec');
  } catch (err) {
    console.error('Copie de la liste échouée :', err.message);
    flashButton(btn, '⚠️ Échec');
  }
}

/** Copie un texte dans le presse-papier (API moderne + repli execCommand). */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* on tente le repli ci-dessous */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}

/** Affiche un libellé temporaire sur un bouton puis restaure l'original. */
function flashButton(btn, label) {
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = label;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
}

// ---------------------------------------------------------------------------
//  Mes placards (inventory_pantry) — liste éditable
// ---------------------------------------------------------------------------

/** Charge et affiche les placards dans leur carte. */
async function loadPantry() {
  const result = document.getElementById('pantry-result');
  if (!result) return;

  try {
    const { data } = await getPantry();
    result.innerHTML = renderPantry(data ?? []);
  } catch (err) {
    result.innerHTML = `<p class="error">Placards indisponibles : ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Construit le HTML des placards (éditable).
 * @param {Array} items [ { id, item_name, quantity, is_essential }, ... ]
 */
function renderPantry(items) {
  let html = '';

  if (!Array.isArray(items) || items.length === 0) {
    html += '<p class="muted">Placards vides.</p>';
  } else {
    html += '<ul class="pantry-list">';
    items.forEach(item => {
      const starCls = item.is_essential ? 'pantry-essential on' : 'pantry-essential';
      const star    = item.is_essential ? '★' : '☆';
      html += `<li class="pantry-item" data-id="${item.id}">`
            + `<button type="button" class="${starCls}" title="Essentiel (à toujours avoir)" aria-label="Essentiel">${star}</button>`
            + `<span class="pantry-name">${escapeHtml(item.item_name)}</span>`
            + `<input type="text" class="pantry-qty" value="${escapeAttr(item.quantity)}" maxlength="50" aria-label="Quantité" title="Modifier la quantité">`
            + `<button type="button" class="pantry-delete" title="Retirer" aria-label="Retirer">✕</button>`
            + `</li>`;
    });
    html += '</ul>';
  }

  html += `
    <form class="pantry-add" autocomplete="off">
      <input type="text" name="item_name" placeholder="Ajouter un ingrédient…" maxlength="255" required>
      <input type="text" name="quantity" placeholder="Qté" maxlength="50" class="qty-input">
      <label class="pantry-ess-check" title="Marquer comme essentiel">
        <input type="checkbox" name="is_essential"> ★
      </label>
      <button type="submit" class="btn-primary" aria-label="Ajouter">+</button>
    </form>`;

  return html;
}

/** Câble les interactions des placards par délégation sur le conteneur. */
function initPantryInteractions() {
  const container = document.getElementById('pantry-result');
  if (!container) return;

  // Clic : bascule "essentiel" ou suppression.
  container.addEventListener('click', async (e) => {
    const li = e.target.closest('.pantry-item');
    if (!li) return;
    const id = Number(li.dataset.id);
    try {
      if (e.target.closest('.pantry-delete')) {
        await deletePantryItem(id);
        await loadPantry();
      } else if (e.target.closest('.pantry-essential')) {
        const on = e.target.closest('.pantry-essential').classList.contains('on');
        await updatePantryItem(id, { is_essential: !on });
        await loadPantry();
      }
    } catch (err) {
      console.error('Action placards échouée :', err.message);
    }
  });

  // Modification de la quantité (à la validation du champ : blur / Entrée).
  container.addEventListener('change', async (e) => {
    if (!e.target.classList.contains('pantry-qty')) return;
    const li = e.target.closest('.pantry-item');
    if (!li) return;
    try {
      await updatePantryItem(Number(li.dataset.id), { quantity: e.target.value.trim() });
      await loadPantry();
    } catch (err) {
      console.error('Maj quantité échouée :', err.message);
    }
  });

  // Ajout d'un ingrédient.
  container.addEventListener('submit', async (e) => {
    if (!e.target.classList.contains('pantry-add')) return;
    e.preventDefault();
    const form = e.target;
    const name = form.item_name.value.trim();
    if (!name) return;
    try {
      await addPantryItem(name, form.quantity.value.trim(), form.is_essential.checked);
      await loadPantry();
      const input = container.querySelector('.pantry-add input[name="item_name"]');
      if (input) input.focus();
    } catch (err) {
      console.error('Ajout placard échoué :', err.message);
    }
  });
}

/** Échappe une valeur destinée à un attribut HTML (quotes incluses). */
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
//  Calendrier commun — agenda fusionné (flux iCal Apple, lecture seule)
// ---------------------------------------------------------------------------

// --- Constantes & petits helpers de dates (tout en heure locale du navigateur) ---
const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const PX_PER_HOUR    = 44;   // hauteur d'une heure dans les timelines (sync avec --ph CSS)

/** État de la modale calendrier (mode courant + jour d'ancrage de la navigation). */
const calState = { mode: 'week', anchor: null };

const pad2       = (n) => String(n).padStart(2, '0');
const ymd        = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays    = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths  = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const parseYmd   = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };

/** Lundi 00:00 de la semaine contenant `d`. */
function startOfWeek(d) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // 0 = lundi
  return addDays(x, -dow);
}

/** Début / fin d'un événement en objets Date (journée entière = bornes de jour). */
const evStart = (ev) => ev.all_day ? startOfDay(parseYmd(ev.start)) : new Date(ev.start);
const evEnd   = (ev) => ev.all_day ? startOfDay(parseYmd(ev.end))   : new Date(ev.end);

/** Vrai si l'événement chevauche le jour `date` (fin de journée entière exclue). */
function occursOnDay(ev, date) {
  const dayStart = startOfDay(date);
  const dayEnd   = addDays(dayStart, 1);
  return evStart(ev) < dayEnd && evEnd(ev) > dayStart;
}

/** "2026-06-10T20:30:00+02:00" → "20:30" (heure locale du navigateur). */
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** "2026-06-10" → "Aujourd'hui · mercredi 10 juin" (ou "Demain · …"). */
function formatDayLabel(dayKeyStr) {
  const date  = parseYmd(dayKeyStr);
  const today = startOfDay(new Date());
  const diff  = Math.round((date - today) / 86400000);
  const label = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (diff === 0) return `Aujourd'hui · ${label}`;
  if (diff === 1) return `Demain · ${label}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ---------------------------------------------------------------------------
//  Chargement + vue JOUR (carte). La carte est cliquable → modale semaine/mois.
// ---------------------------------------------------------------------------

/** Charge les événements d'aujourd'hui et affiche la vue jour dans la carte. */
async function loadCalendar() {
  const result = document.getElementById('calendar-result');
  if (!result) return;

  const today = startOfDay(new Date());
  try {
    const res = await getCalendarRange(ymd(today), ymd(addDays(today, 1)));
    result.innerHTML = renderDayCard(res, today);
    scrollTimelineToNow(result);
  } catch (err) {
    result.innerHTML = `<p class="error">Agenda indisponible : ${escapeHtml(err.message)}</p>`;
  }
  initCalendarCardClick();
}

/** Rend la vue jour (timeline 24 h) dans la carte — affichée même sans événement. */
function renderDayCard(res, date) {
  const events    = Array.isArray(res?.data) ? res.data : [];
  const calendars = Array.isArray(res?.calendars) ? res.calendars : [];
  const errors    = Array.isArray(res?.errors) ? res.errors : [];

  if (calendars.length === 0) return configGuidanceHtml();

  let html = `<div class="cal-card-head">`
           + `<span class="cal-card-date">${escapeHtml(formatDayLabel(ymd(date)))}</span>`
           + `<span class="cal-expand">⤢ semaine / mois</span></div>`;
  html += legendHtml(calendars);
  html += errorsHtml(errors);

  const allday = allDayChipsHtml(events, date);
  if (allday) html += `<div class="cal-allday-row">${allday}</div>`;

  html += `<div class="cal-timeline" style="--ph:${PX_PER_HOUR}px">`
        + `<div class="cal-day-grid">${hourGutterHtml()}${dayColumnHtml(events, date)}</div></div>`;
  return html;
}

/** Câble (une seule fois) l'ouverture de la modale au clic sur la carte. */
function initCalendarCardClick() {
  const card = document.getElementById('card-calendar');
  if (!card || card.dataset.clickable) return;
  card.dataset.clickable = '1';
  card.style.cursor = 'pointer';
  card.addEventListener('click', () => openCalendarModal());
}

// ---------------------------------------------------------------------------
//  Briques de rendu communes (légende, erreurs, timeline, chips journée…)
// ---------------------------------------------------------------------------

function configGuidanceHtml() {
  return '<p class="muted">Aucun calendrier configuré. Publie tes agendas Apple '
       + '(Partager → Calendrier public) et colle les URLs dans <code>CAL_1_URL</code> / '
       + '<code>CAL_2_URL</code> du fichier <code>.env</code>.</p>';
}

function legendHtml(calendars) {
  return '<div class="cal-legend">' + calendars.map(c =>
    `<span class="cal-chip"><span class="cal-dot" style="background:${escapeAttr(c.color)}"></span>`
    + `${escapeHtml(c.name)}</span>`).join('') + '</div>';
}

function errorsHtml(errors) {
  return errors.map(msg => `<p class="cal-warn">⚠️ ${escapeHtml(msg)}</p>`).join('');
}

/** Colonne de gauche : 24 libellés d'heures (hauteur pilotée par --ph). */
function hourGutterHtml() {
  let h = '';
  for (let i = 0; i < 24; i++) {
    h += `<div class="cal-hour"><span>${pad2(i)}:00</span></div>`;
  }
  return `<div class="cal-gutter">${h}</div>`;
}

/** Chips des événements "journée entière" qui tombent sur `date`. */
function allDayChipsHtml(events, date) {
  return events.filter(e => e.all_day && occursOnDay(e, date)).map(e =>
    `<span class="cal-allday" style="border-left-color:${escapeAttr(e.color)}" title="${escapeAttr(e.calendar)}">`
    + `${escapeHtml(e.title)}</span>`).join('');
}

/**
 * Une colonne-jour positionnée : les événements horaires de `date`, placés en
 * absolu (top/hauteur selon l'heure) avec gestion des chevauchements en colonnes.
 */
function dayColumnHtml(events, date) {
  const timed  = events.filter(e => !e.all_day && occursOnDay(e, date));
  const placed = layoutDayEvents(timed);
  const dayStart = startOfDay(date);

  let h = '';
  placed.forEach(p => {
    const startMin = Math.max(0, (evStart(p.ev) - dayStart) / 60000);
    const endMin   = Math.min(24 * 60, (evEnd(p.ev) - dayStart) / 60000);
    const top      = startMin / 60 * PX_PER_HOUR;
    const height   = Math.max(16, (endMin - startMin) / 60 * PX_PER_HOUR);
    const widthPct = 100 / p.cols;
    const leftPct  = widthPct * p.col;
    const loc      = p.ev.location ? ` · ${escapeHtml(p.ev.location)}` : '';
    h += `<div class="cal-ev" style="top:${top}px;height:${height}px;`
       + `left:${leftPct}%;width:calc(${widthPct}% - 3px);border-left-color:${escapeAttr(p.ev.color)}" `
       + `title="${escapeAttr(p.ev.calendar)}">`
       + `<span class="cal-ev-time">${escapeHtml(formatTime(p.ev.start))}</span> `
       + `<span class="cal-ev-title">${escapeHtml(p.ev.title)}${loc}</span></div>`;
  });
  return `<div class="cal-col">${h}</div>`;
}

/**
 * Répartit en colonnes les événements qui se chevauchent (algo glouton par grappe).
 * @returns {Array<{ev:Object, col:number, cols:number}>}
 */
function layoutDayEvents(events) {
  const sorted = [...events].sort((a, b) => evStart(a) - evStart(b));
  const placed = [];
  let cluster = [];
  let clusterEnd = null;

  const flush = () => {
    const cols = []; // chaque colonne = liste d'événements non chevauchants
    cluster.forEach(ev => {
      let ci = cols.findIndex(col => evStart(ev) >= evEnd(col[col.length - 1]));
      if (ci === -1) { cols.push([ev]); ci = cols.length - 1; }
      else cols[ci].push(ev);
    });
    cols.forEach((col, ci) => col.forEach(ev => placed.push({ ev, col: ci, cols: cols.length })));
    cluster = [];
    clusterEnd = null;
  };

  sorted.forEach(ev => {
    if (cluster.length && evStart(ev) >= clusterEnd) flush();
    cluster.push(ev);
    const e = evEnd(ev);
    clusterEnd = clusterEnd ? new Date(Math.max(clusterEnd, e)) : e;
  });
  flush();
  return placed;
}

/** Fait défiler une timeline jusqu'à ~l'heure courante (lisibilité à l'ouverture). */
function scrollTimelineToNow(scope) {
  const tl = scope.querySelector('.cal-timeline');
  if (tl) tl.scrollTop = Math.max(0, (new Date().getHours() - 1) * PX_PER_HOUR);
}

// ---------------------------------------------------------------------------
//  Modale calendrier — vue SEMAINE (défaut) + bascule MOIS
// ---------------------------------------------------------------------------

/** Crée la modale une seule fois, câble ses contrôles (délégation), la renvoie. */
function ensureCalendarModal() {
  let dialog = document.getElementById('cal-dialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'cal-dialog';
  dialog.className = 'app-dialog cal-modal';
  dialog.innerHTML = `
    <div class="cal-modal-head">
      <div class="cal-nav">
        <button type="button" class="btn-ghost cal-prev" aria-label="Précédent">‹</button>
        <button type="button" class="btn-ghost cal-today">Aujourd'hui</button>
        <button type="button" class="btn-ghost cal-next" aria-label="Suivant">›</button>
      </div>
      <h2 class="cal-modal-title" id="cal-modal-title"></h2>
      <div class="cal-modeswitch">
        <button type="button" class="cal-mode" data-mode="week">Semaine</button>
        <button type="button" class="cal-mode" data-mode="month">Mois</button>
        <button type="button" class="btn-ghost cal-close" aria-label="Fermer">✕</button>
      </div>
    </div>
    <div class="cal-modal-body" id="cal-modal-body"><p class="muted">Chargement…</p></div>
  `;
  document.body.appendChild(dialog);

  // Contrôles : navigation, bascule de mode, fermeture, clic sur un jour (vue mois).
  dialog.addEventListener('click', (e) => {
    const step = (calState.mode === 'week')
      ? (n) => { calState.anchor = addDays(calState.anchor, n * 7); }
      : (n) => { calState.anchor = addMonths(calState.anchor, n); };

    if (e.target.closest('.cal-prev'))  { step(-1); renderCalendarModal(); return; }
    if (e.target.closest('.cal-next'))  { step(1);  renderCalendarModal(); return; }
    if (e.target.closest('.cal-today')) { calState.anchor = startOfDay(new Date()); renderCalendarModal(); return; }
    if (e.target.closest('.cal-close')) { dialog.close(); return; }

    const modeBtn = e.target.closest('.cal-mode');
    if (modeBtn) { calState.mode = modeBtn.dataset.mode; renderCalendarModal(); return; }

    const cell = e.target.closest('.cal-mc');
    if (cell && cell.dataset.date) { // clic sur un jour en vue mois → semaine de ce jour
      calState.anchor = parseYmd(cell.dataset.date);
      calState.mode = 'week';
      renderCalendarModal();
    }
  });

  return dialog;
}

/** Ouvre la modale (semaine par défaut, ancrée sur aujourd'hui à la 1re ouverture). */
function openCalendarModal() {
  const dialog = ensureCalendarModal();
  if (!calState.anchor) calState.anchor = startOfDay(new Date());
  dialog.showModal();
  renderCalendarModal();
}

/** (Re)calcule la plage visible, fetch les événements, rend semaine ou mois. */
async function renderCalendarModal() {
  const body    = document.getElementById('cal-modal-body');
  const titleEl = document.getElementById('cal-modal-title');
  if (!body) return;

  // Onglet actif
  document.querySelectorAll('#cal-dialog .cal-mode')
    .forEach(b => b.classList.toggle('active', b.dataset.mode === calState.mode));

  // Plage à charger selon le mode.
  let from, to;
  if (calState.mode === 'week') {
    from = startOfWeek(calState.anchor);
    to   = addDays(from, 7);
    titleEl.textContent = weekTitle(from);
  } else {
    const first = new Date(calState.anchor.getFullYear(), calState.anchor.getMonth(), 1);
    from = startOfWeek(first);
    to   = addDays(from, 42);
    titleEl.textContent = monthTitle(calState.anchor);
  }

  // "Aujourd'hui" : grisé tant que la période visible contient déjà aujourd'hui.
  const todayBtn = document.querySelector('#cal-dialog .cal-today');
  if (todayBtn) {
    const today = startOfDay(new Date());
    todayBtn.disabled = (today >= from && today < to);
  }

  body.innerHTML = '<p class="muted">Chargement…</p>';
  try {
    const res = await getCalendarRange(ymd(from), ymd(to));
    if (!Array.isArray(res?.calendars) || res.calendars.length === 0) {
      body.innerHTML = configGuidanceHtml();
      return;
    }
    if (calState.mode === 'week') {
      body.innerHTML = renderWeek(res, from);
      scrollTimelineToNow(body);
    } else {
      body.innerHTML = renderMonth(res, calState.anchor, from);
    }
  } catch (err) {
    body.innerHTML = `<p class="error">Agenda indisponible : ${escapeHtml(err.message)}</p>`;
  }
}

/** "9 juin – 15 juin 2026". */
function weekTitle(weekStart) {
  const end = addDays(weekStart, 6);
  return `${weekStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} – `
       + `${end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** "Juin 2026". */
function monthTitle(anchor) {
  const s = anchor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Vue semaine : en-tête jours + ligne journée entière + 7 colonnes timeline. */
function renderWeek(res, weekStart) {
  const events  = Array.isArray(res?.data) ? res.data : [];
  const days    = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayKey = ymd(startOfDay(new Date()));

  let head = '<div class="cal-week-head"><div class="cal-corner"></div>';
  days.forEach((d, i) => {
    const isToday = ymd(d) === todayKey;
    head += `<div class="cal-wday${isToday ? ' today' : ''}">`
          + `<span class="cal-wday-name">${WEEKDAYS_SHORT[i]}</span> `
          + `<span class="cal-wday-num">${d.getDate()}</span></div>`;
  });
  head += '</div>';

  let allday = '<div class="cal-week-allday"><div class="cal-corner">jour.</div>';
  days.forEach(d => { allday += `<div class="cal-wad-cell">${allDayChipsHtml(events, d)}</div>`; });
  allday += '</div>';

  let cols = '';
  days.forEach(d => { cols += `<div class="cal-wcol">${dayColumnHtml(events, d)}</div>`; });

  const grid = `<div class="cal-timeline" style="--ph:${PX_PER_HOUR}px">`
             + `<div class="cal-week-grid">${hourGutterHtml()}${cols}</div></div>`;

  // En-tête + journée entière + timeline regroupés dans un conteneur scrollable
  // horizontalement : sur petit écran, la semaine défile au lieu de s'écraser.
  const week = `<div class="cal-week"><div class="cal-week-inner">${head}${allday}${grid}</div></div>`;
  return legendHtml(res.calendars) + errorsHtml(res.errors || []) + week;
}

/** Vue mois : 6×7 cellules, chips d'événements (max 3 + "+N"), jour cliquable. */
function renderMonth(res, anchor, gridStart) {
  const events   = Array.isArray(res?.data) ? res.data : [];
  const month    = anchor.getMonth();
  const todayKey = ymd(startOfDay(new Date()));

  let html = legendHtml(res.calendars) + errorsHtml(res.errors || []);
  html += '<div class="cal-month-head">' + WEEKDAYS_SHORT.map(w => `<div>${w}</div>`).join('') + '</div>';
  html += '<div class="cal-month-grid">';

  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const out     = d.getMonth() !== month;
    const isToday = ymd(d) === todayKey;
    const dayEvents = events.filter(e => occursOnDay(e, d)).sort((a, b) => evStart(a) - evStart(b));

    let chips = '';
    dayEvents.slice(0, 3).forEach(e => {
      const t = e.all_day ? '' : `${formatTime(e.start)} `;
      chips += `<span class="cal-mc-ev" style="border-left-color:${escapeAttr(e.color)}" `
             + `title="${escapeAttr(e.calendar)}">${escapeHtml(t + e.title)}</span>`;
    });
    if (dayEvents.length > 3) chips += `<span class="cal-mc-more">+${dayEvents.length - 3}</span>`;

    html += `<div class="cal-mc${out ? ' out' : ''}${isToday ? ' today' : ''}" data-date="${ymd(d)}">`
          + `<span class="cal-mc-num">${d.getDate()}</span>${chips}</div>`;
  }
  html += '</div>';
  return html;
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
    result.innerHTML = renderMenu(data);
  } catch (_) {
    result.innerHTML = ''; // chargement silencieux : pas d'erreur bloquante à l'arrivée
  }
}

/** Câble (par délégation) les boutons "J'ai cuisiné" de la carte Menu. */
function initMenuInteractions() {
  const container = document.getElementById('menu-result');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    // Clic sur le nom du plat → ouvre la recette (modale).
    const recipeBtn = e.target.closest('.meal-recipe');
    if (recipeBtn) { openRecipeModal(Number(recipeBtn.dataset.id)); return; }

    // Clic sur ✕ → retire le repas du plan (manuel).
    const delBtn = e.target.closest('.meal-del');
    if (delBtn) {
      delBtn.disabled = true;
      try {
        await deleteMeal(Number(delBtn.dataset.id));
        await loadCurrentMenu();
        loadTodaySummary(); // rafraîchit le Dashboard si la carte y est affichée (no-op sinon)
      } catch (err) {
        console.error('Suppression de repas échouée :', err.message);
        delBtn.disabled = false;
      }
      return;
    }

    const btn = e.target.closest('.meal-cook');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const target = !btn.classList.contains('on'); // état cuisiné visé
    btn.disabled = true;
    try {
      const res = await cookMeal(id, target);
      await loadCurrentMenu(); // re-rend pour refléter l'état (et l'historique côté backend)
      if (target) {
        await loadPantry();    // le stock a été décrémenté → on rafraîchit la carte placards
        showCookNotif(res?.data?.consumed ?? []);
      }
    } catch (err) {
      console.error('Bascule "cuisiné" échouée :', err.message);
      btn.disabled = false;
    }
  });
}

/** Affiche un résumé du décompte de stock après "j'ai cuisiné" (carte Menu). */
function showCookNotif(consumed) {
  const result = document.getElementById('menu-result');
  if (!result) return;

  const parts = (Array.isArray(consumed) ? consumed : [])
    .filter(c => c.action && c.action !== 'kept')
    .map(c => {
      if (c.action === 'updated') return `${c.ingredient} ${c.from} → ${c.to}`;
      if (c.action === 'zeroed')  return `${c.ingredient} épuisé`;
      return `${c.ingredient} retiré`; // 'removed'
    });

  const msg = parts.length
    ? `🧺 Placard mis à jour : ${parts.join(' · ')}`
    : '🧺 Aucun ingrédient décompté (plat sans ingrédients enregistrés, ou absent du placard).';

  result.insertAdjacentHTML('afterbegin', `<p class="menu-notif">${escapeHtml(msg)}</p>`);
}

// ---------------------------------------------------------------------------
//  Recette d'un plat — modale (génération IA à la demande + cache)
// ---------------------------------------------------------------------------

let recipeCurrentId = null; // repas dont la recette est affichée dans la modale

/** Crée la modale recette une fois (et câble fermeture + bouton "Générer"). */
function ensureRecipeModal() {
  let dialog = document.getElementById('recipe-dialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'recipe-dialog';
  dialog.className = 'app-dialog recipe-modal';
  dialog.innerHTML = `
    <div class="recipe-head">
      <h2 class="recipe-title" id="recipe-title">Recette</h2>
      <button type="button" class="btn-ghost recipe-close" aria-label="Fermer">✕</button>
    </div>
    <div class="recipe-body" id="recipe-body"></div>`;
  document.body.appendChild(dialog);

  dialog.querySelector('.recipe-close').addEventListener('click', () => dialog.close());

  // Bouton "Générer la recette" (présent quand la recette n'existe pas encore).
  dialog.addEventListener('click', async (e) => {
    const gen = e.target.closest('.recipe-generate');
    if (!gen || recipeCurrentId == null) return;
    gen.disabled = true;
    gen.textContent = '⏳ Génération…';
    const errEl = document.getElementById('recipe-error');
    if (errEl) errEl.hidden = true;
    try {
      const { data } = await generateRecipe(recipeCurrentId);
      renderRecipeInto(data);
    } catch (err) {
      if (errEl) { errEl.textContent = `❌ ${err.message}`; errEl.hidden = false; }
      gen.disabled = false;
      gen.textContent = '✨ Générer la recette';
    }
  });

  return dialog;
}

/** Ouvre la modale et charge la recette (ou propose de la générer). */
async function openRecipeModal(id) {
  recipeCurrentId = id;
  const dialog = ensureRecipeModal();
  document.getElementById('recipe-title').textContent = 'Recette';
  document.getElementById('recipe-body').innerHTML = '<p class="muted">Chargement…</p>';
  dialog.showModal();

  try {
    const { data } = await getRecipe(id);
    renderRecipeInto(data);
  } catch (err) {
    document.getElementById('recipe-body').innerHTML =
      `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

/** Injecte le contenu (titre + corps) dans la modale. */
function renderRecipeInto(data) {
  const title = document.getElementById('recipe-title');
  const body  = document.getElementById('recipe-body');
  if (!data) { body.innerHTML = '<p class="error">Plat introuvable.</p>'; return; }
  title.textContent = data.plat || 'Recette';
  body.innerHTML = renderRecipe(data);
}

/** Construit le HTML d'une recette (ingrédients + étapes), ou l'invite à générer. */
function renderRecipe(data) {
  const r = data.recipe;

  // Ingrédients : ceux de la recette si dispo, sinon ceux du plan (meal_ingredients).
  const ings = (r && Array.isArray(r.ingredients) && r.ingredients.length)
    ? r.ingredients.map(i => ({ nom: i.ingredient, q: i.quantite }))
    : (data.ingredients || []).map(i => ({ nom: i.ingredient, q: i.quantity }));

  let html = '';

  // Méta (portions / temps / difficulté) si recette présente.
  if (r) {
    const meta = [];
    if (r.portions)          meta.push(`🍽️ ${r.portions}`);
    if (r.temps_preparation) meta.push(`🔪 ${r.temps_preparation}`);
    if (r.temps_cuisson)     meta.push(`🔥 ${r.temps_cuisson}`);
    if (r.difficulte)        meta.push(`📊 ${r.difficulte}`);
    if (meta.length) html += `<p class="recipe-meta">${escapeHtml(meta.join(' · '))}</p>`;
  }

  if (ings.length) {
    html += '<h3 class="recipe-sub">Ingrédients</h3><ul class="recipe-ings">';
    ings.forEach(i => {
      html += `<li>${escapeHtml(i.nom)}${i.q ? ` <span class="qty">${escapeHtml(i.q)}</span>` : ''}</li>`;
    });
    html += '</ul>';
  }

  if (!r) {
    html += '<p class="muted recipe-empty">Recette pas encore générée pour ce plat.</p>';
    html += '<p class="dialog-error" id="recipe-error" hidden></p>';
    html += '<button type="button" class="btn-primary recipe-generate">✨ Générer la recette</button>';
    return html;
  }

  if (Array.isArray(r.etapes) && r.etapes.length) {
    html += '<h3 class="recipe-sub">Préparation</h3><ol class="recipe-steps">';
    r.etapes.forEach(s => { html += `<li>${escapeHtml(String(s))}</li>`; });
    html += '</ol>';
  }

  return html;
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
    // On recharge le plan PERSISTANT (avec ids + état "cuisiné") plutôt que la
    // réponse brute de l'IA → les boutons "J'ai cuisiné" sont opérationnels d'emblée.
    await loadCurrentMenu();
    // La génération a aussi mis à jour la liste de courses en base :
    // on rafraîchit sa carte pour voir les ingrédients déduits sans recharger la page.
    await loadShoppingList();
    const nb = response.data?.articles_ajoutes ?? 0;
    result.insertAdjacentHTML('afterbegin',
      `<p class="menu-notif">🛒 Liste de courses mise à jour : <strong>${nb}</strong> article(s) ajouté(s).</p>`);
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
 * Chaque repas porte un bouton "J'ai cuisiné" (s'il vient du plan persistant,
 * donc avec un id). Les données de génération brute (plats en chaînes) restent
 * tolérées mais sans bouton.
 * @param {Object} data { menu: { semaine } }
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
    // En semaine on n'attend que le soir, mais un midi ajouté manuellement
    // doit rester visible (sinon il serait enregistré mais invisible).
    const hasMidi = !!j.repas?.midi;
    if (hasMidi) html += mealRow(`${j.jour} midi`, j.repas.midi);
    html += mealRow(hasMidi ? `${j.jour} soir` : j.jour, j.repas?.soir);
  });
  html += '</ul></div>';

  // --- Week-end (midi + soir) ---
  html += '<div class="menu-block"><h3 class="menu-title">🥐 Week-end</h3><ul class="menu-list">';
  weekend.forEach(j => {
    if (j.repas?.midi) html += mealRow(`${j.jour} midi`, j.repas.midi);
    if (j.repas?.soir) html += mealRow(`${j.jour} soir`, j.repas.soir);
  });
  html += '</ul></div>';

  return html;
}

/** Normalise un repas (objet {id,nom,cooked} OU chaîne brute) en objet, ou null. */
function normalizeMeal(meal) {
  if (meal == null) return null;
  if (typeof meal === 'object') {
    const nom = String(meal.nom ?? '').trim();
    return nom ? { id: meal.id ?? null, nom, cooked: !!meal.cooked } : null;
  }
  const nom = String(meal).trim();
  return nom ? { id: null, nom, cooked: false } : null;
}

/** Une ligne de repas : libellé du jour + plat + bouton "J'ai cuisiné". */
function mealRow(label, meal) {
  const m = normalizeMeal(meal);
  if (!m) {
    return `<li class="menu-item"><span class="menu-day">${escapeHtml(label)}</span>`
         + `<span class="menu-meal">—</span></li>`;
  }
  const cookedCls = m.cooked ? ' cooked' : '';
  const btn = (m.id != null)
    ? `<button type="button" class="meal-cook${m.cooked ? ' on' : ''}" data-id="${m.id}" `
      + `title="${m.cooked ? 'Cuisiné — cliquer pour annuler' : 'Marquer comme cuisiné (archive l\'historique)'}" `
      + `aria-label="J'ai cuisiné ce plat">${m.cooked ? '✓ Cuisiné' : "J'ai cuisiné"}</button>`
    : '';
  // Le nom du plat est cliquable (ouvre la recette) dès qu'on a un id.
  const mealHtml = (m.id != null)
    ? `<button type="button" class="menu-meal meal-recipe" data-id="${m.id}" `
      + `title="Voir la recette">${escapeHtml(m.nom)}</button>`
    : `<span class="menu-meal">${escapeHtml(m.nom)}</span>`;
  // Retrait manuel du repas (✕).
  const del = (m.id != null)
    ? `<button type="button" class="meal-del" data-id="${m.id}" `
      + `title="Retirer ce repas" aria-label="Retirer ce repas">✕</button>`
    : '';
  return `<li class="menu-item${cookedCls}"><span class="menu-day">${escapeHtml(label)}</span>`
       + `${mealHtml}${btn}${del}</li>`;
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
//  Ajout / modification manuelle d'un repas — modale (sans IA)
// ---------------------------------------------------------------------------

const MEAL_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** Crée (une fois) la modale d'ajout de repas et câble ses interactions. */
function ensureMealDialog() {
  let dialog = document.getElementById('meal-dialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'meal-dialog';
  dialog.className = 'app-dialog';
  const dayOpts = MEAL_DAYS.map(d => `<option value="${d}">${d}</option>`).join('');
  dialog.innerHTML = `
    <form id="meal-form" method="dialog">
      <h2 class="dialog-title">➕ Ajouter / modifier un repas</h2>
      <div class="meal-form-row">
        <label class="field">
          <span>Jour</span>
          <select name="jour" required>${dayOpts}</select>
        </label>
        <label class="field">
          <span>Moment</span>
          <select name="type" required>
            <option value="soir">Soir</option>
            <option value="midi">Midi</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span>Plat</span>
        <input type="text" name="nom" maxlength="200" required
               placeholder="ex : Raclette" autocomplete="off">
      </label>
      <p class="dialog-hint">Un plat existant pour ce créneau sera remplacé.</p>
      <p class="dialog-error" id="meal-error" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" id="meal-cancel">Annuler</button>
        <button type="submit" class="btn-primary" id="meal-save">Ajouter</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);

  dialog.querySelector('#meal-cancel').addEventListener('click', () => dialog.close());

  dialog.querySelector('#meal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form    = e.target;
    const saveBtn = form.querySelector('#meal-save');
    const errorEl = form.querySelector('#meal-error');
    const nom     = form.nom.value.trim();
    if (!nom) return;

    errorEl.hidden = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Ajout…';
    try {
      await addMeal(form.jour.value, form.type.value, nom);
      dialog.close();
      await loadCurrentMenu();
      loadTodaySummary(); // rafraîchit le Dashboard si présent (no-op sinon)
    } catch (err) {
      errorEl.textContent = `Échec : ${err.message}`;
      errorEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Ajouter';
    }
  });

  return dialog;
}

/** Ouvre la modale d'ajout, éventuellement pré-remplie (jour/moment/nom). */
function openMealDialog(prefill = {}) {
  const dialog = ensureMealDialog();
  const form   = dialog.querySelector('#meal-form');
  form.jour.value = MEAL_DAYS.includes(prefill.jour) ? prefill.jour : MEAL_DAYS[0];
  form.type.value = prefill.type === 'midi' ? 'midi' : 'soir';
  form.nom.value  = prefill.nom ?? '';
  document.getElementById('meal-error').hidden = true;
  dialog.showModal();
  form.nom.focus();
}

// ===========================================================================
//  Module FINANCES — dépenses & revenus (saisie manuelle, graphiques Chart.js)
// ===========================================================================

const financeState = {
  month: null, // "AAAA-MM" affiché
  meta:  null, // { categories:{depense:[],revenu:[]}, types:[], qui:[] } (cache)
  chart: null, // instance Chart.js du donut (à détruire avant re-render)
};

const QUI_LABELS = { moi: 'Moi', partenaire: 'Partenaire', commun: 'Commun' };

// Palette du donut (lisible sur fond sombre).
const FIN_COLORS = ['#6c8cff', '#51d88a', '#f3a23e', '#f3667e', '#9d7bff',
                    '#3ec9d6', '#e6cf5a', '#ef8bbd', '#7a8aa0'];

const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmtEUR = (n) => eurFmt.format(Number(n) || 0);

/** "AAAA-MM" du mois courant (heure locale). */
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** "2026-06" → "juin 2026". */
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/** Décale un mois "AAAA-MM" de ±n mois. */
function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** Charge (une seule fois) Chart.js vendu en local. Résout vers window.Chart. */
let chartJsPromise = null;
function ensureChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (chartJsPromise) return chartJsPromise;
  chartJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/chart.umd.min.js';
    s.onload  = () => resolve(window.Chart);
    s.onerror = () => reject(new Error('Chart.js introuvable (assets/vendor/chart.umd.min.js)'));
    document.head.appendChild(s);
  });
  return chartJsPromise;
}

/** Point d'entrée de la vue Finances : charge les métadonnées puis rend les cartes. */
async function initFinancesView() {
  financeState.month = financeState.month || currentMonthKey();

  if (!financeState.meta) {
    try {
      const { data } = await getFinanceCategories();
      financeState.meta = data;
    } catch (_) {
      financeState.meta = {
        categories: { depense: ['Autre'], revenu: ['Autre'] },
        types: ['depense', 'revenu'],
        qui: ['moi', 'partenaire', 'commun'],
      };
    }
  }

  renderFinanceAddForm();
  initFinanceInteractions();
  loadFinanceMonth(); // summary → carte "Ce mois-ci" + donut
  loadFinanceList();  // transactions du mois
}

/** Construit le formulaire de saisie rapide (dépend des catégories chargées). */
function renderFinanceAddForm() {
  const host = document.getElementById('fin-add');
  if (!host || !financeState.meta) return;

  const meta    = financeState.meta;
  const today   = ymd(startOfDay(new Date()));
  const catOpts = (type) => (meta.categories[type] || [])
    .map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  const quiOpts = (meta.qui || []).map(q =>
    `<option value="${escapeAttr(q)}"${q === 'commun' ? ' selected' : ''}>${escapeHtml(QUI_LABELS[q] || q)}</option>`).join('');

  host.innerHTML = `
    <form id="fin-add-form" class="fin-form">
      <div class="fin-form-grid">
        <label class="field fin-amount"><span>Montant (€)</span>
          <input type="text" name="montant" inputmode="decimal" placeholder="0,00"
                 autocomplete="off" required>
        </label>
        <label class="field"><span>Type</span>
          <select name="type">
            <option value="depense" selected>Dépense</option>
            <option value="revenu">Revenu</option>
          </select>
        </label>
        <label class="field"><span>Date</span>
          <input type="date" name="date" value="${today}" required>
        </label>
        <label class="field"><span>Qui</span>
          <select name="qui">${quiOpts}</select>
        </label>
        <label class="field"><span>Catégorie</span>
          <select name="categorie">${catOpts('depense')}</select>
        </label>
        <label class="field fin-wide"><span>Libellé <em>(optionnel)</em></span>
          <input type="text" name="libelle" maxlength="200" placeholder="ex : Carrefour"
                 autocomplete="off">
        </label>
      </div>
      <p class="dialog-error" id="fin-add-error" hidden></p>
      <button type="submit" class="btn-primary fin-add-btn" id="fin-add-btn">Ajouter la transaction</button>
    </form>`;
}

/** Recharge les options de catégorie selon le type sélectionné (dépense/revenu). */
function refreshCategoryOptions(type) {
  const sel = document.querySelector('#fin-add-form select[name="categorie"]');
  if (!sel || !financeState.meta) return;
  const cats = financeState.meta.categories[type] || [];
  sel.innerHTML = cats.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
}

/** Câble les interactions des cartes Finances (délégation par conteneur stable). */
function initFinanceInteractions() {
  const addHost = document.getElementById('fin-add');
  if (addHost) {
    addHost.addEventListener('submit', handleFinanceAdd);
    addHost.addEventListener('change', (e) => {
      const typeSel = e.target.closest('select[name="type"]');
      if (typeSel) refreshCategoryOptions(typeSel.value);
    });
  }

  const monthHost = document.getElementById('fin-month');
  if (monthHost) {
    monthHost.addEventListener('click', (e) => {
      const prev = e.target.closest('.fin-prev');
      const next = e.target.closest('.fin-next');
      if (!prev && !next) return;
      financeState.month = shiftMonth(financeState.month, prev ? -1 : 1);
      loadFinanceMonth();
      loadFinanceList();
    });
  }

  const listHost = document.getElementById('fin-list');
  if (listHost) {
    listHost.addEventListener('click', async (e) => {
      const del = e.target.closest('.fin-del');
      if (!del) return;
      del.disabled = true;
      try {
        await deleteTransaction(Number(del.dataset.id));
        loadFinanceMonth();
        loadFinanceList();
      } catch (err) {
        console.error('Suppression transaction échouée :', err.message);
        del.disabled = false;
      }
    });
  }
}

/** Soumission du formulaire de saisie. */
async function handleFinanceAdd(e) {
  e.preventDefault();
  const form = e.target.closest('#fin-add-form');
  if (!form) return;
  const btn   = form.querySelector('#fin-add-btn');
  const errEl = form.querySelector('#fin-add-error');
  const els   = form.elements;

  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Ajout…';
  try {
    await addTransaction({
      type:      els.type.value,
      montant:   els.montant.value,
      date:      els.date.value,
      categorie: els.categorie.value,
      qui:       els.qui.value,
      libelle:   els.libelle.value.trim(),
    });
    // On bascule sur le mois de la saisie pour que l'ajout soit visible.
    financeState.month = els.date.value.slice(0, 7);
    // Saisie en série : on vide montant + libellé, on garde type/date/qui.
    els.montant.value = '';
    els.libelle.value = '';
    loadFinanceMonth();
    loadFinanceList();
    els.montant.focus();
  } catch (err) {
    errEl.textContent = `Échec : ${err.message}`;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ajouter';
  }
}

/** Charge le résumé du mois → carte "Ce mois-ci" + donut de répartition. */
async function loadFinanceMonth() {
  const host = document.getElementById('fin-month');
  if (!host) return;
  try {
    const { data } = await getFinanceSummary(financeState.month);
    host.innerHTML = renderFinanceMonth(data);
    renderFinanceChart(data); // alimente la carte "Répartition"
  } catch (err) {
    host.innerHTML = `<p class="error">Indisponible : ${escapeHtml(err.message)}</p>`;
  }
}

/** Carte "Ce mois-ci" : navigation + solde + totaux + dépenses par personne. */
function renderFinanceMonth(data) {
  const t = data.totaux;
  const soldeCls = t.solde >= 0 ? 'pos' : 'neg';
  const qui = (data.par_qui || []).filter(q => q.depenses > 0 || q.revenus > 0);
  const quiHtml = qui.length
    ? `<h4 class="fin-sub">Dépenses par personne</h4><ul class="fin-qui">`
      + qui.map(q => `<li><span>${escapeHtml(QUI_LABELS[q.qui] || q.qui)}</span>`
        + `<strong>${fmtEUR(q.depenses)}</strong></li>`).join('')
      + `</ul>`
    : '';

  return `
    <div class="fin-monthnav">
      <button type="button" class="btn-ghost fin-prev" aria-label="Mois précédent">‹</button>
      <span class="fin-month-label">${escapeHtml(monthLabel(data.month))}</span>
      <button type="button" class="btn-ghost fin-next" aria-label="Mois suivant">›</button>
    </div>
    <p class="fin-solde-lbl">Solde du mois</p>
    <div class="fin-solde ${soldeCls}">${fmtEUR(t.solde)}</div>
    <div class="fin-totaux">
      <span class="fin-dep">Dépenses<br><strong>${fmtEUR(t.depenses)}</strong></span>
      <span class="fin-rev">Revenus<br><strong>${fmtEUR(t.revenus)}</strong></span>
    </div>
    ${quiHtml}`;
}

/** Donut Chart.js des dépenses par catégorie dans la carte "Répartition". */
async function renderFinanceChart(summary) {
  const host = document.getElementById('fin-cats');
  if (!host) return;

  if (financeState.chart) { financeState.chart.destroy(); financeState.chart = null; }

  const cats = summary.par_categorie || [];
  if (!cats.length) {
    host.innerHTML = '<p class="muted">Aucune dépense ce mois-ci.</p>';
    return;
  }

  host.innerHTML = '<div class="fin-chart-wrap"><canvas id="fin-donut"></canvas></div>';
  try {
    const Chart  = await ensureChartJs();
    const canvas = document.getElementById('fin-donut');
    if (!canvas) return; // l'utilisateur a pu changer de vue entre-temps
    financeState.chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: cats.map(c => c.categorie),
        datasets: [{ data: cats.map(c => c.montant), backgroundColor: FIN_COLORS, borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#e4e7ef', boxWidth: 12, padding: 10 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label} : ${fmtEUR(ctx.parsed)}` } },
        },
      },
    });
  } catch (err) {
    host.innerHTML = `<p class="error">Graphique indisponible : ${escapeHtml(err.message)}</p>`;
  }
}

/** Charge et affiche la liste des transactions du mois. */
async function loadFinanceList() {
  const host = document.getElementById('fin-list');
  if (!host) return;
  try {
    const { data } = await getTransactions({ month: financeState.month });
    host.innerHTML = renderFinanceList(data ?? []);
  } catch (err) {
    host.innerHTML = `<p class="error">Liste indisponible : ${escapeHtml(err.message)}</p>`;
  }
}

/** Liste interactive (suppression par ✕). */
function renderFinanceList(items) {
  if (!items.length) return '<p class="muted">Aucune transaction ce mois-ci.</p>';
  const rows = items.map(t => {
    const sign = t.type === 'revenu' ? '+' : '−';
    const cls  = t.type === 'revenu' ? 'revenu' : 'depense';
    const d    = parseYmd(t.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const lib  = t.libelle ? escapeHtml(t.libelle) : escapeHtml(t.categorie);
    return `<li class="fin-row">`
      + `<span class="fin-date">${d}</span>`
      + `<span class="fin-lib">${lib}`
      + `<span class="fin-tags">${escapeHtml(t.categorie)} · ${escapeHtml(QUI_LABELS[t.qui] || t.qui)}</span></span>`
      + `<span class="fin-amt ${cls}">${sign} ${fmtEUR(t.montant)}</span>`
      + `<button type="button" class="fin-del" data-id="${t.id}" `
      + `title="Supprimer" aria-label="Supprimer">✕</button>`
      + `</li>`;
  }).join('');
  return `<ul class="fin-list">${rows}</ul>`;
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
