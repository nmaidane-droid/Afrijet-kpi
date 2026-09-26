// Sauvegarde hors site — exécutée chaque nuit par Vercel Cron (vercel.json).
// Exporte toutes les données de l'application et le journal d'audit, puis dépose le fichier
// dans un dépôt GitHub privé, daté du jour. La copie sort ainsi de Supabase : une erreur,
// une suppression ou une perte d'accès au projet ne l'emporte pas.
//
// Variables d'environnement (Vercel → Settings → Environment Variables) :
//   SUPABASE_URL          https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  clé « service_role » (jamais dans la page)
//   GITHUB_TOKEN          jeton GitHub, portée « Contents : read and write » sur le dépôt de sauvegarde
//   GITHUB_REPO           dépôt privé, au format proprietaire/nom
//   GITHUB_BRANCH         branche, « main » par défaut
//   GITHUB_PATH           dossier dans le dépôt, « sauvegardes » par défaut
//   CRON_SECRET           secret ajouté par Vercel à l'appel du cron
export const config = { maxDuration: 60 };

const PFX = "ajs135v1_";
const PAGE = 1000;

// Lecture paginée d'une table Supabase avec la clé de service (jamais exposée à la page)
export async function sbFetchAll(url, key, path, select, max = 50000, filtre = "") {
  const out = [];
  for (let from = 0; from < max; from += PAGE) {
    const r = await fetch(`${url}/rest/v1/${path}?select=${select}${filtre}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}`, Prefer: "count=none" },
    });
    if (!r.ok) throw new Error(`${path} : ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// Construit la sauvegarde : données de l'application + journal d'audit
export function buildBackup({ kv, audit, now }) {
  const donnees = {};
  for (const row of kv) {
    if (!String(row.key || "").startsWith(PFX)) continue;
    if (/totp_secret|users$/.test(row.key)) continue;          // secrets d'authentification : jamais exportés
    // Documents PDF de la Réglementation et de Doc Avion : plusieurs mégaoctets chacun,
    // figés et détenus par ailleurs. Leur index est conservé, leur contenu non.
    if (/(reglementation|docavion)_(?!index)/.test(row.key)) continue;
    // L'application enregistre ses valeurs en texte JSON, parfois dans une enveloppe {__v}
    let v = row.value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* valeur brute */ } }
    if (v && typeof v === "object" && !Array.isArray(v) && "__v" in v) v = v.__v;
    donnees[String(row.key).slice(PFX.length)] = v;
  }
  const compteurs = Object.fromEntries(
    Object.entries(donnees).map(([k, v]) => [k, Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 1])
  );
  return {
    application: "Afrijet Sahara — KPI Dashboard",
    genere: now,
    format: 1,
    compteurs,
    journal: { entrees: audit.length, premiere: audit[0]?.ts || null, derniere: audit[audit.length - 1]?.ts || null, lignes: audit },
    donnees,
  };
}

// Dépôt de la sauvegarde dans un dépôt GitHub privé, daté du jour
export function cheminDuJour(now) {
  const d = String(now).slice(0, 10);
  const base = (process.env.GITHUB_PATH || "sauvegardes").replace(/^\/+|\/+$/g, "");
  return `${base}/${d.slice(0, 4)}/afrijet-${d}.json`;
}

export async function deposerGitHub({ token, repo, branche, chemin, contenu, message }) {
  const api = `https://api.github.com/repos/${repo}/contents/${chemin}`;
  const entete = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "afrijet-backup" };
  // Le fichier du jour existe peut-être déjà : GitHub exige alors son empreinte
  let sha;
  const vu = await fetch(`${api}?ref=${encodeURIComponent(branche)}`, { headers: entete });
  if (vu.status === 200) { const j = await vu.json(); sha = j.sha; }
  else if (vu.status !== 404) throw new Error("GitHub (lecture) : " + vu.status + " " + (await vu.text()).slice(0, 120));

  const r = await fetch(api, {
    method: "PUT", headers: { ...entete, "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: Buffer.from(contenu, "utf8").toString("base64"), branch: branche, ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) throw new Error("GitHub (écriture) : " + r.status + " " + (await r.text()).slice(0, 160));
  return { remplace: !!sha };
}

// Ménage : on ne garde que les 30 derniers jours. Les fichiers plus anciens sont retirés
// du dépôt ; GitHub en conserve de toute façon la trace dans son historique.
const JOURS_GARDES = 30;
export function aSupprimer(fichiers, now, jours = JOURS_GARDES) {
  const limite = new Date(new Date(String(now).slice(0, 10)).getTime() - jours * 86400000).toISOString().slice(0, 10);
  return fichiers
    .map(f => ({ ...f, jour: (String(f.name).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] }))
    .filter(f => f.jour && f.jour < limite);
}

export async function menage({ token, repo, branche, dossier, now }) {
  const entete = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "afrijet-backup" };
  const annees = new Set([String(now).slice(0, 4), String(Number(String(now).slice(0, 4)) - 1)]);
  let retires = 0;
  for (const an of annees) {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${dossier}/${an}?ref=${encodeURIComponent(branche)}`, { headers: entete });
    if (r.status === 404) continue;
    if (!r.ok) continue;
    const liste = await r.json();
    for (const f of aSupprimer(Array.isArray(liste) ? liste : [], now)) {
      const d = await fetch(`https://api.github.com/repos/${repo}/contents/${f.path}`, {
        method: "DELETE", headers: { ...entete, "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Ménage : sauvegarde du ${f.jour} retirée`, sha: f.sha, branch: branche }),
      });
      if (d.ok) retires++;
    }
  }
  return retires;
}

// Copie dans Supabase : sept exemplaires glissants, un par jour de la semaine.
// Ils sont écrits au format de l export de l application, pour que le bouton Restore
// les recharge directement, sans conversion.
export function cleDuJour(now) { return "backup_j" + new Date(String(now)).getUTCDay(); }

async function kvEcrire(key, valeur) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key: PFX + key, value: JSON.stringify(valeur) }),
  });
  // L'échec doit être lisible dans la réponse du cron, pas silencieux
  if (!r.ok) throw new Error(`Supabase (${key}) : ${r.status} ${(await r.text()).slice(0, 120)}`);
  return true;
}

export async function copieSupabase(backup, now, index) {
  const donnees = { exportDate: now, source: "sauvegarde automatique", ...backup.donnees };
  const cle = cleDuJour(now);
  const a = await kvEcrire(cle, donnees);
  const b = await kvEcrire("lastBackupData", donnees);   // la plus récente, pour le bouton Restore
  // Index léger : l ecran Restore lit ce seul enregistrement pour afficher la liste,
  // sans telecharger le contenu des sauvegardes.
  const ligne = { cle: PFX + cle, exportDate: now, source: "sauvegarde automatique", compteurs: backup.compteurs };
  const autres = (Array.isArray(index) ? index : []).filter(x => x && x.cle !== ligne.cle);
  const maj = [ligne, ...autres].sort((x, y) => String(y.exportDate).localeCompare(String(x.exportDate))).slice(0, 7);
  const i = await kvEcrire("backup_index", maj);
  return a && b && i;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers?.authorization || "";
  if (secret && auth !== `Bearer ${secret}`) { res.status(401).json({ error: "non autorisé" }); return; }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { res.status(500).json({ error: "SUPABASE_URL ou SUPABASE_SERVICE_KEY manquante" }); return; }

  try {
    const now = new Date().toISOString();
    const [kv, audit] = await Promise.all([
      // Les PDF de Réglementation et de Doc Avion (plusieurs Mo chacun) sont écartés
      // DÈS LA REQUÊTE : les télécharger pour les jeter ensuite dépassait le temps imparti.
      sbFetchAll(url, key, "kv_store", "key,value",
        50000, "&key=not.like.*reglementation_regl*&key=not.like.*docavion_docavion*"),
      sbFetchAll(url, key, "audit_log", "*").catch(() => []),   // journal absent : sauvegarde quand même
    ]);
    const backup = buildBackup({ kv, audit, now });
    const json = JSON.stringify(backup);
    const filename = `afrijet-sauvegarde-${now.slice(0, 10)}.json`;

    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
      // Sans dépôt GitHub, la copie Supabase est écrite quand même
      let copie = false, erreurCopie = null;
      try { copie = await copieSupabase(backup, now, []); } catch (e) { erreurCopie = String(e.message || e); }
      res.status(200).json({ ok: true, depose: false, copieSupabase: copie, erreurCopie, motif: "GITHUB_TOKEN ou GITHUB_REPO manquant", taille: json.length, compteurs: backup.compteurs });
      return;
    }
    const nb = Object.values(backup.compteurs).reduce((s, n) => s + (Number(n) || 0), 0);
    const chemin = cheminDuJour(now);
    const { remplace } = await deposerGitHub({
      token: process.env.GITHUB_TOKEN,
      repo: process.env.GITHUB_REPO,
      branche: process.env.GITHUB_BRANCH || "main",
      chemin,
      contenu: json,
      message: `Sauvegarde du ${now.slice(0, 10)} — ${nb} enregistrements, ${audit.length} entrées de journal`,
    });
    let copieSb = false, erreurCopie = null;
    try {
      const idx = kv.find(r => String(r.key) === PFX + "backup_index");
      let index = idx ? idx.value : [];
      if (typeof index === "string") { try { index = JSON.parse(index); } catch { index = []; } }
      copieSb = await copieSupabase(backup, now, index);
    } catch (e) { erreurCopie = String(e.message || e); }   // n'empêche pas le dépôt GitHub, mais se voit
    let retires = 0;
    try {
      retires = await menage({
        token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPO,
        branche: process.env.GITHUB_BRANCH || "main",
        dossier: (process.env.GITHUB_PATH || "sauvegardes").replace(/^\/+|\/+$/g, ""), now,
      });
    } catch (e) { /* le ménage ne doit jamais empêcher la sauvegarde */ }
    res.status(200).json({ ok: true, depose: true, chemin, remplace, retires, copieSupabase: copieSb, erreurCopie, index: copieSb ? "écrit" : "non écrit", taille: json.length, entrees_journal: audit.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
