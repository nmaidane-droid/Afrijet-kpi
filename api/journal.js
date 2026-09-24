// Journal d'audit signé par le serveur (lot S1).
// La page envoie ce qu'elle a fait ; le serveur vérifie le jeton de session et inscrit
// l'identité qu'il a lui-même établie. Une page modifiée ne peut plus écrire sous un autre nom.
// Variables : SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET, ALLOWED_ORIGIN (facultatif)
import { lire, originOk } from "./auth.js";
export const config = { maxDuration: 10 };
const MAX = 50;                     // entrées par envoi

// Champs que la page peut renseigner : tout le reste vient du serveur
export function nettoyer(e) {
  const s = (v, n) => v == null ? null : String(v).slice(0, n);
  return {
    module: s(e.module, 60), objet: s(e.objet, 120), action: s(e.action, 120),
    changes: e.changes && typeof e.changes === "object" ? e.changes : null,
    device: s(e.device, 60), client_ts: s(e.client_ts, 40),
  };
}

export default async function handler(req, res) {
  if (!originOk(req)) { res.status(403).json({ error: "origine non autorisée" }); return; }
  const secret = process.env.SESSION_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_KEY) { res.status(500).json({ error: "configuration serveur incomplète" }); return; }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const p = lire(body.token, secret);
  if (!p || p.etape) { res.status(401).json({ error: "session expirée" }); return; }

  const entrees = Array.isArray(body.entries) ? body.entries.slice(0, MAX) : [];
  if (!entrees.length) { res.status(400).json({ error: "aucune entrée" }); return; }

  // Identité imposée par le serveur, d'après le jeton
  const identite = { user_label: [p.prenom, p.nom].filter(Boolean).join(" ").trim() || p.uid, user_id: p.uid, profil: p.profil };
  let ecrites = 0;
  try {
    for (const e of entrees) {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/audit_append`, {
        method: "POST",
        headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p: { ...nettoyer(e), ...identite } }),
      });
      if (!r.ok) { res.status(502).json({ error: "écriture refusée : " + r.status, ecrites }); return; }
      ecrites++;
    }
    res.status(200).json({ ok: true, ecrites, user_label: identite.user_label });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err), ecrites });
  }
}
