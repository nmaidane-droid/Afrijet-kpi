// Relais vers l'API Anthropic pour le générateur de notes de service.
// Le streaming évite la coupure des plans limités en durée : la réponse
// commence à arriver immédiatement au lieu d'attendre la génération complète.
export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { system, messages, max_tokens, stream } = req.body || {};

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY manquante côté serveur (variable d\'environnement Vercel).' });
      return;
    }

    const wantStream = stream === true;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: max_tokens || 1000,
        system,
        messages,
        ...(wantStream ? { stream: true } : {})
      })
    });

    // ── Mode classique : comportement d'origine, conservé comme repli ──
    if (!wantStream) {
      const data = await anthropicRes.json();
      res.status(anthropicRes.status).json(data);
      return;
    }

    // ── Mode streaming ──
    // Une erreur de l'API arrive en JSON, pas en flux : on la renvoie telle quelle.
    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      let payload;
      try { payload = JSON.parse(errText); } catch (_e) { payload = { error: errText }; }
      res.status(anthropicRes.status).json(payload);
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = anthropicRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
      if (typeof res.flush === 'function') res.flush();
    }
    res.end();

  } catch (err) {
    // Si l'en-tête est déjà parti, on ne peut plus renvoyer de JSON.
    if (res.headersSent) {
      try { res.end(); } catch (_e) {}
      return;
    }
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
