// Notifications sur le téléphone (2.20, 05/10/2026) — chaîne du FRAT rouge
//   FRAT rouge enregistré        → Opérations et Responsable SGS
//   barrières enregistrées       → Dirigeant Responsable (Direction) et Administrateur
//   décision prise               → le commandant (CM1) qui a rempli le FRAT
//   refus du vol par le CM1      → Opérations, Direction, Administrateur, SGS
// Principe : notification SANS contenu (aucun chiffrement à gérer) ; le téléphone, réveillé, vient chercher
// ses messages dans sa « boîte » (op « boite ») et les affiche. Le texte reste court, sans le motif.
// Les clés de notification (VAPID) sont créées par le serveur à la première utilisation et gardées en base
// (clé pushVapid, illisible par la page : script s5). Rien à configurer dans Vercel.
import crypto from "crypto";
import { lire, originOk } from "./auth.js";
export const config = { maxDuration: 10 };

const PFX = "ajs135v1_";
const SUJET = "mailto:ops@afrijet-sahara.ma";
export const EVENEMENTS = {
  frat_rouge: { destinataires: ["ops", "sgs"], emetteurs: ["eqp", "ops", "rdoa"] },
  barrieres:  { destinataires: ["dir", "rdoa"], emetteurs: ["ops", "rdoa"] },
  decision:   { destinataires: "cm1",          emetteurs: ["dir", "rdoa"] },
  refus:      { destinataires: ["ops", "dir", "rdoa", "sgs"], emetteurs: ["eqp", "rdoa"] },
};

const b64u = b => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const empreinte = endpoint => crypto.createHash("sha256").update(String(endpoint || "")).digest("hex").slice(0, 32);

// ── Clés VAPID (ECDSA P-256)
export function nouvellesCles() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const j = publicKey.export({ format: "jwk" }), d = privateKey.export({ format: "jwk" }).d;
  return { publique: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")])), x: j.x, y: j.y, d };
}
export function jetonVapid(endpoint, cles, maintenant) {
  const aud = new URL(endpoint).origin;
  const entete = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const charge = b64u(JSON.stringify({ aud, exp: Math.floor((maintenant || Date.now()) / 1000) + 12 * 3600, sub: SUJET }));
  const cle = crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", x: cles.x, y: cles.y, d: cles.d }, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(entete + "." + charge), { key: cle, dsaEncoding: "ieee-p1363" });
  return entete + "." + charge + "." + b64u(sig);
}

// ── Texte des messages (court : il peut s'afficher sur l'écran verrouillé, donc jamais le motif)
export function message(ev, f) {
  const vol = String(f.vol || "").replace(/\s+·\s+\d{2}\/\d{2}\/\d{4}$/, "") || "vol";
  if (ev === "frat_rouge") return { titre: "FRAT rouge : " + vol, corps: "Barrières à établir par les Opérations." };
  if (ev === "barrieres") return { titre: "FRAT rouge " + vol + " : décision attendue", corps: "Barrières enregistrées par " + (f.barrieresPar || "les Opérations") + "." };
  if (ev === "decision") return { titre: "FRAT " + vol + " : " + (f.decision2 === "reporte" ? "vol reporté" : "vol autorisé"),
    corps: "Par " + (f.decisionPar || "la Direction") + ". Touchez pour lire le motif et répondre." };
  if (ev === "refus") return { titre: "Vol refusé par le commandant : " + vol, corps: (f.cdbPar || "Le CM1") + ". Vol à replanifier. Touchez pour lire le motif." };
  return null;
}
// Destinataires : abonnements des profils visés (ou du CM1 du FRAT), sans l'auteur de l'action
export function destinataires(ev, f, abonnements, users, auteurUid) {
  const r = EVENEMENTS[ev]; if (!r) return [];
  let l;
  if (r.destinataires === "cm1") {
    let uid = f.cm1Uid;
    if (!uid && f.cdb) {
      const n = String(f.cdb).trim().toUpperCase().replace(/\s+/g, " ");
      const u = (users || []).find(x => x.actif !== false && x.profil === "eqp" &&
        [((x.prenom || "") + " " + (x.nom || "")), ((x.nom || "") + " " + (x.prenom || ""))].some(t => t.trim().toUpperCase().replace(/\s+/g, " ") === n));
      uid = u && u.id;
    }
    l = uid ? (abonnements || []).filter(a => a.uid === uid) : [];
  } else l = (abonnements || []).filter(a => r.destinataires.includes(a.profil));
  return l.filter(a => !auteurUid || a.uid !== auteurUid);
}

// ── Base (clé de service), même enveloppe que la page
async function kvGet(key) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(PFX + key)}&select=value`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } });
  if (!r.ok) throw new Error("lecture " + key + " : " + r.status);
  const rows = await r.json();
  let v = rows?.[0]?.value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* brute */ } }
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
async function cles() {
  let c = await kvGet("pushVapid");
  if (!c || !c.d) { c = nouvellesCles(); await kvSet("pushVapid", c); }
  return c;
}
// Réveil d'un téléphone : requête vide, signée VAPID ; 404/410 = abonnement expiré
export async function reveiller(a, c) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(a.endpoint, { method: "POST", signal: ctl.signal,
      headers: { Authorization: `vapid t=${jetonVapid(a.endpoint, c)}, k=${c.publique}`, TTL: "86400", Urgency: "high", "Content-Length": "0" } });
    return r.status === 404 || r.status === 410 ? "expire" : r.ok ? "ok" : "echec";
  } catch { return "echec"; } finally { clearTimeout(to); }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "méthode non autorisée" }); return; }
  if (!originOk(req)) { res.status(403).json({ error: "origine non autorisée" }); return; }
  const secret = process.env.SESSION_SECRET;
  if (!secret || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) { res.status(500).json({ error: "configuration serveur incomplète" }); return; }
  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  try {
    // Le téléphone réveillé vient chercher ses messages (appel du service worker, sans session)
    if (body.op === "boite") {
      const h = empreinte(body.endpoint), boite = (await kvGet("pushBoite")) || {};
      const msgs = boite[h] || [];
      if (msgs.length) { delete boite[h]; await kvSet("pushBoite", boite); }
      res.status(200).json({ messages: msgs.slice(-5) }); return;
    }
    const p = lire(body.token, secret);
    if (!p || p.etape) { res.status(401).json({ error: "session expirée" }); return; }
    if (body.op === "cle") { res.status(200).json({ publique: (await cles()).publique }); return; }
    if (body.op === "abonner" || body.op === "desabonner") {
      const ab = body.abonnement || {}, endpoint = String(ab.endpoint || "");
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) { res.status(400).json({ error: "abonnement invalide" }); return; }
      const h = empreinte(endpoint), liste = ((await kvGet("pushAbonnements")) || []).filter(a => a.id !== h);
      if (body.op === "abonner") liste.push({ id: h, endpoint, uid: p.uid || null, profil: p.profil, nom: [p.prenom, p.nom].filter(Boolean).join(" "), le: new Date().toISOString() });
      await kvSet("pushAbonnements", liste.slice(-200));
      res.status(200).json({ ok: true }); return;
    }
    if (body.op === "envoyer") {
      const ev = String(body.evenement || ""), r = EVENEMENTS[ev], f = body.frat || {};
      if (!r) { res.status(400).json({ error: "événement inconnu" }); return; }
      if (!r.emetteurs.includes(p.profil)) { res.status(403).json({ error: "action non autorisée pour ce profil" }); return; }
      const m = message(ev, f);
      const abonnements = (await kvGet("pushAbonnements")) || [];
      const users = r.destinataires === "cm1" && !f.cm1Uid ? ((await kvGet("users")) || []) : [];
      const dest = destinataires(ev, f, abonnements, users, p.uid);
      if (!dest.length) { res.status(200).json({ envoyes: 0 }); return; }
      const boite = (await kvGet("pushBoite")) || {};
      const le = new Date().toISOString();
      for (const a of dest) boite[a.id] = [...(boite[a.id] || []), { ...m, tag: "frat-" + (f.id || ""), url: "/?tab=alertes", le }].slice(-5);
      await kvSet("pushBoite", boite);
      const c = await cles();
      const etats = await Promise.all(dest.map(a => reveiller(a, c)));
      const expires = dest.filter((a, i) => etats[i] === "expire").map(a => a.id);
      if (expires.length) await kvSet("pushAbonnements", abonnements.filter(a => !expires.includes(a.id)));
      res.status(200).json({ envoyes: etats.filter(e => e === "ok").length, expires: expires.length }); return;
    }
    res.status(400).json({ error: "opération inconnue" });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
}
