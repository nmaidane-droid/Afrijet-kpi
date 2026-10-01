// Vérification des NOTAM (chantier NOTAM, version 2.20) — cahier des charges : chantiers/notam/CAHIER_DES_CHARGES.md
// Le serveur consulte la source (SkyLink API), classe chaque NOTAM et décide du statut d'un vol :
//   ferme        aérodrome fermé, ou toutes ses pistes fermées, à l'heure prévue : planification bloquée
//   doute        incertitude (une piste sur plusieurs, horaire illisible, fin estimée, pistes inconnues,
//                source injoignable, quota épuisé) : bloqué jusqu'à confirmation des Opérations
//   significatif ILS, balisage, aides, services, obstacles… : affiché, ne bloque pas
//   rien         aucun NOTAM d'aérodrome concerné
// La page n'affiche que ce que le serveur renvoie. Cette vérification aide les Opérations ; elle ne remplace
// pas la lecture des NOTAM officiels par l'équipage (le commandant de bord reste responsable).
// Opérations : POST { token, op: "verifier", fenetres: [{ oaci, iata, debut, fin, role }] }
//              GET (tâche planifiée Vercel, 06:00 UTC) : vérification quotidienne des vols des 72 h → notamAlertes
// Variables : SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET, NOTAM_API_KEY, NOTAM_API_URL (facultatif),
//             CRON_SECRET (ajouté par Vercel), ALLOWED_ORIGIN (facultatif)
import { lire, originOk } from "./auth.js";
export const config = { maxDuration: 10 };

const PFX = "ajs135v1_";
export const MARGE_MIN = 60;          // ± 60 min autour du départ et de l'arrivée (décision du 01/10/2026)
export const HORIZON_H = 72;          // vérification quotidienne : vols des 72 prochaines heures
export const CACHE_MIN = 30;          // une requête par aéroport au plus toutes les 30 min
export const QUOTA = 1000;            // offre gratuite SkyLink : 1 000 requêtes par mois
const URL_DEFAUT = "https://skylink-api.p.rapidapi.com/v3/notams/{icao}";

// Pistes connues : une fermeture de piste n'est une fermeture certaine que si TOUTES les pistes sont fermées.
// Aéroport absent de cette liste : une fermeture de piste vaut « doute ». À confirmer sur l'AIP.
export const PISTES = {
  GMMH: ["03/21"], GMME: ["04/22"], GMMN: ["17L/35R", "17R/35L"], GMMX: ["10/28"], GMAD: ["09/27"],
  GMTT: ["10/28"], GMTN: ["06/24"], GMML: ["03/21"], GMFF: ["09/27"], GQNO: ["06/24"],
};

// ── Dates : AAMMJJhhmm ou AAAAMMJJhhmm, suivies éventuellement de EST (fin estimée) ; PERM = sans fin
export function lireDate(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s || s === "PERM") return { t: Infinity, est: false };
  const est = /EST$/.test(s), d = s.replace(/EST$/, "").trim();
  let m = d.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) { const n = d.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/); if (n) m = [n[0], "20" + n[1], n[2], n[3], n[4], n[5]]; }
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isFinite(t) ? { t, est } : null;
}

// ── Horaire (champ D). Formats lus avec certitude :
//   hhmm-hhmm (tous les jours), DAILY hhmm-hhmm, H24, MON-FRI hhmm-hhmm, MON TUE hhmm-hhmm,
//   jours du mois et plages (01 05-08 12 hhmm-hhmm), groupes séparés par des virgules.
// Tout autre format (SR, SS, EXC, HJ, HN, texte libre) : illisible → doute.
const JOURS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export function lireHoraire(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return { ok: true, toujours: true };
  const groupes = s.split(",").map(g => g.trim()).filter(Boolean), plages = [];
  for (const g of groupes) {
    const tk = g.split(/\s+/);
    const h = tk.pop();
    let debut, fin;
    if (h === "H24") { debut = 0; fin = 1440; }
    else {
      const m = h.match(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/);
      if (!m || +m[1] > 23 || +m[3] > 24 || +m[2] > 59 || +m[4] > 59) return { ok: false };
      debut = +m[1] * 60 + +m[2]; fin = +m[3] * 60 + +m[4];
      if (fin === 23 * 60 + 59) fin = 1440;
    }
    let dow = null, dom = null;
    for (const t of tk) {
      if (t === "DAILY") continue;
      let m = t.match(/^(SUN|MON|TUE|WED|THU|FRI|SAT)(?:-(SUN|MON|TUE|WED|THU|FRI|SAT))?$/);
      if (m) {
        dow = dow || new Set(); let a = JOURS.indexOf(m[1]); const b = m[2] ? JOURS.indexOf(m[2]) : a;
        for (let i = 0; i < 7; i++) { dow.add(a); if (a === b) break; a = (a + 1) % 7; }
        continue;
      }
      m = t.match(/^(\d{2})(?:-(\d{2}))?$/);
      if (m && +m[1] >= 1 && +m[1] <= 31 && (!m[2] || (+m[2] >= +m[1] && +m[2] <= 31))) {
        dom = dom || new Set(); for (let j = +m[1]; j <= +(m[2] || m[1]); j++) dom.add(j);
        continue;
      }
      return { ok: false };
    }
    plages.push({ debut, fin, dow, dom });
  }
  return { ok: true, plages };
}
// L'horaire est-il actif à un moment de la fenêtre [a, b] (millisecondes UTC) ?
export function horaireCouvre(h, a, b) {
  if (!h || h.toujours) return true;
  const J = 86400000, j0 = Math.floor(a / J) - 1, j1 = Math.floor(b / J);
  for (let j = j0; j <= j1; j++) {
    const d = new Date(j * J);
    for (const p of h.plages) {
      if (p.dow && !p.dow.has(d.getUTCDay())) continue;
      if (p.dom && !p.dom.has(d.getUTCDate())) continue;
      const deb = j * J + p.debut * 60000, fin = j * J + (p.fin > p.debut ? p.fin : p.fin + 1440) * 60000;
      if (deb <= b && fin >= a) return true;
    }
  }
  return false;
}

const PREFIXES_SIGNIFICATIFS = ["QIC", "QIG", "QIL", "QL", "QN", "QFA", "QMX", "QOB"];
const RE_PISTE = /\bRWY\s+(\d{2}[LRC]?\s*\/\s*\d{2}[LRC]?)/g;
export const normPiste = p => String(p).replace(/\s/g, "").split("/").sort().join("/");

// ── Classement d'un NOTAM pour un aéroport et une fenêtre. Renvoie null s'il n'est pas concerné.
export function classer(n, f) {
  if (!n || !f) return null;
  if (String(n.scope || "").toUpperCase() !== "AERODROME") return null;          // FIR et listes : écartés
  if (String(n.location || "").toUpperCase() !== String(f.oaci || "").toUpperCase()) return null;
  const q = String(n.q_code || "").toUpperCase().trim();
  if (q === "QKKKK" || String(n.type || "").toUpperCase() === "C") return null;    // liste récapitulative, annulation
  const deb = lireDate(n.effective) || { t: -Infinity, est: false }, fin = lireDate(n.expiration);
  if (deb.t > f.fin) return null;
  let incertain = "";
  if (!fin) incertain = "fin du NOTAM illisible";
  else if (fin.t < f.debut) { if (!fin.est) return null; incertain = "fin seulement estimée (EST), avant l'heure du vol"; }
  const h = lireHoraire(n.schedule);
  if (!h.ok) incertain = incertain || "horaire illisible (" + String(n.schedule) + ")";
  else if (!horaireCouvre(h, Math.max(f.debut, deb.t), fin && Number.isFinite(fin.t) && !fin.est ? Math.min(f.fin, fin.t) : f.fin)) return null;

  const texte = String(n.body || "").toUpperCase().replace(/\s+/g, " ");
  let cat = "rien", pistes = [], motif = "";
  if (q === "QFALC" || /\bAD\s+CLSD\b/.test(texte)) { cat = "ferme"; motif = "aérodrome fermé"; }
  else if ((/^QMR..$/.test(q) && q.endsWith("LC")) || /\bRWY\s+\d{2}[LRC]?\s*\/\s*\d{2}[LRC]?\s+CLSD\b/.test(texte)) {
    pistes = [...texte.matchAll(RE_PISTE)].map(m => normPiste(m[1]));
    if (!pistes.length || /\b(BTN|BETWEEN|PARTIAL|PART OF|EXC|FOR ACFT|TO ACFT)\b/.test(texte)) { cat = "doute"; motif = "fermeture partielle ou piste non identifiée"; }
    else { cat = "piste"; motif = "piste " + pistes.join(", ") + " fermée"; }
  }
  else if (!q && /\bCLSD\b/.test(texte)) { cat = "doute"; motif = "fermeture sans code Q"; }
  else if (PREFIXES_SIGNIFICATIFS.some(p => q.startsWith(p)) || /\bU\/S\b|NOT AVBL|\bWIP\b/.test(texte)) { cat = "significatif"; }
  if (incertain && (cat === "ferme" || cat === "piste")) { cat = "doute"; motif = motif + " — " + incertain; }
  return { cat, motif, pistes, id: n.notam_id || "", q, texte: String(n.body || "").trim().slice(0, 600),
    debut: n.effective || "", fin: n.expiration || "", horaire: n.schedule || "" };
}

// ── Statut d'une fenêtre (un aéroport, départ ou arrivée)
const RANG = { rien: 0, significatif: 1, doute: 2, ferme: 3 };
export function evaluer(notams, f) {
  const liste = (notams || []).map(n => classer(n, f)).filter(Boolean);
  let statut = "rien", motifs = [];
  const monter = (s, m) => { if (RANG[s] > RANG[statut]) statut = s; if (m) motifs.push(m); };
  for (const c of liste) if (c.cat === "ferme") monter("ferme", c.id + " : " + c.motif);
  const fermees = new Set(liste.filter(c => c.cat === "piste").flatMap(c => c.pistes));
  if (fermees.size) {
    const connues = (PISTES[String(f.oaci || "").toUpperCase()] || []).map(normPiste);
    const ids = liste.filter(c => c.cat === "piste").map(c => c.id).join(", ");
    if (!connues.length) monter("doute", ids + " : piste fermée, nombre de pistes de l'aéroport inconnu");
    else if (connues.every(p => fermees.has(p))) monter("ferme", ids + " : " + (connues.length > 1 ? "toutes les pistes fermées" : "piste " + connues[0] + " fermée"));
    else monter("doute", ids + " : une piste fermée sur " + connues.length);
    liste.forEach(c => { if (c.cat === "piste") { c.cat = connues.length && connues.every(p => fermees.has(p)) ? "ferme" : "doute"; c.agrege = true; } });
  }
  for (const c of liste) if (c.cat === "doute" && !c.agrege) monter("doute", c.id + " : " + c.motif);
  if (liste.some(c => c.cat === "significatif")) monter("significatif");
  return { statut, motif: motifs.join(" ; "), notams: liste.filter(c => c.cat !== "rien").sort((a, b) => RANG[b.cat] - RANG[a.cat]) };
}
// Statut global d'un vol : le plus grave de ses fenêtres
export function statutVol(res) { return (res || []).reduce((s, r) => (RANG[r.statut] > RANG[s] ? r.statut : s), "rien"); }

// ── Fenêtres envoyées par la page : contrôle de forme
export function fenetresValides(l) {
  if (!Array.isArray(l) || !l.length || l.length > 4) return null;
  const out = [];
  for (const f of l) {
    const debut = Number(f && f.debut), fin = Number(f && f.fin);
    if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin < debut || fin - debut > 6 * 3600000) return null;
    const oaci = /^[A-Z]{4}$/.test(String(f.oaci || "").toUpperCase()) ? String(f.oaci).toUpperCase() : "";
    out.push({ oaci, iata: String(f.iata || "").toUpperCase().slice(0, 4), debut, fin, role: f.role === "arrivee" ? "arrivee" : "depart" });
  }
  return out;
}

// ── Accès aux données (clé de service), même enveloppe {__v, __t} que la page
async function kvGet(key) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(PFX + key)}&select=value`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } });
  if (!r.ok) throw new Error("lecture " + key + " : " + r.status);
  const rows = await r.json();
  let v = rows?.[0]?.value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* valeur brute */ } }
  return v && typeof v === "object" && !Array.isArray(v) && "__v" in v ? v.__v : v;
}
async function kvSet(key, value) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key: PFX + key, value: JSON.stringify({ __v: value, __t: Date.now() }) }),
  });
  if (!r.ok) throw new Error("écriture " + key + " : " + r.status);
}

// ── NOTAM d'un aéroport : cache de 30 min, compteur mensuel, délai de 6 s
async function notamsDe(oaci, etat) {
  const c = etat.cache[oaci];
  if (c && Date.now() - c.lu < CACHE_MIN * 60000) return { notams: c.notams, lu: c.lu };
  const mois = new Date().toISOString().slice(0, 7);
  if (etat.quota.mois !== mois) etat.quota = { mois, n: 0 };
  if (etat.quota.n >= QUOTA) throw new Error("quota mensuel de " + QUOTA + " requêtes atteint");
  if (!process.env.NOTAM_API_KEY) throw new Error("clé NOTAM absente (NOTAM_API_KEY)");
  const url = (process.env.NOTAM_API_URL || URL_DEFAUT).replace("{icao}", encodeURIComponent(oaci));
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 6000);
  etat.quota.n++; etat.modifie = true;
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "x-rapidapi-key": process.env.NOTAM_API_KEY, "x-rapidapi-host": new URL(url).host, "x-api-key": process.env.NOTAM_API_KEY } });
    if (!r.ok) throw new Error("source NOTAM : " + r.status);
    const j = await r.json();
    if (!j || !Array.isArray(j.notams)) throw new Error("réponse NOTAM inattendue");
    etat.cache[oaci] = { lu: Date.now(), notams: j.notams };
    return { notams: j.notams, lu: Date.now() };
  } finally { clearTimeout(to); }
}
async function chargerEtat() {
  let cache = {}, quota = {};
  try { cache = (await kvGet("notamCache")) || {}; } catch { /* vide */ }
  try { quota = (await kvGet("notamQuota")) || {}; } catch { /* vide */ }
  return { cache: typeof cache === "object" ? cache : {}, quota: typeof quota === "object" ? quota : {}, modifie: false };
}
async function sauverEtat(etat) {
  if (!etat.modifie) return;
  const limite = Date.now() - 24 * 3600000;                 // le cache ne garde que les lectures du jour
  for (const k of Object.keys(etat.cache)) if (!(etat.cache[k]?.lu > limite)) delete etat.cache[k];
  await Promise.all([kvSet("notamCache", etat.cache), kvSet("notamQuota", etat.quota)]).catch(() => {});
}

// Vérification d'une liste de fenêtres
export async function verifierFenetres(fenetres, etat) {
  const out = [];
  for (const f of fenetres) {
    if (!f.oaci) { out.push({ ...f, statut: "doute", motif: "aéroport " + (f.iata || "?") + " inconnu de la liste des aéroports", notams: [], lu: null }); continue; }
    try {
      const { notams, lu } = await notamsDe(f.oaci, etat);
      out.push({ ...f, ...evaluer(notams, f), lu });
    } catch (e) {
      out.push({ ...f, statut: "doute", motif: "vérification impossible : " + String(e.message || e), notams: [], lu: null });
    }
  }
  return out;
}

// ── Vérification quotidienne : vols planifiés des 72 prochaines heures (fenêtres enregistrées avec le vol)
export function volsAVerifier(flights, maintenant) {
  return (flights || []).filter(f => f && f.status === "Planifie" && f.notam && Array.isArray(f.notam.fenetres) && f.notam.fenetres.length
    && f.notam.fenetres.some(w => w.debut >= maintenant - 3600000 && w.debut <= maintenant + HORIZON_H * 3600000));
}
export function alerteDe(vol, res, maintenant) {
  const statut = statutVol(res);
  const avant = (vol.notam && vol.notam.statut) || "rien";
  const vus = new Set(((vol.notam && vol.notam.ids) || []));
  const nouveaux = res.flatMap(r => r.notams).filter(n => (n.cat === "ferme" || n.cat === "doute") && !vus.has(n.id));
  if (!(statut === "ferme" || statut === "doute")) return null;
  if (RANG[statut] <= RANG[avant] && !nouveaux.length) return null;     // rien de nouveau depuis la planification
  return { volId: vol.id || "", num: vol.num || "", date: vol.date || "", from: vol.from || "", to: vol.to || "", dep: vol.dep || "",
    statut, motif: res.filter(r => r.motif).map(r => r.motif).join(" ; "), notams: nouveaux.length ? nouveaux : res.flatMap(r => r.notams).filter(n => n.cat !== "significatif"),
    detecteLe: new Date(maintenant).toISOString() };
}

export default async function handler(req, res) {
  // Tâche planifiée (GET) : vérification quotidienne
  if (req.method === "GET") {
    const secret = process.env.CRON_SECRET, auth = req.headers?.authorization || "";
    if (secret && auth !== `Bearer ${secret}`) { res.status(401).json({ error: "non autorisé" }); return; }
    try {
      const maintenant = Date.now(), etat = await chargerEtat();
      const flights = (await kvGet("flights")) || [];
      const alertes = [];
      for (const v of volsAVerifier(flights, maintenant)) {
        const r = await verifierFenetres(v.notam.fenetres, etat);
        const a = alerteDe(v, r, maintenant); if (a) alertes.push(a);
      }
      await sauverEtat(etat);
      await kvSet("notamAlertes", { verifieLe: new Date(maintenant).toISOString(), alertes });
      res.status(200).json({ ok: true, vols: volsAVerifier(flights, maintenant).length, alertes: alertes.length, quota: etat.quota });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "méthode non autorisée" }); return; }
  if (!originOk(req)) { res.status(403).json({ error: "origine non autorisée" }); return; }
  const secret = process.env.SESSION_SECRET;
  if (!secret || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) { res.status(500).json({ error: "configuration serveur incomplète" }); return; }
  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const p = lire(body.token, secret);
  if (!p || p.etape) { res.status(401).json({ error: "session expirée" }); return; }
  if (body.op !== "verifier") { res.status(400).json({ error: "opération inconnue" }); return; }
  const fenetres = fenetresValides(body.fenetres);
  if (!fenetres) { res.status(400).json({ error: "fenêtres invalides" }); return; }
  const etat = await chargerEtat();
  const resultats = await verifierFenetres(fenetres, etat);
  await sauverEtat(etat);
  const mois = new Date().toISOString().slice(0, 7);
  res.status(200).json({ statut: statutVol(resultats), fenetres: resultats, verifieLe: new Date().toISOString(),
    quota: { n: etat.quota.mois === mois ? etat.quota.n || 0 : 0, max: QUOTA } });
}
