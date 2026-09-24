// Tests du journal signé par le serveur (lot S1).
import journal, { nettoyer } from "../api/journal.js";
import { signer } from "../api/auth.js";
let ok = 0, ko = 0;
const test = (n, f) => { try { f(); console.log("  ✓", n); ok++; } catch (e) { console.log("  ✗", n, "\n     ", e.message); ko++; } };
const att = (c, m) => { if (!c) throw new Error(m || "faux"); };
const mkRes = () => { const r = { code: 0, body: null }; r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.setHeader = () => r; return r; };
const appel = async b => { const r = mkRes(); await journal({ headers: {}, body: b }, r); return r; };

console.log("\nJournal signé par le serveur");
process.env.SESSION_SECRET = "secret-de-test";
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "cle-service";
delete process.env.ALLOWED_ORIGIN;
const jeton = u => signer({ uid: u.id, profil: u.profil, nom: u.nom, prenom: u.prenom, exp: Math.floor(Date.now()/1e3)+3600 }, "secret-de-test");
const YOUSSEF = { id: "U1", nom: "IKLI", prenom: "Youssef", profil: "sgs" };
const KARIM = { id: "U2", nom: "ALAMI", prenom: "Karim", profil: "eqp" };

let ecrit = [];
global.fetch = async (url, opt) => { ecrit.push(JSON.parse(opt.body).p); return { ok: true, json: async () => ({}) }; };

test("Champs libres bornés", () => { const e = nettoyer({ module: "x".repeat(200), action: "a", objet: "o", changes: { a: [1, 2] }, autre: "ignoré" });
  att(e.module.length === 60 && !("autre" in e) && e.changes.a[1] === 2); });

let r = await appel({ token: jeton(YOUSSEF), entries: [{ module: "sgsHazards", objet: "DG-001", action: "clôture" }] });
test("Entrée inscrite au nom du porteur du jeton", () => att(r.code === 200 && ecrit[0].user_label === "Youssef IKLI" && ecrit[0].profil === "sgs"));

ecrit = [];
r = await appel({ token: jeton(KARIM), entries: [{ module: "flights", objet: "CN-KTA", action: "clôture", user_label: "Youssef IKLI", profil: "sgs" }] });
test("Un nom envoyé par la page est ignoré", () => att(ecrit[0].user_label === "Karim ALAMI" && ecrit[0].profil === "eqp"));

r = await appel({ token: "jeton.invente", entries: [{ module: "x", action: "y" }] });
test("Jeton invalide : écriture refusée", () => att(r.code === 401));
r = await appel({ token: signer({ uid: "U1", exp: Math.floor(Date.now()/1e3)-10 }, "secret-de-test"), entries: [{ module: "x", action: "y" }] });
test("Jeton expiré : écriture refusée", () => att(r.code === 401));
r = await appel({ token: jeton(YOUSSEF), entries: [] });
test("Envoi vide : refusé", () => att(r.code === 400));

ecrit = [];
r = await appel({ token: jeton(YOUSSEF), entries: Array.from({ length: 80 }, (_, i) => ({ module: "m", action: "a" + i })) });
test("Envoi massif borné à 50 entrées", () => att(r.body.ecrites === 50 && ecrit.length === 50));

global.fetch = async () => ({ ok: false, status: 409 });
r = await appel({ token: jeton(YOUSSEF), entries: [{ module: "m", action: "a" }] });
test("Refus de la base : signalé à la page", () => att(r.code === 502 && String(r.body.error).includes("409")));

process.env.ALLOWED_ORIGIN = "https://afrijet-kpi.vercel.app";
{ const res = mkRes(); await journal({ headers: { origin: "https://ailleurs.example" }, body: {} }, res);
  test("Origine étrangère : refusée", () => att(res.code === 403)); }
delete process.env.ALLOWED_ORIGIN;
console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
