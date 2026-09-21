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
        { id: uid(), nom: "Première consultation / bilan", tarif: 70 },
        { id: uid(), nom: "Consultation de suivi", tarif: 45 },
        { id: uid(), nom: "Consultation en ligne", tarif: 40 },
        { id: uid(), nom: "Bilan complet", tarif: 90 }
      ],
      categoriesDepenses: ["Fournitures", "Local / loyer", "Déplacements", "Formation", "Logiciels / abonnements", "Autre"]
    }
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const db = defaultDB();
      saveDB(db);
      return db;
    }
    const db = JSON.parse(raw);
    db.prestations = db.prestations || [];
    db.depenses = db.depenses || [];
    db.settings = db.settings || defaultDB().settings;
    db.settings.urssaf = db.settings.urssaf || defaultDB().settings.urssaf;
    db.settings.sumupRate = db.settings.sumupRate ?? 1.75;
    db.settings.typesPrestations = db.settings.typesPrestations || [];
    db.settings.categoriesDepenses = db.settings.categoriesDepenses || [];
    return db;
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
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
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

/* ============================= NAVIGATION ============================= */

const SCREENS = ["saisie", "bilan", "historique", "reglages"];
const TITLES = { saisie: "Compta Lulu", bilan: "Bilan mensuel", historique: "Historique", reglages: "Réglages" };

function showScreen(name) {
  SCREENS.forEach((s) => {
    document.getElementById(`screen-${s}`).classList.toggle("hidden", s !== name);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === name);
  });
  document.getElementById("topbar-title").textContent = TITLES[name];
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
    const d = new Date();
    if (kind === "yesterday") d.setDate(d.getDate() - 1);
    const iso = isoFromDate(d);
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
  const sumupRate = DB.settings.sumupRate;
  const fee = selectedMode === "CB" ? roundCents(montant * (sumupRate / 100)) : 0;
  const montantPercu = roundCents(montant - fee);

  DB.prestations.push({
    id: uid(),
    date,
    typeLabel: typeObj ? typeObj.nom : "Prestation",
    montant,
    mode: selectedMode,
    sumupRateApplied: selectedMode === "CB" ? sumupRate : 0,
    montantPercu,
    note: document.getElementById("prestation-note").value.trim()
  });
  saveDB(DB);
  showToast("Prestation enregistrée ✓");

  // reset for fast repeated entry, keep date and type selection
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

function nextEcheance(year, month) {
  // Règle observée sur l'attestation URSSAF : recettes du mois M
  // -> prélèvement estimé le 2 du mois M+2. A vérifier sur l'espace URSSAF.
  let m = month + 2;
  let y = year;
  if (m > 11) { m -= 12; y += 1; }
  const d = new Date(y, m, 2);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function renderBilan() {
  document.getElementById("month-label").textContent = monthLabel(bilanYear, bilanMonth);

  const prestas = DB.prestations.filter((p) => inMonth(p.date, bilanYear, bilanMonth));
  const depenses = DB.depenses.filter((d) => inMonth(d.date, bilanYear, bilanMonth));

  const ca = roundCents(prestas.reduce((s, p) => s + p.montant, 0));
  const percu = roundCents(prestas.reduce((s, p) => s + p.montantPercu, 0));
  const frais = roundCents(ca - percu);

  const rates = DB.settings.urssaf;
  const cot1 = roundCents(ca * (rates.cotisations / 100));
  const cot2 = roundCents(ca * (rates.irLiberatoire / 100));
  const cot3 = roundCents(ca * (rates.formationPro / 100));
  const cotTotal = roundCents(cot1 + cot2 + cot3);

  const totalDepenses = roundCents(depenses.reduce((s, d) => s + d.montant, 0));
  const net = roundCents(percu - cotTotal - totalDepenses);

  document.getElementById("stat-ca").textContent = fmtEUR(ca);
  document.getElementById("stat-percu").textContent = fmtEUR(percu);
  document.getElementById("stat-frais").textContent = fmtEUR(frais);

  document.getElementById("label-cot1").textContent = `Cotisations sociales (${rates.cotisations}%)`;
  document.getElementById("label-cot2").textContent = `Versement libératoire IR (${rates.irLiberatoire}%)`;
  document.getElementById("label-cot3").textContent = `Formation professionnelle (${rates.formationPro}%)`;
  document.getElementById("stat-cot1").textContent = fmtEUR(cot1);
  document.getElementById("stat-cot2").textContent = fmtEUR(cot2);
  document.getElementById("stat-cot3").textContent = fmtEUR(cot3);
  document.getElementById("stat-cot-total").textContent = fmtEUR(cotTotal);
  document.getElementById("stat-echeance").textContent =
    `Échéance de paiement estimée : ${nextEcheance(bilanYear, bilanMonth)} (vérifiez la date exacte sur votre espace urssaf.fr)`;

  document.getElementById("stat-depenses").textContent = fmtEUR(totalDepenses);
  document.getElementById("stat-net").textContent = fmtEUR(net);

  const repartition = {};
  prestas.forEach((p) => { repartition[p.mode] = (repartition[p.mode] || 0) + p.montant; });
  const repList = document.getElementById("repartition-list");
  repList.innerHTML = "";
  const modes = Object.keys(repartition);
  if (modes.length === 0) {
    repList.innerHTML = `<div class="empty-state">Aucune prestation ce mois-ci</div>`;
  } else {
    modes.forEach((mode) => {
      const row = document.createElement("div");
      row.className = "stat-row";
      row.innerHTML = `<span>${escapeHtml(mode)}</span><span>${fmtEUR(repartition[mode])}</span>`;
      repList.appendChild(row);
    });
  }
}

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
          <div class="entry-sub">${item.note ? escapeHtml(item.note) : "Dépense"}</div>
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
        ${DB.settings.categoriesDepenses.map((c) => `<option value="${escapeAttr(c)}" ${c === item.categorie ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
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
    if (idx !== -1) arr[idx] = { ...arr[idx], ...item };
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
  downloadBlob(blob, `compta-lulu-sauvegarde-${todayISO()}.json`);
});

document.getElementById("btn-import").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported.prestations || !imported.depenses || !imported.settings) throw new Error("format invalide");
      DB = imported;
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
  downloadBlob(blob, `compta-lulu-${monthLabel(bilanYear, bilanMonth).replace(" ", "-").toLowerCase()}.csv`);
});

function csvSafe(s) { return String(s).replace(/;/g, ","); }

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

document.getElementById("prestation-date").value = todayISO();
document.getElementById("depense-date").value = todayISO();
renderTypeGrid();
renderCategorieSelect();
showScreen("saisie");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}
