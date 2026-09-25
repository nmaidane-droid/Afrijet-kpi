// Tests de la sauvegarde hors site (api/backup.js), avec Supabase et l'envoi de courriel simulés.
import { buildBackup, sbFetchAll, cheminDuJour, deposerGitHub, aSupprimer, cleDuJour } from "../api/backup.js";
import handler from "../api/backup.js";
let ok = 0, ko = 0;
const test = (n, f) => { try { f(); console.log("  ✓", n); ok++; } catch (e) { console.log("  ✗", n, "\n     ", e.message); ko++; } };
const att = (c, m) => { if (!c) throw new Error(m || "faux"); };

console.log("\nSauvegarde hors site");
// Comme l'application : les valeurs sont enregistrées en texte JSON
const kv = [
  { key: "ajs135v1_flights", value: JSON.stringify({ __v: [{ num: "CN-KTA" }, { num: "CN-KTB" }], __t: 1 }) },
  { key: "ajs135v1_sgsHazards", value: JSON.stringify({ __v: [{ ref: "DG-001" }] }) },
  { key: "ajs135v1_sgsResponsable", value: { __v: "Youssef IKLI" } },
  { key: "ajs135v1_users", value: { __v: [{ hash: "secret" }] } },
  { key: "ajs135v1_totp_secret_u_UY", value: ["JBSW"] },
  { key: "autre_appli_x", value: 1 },
];
const audit = [{ id: 1, ts: "2026-09-01T10:00:00Z" }, { id: 2, ts: "2026-09-22T10:00:00Z" }];
const b = buildBackup({ kv, audit, now: "2026-09-22T03:00:00Z" });
test("données reprises sans l'enveloppe de synchronisation", () => att(b.donnees.flights.length === 2 && b.donnees.sgsResponsable === "Youssef IKLI"));
test("mots de passe et clés Authenticator exclus", () => att(!("users" in b.donnees) && !Object.keys(b.donnees).some(k => k.includes("totp"))));
test("clés d'une autre application ignorées", () => att(!("autre_appli_x" in b.donnees)));
test("journal joint, avec ses bornes", () => att(b.journal.entrees === 2 && b.journal.premiere === "2026-09-01T10:00:00Z" && b.journal.derniere === "2026-09-22T10:00:00Z"));
test("compteurs par registre", () => att(b.compteurs.flights === 2 && b.compteurs.sgsHazards === 1));

// Supabase simulé : deux pages
global.fetch = async (url, opt) => {
  if (String(url).includes("kv_store")) {
    const [from] = (opt.headers.Range || "0-999").split("-").map(Number);
    return { ok: true, json: async () => (from === 0 ? Array.from({ length: 1000 }, (_, i) => ({ key: "ajs135v1_k" + i, value: { __v: i } })) : [{ key: "ajs135v1_last", value: { __v: 1 } }]) };
  }
  return { ok: true, json: async () => [] };
};
const rows = await sbFetchAll("https://x", "k", "kv_store", "key,value");
test("lecture paginée complète (1001 lignes)", () => att(rows.length === 1001, "obtenu " + rows.length));

// Dépôt simulé dans le dépôt GitHub, puis appel complet du point d'entrée
let depots = []; let ecrits = [];
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.github.com")) {
    if (!opt || opt.method !== "PUT") return { status: depots.length ? 200 : 404, ok: depots.length > 0, json: async () => ({ sha: "sha-existant" }), text: async () => "" };
    depots.push({ url: u, corps: JSON.parse(opt.body) });
    return { ok: true, status: 201, json: async () => ({}), text: async () => "" };
  }
  if (u.includes("/rest/v1/kv_store") && opt?.method === "POST") { ecrits.push(JSON.parse(opt.body)); return { ok: true, json: async () => ({}) }; }
  if (u.includes("audit_log")) return { ok: true, json: async () => audit };
  return { ok: true, json: async () => kv };
};
process.env.SUPABASE_URL = "https://x"; process.env.SUPABASE_SERVICE_KEY = "k";
process.env.GITHUB_TOKEN = "jeton"; process.env.GITHUB_REPO = "nmaidane-droid/sauvegardes-afrijet"; process.env.CRON_SECRET = "s3cret";
const mkRes = () => { const r = { code: 0, body: null }; r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.setHeader = () => r; r.send = b => (r.body = b, r); return r; };

test("chemin daté, classé par année", () => { const c = cheminDuJour("2026-09-24T03:00:00Z"); att(c === "sauvegardes/2026/afrijet-2026-09-24.json", c); });

let r1 = mkRes(); await handler({ headers: {} }, r1);
test("appel sans le secret du cron : refusé", () => att(r1.code === 401));

let r2 = mkRes(); await handler({ headers: { authorization: "Bearer s3cret" } }, r2);
test("sauvegarde déposée dans le dépôt", () => att(r2.code === 200 && r2.body.depose === true && depots.length === 1));
test("fichier daté et lisible", () => { const d = depots[0]; att(d.url.includes("afrijet-"));
  const j = JSON.parse(Buffer.from(d.corps.content, "base64").toString("utf8"));
  att(j.donnees.flights.length === 2 && j.journal.entrees === 2); });
test("aucun secret dans le fichier", () => { const j = Buffer.from(depots[0].corps.content, "base64").toString("utf8");
  att(!j.includes("secret") && !j.includes("JBSW")); });
test("message de dépôt explicite", () => att(/Sauvegarde du \d{4}-\d{2}-\d{2}/.test(depots[0].corps.message)));

depots = [{ marqueur: "déjà là" }];
let r3 = mkRes(); await handler({ headers: { authorization: "Bearer s3cret" } }, r3);
test("deuxième dépôt du même jour : le fichier est remplacé", () => att(r3.body.remplace === true));

delete process.env.GITHUB_TOKEN;
let r4 = mkRes(); await handler({ headers: { authorization: "Bearer s3cret" } }, r4);
test("sans jeton GitHub : sauvegarde produite, dépôt signalé impossible", () => att(r4.code === 200 && r4.body.depose === false));

// ── Ménage : seuls les 30 derniers jours sont conservés ──
{
  const f = n => ({ name: `afrijet-${n}.json`, path: `sauvegardes/2026/afrijet-${n}.json`, sha: "s" });
  const liste = [f("2026-09-24"), f("2026-09-01"), f("2026-08-20"), f("2026-07-02")];
  const vieux = aSupprimer(liste, "2026-09-24T03:00:00Z").map(x => x.jour);
  test("les fichiers de plus de 30 jours sont retirés", () => att(vieux.join() === "2026-08-20,2026-07-02", vieux.join()));
  test("les 30 derniers jours sont gardés", () => att(!vieux.includes("2026-09-01") && !vieux.includes("2026-09-24")));
  test("un nom sans date est ignoré", () => att(aSupprimer([{ name: "README.md", path: "x", sha: "s" }], "2026-09-24").length === 0));
}

// ── Copie dans Supabase : sept exemplaires glissants ──
test("clé du jour : un exemplaire par jour de la semaine", () => {
  const c = cleDuJour("2026-09-24T03:00:00Z");   // jeudi
  att(c === "backup_j4", c);
  att(cleDuJour("2026-09-27T03:00:00Z") === "backup_j0");   // dimanche
});
{
  ecrits = []; depots = [];
  process.env.GITHUB_TOKEN = "jeton";
  const r = mkRes(); await handler({ headers: { authorization: "Bearer s3cret" } }, r);
  const cles = ecrits.map(e => e.key);
  test("la copie du jour est écrite dans Supabase", () => att(cles.some(k => /backup_j\d$/.test(k)), cles.join()));
  test("la copie la plus récente est mise à jour", () => att(cles.includes("ajs135v1_lastBackupData")));
  test("elle est au format de l export, directement restaurable", () => {
    const v = JSON.parse(ecrits[0].value);
    att(v.exportDate && Array.isArray(v.flights) && v.flights.length === 2, Object.keys(v).join());
  });
  test("le journal n est pas recopié dans cette copie", () => att(!("journal" in JSON.parse(ecrits[0].value))));
  test("le résultat signale la copie Supabase", () => att(r.body.copieSupabase === true));
}
console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
