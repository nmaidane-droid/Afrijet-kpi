// Module Commercial — devis calculés et enregistrés par le serveur.
// La page lit les devis mais ne peut plus les écrire (script s3) : chaque écriture passe ici,
// avec les Paramètres enregistrés dans la base, que la page peut lire mais pas écrire (script s2).
// Opérations : etat (paramètres), texte (introduction par l'IA), creer (devis), envoye, accepte,
// importer (devis de Fiches Airshow), restaurer (sauvegarde, Administrateur), params (Administrateur).
// Variables : SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET, ANTHROPIC_API_KEY, ALLOWED_ORIGIN (facultatif)
import { lire, originOk } from "./auth.js";
export const config = { maxDuration: 10 };

const PFX = "ajs135v1_";
const MODEL = "claude-haiku-4-5-20251001";            // même modèle qu'Airshow : court, sous la limite de 10 s
// Tarification du carburant (2.18) : l'heure de vol comprend le carburant au prix du Maroc ;
// un départ de l'étranger ajoute l'écart de prix (Carburant Étranger − Carburant Maroc) sur les litres du vol.
export const DEFAUTS = { tarifVol: 75000, tarifImmo: 75000, immoMin: 2, fuelMaroc: 12.5, fuelEtranger: 16.4, conso: 1100, signataire: "Hicham QADRI" };
export const REGLES = { RANGE: 1750, AIRWAYS: 1.10, VALID: 15, BASE: { icao: "GMME", ville: "Rabat" }, MAX_LIGNES: 9 };
const PROFILS_DEVIS = ["comm", "rdoa"];
const PROFILS_LECTURE = ["comm", "rdoa", "dir"];

// ── Accès aux données, avec la clé de service (jamais exposée à la page)
async function kvGet(key) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(PFX + key)}&select=value`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } });
  if (!r.ok) throw new Error("lecture " + key + " : " + r.status);
  const rows = await r.json();
  let v = rows?.[0]?.value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* valeur brute */ } }
  return v && typeof v === "object" && !Array.isArray(v) && "__v" in v ? v.__v : v;
}
// Même enveloppe {__v, __t} que la page : elle relit la valeur sans conversion
async function kvSet(key, value) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key: PFX + key, value: JSON.stringify({ __v: value, __t: Date.now() }) }),
  });
  if (!r.ok) throw new Error("écriture " + key + " : " + r.status);
}

const str = (v, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ── Paramètres : contrôles identiques à api/variables.js d'Airshow, plus le carburant et le signataire
export function paramsValides(b) {
  if (!b || typeof b !== "object") return null;
  const dec = (v, min, max) => { const n = Math.round(Number(String(v).replace(",", ".")) * 100) / 100; return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const ent = (v, min, max) => { const s = String(v).replace(/\s/g, ""); if (s === "") return null; const n = Math.round(Number(s)); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const r = { tarifVol: ent(b.tarifVol, 1000, 1000000), tarifImmo: ent(b.tarifImmo, 0, 1000000), immoMin: ent(b.immoMin, 0, 24),
    fuelMaroc: dec(b.fuelMaroc, 0.1, 100), fuelEtranger: dec(b.fuelEtranger, 0.1, 100), conso: ent(b.conso, 100, 10000),
    signataire: String(b.signataire || "").trim().slice(0, 80) };
  if (Object.values(r).some(v => v === null) || r.signataire.length < 2) return null;
  return r;
}
export async function lireParams() {
  let v = null; try { v = await kvGet("comParams"); } catch { /* valeurs par défaut */ }
  const P = Object.assign({}, DEFAUTS, v && typeof v === "object" ? v : {});
  delete P.fuelRef;                                     // ancienne valeur de référence (indice mondial), plus utilisée
  return P;
}

// ── Carburant par aéroport de départ. Aéroport « Maroc » : code OACI commençant par GM
// (Laâyoune, Dakhla, Smara compris) ; sinon « Étranger ». Chaque vol fait le plein à son départ.
// Litres = heures de vol × consommation (au litre) ; supplément = litres × (prix − Carburant Maroc), au dirham.
// Calcul en centimes : 2 493 L × 3,90 donne 9 723 MAD, sans erreur d'arrondi des décimaux.
export const estMaroc = icao => /^GM/.test(String(icao || "").toUpperCase());
export const prixValide = v => { const n = Math.round(Number(String(v).replace(",", ".")) * 100) / 100; return Number.isFinite(n) && n >= 0.1 && n <= 100 ? n : null; };
export function carburantDevis(lignes, V, force) {
  const parApt = new Map();
  (lignes || []).filter(l => l && l.type !== "immo" && l.type !== "fuel").forEach(l => {
    const k = l.de.icao; if (!parApt.has(k)) parApt.set(k, { icao: k, ville: l.de.ville, vols: [], min: 0 });
    const a = parApt.get(k); a.vols.push(l.libelle); a.min += l.minutes; });
  const cts = x => Math.round(Number(x) * 100);
  const aeroports = [...parApt.values()].map(a => {
    const zone = estMaroc(a.icao) ? "maroc" : "etranger", prixStandard = zone === "maroc" ? V.fuelMaroc : V.fuelEtranger;
    const f = force && force[a.icao] != null ? prixValide(force[a.icao]) : null, prix = f != null ? f : prixStandard;
    const litres = Math.round(a.min / 60 * V.conso);
    return { icao: a.icao, ville: a.ville, zone, vols: a.vols, litres, prixStandard, prix, force: f != null,
      supplement: Math.round(litres * (cts(prix) - cts(V.fuelMaroc)) / 100) || 0 };
  });
  return { aeroports, litres: aeroports.reduce((s, a) => s + a.litres, 0), supplement: aeroports.reduce((s, a) => s + a.supplement, 0) };
}

// ── Calcul d'un devis. Vols et immobilisation : identiques à l'opération « creer » d'api/devis.js d'Airshow.
// Même tarif horaire sur tous les vols ; immobilisation sans carburant ; supplément carburant (départs de l'étranger).
// Pur (sans accès réseau) : testé avec les devis réels d'Airshow et l'exemple validé le 30/09/2026.
export function calculerDevis(d, V, { auteur, numero, version, now, id }) {
  if (!d || !Array.isArray(d.lignes) || !d.lignes.length || d.lignes.length > REGLES.MAX_LIGNES + 1) return { erreur: "devis" };
  // Rayon d'action de CN-KTA : aucun devis si un vol dépasse 1 750 NM de route (distance directe + 10 %)
  if (d.lignes.some(l => l && l.type !== "immo" && l.type !== "fuel" && Math.round(num(l.distance) * REGLES.AIRWAYS) > REGLES.RANGE)) return { erreur: "hors_range" };
  const lignes = d.lignes.filter(l => l && l.type !== "fuel").map(l => ({
    type: str(l.type, 20), libelle: str(l.libelle, 60), jours: Math.max(0, Math.round(num(l.jours))),
    de: { icao: str(l.de && l.de.icao, 4).toUpperCase(), ville: str(l.de && l.de.ville, 60) },
    vers: { icao: str(l.vers && l.vers.icao, 4).toUpperCase(), ville: str(l.vers && l.vers.ville, 60) },
    national: !!l.national, passagers: !!l.passagers,
    distance: Math.round(num(l.distance)), minutes: Math.max(1, Math.round(num(l.minutes))), montant: 0,
  }));
  if (!lignes.length || lignes.length > REGLES.MAX_LIGNES) return { erreur: "devis" };
  // Montants recalculés avec les Paramètres enregistrés (jamais ceux du téléphone)
  lignes.forEach(l => {
    if (l.type === "immo") { l.minutes = l.jours * V.immoMin * 60; l.montant = Math.round(l.jours * V.immoMin * V.tarifImmo); }
    else l.montant = Math.round(l.minutes / 60 * V.tarifVol);
  });
  // Prix forcés pour CE devis (0,10 à 100 MAD/L), seulement sur un aéroport de départ du devis
  const force = {};
  if (d.fuelForce && typeof d.fuelForce === "object") for (const [k, v] of Object.entries(d.fuelForce)) {
    const n = prixValide(v); if (/^[A-Z0-9]{4}$/.test(k) && n != null) force[k] = n; }
  const C = carburantDevis(lignes, V, force);
  const carb = { modele: 2, maroc: V.fuelMaroc, etranger: V.fuelEtranger, conso: V.conso, litres: C.litres, supplement: C.supplement,
    aeroports: C.aeroports, forcePar: C.aeroports.some(a => a.force) ? auteur || null : null };
  // Supplément nul : aucune ligne. Le supplément suit la règle de TVA du devis.
  if (C.supplement !== 0) lignes.push({ type: "fuel", libelle: "Supplément carburant", jours: 0, de: { icao: "", ville: "" }, vers: { icao: "", ville: "" },
    national: lignes.every(l => l.national), passagers: false, distance: 0, minutes: 0, montant: C.supplement });
  const totalHT = lignes.reduce((s, l) => s + l.montant, 0);
  const national = lignes.every(l => l.national);
  const tva = national ? Math.round(totalHT * 0.2) : 0;
  const c = d.client || {};
  return { devis: {
    id, numero, version, ficheId: str(d.ficheId, 40), date: now,
    validite: new Date(Date.parse(now) + REGLES.VALID * 86400000).toISOString(),
    client: { nom: str(c.nom), fonction: str(c.fonction), organisation: str(c.organisation), tel: str(c.tel, 40), email: str(c.email, 120) },
    intro: str(d.intro, 900), tarif: V.tarifVol, tarifImmo: V.tarifImmo, immoMin: V.immoMin, carburant: carb,
    immobilisation: Math.max(1, Math.round(num(d.immobilisation)) || 1),
    lignes, totalHT, national, tva, ttc: totalHT + tva,
    base: { icao: str(d.base && d.base.icao, 4) || REGLES.BASE.icao, ville: str(d.base && d.base.ville, 60) || REGLES.BASE.ville },
    retour: { icao: str(d.retour && d.retour.icao, 4) || REGLES.BASE.icao, ville: str(d.retour && d.retour.ville, 60) || REGLES.BASE.ville },
    suiviPar: V.signataire, signataire: V.signataire, creePar: auteur, envoye: null, source: "kpi",
  } };
}

// Numéro : suite de la numérotation d'Airshow (DEV-AAAA-NNNN). Une nouvelle version garde le numéro.
export function numeroter(existants, seq, parent, annee) {
  if (parent) {
    const memes = (existants || []).filter(x => x.numero === parent);
    if (!memes.length) return { erreur: "parent" };
    return { numero: parent, version: Math.max(...memes.map(x => Number(x.version) || 1)) + 1, seq };
  }
  const n = (existants || []).map(d => /^DEV-\d{4}-(\d+)$/.exec(String(d.numero || ""))).filter(Boolean).map(m => Number(m[1]));
  const suivant = Math.max(Number(seq) || 0, n.length ? Math.max(...n) : 0) + 1;
  return { numero: "DEV-" + annee + "-" + String(suivant).padStart(4, "0"), version: 1, seq: suivant };
}

// ── Liste des devis (clé devis) : seul le serveur l'écrit (script s3). Opérations pures, testées.
// Devis d'Airshow importé : gardé tel quel (supplément compris) ; contrôle de forme seulement.
export function devisImportable(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  if (typeof d.id !== "string" || !d.id || d.id.length > 60) return false;
  if (!/^DEV-\d{4}-\d{1,6}$/.test(String(d.numero || ""))) return false;
  if (!Array.isArray(d.lignes) || d.lignes.length > 12) return false;
  try { return JSON.stringify(d).length <= 30000; } catch { return false; }
}
// Règles d'Airshow (comme comFusionImport de la page) : on ajoute ce qui manque, on reprend l'envoi, on ne supprime rien
export function fusionImport(existants, importes) {
  const liste = Array.isArray(existants) ? existants.slice() : [];
  const R = { nouveaux: 0, maj: 0, identiques: 0, refuses: 0 };
  (Array.isArray(importes) ? importes : []).forEach(d => {
    if (!devisImportable(d)) { R.refuses++; return; }
    const i = liste.findIndex(x => x && x.id === d.id);
    if (i < 0) { liste.push({ ...d, source: "airshow" }); R.nouveaux++; }
    else if (d.envoye && !liste[i].envoye) { liste[i] = { ...liste[i], envoye: d.envoye }; R.maj++; }
    else R.identiques++;
  });
  return { liste, rapport: R };
}
// Devis envoyé ou accepté : date et auteur posés par le serveur, une seule fois
export function marquerDevis(existants, id, champ, now, auteur) {
  const liste = Array.isArray(existants) ? existants.slice() : [];
  const i = liste.findIndex(x => x && x.id === id);
  if (i < 0) return { erreur: "introuvable" };
  if (liste[i][champ]) return { liste, devis: liste[i], inchange: true };
  liste[i] = { ...liste[i], [champ]: { date: now, auteur } };
  return { liste, devis: liste[i] };
}
// Restauration d'une sauvegarde : la liste entière est remplacée (Administrateur)
export function listeRestaurable(v) {
  if (!Array.isArray(v) || v.length > 5000) return null;
  if (!v.every(d => d && typeof d === "object" && !Array.isArray(d) && typeof d.id === "string" && d.id)) return null;
  try { if (JSON.stringify(v).length > 8000000) return null; } catch { return null; }
  return v;
}
// Lecture, modification, écriture, puis relecture : si une autre écriture a effacé la nôtre, on recommence
async function majDevis(fn, verifier) {
  for (let essai = 0; essai < 3; essai++) {
    const ex = await kvGet("devis").catch(() => null);
    const r = fn(Array.isArray(ex) ? ex : []);
    if (r.erreur || r.inchange) return r;
    await kvSet("devis", r.liste);
    const relu = await kvGet("devis").catch(() => null);
    if (Array.isArray(relu) && verifier(relu, r)) return r;
  }
  return { erreur: "concurrence" };
}

// ── Introduction rédigée par l'IA : consigne identique à Airshow
export function consigne(c) {
  return `Tu rédiges le paragraphe d'introduction d'un devis d'affrètement aérien de la compagnie AFRIJET Sahara (Embraer EMB-140 LR, 18 sièges affaires), adressé à un prospect.
Informations sur le prospect :
- Nom : ${str(c.nom)} ; fonction : ${str(c.fonction)} ; organisation : ${str(c.organisation)}
- Trajet demandé : ${str(c.trajet)}
- Taille habituelle du groupe : ${str(c.groupe)} ; fréquence : ${str(c.frequence)} ; type de vol : ${str(c.types)}
- Notes du commercial : ${str(c.notes, 1500)}
Consignes :
- 2 ou 3 phrases, en français, ton professionnel et chaleureux, vouvoiement.
- Commence par « Suite à notre échange, ».
- Reprends le besoin concret du prospect s'il est connu. N'invente rien.
- Ne mentionne aucun salon ni événement, aucun prix, montant, durée, date ni condition (ils figurent dans le tableau).
- Pas de formule de politesse finale, pas de signature.
Réponds uniquement avec le paragraphe.`;
}
async function texteIA(c) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "cle_absente" };
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8500);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: "user", content: consigne(c || {}) }] }),
    });
    clearTimeout(timer);
    let j = {}; try { j = await r.json(); } catch { /* réponse vide */ }
    if (!r.ok) return { error: "ia", status: r.status, detail: str((j.error && j.error.message) || "", 300) };
    const t = (j.content || []).map(x => x.text || "").join("").trim();
    return t ? { texte: t.slice(0, 900) } : { error: "vide" };
  } catch (e) {
    clearTimeout(timer);
    return e.name === "AbortError" ? { error: "delai" } : { error: "reseau", detail: str(String(e.message || e), 200) };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!originOk(req)) { res.status(403).json({ error: "origine non autorisée" }); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "méthode" }); return; }
  const secret = process.env.SESSION_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_KEY || !process.env.SUPABASE_URL) { res.status(500).json({ error: "configuration serveur incomplète" }); return; }
  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); } catch { res.status(400).json({ error: "requête" }); return; }
  const p = lire(body.token, secret);
  if (!p || p.etape) { res.status(401).json({ error: "session expirée" }); return; }
  const auteur = [p.prenom, p.nom].filter(Boolean).join(" ").trim() || p.uid;
  const peut = liste => liste.includes(p.profil);
  const now = () => new Date().toISOString();
  try {
    if (body.op === "etat") {
      if (!peut(PROFILS_LECTURE)) { res.status(403).json({ error: "profil" }); return; }
      res.status(200).json({ params: await lireParams() }); return;
    }
    if (body.op === "texte") {
      if (!peut(PROFILS_DEVIS)) { res.status(403).json({ error: "profil" }); return; }
      const r = await texteIA(body.contexte || {});
      res.status(r.error ? (r.error === "cle_absente" ? 500 : 502) : 200).json(r); return;
    }
    if (body.op === "creer") {
      if (!peut(PROFILS_DEVIS)) { res.status(403).json({ error: "profil" }); return; }
      const [V, existants, seq] = await Promise.all([lireParams(), kvGet("devis").catch(() => []), kvGet("comSeq").catch(() => 0)]);
      const date = now();
      const nu = numeroter(Array.isArray(existants) ? existants : [], seq, str(body.devis && body.devis.numeroParent, 20), new Date().getUTCFullYear());
      if (nu.erreur) { res.status(400).json({ error: nu.erreur }); return; }
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const r = calculerDevis(body.devis, V, { auteur, numero: nu.numero, version: nu.version, now: date, id });
      if (r.erreur) { res.status(400).json({ error: r.erreur }); return; }
      if (nu.version === 1) await kvSet("comSeq", nu.seq);   // numéro réservé, même si l'enregistrement échoue
      const w = await majDevis(L => ({ liste: [...L, r.devis] }), L => L.some(x => x && x.id === id));
      if (w.erreur) { res.status(409).json({ error: w.erreur }); return; }
      res.status(201).json({ devis: r.devis }); return;
    }
    if (body.op === "envoye" || body.op === "accepte") {
      if (!peut(PROFILS_DEVIS)) { res.status(403).json({ error: "profil" }); return; }
      const id = str(body.id, 60), date = now();
      if (!id) { res.status(400).json({ error: "devis" }); return; }
      const w = await majDevis(L => marquerDevis(L, id, body.op, date, auteur), L => L.some(x => x && x.id === id && x[body.op]));
      if (w.erreur) { res.status(w.erreur === "introuvable" ? 404 : 409).json({ error: w.erreur }); return; }
      res.status(200).json({ devis: w.devis, inchange: !!w.inchange }); return;
    }
    if (body.op === "importer") {
      if (!peut(PROFILS_DEVIS)) { res.status(403).json({ error: "profil" }); return; }
      if (!Array.isArray(body.devis)) { res.status(400).json({ error: "devis" }); return; }
      let rapport = null;
      const w = await majDevis(L => { const f = fusionImport(L, body.devis); rapport = f.rapport; return { liste: f.liste, inchange: !f.rapport.nouveaux && !f.rapport.maj }; },
        L => body.devis.filter(devisImportable).every(d => L.some(x => x && x.id === d.id)));
      if (w.erreur) { res.status(409).json({ error: w.erreur }); return; }
      res.status(200).json({ devis: w.liste, rapport }); return;
    }
    if (body.op === "restaurer") {
      if (p.profil !== "rdoa") { res.status(403).json({ error: "réservé à l'Administrateur" }); return; }
      const v = listeRestaurable(body.devis);
      if (!v) { res.status(400).json({ error: "devis" }); return; }
      await kvSet("devis", v);
      res.status(200).json({ devis: v }); return;
    }
    if (body.op === "params") {
      if (p.profil !== "rdoa") { res.status(403).json({ error: "réservé à l'Administrateur" }); return; }
      const v = paramsValides(body.params);
      if (!v) { res.status(400).json({ error: "valeurs" }); return; }
      const params = { ...v, modifie: { date: now(), auteur } };
      await kvSet("comParams", params);
      res.status(200).json({ params }); return;
    }
    res.status(400).json({ error: "opération inconnue" });
  } catch (e) {
    res.status(502).json({ error: "serveur", detail: String(e.message || e).slice(0, 200) });
  }
}
