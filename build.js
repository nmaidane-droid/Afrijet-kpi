// Construction exécutée par Vercel à chaque dépôt.
// Compile une fois pour toutes le JSX d'index.html, retire Babel (2,8 Mo) de la
// page, et écrit le résultat dans dist/. index.html du dépôt n'est pas modifié :
// il reste la source, déposable et fonctionnel tel quel.
// Si quoi que ce soit échoue, le script s'arrête en erreur : Vercel annule le
// déploiement et laisse la version précédente en ligne.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const Babel = require(process.env.BABEL_PATH || '@babel/standalone');
const SRC = path.join(__dirname, 'index.html');
const OUT = path.join(__dirname, 'dist');

const html = fs.readFileSync(SRC, 'utf8');
const re = /(<script id="app-code" type="text\/plain")>([\s\S]*?)(<\/script>)/;
const m = html.match(re);
if (!m) { console.error('Bloc app-code introuvable'); process.exit(1); }

const t0 = Date.now();
const compiled = Babel.transform(m[2], { presets: ['react'], compact: true }).code;
if (compiled.includes('</script>')) { console.error('Le code compilé contient </script>'); process.exit(1); }

let out = html.replace(re, (_, open, _code, close) => `${open} data-compiled="1">${compiled}${close}`);
// Babel n'est plus nécessaire dans le navigateur
const babelTag = /\s*<script src="[^"]*babel-standalone[^"]*"><\/script>/;
if (!babelTag.test(out)) { console.error('Balise Babel introuvable'); process.exit(1); }
out = out.replace(babelTag, '');

// Identifiant de version : date de construction + empreinte du source.
// Inscrit dans la page et publié dans version.json ; l'application compare
// les deux pour savoir qu'une nouvelle version est en ligne.
const BUILD = Date.now().toString(36) + '-' + crypto.createHash('sha1').update(html).digest('hex').slice(0, 8);
if (!/<head>/.test(out)) { console.error('Balise <head> introuvable'); process.exit(1); }
out = out.replace('<head>', `<head>\n  <meta name="app-build" content="${BUILD}">`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), out);
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ build: BUILD, at: new Date().toISOString() }));

// Fichiers statiques servis tels quels
const exclus = new Set(['index.html','build.js','package.json','package-lock.json','vercel.json',
  'node_modules','dist','api','tests','.git','.gitignore','.vercel','README.md']);
for (const f of fs.readdirSync(__dirname)) {
  if (exclus.has(f) || f.startsWith('.')) continue;
  const s = path.join(__dirname, f);
  if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(OUT, f));
}
const k = n => Math.round(n / 1024) + ' Ko';
console.log(`Version ${BUILD} · compilation : ${Date.now() - t0} ms · source ${k(html.length)} → page ${k(out.length)}`);
console.log('Copiés : ' + fs.readdirSync(OUT).join(', '));
