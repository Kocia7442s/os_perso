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
         getPantry, addPantryItem, updatePantryItem, deletePantryItem,
         getPreferences, savePreferences,
         getCalendarEvents, getCalendarRange } from './api.js';   // couche réseau

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
  // …la liste de courses, avec ses interactions.
  loadShoppingList();
  initShoppingInteractions();
  // …et les placards.
  loadPantry();
  initPantryInteractions();
  // …et l'agenda commun (calendriers Apple publiés).
  loadCalendar();
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
      const qty  = item.quantite
        ? `<span class="qty">${escapeHtml(item.quantite)}</span>` : '';
      html += `<li class="${cls}" data-id="${item.id}">`
            + `<button type="button" class="shopping-toggle" aria-label="Cocher / décocher">`
            + `<span class="mark">${mark}</span>`
            + `<span class="label">${escapeHtml(item.nom)}</span>`
            + qty
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
      <input type="text" name="quantite" placeholder="Qté" maxlength="50" class="qty-input">
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
    const nom      = e.target.nom.value.trim();
    const quantite = e.target.quantite.value.trim();
    if (!nom) return;
    try {
      await addShoppingItem(nom, quantite);
      await loadShoppingList();
      // Re-focus sur le champ recréé, pour enchaîner les ajouts.
      const input = container.querySelector('.shopping-add input');
      if (input) input.focus();
    } catch (err) {
      console.error('Ajout article échoué :', err.message);
    }
  });
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

  return legendHtml(res.calendars) + errorsHtml(res.errors || []) + head + allday + grid;
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
    // La génération a aussi mis à jour la liste de courses en base :
    // on rafraîchit sa carte pour voir les ingrédients déduits sans recharger la page.
    await loadShoppingList();
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
