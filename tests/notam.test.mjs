// Tests du chantier NOTAM (api/notam.js) — exécutés sous Node : node tests/notam.test.mjs
// Échantillons réels : NOTAM de Casablanca (GMMN) reçus de SkyLink le 01/10/2026.
import notam, { precharger, lireDate, lireHoraire, horaireCouvre, classer, evaluer, statutVol, fenetresValides,
  volsAVerifier, alerteDe, verifierFenetres, normPiste, PISTES, QUOTA } from "../api/notam.js";
import { signer } from "../api/auth.js";
let ok = 0, ko = 0;
const test = (nom, f) => { try { const r = f(); if (r === false) throw new Error("faux"); ok++; console.log("  ✓ " + nom); } catch (e) { ko++; console.log("  ✗ " + nom + " — " + e.message); } };
const att = (c, m) => { if (!c) throw new Error(m || "attendu"); };
const T = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16));
const fen = (oaci, iso, role) => ({ oaci, debut: T(iso) - 3600000, fin: T(iso) + 3600000, role: role || "depart" });
const N = (o) => ({ scope: "AERODROME", type: "N", schedule: null, ...o });

// Échantillons GMMN réels
const A521 = N({ notam_id: "A521/2026", location: "GMMN", type: "R", effective: "202607061337", expiration: "202610052000", q_code: "QFAHG",
  body: "GRASS CUTTING ON THE MOVEMENT AREA.\r\nPRESENCE PERSONS AND EQPT.\r\nCAUTION RECOMMENDED.\r\nFOLLOW ATC INSTRUCTIONS." });
const A533 = N({ notam_id: "A533/2026", location: "GMMN", effective: "202607071015", expiration: "202610062359", q_code: "QMKXX", body: "COMMISSIONING OF NEW STANDS B14 AND E14," });
const A616 = { notam_id: "A616/2026", location: "GMMM", scope: "FIR", type: "N", effective: "202609010700", expiration: "202611301800", schedule: "0700-1800", q_code: "QWMLW", body: "SEA SHOOTING ACTIVITY" };
const A743 = { notam_id: "A743/2026", location: "GMMM", scope: "FIR", type: "R", effective: "202610010919", expiration: "202611012359EST", schedule: null, q_code: "QKKKK", body: "CHECKLIST" };
const HORAIRES_GMMN = ["0700-1800", "0000-2359", "SR-SS", "SR-1000", "MON-FRI 0900-1600", "MON-FRI 0600-2359",
  "01 13 15 22 0600-2000", "01 05-08 12 14 15 21 22 26 0600-2100", "01-11 13-30 0600-2000, 12 0000-2359", "0545-1015"];

console.log("\nDates");
test("AAAAMMJJhhmm", () => att(lireDate("202610052000").t === T("2026-10-05T20:00")));
test("AAMMJJhhmm (texte brut)", () => att(lireDate("2610052000").t === T("2026-10-05T20:00")));
test("Fin estimée EST", () => { const d = lireDate("202611012359EST"); att(d.est && d.t === T("2026-11-01T23:59")); });
test("PERM : sans fin", () => att(lireDate("PERM").t === Infinity));
test("Date illisible", () => att(lireDate("demain") === null));

console.log("\nHoraires (champ D)");
test("Les 8 formats lisibles de GMMN sont lus", () => att(HORAIRES_GMMN.filter(h => !/^SR/.test(h)).every(h => lireHoraire(h).ok)));
test("SR-SS et SR-1000 : illisibles (lever et coucher du soleil)", () => att(!lireHoraire("SR-SS").ok && !lireHoraire("SR-1000").ok));
test("EXC, HJ, texte libre : illisibles", () => att(!lireHoraire("DAILY EXC SUN 0800-1600").ok && !lireHoraire("HJ").ok && !lireHoraire("WHEN ACTIVE").ok));
test("0700-1800 couvre 10:00, pas 19:30", () => { const h = lireHoraire("0700-1800");
  att(horaireCouvre(h, T("2026-10-05T09:30"), T("2026-10-05T10:30")) && !horaireCouvre(h, T("2026-10-05T19:00"), T("2026-10-05T20:30"))); });
test("MON-FRI : actif lundi 05/10, pas dimanche 04/10", () => { const h = lireHoraire("MON-FRI 0900-1600");
  att(horaireCouvre(h, T("2026-10-05T10:00"), T("2026-10-05T11:00")) && !horaireCouvre(h, T("2026-10-04T10:00"), T("2026-10-04T11:00"))); });
test("Jours du mois 01 05-08 12 : actif le 06, pas le 09", () => { const h = lireHoraire("01 05-08 12 0600-2100");
  att(horaireCouvre(h, T("2026-10-06T10:00"), T("2026-10-06T11:00")) && !horaireCouvre(h, T("2026-10-09T10:00"), T("2026-10-09T11:00"))); });
test("Deux groupes : le 12 toute la journée, le 13 de 06:00 à 20:00", () => { const h = lireHoraire("01-11 13-30 0600-2000, 12 0000-2359");
  att(horaireCouvre(h, T("2026-10-12T02:00"), T("2026-10-12T03:00")) && !horaireCouvre(h, T("2026-10-13T02:00"), T("2026-10-13T03:00"))); });
test("Plage de nuit 2200-0600 : couvre 02:00", () => att(horaireCouvre(lireHoraire("2200-0600"), T("2026-10-05T01:30"), T("2026-10-05T02:30"))));
test("H24", () => att(horaireCouvre(lireHoraire("H24"), T("2026-10-05T01:30"), T("2026-10-05T02:30"))));

console.log("\nClassement (réponse réelle de GMMN)");
const f05 = fen("GMMN", "2026-10-05T10:00");
test("Tonte de l'herbe QFAHG : significatif", () => att(classer(A521, f05).cat === "significatif"));
test("Nouveaux postes QMKXX : rien", () => att(classer(A533, f05).cat === "rien"));
test("NOTAM de FIR : écarté", () => att(classer(A616, f05) === null));
test("Liste récapitulative QKKKK : écartée", () => att(classer({ ...A743, scope: "AERODROME", location: "GMMN" }, f05) === null));
test("Autre aéroport : écarté", () => att(classer(A521, fen("GMME", "2026-10-05T10:00")) === null));
test("Vol après la fin du NOTAM : écarté", () => att(classer(A521, fen("GMMN", "2026-10-06T10:00")) === null));
test("Vol avant le début : écarté", () => att(classer(A521, fen("GMMN", "2026-07-01T10:00")) === null));
test("Chevauchement de quelques minutes : retenu", () => att(classer(A521, fen("GMMN", "2026-10-05T20:50")) !== null));
test("Annulation (NOTAMC) : écartée", () => att(classer({ ...A521, type: "C" }, f05) === null));
const evGMMN = evaluer([A521, A533, A616, A743], f05);
test("GMMN le 05/10 à 10:00 : significatif, sans blocage", () => att(evGMMN.statut === "significatif" && evGMMN.notams.length === 1));

console.log("\nFermetures");
const ferme = (o) => N({ notam_id: "A0457/2026", location: "GMMH", effective: "202610050800", expiration: "202610051400", q_code: "QMRLC", body: "RWY 03/21 CLSD DUE WIP", ...o });
const fH = fen("GMMH", "2026-10-05T09:30");
test("Piste unique fermée (Dakhla) : fermeture", () => att(evaluer([ferme()], fH).statut === "ferme"));
test("Piste écrite 21/03 : même piste", () => att(normPiste("21/03") === normPiste("03/21") && evaluer([ferme({ body: "RWY 21/03 CLSD" })], fH).statut === "ferme"));
test("Hors fenêtre (vol à 15:30) : rien", () => att(evaluer([ferme()], fen("GMMH", "2026-10-05T15:30")).statut === "rien"));
test("Aérodrome fermé QFALC : fermeture", () => att(evaluer([ferme({ q_code: "QFALC", body: "AD CLSD" })], fH).statut === "ferme"));
test("AD CLSD sans code Q : fermeture", () => att(evaluer([ferme({ q_code: "", body: "AD CLSD DUE TO VIP FLIGHT" })], fH).statut === "ferme"));
test("CLSD sans code Q (autre) : doute", () => att(evaluer([ferme({ q_code: "", body: "TWY A CLSD" })], fH).statut === "doute"));
const fN = fen("GMMN", "2026-10-05T11:05", "arrivee");
const g = (piste, id) => N({ notam_id: id || "A1182/2026", location: "GMMN", effective: "202610010000", expiration: "202610312359", q_code: "QMRLC", body: "RWY " + piste + " CLSD" });
test("Une piste sur deux (Casablanca) : doute, motif donné une seule fois", () => { const e = evaluer([g("17L/35R")], fN); att(e.statut === "doute" && e.motif === "A1182/2026 : une piste fermée sur 2"); });
test("Les deux pistes de Casablanca : fermeture", () => att(evaluer([g("17L/35R"), g("17R/35L", "A1183/2026")], fN).statut === "ferme"));
test("Aéroport sans pistes connues : doute", () => att(!PISTES.LFPG && evaluer([{ ...g("09L/27R"), location: "LFPG" }], { ...fN, oaci: "LFPG" }).statut === "doute"));
test("Fermeture partielle (BTN) : doute", () => att(evaluer([ferme({ body: "RWY 03/21 CLSD BTN TWY A AND TWY B" })], fH).statut === "doute"));
test("Fermeture à horaire illisible (SR-SS) : doute", () => att(evaluer([ferme({ schedule: "SR-SS", expiration: "202610312359" })], fH).statut === "doute"));
test("Fermeture à horaire lisible hors fenêtre : rien", () => att(evaluer([ferme({ schedule: "2200-0500", expiration: "202610312359" })], fH).statut === "rien"));
test("Fin estimée (EST) avant le vol : doute, jamais feu vert", () => att(evaluer([ferme({ expiration: "202610050700EST" })], fH).statut === "doute"));
test("Fin certaine avant le vol : rien", () => att(evaluer([ferme({ expiration: "202610050700" })], fH).statut === "rien"));
test("ILS hors service : significatif", () => att(evaluer([N({ notam_id: "A0391/2026", location: "GMME", effective: "202610010600", expiration: "202610081800", q_code: "QICAS", body: "ILS RWY 21 U/S" })], fen("GMME", "2026-10-05T11:00")).statut === "significatif"));
test("Le plus grave l'emporte (fermeture + significatif)", () => att(evaluer([A521, ferme({ location: "GMMN", body: "AD CLSD", q_code: "QFALC" })], f05).statut === "ferme"));
test("Statut du vol : le plus grave des fenêtres", () => att(statutVol([{ statut: "rien" }, { statut: "doute" }, { statut: "significatif" }]) === "doute"));

console.log("\nFenêtres et vérification quotidienne");
test("Fenêtres valides", () => att(fenetresValides([{ oaci: "gmmh", debut: 1, fin: 7200001 }])[0].oaci === "GMMH"));
test("Fenêtre trop longue ou inversée : refusée", () => att(fenetresValides([{ oaci: "GMMH", debut: 10, fin: 5 }]) === null && fenetresValides([{ oaci: "GMMH", debut: 0, fin: 9 * 3600000 }]) === null));
test("Code OACI absent : gardé vide (doute côté serveur)", () => att(fenetresValides([{ oaci: "", iata: "XYZ", debut: 0, fin: 1 }])[0].oaci === ""));
const now = T("2026-10-03T06:00");
const vol = (o) => ({ id: "F1", num: "AJS401", status: "Planifie", date: "2026-10-05", notam: { statut: "rien", ids: [], fenetres: [fH] }, ...o });
test("Vol à 51 h : vérifié chaque jour", () => att(volsAVerifier([vol()], now).length === 1));
test("Vol à 5 jours, vol terminé, vol sans fenêtres : ignorés", () => att(volsAVerifier([vol({ notam: { fenetres: [fen("GMMH", "2026-10-08T09:30")] } }), vol({ status: "Termine" }), vol({ notam: null })], now).length === 0));
test("Nouvelle fermeture après planification : alerte", () => { const r = [{ ...fH, ...evaluer([ferme()], fH) }]; const a = alerteDe(vol(), r, now); att(a && a.statut === "ferme" && a.notams[0].id === "A0457/2026"); });
test("Fermeture déjà vue à la planification : pas de nouvelle alerte", () => { const r = [{ ...fH, ...evaluer([ferme()], fH) }]; att(alerteDe(vol({ notam: { statut: "ferme", ids: ["A0457/2026"], fenetres: [fH] } }), r, now) === null); });
test("Rien de grave : pas d'alerte", () => att(alerteDe(vol(), [{ ...f05, ...evaluer([A521], f05) }], now) === null));

console.log("\nServeur");
const sansCle = await verifierFenetres([fH], { cache: {}, quota: {}, modifie: false });
test("Sans clé NOTAM : doute, jamais feu vert", () => att(sansCle[0].statut === "doute" && /NOTAM_API_KEY/.test(sansCle[0].motif)));
const quotaPlein = await verifierFenetres([fH], { cache: {}, quota: { mois: new Date().toISOString().slice(0, 7), n: QUOTA }, modifie: false });
test("Quota mensuel atteint : doute", () => att(quotaPlein[0].statut === "doute" && /quota/.test(quotaPlein[0].motif)));
const enCache = await verifierFenetres([fH], { cache: { GMMH: { lu: Date.now(), notams: [ferme()] } }, quota: {}, modifie: false });
test("Lecture en cache (moins de 30 min) : sans requête", () => att(enCache[0].statut === "ferme"));
const inconnu = await verifierFenetres([{ oaci: "", iata: "XYZ", debut: 0, fin: 1 }], { cache: {}, quota: {}, modifie: false });
test("Aéroport inconnu : doute (résultat)", () => att(inconnu[0].statut === "doute" && /XYZ/.test(inconnu[0].motif)));
const rep = () => { const o = { code: 0, body: null, h: {} }; return Object.assign(o, { status(c) { o.code = c; return o; }, json(b) { o.body = b; return o; }, setHeader(k, v) { o.h[k] = v; } }); };
process.env.SESSION_SECRET = "s"; process.env.SUPABASE_URL = "http://x"; process.env.SUPABASE_SERVICE_KEY = "k"; process.env.CRON_SECRET = "c";
let r = rep(); await notam({ method: "POST", headers: {}, body: { op: "verifier", fenetres: [fH] } }, r);
test("Sans jeton : refusé", () => att(r.code === 401));
r = rep(); await notam({ method: "GET", headers: {} }, r);
test("Tâche planifiée sans secret : refusée", () => att(r.code === 401));
r = rep(); await notam({ method: "POST", headers: {}, body: { token: signer({ uid: "U1", profil: "ops", exp: Math.floor(Date.now() / 1e3) + 600 }, "s"), op: "autre" } }, r);
test("Opération inconnue : refusée", () => att(r.code === 400));

console.log("\nRefus 429 et réponse vide (05/10/2026)");
{ const vieux = global.fetch; process.env.NOTAM_API_KEY = "k"; delete process.env.NOTAM_API_URL;
  let n = 0;
  global.fetch = async () => (++n === 1 ? { ok: false, status: 429, headers: { get: () => "1" } } : { ok: true, status: 200, json: async () => ({ notams: [] }) });
  const e1 = { cache: {}, quota: {}, modifie: false }; let pauses = 0;
  await precharger(["GMFB"], e1, async () => { pauses++; });
  test("429 puis succès : réessai unique après la pause demandée", () => att(e1.lus.GMFB.ok && n === 2 && pauses === 1));
  n = 0; global.fetch = async () => { n++; return { ok: false, status: 429, headers: { get: () => null } }; };
  const e2 = { cache: {}, quota: {}, modifie: false };
  await precharger(["GMFB"], e2, async () => {});
  const r2 = await verifierFenetres([{ oaci: "GMFB", debut: 0, fin: 1, role: "depart" }], e2);
  test("429 persistant : un seul réessai, puis doute avec message clair", () => att(n === 2 && r2[0].statut === "doute" && /momentanément saturée/.test(r2[0].motif)));
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ notams: [] }) });
  const r3 = await verifierFenetres([{ oaci: "GMFB", debut: 0, fin: 1, role: "depart" }], { cache: {}, quota: {}, modifie: false });
  test("Réponse vide : feu vert, mais signalée (vide)", () => att(r3[0].statut === "rien" && r3[0].vide === true));
  const r4 = await verifierFenetres([fH], { cache: { GMMH: { lu: Date.now(), notams: [ferme()] } }, quota: {}, modifie: false });
  test("Réponse avec NOTAM : pas signalée vide", () => att(r4[0].vide === false));
  global.fetch = vieux; }

console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
if (ko) process.exit(1);
