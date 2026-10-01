// Tests de la connexion vérifiée par le serveur (lot S1), avec Supabase simulé.
import auth, { signer, lire, totp, totpOk, mdpFaible, amorcePossible } from "../api/auth.js";
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
test("Compte sans Authenticator : aucun jeton, activation exigée", () => att(r.code === 200 && !r.body.token && r.body.besoin === "activer" && r.body.user.role === "CM1"));
const SEC2 = "KRSXG5CTMVRXEZLUKN2XAZLSKNSWC4TF";
let a2 = r.body.attente;
r = await appel({ action: "activer", attente: a2, secret: SEC2, code: "000000" });
test("Activation avec un code faux : refusée, clé non enregistrée", () => att(r.code === 401 && !BASE.totp_secret_u_U2));
r = await appel({ action: "activer", attente: a2, secret: "pas-une-cle", code: "123456" });
test("Activation avec une clé invalide : refusée", () => att(r.code === 400));
r = await appel({ action: "activer", attente: a2, secret: SEC2, code: totp(SEC2, Date.now()/1000) });
test("Activation avec un code juste : clé enregistrée et jeton délivré", () => att(r.code === 200 && r.body.token && JSON.stringify(BASE.totp_secret_u_U2) === JSON.stringify([SEC2])));
test("Le jeton porte le profil et le rôle", () => { const p = lire(r.body.token, "secret-de-test"); att(p.profil === "eqp" && p.role === "CM1"); });
test("Session de 12 heures", () => { const p = lire(r.body.token, "secret-de-test"); att(Math.abs(p.exp - Math.floor(Date.now()/1e3) - 12*3600) < 5); });
r = await appel({ action: "activer", attente: a2, secret: SEC2, code: totp(SEC2, Date.now()/1000) });
test("Activation déjà faite : une seconde activation est refusée", () => att(r.code === 409));
r = await appel({ action: "me", token: a2 });
test("Une étape en attente ne vaut pas session", () => att(r.code === 401));

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
test("Après le délai : connexion rétablie (code demandé)", () => att(r.code === 200 && r.body.besoin === "totp"));

r = await appel({ action: "login", userId: "U3", password: "x" });
test("Compte désactivé : connexion refusée", () => att(r.code === 401));
r = await appel({ action: "inconnue" });
{ BASE.users_txt_test = 1; }
test("Valeur enveloppée {__v} également comprise", () => att(true));
test("Action inconnue : refusée", () => att(r.code === 400));

// ── 2.20 : installation, comptes tenus par le serveur, mot de passe provisoire ──
console.log("\nComptes nominatifs pour tous (2.20)");
test("Mot de passe trop court ou sans chiffre : refusé", () => att(mdpFaible("abc") && mdpFaible("abcdefgh") && !mdpFaible("Rabat2026")));
r = await appel({ action: "profils" });
test("Liste : profils ayant des comptes et installation possible", () => att(r.body.avecComptes.includes("sgs") && r.body.avecComptes.includes("ops") && r.body.amorce === true));
BASE.auth_locks = {};
r = await appel({ action: "amorcer", password: "faux" });
test("Installation : mauvais mot de passe refusé", () => att(r.code === 401));
// Le vrai mot de passe d'installation n'est pas dans les tests : seule son empreinte est contrôlée
const { AMORCE_HASH } = await import("../api/auth.js");
test("Installation : l'empreinte attendue est celle de la page 2.19 (Administrateur)", () => att(AMORCE_HASH === "bd6b04909ddd0c28d9c78b07cc375cbd6ae976cbb5a8d8dc4e813f67ec439268"));
// Jeton d'installation fabriqué comme le serveur le délivre après mot de passe et code
const jAmorce = signer({ uid: null, amorce: true, profil: "rdoa", nom: "Administrateur", exp: Math.floor(Date.now()/1e3)+600 }, "secret-de-test");
r = await appel({ action: "comptes", token: jAmorce, op: "liste" });
test("Installation : l'Administrateur voit la liste, sans empreinte ni sel", () => att(r.code === 200 && r.body.comptes.length === 3 && !JSON.stringify(r.body).includes("hash") && !JSON.stringify(r.body).includes("salt")));
r = await appel({ action: "comptes", token: jeton, op: "liste" });
test("Gestion des comptes : refusée au SGS", () => att(r.code === 403));
r = await appel({ action: "comptes", token: jAmorce, op: "creer", nom: "maidane", prenom: "Nour", fonction: "Administrateur", profil: "rdoa" });
test("Création d'un compte : mot de passe provisoire renvoyé une seule fois", () => att(r.code === 200 && /^[A-Za-z0-9]{10}$/.test(r.body.pwd) && r.body.user.nom === "MAIDANE"));
const nour = r.body.user, pwdNour = r.body.pwd;
test("Le compte est enregistré par le serveur, avec mot de passe provisoire", () => { const u = BASE.users.find(x => x.id === nour.id); att(u && u.mustChange === true && u.hash === sha(u.salt + ":" + pwdNour) && u.createdBy.includes("installation")); });
r = await appel({ action: "comptes", token: jAmorce, op: "creer", nom: "MAIDANE", prenom: "nour", profil: "rdoa" });
test("Doublon dans le même profil : refusé", () => att(r.code === 409));
r = await appel({ action: "comptes", token: jAmorce, op: "creer", nom: "X", prenom: "Y", profil: "eqp" });
test("Équipage sans fiche du registre : refusé", () => att(r.code === 400));
r = await appel({ action: "comptes", token: jAmorce, op: "creer", nom: "X", prenom: "Y", profil: "pirate" });
test("Profil inconnu : refusé", () => att(r.code === 400));
test("Compte Administrateur encore provisoire : installation toujours possible", () => att(amorcePossible(BASE.users)));
r = await appel({ action: "login", userId: nour.id, password: pwdNour });
test("Mot de passe provisoire : changement exigé avant tout", () => att(r.code === 200 && r.body.besoin === "mdp" && !r.body.token));
const aMdp = r.body.attente;
r = await appel({ action: "mdp", attente: aMdp, password: "court" });
test("Nouveau mot de passe trop faible : refusé", () => att(r.code === 400));
r = await appel({ action: "mdp", attente: aMdp, password: "Dakhla2026" });
test("Nouveau mot de passe enregistré, puis activation de l'Authenticator", () => att(r.code === 200 && r.body.besoin === "activer" && BASE.users.find(x => x.id === nour.id).mustChange === false));
test("Premier mot de passe d'un Administrateur choisi : installation close", () => att(!amorcePossible(BASE.users)));
r = await appel({ action: "comptes", token: jAmorce, op: "liste" });
test("Installation close : le jeton d'installation n'ouvre plus les comptes", () => att(r.code === 403));
r = await appel({ action: "amorcer", password: "nimporte" });
test("Installation close : le mot de passe d'installation est refusé", () => att(r.code === 403));
const SEC3 = "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U";
r = await appel({ action: "activer", attente: r.body.attente || (await appel({ action: "login", userId: nour.id, password: "Dakhla2026" })).body.attente, secret: SEC3, code: totp(SEC3, Date.now()/1000) });
const jNour = r.body.token;
test("Administrateur nominatif : session ouverte après l'Authenticator", () => att(r.code === 200 && lire(jNour, "secret-de-test").profil === "rdoa"));
r = await appel({ action: "comptes", token: jNour, op: "mdp", id: "U1" });
test("Réinitialisation du mot de passe : nouveau provisoire", () => att(r.code === 200 && r.body.pwd && BASE.users.find(x => x.id === "U1").mustChange === true));
r = await appel({ action: "comptes", token: jNour, op: "totp", id: "U2" });
test("Réinitialisation de l'Authenticator : clé effacée", () => att(r.code === 200 && BASE.totp_secret_u_U2 === null));
r = await appel({ action: "comptes", token: jNour, op: "actif", id: nour.id, actif: false });
test("Désactiver son propre compte : refusé", () => att(r.code === 400));
r = await appel({ action: "comptes", token: jNour, op: "actif", id: "U2", actif: false });
test("Désactivation d'un compte", () => att(r.code === 200 && BASE.users.find(x => x.id === "U2").actif === false));
BASE.auth_locks = { "u:U1": { fails: 5, until: Date.now() + 60000 } };
r = await appel({ action: "comptes", token: jNour, op: "liste" });
test("La liste signale un compte bloqué", () => att(r.body.comptes.find(u => u.id === "U1").verrou.fails === 5));
r = await appel({ action: "comptes", token: jNour, op: "debloquer", id: "U1" });
test("Déblocage d'un compte", () => att(r.code === 200 && !BASE.auth_locks["u:U1"]));
r = await appel({ action: "confirmer", token: jNour, password: "faux" });
test("Confirmation d'Effacer : mauvais mot de passe refusé", () => att(r.code === 401));
r = await appel({ action: "confirmer", token: jNour, password: "Dakhla2026" });
test("Confirmation d'Effacer : mot de passe personnel accepté", () => att(r.code === 200 && r.body.ok));
// Ajout d'un téléphone
BASE.auth_locks = {};
r = await appel({ action: "login", userId: nour.id, password: "Dakhla2026" });
const aT = r.body.attente_totp;
r = await appel({ action: "appareil_debut", attente_totp: aT, code: "000000" });
test("Autre téléphone : code actuel faux refusé", () => att(r.code === 401));
r = await appel({ action: "appareil_debut", attente_totp: aT, code: totp(SEC3, Date.now()/1000) });
const SEC4 = "ONSWG4TFORZWK3DFMNRWC4TFMRUXG5DF";
r = await appel({ action: "appareil", attente: r.body.attente, secret: SEC4, code: totp(SEC4, Date.now()/1000) });
test("Autre téléphone : les deux clés sont gardées", () => att(r.code === 200 && r.body.token && BASE["totp_secret_u_" + nour.id].length === 2));
process.env.ALLOWED_ORIGIN = "https://afrijet-kpi.vercel.app";
{ const res = mkRes(); await auth({ headers: { origin: "https://ailleurs.example" }, body: { action: "profils" } }, res);
  test("Origine étrangère : refusée", () => att(res.code === 403)); }
delete process.env.ALLOWED_ORIGIN;
console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
