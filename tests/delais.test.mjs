// Délais de garde des fonctions serveur (01/10/2026) : un service extérieur lent ne doit plus faire couper
// la fonction par Vercel. Les minuteries sont accélérées (÷ 100) pour que les tests restent rapides.
import fr24 from "../api/fr24.js";
import wx from "../api/wx.js";
import generate, { DELAI_MS } from "../api/generate.js";
import { verifierFenetres, DELAI_SOURCE_MS } from "../api/notam.js";
import { signer } from "../api/auth.js";
let ok = 0, ko = 0;
const test = (n, f) => { try { const r = f(); if (r === false) throw new Error("faux"); console.log("  ✓", n); ok++; } catch (e) { console.log("  ✗", n, "\n     ", e.message); ko++; } };
const att = (c, m) => { if (!c) throw new Error(m || "faux"); };
const mkRes = () => { const r = { code: 0, body: null, headers: {}, ecrit: "", headersSent: false, fini: false };
  r.status = c => (r.code = c, r); r.json = b => (r.body = b, r.headersSent = true, r); r.send = b => (r.body = b, r.headersSent = true, r);
  r.setHeader = (k, v) => (r.headers[k] = v, r.headersSent = true, r); r.write = t => { r.ecrit += t; r.headersSent = true; }; r.end = () => { r.fini = true; }; return r; };

// Minuteries accélérées : 8 s → 80 ms, 290 s → 2,9 s, 4 s → 40 ms
const vraiSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...a) => vraiSetTimeout(fn, Math.max(1, (ms || 0) / 100), ...a);
const attendre = ms => new Promise(r => vraiSetTimeout(r, ms));
const abandon = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
// Service qui ne répond jamais, mais respecte l'abandon
const muet = (url, opt) => new Promise((_, rej) => { if (opt && opt.signal) opt.signal.addEventListener("abort", () => rej(abandon())); });

process.env.FR24_TOKEN = "j"; process.env.CHECKWX_KEY = "k"; process.env.ANTHROPIC_API_KEY = "a"; process.env.SESSION_SECRET = "s"; delete process.env.ALLOWED_ORIGIN;
const JETON = signer({ uid: "U1", profil: "sgs", exp: Math.floor(Date.now() / 1e3) + 600 }, "s");

console.log("\nDélais de garde");
global.fetch = muet;
let t0 = Date.now(), r = mkRes(); await fr24({ headers: {}, query: { registrations: "CN-KTA" } }, r);
test("Flightradar24 muet : réponse 504 avec message, sans attendre la coupure", () => att(r.code === 504 && /pas répondu à temps/.test(r.body.error) && Date.now() - t0 < 1000));
t0 = Date.now(); r = mkRes(); await wx({ headers: {}, query: { icao: "GMMN" } }, r);
test("CheckWX muet : réponse 504 avec message", () => att(r.code === 504 && /pas répondu à temps/.test(r.body.error) && Date.now() - t0 < 1000));
test("Délais choisis sous les limites des fonctions (8 s < 10 s, 290 s < 300 s, 4 s en parallèle < 10 s)", () => att(DELAI_MS === 290000 && DELAI_SOURCE_MS === 4000));

r = mkRes(); await generate({ method: "POST", body: { messages: [{ role: "user", content: "x" }], token: JETON } }, r);
test("IA muette (sans flux) : 504, message clair lisible par la page", () => att(r.code === 504 && /trop longue/.test(r.body.error.message)));

// Flux commencé puis bloqué : la génération s'arrête par un événement d'erreur
global.fetch = async (url, opt) => ({ ok: true, status: 200, body: { getReader: () => {
  let premier = true;
  return { read: () => premier ? (premier = false, Promise.resolve({ done: false, value: new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"text":"Début"}}\n\n') }))
    : new Promise((_, rej) => opt.signal.addEventListener("abort", () => rej(abandon()))) };
} } });
r = mkRes(); await generate({ method: "POST", body: { stream: true, messages: [{ role: "user", content: "x" }], token: JETON } }, r);
test("IA bloquée en cours de flux : le flux se termine par un événement d'erreur", () => att(r.ecrit.includes("Début") && /event: error\ndata: .*"type":"error".*trop longue/.test(r.ecrit) && r.fini));

// NOTAM : deux aéroports lus en même temps ; l'un muet → doute pour lui seul
const N = { notam_id: "A1/2026", location: "GMMH", scope: "AERODROME", type: "N", q_code: "QICAS", body: "ILS U/S", effective: "202610010000", expiration: "202610312359" };
process.env.NOTAM_API_KEY = "n";
let appels = [];
global.fetch = async (url, opt) => { const o = url.split("/").pop(); appels.push(o);
  if (o === "GMME") return muet(url, opt);
  await attendre(30); return { ok: true, json: async () => ({ notams: [N] }) }; };
const T = Date.UTC(2026, 9, 5, 9, 30);
t0 = Date.now();
const res = await verifierFenetres([{ oaci: "GMMH", debut: T - 3.6e6, fin: T + 3.6e6, role: "depart" }, { oaci: "GMME", debut: T, fin: T + 7.2e6, role: "arrivee" }], { cache: {}, quota: {}, modifie: false });
test("NOTAM : les deux aéroports sont demandés", () => att(appels.sort().join() === "GMME,GMMH"));
test("NOTAM : aéroport qui répond lu normalement (significatif)", () => att(res[0].statut === "significatif"));
test("NOTAM : aéroport muet → doute « n'a pas répondu à temps », jamais feu vert", () => att(res[1].statut === "doute" && /pas répondu à temps/.test(res[1].motif)));
test("NOTAM : lecture simultanée, durée totale ≈ un seul délai", () => att(Date.now() - t0 < 200));
appels = [];
await verifierFenetres([{ oaci: "GMMH", debut: T - 3.6e6, fin: T + 3.6e6, role: "depart" }, { oaci: "GMMH", debut: T, fin: T + 7.2e6, role: "arrivee" }], { cache: {}, quota: {}, modifie: false });
test("NOTAM : un même aéroport n'est demandé qu'une fois", () => att(appels.length === 1));

// Générateur IA : session obligatoire (05/10/2026)
global.fetch = async () => { throw new Error("ne doit pas être appelé"); };
r = mkRes(); await generate({ method: "POST", headers: {}, body: { messages: [{ role: "user", content: "x" }] } }, r);
test("Générateur IA sans session : refusé (401), Anthropic jamais appelé", () => att(r.code === 401 && /Session expirée/.test(r.body.error.message)));
r = mkRes(); await generate({ method: "POST", headers: {}, body: { messages: [], token: "faux" } }, r);
test("Générateur IA avec un faux jeton : refusé", () => att(r.code === 401));
let envoye = null; global.fetch = async (u, o) => { envoye = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ content: [{ text: "ok" }] }) }; };
r = mkRes(); await generate({ method: "POST", headers: {}, body: { max_tokens: 999999, messages: [{ role: "user", content: "x" }], token: JETON } }, r);
test("Générateur IA avec session : accepté, longueur plafonnée, jeton non transmis à Anthropic", () => att(r.code === 200 && envoye.max_tokens === 8000 && !("token" in envoye)));
global.setTimeout = vraiSetTimeout;
console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
if (ko) process.exit(1);
