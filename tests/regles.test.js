// Tests des règles métier — exécutés sous Node, sans navigateur.
// Les fonctions testées sont extraites telles quelles d'index.html : un test
// qui passe ici garantit le comportement du code réellement déployé.
//   Lancement : node tests/regles.test.js index.html
const fs=require('fs'), vm=require('vm');
const src=fs.readFileSync(process.argv[2]||'index.html','utf8');
const code=src.match(/<script id="app-code"[^>]*>([\s\S]*?)<\/script>/)[1];

// Extrait une définition de premier niveau (function ou const) par son nom
function extract(name){
  const fm=new RegExp('^(?:async\\s+)?function\\s+'+name+'\\s*\\(','m').exec(code);
  const m=fm || new RegExp('^const\\s+'+name+'\\s*=','m').exec(code);
  if(!m) throw new Error('introuvable : '+name);
  // Parenthèses, crochets et accolades sont tous comptés : une fonction se termine
  // à son accolade finale, une constante au « ; » ou à la fin de ligne de niveau 0.
  let i=m.index, depth=0, q=null;
  for(let k=i;k<code.length;k++){
    const ch=code[k];
    if(q){ if(ch==='\\'){k++;continue;} if(ch===q) q=null; continue; }
    if(ch==='"'||ch==="'"||ch==='`'){ q=ch; continue; }
    if(ch==='{'||ch==='['||ch==='(') depth++;
    else if(ch==='}'||ch===']'||ch===')'){ depth--;
      if(fm&&ch==='}'&&depth===0) return code.slice(i,k+1); }
    else if(!fm&&depth===0&&(ch===';'||ch==='\n')) return code.slice(i,k+1);
  }
}
const names=['AUDIT_MAXV','auditV','auditId','auditName','auditFields','SGS_ACC_FONCTIONS','sgsAccAllowed','sgsAccCheck','sgsPlanAuto','sgsDureeMin','sgsCrtsvDac','sgsFormPers','sgsFormSeuil','sgsFormRes','sgsFormOK','sgsFormNoms','SGS_FRAT_Q','SGS_FRAT_SEUILS','sgsFratScore','sgsFratCouleur','sgsChgStatut','sgsChgAnalyse','sgsAnaNorm','sgsAnaResume','sgsFr','sgsJours','sgsFiltreEvenements','sgsNorm','sgsMatch','SGS_ROUGE','SGS_VERT','SGS_NIVEAUX','sgsRisque','sgsRisqueCourant','SGS_SPI','SAFETY_EVENTS','NDS_MOIS','CREW_ITEMS','crewItemsFor','joursAvant','statutEcheance','titresEchus',
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

console.log('\nMatrice de risques — conformité au Manuel SGS 02-02');
const couleur=c=>T.sgsRisque(Number(c[0]),c[1]).niv;
test('6 cases rouges du manuel',        ()=>attendu(['5A','5B','5C','4A','4B','3A'].every(c=>couleur(c)==='intolerable'),'case rouge mal classée'));
test('7 cases vertes du manuel',        ()=>attendu(['3E','2D','2E','1B','1C','1D','1E'].every(c=>couleur(c)==='acceptable'),'case verte mal classée'));
test('12 cases jaunes',                 ()=>{ let n=0; [1,2,3,4,5].forEach(p=>'ABCDE'.split('').forEach(g=>{ if(couleur(p+g)==='tolerable') n++; })); attendu(n===12,'trouvé '+n); });
test('1A tolérable, 5D tolérable',      ()=>attendu(couleur('1A')==='tolerable'&&couleur('5D')==='tolerable','bord de matrice faux'));
test('rouge : action immédiate',        ()=>attendu(T.SGS_NIVEAUX.intolerable.delai===0,'délai faux'));
test('jaune : actions sous 30 jours',   ()=>attendu(T.SGS_NIVEAUX.tolerable.delai===30,'délai faux'));
test('risque résiduel prioritaire',     ()=>attendu(T.sgsRisqueCourant({P:5,G:'A',P2:2,G2:'D'}).cell==='2D','résiduel ignoré'));
test('chaque indicateur a un seuil',    ()=>attendu(T.SAFETY_EVENTS.filter(e=>e.manuel).every(e=>T.SGS_SPI[e.k]),'seuil manquant'));

console.log('\nRecherche dans les registres SGS');
test('insensible aux accents et majuscules', ()=>attendu(T.sgsMatch('SURETE','Sûreté aéroportuaire')&&T.sgsMatch('dakhla','Ingestion à DAKHLA'),'accent ou casse mal géré'));
test('recherche vide : tout correspond',     ()=>attendu(T.sgsMatch('  ','x')&&!T.sgsMatch('abc','xyz'),'filtre vide faux'));

console.log('\nExport des comptes rendus : sélection');
{ const d=n=>{const x=new Date();x.setDate(x.getDate()-n);return x.toISOString().slice(0,10);};
  const ev=[{date:d(5),bird:true},{date:d(200),cgoProc:true},{date:d(400),unruly:true}];
  test('période : 3 mois / 12 mois / tout', ()=>attendu(T.sgsFiltreEvenements(ev,'3m','all').length===1&&T.sgsFiltreEvenements(ev,'12m','all').length===2&&T.sgsFiltreEvenements(ev,'all','all').length===3,'filtre de période faux'));
  test('service : Fret, Sûreté, Maintenance', ()=>attendu(T.sgsFiltreEvenements(ev,'all','CGO').length===1&&T.sgsFiltreEvenements(ev,'all','SEC').length===1&&T.sgsFiltreEvenements(ev,'all','MNT').length===1,'filtre de service faux')); }

console.log('\nRegistres SGS (lots A à C)');
test('FRAT : score = somme des points cochés', ()=>attendu(T.sgsFratScore({cdbXp:true,meteo:true})===7&&T.sgsFratScore({})===0,'score faux'));
test('FRAT : vert < 11 ≤ jaune < 21 ≤ rouge', ()=>attendu(T.sgsFratCouleur(10)==='vert'&&T.sgsFratCouleur(11)==='jaune'&&T.sgsFratCouleur(20)==='jaune'&&T.sgsFratCouleur(21)==='rouge','seuils faux'));
test('Changement : en étude → évalué → approuvé', ()=>{ const c={eis:[{P:3,G:'C'}],conclusion:''};
  const a=T.sgsChgStatut(c).k, b=T.sgsChgStatut({...c,conclusion:'ok'}).k, d=T.sgsChgStatut({...c,conclusion:'ok',approuve:'oui'}).k;
  attendu(a==='etude'&&b==='evalue'&&d==='approuve'&&T.sgsChgAnalyse({...c,conclusion:'ok'}),'statuts faux '+[a,b,d]); });
test('Analyse : ancienne fiche relue (date → dateReunion)', ()=>attendu(T.sgsAnaNorm({date:'2026-09-15'}).dateReunion==='2026-09-15','compatibilité perdue'));
test('Analyse : résumé masqué pour un confidentiel', ()=>{ const r=T.sgsAnaResume({dateReunion:'2026-09-15',causes:'secret'},{},true); attendu(/Réunion du 15\/09\/2026/.test(r)&&!/secret/.test(r),'masquage faux'); });

console.log('\nFormations SGS : résultat par participant (SGS 04-01)');
{ const f={seuil:75,pers:[{nom:'A',present:true,score:''},{nom:'B',present:true,score:80},{nom:'C',present:true,score:60},{nom:'D',present:false,score:''}]};
  test('présent sans test : formé', ()=>attendu(T.sgsFormRes(f.pers[0],f)==='present'&&T.sgsFormOK(f.pers[0],f),'faux'));
  test('test au-dessus du seuil : réussi', ()=>attendu(T.sgsFormRes(f.pers[1],f)==='reussi','faux'));
  test('test sous le seuil : à reprendre, non formé', ()=>attendu(T.sgsFormRes(f.pers[2],f)==='reprendre'&&!T.sgsFormOK(f.pers[2],f),'faux'));
  test('absent : non formé', ()=>attendu(T.sgsFormRes(f.pers[3],f)==='absent'&&!T.sgsFormOK(f.pers[3],f),'faux'));
  test('personnes formées : A et B', ()=>attendu(T.sgsFormNoms(f).join()==='A,B','obtenu '+T.sgsFormNoms(f).join()));
  test('ancienne session convertie sans perte', ()=>{ const old={participants:'Nour MAIDANE — CDB\nMarie DUPONT'}; const p=T.sgsFormPers(old);
    attendu(p.length===2&&p[0].nom==='Nour MAIDANE'&&p[0].fonction==='CDB'&&p[1].present===true&&T.sgsFormNoms(old).length===2,'conversion fausse'); }); }

console.log('\nCRTSV (SMS-17) : copie à la DAC au-delà d\'une heure');
test('durées lues : 1:30, 2h, 0:45', ()=>attendu(T.sgsDureeMin('1:30')===90&&T.sgsDureeMin('2h')===120&&T.sgsDureeMin('0:45')===45,'lecture fausse'));
test('copie DAC exigée au-delà d\'une heure seulement', ()=>attendu(T.sgsCrtsvDac({form:'SMS-17',fx:{duree:'1:10'}})&&!T.sgsCrtsvDac({form:'SMS-17',fx:{duree:'1:00'}})&&!T.sgsCrtsvDac({form:'SMS-19',fx:{duree:'3:00'}}),'règle fausse'));

console.log('\nPlanning SGS (SMS-10) : pointage automatique');
{ const A=T.sgsPlanAuto(2026,{meetings:[{mois:'2026-03'}],revues:[{kind:'cr',savedAt:'2026-06-20T10:00:00Z'},{kind:'fascicule',savedAt:'2026-05-10T10:00:00Z'}],
    audits:[{type:'base',statut:'realise',date:'2026-10-02'},{type:'base',statut:'planifie',date:'2026-11-02'}],osv:[{date:'2026-04-15'}],
    formations:[{date:'2026-02-10',pers:[{nom:'A',present:true}]},{date:'2026-07-10',pers:[{nom:'B',present:false}]}],bulletins:[{date:'2025-12-01'},{date:'2026-09-01'}]});
  test('réunion de mars et revue de juin pointées', ()=>attendu(A.reun[3]&&A.revue[6]&&!(A.revue||{})[5],'faux'));
  test('audit réalisé pointé, audit planifié ignoré', ()=>attendu(A.aBase[10]&&!A.aBase[11],'faux'));
  test('contrôle OSV compté en contrôle des escales', ()=>attendu(A.aEsc[4],'faux'));
  test('sensibilisation pointée seulement avec des présents', ()=>attendu(A.sensi[2]&&!A.sensi[7],'faux'));
  test('bulletin d\'une autre année ignoré', ()=>attendu(A.bull[9]&&!A.bull[12],'faux')); }

console.log('\nClôture d\'un danger : acceptation du risque résiduel');
{ const base={P:4,G:'B',P2:2,G2:'C'};
  test('sans résiduel : refusé', ()=>attendu(/risque résiduel/.test(T.sgsAccCheck({P:2,G:'C'})),'faux'));
  test('résiduel rouge : refusé', ()=>attendu(/intolérable/.test(T.sgsAccCheck({P:2,G:'C',P2:4,G2:'B'})),'faux'));
  test('rouge initial : Responsable SGS refusé', ()=>attendu(T.sgsAccCheck({...base,acceptation:{nom:'Y. IKLI',fonction:'Responsable SGS',date:'2026-09-20'}})!=='','faux'));
  test('rouge initial : Dirigeant Responsable accepté', ()=>attendu(T.sgsAccCheck({...base,acceptation:{nom:'N. MAIDANE',fonction:'Dirigeant Responsable',date:'2026-09-20'}})==='','faux'));
  test('résiduel vert : Responsable SGS accepté', ()=>attendu(T.sgsAccCheck({P:3,G:'C',P2:1,G2:'C',acceptation:{nom:'Y. IKLI',fonction:'Responsable SGS',date:'2026-09-20'}})==='','faux'));
  test('nom manquant : refusé', ()=>attendu(/nom, fonction et date/.test(T.sgsAccCheck({P:3,G:'C',P2:1,G2:'C',acceptation:{fonction:'Responsable SGS',date:'2026-09-20'}})),'faux')); }

console.log('\nJournal d\'audit : comparaison avant / après');
test('champ modifié : valeur avant et après', ()=>{ const c=T.auditFields({statut:'ouvert',titre:'A'},{statut:'maitrise',titre:'A'}); attendu(JSON.stringify(c)==='{"statut":["ouvert","maitrise"]}','obtenu '+JSON.stringify(c)); });
test('updatedAt ignoré', ()=>attendu(Object.keys(T.auditFields({updatedAt:'1'},{updatedAt:'2'})).length===0,'faux'));
test('valeur longue tronquée', ()=>attendu(T.auditV('x'.repeat(500)).length===T.AUDIT_MAXV+1,'faux'));
test('identifiant stable : id, puis réf., puis vol et date', ()=>attendu(T.auditId({id:'H1',ref:'DG-1'},0)==='H1'&&T.auditId({ref:'DG-2'},0)==='DG-2'&&T.auditId({num:'CN-KTA',date:'2026-09-01'},0)==='CN-KTA 2026-09-01','faux'));
test('libellé lisible : réf. d\'abord', ()=>attendu(T.auditName({id:'H1',ref:'DG-006'})==='DG-006','faux'));

console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko?1:0);
