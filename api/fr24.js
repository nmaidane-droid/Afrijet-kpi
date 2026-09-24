// Position des appareils — Flightradar24, appelé depuis le serveur.
// Le jeton reste dans les variables d'environnement Vercel : il ne descend jamais dans la page.
// Variables : FR24_TOKEN
export const config = { maxDuration: 10 };
const BASE = "https://fr24api.flightradar24.com/api/live/flight-positions/full";

// Seuls les paramètres attendus sont transmis, pour éviter qu'on se serve de la fonction
// comme d'un relais vers n'importe quelle requête.
export function buildUrl(query) {
  const p = new URLSearchParams();
  if (query.registrations) p.set("registrations", String(query.registrations).slice(0, 40));
  else if (query.bounds) p.set("bounds", String(query.bounds).slice(0, 60));
  else return null;
  return `${BASE}?${p}`;
}

// Demandes acceptées : celles qui viennent du site lui-même
export function originOk(req) {
  const allow = (process.env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!allow.length) return true;
  const o = req.headers?.origin || req.headers?.referer || "";
  return allow.some(a => o.startsWith(a));
}

export default async function handler(req, res) {
  if (!originOk(req)) { res.status(403).json({ error: "origine non autorisée" }); return; }
  const token = process.env.FR24_TOKEN;
  if (!token) { res.status(500).json({ error: "FR24_TOKEN manquant" }); return; }
  const url = buildUrl(req.query || {});
  if (!url) { res.status(400).json({ error: "paramètre registrations ou bounds requis" }); return; }
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "Accept-Version": "v1", Authorization: `Bearer ${token}` } });
    const body = await r.text();
    res.status(r.status).setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=20");   // 20 s de cache : moins d'appels facturés
    res.send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
