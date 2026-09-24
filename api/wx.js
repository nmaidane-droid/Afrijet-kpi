// Météo aéronautique — CheckWX, appelé depuis le serveur.
// La clé reste dans les variables d'environnement Vercel.
// Variables : CHECKWX_KEY
export const config = { maxDuration: 10 };

// Seuls un code OACI et un type de bulletin sont acceptés
export function buildUrl(query) {
  const icao = String(query.icao || "").toUpperCase();
  if (!/^[A-Z]{4}$/.test(icao)) return null;
  const type = query.type === "taf" ? "taf" : "metar";
  return `https://api.checkwx.com/${type}/${icao}/decoded`;
}

export function originOk(req) {
  const allow = (process.env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!allow.length) return true;
  const o = req.headers?.origin || req.headers?.referer || "";
  return allow.some(a => o.startsWith(a));
}

export default async function handler(req, res) {
  if (!originOk(req)) { res.status(403).json({ error: "origine non autorisée" }); return; }
  const key = process.env.CHECKWX_KEY;
  if (!key) { res.status(500).json({ error: "CHECKWX_KEY manquante" }); return; }
  const url = buildUrl(req.query || {});
  if (!url) { res.status(400).json({ error: "code OACI à 4 lettres requis" }); return; }
  try {
    const r = await fetch(url, { headers: { "X-API-Key": key, Accept: "application/json" } });
    const body = await r.text();
    res.status(r.status).setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=300");   // la météo change lentement : 5 min de cache
    res.send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
