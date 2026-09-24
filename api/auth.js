// Connexion vérifiée par le serveur (lot S1).
// La page n'a plus accès aux comptes ni aux clés Authenticator : elle envoie le nom,
// le mot de passe puis le code, et reçoit un jeton de session signé, valable 12 heures.
// Variables : SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET, ALLOWED_ORIGIN (facultatif)
import crypto from "crypto";
export const config = { maxDuration: 10 };

const PFX = "ajs135v1_";
const DUREE = 12 * 3600;                 // 12 heures d'inactivité
const RETARD = { delayAfter: 3, delayS: 30, lockAfter: 5, lockMin: 15 };

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

// ── Jeton de session : charge utile + signature que seul le serveur peut produire
export function signer(payload, secret) {
  const p = b64(payload);
  return p + "." + crypto.createHmac("sha256", secret).update(p).digest("base64url");
}
export function lire(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [p, sig] = token.split(".");
  const attendu = crypto.createHmac("sha256", secret).update(p).digest("base64url");
  if (sig.length !== attendu.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendu))) return null;
  try {
    const o = JSON.parse(Buffer.from(p, "base64url").toString());
    if (!o.exp || o.exp < Math.floor(Date.now() / 1000)) return null;
    return o;
  } catch { return null; }
}

// ── Accès aux données, avec la clé de service : jamais exposée à la page
async function kvGet(key) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(PFX + key)}&select=value`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } });
  if (!r.ok) throw new Error("lecture " + key + " : " + r.status);
  const rows = await r.json();
  let v = rows?.[0]?.value;
  // L'application enregistre les valeurs en texte JSON ; certaines portent une enveloppe {__v}
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* valeur brute */ } }
  return v && typeof v === "object" && !Array.isArray(v) && "__v" in v ? v.__v : v;
}
async function kvSet(key, value) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key: PFX + key, value: JSON.stringify(value) }),
  });
}

// ── Code Authenticator (RFC 6238), vérifié ici et non dans la page
export function totp(secret, t) {
  const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.toUpperCase().replace(/=+$/, "")) {
    const i = b32.indexOf(ch); if (i < 0) continue;
    bits += i.toString(2).padStart(5, "0");
  }
  const cle = Buffer.from((bits.match(/.{8}/g) || []).map(b => parseInt(b, 2)));
  const c = Buffer.alloc(8); c.writeUInt32BE(Math.floor(t / 30), 4);
  const h = crypto.createHmac("sha1", cle).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
export const totpOk = (secret, code) => [-1, 0, 1].some(d => totp(secret, Date.now() / 1000 + d * 30) === code);

// ── Limitation des tentatives, tenue par le serveur : impossible à contourner
async function verrou(id, echec) {
  const L = (await kvGet("auth_locks")) || {};
  const s = L[id] || {};
  if (!echec) { if (L[id]) { delete L[id]; await kvSet("auth_locks", L); } return { attente: 0 }; }
  const fails = (s.fails || 0) + 1;
  const until = fails >= RETARD.lockAfter ? Date.now() + RETARD.lockMin * 60000
    : fails >= RETARD.delayAfter ? Date.now() + RETARD.delayS * 1000 : 0;
  L[id] = { fails, until };
  await kvSet("auth_locks", L);
  return { fails, until };
}
async function attente(id) {
  const L = (await kvGet("auth_locks")) || {};
  return Math.max(0, ((L[id] || {}).until || 0) - Date.now());
}

export function originOk(req) {
  const allow = (process.env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!allow.length) return true;
  const o = req.headers?.origin || req.headers?.referer || "";
  return allow.some(a => o.startsWith(a));
}

export default async function handler(req, res) {
  if (!originOk(req)) { res.status(403).json({ error: "origine non autorisée" }); return; }
  const secret = process.env.SESSION_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_KEY) { res.status(500).json({ error: "configuration serveur incomplète" }); return; }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const action = body.action;

  try {
    // Liste des personnes d'un profil : noms seulement, aucun secret
    if (action === "profils") {
      const users = (await kvGet("users")) || [];
      res.status(200).json({ users: users.filter(u => u.actif).map(u => ({ id: u.id, nom: u.nom, prenom: u.prenom, fonction: u.fonction, profil: u.profil, role: u.role, mustChange: !!u.mustChange })) });
      return;
    }

    // Mot de passe
    if (action === "login") {
      const cle = "u:" + body.userId;
      const w = await attente(cle);
      if (w) { res.status(429).json({ error: "trop d'essais", attente: w }); return; }
      const users = (await kvGet("users")) || [];
      const u = users.find(x => x.id === body.userId && x.actif);
      if (!u || sha256(u.salt + ":" + String(body.password || "")) !== u.hash) {
        const r = await verrou(cle, true);
        res.status(401).json({ error: "mot de passe incorrect", fails: r.fails, attente: Math.max(0, r.until - Date.now()) });
        return;
      }
      const sec = await kvGet("totp_secret_u_" + u.id);
      const secrets = Array.isArray(sec) ? sec : (sec ? [sec] : []);
      if (secrets.length) {
        res.status(200).json({ besoin: "totp", attente_totp: signer({ uid: u.id, etape: "totp", exp: Math.floor(Date.now() / 1000) + 300 }, secret) });
        return;
      }
      await verrou(cle, false);
      res.status(200).json({ token: signer(session(u), secret), user: publicUser(u), totpAActiver: true });
      return;
    }

    // Code Authenticator
    if (action === "totp") {
      const p = lire(body.attente_totp, secret);
      if (!p || p.etape !== "totp") { res.status(401).json({ error: "étape expirée, recommencez" }); return; }
      const cle = "u:" + p.uid;
      const w = await attente(cle);
      if (w) { res.status(429).json({ error: "trop d'essais", attente: w }); return; }
      const sec = await kvGet("totp_secret_u_" + p.uid);
      const secrets = Array.isArray(sec) ? sec : (sec ? [sec] : []);
      if (!secrets.some(s => totpOk(s, String(body.code || "")))) {
        const r = await verrou(cle, true);
        res.status(401).json({ error: "code incorrect", fails: r.fails, attente: Math.max(0, r.until - Date.now()) });
        return;
      }
      const users = (await kvGet("users")) || [];
      const u = users.find(x => x.id === p.uid && x.actif);
      if (!u) { res.status(401).json({ error: "compte désactivé" }); return; }
      await verrou(cle, false);
      res.status(200).json({ token: signer(session(u), secret), user: publicUser(u) });
      return;
    }

    // Vérification d'un jeton : le serveur confirme l'identité et que le compte est toujours actif
    if (action === "me") {
      const p = lire(body.token, secret);
      if (!p || p.etape) { res.status(401).json({ error: "session expirée" }); return; }
      const users = (await kvGet("users")) || [];
      const u = users.find(x => x.id === p.uid && x.actif);
      if (!u) { res.status(401).json({ error: "compte désactivé" }); return; }
      res.status(200).json({ user: publicUser(u), exp: p.exp });
      return;
    }

    res.status(400).json({ error: "action inconnue" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}

const session = u => ({ uid: u.id, profil: u.profil, role: u.role || null, nom: u.nom, prenom: u.prenom, exp: Math.floor(Date.now() / 1000) + DUREE });
const publicUser = u => ({ id: u.id, nom: u.nom, prenom: u.prenom, fonction: u.fonction, profil: u.profil, role: u.role, mustChange: !!u.mustChange });
