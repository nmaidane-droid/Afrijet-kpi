// Jeton d'affichage de la carte — Mapbox.
// Le jeton vit dans les variables d'environnement Vercel : il se change sans toucher au code.
// C'est un jeton public (pk.) : il finit forcément dans le navigateur, puisque la carte
// s'affiche côté client. Sa protection repose donc sur la restriction d'URL, côté Mapbox.
// Variables : MAPBOX_TOKEN
export const config = { maxDuration: 10 };

export function originOk(req) {
  const allow = (process.env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!allow.length) return true;
  const o = req.headers?.origin || req.headers?.referer || "";
  return allow.some(a => o.startsWith(a));
}

export default async function handler(req, res) {
  if (!originOk(req)) { res.status(403).json({ error: "origine non autorisée" }); return; }
  const token = process.env.MAPBOX_TOKEN;
  if (!token) { res.status(500).json({ error: "MAPBOX_TOKEN manquant" }); return; }
  res.setHeader("Cache-Control", "s-maxage=3600");   // le jeton change rarement : 1 h de cache
  res.status(200).json({ token });
}
