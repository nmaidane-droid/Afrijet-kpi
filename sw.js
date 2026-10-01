// Afrijet Sahara — KPI Dashboard
// © 2026 Sahara Aviation S.A.S. — Tous droits réservés.
//
// Service worker : l'application doit toujours s'ouvrir sur la dernière version publiée,
// tout en restant consultable sans réseau.
//
//   · Page de l'application (index.html, manuel.html) : RÉSEAU D'ABORD.
//     On demande Vercel à chaque ouverture ; la copie gardée ne sert qu'en cas de coupure.
//   · Manuel et PDF : gardés pour la consultation hors ligne.
//   · api/ : jamais mis en cache — les données doivent être fraîches.
//
// VERSION à incrémenter à chaque livraison : elle déclenche le ménage des anciennes copies.

const VERSION = 'afrijet-2.20';
const CACHE   = VERSION;

// Ce qui doit rester lisible sans réseau
const HORS_LIGNE = [
  '/',
  '/index.html',
  '/manuel.html',
  '/Manuel_Utilisateur_Afrijet_v2.20.pdf',
];

self.addEventListener('install', e => {
  // Prise de service immédiate : pas d'attente derrière l'ancienne version
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // Une ressource absente ne doit pas faire échouer l'installation
      Promise.allSettled(HORS_LIGNE.map(u => c.add(new Request(u, { cache: 'reload' }))))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

const estPage = url =>
  url.pathname === '/' ||
  url.pathname.endsWith('.html') ||
  url.pathname === '/version.json' ||
  url.pathname === '/aeroports.json';   // liste des aéroports : toujours la dernière version publiée

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // Supabase, cartes, polices : non gérés
  if (url.pathname.startsWith('/api/')) return;         // données : toujours au serveur

  if (estPage(url)) {
    // RÉSEAU D'ABORD : la dernière version prime, la copie ne sert qu'en secours
    e.respondWith((async () => {
      try {
        const rep = await fetch(new Request(req, { cache: 'no-store' }));
        if (rep && rep.ok) {
          const c = await caches.open(CACHE);
          c.put(req, rep.clone());
        }
        return rep;
      } catch (_e) {
        const garde = await caches.match(req) || await caches.match('/index.html');
        if (garde) return garde;
        throw _e;
      }
    })());
    return;
  }

  // Le reste — PDF, images, polices : la copie d'abord, le réseau ensuite
  e.respondWith((async () => {
    const garde = await caches.match(req);
    if (garde) return garde;
    try {
      const rep = await fetch(req);
      if (rep && rep.ok && rep.type === 'basic') {
        const c = await caches.open(CACHE);
        c.put(req, rep.clone());
      }
      return rep;
    } catch (_e) {
      return garde || Response.error();
    }
  })());
});

// L'application peut demander une prise en compte immédiate après une mise à jour
self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
