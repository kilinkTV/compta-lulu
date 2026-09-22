"use strict";

// Sans ce listener, iOS Safari ne déclenche jamais l'état CSS :active au toucher : aucun bouton
// ne donnerait de retour visuel à l'appui (bug connu d'iOS, indépendant du code de l'appli).
document.addEventListener("touchstart", () => {}, { passive: true });

/* ============================= STORAGE ============================= */

// Ne jamais changer cette clé : c'est elle qui permet de retrouver les données déjà enregistrées.
const STORAGE_KEY = "comptaLulu_v1";
const SNAPSHOTS_KEY = "comptaLulu_snapshots";
const SCHEMA_VERSION = 2;
const MAX_SNAPSHOTS = 10;
let loadProblem = false;

function defaultDB() {
  return {
    version: SCHEMA_VERSION,
    prestations: [],
    depenses: [],
    settings: {
      urssaf: { cotisations: 23.20, irLiberatoire: 2.20, formationPro: 0.20 },
      sumupRate: 1.75,
      typesPrestations: [
        { id: uid(), nom: "Bilan diététique", tarif: 60 },
        { id: uid(), nom: "Consultation de suivi", tarif: 50 },
        { id: uid(), nom: "Tarif étudiant", tarif: 40 },
        { id: uid(), nom: "Drainage corps entier", tarif: 90 },
        { id: uid(), nom: "Drainage zone au choix", tarif: 50 },
        { id: uid(), nom: "Cure drainage corps entier (5 séances)", tarif: 360 },
        { id: uid(), nom: "Cure drainage zone au choix (5 séances)", tarif: 200 }
      ],
      categoriesDepenses: ["Fournitures", "Déplacements", "Formation", "Autre"],
      categoriesMigrees: true,
      chargesFixes: defaultChargesFixes(),
      profil: { nom: "Lucile Le Pocreau", siret: "" },
      tresorerie: { montant: null, date: null, mode: "coussin", moisCoussin: 3, montantLibre: null }
    },
    bilansValides: {},
    updatedAt: null
  };
}

function defaultChargesFixes() {
  return ["Loyer cabinet", "Assurance responsabilité civile", "Assurance cabinet", "Doctolib", "Alivio"].map((nom) => ({
    id: uid(),
    nom,
    montant: 0,
    historique: []
  }));
}

// Migrations : chaque étape convertit les données existantes, sans jamais en supprimer.
function migrateDB(db) {
  if ((db.version || 1) < 2) {
    // v2 : les charges fixes ne sont plus recopiées mois par mois dans les dépenses ; elles sont comptées
    // chaque mois d'après leur historique de montant. On convertit les anciennes entrées générées.
    const charges = db.settings.chargesFixes;
    const legacy = db.depenses.filter((d) => d && d.recurringId);
    charges.forEach((c) => {
      const mine = legacy
        .filter((d) => d.recurringId === c.id && d.recurringMonth)
        .sort((a, b) => (a.recurringMonth < b.recurringMonth ? -1 : 1));
      if (mine.length) {
        const hist = [];
        mine.forEach((d) => {
          const last = hist[hist.length - 1];
          if (!last || last.montant !== d.montant) hist.push({ depuis: d.recurringMonth, montant: d.montant });
        });
        const apres = nextMonthKey(mine[mine.length - 1].recurringMonth);
        const dernier = hist[hist.length - 1];
        if (c.montant > 0 && dernier.montant !== c.montant) hist.push({ depuis: apres, montant: c.montant });
        else if (!(c.montant > 0) && dernier.montant > 0) hist.push({ depuis: apres, montant: 0 });
        c.historique = hist;
        c.montant = hist[hist.length - 1].montant;
      }
      delete c.genereJusqua;
    });
    // Les entrées dont la charge a été supprimée restent des dépenses ordinaires.
    const ids = new Set(charges.map((c) => c.id));
    db.depenses = db.depenses.filter((d) => !(d && d.recurringId && ids.has(d.recurringId)));
    db.depenses.forEach((d) => {
      if (d && d.recurringId) {
        delete d.recurringId;
        delete d.recurringMonth;
      }
    });
  }
  db.version = SCHEMA_VERSION;
}

// Ne doit jamais lever d'exception sur des données valides ou partielles : les champs absents reçoivent une valeur par défaut.
function normalizeDB(db) {
  const def = defaultDB();
  const arr = (x, fallback) => (Array.isArray(x) ? x : fallback);
  db.prestations = arr(db.prestations, []);
  db.depenses = arr(db.depenses, []);
  db.settings = db.settings && typeof db.settings === "object" ? db.settings : def.settings;
  const s = db.settings;
  s.urssaf = s.urssaf || def.settings.urssaf;
  s.sumupRate = s.sumupRate ?? 1.75;
  s.typesPrestations = arr(s.typesPrestations, []);
  s.categoriesDepenses = arr(s.categoriesDepenses, []);
  // Loyer et abonnements sont désormais gérés par les charges fixes ; retrait unique des anciennes catégories par défaut.
  if (!s.categoriesMigrees) {
    s.categoriesDepenses = s.categoriesDepenses.filter((c) => c !== "Local / loyer" && c !== "Logiciels / abonnements");
    s.categoriesMigrees = true;
  }
  s.chargesFixes = arr(s.chargesFixes, def.settings.chargesFixes);
  s.chargesFixes.forEach((c) => {
    c.historique = arr(c.historique, []);
    c.montant = Number(c.montant) || 0;
    // Une charge active sans historique compte depuis toujours à ce montant : on l'enregistre pour ne pas réécrire le passé à la prochaine modification.
    if (!c.historique.length && c.montant > 0) c.historique = [{ depuis: "1970-01", montant: c.montant }];
  });
  s.profil = s.profil || def.settings.profil;
  s.tresorerie = { ...def.settings.tresorerie, ...(s.tresorerie || {}) };
  s.tresorerie.moisCoussin = s.tresorerie.moisCoussin ?? 3;
  db.bilansValides = db.bilansValides && typeof db.bilansValides === "object" ? db.bilansValides : {};
  db.updatedAt = db.updatedAt || null;
  migrateDB(db);
  return db;
}

/* ---- Copies de sécurité automatiques ---- */

function readSnapshots() {
  try {
    const list = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function takeSnapshot(raw, reason) {
  if (!raw) return;
  try {
    const list = readSnapshots();
    const last = list[list.length - 1];
    if (last && last.raw === raw) return;
    list.push({ t: new Date().toISOString(), reason, raw });
    while (list.length > MAX_SNAPSHOTS) list.shift();
    for (;;) {
      try {
        localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(list));
        return;
      } catch (e) {
        if (list.length <= 1) return;
        list.shift();
      }
    }
  } catch (e) {
    console.warn("Copie de sécurité impossible", e);
  }
}

function loadDB() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.error("Stockage inaccessible", e);
  }
  if (!raw) {
    const db = defaultDB();
    // touch:false : une base neuve n'a encore aucune vraie donnée. Si cet appareil se relie ensuite à un
    // compte existant, elle ne doit jamais paraître "plus récente" que des données réelles et écraser celles-ci.
    saveDB(db, { touch: false });
    return db;
  }
  try {
    const parsed = JSON.parse(raw);
    const list = readSnapshots();
    const last = list[list.length - 1];
    if ((parsed.version || 1) < SCHEMA_VERSION) takeSnapshot(raw, "avant mise à jour");
    else if (!last || isoFromDate(new Date(last.t)) !== todayISO()) takeSnapshot(raw, "automatique");
    return normalizeDB(parsed);
  } catch (e) {
    // Jamais d'écrasement : les données enregistrées restent intactes, on en garde une copie et on travaille en mémoire.
    console.error("Données illisibles : conservées telles quelles.", e);
    takeSnapshot(raw, "données illisibles");
    loadProblem = true;
    return defaultDB();
  }
}

function saveDB(db, opts = {}) {
  if (opts.touch !== false) db.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    if (opts.touch !== false) scheduleSync();
    return true;
  } catch (e) {
    console.error("Enregistrement impossible", e);
    setTimeout(() => showToast("Enregistrement impossible : stockage plein ou bloqué"), 0);
    return false;
  }
}

let DB = loadDB();

/* ============================= UTILS ============================= */

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function fmtEUR(n) {
  const v = Number(n) || 0;
  // Lato n'a pas l'espace fine insécable (U+202F) utilisée par fr-FR : on la remplace par une espace insécable classique.
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ") + " €";
}

function parseNum(v) {
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function roundCents(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function todayISO() {
  const d = new Date();
  return isoFromDate(d);
}

function isoFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDateHuman(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

const MOIS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

function monthLabel(year, month) {
  return `${MOIS_FR[month]} ${year}`;
}

function inMonth(iso, year, month) {
  const [y, m] = iso.split("-").map(Number);
  return y === year && (m - 1) === month;
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonthKey(key) {
  let [y, m] = key.split("-").map(Number);
  m++;
  if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function ymKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/* ============================= CHARGES FIXES ============================= */

// Une charge fixe compte pour TOUS les mois (passés, en cours, à venir). Son montant est celui de l'historique :
// un changement s'applique à partir du mois en cours, sans réécrire les mois passés.
function montantFixe(c, year, month) {
  const h = c.historique || [];
  if (!h.length) return c.montant || 0;
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  let montant = h[0].montant;
  for (const e of h) {
    if (e.depuis <= key) montant = e.montant;
    else break;
  }
  return montant;
}

function setFixedAmount(c, montant) {
  const cur = monthKey();
  const h = (c.historique = c.historique || []);
  const last = h[h.length - 1];
  if (last && last.depuis === cur) last.montant = montant;
  else if (!last || last.montant !== montant) h.push({ depuis: cur, montant });
  c.montant = montant;
}

function chargesFixesTotal(year, month) {
  return roundCents(DB.settings.chargesFixes.reduce((s, c) => s + montantFixe(c, year, month), 0));
}

// Dépenses "virtuelles" du mois : jamais stockées, recalculées à chaque affichage.
function fixedEntriesFor(year, month) {
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  const entries = [];
  DB.settings.chargesFixes.forEach((c) => {
    const montant = montantFixe(c, year, month);
    if (montant > 0) {
      entries.push({ id: `fixe-${c.id}-${key}`, date: `${key}-01`, categorie: c.nom, montant, note: "", recurringId: c.id, virtual: true });
    }
  });
  return entries;
}

/* ============================= NAVIGATION ============================= */

const SCREENS = ["saisie", "bilan", "historique", "reglages"];
const TITLES = {
  saisie: "Compta <em>Lulu</em>",
  bilan: "Bilan <em>mensuel</em>",
  historique: "Mon <em>historique</em>",
  reglages: "Mes <em>réglages</em>"
};

let currentScreen = "saisie";

function showScreen(name) {
  currentScreen = name;
  SCREENS.forEach((s) => {
    document.getElementById(`screen-${s}`).classList.toggle("hidden", s !== name);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === name);
  });
  document.getElementById("topbar-title").innerHTML = TITLES[name];
  if (name === "saisie") renderValidationBanner();
  if (name === "bilan") renderBilan();
  if (name === "historique") renderHistorique();
  if (name === "reglages") renderReglages();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

/* ============================= TOAST ============================= */

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

/* ============================= MODAL ============================= */

function openModal(html) {
  document.getElementById("modal-box").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-box").innerHTML = "";
}
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") closeModal();
});

/* ============================= ECRAN SAISIE ============================= */

let currentEntryType = "prestation";
let selectedTypeId = null;
let selectedMode = null;

document.querySelectorAll("[data-entry-type]").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentEntryType = btn.dataset.entryType;
    document.querySelectorAll("[data-entry-type]").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("form-prestation").classList.toggle("hidden", currentEntryType !== "prestation");
    document.getElementById("form-depense").classList.toggle("hidden", currentEntryType !== "depense");
  });
});

const AUTRE_ID = "__autre__";

function renderTypeGrid() {
  const grid = document.getElementById("type-grid");
  grid.innerHTML = "";
  DB.settings.typesPrestations.forEach((t) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "tile" + (t.id === selectedTypeId ? " selected" : "");
    el.innerHTML = `${escapeHtml(t.nom)}<span class="tile-price">${fmtEUR(t.tarif)}</span>`;
    el.addEventListener("click", () => {
      selectedTypeId = t.id;
      document.getElementById("prestation-montant").value = t.tarif;
      renderTypeGrid();
      updateSumupPreview();
    });
    grid.appendChild(el);
  });

  const autre = document.createElement("button");
  autre.type = "button";
  autre.className = "tile" + (selectedTypeId === AUTRE_ID ? " selected" : "");
  autre.innerHTML = `Autre<span class="tile-price">à préciser</span>`;
  autre.addEventListener("click", () => {
    selectedTypeId = AUTRE_ID;
    document.getElementById("prestation-montant").value = "";
    renderTypeGrid();
    updateSumupPreview();
    document.getElementById("prestation-autre").focus();
  });
  grid.appendChild(autre);

  document.getElementById("autre-wrap").classList.toggle("hidden", selectedTypeId !== AUTRE_ID);
}

document.querySelectorAll("#mode-grid .tile").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedMode = btn.dataset.mode;
    document.querySelectorAll("#mode-grid .tile").forEach((b) => b.classList.toggle("selected", b === btn));
    updateSumupPreview();
  });
});

function updateSumupPreview() {
  const box = document.getElementById("sumup-preview");
  const montant = parseNum(document.getElementById("prestation-montant").value);
  if (selectedMode === "CB" && montant > 0) {
    const rate = DB.settings.sumupRate;
    const fee = montant * (rate / 100);
    const net = montant - fee;
    document.getElementById("preview-fee").textContent = fmtEUR(fee) + ` (${rate}%)`;
    document.getElementById("preview-net").textContent = fmtEUR(net);
    box.classList.remove("hidden");
  } else {
    box.classList.add("hidden");
  }
}

document.getElementById("prestation-montant").addEventListener("input", updateSumupPreview);

document.querySelectorAll('[data-quickdate]').forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.quickdate;
    const iso = todayISO();
    if (kind === "today-dep") document.getElementById("depense-date").value = iso;
    else document.getElementById("prestation-date").value = iso;
  });
});

document.getElementById("form-prestation").addEventListener("submit", (e) => {
  e.preventDefault();
  const date = document.getElementById("prestation-date").value || todayISO();
  const montant = parseNum(document.getElementById("prestation-montant").value);
  if (!selectedMode) { showToast("Choisissez un mode de paiement"); return; }
  if (montant <= 0) { showToast("Montant invalide"); return; }

  const typeObj = DB.settings.typesPrestations.find((t) => t.id === selectedTypeId);
  let typeLabel = typeObj ? typeObj.nom : "Prestation";
  if (selectedTypeId === AUTRE_ID) {
    const desc = document.getElementById("prestation-autre").value.trim();
    typeLabel = desc ? `Autre : ${desc}` : "Autre";
  }
  const sumupRate = DB.settings.sumupRate;
  const fee = selectedMode === "CB" ? roundCents(montant * (sumupRate / 100)) : 0;
  const montantPercu = roundCents(montant - fee);

  DB.prestations.push({
    id: uid(),
    date,
    typeLabel,
    montant,
    mode: selectedMode,
    sumupRateApplied: selectedMode === "CB" ? sumupRate : 0,
    montantPercu,
    note: document.getElementById("prestation-note").value.trim()
  });
  saveDB(DB);
  showToast("Prestation enregistrée ✓");

  // reset for fast repeated entry, keep date and type selection
  document.getElementById("prestation-autre").value = "";
  document.getElementById("prestation-note").value = "";
  document.getElementById("prestation-montant").value = "";
  selectedMode = null;
  document.querySelectorAll("#mode-grid .tile").forEach((b) => b.classList.remove("selected"));
  document.getElementById("sumup-preview").classList.add("hidden");
});

function renderCategorieSelect() {
  const sel = document.getElementById("depense-categorie");
  sel.innerHTML = "";
  DB.settings.categoriesDepenses.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

document.getElementById("form-depense").addEventListener("submit", (e) => {
  e.preventDefault();
  const date = document.getElementById("depense-date").value || todayISO();
  const montant = parseNum(document.getElementById("depense-montant").value);
  if (montant <= 0) { showToast("Montant invalide"); return; }

  DB.depenses.push({
    id: uid(),
    date,
    categorie: document.getElementById("depense-categorie").value,
    montant,
    note: document.getElementById("depense-note").value.trim()
  });
  saveDB(DB);
  showToast("Dépense enregistrée ✓");
  document.getElementById("depense-montant").value = "";
  document.getElementById("depense-note").value = "";
});

/* ============================= ECRAN BILAN ============================= */

const now = new Date();
let bilanYear = now.getFullYear();
let bilanMonth = now.getMonth();

document.getElementById("month-prev").addEventListener("click", () => { shiftBilanMonth(-1); });
document.getElementById("month-next").addEventListener("click", () => { shiftBilanMonth(1); });

function shiftBilanMonth(delta) {
  bilanMonth += delta;
  if (bilanMonth < 0) { bilanMonth = 11; bilanYear--; }
  if (bilanMonth > 11) { bilanMonth = 0; bilanYear++; }
  renderBilan();
}

// Règle observée sur l'attestation URSSAF : recettes du mois M
// -> prélèvement estimé le 2 du mois M+2. A vérifier sur l'espace URSSAF.
function echeanceDate(year, month) {
  return new Date(year, month + 2, 2);
}

function nextEcheance(year, month) {
  return echeanceDate(year, month).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function shiftMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/* ============================= TRESORERIE ============================= */

// Salaire conseillé = trésorerie actuelle - cotisations URSSAF déjà dues mais pas encore prélevées - coussin de sécurité.
// Coussin = N mois de charges fixes + dépenses courantes moyennes : en micro-entreprise les cotisations suivent le
// chiffre d'affaires, ce sont donc les charges fixes qui pèsent même sans revenu.
function computeTresorerie(now = new Date()) {
  const t = DB.settings.tresorerie;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let urssaf = 0;
  const urssafMois = [];
  for (let k = -3; k <= 0; k++) {
    const m = shiftMonth(now.getFullYear(), now.getMonth(), k);
    // Un mois déjà validé a son URSSAF enregistré comme vraie dépense à son échéance : ne pas la recompter en estimation.
    if (DB.bilansValides[ymKey(m.year, m.month)]) continue;
    if (echeanceDate(m.year, m.month) > today) {
      const cot = computeBilan(m.year, m.month).cotTotal;
      urssaf += cot;
      if (cot > 0) urssafMois.push(MOIS_FR[m.month].toLowerCase());
    }
  }

  const fixes = chargesFixesTotal(now.getFullYear(), now.getMonth());
  let sommePonctuelles = 0;
  let moisAvecActivite = 0;
  for (let k = -3; k <= -1; k++) {
    const m = shiftMonth(now.getFullYear(), now.getMonth(), k);
    const b = computeBilan(m.year, m.month);
    // Le versement URSSAF validé est une grosse dépense ponctuelle non représentative des dépenses courantes : on l'exclut de la moyenne.
    const ponctuelles = b.depenses.filter((d) => !d.recurringId && !d.genereAuto);
    if (b.prestas.length || ponctuelles.length) {
      sommePonctuelles += ponctuelles.reduce((s, d) => s + d.montant, 0);
      moisAvecActivite++;
    }
  }
  const ponctuellesMoy = moisAvecActivite ? roundCents(sommePonctuelles / moisAvecActivite) : 0;
  const mensuel = roundCents(fixes + ponctuellesMoy);
  // Deux façons de fixer la trésorerie à garder : un coussin (N mois de charges) ou un montant libre.
  const mode = t.mode === "libre" ? "libre" : "coussin";
  const coussin = mode === "libre" ? roundCents(Math.max(0, t.montantLibre || 0)) : roundCents(mensuel * t.moisCoussin);
  urssaf = roundCents(urssaf);

  const configured = t.montant !== null && t.montant !== undefined;
  const salaire = configured ? Math.max(0, roundCents(t.montant - urssaf - coussin)) : 0;
  return {
    configured, montant: t.montant, date: t.date, mode, moisCoussin: t.moisCoussin,
    urssaf, urssafMois, fixes, ponctuellesMoy, mensuel, coussin, salaire,
    manque: configured ? Math.max(0, roundCents(urssaf + coussin - t.montant)) : 0,
    resteApres: configured ? roundCents(t.montant - salaire) : 0
  };
}

function renderTresorerieCard() {
  const card = document.getElementById("tresorerie-card");
  const nowD = new Date();
  const prev = shiftMonth(nowD.getFullYear(), nowD.getMonth(), -1);
  const isCurrent = bilanYear === nowD.getFullYear() && bilanMonth === nowD.getMonth();
  const isPrevious = bilanYear === prev.year && bilanMonth === prev.month;
  card.classList.toggle("hidden", !(isCurrent || isPrevious));
  if (!(isCurrent || isPrevious)) return;

  const t = computeTresorerie(nowD);
  const body = document.getElementById("tresorerie-body");
  if (!t.configured) {
    body.innerHTML = `<div class="hint" style="margin-top:0">Renseignez votre trésorerie actuelle (solde du compte pro) pour obtenir un conseil de versement de salaire.</div>`;
    return;
  }

  const ageJours = t.date ? Math.floor((new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()) - new Date(t.date + "T00:00:00")) / 86400000) : 0;
  const moisUrssaf = t.urssafMois.length ? ` (${t.urssafMois.join(", ")})` : "";
  const libre = t.mode === "libre";
  const reserveNom = libre ? "réserve" : "coussin";
  const reserveLigne = libre ? "Réserve de trésorerie choisie" : `Coussin de sécurité (${t.moisCoussin} mois de charges)`;
  let conseil;
  if (t.salaire > 0) {
    conseil = `Versez-vous <strong>${fmtEUR(t.salaire)}</strong> : il restera ${fmtEUR(t.resteApres)} sur le compte (${fmtEUR(t.urssaf)} pour l'URSSAF + ${fmtEUR(t.coussin)} de ${reserveNom}).`;
  } else {
    conseil = `Pas de versement conseillé pour l'instant : il manque ${fmtEUR(t.manque)} pour couvrir l'URSSAF et la ${reserveNom}.`;
  }
  body.innerHTML = `
    <div class="stat-row"><span>Trésorerie actuelle</span><strong>${fmtEUR(t.montant)}</strong></div>
    <div class="stat-row muted"><span>mise à jour le ${t.date ? t.date.split("-").reverse().join("/") : "—"}</span><span></span></div>
    <div class="stat-row"><span>À garder pour l'URSSAF${moisUrssaf}</span><span>- ${fmtEUR(t.urssaf)}</span></div>
    <div class="stat-row"><span>${reserveLigne}</span><span>- ${fmtEUR(t.coussin)}</span></div>
    <div class="stat-row total"><span>Salaire conseillé</span><strong>${fmtEUR(t.salaire)}</strong></div>
    <div class="hint">${conseil}</div>
    ${ageJours > 10 ? `<div class="hint" style="color:var(--danger)">Votre trésorerie date de ${ageJours} jours : mettez-la à jour pour un conseil fiable.</div>` : ""}
    ${!libre && t.fixes === 0 ? `<div class="hint" style="color:var(--danger)">Aucune charge fixe renseignée (Réglages) : le coussin est calculé à 0 €.</div>` : ""}
  `;
}

function openTresorerieModal() {
  const t = DB.settings.tresorerie;
  openModal(`
    <div class="card-title">Trésorerie actuelle</div>
    <label class="field-label">Solde actuel du compte pro (€)</label>
    <input type="number" id="tres-input" step="0.01" inputmode="decimal" value="${t.montant ?? ""}" />
    <button type="button" class="btn-primary" id="tres-save">Enregistrer</button>
  `);
  document.getElementById("tres-save").addEventListener("click", () => {
    const raw = document.getElementById("tres-input").value.trim();
    if (raw === "") { showToast("Indiquez un montant"); return; }
    DB.settings.tresorerie.montant = roundCents(parseNum(raw));
    DB.settings.tresorerie.date = todayISO();
    saveDB(DB);
    closeModal();
    showScreen(currentScreen);
    showToast("Trésorerie mise à jour ✓");
  });
}

document.getElementById("btn-update-tresorerie").addEventListener("click", openTresorerieModal);

function byDateAsc(a, b) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

function computeBilan(year, month) {
  const prestas = DB.prestations.filter((p) => inMonth(p.date, year, month)).sort(byDateAsc);
  const depenses = [...DB.depenses.filter((d) => inMonth(d.date, year, month)), ...fixedEntriesFor(year, month)].sort(byDateAsc);

  const ca = roundCents(prestas.reduce((s, p) => s + p.montant, 0));
  const percu = roundCents(prestas.reduce((s, p) => s + p.montantPercu, 0));
  const frais = roundCents(ca - percu);

  const rates = DB.settings.urssaf;
  const cot1 = roundCents(ca * (rates.cotisations / 100));
  const cot2 = roundCents(ca * (rates.irLiberatoire / 100));
  const cot3 = roundCents(ca * (rates.formationPro / 100));
  const cotTotal = roundCents(cot1 + cot2 + cot3);

  const totalDepenses = roundCents(depenses.reduce((s, d) => s + d.montant, 0));
  const depensesFixes = roundCents(depenses.filter((d) => d.recurringId).reduce((s, d) => s + d.montant, 0));
  const autresDepenses = roundCents(totalDepenses - depensesFixes);
  const net = roundCents(percu - cotTotal - totalDepenses);

  const repartition = {};
  prestas.forEach((p) => {
    const r = repartition[p.mode] || (repartition[p.mode] = { count: 0, total: 0 });
    r.count++;
    r.total = roundCents(r.total + p.montant);
  });

  return {
    monthLabel: monthLabel(year, month),
    echeance: nextEcheance(year, month),
    prestas, depenses, ca, percu, frais, rates,
    cot1, cot2, cot3, cotTotal,
    totalDepenses, depensesFixes, autresDepenses, net, repartition
  };
}

function renderBilan() {
  const b = computeBilan(bilanYear, bilanMonth);
  document.getElementById("month-label").textContent = b.monthLabel;

  document.getElementById("stat-ca").textContent = fmtEUR(b.ca);
  document.getElementById("stat-percu").textContent = fmtEUR(b.percu);
  document.getElementById("stat-frais").textContent = fmtEUR(b.frais);

  document.getElementById("label-cot1").textContent = `Cotisations sociales (${b.rates.cotisations}%)`;
  document.getElementById("label-cot2").textContent = `Versement libératoire IR (${b.rates.irLiberatoire}%)`;
  document.getElementById("label-cot3").textContent = `Formation professionnelle (${b.rates.formationPro}%)`;
  document.getElementById("stat-cot1").textContent = fmtEUR(b.cot1);
  document.getElementById("stat-cot2").textContent = fmtEUR(b.cot2);
  document.getElementById("stat-cot3").textContent = fmtEUR(b.cot3);
  document.getElementById("stat-cot-total").textContent = fmtEUR(b.cotTotal);
  document.getElementById("stat-echeance").textContent =
    `Échéance de paiement estimée : ${b.echeance} (vérifiez la date exacte sur votre espace urssaf.fr)`;

  document.getElementById("stat-depenses").textContent = fmtEUR(b.totalDepenses);
  document.getElementById("stat-fixes").textContent = fmtEUR(b.depensesFixes);
  document.getElementById("stat-net").textContent = fmtEUR(b.net);
  renderTresorerieCard();
  renderValidationCard();

  const repList = document.getElementById("repartition-list");
  repList.innerHTML = "";
  const modes = Object.keys(b.repartition);
  if (modes.length === 0) {
    repList.innerHTML = `<div class="empty-state">Aucune prestation ce mois-ci</div>`;
  } else {
    modes.forEach((mode) => {
      const row = document.createElement("div");
      row.className = "stat-row";
      row.innerHTML = `<span>${escapeHtml(mode)}</span><span>${fmtEUR(b.repartition[mode].total)}</span>`;
      repList.appendChild(row);
    });
  }
}

document.getElementById("btn-export-pdf").addEventListener("click", async () => {
  const data = computeBilan(bilanYear, bilanMonth);
  const bytes = buildBilanPdf(data, DB.settings.profil);
  const slug = data.monthLabel.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(" ", "-").toLowerCase();
  await deliverFile(new Blob([bytes], { type: "application/pdf" }), `bilan-${slug}.pdf`);
});

/* ============================= VALIDATION DU BILAN ============================= */

// Valider un mois transforme son estimation URSSAF en vraie dépense, datée de l'échéance réelle (2 mois plus tard).
// Le montant est figé au moment de la validation : modifier des entrées du mois ensuite ne le change plus.
function validerBilan(year, month) {
  const key = ymKey(year, month);
  if (DB.bilansValides[key]) return DB.bilansValides[key];
  const bilan = computeBilan(year, month);
  const due = echeanceDate(year, month);
  const depense = {
    id: uid(),
    date: isoFromDate(due),
    categorie: "URSSAF",
    montant: bilan.cotTotal,
    note: `Cotisations URSSAF – ${bilan.monthLabel}`,
    genereAuto: true
  };
  DB.depenses.push(depense);
  DB.bilansValides[key] = { valideLe: todayISO(), urssaf: bilan.cotTotal, depenseId: depense.id };
  saveDB(DB);
  return DB.bilansValides[key];
}

function annulerValidation(year, month) {
  const key = ymKey(year, month);
  const v = DB.bilansValides[key];
  if (!v) return;
  DB.depenses = DB.depenses.filter((d) => d.id !== v.depenseId);
  delete DB.bilansValides[key];
  saveDB(DB);
}

function renderValidationCard() {
  const card = document.getElementById("validation-card");
  const nowD = new Date();
  const isFuture = bilanYear > nowD.getFullYear() || (bilanYear === nowD.getFullYear() && bilanMonth > nowD.getMonth());
  if (isFuture) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");

  const key = ymKey(bilanYear, bilanMonth);
  const v = DB.bilansValides[key];
  const body = document.getElementById("validation-body");
  const btnValider = document.getElementById("btn-valider-bilan");
  const btnAnnuler = document.getElementById("btn-annuler-validation");

  if (v) {
    body.innerHTML = `<div class="hint" style="margin-top:0">Bilan validé le ${v.valideLe.split("-").reverse().join("/")}. Cotisation URSSAF de <strong>${fmtEUR(v.urssaf)}</strong> enregistrée comme dépense à son échéance du ${isoFromDate(echeanceDate(bilanYear, bilanMonth)).split("-").reverse().join("/")}.</div>`;
    btnValider.classList.add("hidden");
    btnAnnuler.classList.remove("hidden");
  } else {
    const cot = computeBilan(bilanYear, bilanMonth).cotTotal;
    body.innerHTML = `<div class="hint" style="margin-top:0">Vérifiez les recettes, dépenses et le montant URSSAF ci-dessus. Une fois validé, l'URSSAF de <strong>${fmtEUR(cot)}</strong> sera enregistré comme dépense à son échéance (${nextEcheance(bilanYear, bilanMonth)}) et ne changera plus.</div>`;
    btnValider.classList.remove("hidden");
    btnAnnuler.classList.add("hidden");
  }
}

document.getElementById("btn-valider-bilan").addEventListener("click", () => {
  if (!confirm(`Valider le bilan de ${monthLabel(bilanYear, bilanMonth)} ? La cotisation URSSAF sera enregistrée comme dépense à son échéance et ne changera plus, même en modifiant des entrées de ce mois ensuite.`)) return;
  validerBilan(bilanYear, bilanMonth);
  renderBilan();
  renderValidationBanner();
  showToast("Bilan validé ✓");
  if (confirm("Exporter le bilan en PDF maintenant ?")) document.getElementById("btn-export-pdf").click();
});

document.getElementById("btn-annuler-validation").addEventListener("click", () => {
  if (!confirm("Annuler la validation de ce mois ? La dépense URSSAF associée sera supprimée.")) return;
  annulerValidation(bilanYear, bilanMonth);
  renderBilan();
  renderValidationBanner();
  showToast("Validation annulée");
});

// Mois en attente de validation : le mois précédent (dès qu'il a de l'activité), et le mois en cours à partir du 28.
function moisAValiderEnAttente() {
  const nowD = new Date();
  const candidates = [];
  if (nowD.getDate() >= 28) candidates.push({ year: nowD.getFullYear(), month: nowD.getMonth() });
  candidates.push(shiftMonth(nowD.getFullYear(), nowD.getMonth(), -1));
  for (const c of candidates) {
    if (DB.bilansValides[ymKey(c.year, c.month)]) continue;
    const b = computeBilan(c.year, c.month);
    if (b.prestas.length || b.depenses.length) return c;
  }
  return null;
}

function renderValidationBanner() {
  const banner = document.getElementById("validation-banner");
  const pending = moisAValiderEnAttente();
  if (!pending) { banner.classList.add("hidden"); return; }
  document.getElementById("validation-banner-text").textContent =
    `Pensez à valider le bilan de ${monthLabel(pending.year, pending.month)} (recettes, dépenses, URSSAF) puis à l'exporter en PDF.`;
  banner.dataset.year = pending.year;
  banner.dataset.month = pending.month;
  banner.classList.remove("hidden");
}

document.getElementById("btn-validation-banner-go").addEventListener("click", () => {
  const banner = document.getElementById("validation-banner");
  bilanYear = Number(banner.dataset.year);
  bilanMonth = Number(banner.dataset.month);
  showScreen("bilan");
});

/* ============================= ECRAN HISTORIQUE ============================= */

let histYear = now.getFullYear();
let histMonth = now.getMonth();

document.getElementById("hist-month-prev").addEventListener("click", () => { shiftHistMonth(-1); });
document.getElementById("hist-month-next").addEventListener("click", () => { shiftHistMonth(1); });

function shiftHistMonth(delta) {
  histMonth += delta;
  if (histMonth < 0) { histMonth = 11; histYear--; }
  if (histMonth > 11) { histMonth = 0; histYear++; }
  renderHistorique();
}

function renderHistorique() {
  document.getElementById("hist-month-label").textContent = monthLabel(histYear, histMonth);
  const list = document.getElementById("historique-list");
  list.innerHTML = "";

  const items = [
    ...DB.prestations.filter((p) => inMonth(p.date, histYear, histMonth)).map((p) => ({ ...p, kind: "prestation" })),
    ...DB.depenses.filter((d) => inMonth(d.date, histYear, histMonth)).map((d) => ({ ...d, kind: "depense" })),
    ...fixedEntriesFor(histYear, histMonth).map((d) => ({ ...d, kind: "depense" }))
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">Aucune entrée ce mois-ci</div>`;
    return;
  }

  let lastDate = null;
  items.forEach((item) => {
    if (item.date !== lastDate) {
      lastDate = item.date;
      const header = document.createElement("div");
      header.className = "entry-day-header";
      header.textContent = fmtDateHuman(item.date);
      list.appendChild(header);
    }
    const el = document.createElement("div");
    el.className = "entry-item";
    if (item.kind === "prestation") {
      el.innerHTML = `
        <div class="entry-main">
          <div class="entry-title">${escapeHtml(item.typeLabel)}</div>
          <div class="entry-sub">${escapeHtml(item.mode)}${item.note ? " · " + escapeHtml(item.note) : ""}</div>
        </div>
        <div class="entry-amount positive">+${fmtEUR(item.montant)}</div>
      `;
    } else {
      el.innerHTML = `
        <div class="entry-main">
          <div class="entry-title">${escapeHtml(item.categorie)}</div>
          <div class="entry-sub">${item.note ? escapeHtml(item.note) : item.recurringId ? "Charge mensuelle fixe" : "Dépense"}</div>
        </div>
        <div class="entry-amount negative">-${fmtEUR(item.montant)}</div>
      `;
    }
    el.addEventListener("click", () => {
      if (item.virtual) openFixedInfoModal(item);
      else if (item.genereAuto) openAutoDepenseInfoModal(item);
      else openEntryModal(item);
    });
    list.appendChild(el);
  });
}

function openFixedInfoModal(item) {
  openModal(`
    <div class="card-title">${escapeHtml(item.categorie)}</div>
    <p class="hint" style="margin-top:0">Charge mensuelle fixe de <strong>${fmtEUR(item.montant)}</strong>, comptée automatiquement chaque mois. Pour la modifier, allez dans Réglages → Charges mensuelles fixes : le nouveau montant s'applique à partir du mois en cours, sans changer les mois passés.</p>
    <button type="button" class="btn-primary" id="fixed-info-go">Ouvrir les réglages</button>
  `);
  document.getElementById("fixed-info-go").addEventListener("click", () => {
    closeModal();
    showScreen("reglages");
  });
}

function openAutoDepenseInfoModal(item) {
  const key = Object.keys(DB.bilansValides).find((k) => DB.bilansValides[k].depenseId === item.id);
  openModal(`
    <div class="card-title">${escapeHtml(item.categorie)}</div>
    <p class="hint" style="margin-top:0">${escapeHtml(item.note || "")}. Dépense générée automatiquement en validant le bilan du mois concerné, pour un montant de <strong>${fmtEUR(item.montant)}</strong>. Pour la modifier, ouvrez le bilan de ce mois et utilisez « Annuler la validation ».</p>
    <button type="button" class="btn-primary" id="auto-depense-go">Ouvrir le bilan</button>
  `);
  document.getElementById("auto-depense-go").addEventListener("click", () => {
    closeModal();
    if (key) {
      const [y, m] = key.split("-").map(Number);
      bilanYear = y;
      bilanMonth = m - 1;
    }
    showScreen("bilan");
  });
}

function openEntryModal(item) {
  const isPresta = item.kind === "prestation";
  const html = `
    <div class="card-title">${isPresta ? "Modifier la prestation" : "Modifier la dépense"}</div>
    <label class="field-label">Date</label>
    <input type="date" id="edit-date" value="${item.date}" />
    ${isPresta ? `
      <label class="field-label">Type</label>
      <input type="text" id="edit-label" value="${escapeAttr(item.typeLabel)}" />
      <label class="field-label">Montant facturé (€)</label>
      <input type="number" id="edit-montant" step="0.01" value="${item.montant}" />
      <label class="field-label">Mode de paiement</label>
      <select id="edit-mode">
        ${["Espèces", "Chèque", "Virement", "CB"].map((m) => `<option value="${m}" ${m === item.mode ? "selected" : ""}>${m === "CB" ? "CB (SumUp)" : m}</option>`).join("")}
      </select>
      <label class="field-label">Note</label>
      <input type="text" id="edit-note" value="${escapeAttr(item.note || "")}" />
    ` : `
      <label class="field-label">Catégorie</label>
      <select id="edit-cat">
        ${(DB.settings.categoriesDepenses.includes(item.categorie) ? DB.settings.categoriesDepenses : [item.categorie, ...DB.settings.categoriesDepenses]).map((c) => `<option value="${escapeAttr(c)}" ${c === item.categorie ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
      <label class="field-label">Montant (€)</label>
      <input type="number" id="edit-montant" step="0.01" value="${item.montant}" />
      <label class="field-label">Note</label>
      <input type="text" id="edit-note" value="${escapeAttr(item.note || "")}" />
    `}
    <button type="button" class="btn-primary" id="edit-save">Enregistrer</button>
    <button type="button" class="btn-danger-text" id="edit-delete" style="width:100%; margin-top:10px;">Supprimer cette entrée</button>
  `;
  openModal(html);

  document.getElementById("edit-save").addEventListener("click", () => {
    const date = document.getElementById("edit-date").value;
    const montant = parseNum(document.getElementById("edit-montant").value);
    if (isPresta) {
      const mode = document.getElementById("edit-mode").value;
      const rate = DB.settings.sumupRate;
      const fee = mode === "CB" ? roundCents(montant * (rate / 100)) : 0;
      Object.assign(item, {
        date, montant, mode,
        typeLabel: document.getElementById("edit-label").value.trim() || item.typeLabel,
        note: document.getElementById("edit-note").value.trim(),
        sumupRateApplied: mode === "CB" ? rate : 0,
        montantPercu: roundCents(montant - fee)
      });
    } else {
      Object.assign(item, {
        date, montant,
        categorie: document.getElementById("edit-cat").value,
        note: document.getElementById("edit-note").value.trim()
      });
    }
    // write back into DB arrays (item is a shallow copy via spread, so find and replace)
    const arr = isPresta ? DB.prestations : DB.depenses;
    const idx = arr.findIndex((x) => x.id === item.id);
    if (idx !== -1) {
      arr[idx] = { ...arr[idx], ...item };
      delete arr[idx].kind;
    }
    saveDB(DB);
    closeModal();
    renderHistorique();
    showToast("Modifié ✓");
  });

  document.getElementById("edit-delete").addEventListener("click", () => {
    const arr = isPresta ? DB.prestations : DB.depenses;
    const idx = arr.findIndex((x) => x.id === item.id);
    if (idx !== -1) arr.splice(idx, 1);
    if (!isPresta) {
      const key = Object.keys(DB.bilansValides).find((k) => DB.bilansValides[k].depenseId === item.id);
      if (key) delete DB.bilansValides[key];
    }
    saveDB(DB);
    closeModal();
    renderHistorique();
    showToast("Supprimé");
  });
}

/* ============================= ECRAN REGLAGES ============================= */

function renderReglages() {
  const r = DB.settings.urssaf;
  document.getElementById("rate-cotisations").value = r.cotisations;
  document.getElementById("rate-ir").value = r.irLiberatoire;
  document.getElementById("rate-formation").value = r.formationPro;
  document.getElementById("rate-total").textContent = (r.cotisations + r.irLiberatoire + r.formationPro).toFixed(2);
  document.getElementById("rate-sumup").value = DB.settings.sumupRate;
  document.getElementById("profil-nom").value = DB.settings.profil.nom || "";
  document.getElementById("profil-siret").value = DB.settings.profil.siret || "";
  renderChargesFixes();
  renderTresorerieSettings();
  renderSnapshots();
  renderNotifCard();
  updateSyncStatus();

  const typesList = document.getElementById("types-list");
  typesList.innerHTML = "";
  DB.settings.typesPrestations.forEach((t) => {
    const row = document.createElement("div");
    row.className = "setting-item";
    row.innerHTML = `
      <div>
        <div class="setting-item-name">${escapeHtml(t.nom)}</div>
        <div class="setting-item-price">${fmtEUR(t.tarif)}</div>
      </div>
      <button type="button" class="btn-danger-text" data-remove-type="${t.id}">Suppr.</button>
    `;
    typesList.appendChild(row);
  });
  typesList.querySelectorAll("[data-remove-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      DB.settings.typesPrestations = DB.settings.typesPrestations.filter((t) => t.id !== btn.dataset.removeType);
      saveDB(DB);
      renderReglages();
      renderTypeGrid();
    });
  });

  const catList = document.getElementById("categories-list");
  catList.innerHTML = "";
  DB.settings.categoriesDepenses.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "setting-item";
    row.innerHTML = `<div class="setting-item-name">${escapeHtml(c)}</div><button type="button" class="btn-danger-text" data-remove-cat="${i}">Suppr.</button>`;
    catList.appendChild(row);
  });
  catList.querySelectorAll("[data-remove-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      DB.settings.categoriesDepenses.splice(Number(btn.dataset.removeCat), 1);
      saveDB(DB);
      renderReglages();
      renderCategorieSelect();
    });
  });
}

function renderChargesFixes() {
  const list = document.getElementById("fixed-list");
  list.innerHTML = "";
  DB.settings.chargesFixes.forEach((c) => {
    const row = document.createElement("div");
    row.className = "fixed-row";
    row.innerHTML = `
      <input type="text" class="fx-nom" value="${escapeAttr(c.nom)}" aria-label="Nom de la charge" />
      <input type="number" class="fx-montant" value="${c.montant || ""}" placeholder="0.00" step="0.01" min="0" inputmode="decimal" aria-label="Montant par mois en euros" />
      <button type="button" class="btn-danger-text">Suppr.</button>
    `;
    const nomInput = row.querySelector(".fx-nom");
    const montantInput = row.querySelector(".fx-montant");
    const save = () => {
      c.nom = nomInput.value.trim() || c.nom;
      const montant = Math.max(0, roundCents(parseNum(montantInput.value)));
      if (montant !== c.montant) setFixedAmount(c, montant);
      saveDB(DB);
      updateFixedTotal();
    };
    nomInput.addEventListener("change", save);
    montantInput.addEventListener("change", save);
    row.querySelector("button").addEventListener("click", () => {
      if (!confirm(`Supprimer « ${c.nom} » de tous les mois ? Pour l'arrêter seulement à partir de maintenant, mettez son montant à 0 €.`)) return;
      DB.settings.chargesFixes = DB.settings.chargesFixes.filter((x) => x.id !== c.id);
      saveDB(DB);
      renderChargesFixes();
    });
    list.appendChild(row);
  });
  updateFixedTotal();
}

let tresModeChoisi = "coussin";

function setTresMode(mode) {
  tresModeChoisi = mode;
  document.querySelectorAll("[data-tres-mode]").forEach((b) => b.classList.toggle("active", b.dataset.tresMode === mode));
  document.getElementById("tres-coussin-fields").classList.toggle("hidden", mode !== "coussin");
  document.getElementById("tres-libre-fields").classList.toggle("hidden", mode !== "libre");
}

document.querySelectorAll("[data-tres-mode]").forEach((btn) => {
  btn.addEventListener("click", () => setTresMode(btn.dataset.tresMode));
});

function renderTresorerieSettings() {
  const t = DB.settings.tresorerie;
  document.getElementById("tres-montant").value = t.montant ?? "";
  document.getElementById("tres-mois").value = t.moisCoussin;
  document.getElementById("tres-libre").value = t.montantLibre ?? "";
  document.getElementById("tres-date").textContent = t.date ? `Mis à jour le ${t.date.split("-").reverse().join("/")}` : "Pas encore renseignée";
  setTresMode(t.mode === "libre" ? "libre" : "coussin");
  updateCoussinPreview();
}

function updateCoussinPreview() {
  const mois = Math.min(12, Math.max(0, Math.round(parseNum(document.getElementById("tres-mois").value))));
  const t = computeTresorerie();
  const el = document.getElementById("tres-reco");
  if (t.mensuel === 0) {
    el.textContent = "Renseignez vos charges fixes ci-dessus pour calculer le coussin recommandé.";
    return;
  }
  el.innerHTML = `Coussin à garder : <strong>${fmtEUR(roundCents(t.mensuel * mois))}</strong> (${mois} × ${fmtEUR(t.mensuel)} par mois = charges fixes ${fmtEUR(t.fixes)} + dépenses courantes moyennes ${fmtEUR(t.ponctuellesMoy)}).`;
}

document.getElementById("tres-mois").addEventListener("input", updateCoussinPreview);

document.getElementById("btn-save-tresorerie").addEventListener("click", () => {
  const t = DB.settings.tresorerie;
  const raw = document.getElementById("tres-montant").value.trim();
  const montant = raw === "" ? null : roundCents(parseNum(raw));
  if (montant !== t.montant) t.date = montant === null ? null : todayISO();
  t.montant = montant;
  t.moisCoussin = Math.min(12, Math.max(0, Math.round(parseNum(document.getElementById("tres-mois").value))));
  const libreRaw = document.getElementById("tres-libre").value.trim();
  t.montantLibre = libreRaw === "" ? null : Math.max(0, roundCents(parseNum(libreRaw)));
  t.mode = tresModeChoisi;
  saveDB(DB);
  renderTresorerieSettings();
  showToast("Trésorerie enregistrée ✓");
});

function updateFixedTotal() {
  const today = new Date();
  const total = chargesFixesTotal(today.getFullYear(), today.getMonth());
  document.getElementById("fixed-total").textContent = fmtEUR(total);
  updateCoussinPreview();
}

document.getElementById("btn-add-fixed").addEventListener("click", () => {
  const nom = document.getElementById("new-fixed-nom").value.trim();
  const montant = Math.max(0, roundCents(parseNum(document.getElementById("new-fixed-montant").value)));
  if (!nom) { showToast("Indiquez un nom"); return; }
  const charge = { id: uid(), nom, montant: 0, historique: [] };
  if (montant > 0) setFixedAmount(charge, montant);
  DB.settings.chargesFixes.push(charge);
  saveDB(DB);
  document.getElementById("new-fixed-nom").value = "";
  document.getElementById("new-fixed-montant").value = "";
  renderChargesFixes();
  showToast("Charge ajoutée ✓");
});

document.getElementById("btn-save-profil").addEventListener("click", () => {
  DB.settings.profil = {
    nom: document.getElementById("profil-nom").value.trim(),
    siret: document.getElementById("profil-siret").value.trim()
  };
  saveDB(DB);
  showToast("Informations enregistrées ✓");
});

document.getElementById("btn-save-rates").addEventListener("click", () => {
  DB.settings.urssaf = {
    cotisations: parseNum(document.getElementById("rate-cotisations").value),
    irLiberatoire: parseNum(document.getElementById("rate-ir").value),
    formationPro: parseNum(document.getElementById("rate-formation").value)
  };
  saveDB(DB);
  renderReglages();
  showToast("Taux URSSAF enregistrés ✓");
});

document.getElementById("btn-save-sumup").addEventListener("click", () => {
  DB.settings.sumupRate = parseNum(document.getElementById("rate-sumup").value);
  saveDB(DB);
  showToast("Taux SumUp enregistré ✓");
});

document.getElementById("btn-add-type").addEventListener("click", () => {
  const nom = document.getElementById("new-type-nom").value.trim();
  const tarif = parseNum(document.getElementById("new-type-tarif").value);
  if (!nom) { showToast("Indiquez un nom"); return; }
  DB.settings.typesPrestations.push({ id: uid(), nom, tarif });
  saveDB(DB);
  document.getElementById("new-type-nom").value = "";
  document.getElementById("new-type-tarif").value = "";
  renderReglages();
  renderTypeGrid();
  showToast("Type ajouté ✓");
});

document.getElementById("btn-add-cat").addEventListener("click", () => {
  const nom = document.getElementById("new-cat-nom").value.trim();
  if (!nom) { showToast("Indiquez un nom"); return; }
  DB.settings.categoriesDepenses.push(nom);
  saveDB(DB);
  document.getElementById("new-cat-nom").value = "";
  renderReglages();
  renderCategorieSelect();
  showToast("Catégorie ajoutée ✓");
});

/* ---- Copies de sécurité automatiques ---- */

function snapshotStats(raw) {
  try {
    const d = JSON.parse(raw);
    return `${(d.prestations || []).length} prestations · ${(d.depenses || []).length} dépenses`;
  } catch (e) {
    return "contenu illisible";
  }
}

function renderSnapshots() {
  const list = document.getElementById("snapshots-list");
  list.innerHTML = "";
  const snaps = readSnapshots();
  if (!snaps.length) {
    list.innerHTML = `<div class="hint" style="margin-top:0">Aucune copie pour le moment : la première est créée à la prochaine ouverture de l'appli.</div>`;
    return;
  }
  snaps
    .map((s, i) => ({ s, i }))
    .reverse()
    .forEach(({ s, i }) => {
      const d = new Date(s.t);
      const row = document.createElement("div");
      row.className = "setting-item";
      row.innerHTML = `
        <div>
          <div class="setting-item-name">${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
          <div class="setting-item-price">${escapeHtml(s.reason)} · ${snapshotStats(s.raw)}</div>
        </div>
        <button type="button" class="btn-danger-text" style="color:var(--brun)">Restaurer</button>
      `;
      row.querySelector("button").addEventListener("click", () => restoreSnapshot(i));
      list.appendChild(row);
    });
}

function restoreSnapshot(index) {
  const s = readSnapshots()[index];
  if (!s) return;
  const d = new Date(s.t);
  if (!confirm(`Restaurer la copie du ${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} (${snapshotStats(s.raw)}) ? Vos données actuelles seront remplacées ; une copie d'elles est conservée.`)) return;
  try {
    const restored = normalizeDB(JSON.parse(s.raw));
    takeSnapshot(localStorage.getItem(STORAGE_KEY), "avant restauration");
    DB = restored;
    saveDB(DB);
    document.getElementById("recovery-banner").classList.add("hidden");
    renderTypeGrid();
    renderCategorieSelect();
    showScreen("reglages");
    showToast("Copie restaurée ✓");
  } catch (e) {
    console.error(e);
    showToast("Restauration impossible");
  }
}

document.getElementById("btn-recovery-open").addEventListener("click", () => {
  showScreen("reglages");
  document.getElementById("snapshots-card").scrollIntoView();
});

/* ---- Export / Import / CSV ---- */

document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
  deliverFile(blob, `compta-lulu-sauvegarde-${todayISO()}.json`);
});

document.getElementById("btn-import").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported.prestations || !imported.depenses || !imported.settings) throw new Error("format invalide");
      const restored = normalizeDB(imported);
      takeSnapshot(localStorage.getItem(STORAGE_KEY), "avant import");
      DB = restored;
      saveDB(DB);
      renderTypeGrid();
      renderCategorieSelect();
      renderReglages();
      showToast("Sauvegarde importée ✓");
    } catch (err) {
      showToast("Fichier invalide");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.getElementById("btn-export-csv").addEventListener("click", () => {
  const { prestas, depenses } = computeBilan(bilanYear, bilanMonth);
  let csv ="Type;Date;Libellé;Mode;Montant facturé;Montant perçu\n";
  prestas.forEach((p) => {
    csv += `Prestation;${p.date};${csvSafe(p.typeLabel)};${csvSafe(p.mode)};${p.montant.toFixed(2)};${p.montantPercu.toFixed(2)}\n`;
  });
  depenses.forEach((d) => {
    csv += `Dépense;${d.date};${csvSafe(d.categorie)};;-${d.montant.toFixed(2)};-${d.montant.toFixed(2)}\n`;
  });
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  deliverFile(blob, `compta-lulu-${monthLabel(bilanYear, bilanMonth).replace(" ", "-").toLowerCase()}.csv`);
});

function csvSafe(s) { return String(s).replace(/;/g, ","); }

// Sur téléphone, le menu de partage natif (enregistrer dans Fichiers, envoyer par mail...) est plus fiable
// qu'un téléchargement, qui peut enfermer l'utilisateur dans une visionneuse sans retour en mode application installée.
async function deliverFile(blob, filename) {
  const isTouchDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  if (isTouchDevice && navigator.canShare && navigator.share) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
  }
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ============================= NOTIFICATIONS PUSH ============================= */

// Clé publique VAPID : sans danger à exposer, elle sert uniquement à vérifier l'origine des envois.
const PUSH_VAPID_PUBLIC_KEY = "BK7rL1-jrxHs0WjyjSmlfuj-xWf0ezc_oURak_srCxLXCvzWipddZZRDUw28axgxZ4Shya8tY46N4oHydaGtLU4";
const PUSH_SERVER_URL = "https://compta-lulu-push.benjmug.workers.dev";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function pushSupported() {
  return PUSH_SERVER_URL && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function renderNotifCard() {
  const status = document.getElementById("notif-status");
  const btn = document.getElementById("btn-notif-toggle");
  if (!pushSupported()) {
    status.textContent = !PUSH_SERVER_URL
      ? "Bientôt disponible : le service de rappel n'est pas encore activé."
      : "Non disponible sur ce navigateur. Sur iPhone, ajoutez d'abord l'appli à l'écran d'accueil (iOS 16.4+).";
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");
  btn.disabled = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      status.textContent = "Rappels activés ✓";
      btn.textContent = "Désactiver les rappels";
      btn.onclick = () => unsubscribePush(sub);
    } else {
      status.textContent = Notification.permission === "denied"
        ? "Notifications bloquées : autorisez-les dans les réglages de l'appareil."
        : "Rappels désactivés.";
      btn.textContent = "Activer les rappels";
      btn.onclick = subscribePush;
    }
  } catch (e) {
    console.error(e);
    status.textContent = "Impossible de vérifier l'état des notifications.";
  }
}

async function subscribePush() {
  const btn = document.getElementById("btn-notif-toggle");
  btn.disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { showToast("Autorisation refusée"); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY)
    });
    await fetch(`${PUSH_SERVER_URL}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub)
    });
    showToast("Rappels activés ✓");
  } catch (e) {
    console.error(e);
    showToast("Activation impossible");
  }
  renderNotifCard();
}

async function unsubscribePush(sub) {
  document.getElementById("btn-notif-toggle").disabled = true;
  try {
    await fetch(`${PUSH_SERVER_URL}/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    await sub.unsubscribe();
    showToast("Rappels désactivés");
  } catch (e) {
    console.error(e);
  }
  renderNotifCard();
}

/* ============================= SYNCHRONISATION MULTI-APPAREILS ============================= */

// Même service que les rappels push (voir worker/README.md).
const SYNC_SERVER_URL = "https://compta-lulu-push.benjmug.workers.dev";
const SYNC_SESSION_KEY = "comptaLulu_syncSession"; // { email, token } — séparé des données comptables

function getSyncSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_SESSION_KEY));
    return s && s.email && s.token ? s : null;
  } catch (e) {
    return null;
  }
}

function setSyncSession(s) {
  if (s) localStorage.setItem(SYNC_SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SYNC_SESSION_KEY);
}

async function requestMagicLink(email) {
  const res = await fetch(`${SYNC_SERVER_URL}/auth/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, appUrl: location.origin + location.pathname })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json().catch(() => ({}));
  return data.status; // "sent" ou "wait"
}

async function verifyMagicToken(token) {
  const res = await fetch(`${SYNC_SERVER_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  setSyncSession({ email: data.email, token: data.sessionToken });
}

function disconnectSync() {
  setSyncSession(null);
  updateSyncStatus();
}

let syncDebounce = null;
function scheduleSync() {
  if (!getSyncSession()) return;
  clearTimeout(syncDebounce);
  syncDebounce = setTimeout(syncNow, 3000);
}

let syncing = false;
async function syncNow() {
  const session = getSyncSession();
  if (!session || syncing) return;
  syncing = true;
  const sentUpdatedAt = DB.updatedAt; // capturé avant l'appel réseau, pour détecter une saisie locale entre-temps
  try {
    const res = await fetch(`${SYNC_SERVER_URL}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.token}` },
      body: JSON.stringify({ updatedAt: sentUpdatedAt, data: DB })
    });
    if (res.status === 401) {
      setSyncSession(null);
      updateSyncStatus();
      return;
    }
    if (!res.ok) return;
    const remote = await res.json();
    if (remote.newer && remote.data) {
      if (DB.updatedAt !== sentUpdatedAt) {
        // Une saisie locale a eu lieu pendant l'appel réseau : ne pas l'écraser, la prochaine synchro la prendra en compte.
        return;
      }
      // Les données de l'autre appareil sont plus récentes : on les adopte, en gardant une copie de sécurité des données locales.
      takeSnapshot(localStorage.getItem(STORAGE_KEY), "avant synchronisation");
      DB = normalizeDB(remote.data);
      saveDB(DB, { touch: false });
      renderTypeGrid();
      renderCategorieSelect();
      showScreen(currentScreen);
      showToast("Données synchronisées ✓");
    }
    lastSyncAt = new Date();
    updateSyncStatus();
  } catch (e) {
    console.error("Synchronisation impossible", e);
  } finally {
    syncing = false;
  }
}

let lastSyncAt = null;

function updateSyncStatus() {
  const card = document.getElementById("sync-card");
  if (!card) return;
  const session = getSyncSession();
  const connectedBox = document.getElementById("sync-connected");
  const formBox = document.getElementById("sync-form");
  if (session) {
    connectedBox.classList.remove("hidden");
    formBox.classList.add("hidden");
    document.getElementById("sync-email").textContent = session.email;
    document.getElementById("sync-last").textContent = lastSyncAt
      ? `Dernière synchro à ${lastSyncAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
      : "Pas encore synchronisé sur cet appareil";
  } else {
    connectedBox.classList.add("hidden");
    formBox.classList.remove("hidden");
  }
}

document.getElementById("btn-sync-request").addEventListener("click", async () => {
  const email = document.getElementById("sync-email-input").value.trim();
  if (!email || !email.includes("@")) { showToast("Adresse email invalide"); return; }
  const btn = document.getElementById("btn-sync-request");
  if (btn.disabled) return; // évite un double envoi si on retape pendant la requête
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Envoi en cours…";
  try {
    const result = await requestMagicLink(email);
    showToast(result === "wait" ? "Lien déjà envoyé, vérifiez vos mails (patientez 1 min avant d'en redemander un)" : "Lien de connexion envoyé ✓ — vérifiez vos mails");
  } catch (e) {
    console.error(e);
    showToast("Envoi impossible : vérifiez votre connexion");
  }
  btn.disabled = false;
  btn.textContent = label;
});

document.getElementById("btn-sync-disconnect").addEventListener("click", () => {
  if (!confirm("Déconnecter cet appareil ? Il ne recevra plus les mises à jour de l'autre appareil (vos données restent enregistrées ici).")) return;
  disconnectSync();
  showToast("Déconnecté");
});

// Lien magique ouvert depuis l'email : ?magic=<jeton>
(async function handleMagicLink() {
  const params = new URLSearchParams(location.search);
  const token = params.get("magic");
  if (!token) return;
  history.replaceState(null, "", location.pathname);
  try {
    await verifyMagicToken(token);
    showToast("Connecté ✓ — synchronisation en cours");
    updateSyncStatus();
    syncNow();
  } catch (e) {
    console.error(e);
    showToast("Lien invalide ou expiré, redemandez-en un");
  }
})();

if (getSyncSession()) {
  syncNow();
  setInterval(syncNow, 60000);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncNow();
});

/* ============================= HELPERS ============================= */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

/* ============================= INIT ============================= */

document.getElementById("prestation-date").value = todayISO();
document.getElementById("depense-date").value = todayISO();
renderTypeGrid();
renderCategorieSelect();
showScreen("saisie");
if (loadProblem) document.getElementById("recovery-banner").classList.remove("hidden");

// Demande au navigateur de ne pas effacer les données de l'appli quand le stockage est saturé.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}
