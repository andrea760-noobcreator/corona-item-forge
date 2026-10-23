const MODULE_ID = "corona-item-forge";

const ITEM_TYPES = { wondrous: "Oggetto meraviglioso", ring: "Anello", rod: "Verga", wand: "Bacchetta", trinket: "Ninnolo" };
const RARITIES = { "": "Mundano", common: "Comune", uncommon: "Non comune", rare: "Raro", veryRare: "Molto raro", legendary: "Leggendario", artifact: "Artefatto" };
const RECOVERY = { none: "Nessuna ricarica", dawn: "All'alba", dusk: "Al tramonto", lr: "Riposo lungo" };
const ABILITIES = { str: "FOR", dex: "DES", con: "COS", int: "INT", wis: "SAG", cha: "CAR" };
const CONDITIONS = {
  blinded: "Accecato", charmed: "Affascinato", deafened: "Assordato", frightened: "Spaventato",
  paralyzed: "Paralizzato", petrified: "Pietrificato", poisoned: "Avvelenato", stunned: "Stordito", unconscious: "Privo di sensi"
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(v)}</option>`).join("");

/* ---------- Costruzione dei dati dell'oggetto ---------- */

function buildDescription({ flavor, properties, secret }) {
  const parts = [];
  for (const p of flavor.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)) {
    parts.push(`<p>${esc(p).replaceAll("\n", "<br>")}</p>`);
  }
  for (const line of properties.split("\n").map((x) => x.trim()).filter(Boolean)) {
    const idx = line.indexOf(". ");
    if (idx > 0 && idx < 60) parts.push(`<p><strong><em>${esc(line.slice(0, idx))}.</em></strong> ${esc(line.slice(idx + 2))}</p>`);
    else parts.push(`<p>${esc(line)}</p>`);
  }
  if (secret.trim()) parts.push(`<section class="secret"><p>${esc(secret.trim()).replaceAll("\n", "<br>")}</p></section>`);
  return parts.join("\n");
}

function buildItemData(v, spells) {
  const ADD = CONST.ACTIVE_EFFECT_MODES?.ADD ?? 2;
  const charges = Math.max(0, Number(v.charges) || 0);
  const dc = Number(v.dc) || 0;

  const activities = {};
  spells.forEach((s, i) => {
    const id = foundry.utils.randomID(16);
    const cost = Math.max(0, Number(s.cost) || 0);
    activities[id] = {
      _id: id,
      type: "cast",
      name: s.name,
      sort: (i + 1) * 100000,
      activation: { type: "action", value: null, override: false },
      consumption: {
        targets: charges > 0 && cost > 0 ? [{ type: "itemUses", target: "", value: String(cost), scaling: {} }] : [],
        scaling: { allowed: false },
        spellSlot: false
      },
      spell: { uuid: s.uuid, ability: "", challenge: { attack: null, save: dc > 0 ? dc : null, override: dc > 0 }, level: null, properties: [] }
    };
  });

  const changes = [];
  for (const [k, val] of Object.entries(v.abilities)) {
    if (val) changes.push({ key: `system.abilities.${k}.value`, mode: ADD, value: String(val) });
  }
  for (const c of v.immunities) changes.push({ key: "system.traits.ci.value", mode: ADD, value: c });

  const effects = changes.length
    ? [{ name: "Benefici dell'oggetto", img: "icons/svg/aura.svg", transfer: true, disabled: false, changes }]
    : [];

  return {
    name: v.name.trim(),
    type: "equipment",
    img: "icons/svg/item-bag.svg",
    system: {
      description: { value: buildDescription(v) },
      type: { value: v.itemType },
      rarity: v.rarity,
      attunement: v.attune ? "required" : "",
      properties: ["mgc"],
      quantity: 1,
      uses: {
        max: charges > 0 ? String(charges) : "",
        spent: 0,
        recovery: charges > 0 && v.recovery !== "none" ? [{ period: v.recovery, type: "recoverAll" }] : []
      },
      activities
    },
    effects
  };
}

/* ---------- Ricerca incantesimi (mondo + compendi, inclusi quelli importati da Plutonium) ---------- */

async function findSpells(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  for (const i of game.items) {
    if (i.type === "spell" && i.name.toLowerCase().includes(q)) out.push({ uuid: i.uuid, name: i.name, img: i.img, level: i.system?.level });
  }
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    const index = await pack.getIndex({ fields: ["system.level"] });
    for (const e of index) {
      if (e.type === "spell" && e.name.toLowerCase().includes(q)) out.push({ uuid: e.uuid, name: e.name, img: e.img, level: e.system?.level });
    }
    if (out.length >= 30) break;
  }
  return out.slice(0, 30);
}

/* ---------- Finestra ---------- */

class ItemForgeApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "corona-item-forge-app",
    classes: ["corona-item-forge"],
    window: { title: "Corona Item Forge", icon: "fa-solid fa-hammer", resizable: true },
    position: { width: 600, height: 760 }
  };

  #spells = [];
  #results = [];

  async _renderHTML() {
    return `
      <fieldset>
        <legend>Oggetto</legend>
        <div class="if-row"><label>Nome</label><input type="text" name="name" placeholder="Occhio del Sole"></div>
        <div class="if-row"><label>Tipo</label><select name="itemType">${opts(ITEM_TYPES, "wondrous")}</select></div>
        <div class="if-row"><label>Rarità</label><select name="rarity">${opts(RARITIES, "artifact")}</select></div>
        <div class="if-row"><label>Sintonia</label><input type="checkbox" name="attune" checked></div>
        <label>Descrizione (i paragrafi si separano con una riga vuota)</label>
        <textarea name="flavor"></textarea>
        <label>Proprietà (una per riga, nel formato "Nome. Testo")</label>
        <textarea name="properties" style="min-height:8rem"></textarea>
      </fieldset>

      <fieldset>
        <legend>Benefici con sintonia</legend>
        <div class="if-abilities">
          ${Object.entries(ABILITIES).map(([k, l]) => `<div>${l}<input type="number" name="ab-${k}" placeholder="+0"></div>`).join("")}
        </div>
        <div class="if-row" style="margin-top:0.4rem"><label>Immunità</label>
          <select name="immunities" multiple size="4">${opts(CONDITIONS, null)}</select></div>
        <div class="if-hint">Tieni premuto Ctrl per selezionare più condizioni. I benefici si attivano solo quando l'oggetto è in sintonia.</div>
      </fieldset>

      <fieldset>
        <legend>Cariche e incantesimi</legend>
        <div class="if-row"><label>Cariche massime</label><input type="number" name="charges" value="3" min="0"></div>
        <div class="if-row"><label>Ricarica</label><select name="recovery">${opts(RECOVERY, "none")}</select></div>
        <div class="if-row"><label>CD incantesimi</label><input type="number" name="dc" value="18" min="0"></div>
        <div class="if-drop">Trascina qui un incantesimo (dalla cartella Oggetti o da un compendio)</div>
        <div class="if-row"><input type="text" name="search" placeholder="Oppure cerca per nome (es. Sunburst)"><button type="button" data-action="search" style="flex:0 0 auto">Cerca</button></div>
        <div class="if-results"></div>
        <div class="if-spells"></div>
        <div class="if-hint">Il numero accanto a ogni incantesimo indica il costo in cariche.</div>
      </fieldset>

      <fieldset>
        <legend>Note segrete del GM</legend>
        <textarea name="secret" placeholder="Appunti visibili solo al GM, ad esempio il contatore delle emozioni registrate"></textarea>
      </fieldset>

      <button type="button" class="if-create" data-action="create"><i class="fa-solid fa-hammer"></i> Crea oggetto</button>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    this.#bind(content);
    this.#renderSpells(content);
  }

  #bind(root) {
    root.querySelector('[data-action="create"]').addEventListener("click", () => this.#create(root));
    root.querySelector('[data-action="search"]').addEventListener("click", () => this.#search(root));
    root.querySelector('[name="search"]').addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); this.#search(root); }
    });

    const drop = root.querySelector(".if-drop");
    drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("hover"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("hover"));
    drop.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      drop.classList.remove("hover");
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
      const data = TE.getDragEventData(ev);
      if (data?.type !== "Item" || !data.uuid) return ui.notifications.warn("Trascina un incantesimo.");
      const doc = await fromUuid(data.uuid);
      if (doc?.type !== "spell") return ui.notifications.warn("L'elemento trascinato non è un incantesimo.");
      this.#addSpell(root, { uuid: doc.uuid, name: doc.name, img: doc.img, level: doc.system?.level });
    });

    root.querySelector(".if-results").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-add]");
      if (btn) this.#addSpell(root, this.#results[Number(btn.dataset.add)]);
    });

    const list = root.querySelector(".if-spells");
    list.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-remove]");
      if (!btn) return;
      this.#spells.splice(Number(btn.dataset.remove), 1);
      this.#renderSpells(root);
    });
    list.addEventListener("change", (ev) => {
      const input = ev.target.closest("[data-cost]");
      if (input) this.#spells[Number(input.dataset.cost)].cost = Number(input.value) || 0;
    });
  }

  #addSpell(root, spell) {
    if (!spell) return;
    if (this.#spells.some((s) => s.uuid === spell.uuid)) return ui.notifications.info("Incantesimo già presente.");
    this.#spells.push({ ...spell, cost: 1 });
    this.#renderSpells(root);
  }

  #renderSpells(root) {
    const el = root.querySelector(".if-spells");
    el.innerHTML = this.#spells.map((s, i) => `
      <div class="if-spell">
        <img src="${esc(s.img)}" alt="">
        <span class="if-name">${esc(s.name)}${Number.isFinite(s.level) ? ` (liv. ${s.level})` : ""}</span>
        <input type="number" min="0" value="${s.cost}" data-cost="${i}" title="Costo in cariche">
        <button type="button" data-remove="${i}" title="Rimuovi"><i class="fa-solid fa-trash"></i></button>
      </div>`).join("");
  }

  async #search(root) {
    const q = root.querySelector('[name="search"]').value;
    this.#results = await findSpells(q);
    const el = root.querySelector(".if-results");
    el.innerHTML = this.#results.length
      ? this.#results.map((s, i) => `
        <div class="if-result">
          <img src="${esc(s.img)}" alt="">
          <span class="if-name">${esc(s.name)}${Number.isFinite(s.level) ? ` (liv. ${s.level})` : ""}</span>
          <button type="button" data-add="${i}" title="Aggiungi"><i class="fa-solid fa-plus"></i></button>
        </div>`).join("")
      : `<div class="if-hint">Nessun incantesimo trovato.</div>`;
  }

  async #create(root) {
    const get = (n) => root.querySelector(`[name="${n}"]`);
    const values = {
      name: get("name").value,
      itemType: get("itemType").value,
      rarity: get("rarity").value,
      attune: get("attune").checked,
      flavor: get("flavor").value,
      properties: get("properties").value,
      secret: get("secret").value,
      charges: get("charges").value,
      recovery: get("recovery").value,
      dc: get("dc").value,
      immunities: [...get("immunities").selectedOptions].map((o) => o.value),
      abilities: Object.fromEntries(Object.keys(ABILITIES).map((k) => [k, Number(get(`ab-${k}`).value) || 0]))
    };
    if (!values.name.trim()) return ui.notifications.warn("Inserisci un nome per l'oggetto.");

    try {
      const item = await Item.create(buildItemData(values, this.#spells), { renderSheet: true });
      ui.notifications.info(`Oggetto creato: ${item.name}`);
    } catch (err) {
      console.error(`${MODULE_ID} | Errore nella creazione`, err);
      ui.notifications.error("Creazione non riuscita: apri la console (F12) per i dettagli.");
    }
  }
}

/* ---------- Integrazione nell'interfaccia ---------- */

Hooks.on("renderItemDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const el = html instanceof HTMLElement ? html : html[0];
  if (!el || el.querySelector(".corona-item-forge-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "corona-item-forge-btn";
  btn.innerHTML = '<i class="fa-solid fa-hammer"></i> Item Forge';
  btn.addEventListener("click", () => new ItemForgeApp().render({ force: true }));
  (el.querySelector(".header-actions") ?? el.querySelector(".directory-header"))?.append(btn);
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { open: () => new ItemForgeApp().render({ force: true }) };
});
