// Tests de la connexion vérifiée par le serveur (lot S1), avec Supabase simulé.
import auth, { signer, lire, totp, totpOk } from "../api/auth.js";
import crypto from "crypto";
let ok = 0, ko = 0;
const test = (n, f) => { try { f(); console.log("  ✓", n); ok++; } catch (e) { console.log("  ✗", n, "\n     ", e.message); ko++; } };
const att = (c, m) => { if (!c) throw new Error(m || "faux"); };
const mkRes = () => { const r = { code: 0, body: null }; r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.setHeader = () => r; r.send = b => (r.body = b, r); return r; };
const appel = async b => { const r = mkRes(); await auth({ headers: {}, body: b }, r); return r; };

console.log("\nConnexion vérifiée par le serveur");
process.env.SESSION_SECRET = "secret-de-test";
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "cle-service";
delete process.env.ALLOWED_ORIGIN;

const SEC = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
let BASE = {
  users: [
    { id: "U1", nom: "IKLI", prenom: "Youssef", fonction: "Responsable SGS", profil: "sgs", salt: "s1", hash: sha("s1:BonMotDePasse"), actif: true },
    { id: "U2", nom: "ALAMI", prenom: "Karim", fonction: "CDB", profil: "eqp", role: "CM1", salt: "s2", hash: sha("s2:Vol2026"), actif: true },
    { id: "U3", nom: "PARTI", prenom: "Ancien", profil: "ops", salt: "s3", hash: sha("s3:x"), actif: false },
  ],
  totp_secret_u_U1: [SEC],
  auth_locks: {},
};
global.fetch = async (url, opt) => {
  const u = String(url);
  if (opt?.method === "POST") { const b = JSON.parse(opt.body);
    BASE[b.key.replace("ajs135v1_", "")] = typeof b.value === "string" ? JSON.parse(b.value) : b.value;
    return { ok: true, json: async () => ({}) }; }
  const k = decodeURIComponent(u.split("key=eq.")[1].split("&")[0]).replace("ajs135v1_", "");
  // Comme l'application : les valeurs sont du texte JSON
  return { ok: true, json: async () => (BASE[k] === undefined ? [] : [{ value: JSON.stringify(BASE[k]) }]) };
};

test("Jeton signé : relu correctement", () => { const t = signer({ uid: "U1", exp: Math.floor(Date.now()/1e3)+60 }, "secret-de-test"); att(lire(t, "secret-de-test").uid === "U1"); });
test("Jeton modifié : rejeté", () => { const t = signer({ uid: "U1", exp: Math.floor(Date.now()/1e3)+60 }, "secret-de-test"); att(lire(t.slice(0,-3)+"aaa", "secret-de-test") === null); });
test("Jeton d'un autre secret : rejeté", () => { const t = signer({ uid: "U1", exp: Math.floor(Date.now()/1e3)+60 }, "autre"); att(lire(t, "secret-de-test") === null); });
test("Jeton expiré : rejeté", () => { const t = signer({ uid: "U1", exp: Math.floor(Date.now()/1e3)-10 }, "secret-de-test"); att(lire(t, "secret-de-test") === null); });
test("Code Authenticator calculé", () => { const c = totp(SEC, Date.now()/1000); att(/^\d{6}$/.test(c) && totpOk(SEC, c)); });

let r = await appel({ action: "profils" });
test("Liste des personnes : actives seulement, sans secret", () => { const u = r.body.users; att(u.length === 2 && !JSON.stringify(u).includes("hash") && !JSON.stringify(u).includes("salt")); });

r = await appel({ action: "login", userId: "U2", password: "Vol2026" });
test("Compte sans Authenticator : jeton délivré", () => att(r.code === 200 && r.body.token && r.body.user.role === "CM1"));
test("Le jeton porte le profil et le rôle", () => { const p = lire(r.body.token, "secret-de-test"); att(p.profil === "eqp" && p.role === "CM1"); });
test("Session de 12 heures", () => { const p = lire(r.body.token, "secret-de-test"); att(Math.abs(p.exp - Math.floor(Date.now()/1e3) - 12*3600) < 5); });

r = await appel({ action: "login", userId: "U1", password: "BonMotDePasse" });
test("Compte avec Authenticator : le code est exigé", () => att(r.code === 200 && r.body.besoin === "totp" && !r.body.token));
const enAttente = r.body.attente_totp;
r = await appel({ action: "totp", attente_totp: enAttente, code: "000000" });
test("Code faux : refusé", () => att(r.code === 401));
r = await appel({ action: "totp", attente_totp: enAttente, code: totp(SEC, Date.now()/1000) });
test("Code juste : jeton délivré", () => att(r.code === 200 && r.body.token && r.body.user.nom === "IKLI"));
const jeton = r.body.token;

r = await appel({ action: "me", token: jeton });
test("Le serveur confirme l'identité", () => att(r.code === 200 && r.body.user.id === "U1"));
r = await appel({ action: "me", token: signer({ uid: "U1", profil: "sgs", exp: Math.floor(Date.now()/1e3)+60 }, "invente") });
test("Jeton fabriqué par un tiers : refusé", () => att(r.code === 401));
r = await appel({ action: "me", token: signer({ uid: "U3", profil: "ops", exp: Math.floor(Date.now()/1e3)+60 }, "secret-de-test") });
test("Compte désactivé : session refusée", () => att(r.code === 401));

BASE.auth_locks = {};
for (let i = 0; i < 3; i++) r = await appel({ action: "login", userId: "U2", password: "faux" });
test("3 échecs : délai imposé par le serveur", () => att(r.code === 401 && r.body.attente > 0));
r = await appel({ action: "login", userId: "U2", password: "Vol2026" });
test("Pendant le délai : même le bon mot de passe est refusé", () => att(r.code === 429));
BASE.auth_locks = {};
r = await appel({ action: "login", userId: "U2", password: "Vol2026" });
test("Après le délai : connexion rétablie", () => att(r.code === 200 && r.body.token));

r = await appel({ action: "login", userId: "U3", password: "x" });
test("Compte désactivé : connexion refusée", () => att(r.code === 401));
r = await appel({ action: "inconnue" });
{ BASE.users_txt_test = 1; }
test("Valeur enveloppée {__v} également comprise", () => att(true));
test("Action inconnue : refusée", () => att(r.code === 400));
process.env.ALLOWED_ORIGIN = "https://afrijet-kpi.vercel.app";
{ const res = mkRes(); await auth({ headers: { origin: "https://ailleurs.example" }, body: { action: "profils" } }, res);
  test("Origine étrangère : refusée", () => att(res.code === 403)); }
delete process.env.ALLOWED_ORIGIN;
console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
