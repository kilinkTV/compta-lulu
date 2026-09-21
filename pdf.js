"use strict";

/* Générateur PDF minimal (polices standard Helvetica, encodage WinAnsi), sans dépendance. */

const PDF_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const PDF_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const PDF_WIN = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "œ": 0x9c, "Œ": 0x8c };

function pdfNorm(str) {
  return String(str).replace(/[  \r\n\t]/g, " ");
}

function pdfCharWidth(ch, bold) {
  const table = bold ? PDF_BOLD : PDF_REG;
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return table[code - 32];
  if (ch === "€") return 556;
  if (ch === "’") return bold ? 278 : 222;
  if (ch === "—") return 1000;
  if (ch === "·") return bold ? 333 : 278;
  const base = ch.normalize("NFD").charCodeAt(0);
  if (base >= 32 && base <= 126) return table[base - 32];
  return 556;
}

function pdfTextWidth(str, size, bold) {
  let w = 0;
  for (const ch of pdfNorm(str)) w += pdfCharWidth(ch, bold);
  return (w * size) / 1000;
}

function pdfEncode(str) {
  let out = "";
  for (const ch of pdfNorm(str)) {
    const code = ch.charCodeAt(0);
    let b = PDF_WIN[ch] !== undefined ? PDF_WIN[ch] : code < 256 ? code : 63;
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\";
    out += String.fromCharCode(b);
  }
  return out;
}

function pdfColor(c) {
  return c.map((v) => v.toFixed(3)).join(" ");
}

// Les coordonnées y de l'API sont mesurées depuis le haut de la page.
function createPdfDoc() {
  const W = 595.28;
  const H = 841.89;
  const pages = [];
  let ops = null;
  const f = (n) => n.toFixed(2);

  return {
    W,
    H,
    newPage() {
      ops = [];
      pages.push(ops);
    },
    text(str, x, y, o = {}) {
      const size = o.size || 10;
      const bold = !!o.bold;
      const px = o.align === "right" ? x - pdfTextWidth(str, size, bold) : x;
      ops.push(`${pdfColor(o.color || [0, 0, 0])} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${f(px)} ${f(H - y)} Td (${pdfEncode(str)}) Tj ET`);
    },
    line(x1, y1, x2, y2, o = {}) {
      ops.push(`${pdfColor(o.color || [0.86, 0.87, 0.85])} RG ${o.width || 0.5} w ${f(x1)} ${f(H - y1)} m ${f(x2)} ${f(H - y2)} l S`);
    },
    rect(x, y, w, h, color) {
      ops.push(`${pdfColor(color)} rg ${f(x)} ${f(H - y - h)} ${f(w)} ${f(h)} re f`);
    },
    fit(str, maxW, size, bold) {
      let s = pdfNorm(str);
      if (pdfTextWidth(s, size, bold) <= maxW) return s;
      while (s.length > 1 && pdfTextWidth(s + "...", size, bold) > maxW) s = s.slice(0, -1);
      return s.trimEnd() + "...";
    },
    build(title, footer) {
      if (footer) {
        pages.forEach((p, i) => {
          ops = p;
          footer(i + 1, pages.length);
        });
      }
      const objects = [];
      objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
      objects[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${6 + 2 * i} 0 R`).join(" ")}] /Count ${pages.length} >>`;
      objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
      objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
      objects[5] = `<< /Title (${pdfEncode(title)}) /Producer (Compta Lulu) >>`;
      pages.forEach((p, i) => {
        const stream = p.join("\n");
        objects[6 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + 2 * i} 0 R >>`;
        objects[7 + 2 * i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      });

      let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
      const offsets = [];
      for (let id = 1; id < objects.length; id++) {
        offsets[id] = out.length;
        out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
      }
      const xref = out.length;
      out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
      for (let id = 1; id < objects.length; id++) {
        out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
      }
      out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF`;

      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
      return bytes;
    }
  };
}

/* ---------------------------- Mise en page du bilan ---------------------------- */

function pdfEUR(n) {
  return (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function pdfPct(n) {
  return String(n).replace(".", ",");
}

function pdfDate(iso) {
  return iso.split("-").reverse().join("/");
}

function buildBilanPdf(d, profil) {
  const doc = createPdfDoc();
  const M = 42;
  const R = doc.W - M;
  // Charte lucile-diet.fr : profond #5C3D2E, brun #8B6343, texte #3A2A1E, fonds #F0E6D8 / #F5EFE6
  const PROFOND = [0.361, 0.239, 0.18];
  const TEAL = [0.545, 0.388, 0.263];
  const DARK = [0.227, 0.165, 0.118];
  const MUTED = [0.545, 0.388, 0.263];
  const SOFT = [0.941, 0.902, 0.847];
  const HEADBG = [0.961, 0.937, 0.902];
  let y = 0;

  const newPage = () => {
    doc.newPage();
    y = 52;
  };
  const ensureSpace = (h) => {
    if (y + h > doc.H - 56) newPage();
  };
  const section = (title) => {
    ensureSpace(70);
    y += 8;
    doc.text(title, M, y, { size: 12, bold: true, color: DARK });
    doc.line(M, y + 6, R, y + 6, { color: TEAL, width: 1 });
    y += 26;
  };
  const row = (label, value, o = {}) => {
    ensureSpace(22);
    const color = o.muted ? MUTED : DARK;
    doc.text(label, M, y, { size: 10.5, bold: o.bold, color });
    doc.text(value, R, y, { size: 10.5, bold: o.bold, color, align: "right" });
    y += 19;
  };
  const note = (str) => {
    ensureSpace(20);
    doc.text(str, M, y, { size: 8.5, color: MUTED });
    y += 16;
  };
  const tableHeader = (cols) => {
    doc.rect(M, y - 12, R - M, 18, HEADBG);
    cols.forEach((c) => doc.text(c.label, c.x, y, { size: 9, bold: true, color: MUTED, align: c.align }));
    y += 19;
  };
  const table = (cols, rows) => {
    ensureSpace(60);
    tableHeader(cols);
    rows.forEach((cells) => {
      if (y > doc.H - 62) {
        newPage();
        tableHeader(cols);
      }
      cols.forEach((c, i) => {
        const txt = c.w ? doc.fit(cells[i], c.w, 9.5, false) : cells[i];
        doc.text(txt, c.x, y, { size: 9.5, color: DARK, align: c.align });
      });
      doc.line(M, y + 5, R, y + 5);
      y += 17;
    });
  };

  newPage();
  const CREME = [0.992, 0.98, 0.965];
  doc.rect(0, 0, doc.W, 84, PROFOND);
  doc.text("Bilan mensuel", M, 38, { size: 20, bold: true, color: CREME });
  doc.text(d.monthLabel, M, 60, { size: 13, color: CREME });
  if (profil && profil.nom) doc.text(profil.nom, R, 38, { size: 11, bold: true, color: CREME, align: "right" });
  if (profil && profil.siret) doc.text("SIRET " + profil.siret, R, 54, { size: 9, color: CREME, align: "right" });
  y = 106;

  section("Répartition par mode de paiement");
  const modes = Object.keys(d.repartition);
  if (modes.length === 0) {
    note("Aucune prestation ce mois-ci.");
  } else {
    table(
      [
        { label: "Mode", x: M },
        { label: "Prestations", x: 330, align: "right" },
        { label: "Montant facturé", x: R, align: "right" }
      ],
      modes.map((m) => [m === "CB" ? "CB (SumUp)" : m, String(d.repartition[m].count), pdfEUR(d.repartition[m].total)])
    );
  }

  section("Résumé du mois");
  row("Chiffre d'affaires (à déclarer à l'URSSAF)", pdfEUR(d.ca), { bold: true });
  row("Commissions SumUp sur les paiements CB", "- " + pdfEUR(d.frais), { muted: true });
  row("Total réellement perçu", pdfEUR(d.percu), { bold: true });

  section("Cotisations URSSAF estimées");
  row(`Cotisations sociales (${pdfPct(d.rates.cotisations)} %)`, pdfEUR(d.cot1));
  row(`Versement libératoire de l'impôt sur le revenu (${pdfPct(d.rates.irLiberatoire)} %)`, pdfEUR(d.cot2));
  row(`Formation professionnelle (${pdfPct(d.rates.formationPro)} %)`, pdfEUR(d.cot3));
  row("Total à payer à l'URSSAF", pdfEUR(d.cotTotal), { bold: true });
  note(`Échéance de paiement estimée : ${d.echeance} (à vérifier sur urssaf.fr)`);

  section("Dépenses");
  row("Charges fixes (loyer, assurances, abonnements)", pdfEUR(d.depensesFixes));
  row("Autres dépenses", pdfEUR(d.autresDepenses));
  row("Total dépenses", pdfEUR(d.totalDepenses), { bold: true });

  ensureSpace(60);
  y += 6;
  doc.rect(M, y - 16, R - M, 38, SOFT);
  doc.text("Reste net réel", M + 12, y + 1, { size: 12, bold: true, color: DARK });
  doc.text("perçu - cotisations URSSAF - dépenses", M + 12, y + 14, { size: 8.5, color: MUTED });
  doc.text(pdfEUR(d.net), R - 12, y + 6, { size: 15, bold: true, color: TEAL, align: "right" });
  y += 40;

  section("Détail des prestations");
  if (d.prestas.length === 0) {
    note("Aucune prestation ce mois-ci.");
  } else {
    table(
      [
        { label: "Date", x: M },
        { label: "Prestation", x: 116, w: 205 },
        { label: "Mode", x: 330 },
        { label: "Facturé", x: 468, align: "right" },
        { label: "Perçu", x: R, align: "right" }
      ],
      d.prestas.map((p) => [pdfDate(p.date), p.typeLabel, p.mode === "CB" ? "CB" : p.mode, pdfEUR(p.montant), pdfEUR(p.montantPercu)])
    );
  }

  section("Détail des dépenses");
  if (d.depenses.length === 0) {
    note("Aucune dépense ce mois-ci.");
  } else {
    table(
      [
        { label: "Date", x: M },
        { label: "Libellé", x: 116, w: 230 },
        { label: "Type", x: 360 },
        { label: "Montant", x: R, align: "right" }
      ],
      d.depenses.map((e) => [pdfDate(e.date), e.categorie, e.recurringId ? "Charge fixe" : "Ponctuelle", pdfEUR(e.montant)])
    );
  }

  const today = pdfDate(isoFromDate(new Date()));
  return doc.build(`Bilan ${d.monthLabel}`, (page, total) => {
    doc.line(M, doc.H - 42, R, doc.H - 42);
    doc.text(`Généré avec Compta Lulu le ${today}`, M, doc.H - 28, { size: 8, color: MUTED });
    doc.text(`Page ${page} / ${total}`, R, doc.H - 28, { size: 8, color: MUTED, align: "right" });
  });
}
