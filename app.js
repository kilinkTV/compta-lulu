"use strict";

/* ============================= STORAGE ============================= */

const STORAGE_KEY = "comptaLulu_v1";

function defaultDB() {
  return {
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
      tresorerie: { montant: null, date: null, moisCoussin: 3 }
    }
  };
}

function defaultChargesFixes() {
  return ["Loyer cabinet", "Assurance responsabilité civile", "Assurance cabinet", "Doctolib", "Alivio"].map((nom) => ({
    id: uid(),
    nom,
    montant: 0,
    genereJusqua: null
  }));
}

function normalizeDB(db) {
  const def = defaultDB();
  db.prestations = db.prestations || [];
  db.depenses = db.depenses || [];
  db.settings = db.settings || def.settings;
  db.settings.urssaf = db.settings.urssaf || def.settings.urssaf;
  db.settings.sumupRate = db.settings.sumupRate ?? 1.75;
  db.settings.typesPrestations = db.settings.typesPrestations || [];
  db.settings.categoriesDepenses = db.settings.categoriesDepenses || [];
  // Loyer et abonnements sont désormais gérés par les charges fixes ; retrait unique des anciennes catégories par défaut.
  if (!db.settings.categoriesMigrees) {
    db.settings.categoriesDepenses = db.settings.categoriesDepenses.filter((c) => c !== "Local / loyer" && c !== "Logiciels / abonnements");
    db.settings.categoriesMigrees = true;
  }
  db.settings.chargesFixes = db.settings.chargesFixes || def.settings.chargesFixes;
  db.settings.profil = db.settings.profil || def.settings.profil;
  db.settings.tresorerie = db.settings.tresorerie || def.settings.tresorerie;
  db.settings.tresorerie.moisCoussin = db.settings.tresorerie.moisCoussin ?? 3;
  return db;
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const db = defaultDB();
      saveDB(db);
      return db;
    }
    return normalizeDB(JSON.parse(raw));
  } catch (e) {
    console.error("Erreur de lecture des données, réinitialisation.", e);
    const db = defaultDB();
    saveDB(db);
    return db;
  }
}

function saveDB(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
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

/* ============================= CHARGES FIXES ============================= */

function makeFixedEntry(charge, month) {
  return {
    id: uid(),
    date: `${month}-01`,
    categorie: charge.nom,
    montant: charge.montant,
    note: "",
    recurringId: charge.id,
    recurringMonth: month
  };
}

// Ajoute, pour chaque mois écoulé depuis la dernière génération, la charge fixe aux dépenses.
// Les entrées supprimées à la main ne reviennent pas : on avance genereJusqua au lieu de vérifier l'existence.
function ensureRecurringEntries() {
  const current = monthKey();
  let changed = false;
  DB.settings.chargesFixes.forEach((c) => {
    if (!(c.montant > 0) || !c.genereJusqua) return;
    let m = c.genereJusqua;
    while (m < current) {
      m = nextMonthKey(m);
      DB.depenses.push(makeFixedEntry(c, m));
      changed = true;
    }
    c.genereJusqua = m;
  });
  if (changed) saveDB(DB);
  return changed;
}

// À appeler après création ou modification d'une charge fixe pour synchroniser le mois en cours.
function syncFixedChargeNow(c) {
  const current = monthKey();
  const entry = DB.depenses.find((d) => d.recurringId === c.id && d.recurringMonth === current);
  if (c.montant > 0) {
    if (!c.genereJusqua) {
      DB.depenses.push(makeFixedEntry(c, current));
      c.genereJusqua = current;
    } else if (entry) {
      entry.montant = c.montant;
      entry.categorie = c.nom;
    }
  } else {
    if (entry) DB.depenses.splice(DB.depenses.indexOf(entry), 1);
    c.genereJusqua = null;
  }
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

document.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentEntryType = btn.dataset.entryType;
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
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
    if (echeanceDate(m.year, m.month) > today) {
      const cot = computeBilan(m.year, m.month).cotTotal;
      urssaf += cot;
      if (cot > 0) urssafMois.push(MOIS_FR[m.month].toLowerCase());
    }
  }

  const fixes = roundCents(DB.settings.chargesFixes.reduce((s, c) => s + (c.montant || 0), 0));
  let sommePonctuelles = 0;
  let moisAvecActivite = 0;
  for (let k = -3; k <= -1; k++) {
    const m = shiftMonth(now.getFullYear(), now.getMonth(), k);
    const b = computeBilan(m.year, m.month);
    const ponctuelles = b.depenses.filter((d) => !d.recurringId);
    if (b.prestas.length || ponctuelles.length) {
      sommePonctuelles += ponctuelles.reduce((s, d) => s + d.montant, 0);
      moisAvecActivite++;
    }
  }
  const ponctuellesMoy = moisAvecActivite ? roundCents(sommePonctuelles / moisAvecActivite) : 0;
  const mensuel = roundCents(fixes + ponctuellesMoy);
  const coussin = roundCents(mensuel * t.moisCoussin);
  urssaf = roundCents(urssaf);

  const configured = t.montant !== null && t.montant !== undefined;
  const salaire = configured ? Math.max(0, roundCents(t.montant - urssaf - coussin)) : 0;
  return {
    configured, montant: t.montant, date: t.date, moisCoussin: t.moisCoussin,
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
  let conseil;
  if (t.salaire > 0) {
    conseil = `Versez-vous <strong>${fmtEUR(t.salaire)}</strong> : il restera ${fmtEUR(t.resteApres)} sur le compte (${fmtEUR(t.urssaf)} pour l'URSSAF + ${fmtEUR(t.coussin)} de coussin).`;
  } else {
    conseil = `Pas de versement conseillé pour l'instant : il manque ${fmtEUR(t.manque)} pour couvrir l'URSSAF et le coussin.`;
  }
  body.innerHTML = `
    <div class="stat-row"><span>Trésorerie actuelle</span><strong>${fmtEUR(t.montant)}</strong></div>
    <div class="stat-row muted"><span>mise à jour le ${t.date ? t.date.split("-").reverse().join("/") : "—"}</span><span></span></div>
    <div class="stat-row"><span>À garder pour l'URSSAF${moisUrssaf}</span><span>- ${fmtEUR(t.urssaf)}</span></div>
    <div class="stat-row"><span>Coussin de sécurité (${t.moisCoussin} mois de charges)</span><span>- ${fmtEUR(t.coussin)}</span></div>
    <div class="stat-row total"><span>Salaire conseillé</span><strong>${fmtEUR(t.salaire)}</strong></div>
    <div class="hint">${conseil}</div>
    ${ageJours > 10 ? `<div class="hint" style="color:var(--danger)">Votre trésorerie date de ${ageJours} jours : mettez-la à jour pour un conseil fiable.</div>` : ""}
    ${t.fixes === 0 ? `<div class="hint" style="color:var(--danger)">Aucune charge fixe renseignée (Réglages) : le coussin est calculé à 0 €.</div>` : ""}
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
  const depenses = DB.depenses.filter((d) => inMonth(d.date, year, month)).sort(byDateAsc);

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
    ...DB.depenses.filter((d) => inMonth(d.date, histYear, histMonth)).map((d) => ({ ...d, kind: "depense" }))
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
    el.addEventListener("click", () => openEntryModal(item));
    list.appendChild(el);
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
      c.montant = Math.max(0, roundCents(parseNum(montantInput.value)));
      syncFixedChargeNow(c);
      saveDB(DB);
      updateFixedTotal();
    };
    nomInput.addEventListener("change", save);
    montantInput.addEventListener("change", save);
    row.querySelector("button").addEventListener("click", () => {
      const current = monthKey();
      DB.depenses = DB.depenses.filter((d) => !(d.recurringId === c.id && d.recurringMonth === current));
      DB.settings.chargesFixes = DB.settings.chargesFixes.filter((x) => x.id !== c.id);
      saveDB(DB);
      renderChargesFixes();
    });
    list.appendChild(row);
  });
  updateFixedTotal();
}

function renderTresorerieSettings() {
  const t = DB.settings.tresorerie;
  document.getElementById("tres-montant").value = t.montant ?? "";
  document.getElementById("tres-mois").value = t.moisCoussin;
  document.getElementById("tres-date").textContent = t.date ? `Mis à jour le ${t.date.split("-").reverse().join("/")}` : "Pas encore renseignée";
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
  saveDB(DB);
  renderTresorerieSettings();
  showToast("Trésorerie enregistrée ✓");
});

function updateFixedTotal() {
  const total = roundCents(DB.settings.chargesFixes.reduce((s, c) => s + (c.montant || 0), 0));
  document.getElementById("fixed-total").textContent = fmtEUR(total);
  updateCoussinPreview();
}

document.getElementById("btn-add-fixed").addEventListener("click", () => {
  const nom = document.getElementById("new-fixed-nom").value.trim();
  const montant = Math.max(0, roundCents(parseNum(document.getElementById("new-fixed-montant").value)));
  if (!nom) { showToast("Indiquez un nom"); return; }
  const charge = { id: uid(), nom, montant, genereJusqua: null };
  DB.settings.chargesFixes.push(charge);
  syncFixedChargeNow(charge);
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
      DB = normalizeDB(imported);
      ensureRecurringEntries();
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
  const prestas = DB.prestations.filter((p) => inMonth(p.date, bilanYear, bilanMonth));
  const depenses = DB.depenses.filter((d) => inMonth(d.date, bilanYear, bilanMonth));
  let csv = "Type;Date;Libellé;Mode;Montant facturé;Montant perçu\n";
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

ensureRecurringEntries();
document.getElementById("prestation-date").value = todayISO();
document.getElementById("depense-date").value = todayISO();
renderTypeGrid();
renderCategorieSelect();
showScreen("saisie");

// L'appli installée peut rester ouverte en arrière-plan à cheval sur deux mois.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && ensureRecurringEntries()) showScreen(currentScreen);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}
