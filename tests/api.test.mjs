// Tests des fonctions serveur fr24 et wx, avec les services simulés.
import fr24, { buildUrl as urlFr24, originOk } from "../api/fr24.js";
import wx, { buildUrl as urlWx } from "../api/wx.js";
import mapbox from "../api/mapbox.js";
let ok = 0, ko = 0;
const test = (n, f) => { try { f(); console.log("  ✓", n); ok++; } catch (e) { console.log("  ✗", n, "\n     ", e.message); ko++; } };
const att = (c, m) => { if (!c) throw new Error(m || "faux"); };
const mkRes = () => { const r = { code: 0, body: null, headers: {} };
  r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.send = b => (r.body = b, r);
  r.setHeader = (k, v) => (r.headers[k] = v, r); return r; };

console.log("\nFonctions serveur : position et météo");
process.env.FR24_TOKEN = "jeton-test"; process.env.CHECKWX_KEY = "cle-test"; delete process.env.ALLOWED_ORIGIN;

test("URL position : immatriculation", () => att(urlFr24({ registrations: "CN-KTA" }).includes("registrations=CN-KTA")));
test("URL position : secteur", () => att(urlFr24({ bounds: "34,30,-10,-4" }).includes("bounds=34%2C30%2C-10%2C-4")));
test("URL position : refus sans paramètre", () => att(urlFr24({}) === null));
test("URL position : rien d'autre n'est transmis", () => { const u = urlFr24({ registrations: "CN-KTA", autre: "x" }); att(!u.includes("autre")); });
test("URL météo : code OACI valide", () => att(urlWx({ icao: "gmmn" }) === "https://api.checkwx.com/metar/GMMN/decoded"));
test("URL météo : TAF", () => att(urlWx({ icao: "GMMN", type: "taf" }).includes("/taf/")));
test("URL météo : refus d'un code invalide", () => att(urlWx({ icao: "../secret" }) === null && urlWx({ icao: "GM" }) === null));

let vu = null;
global.fetch = async (url, opt) => { vu = { url, opt }; return { status: 200, text: async () => JSON.stringify({ data: [{ ok: true }] }) }; };

let r1 = mkRes(); await fr24({ headers: {}, query: { registrations: "CN-KTA" } }, r1);
test("Position : le jeton est ajouté par le serveur", () => att(vu.opt.headers.Authorization === "Bearer jeton-test" && r1.code === 200));
test("Position : réponse transmise à la page", () => att(JSON.parse(r1.body).data[0].ok === true));
test("Position : mise en cache courte", () => att(String(r1.headers["Cache-Control"]).includes("s-maxage=20")));

let r2 = mkRes(); await wx({ headers: {}, query: { icao: "GMMN" } }, r2);
test("Météo : la clé est ajoutée par le serveur", () => att(vu.opt.headers["X-API-Key"] === "cle-test" && r2.code === 200));
test("Météo : mise en cache de 5 minutes", () => att(String(r2.headers["Cache-Control"]).includes("s-maxage=300")));

let r3 = mkRes(); await fr24({ headers: {}, query: {} }, r3);
test("Position : demande sans paramètre refusée", () => att(r3.code === 400));
let r4 = mkRes(); await wx({ headers: {}, query: { icao: "XX" } }, r4);
test("Météo : code OACI invalide refusé", () => att(r4.code === 400));

process.env.ALLOWED_ORIGIN = "https://afrijet-kpi.vercel.app";
test("Origine autorisée acceptée", () => att(originOk({ headers: { origin: "https://afrijet-kpi.vercel.app" } })));
let r5 = mkRes(); await fr24({ headers: { origin: "https://autre-site.example" }, query: { registrations: "CN-KTA" } }, r5);
test("Origine étrangère refusée", () => att(r5.code === 403));
delete process.env.ALLOWED_ORIGIN;

delete process.env.FR24_TOKEN;
let r6 = mkRes(); await fr24({ headers: {}, query: { registrations: "CN-KTA" } }, r6);
test("Jeton absent : erreur explicite, sans appel au service", () => att(r6.code === 500 && String(r6.body.error).includes("FR24_TOKEN")));

global.fetch = async () => { throw new Error("réseau indisponible"); };
process.env.FR24_TOKEN = "jeton-test";
let r7 = mkRes(); await fr24({ headers: {}, query: { registrations: "CN-KTA" } }, r7);
test("Service injoignable : erreur renvoyée proprement", () => att(r7.code === 502));
process.env.MAPBOX_TOKEN = "pk.test";
let r8 = mkRes(); await mapbox({ headers: {} }, r8);
test("Carte : le jeton vient du serveur", () => att(r8.code === 200 && r8.body.token === "pk.test"));
test("Carte : jeton mis en cache une heure", () => att(String(r8.headers["Cache-Control"]).includes("s-maxage=3600")));
delete process.env.MAPBOX_TOKEN;
let r9 = mkRes(); await mapbox({ headers: {} }, r9);
test("Carte : absence de jeton signalée", () => att(r9.code === 500 && String(r9.body.error).includes("MAPBOX_TOKEN")));
console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
