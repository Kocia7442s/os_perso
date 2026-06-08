// =========================================================
//  <bento-card> — Custom Element Vanilla (Web Component natif)
//
//  Usage :
//    <bento-card title="Liste de courses" icon="🛒" span="2">
//        ... contenu HTML libre (projeté dans le <slot>) ...
//    </bento-card>
//
//  Attributs :
//    - title : titre affiché dans l'en-tête
//    - icon  : emoji / glyphe affiché à gauche du titre
//    - span  : nombre de colonnes occupées dans la grille Bento (défaut 1)
// =========================================================

class BentoCard extends HTMLElement {

  // Attributs "observés" : si l'un change, attributeChangedCallback se déclenche.
  static get observedAttributes() {
    return ['title', 'icon', 'span'];
  }

  constructor() {
    super();
    // Shadow DOM : encapsule le style de la carte (pas de fuite vers le reste).
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    // On ne re-rend que si l'élément est déjà dans le DOM.
    if (this.isConnected) this._render();
  }

  _render() {
    const title = this.getAttribute('title') || '';
    const icon  = this.getAttribute('icon')  || '';
    const span  = parseInt(this.getAttribute('span'), 10);

    // L'attribut "span" agit sur l'élément hôte (sa place dans la grille).
    this.style.gridColumn = span > 1 ? `span ${span}` : '';

    // NB : title/icon sont fournis par l'auteur du dashboard (pas par un
    // utilisateur final), donc l'injection directe est acceptable ici.
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          height: 100%;
          background: var(--card-bg, #1b1f2a);
          border: 1px solid var(--card-border, #262b38);
          border-radius: var(--radius, 14px);
          padding: 18px 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          box-sizing: border-box;
          transition: border-color 0.15s, transform 0.15s;
        }
        .card:hover { border-color: var(--accent, #6c8cff); transform: translateY(-2px); }
        header { display: flex; align-items: center; gap: 10px; }
        .icon { font-size: 1.2rem; line-height: 1; }
        h2 {
          margin: 0;
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--text, #e4e7ef);
          letter-spacing: 0.2px;
        }
        .body {
          flex: 1;
          color: var(--text-muted, #8b93a7);
          font-size: 0.9rem;
        }
      </style>
      <article class="card">
        <header>
          ${icon ? `<span class="icon">${icon}</span>` : ''}
          <h2>${title}</h2>
        </header>
        <div class="body"><slot></slot></div>
      </article>
    `;
  }
}

// On enregistre le tag <bento-card> auprès du navigateur.
customElements.define('bento-card', BentoCard);
