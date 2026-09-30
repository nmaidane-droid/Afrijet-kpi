// Module Commercial (lot B) — devis calculés par le serveur, comme dans Fiches Airshow.
// Règles reprises à l'identique d'Airshow 2.4 (api/devis.js, api/variables.js).
// La page ne calcule jamais le montant final : le serveur recalcule chaque ligne avec les
// Paramètres enregistrés dans la base, que la page peut lire mais pas écrire (script s2).
// Opérations : etat (paramètres + carburant), texte (introduction par l'IA), creer (devis), params (Administrateur).
// Variables : SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET, ANTHROPIC_API_KEY, EIA_API_KEY, ALLOWED_ORIGIN (facultatif)
import { lire, originOk } from "./auth.js";
export const config = { maxDuration: 10 };

const PFX = "ajs135v1_";
const MODEL = "claude-haiku-4-5-20251001";            // même modèle qu'Airshow : court, sous la limite de 10 s
export const DEFAUTS = { tarifVol: 75000, tarifImmo: 75000, immoMin: 2, fuelRef: 10, conso: 1100, signataire: "Hicham QADRI" };
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

// ── Paramètres : contrôles identiques à api/variables.js d'Airshow, plus le signataire
export function paramsValides(b) {
  if (!b || typeof b !== "object") return null;
  const dec = (v, min, max) => { const n = Math.round(Number(String(v).replace(",", ".")) * 100) / 100; return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const ent = (v, min, max) => { const s = String(v).replace(/\s/g, ""); if (s === "") return null; const n = Math.round(Number(s)); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const r = { tarifVol: ent(b.tarifVol, 1000, 1000000), tarifImmo: ent(b.tarifImmo, 0, 1000000), immoMin: ent(b.immoMin, 0, 24),
    fuelRef: dec(b.fuelRef, 0.1, 100), conso: ent(b.conso, 100, 10000), signataire: String(b.signataire || "").trim().slice(0, 80) };
  if (Object.values(r).some(v => v === null) || r.signataire.length < 2) return null;
  return r;
}
export async function lireParams() {
  let v = null; try { v = await kvGet("comParams"); } catch { /* valeurs par défaut */ }
  return Object.assign({}, DEFAUTS, v && typeof v === "object" ? v : {});
}

// ── Prix du Jet A-1 : indice mondial EIA (US Gulf Coast, $/gallon) × taux USD→MAD, mis en cache 6 h
// Identique à carburant() d'Airshow ; le cache est rangé dans la base (clé comFuel).
export async function carburant() {
  let c = null;
  try { c = await kvGet("comFuel"); } catch { /* pas de cache */ }
  if (c && Date.now() - Date.parse(c.maj) < 6 * 3600000) return c;
  const key = process.env.EIA_API_KEY;
  if (!key) return c ? Object.assign(c, { ancien: true }) : { erreur: "cle_eia" };
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 4000);
  try {
    const u = "https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=" + encodeURIComponent(key) +
      "&frequency=daily&data[0]=value&facets[series][]=EER_EPJK_PF4_RGC_DPG&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=1";
    const [r1, r2] = await Promise.all([fetch(u, { signal: ctrl.signal }), fetch("https://open.er-api.com/v6/latest/USD", { signal: ctrl.signal })]);
    clearTimeout(tm);
    const j1 = await r1.json(), j2 = await r2.json();
    const row = j1 && j1.response && Array.isArray(j1.response.data) ? j1.response.data[0] : null;
    const indice = row ? Number(row.value) : NaN, fx = j2 && j2.rates ? Number(j2.rates.MAD) : NaN;
    if (!(indice > 0) || !(fx > 0)) throw new Error("donnees");
    c = { indice, indiceDate: row.period, usdMad: Math.round(fx * 10000) / 10000, madL: Math.round(indice / 3.785411784 * fx * 100) / 100, maj: new Date().toISOString() };
    try { await kvSet("comFuel", c); } catch { /* le devis reste possible */ }
    return c;
  } catch {
    clearTimeout(tm);
    return c ? Object.assign(c, { ancien: true }) : { erreur: "indisponible" };
  }
}

// ── Calcul d'un devis : identique à l'opération « creer » d'api/devis.js d'Airshow.
// Pur (sans accès réseau) : testé avec les devis réels d'Airshow.
export function calculerDevis(d, V, F, { auteur, numero, version, now, id }) {
  if (!d || !Array.isArray(d.lignes) || !d.lignes.length || d.lignes.length > REGLES.MAX_LIGNES) return { erreur: "devis" };
  // Rayon d'action de CN-KTA : aucun devis si un vol dépasse 1 750 NM de route (distance directe + 10 %)
  if (d.lignes.some(l => l && l.type !== "immo" && l.type !== "fuel" && Math.round(num(l.distance) * REGLES.AIRWAYS) > REGLES.RANGE)) return { erreur: "hors_range" };
  const lignes = d.lignes.filter(l => l && l.type !== "fuel").map(l => ({
    type: str(l.type, 20), libelle: str(l.libelle, 60), jours: Math.max(0, Math.round(num(l.jours))),
    de: { icao: str(l.de && l.de.icao, 4), ville: str(l.de && l.de.ville, 60) },
    vers: { icao: str(l.vers && l.vers.icao, 4), ville: str(l.vers && l.vers.ville, 60) },
    national: !!l.national, passagers: !!l.passagers,
    distance: Math.round(num(l.distance)), minutes: Math.max(1, Math.round(num(l.minutes))), montant: 0,
  }));
  // Montants recalculés avec les Paramètres enregistrés (jamais ceux du téléphone)
  lignes.forEach(l => {
    if (l.type === "immo") { l.minutes = l.jours * V.immoMin * 60; l.montant = Math.round(l.jours * V.immoMin * V.tarifImmo); }
    else l.montant = Math.round(l.minutes / 60 * V.tarifVol);
  });
  // Surcharge carburant par aéroport de départ : litres × (prix − valeur de référence)
  const force = {};
  if (d.fuelForce && typeof d.fuelForce === "object") for (const [k, v] of Object.entries(d.fuelForce)) {
    const n = Math.round(Number(v) * 100) / 100; if (/^[A-Z0-9]{4}$/.test(k) && n >= 0.1 && n <= 100) force[k] = n; }
  const parApt = new Map();
  lignes.filter(l => l.type !== "immo").forEach(l => { const k = l.de.icao; if (!parApt.has(k)) parApt.set(k, { icao: k, ville: l.de.ville, min: 0 }); parApt.get(k).min += l.minutes; });
  const indice = F && F.madL > 0 ? F.madL : null;
  const aeroports = [...parApt.values()].map(a => {
    const forced = force[a.icao] != null, prix = forced ? force[a.icao] : indice, litres = Math.round(a.min / 60 * V.conso);
    return { icao: a.icao, ville: a.ville, litres, prix, force: forced, montant: prix == null ? 0 : Math.round(litres * (prix - V.fuelRef)) };
  });
  let carb = null;
  if (aeroports.some(a => a.prix != null)) {
    const montant = aeroports.reduce((s, a) => s + a.montant, 0);
    carb = { madL: indice, ref: V.fuelRef, conso: V.conso, litres: aeroports.reduce((s, a) => s + a.litres, 0), montant, aeroports,
      indice: F && F.indice, indiceDate: F && F.indiceDate, usdMad: F && F.usdMad, forcePar: aeroports.some(a => a.force) ? auteur : null };
    if (montant !== 0) lignes.push({ type: "fuel", libelle: "Surcharge carburant", jours: 0, de: { icao: "", ville: "" }, vers: { icao: "", ville: "" },
      national: lignes.every(l => l.national), passagers: false, distance: 0, minutes: 0, montant });
  }
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
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const p = lire(body.token, secret);
  if (!p || p.etape) { res.status(401).json({ error: "session expirée" }); return; }
  const auteur = [p.prenom, p.nom].filter(Boolean).join(" ").trim() || p.uid;
  const peut = liste => liste.includes(p.profil);
  try {
    if (body.op === "etat") {
      if (!peut(PROFILS_LECTURE)) { res.status(403).json({ error: "profil" }); return; }
      const [params, carb] = await Promise.all([lireParams(), carburant()]);
      res.status(200).json({ params, carburant: carb }); return;
    }
    if (body.op === "texte") {
      if (!peut(PROFILS_DEVIS)) { res.status(403).json({ error: "profil" }); return; }
      const r = await texteIA(body.contexte || {});
      res.status(r.error ? (r.error === "cle_absente" ? 500 : 502) : 200).json(r); return;
    }
    if (body.op === "creer") {
      if (!peut(PROFILS_DEVIS)) { res.status(403).json({ error: "profil" }); return; }
      const [V, F, existants, seq] = await Promise.all([lireParams(), carburant(), kvGet("devis").catch(() => []), kvGet("comSeq").catch(() => 0)]);
      const now = new Date().toISOString();
      const nu = numeroter(Array.isArray(existants) ? existants : [], seq, str(body.devis && body.devis.numeroParent, 20), new Date().getUTCFullYear());
      if (nu.erreur) { res.status(400).json({ error: nu.erreur }); return; }
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const r = calculerDevis(body.devis, V, F, { auteur, numero: nu.numero, version: nu.version, now, id });
      if (r.erreur) { res.status(400).json({ error: r.erreur }); return; }
      if (nu.version === 1) await kvSet("comSeq", nu.seq);   // numéro réservé, même si la page n'enregistre pas le devis
      res.status(201).json({ devis: r.devis }); return;
    }
    if (body.op === "params") {
      if (p.profil !== "rdoa") { res.status(403).json({ error: "réservé à l'Administrateur" }); return; }
      const v = paramsValides(body.params);
      if (!v) { res.status(400).json({ error: "valeurs" }); return; }
      const params = { ...v, modifie: { date: new Date().toISOString(), auteur } };
      await kvSet("comParams", params);
      res.status(200).json({ params }); return;
    }
    res.status(400).json({ error: "opération inconnue" });
  } catch (e) {
    res.status(502).json({ error: "serveur", detail: String(e.message || e).slice(0, 200) });
  }
}
