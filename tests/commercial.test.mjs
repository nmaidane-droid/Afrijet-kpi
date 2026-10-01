// Tests de la fonction serveur du module Commercial (api/commercial.js), avec la base et Internet simulés.
import handler, { calculerDevis, carburantDevis, estMaroc, numeroter, paramsValides, consigne, fusionImport, marquerDevis, listeRestaurable, DEFAUTS } from "../api/commercial.js";
import { signer } from "../api/auth.js";
let ok = 0, ko = 0;
const test = async (n, f) => { try { await f(); console.log("  ✓", n); ok++; } catch (e) { console.log("  ✗", n, "\n     ", e.message); ko++; } };
const att = (c, m) => { if (!c) throw new Error(m || "faux"); };
const mkRes = () => { const r = { code: 0, body: null, headers: {} };
  r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.setHeader = (k, v) => (r.headers[k] = v, r); return r; };

process.env.SESSION_SECRET = "secret-test"; process.env.SUPABASE_URL = "https://base.test"; process.env.SUPABASE_SERVICE_KEY = "cle-service";
delete process.env.ALLOWED_ORIGIN; delete process.env.ANTHROPIC_API_KEY;
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
const OPT = { auteur: "t", numero: "DEV-2026-0099", version: 1, now: "2026-09-29T12:00:00.000Z", id: "x" };
for (const d of REELS.filter(x => x.numero !== "DEV-2026-0003")) {
  await test(d.numero + " recalculé au dirham près (100 % Maroc : aucun supplément)", () => {
    const V = { ...DEFAUTS, tarifVol: d.tarif, tarifImmo: d.tarif };
    const r = calculerDevis(d, V, { ...OPT, numero: d.numero });
    att(r.devis && r.devis.totalHT === d.totalHT && r.devis.tva === d.tva && r.devis.ttc === d.ttc && !r.devis.lignes.some(l => l.type === "fuel"), JSON.stringify(r.devis && [r.devis.totalHT, r.devis.tva]));
  });
}
await test("DEV-2026-0003 (2 606 NM) refusé : hors rayon d'action", () => att(calculerDevis(REELS[2], DEFAUTS, { now: "2026-09-29T12:00:00.000Z" }).erreur === "hors_range", "accepté"));
await test("les montants du téléphone sont ignorés", () => {
  const d = { ...REELS[0], lignes: REELS[0].lignes.map(l => ({ ...l, montant: 1 })) };
  att(calculerDevis(d, { ...DEFAUTS, tarifVol: 70000 }, OPT).devis.totalHT === 375668, "montant du téléphone repris");
});

console.log("\nFonction serveur Commercial — carburant Maroc / Étranger (validé le 30/09/2026)");
const P = { ...DEFAUTS, tarifVol: 74000, tarifImmo: 74000, fuelMaroc: 12.5, fuelEtranger: 16.4, conso: 1100 };
const lg = (type, libelle, de, vers, distance, minutes, passagers, national) => ({ type, libelle, jours: 0, de, vers, national, passagers, distance, minutes, montant: 0 });
const CMN = { icao: "GMMN", ville: "Casablanca" }, GVA = { icao: "LSGG", ville: "Genève" }, TTU = { icao: "GMTN", ville: "Tétouan" };
const GENEVE = { ficheId: "f9", base: CMN, retour: CMN, immobilisation: 1, client: { nom: "Test" }, lignes: [
  lg("mep", "Mise en place", CMN, GVA, 996, 162, false, false), lg("vol", "Vol aller", GVA, TTU, 822, 136, true, false), lg("mep", "Retour de l'avion", TTU, CMN, 174, 41, false, true)] };
const G = calculerDevis(GENEVE, P, OPT).devis;
const apt = (d, i) => d.carburant.aeroports.find(a => a.icao === i);
await test("code OACI en GM : Maroc (Dakhla, Laâyoune compris) ; sinon Étranger", () => att(estMaroc("GMMH") && estMaroc("GMML") && estMaroc("gmmn") && !estMaroc("LSGG") && !estMaroc("GQNO"), "zones"));
await test("vols au tarif unique : 199 800 + 167 733 + 50 567 MAD", () => att(G.lignes.slice(0, 3).map(l => l.montant).join() === "199800,167733,50567", G.lignes.map(l => l.montant).join()));
await test("Genève : 2 493 L × (16,40 − 12,50) = 9 723 MAD", () => { const a = apt(G, "LSGG"); att(a.zone === "etranger" && a.litres === 2493 && a.supplement === 9723 && a.prix === 16.4, JSON.stringify(a)); });
await test("Casablanca 2 970 L et Tétouan 752 L : Maroc, carburant inclus (0 MAD)", () => att(apt(G, "GMMN").litres === 2970 && apt(G, "GMMN").supplement === 0 && apt(G, "GMTN").litres === 752 && apt(G, "GMTN").supplement === 0 && apt(G, "GMTN").zone === "maroc", "Maroc"));
await test("une ligne « Supplément carburant » de 9 723 MAD", () => { const f = G.lignes.filter(l => l.type === "fuel"); att(f.length === 1 && f[0].libelle === "Supplément carburant" && f[0].montant === 9723, JSON.stringify(f)); });
await test("total HT 427 823 MAD, TVA exonérée (international)", () => att(G.totalHT === 427823 && G.tva === 0 && G.ttc === 427823 && !G.national, JSON.stringify([G.totalHT, G.tva])));
await test("détail interne stocké : prix, litres, supplément, paramètres du jour", () => att(G.carburant.modele === 2 && G.carburant.maroc === 12.5 && G.carburant.etranger === 16.4 && G.carburant.conso === 1100 && G.carburant.supplement === 9723 && G.carburant.forcePar === null, JSON.stringify(G.carburant).slice(0, 200)));
await test("mission 100 % Maroc : aucune ligne carburant", () => { const r = calculerDevis(REELS[0], P, OPT).devis; att(!r.lignes.some(l => l.type === "fuel") && r.carburant.supplement === 0 && r.carburant.aeroports.every(a => a.zone === "maroc"), "ligne en trop"); });
await test("immobilisation sans carburant", () => att(carburantDevis([...GENEVE.lignes, { type: "immo", jours: 2, minutes: 240, de: { icao: "" } }], P, {}).aeroports.length === 3, "immobilisation comptée"));
const H = calculerDevis({ ...GENEVE, fuelForce: { LSGG: 18 } }, P, { ...OPT, auteur: "Anas BENNANI" }).devis;
await test("prix forcé plus haut (Genève 18,00) : 2 493 × 5,50 = 13 712 MAD, auteur noté", () => att(apt(H, "LSGG").force && apt(H, "LSGG").supplement === 13712 && apt(H, "LSGG").prixStandard === 16.4 && H.carburant.forcePar === "Anas BENNANI" && H.totalHT === 431812, JSON.stringify([apt(H, "LSGG"), H.totalHT])));
const B = calculerDevis({ ...GENEVE, fuelForce: { LSGG: 14 } }, P, OPT).devis;
await test("prix forcé plus bas (Genève 14,00) : 2 493 × 1,50 = 3 740 MAD", () => att(apt(B, "LSGG").supplement === 3740 && B.totalHT === 421840, JSON.stringify([apt(B, "LSGG").supplement, B.totalHT])));
const N = calculerDevis({ ...GENEVE, fuelForce: { GMMN: 10 } }, P, OPT).devis;
await test("prix forcé sous le prix Maroc (Casablanca 10,00) : supplément négatif −7 425 MAD", () => att(apt(N, "GMMN").supplement === -7425 && N.lignes.find(l => l.type === "fuel").montant === 9723 - 7425, JSON.stringify(apt(N, "GMMN"))));
await test("prix forcé égal au prix Maroc sur tous les départs : supplément nul, aucune ligne", () => att(!calculerDevis({ ...GENEVE, fuelForce: { LSGG: 12.5 } }, P, OPT).devis.lignes.some(l => l.type === "fuel"), "ligne"));
await test("prix forcé hors bornes (0,05 ou 500 MAD/L) : ignoré", () => { const r = calculerDevis({ ...GENEVE, fuelForce: { LSGG: 500, GMMN: 0.05 } }, P, OPT).devis; att(!apt(r, "LSGG").force && !apt(r, "GMMN").force && r.carburant.supplement === 9723, "accepté"); });
await test("prix forcé sur un aéroport hors devis : sans effet", () => att(calculerDevis({ ...GENEVE, fuelForce: { LFPG: 30 } }, P, OPT).devis.carburant.supplement === 9723, "effet"));
await test("ligne carburant envoyée par le téléphone : remplacée par le calcul du serveur", () => { const r = calculerDevis({ ...GENEVE, lignes: [...GENEVE.lignes, { type: "fuel", montant: 1, de: {}, vers: {} }] }, P, OPT).devis; att(r.lignes.filter(l => l.type === "fuel").length === 1 && r.totalHT === 427823, "falsifié"); });
await test("vol national avec départ étranger impossible ; tout Maroc : TVA 20 % sur le total", () => { const r = calculerDevis(REELS[0], P, OPT).devis; att(r.national && r.tva === Math.round(r.totalHT * 0.2), "TVA"); });

console.log("\nFonction serveur Commercial — devis, numéros, paramètres");
await test("validité : 15 jours", () => { const r = calculerDevis(REELS[0], DEFAUTS, { now: "2026-10-01T00:00:00.000Z" }); att(r.devis.validite.startsWith("2026-10-16"), r.devis.validite); });
await test("signataire : celui des Paramètres", () => att(calculerDevis(REELS[0], { ...DEFAUTS, signataire: "Nour MAIDANE" }, { now: "2026-10-01T00:00:00.000Z" }).devis.signataire === "Nour MAIDANE", "signataire"));
await test("aucun vol ou plus de 9 lignes : refusé", () => att(calculerDevis({ lignes: [] }, DEFAUTS, {}).erreur === "devis" && calculerDevis({ lignes: Array(10).fill(REELS[0].lignes[0]) }, DEFAUTS, {}).erreur === "devis", "accepté"));
await test("numérotation : suite d'Airshow", () => att(numeroter(REELS, 3, "", 2026).numero === "DEV-2026-0004", "numéro"));
await test("numérotation : le compteur ne recule jamais", () => att(numeroter(REELS, 17, "", 2026).numero === "DEV-2026-0018", "numéro"));
await test("nouvelle version : même numéro, version suivante", () => { const n = numeroter(REELS, 3, "DEV-2026-0001", 2026); att(n.numero === "DEV-2026-0001" && n.version === 2, JSON.stringify(n)); });
await test("nouvelle version d'un devis inconnu : refusée", () => att(numeroter(REELS, 3, "DEV-2026-0999", 2026).erreur === "parent", "acceptée"));
await test("paramètres : bornes (tarifs d'Airshow, carburant 0,10 à 100 MAD/L)", () => att(paramsValides({ ...DEFAUTS }) && !paramsValides({ ...DEFAUTS, tarifVol: 10 }) && !paramsValides({ ...DEFAUTS, conso: 50 })
  && !paramsValides({ ...DEFAUTS, fuelMaroc: 0 }) && !paramsValides({ ...DEFAUTS, fuelEtranger: 101 }) && paramsValides({ ...DEFAUTS, fuelMaroc: "12,50" }).fuelMaroc === 12.5, "bornes"));
await test("paramètres : l'ancienne référence (indice) n'est plus gardée", () => att(!("fuelRef" in paramsValides({ ...DEFAUTS, fuelRef: 10 })), "fuelRef"));
await test("consigne de l'IA : aucun prix, commence par « Suite à notre échange »", () => { const c = consigne({ nom: "A" }); att(/aucun prix/.test(c) && /Suite à notre échange/.test(c), "consigne"); });
await test("import Airshow : supplément importé gardé tel quel, rien supprimé", () => {
  const air = { ...REELS[0], id: "a1", lignes: [...REELS[0].lignes, { type: "fuel", libelle: "Surcharge carburant", montant: 1234 }] };
  const f = fusionImport([{ id: "k1", numero: "DEV-2026-0004" }], [air, { id: "", numero: "x" }]);
  att(f.liste.length === 2 && f.liste[1].source === "airshow" && f.liste[1].lignes.at(-1).montant === 1234 && f.rapport.nouveaux === 1 && f.rapport.refuses === 1, JSON.stringify(f.rapport));
});
await test("import répété : identique ; envoi repris d'Airshow", () => { const ex = [{ id: "a1", numero: "DEV-2026-0001", lignes: [] }]; const f = fusionImport(ex, [{ id: "a1", numero: "DEV-2026-0001", lignes: [], envoye: { date: "d" } }]); att(f.rapport.maj === 1 && f.liste[0].envoye.date === "d" && fusionImport(f.liste, f.liste).rapport.identiques === 1, "fusion"); });
await test("envoyé / accepté : posé une seule fois", () => { const m = marquerDevis([{ id: "a" }], "a", "envoye", "t1", "A"); att(m.devis.envoye.date === "t1" && marquerDevis(m.liste, "a", "envoye", "t2", "B").inchange && marquerDevis(m.liste, "z", "envoye", "t", "A").erreur === "introuvable", "marquage"); });
await test("restauration : liste de devis valide seulement", () => att(listeRestaurable([]) && listeRestaurable([{ id: "a" }]) && !listeRestaurable([{ numero: "x" }]) && !listeRestaurable({}), "restauration"));

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
await test("Administrateur : valeurs incorrectes refusées (400)", async () => att((await appel({ op: "params", token: jeton("rdoa"), params: { ...DEFAUTS, fuelEtranger: 0 } })).code === 400, "acceptées"));
await test("état : paramètres enregistrés, sans aucun indice ni service extérieur", async () => { const r = await appel({ op: "etat", token: jeton("dir") }); att(r.code === 200 && r.body.params.tarifVol === 70000 && r.body.params.fuelMaroc === 12.5 && !("carburant" in r.body), JSON.stringify(r.body)); });
await test("création : numéro suivant réservé, montants au tarif enregistré", async () => {
  KV["ajs135v1_devis"] = JSON.stringify({ __v: REELS, __t: 1 }); KV["ajs135v1_comSeq"] = JSON.stringify({ __v: 3, __t: 1 });
  const r = await appel({ op: "creer", token: jeton("comm"), devis: { ...REELS[0], ficheId: "f1", client: { nom: "HICHAM QADRI" } } });
  const liste = JSON.parse(KV["ajs135v1_devis"]).__v;
  att(r.code === 201 && r.body.devis.numero === "DEV-2026-0004" && r.body.devis.totalHT === 375668 && r.body.devis.creePar === "Anas BENNANI" && JSON.parse(KV["ajs135v1_comSeq"]).__v === 4
    && liste.length === 4 && liste[3].id === r.body.devis.id, JSON.stringify(r.body).slice(0, 200));
});
await test("création : deuxième devis → numéro suivant", async () => { const r = await appel({ op: "creer", token: jeton("rdoa"), devis: { ...REELS[1], ficheId: "f2" } }); att(r.body.devis.numero === "DEV-2026-0005", r.body.devis && r.body.devis.numero); });
await test("création hors rayon : refusée (400) sans consommer de numéro", async () => { const r = await appel({ op: "creer", token: jeton("comm"), devis: REELS[2] }); att(r.code === 400 && r.body.error === "hors_range" && JSON.parse(KV["ajs135v1_comSeq"]).__v === 5, "numéro consommé"); });
await test("création : devis enregistré par le serveur (la page n'écrit plus la clé devis)", async () => { ecrits = []; const r = await appel({ op: "creer", token: jeton("comm"), devis: { ...GENEVE } }); att(r.code === 201 && ecrits.includes("ajs135v1_devis") && JSON.parse(KV["ajs135v1_devis"]).__v.some(d => d.id === r.body.devis.id), JSON.stringify(ecrits)); });
await test("montant falsifié depuis le navigateur (ligne carburant à 1 MAD, vols à 1 MAD) : recalculé", async () => {
  KV["ajs135v1_comParams"] = JSON.stringify({ __v: P, __t: 1 });
  const faux = { ...GENEVE, totalHT: 1, lignes: [...GENEVE.lignes.map(l => ({ ...l, montant: 1 })), { type: "fuel", montant: 1, de: {}, vers: {} }] };
  const r = await appel({ op: "creer", token: jeton("comm"), devis: faux });
  att(r.code === 201 && r.body.devis.totalHT === 427823 && r.body.devis.carburant.supplement === 9723, JSON.stringify(r.body.devis && r.body.devis.totalHT));
});
await test("prix forcé envoyé hors bornes : refusé par le serveur (prix standard appliqué)", async () => { const r = await appel({ op: "creer", token: jeton("comm"), devis: { ...GENEVE, fuelForce: { LSGG: 0.01 } } }); att(r.code === 201 && r.body.devis.totalHT === 427823, String(r.body.devis && r.body.devis.totalHT)); });
await test("nouvelle version : prix forcé repris, même numéro", async () => {
  const v1 = (await appel({ op: "creer", token: jeton("comm"), devis: { ...GENEVE, fuelForce: { LSGG: 18 } } })).body.devis;
  const v2 = (await appel({ op: "creer", token: jeton("rdoa"), devis: { ...GENEVE, fuelForce: { LSGG: 18 }, numeroParent: v1.numero } })).body.devis;
  att(v2.numero === v1.numero && v2.version === 2 && v2.totalHT === 431812 && v2.carburant.forcePar === "Anas BENNANI", JSON.stringify([v2.numero, v2.version, v2.totalHT]));
});
await test("envoyé : date et auteur posés par le serveur", async () => { const id = JSON.parse(KV["ajs135v1_devis"]).__v.at(-1).id; const r = await appel({ op: "envoye", token: jeton("comm"), id }); att(r.code === 200 && r.body.devis.envoye.auteur === "Anas BENNANI" && JSON.parse(KV["ajs135v1_devis"]).__v.at(-1).envoye, JSON.stringify(r.body)); });
await test("accepté : enregistré une fois ; devis inconnu : 404", async () => { const id = JSON.parse(KV["ajs135v1_devis"]).__v.at(-2).id; const a = await appel({ op: "accepte", token: jeton("comm"), id }), b = await appel({ op: "accepte", token: jeton("comm"), id }), c = await appel({ op: "accepte", token: jeton("comm"), id: "zz" }); att(a.code === 200 && b.body.inchange && b.body.devis.accepte.date === a.body.devis.accepte.date && c.code === 404, "acceptation"); });
await test("Direction : ne peut ni marquer ni importer (403)", async () => att((await appel({ op: "envoye", token: jeton("dir"), id: "x" })).code === 403 && (await appel({ op: "importer", token: jeton("dir"), devis: [] })).code === 403, "accepté"));
await test("import : devis d'Airshow ajoutés par le serveur, rien supprimé", async () => { const n = JSON.parse(KV["ajs135v1_devis"]).__v.length; const r = await appel({ op: "importer", token: jeton("comm"), devis: [{ ...REELS[1], id: "air-x" }] }); att(r.code === 200 && r.body.rapport.nouveaux === 1 && JSON.parse(KV["ajs135v1_devis"]).__v.length === n + 1, JSON.stringify(r.body.rapport)); });
await test("restauration : réservée à l'Administrateur", async () => { const a = await appel({ op: "restaurer", token: jeton("comm"), devis: [] }), b = await appel({ op: "restaurer", token: jeton("rdoa"), devis: [{ id: "r1", numero: "DEV-2026-0001" }] }); att(a.code === 403 && b.code === 200 && JSON.parse(KV["ajs135v1_devis"]).__v.length === 1, "restauration"); });
await test("effacement (liste vide) par l'Administrateur", async () => { const r = await appel({ op: "restaurer", token: jeton("rdoa"), devis: [] }); att(r.code === 200 && JSON.parse(KV["ajs135v1_devis"]).__v.length === 0, "effacement"); });
await test("aucun appel à un service de prix du carburant", async () => { let vu = []; const f = global.fetch; global.fetch = async (u, o) => { vu.push(String(u)); return f(u, o); }; await appel({ op: "etat", token: jeton("comm") }); global.fetch = f; att(!vu.some(u => /eia\.gov|er-api/.test(u)), vu.join()); });
await test("IA sans clé : erreur explicite (500)", async () => { const r = await appel({ op: "texte", token: jeton("comm"), contexte: { nom: "A" } }); att(r.code === 500 && r.body.error === "cle_absente", JSON.stringify(r.body)); });
await test("opération inconnue : refusée (400)", async () => att((await appel({ op: "autre", token: jeton("comm") })).code === 400, "acceptée"));

console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
