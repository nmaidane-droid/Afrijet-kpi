// Tests des règles métier — exécutés sous Node, sans navigateur.
// Les fonctions testées sont extraites telles quelles d'index.html : un test
// qui passe ici garantit le comportement du code réellement déployé.
//   Lancement : node tests/regles.test.js index.html
const fs=require('fs'), vm=require('vm');
const src=fs.readFileSync(process.argv[2]||'index.html','utf8');
const code=src.match(/<script id="app-code"[^>]*>([\s\S]*?)<\/script>/)[1];

// Extrait une définition de premier niveau (function ou const) par son nom
function extract(name){
  let m=new RegExp('^(?:async\\s+)?function\\s+'+name+'\\s*\\(','m').exec(code)
     || new RegExp('^const\\s+'+name+'\\s*=','m').exec(code);
  if(!m) throw new Error('introuvable : '+name);
  let i=m.index, depth=0, seen=false, q=null;
  for(let k=i;k<code.length;k++){
    const ch=code[k];
    if(q){ if(ch==='\\'){k++;continue;} if(ch===q) q=null; continue; }
    if(ch==='"'||ch==="'"||ch==='`'){ q=ch; continue; }
    if(ch==='{'||ch==='['){ depth++; seen=true; }
    else if(ch==='}'||ch===']'){ depth--; if(seen&&depth===0){
      let e=k+1; if(code[e]===';') e++; return code.slice(i,e); } }
    else if(ch===';'&&depth===0&&seen===false) return code.slice(i,k+1);
  }
}
const names=['SAFETY_EVENTS','NDS_MOIS','CREW_ITEMS','crewItemsFor','joursAvant','statutEcheance','titresEchus',
  'melDateToISO','volCompromis','plageVol','chevauchements','unwrapEnv',
  'ndsRepairIds','ndsDateKey','NDS_MODES','RE_SECTIONS','DGAC_SECTIONS'];
const ctx={console}; vm.createContext(ctx);
vm.runInContext(names.map(extract).join('\n')+'\n'+names.map(n=>`this.${n}=${n};`).join(''), ctx);
const T=ctx;

let ok=0, ko=0;
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function test(nom, fn){ try{ fn(); ok++; console.log('  ✓ '+nom); }catch(e){ ko++; console.log('  ✗ '+nom+'\n      '+e.message); } }
function attendu(cond, msg){ if(!cond) throw new Error(msg); }
const iso=d=>{const x=new Date(); x.setHours(12,0,0,0); x.setDate(x.getDate()+d); return x.toISOString().slice(0,10);};

console.log('\nÉchéances équipage');
test('statut vert au-delà de 90 j',   ()=>attendu(T.statutEcheance(iso(120)).code==='ok','attendu ok'));
test('statut ambre entre 31 et 90 j', ()=>attendu(T.statutEcheance(iso(60)).code==='alerte','attendu alerte'));
test('statut orange sous 30 j',       ()=>attendu(T.statutEcheance(iso(10)).code==='proche','attendu proche'));
test('statut rouge une fois échu',    ()=>attendu(T.statutEcheance(iso(-3)).code==='echu','attendu echu'));
test('libellé échu sur une ligne',    ()=>attendu(/^Échu · \d+ j$/.test(T.statutEcheance(iso(-12)).label),'format inattendu'));
test('date absente = non renseigné',  ()=>attendu(T.statutEcheance('').code==='vide','attendu vide'));
test('titres bloquants pilote',       ()=>attendu(eq(T.crewItemsFor('CM1').filter(i=>i.bloquant).map(i=>i.k).sort(),['med','opc','qt']),'liste inattendue'));
test('titres bloquants cabine',       ()=>attendu(eq(T.crewItemsFor('CC').filter(i=>i.bloquant).map(i=>i.k).sort(),['cc','med','sep']),'liste inattendue'));
test('titre non bloquant ignoré',     ()=>attendu(T.titresEchus({role:'CM1',dates:{crm:iso(-5)}}).length===0,'CRM ne doit pas bloquer'));
test('médical échu détecté',          ()=>attendu(T.titresEchus({role:'CM1',dates:{med:iso(-1)}}).length===1,'médical échu non vu'));

console.log('\nVol compromis — contrôle à la date du vol');
const crew=[{nom:'ALAMI',prenom:'KARIM',role:'CM1',dates:{med:'2026-10-10',qt:'2027-12-31',opc:'2027-12-31'}}];
const ac=[{id:'AC1',immat:'CN-KTA',mels:[{mel:'MEL 34-41',sys:'Radar',sev:'B',exp:'15/10/26'}]}];
test('pilote valide avant son échéance', ()=>attendu(T.volCompromis({date:'2026-10-05',acId:'AC1',cm1:'ALAMI KARIM'},crew,[]).length===0,'ne devrait pas bloquer'));
test('pilote échu à la date du vol',     ()=>attendu(T.volCompromis({date:'2026-10-20',acId:'AC1',cm1:'ALAMI KARIM'},crew,[]).some(p=>p.type==='crew'),'aurait dû bloquer'));
test('MEL valide avant expiration',      ()=>attendu(T.volCompromis({date:'2026-10-14',acId:'AC1'},[],ac).length===0,'ne devrait pas bloquer'));
test('MEL expiré à la date du vol',      ()=>attendu(T.volCompromis({date:'2026-10-16',acId:'AC1'},[],ac).some(p=>p.type==='mel'),'aurait dû bloquer'));
test('format MEL JJ/MM/AA converti',     ()=>attendu(T.melDateToISO('05/07/26')==='2026-07-05','conversion fausse'));
test('format MEL JJ/MM/AAAA converti',   ()=>attendu(T.melDateToISO('05/07/2027')==='2027-07-05','conversion fausse'));

console.log('\nChevauchement d\'équipage');
const vols=[{num:'A1',date:'2026-10-05',dep:'08:00',arr:'10:00',status:'Planifie',cm1:'BENALI OMAR'}];
test('recouvrement détecté',          ()=>attendu(T.chevauchements({num:'B',date:'2026-10-05',dep:'09:00',cm1:'BENALI OMAR'},vols).length===1,'non détecté'));
test('vols successifs acceptés',      ()=>attendu(T.chevauchements({num:'B',date:'2026-10-05',dep:'10:00',arr:'11:00',cm1:'BENALI OMAR'},vols).length===0,'faux positif'));
test('autre jour accepté',            ()=>attendu(T.chevauchements({num:'B',date:'2026-10-06',dep:'09:00',cm1:'BENALI OMAR'},vols).length===0,'faux positif'));
test('autre équipage accepté',        ()=>attendu(T.chevauchements({num:'B',date:'2026-10-05',dep:'09:00',cm1:'ALAMI KARIM'},vols).length===0,'faux positif'));
test('vol annulé ignoré',             ()=>attendu(T.chevauchements({num:'B',date:'2026-10-05',dep:'09:00',cm1:'BENALI OMAR'},[{...vols[0],status:'Annule'}]).length===0,'vol annulé compté'));
test('passage de minuit géré',        ()=>{ const p=T.plageVol({dep:'23:00',arr:'01:00'}); attendu(p.a-p.d===120,'durée '+(p.a-p.d)); });
test('durée par défaut 2 h',          ()=>{ const p=T.plageVol({dep:'08:00'}); attendu(p.a-p.d===120,'durée '+(p.a-p.d)); });

console.log('\nPersistance');
test('enveloppe horodatée lue',       ()=>attendu(eq(T.unwrapEnv({__v:[1,2],__t:42}),{v:[1,2],t:42}),'lecture fausse'));
test('valeur héritée : horodatage 0', ()=>attendu(eq(T.unwrapEnv([1,2]),{v:[1,2],t:0}),'héritage mal lu'));
test('objet ordinaire non confondu',  ()=>attendu(T.unwrapEnv({nom:'x'}).t===0,'objet pris pour une enveloppe'));

console.log('\nArchives du générateur');
test('identifiants dupliqués réparés',()=>{ const a=[{id:'x',ref:'A'},{id:'x',ref:'B'}]; T.ndsRepairIds(a); attendu(a[0].id!==a[1].id,'doublon conservé'); });
test('identifiant manquant attribué', ()=>{ const a=[{ref:'A'}]; T.ndsRepairIds(a); attendu(!!a[0].id,'pas d\'id'); });
test('tri : date dans la référence',  ()=>attendu(T.ndsDateKey({ref:'RE-20260920-01'})>T.ndsDateKey({ref:'NS-OPS-20260919-01'}),'ordre faux'));
test('tri : ancien format par date',  ()=>attendu(T.ndsDateKey({ref:'NS-OPS-2026-014',date:'02 septembre 2026'})===20260902,'date mal lue'));
test('tri : référence ND reconnue',   ()=>attendu(T.ndsDateKey({ref:'ND-20261015-02'})===20261015,'ND ignoré'));
test('quatre types de documents',     ()=>attendu(T.NDS_MODES.map(m=>m.id).join()==='nds,re,dgac,as','types inattendus'));
test('notification DGAC sans analyse',()=>attendu(!T.DGAC_SECTIONS.some(s=>/analyse|risque|facteur/i.test(s)),'rubrique d\'analyse présente'));

console.log('\nRegistre des événements — conformité au Manuel SGS § 05-01');
const man=T.SAFETY_EVENTS.filter(e=>e.manuel);
test('17 événements issus du manuel',      ()=>attendu(man.length===17,'trouvé '+man.length));
test('chaque événement a cible et seuil',  ()=>attendu(man.every(e=>e.cible&&e.seuil),'cible ou seuil manquant'));
test('QRF et QRP définis',                 ()=>attendu(['qrf','qrp'].every(k=>T.SAFETY_EVENTS.find(e=>e.k===k).def),'définition manquante'));
test('clés historiques conservées',        ()=>attendu(['approche','tcas','gpws','hardLanding','safa'].every(k=>T.SAFETY_EVENTS.some(e=>e.k===k)),'clé perdue'));
test('clés uniques',                       ()=>attendu(new Set(T.SAFETY_EVENTS.map(e=>e.k)).size===T.SAFETY_EVENTS.length,'doublon'));
test('passager indiscipliné : 3 suites',   ()=>attendu(T.SAFETY_EVENTS.find(e=>e.k==='unruly').sub.length===3,'précisions manquantes'));

console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko?1:0);
