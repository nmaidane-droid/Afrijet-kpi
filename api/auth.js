// Connexion vérifiée par le serveur (lot S1, étendu en 2.20).
// La page n'a plus accès aux comptes ni aux clés Authenticator : elle envoie le nom,
// le mot de passe puis le code, et reçoit un jeton de session signé, valable 12 heures.
// 2.20 : comptes nominatifs obligatoires pour tous les départements. Aucun jeton n'est délivré
// avant l'Authenticator. Le mot de passe d'installation de l'Administrateur (« amorçage ») ne sert
// que jusqu'à la première connexion d'un compte Administrateur, pour créer les premiers comptes.
// Le serveur tient seul les comptes : création, mot de passe, Authenticator, verrous.
// Variables : SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET, ALLOWED_ORIGIN (facultatif)
import crypto from "crypto";
export const config = { maxDuration: 10 };

const PFX = "ajs135v1_";
const DUREE = 12 * 3600;                 // 12 heures d'inactivité
const RETARD = { delayAfter: 3, delayS: 30, lockAfter: 5, lockMin: 15 };

// Mot de passe d'installation de l'Administrateur (empreinte SHA-256), valable jusqu'à la première connexion d'un compte Administrateur
export const AMORCE_HASH = "bd6b04909ddd0c28d9c78b07cc375cbd6ae976cbb5a8d8dc4e813f67ec439268";
export const PROFILS = ["ops", "eqp", "maint", "fin", "comm", "dir", "sgs", "rdoa"];
const ATTENTE = 600;                     // 10 minutes pour finir une étape de connexion

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
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key: PFX + key, value: JSON.stringify(value) }),
  });
  if (r && r.ok === false) throw new Error("écriture " + key + " : " + r.status);
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
      res.status(200).json({ users: users.filter(u => u.actif).map(u => ({ id: u.id, nom: u.nom, prenom: u.prenom, fonction: u.fonction, profil: u.profil, role: u.role, mustChange: !!u.mustChange })),
        avecComptes: [...new Set(users.map(u => u.profil))], amorce: amorcePossible(users) });
      return;
    }

    // Mot de passe d'installation de l'Administrateur : seulement tant qu'aucun compte Administrateur n'existe
    if (action === "amorcer") {
      const users = (await kvGet("users")) || [];
      if (!amorcePossible(users)) { res.status(403).json({ error: "comptes nominatifs" }); return; }
      const cle = "p:rdoa";
      const w = await attente(cle);
      if (w) { res.status(429).json({ error: "trop d'essais", attente: w }); return; }
      if (sha256(String(body.password || "")) !== AMORCE_HASH) {
        const r = await verrou(cle, true);
        res.status(401).json({ error: "mot de passe incorrect", fails: r.fails, attente: Math.max(0, r.until - Date.now()) });
        return;
      }
      await verrou(cle, false);
      res.status(200).json(await suite({ amorce: true }, secret));
      return;
    }

    // Mot de passe personnel
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
      await verrou(cle, false);
      // Mot de passe provisoire : il faut d'abord le remplacer
      if (u.mustChange) { res.status(200).json({ besoin: "mdp", attente: signer({ uid: u.id, etape: "mdp", exp: now() + ATTENTE }, secret), user: publicUser(u) }); return; }
      res.status(200).json({ ...(await suite({ uid: u.id }, secret)), user: publicUser(u) });
      return;
    }

    // Remplacement du mot de passe provisoire
    if (action === "mdp") {
      const p = lire(body.attente, secret);
      if (!p || p.etape !== "mdp") { res.status(401).json({ error: "étape expirée, recommencez" }); return; }
      const pwd = String(body.password || "");
      const motif = mdpFaible(pwd);
      if (motif) { res.status(400).json({ error: motif }); return; }
      const users = (await kvGet("users")) || [];
      const u = users.find(x => x.id === p.uid && x.actif);
      if (!u) { res.status(401).json({ error: "compte désactivé" }); return; }
      const salt = jeton(16);
      Object.assign(u, { salt, hash: sha256(salt + ":" + pwd), mustChange: false, pwdChangedAt: new Date().toISOString() });
      await kvSet("users", users);
      res.status(200).json({ ...(await suite({ uid: u.id }, secret)), user: publicUser(u) });
      return;
    }

    // Code Authenticator
    if (action === "totp") {
      const p = lire(body.attente_totp, secret);
      if (!p || p.etape !== "totp") { res.status(401).json({ error: "étape expirée, recommencez" }); return; }
      const cle = verrouDe(p);
      const w = await attente(cle);
      if (w) { res.status(429).json({ error: "trop d'essais", attente: w }); return; }
      const secrets = await secretsDe(p);
      if (!secrets.some(s => totpOk(s, String(body.code || "")))) {
        const r = await verrou(cle, true);
        res.status(401).json({ error: "code incorrect", fails: r.fails, attente: Math.max(0, r.until - Date.now()) });
        return;
      }
      await verrou(cle, false);
      await ouvrir(p, res, secret);
      return;
    }

    // Première activation de l'Authenticator : la clé, créée sur l'appareil, n'est enregistrée qu'avec un code juste
    if (action === "activer") {
      const p = lire(body.attente, secret);
      if (!p || p.etape !== "activer") { res.status(401).json({ error: "étape expirée, recommencez" }); return; }
      const cle = verrouDe(p), sec = String(body.secret || "");
      if (!/^[A-Z2-7]{16,64}$/.test(sec)) { res.status(400).json({ error: "clé invalide" }); return; }
      const w = await attente(cle);
      if (w) { res.status(429).json({ error: "trop d'essais", attente: w }); return; }
      if ((await secretsDe(p)).length) { res.status(409).json({ error: "Authenticator déjà activé" }); return; }
      if (!totpOk(sec, String(body.code || ""))) {
        const r = await verrou(cle, true);
        res.status(401).json({ error: "code incorrect", fails: r.fails, attente: Math.max(0, r.until - Date.now()) });
        return;
      }
      await verrou(cle, false);
      await kvSet(cleTotp(p), [sec]);
      await ouvrir(p, res, secret);
      return;
    }

    // Ajouter un autre téléphone : un code juste de l'Authenticator déjà activé, puis un code du nouveau
    if (action === "appareil_debut") {
      const p = lire(body.attente_totp, secret);
      if (!p || p.etape !== "totp") { res.status(401).json({ error: "étape expirée, recommencez" }); return; }
      const cle = verrouDe(p);
      const w = await attente(cle);
      if (w) { res.status(429).json({ error: "trop d'essais", attente: w }); return; }
      if (!(await secretsDe(p)).some(s => totpOk(s, String(body.code || "")))) {
        const r = await verrou(cle, true);
        res.status(401).json({ error: "code incorrect", fails: r.fails, attente: Math.max(0, r.until - Date.now()) });
        return;
      }
      await verrou(cle, false);
      res.status(200).json({ attente: signer({ ...sujet(p), etape: "appareil", exp: now() + ATTENTE }, secret) });
      return;
    }
    if (action === "appareil") {
      const p = lire(body.attente, secret);
      if (!p || p.etape !== "appareil") { res.status(401).json({ error: "étape expirée, recommencez" }); return; }
      const sec = String(body.secret || "");
      if (!/^[A-Z2-7]{16,64}$/.test(sec)) { res.status(400).json({ error: "clé invalide" }); return; }
      if (!totpOk(sec, String(body.code || ""))) { res.status(401).json({ error: "code incorrect" }); return; }
      const secrets = await secretsDe(p);
      await kvSet(cleTotp(p), [...secrets, sec].slice(-5));
      await ouvrir(p, res, secret);
      return;
    }

    // Confirmation d'une action sensible (Effacer) par le mot de passe de la personne connectée
    if (action === "confirmer") {
      const p = lire(body.token, secret);
      if (!p || p.etape) { res.status(401).json({ error: "session expirée" }); return; }
      const users = (await kvGet("users")) || [];
      const u = p.uid ? users.find(x => x.id === p.uid && x.actif) : null;
      if (!p.amorce && !u) { res.status(401).json({ error: "compte désactivé" }); return; }
      const cle = p.amorce ? "p:rdoa" : "u:" + u.id;
      const w = await attente(cle);
      if (w) { res.status(429).json({ error: "trop d'essais", attente: w }); return; }
      const pwd = String(body.password || "");
      const juste = p.amorce ? sha256(pwd) === AMORCE_HASH : sha256(u.salt + ":" + pwd) === u.hash;
      if (!juste) { const r = await verrou(cle, true); res.status(401).json({ error: "mot de passe incorrect", fails: r.fails }); return; }
      await verrou(cle, false);
      res.status(200).json({ ok: true });
      return;
    }

    // Vérification d'un jeton : le serveur confirme l'identité et que le compte est toujours actif
    if (action === "me") {
      const p = lire(body.token, secret);
      if (!p || p.etape) { res.status(401).json({ error: "session expirée" }); return; }
      const users = (await kvGet("users")) || [];
      if (p.amorce) {
        if (!amorcePossible(users)) { res.status(401).json({ error: "installation terminée" }); return; }
        res.status(200).json({ user: null, amorce: true, exp: p.exp }); return;
      }
      const u = users.find(x => x.id === p.uid && x.actif);
      if (!u) { res.status(401).json({ error: "compte désactivé" }); return; }
      res.status(200).json({ user: publicUser(u), exp: p.exp });
      return;
    }

    // Gestion des comptes : Administrateur seulement
    if (action === "comptes") {
      const p = lire(body.token, secret);
      if (!p || p.etape || p.profil !== "rdoa") { res.status(403).json({ error: "réservé à l'Administrateur" }); return; }
      const users = (await kvGet("users")) || [];
      if (p.amorce && !amorcePossible(users)) {
        res.status(403).json({ error: "installation terminée : reconnectez-vous avec votre compte" }); return; }
      if (!p.amorce && !users.some(u => u.id === p.uid && u.actif && u.profil === "rdoa")) { res.status(403).json({ error: "réservé à l'Administrateur" }); return; }
      const auteur = p.amorce ? "Administrateur (installation)" : [p.prenom, p.nom].filter(Boolean).join(" ");
      const op = body.op, cible = users.find(u => u.id === body.id);
      const fini = async (extra) => { await kvSet("users", users); res.status(200).json({ ...(extra || {}), comptes: await listeComptes(users) }); };
      if (op === "liste") { res.status(200).json({ comptes: await listeComptes(users) }); return; }
      if (op === "creer") {
        const nom = String(body.nom || "").trim().toUpperCase(), prenom = String(body.prenom || "").trim(), profil = body.profil;
        if (!nom || !prenom || !PROFILS.includes(profil)) { res.status(400).json({ error: "Nom, prénom et profil sont obligatoires." }); return; }
        if (profil === "eqp" && !body.crewId) { res.status(400).json({ error: "Choisissez la personne dans le registre Équipage." }); return; }
        if (users.some(u => u.actif && u.profil === profil && u.nom.toLowerCase() === nom.toLowerCase() && u.prenom.toLowerCase() === prenom.toLowerCase())) {
          res.status(409).json({ error: "Ce compte existe déjà pour ce profil." }); return; }
        const pwd = jeton(10), salt = jeton(16);
        const u = { id: "U" + Date.now().toString(36) + jeton(4, "abcdefghjkmnpqrstuvwxyz23456789"), nom, prenom, fonction: String(body.fonction || "").trim(), profil,
          ...(profil === "eqp" ? { crewId: String(body.crewId), role: body.role || null } : {}),
          salt, hash: sha256(salt + ":" + pwd), mustChange: true, actif: true, createdAt: new Date().toISOString(), createdBy: auteur };
        users.push(u);
        await fini({ pwd, user: publicUser(u) });
        return;
      }
      if (!cible) { res.status(404).json({ error: "compte introuvable" }); return; }
      if (op === "mdp") {
        const pwd = jeton(10), salt = jeton(16);
        Object.assign(cible, { salt, hash: sha256(salt + ":" + pwd), mustChange: true, pwdResetAt: new Date().toISOString(), pwdResetBy: auteur });
        await fini({ pwd, user: publicUser(cible) });
        return;
      }
      if (op === "totp") {
        await kvSet("totp_secret_u_" + cible.id, null);
        cible.totpResetAt = new Date().toISOString();
        await fini();
        return;
      }
      if (op === "actif") {
        const actif = !!body.actif;
        if (!actif && cible.id === p.uid) { res.status(400).json({ error: "Vous ne pouvez pas désactiver votre propre compte." }); return; }
        if (!actif && cible.profil === "rdoa" && users.filter(u => u.actif && u.profil === "rdoa").length === 1) {
          res.status(400).json({ error: "Il doit rester au moins un compte Administrateur actif." }); return; }
        Object.assign(cible, { actif, [actif ? "reactiveAt" : "desactiveAt"]: new Date().toISOString() });
        await fini();
        return;
      }
      if (op === "debloquer") { await verrou("u:" + cible.id, false); res.status(200).json({ comptes: await listeComptes(users) }); return; }
      res.status(400).json({ error: "opération inconnue" });
      return;
    }

    res.status(400).json({ error: "action inconnue" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}

const session = u => ({ uid: u.id, profil: u.profil, role: u.role || null, nom: u.nom, prenom: u.prenom, exp: Math.floor(Date.now() / 1000) + DUREE });
const publicUser = u => ({ id: u.id, nom: u.nom, prenom: u.prenom, fonction: u.fonction, profil: u.profil, role: u.role, mustChange: !!u.mustChange });

// Le mot de passe d'installation reste valable jusqu'à ce qu'un compte Administrateur actif ait choisi son mot de passe
export const amorcePossible = users => !users.some(u => u.profil === "rdoa" && u.actif && u.mustChange === false);
const now = () => Math.floor(Date.now() / 1000);
// Jeton aléatoire (mots de passe provisoires, sels, identifiants) : caractères sans ambiguïté
function jeton(n, alpha) {
  const a = alpha || "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(n)).map(x => a[x % a.length]).join("");
}
export function mdpFaible(pwd) {
  if (pwd.length < 8) return "8 caractères au minimum.";
  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) return "Mélangez lettres et chiffres.";
  return "";
}
// Sujet d'une connexion : une personne (uid) ou l'installation de l'Administrateur (amorce)
const sujet = p => (p.amorce ? { amorce: true } : { uid: p.uid });
const cleTotp = p => (p.amorce ? "totp_secret_rdoa" : "totp_secret_u_" + p.uid);
const verrouDe = p => (p.amorce ? "p:rdoa" : "u:" + p.uid);
async function secretsDe(p) {
  const sec = await kvGet(cleTotp(p));
  return Array.isArray(sec) ? sec.filter(Boolean) : (sec ? [sec] : []);
}
// Après le mot de passe : code Authenticator s'il est activé, sinon activation obligatoire
async function suite(p, secret) {
  const etape = (await secretsDe(p)).length ? "totp" : "activer";
  const a = signer({ ...sujet(p), etape, exp: now() + ATTENTE }, secret);
  return etape === "totp" ? { besoin: "totp", attente_totp: a } : { besoin: "activer", attente: a };
}
// Ouverture de la session, une fois le code Authenticator vérifié
async function ouvrir(p, res, secret) {
  const users = (await kvGet("users")) || [];
  if (p.amorce) {
    if (!amorcePossible(users)) { res.status(403).json({ error: "comptes nominatifs" }); return; }
    res.status(200).json({ token: signer({ uid: null, amorce: true, profil: "rdoa", role: null, nom: "Administrateur", prenom: "", exp: now() + DUREE }, secret), user: null });
    return;
  }
  const u = users.find(x => x.id === p.uid && x.actif);
  if (!u) { res.status(401).json({ error: "compte désactivé" }); return; }
  res.status(200).json({ token: signer(session(u), secret), user: publicUser(u) });
}
// Liste pour l'écran Comptes : jamais d'empreinte ni de clé
async function listeComptes(users) {
  const L = (await kvGet("auth_locks")) || {};
  return users.map(u => ({ ...publicUser(u), actif: !!u.actif, crewId: u.crewId, createdAt: u.createdAt,
    verrou: ((L["u:" + u.id] || {}).until || 0) > Date.now() ? { until: L["u:" + u.id].until, fails: L["u:" + u.id].fails } : null }));
}
