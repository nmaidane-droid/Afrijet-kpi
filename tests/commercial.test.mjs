// Tests de la fonction serveur du module Commercial (api/commercial.js), avec la base et Internet simulés.
import handler, { calculerDevis, numeroter, paramsValides, consigne, DEFAUTS } from "../api/commercial.js";
import { signer } from "../api/auth.js";
let ok = 0, ko = 0;
const test = async (n, f) => { try { await f(); console.log("  ✓", n); ok++; } catch (e) { console.log("  ✗", n, "\n     ", e.message); ko++; } };
const att = (c, m) => { if (!c) throw new Error(m || "faux"); };
const mkRes = () => { const r = { code: 0, body: null, headers: {} };
  r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.setHeader = (k, v) => (r.headers[k] = v, r); return r; };

process.env.SESSION_SECRET = "secret-test"; process.env.SUPABASE_URL = "https://base.test"; process.env.SUPABASE_SERVICE_KEY = "cle-service";
delete process.env.ALLOWED_ORIGIN; delete process.env.EIA_API_KEY; delete process.env.ANTHROPIC_API_KEY;
const jeton = profil => signer({ uid: "u1", profil, prenom: "Anas", nom: "BENNANI", exp: Math.floor(Date.now() / 1000) + 3600 }, process.env.SESSION_SECRET);
// Base simulée : kv_store en mémoire
let KV = {}, ecrits = [];
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.startsWith("https://base.test/rest/v1/kv_store")) {
    if (opt && opt.method === "POST") { const b = JSON.parse(opt.body); KV[b.key] = b.value; ecrits.push(b.key); return { ok: true, json: async () => ({}) }; }
    const k = decodeURIComponent(u.split("key=eq.")[1].split("&")[0]);
    return { ok: true, json: async () => (k in KV ? [{ value: KV[k] }] : []) };
  }
  throw new Error("réseau coupé : " + u);
};
const appel = async (body) => { const res = mkRes(); await handler({ method: "POST", headers: {}, body }, res); return res; };
const REELS = [{"numero": "DEV-2026-0001", "version": 1, "tarif": 70000, "immobilisation": 1, "base": {"icao": "GMME", "ville": "Rabat"}, "retour": {"icao": "GMME", "ville": "Rabat"}, "totalHT": 375668, "tva": 75134, "ttc": 450802, "national": true, "lignes": [{"type": "mep", "libelle": "Mise en place", "jours": 0, "de": {"icao": "GMME", "ville": "Rabat"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}, {"type": "vol", "libelle": "Vol aller", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "GMMH", "ville": "Dakhla"}, "national": true, "passagers": true, "distance": 727, "minutes": 136, "montant": 158667}, {"type": "vol", "libelle": "Vol retour", "jours": 0, "de": {"icao": "GMMH", "ville": "Dakhla"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": true, "passagers": true, "distance": 727, "minutes": 136, "montant": 158667}, {"type": "mep", "libelle": "Retour de l'avion", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "GMME", "ville": "Rabat"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}]}, {"numero": "DEV-2026-0002", "version": 1, "tarif": 70000, "immobilisation": 1, "base": {"icao": "GMME", "ville": "Rabat"}, "retour": {"icao": "GMME", "ville": "Rabat"}, "totalHT": 207668, "tva": 41534, "ttc": 249202, "national": true, "lignes": [{"type": "mep", "libelle": "Mise en place", "jours": 0, "de": {"icao": "GMME", "ville": "Rabat"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}, {"type": "vol", "libelle": "Vol aller", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "GMFO", "ville": "Oujda"}, "national": true, "passagers": true, "distance": 294, "minutes": 64, "montant": 74667}, {"type": "vol", "libelle": "Vol retour", "jours": 0, "de": {"icao": "GMFO", "ville": "Oujda"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": true, "passagers": true, "distance": 294, "minutes": 64, "montant": 74667}, {"type": "mep", "libelle": "Retour de l'avion", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "GMME", "ville": "Rabat"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}]}, {"numero": "DEV-2026-0003", "version": 1, "tarif": 70000, "immobilisation": 2, "base": {"icao": "GMME", "ville": "Rabat"}, "retour": {"icao": "GMME", "ville": "Rabat"}, "totalHT": 1236668, "tva": 0, "ttc": 1236668, "national": false, "lignes": [{"type": "mep", "libelle": "Mise en place", "jours": 0, "de": {"icao": "GMME", "ville": "Rabat"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}, {"type": "vol", "libelle": "Vol aller", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "FCBB", "ville": "Brazzaville"}, "national": false, "passagers": true, "distance": 2606, "minutes": 445, "montant": 519167}, {"type": "vol", "libelle": "Vol retour", "jours": 0, "de": {"icao": "FCBB", "ville": "Brazzaville"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": false, "passagers": true, "distance": 2606, "minutes": 445, "montant": 519167}, {"type": "mep", "libelle": "Retour de l'avion", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "GMME", "ville": "Rabat"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}, {"type": "immo", "libelle": "Immobilisation de l'appareil", "jours": 1, "de": {"icao": "", "ville": ""}, "vers": {"icao": "", "ville": ""}, "national": false, "passagers": false, "distance": 0, "minutes": 120, "montant": 140000}]}];

console.log("\nFonction serveur Commercial — calcul identique à Fiches Airshow");
for (const d of REELS.filter(x => x.numero !== "DEV-2026-0003")) {
  await test(d.numero + " recalculé au dirham près", () => {
    const V = { ...DEFAUTS, tarifVol: d.tarif, tarifImmo: d.tarif };
    const r = calculerDevis(d, V, null, { auteur: "t", numero: d.numero, version: 1, now: "2026-09-29T12:00:00.000Z", id: "x" });
    att(r.devis && r.devis.totalHT === d.totalHT && r.devis.tva === d.tva && r.devis.ttc === d.ttc, JSON.stringify(r.devis && [r.devis.totalHT, r.devis.tva]));
  });
}
await test("DEV-2026-0003 (2 606 NM) refusé : hors rayon d'action", () => att(calculerDevis(REELS[2], DEFAUTS, null, { now: "2026-09-29T12:00:00.000Z" }).erreur === "hors_range", "accepté"));
await test("les montants du téléphone sont ignorés", () => {
  const d = { ...REELS[0], lignes: REELS[0].lignes.map(l => ({ ...l, montant: 1 })) };
  att(calculerDevis(d, { ...DEFAUTS, tarifVol: 70000 }, null, { now: "2026-09-29T12:00:00.000Z" }).devis.totalHT === 375668, "montant du téléphone repris");
});
await test("surcharge carburant avec l'indice du jour", () => {
  const r = calculerDevis(REELS[0], { ...DEFAUTS, tarifVol: 70000 }, { madL: 11.2 }, { now: "2026-09-29T12:00:00.000Z" });
  att(r.devis.carburant && r.devis.lignes.some(l => l.type === "fuel") && r.devis.carburant.ref === 10, "pas de surcharge");
});
await test("prix forcé : noté avec son auteur", () => {
  const r = calculerDevis({ ...REELS[0], fuelForce: { GMMN: 12 } }, { ...DEFAUTS, tarifVol: 70000 }, { madL: 11.2 }, { auteur: "Anas", now: "2026-09-29T12:00:00.000Z" });
  att(r.devis.carburant.forcePar === "Anas" && r.devis.carburant.aeroports.find(a => a.icao === "GMMN").prix === 12, "forçage");
});
await test("prix forcé absurde ignoré", () => {
  const r = calculerDevis({ ...REELS[0], fuelForce: { GMMN: 500 } }, { ...DEFAUTS, tarifVol: 70000 }, { madL: 11.2 }, { now: "2026-09-29T12:00:00.000Z" });
  att(!r.devis.carburant.aeroports.find(a => a.icao === "GMMN").force, "accepté");
});
await test("validité : 15 jours", () => { const r = calculerDevis(REELS[0], DEFAUTS, null, { now: "2026-10-01T00:00:00.000Z" }); att(r.devis.validite.startsWith("2026-10-16"), r.devis.validite); });
await test("signataire : celui des Paramètres", () => att(calculerDevis(REELS[0], { ...DEFAUTS, signataire: "Nour MAIDANE" }, null, { now: "2026-10-01T00:00:00.000Z" }).devis.signataire === "Nour MAIDANE", "signataire"));
await test("aucun vol ou plus de 9 lignes : refusé", () => att(calculerDevis({ lignes: [] }, DEFAUTS, null, {}).erreur === "devis" && calculerDevis({ lignes: Array(10).fill(REELS[0].lignes[0]) }, DEFAUTS, null, {}).erreur === "devis", "accepté"));
await test("numérotation : suite d'Airshow", () => att(numeroter(REELS, 3, "", 2026).numero === "DEV-2026-0004", "numéro"));
await test("numérotation : le compteur ne recule jamais", () => att(numeroter(REELS, 17, "", 2026).numero === "DEV-2026-0018", "numéro"));
await test("nouvelle version : même numéro, version suivante", () => { const n = numeroter(REELS, 3, "DEV-2026-0001", 2026); att(n.numero === "DEV-2026-0001" && n.version === 2, JSON.stringify(n)); });
await test("nouvelle version d'un devis inconnu : refusée", () => att(numeroter(REELS, 3, "DEV-2026-0999", 2026).erreur === "parent", "acceptée"));
await test("paramètres : bornes d'Airshow", () => att(paramsValides({ ...DEFAUTS }) && !paramsValides({ ...DEFAUTS, tarifVol: 10 }) && !paramsValides({ ...DEFAUTS, conso: 50 }), "bornes"));
await test("consigne de l'IA : aucun prix, commence par « Suite à notre échange »", () => { const c = consigne({ nom: "A" }); att(/aucun prix/.test(c) && /Suite à notre échange/.test(c), "consigne"); });

console.log("\nFonction serveur Commercial — droits et protection des tarifs");
await test("sans jeton : refusé (401)", async () => att((await appel({ op: "etat" })).code === 401, "accepté"));
await test("jeton falsifié : refusé (401)", async () => att((await appel({ op: "etat", token: jeton("comm") + "x" })).code === 401, "accepté"));
await test("Équipage : ne peut pas créer de devis (403)", async () => att((await appel({ op: "creer", token: jeton("eqp"), devis: REELS[0] })).code === 403, "accepté"));
await test("Commercial : ne peut pas changer les tarifs (403)", async () => { ecrits = []; const r = await appel({ op: "params", token: jeton("comm"), params: DEFAUTS }); att(r.code === 403 && !ecrits.length, "tarif modifié"); });
await test("Administrateur : tarifs enregistrés par le serveur, avec l'auteur", async () => {
  ecrits = []; const r = await appel({ op: "params", token: jeton("rdoa"), params: { ...DEFAUTS, tarifVol: 70000 } });
  const v = JSON.parse(KV["ajs135v1_comParams"]);
  att(r.code === 200 && v.__v.tarifVol === 70000 && v.__v.modifie.auteur === "Anas BENNANI" && v.__t > 0, JSON.stringify(r.body));
});
await test("Administrateur : valeurs incorrectes refusées (400)", async () => att((await appel({ op: "params", token: jeton("rdoa"), params: { ...DEFAUTS, fuelRef: 0 } })).code === 400, "acceptées"));
await test("état : paramètres enregistrés + carburant (sans clé EIA : signalé)", async () => { const r = await appel({ op: "etat", token: jeton("dir") }); att(r.code === 200 && r.body.params.tarifVol === 70000 && r.body.carburant.erreur === "cle_eia", JSON.stringify(r.body)); });
await test("création : numéro suivant réservé, montants au tarif enregistré", async () => {
  KV["ajs135v1_devis"] = JSON.stringify({ __v: REELS, __t: 1 }); KV["ajs135v1_comSeq"] = JSON.stringify({ __v: 3, __t: 1 });
  const r = await appel({ op: "creer", token: jeton("comm"), devis: { ...REELS[0], ficheId: "f1", client: { nom: "HICHAM QADRI" } } });
  att(r.code === 201 && r.body.devis.numero === "DEV-2026-0004" && r.body.devis.totalHT === 375668 && r.body.devis.creePar === "Anas BENNANI" && JSON.parse(KV["ajs135v1_comSeq"]).__v === 4, JSON.stringify(r.body).slice(0, 200));
});
await test("création : deuxième devis → numéro suivant", async () => { const r = await appel({ op: "creer", token: jeton("rdoa"), devis: { ...REELS[1], ficheId: "f2" } }); att(r.body.devis.numero === "DEV-2026-0005", r.body.devis && r.body.devis.numero); });
await test("création hors rayon : refusée (400) sans consommer de numéro", async () => { const r = await appel({ op: "creer", token: jeton("comm"), devis: REELS[2] }); att(r.code === 400 && r.body.error === "hors_range" && JSON.parse(KV["ajs135v1_comSeq"]).__v === 5, "numéro consommé"); });
await test("IA sans clé : erreur explicite (500)", async () => { const r = await appel({ op: "texte", token: jeton("comm"), contexte: { nom: "A" } }); att(r.code === 500 && r.body.error === "cle_absente", JSON.stringify(r.body)); });
await test("opération inconnue : refusée (400)", async () => att((await appel({ op: "autre", token: jeton("comm") })).code === 400, "acceptée"));

console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
