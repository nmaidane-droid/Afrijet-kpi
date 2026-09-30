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
const names=['AUDIT_MAXV','AUDIT_CALCULES','memeValeur','itemId','fusionner','auditV','auditId','auditName','auditFields','SGS_ACC_FONCTIONS','sgsAccAllowed','sgsAccCheck','sgsPlanAuto','sgsDureeMin','sgsCrtsvDac','sgsFormPers','sgsFormSeuil','sgsFormRes','sgsFormOK','sgsFormNoms','SGS_FRAT_Q','SGS_FRAT_SEUILS','sgsFratScore','sgsFratCouleur','sgsChgStatut','sgsChgAnalyse','sgsAnaNorm','sgsAnaResume','sgsFr','sgsJours','sgsFiltreEvenements','sgsNorm','sgsMatch','SGS_ROUGE','SGS_VERT','SGS_NIVEAUX','sgsRisque','sgsRisqueCourant','SGS_SPI','SAFETY_EVENTS','NDS_MOIS','CREW_ITEMS','crewItemsFor','joursAvant','statutEcheance','titresEchus',
  'melDateToISO','volCompromis','plageVol','chevauchements','unwrapEnv',
  'ndsRepairIds','ndsDateKey','NDS_MODES','RE_SECTIONS','DGAC_SECTIONS',
  'COM_ETAPES','COM_RELANCES','COM_DEFAUTS','comParamsValides','comMigrFiche','comNorm','comTel9','comDoublon','COM_SECTEUR_TYPE',
  'comDevenirClient','comUnion','comFusionImport','comDueInfo','comADesRelances','comRelance','comEtape','comNote','comProchainNumero',
  'COM_CHOIX','COM_DV','comNrm','comAptListe','comAptBy','comAptGuess','comAptSearch','comRhumbNM','comLegMin','comRouteNM','comHorsRange','comBuildLegs',
  'comFuelAirports','comDvLegs','comLineAmt','comTotaux','comRecalcul','comDevisEnvoye','comContexteIA','comIntroSecours',
  'COM_MOTIFS','comEstActif','comArchiver','comReactiver','comLegsDevis','comHeurePlus','comValiderSaisie','comCreerDemande','comEtatDemande',
  'comVolsAPlanifier','comGroupesAPlanifier','comTypesVol','comControleType','comEquipageSuivant','comFinDossier','comControleDossier','COM_MOIS','comPeriode','comTableau','restoreResume','sgsReceptionAuto','sgsMoisFr','comPrefillVol','comOptionsClients','comTexteHoraires','comClientDuDevis','comFicheClient'];
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
test('valeurs recalculées écartées du journal', ()=>attendu(Object.keys(T.auditFields({pax:5,consoH:800,fuelPct:70,load:30},{pax:9,consoH:900,fuelPct:60,load:50})).join()==='pax','obtenu '+Object.keys(T.auditFields({pax:5,consoH:800},{pax:9,consoH:900})).join()));
test('updatedAt ignoré', ()=>attendu(Object.keys(T.auditFields({updatedAt:'1'},{updatedAt:'2'})).length===0,'faux'));
test('valeur longue tronquée', ()=>attendu(T.auditV('x'.repeat(500)).length===T.AUDIT_MAXV+1,'faux'));
test('identifiant stable : id, puis réf., puis vol et date', ()=>attendu(T.auditId({id:'H1',ref:'DG-1'},0)==='H1'&&T.auditId({ref:'DG-2'},0)==='DG-2'&&T.auditId({num:'CN-KTA',date:'2026-09-01'},0)==='CN-KTA 2026-09-01','faux'));
test('libellé lisible : réf. d\'abord', ()=>attendu(T.auditName({id:'H1',ref:'DG-006'})==='DG-006','faux'));

// ── Fusion élément par élément (travail simultané de plusieurs personnes) ──
console.log('\nEnregistrements simultanés');
{
  const base=[{id:"A",status:"En vol"},{id:"B",status:"Planifie"}];
  const local=[{id:"A",status:"Termine"},{id:"B",status:"Planifie"}];      // le pilote clôture A
  const distant=[{id:"A",status:"En vol"},{id:"B",status:"En vol"}];       // les Ops passent B en vol
  const f=T.fusionner(base,local,distant,"flights");
  test("clôture du pilote conservée", ()=>attendu(f.find(x=>x.id==="A").status==="Termine","A écrasé"));
  test("modification des Ops conservée", ()=>attendu(f.find(x=>x.id==="B").status==="En vol","B écrasé"));
}
{
  const base=[{id:"A",pax:5}];
  const local=[{id:"A",pax:5},{id:"C",pax:9}];        // ajout ici
  const distant=[{id:"A",pax:5},{id:"D",pax:3}];      // ajout ailleurs
  const f=T.fusionner(base,local,distant,"flights");
  test("les deux ajouts coexistent", ()=>attendu(f.length===3&&f.some(x=>x.id==="C")&&f.some(x=>x.id==="D"),"perdu"));
}
{
  const base=[{id:"A"},{id:"B"}];
  const local=[{id:"A"}];                             // suppression ici
  const distant=[{id:"A"},{id:"B"}];
  const f=T.fusionner(base,local,distant,"flights");
  test("suppression locale appliquée", ()=>attendu(f.length===1&&f[0].id==="A","suppression perdue"));
}
{
  const base={a:1,b:2}, local={a:9,b:2}, distant={a:1,b:7};
  const f=T.fusionner(base,local,distant,"kpis");
  test("dictionnaire : chaque clé garde sa dernière valeur", ()=>attendu(f.a===9&&f.b===7,"écrasé"));
}
test("identifiant stable d'un vol", ()=>attendu(T.itemId({num:"CN-KTA",date:"2026-09-24",dep:"09:00",from:"CMN",to:"FEZ"},0)===T.itemId({num:"CN-KTA",date:"2026-09-24",dep:"09:00",from:"CMN",to:"FEZ",pax:9},0),"instable"));


console.log('\nModule Commercial — import Fiches Airshow');
{
  // Fiches au format réel de la sauvegarde Airshow 2.4 (schémas d'étapes v2 et v3 mélangés)
  const NOW='2026-10-11T08:00:00.000Z', QUI='Anas BENNANI';
  const fiche=(id,o)=>Object.assign({id,numero:1,nom:'N '+id,fonction:'',organisation:'',tel:'',email:'',suites:[],potentiel:'chaud',clientId:'cid-'+id,
    guide:'Hicham QADRI',createdAt:'2026-09-29T10:00:00.000Z',updatedAt:'2026-09-29T11:00:00.000Z',version:1,etape:0,etapesV:3,
    relances:{brochure:null,devis:null,j2:null,j7:null},notes:[],historique:[{date:'2026-09-29T10:00:00.000Z',auteur:'Hicham QADRI',texte:'Fiche créée'}]},o||{});
  const dv=(id,o)=>Object.assign({id,numero:'DEV-2026-0001',version:1,ficheId:'f1',date:'2026-09-29T12:00:00.000Z',tarif:70000,totalHT:375668,tva:75134,ttc:450802,lignes:[],envoye:null},o||{});
  const sauv=(fiches,devis)=>({app:'fiches-airshow',format:1,date:'2026-09-30T10:39:25.425Z',fiches,devis,seq:{fiches:fiches.length,devis:devis.length}});
  const vide={prospects:[],devis:[],clients:[]};

  test("fichier étranger refusé", ()=>attendu(T.comFusionImport(vide,{app:'autre',format:1,fiches:[],devis:[]},NOW,QUI).erreur,"accepté"));
  test("format inconnu refusé", ()=>attendu(T.comFusionImport(vide,{app:'fiches-airshow',format:2,fiches:[],devis:[]},NOW,QUI).erreur,"accepté"));
  test("ancienne fiche v2 « Devis envoyé » (1) → étape 2 comme Airshow", ()=>{ const f=T.comMigrFiche({etape:1,etapesV:2,relances:{devis:{},j2:null,j7:null}}); attendu(f.etape===2&&f.etapesV===3&&f.relances.brochure===null,JSON.stringify(f)); });
  test("très ancienne fiche v1 « Contrat » (4) → étape 4", ()=>{ const f=T.comMigrFiche({etape:4}); attendu(f.etape===4&&f.etapesV===3,JSON.stringify(f)); });
  test("fiche v3 inchangée", ()=>attendu(T.comMigrFiche({etape:2,etapesV:3,relances:{brochure:null}}).etape===2,"modifiée"));

  const F=sauv([fiche('f1',{etape:1,etapesV:2,organisation:'AGAFAY JET',relances:{devis:{date:'2026-09-29T11:59:52.148Z',auteur:'H'},j2:null,j7:null}}),
               fiche('f2',{organisation:'OCP',tel:'06 61 00 00 01'}),fiche('f3',{etape:4,organisation:'Mines du Sud'})],
             [dv('d1'),dv('d2',{numero:'DEV-2026-0003',date:'2026-09-29T12:20:00.000Z',envoye:null})]);
  const clients=[{id:'C1',nom:'OCP',tel:'',email:''}];
  const r=T.comFusionImport({prospects:[],devis:[],clients},F,NOW,QUI), R=r.rapport;
  test("import : 3 fiches et 2 devis", ()=>attendu(R.fichesNouvelles===3&&R.devisNouveaux===2&&r.devis.length===2,JSON.stringify(R)));
  test("import : le clientId d'Airshow (identifiant du téléphone) est renommé", ()=>attendu(r.prospects.every(p=>!('clientId' in p)&&p.airshowCid),"clientId conservé"));
  test("import : étape Airshow convertie (Devis envoyé)", ()=>attendu(r.prospects.find(p=>p.id==='f1').etape===2,"étape"));
  test("import : doublon avec un client existant signalé", ()=>attendu(R.doublons.length===1&&R.doublons[0].client==='OCP',JSON.stringify(R.doublons)));
  test("import : « Contrat » dans Airshow → devient client", ()=>{ const p=r.prospects.find(x=>x.id==='f3'); attendu(R.contrats===1&&p.statut==='client'&&r.clients.some(c=>c.id===p.clientRef&&c.nom==='Mines du Sud'),"non converti"); });
  test("import : historique « Fiche importée » ajouté", ()=>attendu(r.prospects[0].historique.some(h=>/importée/.test(h.texte)),"absent"));
  test("import : dernier numéro et dernier tarif", ()=>attendu(R.dernierNumero==='DEV-2026-0003'&&R.dernierTarif.tarif===70000,JSON.stringify(R)));
  const r2=T.comFusionImport({prospects:r.prospects,devis:r.devis,clients:r.clients},F,NOW,QUI);
  test("réimport du même fichier : rien ne change", ()=>attendu(r2.rapport.fichesNouvelles===0&&r2.rapport.fichesMaj===0&&r2.rapport.devisNouveaux===0&&r2.prospects.length===3&&r2.clients.length===r.clients.length,JSON.stringify(r2.rapport)));
  // La fiche a évolué dans Airshow après l'import, et le KPI y a ajouté une note
  const loc=r.prospects.map(p=>p.id==='f2'?{...p,notes:[{date:'2026-10-10T09:00:00.000Z',auteur:QUI,texte:'note KPI'}],statut:'prospect'}:p);
  const F3=sauv([fiche('f2',{organisation:'OCP',updatedAt:'2026-10-12T09:00:00.000Z',potentiel:'froid',notes:[{date:'2026-10-12T08:00:00.000Z',auteur:'Marc',texte:'note Airshow'}]})],[dv('d2',{numero:'DEV-2026-0003',envoye:{date:'2026-10-12T09:00:00.000Z',auteur:'Marc'}})]);
  const r3=T.comFusionImport({prospects:loc,devis:r.devis,clients:r.clients},F3,NOW,QUI), p3=r3.prospects.find(p=>p.id==='f2');
  test("fiche plus récente dans Airshow : mise à jour, notes des deux côtés gardées", ()=>attendu(r3.rapport.fichesMaj===1&&p3.potentiel==='froid'&&p3.notes.length===2&&p3.notes[0].texte==='note Airshow',JSON.stringify(p3.notes)));
  test("devis envoyé depuis dans Airshow : envoi repris", ()=>attendu(r3.rapport.devisMaj===1&&r3.devis.find(d=>d.id==='d2').envoye.auteur==='Marc',"envoi perdu"));
  const cli=r.prospects.find(x=>x.id==='f3');
  const r4=T.comFusionImport({prospects:r.prospects,devis:r.devis,clients:r.clients},sauv([{...fiche('f3',{etape:1,organisation:'Mines du Sud'}),updatedAt:'2026-10-20T00:00:00.000Z'}],[]),NOW,QUI);
  test("un client ne redevient jamais prospect à l'import", ()=>attendu(r4.prospects.find(x=>x.id==='f3').statut==='client'&&r4.prospects.find(x=>x.id==='f3').clientRef===cli.clientRef,"redevenu prospect"));
}

console.log('\nModule Commercial — prospect devenu client');
{
  const NOW='2026-10-14T16:05:00.000Z';
  const p={id:'p1',nom:'Karim ALAOUI',fonction:'Directeur général',organisation:'Mines du Sud',tel:'+212 6 61 24 18 90',email:'k@ms.ma',secteur:'mines',historique:[]};
  const a=T.comDevenirClient(p,[{id:'C9',nom:'MASEN'}],NOW,'Anas','devis DEV-2026-0024 v1 accepté');
  test("nouveau client créé avec les coordonnées du prospect", ()=>attendu(!a.existant&&a.clients.length===2&&a.client.nom==='Mines du Sud'&&a.client.type==='Corporate'&&a.client.tel===p.tel&&a.client.prospectId==='p1',JSON.stringify(a.client)));
  test("le prospect passe au statut client, relié à sa fiche client", ()=>attendu(a.prospect.statut==='client'&&a.prospect.clientRef===a.client.id&&/accepté/.test(a.prospect.historique.pop().texte),"statut"));
  const b=T.comDevenirClient(p,[{id:'C1',nom:'MINES DU SUD'}],NOW,'Anas','x');
  test("doublon : le client existant est réutilisé, pas de seconde fiche", ()=>attendu(b.existant&&b.clients.length===1&&b.prospect.clientRef==='C1',"dupliqué"));
  const c=T.comDevenirClient({...p,organisation:''},[{id:'C2',nom:'Autre',tel:'0661241890'}],NOW,'Anas','x');
  test("doublon reconnu au téléphone (9 derniers chiffres)", ()=>attendu(c.existant&&c.prospect.clientRef==='C2',"non reconnu"));
}

console.log('\nModule Commercial — relances et étapes (règles Airshow)');
{
  const base={id:'r1',statut:'prospect',etape:0,suites:['devis'],createdAt:'2026-10-08T10:00:00.000Z',relances:{brochure:null,devis:null,j2:null,j7:null},historique:[]};
  const J=(s)=>new Date(s+'T12:00:00');
  test("avant tout envoi : action attendue 2 jours après la visite", ()=>{ const i=T.comDueInfo(base,J('2026-10-10')); attendu(i.pre&&i.k==='devis'&&i.diff===0,JSON.stringify(i)); });
  test("à J+1 : pas encore dû", ()=>attendu(!T.comADesRelances(base,J('2026-10-09')),"dû trop tôt"));
  const env=T.comRelance(base,'devis','2026-10-11T09:41:00.000Z','Anas');
  test("devis envoyé : étape « Devis envoyé »", ()=>attendu(env.etape===2&&env.relances.devis.auteur==='Anas',"étape"));
  test("relance J+2 due 2 jours après l'envoi", ()=>{ const i=T.comDueInfo(env,J('2026-10-13')); attendu(i.k==='J+2'&&i.diff===0,JSON.stringify(i)); });
  const j2=T.comRelance(env,'j2','2026-10-13T09:00:00.000Z','Anas');
  test("après J+2 : relance J+7 due 7 jours après l'envoi", ()=>{ const i=T.comDueInfo(j2,J('2026-10-18')); attendu(i.k==='J+7'&&i.diff===0,JSON.stringify(i)); });
  test("J+7 faite : suivi terminé", ()=>attendu(T.comDueInfo(T.comRelance(j2,'j7','2026-10-18T09:00:00.000Z','Anas'),J('2026-10-30'))===null,"encore dû"));
  test("brochure envoyée : étape « Brochure »", ()=>attendu(T.comRelance(base,'brochure','2026-10-09T09:00:00.000Z','A').etape===1,"étape"));
  test("relance cochée deux fois : annulée", ()=>{ const g=T.comRelance(env,'devis','2026-10-12T09:00:00.000Z','A'); attendu(g.relances.devis===null&&/annulé/.test(g.historique.pop().texte),"non annulée"); });
  test("un client n'a plus de relance", ()=>attendu(T.comDueInfo({...env,statut:'client'},J('2026-10-30'))===null,"relance client"));
  test("changement d'étape journalisé", ()=>{ const g=T.comEtape(base,3,'2026-10-12T09:00:00.000Z','A'); attendu(g.etape===3&&/Rendez-vous/.test(g.historique.pop().texte),"étape"); });
  test("étape « Contrat » impossible pour un prospect", ()=>attendu(T.comEtape(base,4,'x','A')===base,"contrat accepté"));
  test("note ajoutée en tête, note vide ignorée", ()=>{ const g=T.comNote({...base,notes:[{texte:'ancienne'}]},' nouvelle ','x','A'); attendu(g.notes[0].texte==='nouvelle'&&T.comNote(base,'  ','x','A')===base,"note"); });
}

console.log('\nModule Commercial — paramètres et numérotation');
{
  test("valeurs par défaut identiques à Airshow", ()=>attendu(T.COM_DEFAUTS.tarifVol===75000&&T.COM_DEFAUTS.tarifImmo===75000&&T.COM_DEFAUTS.immoMin===2&&T.COM_DEFAUTS.fuelRef===10&&T.COM_DEFAUTS.conso===1100,"défauts"));
  test("paramètres valides acceptés (espaces et virgule)", ()=>{ const v=T.comParamsValides({tarifVol:'75 000',tarifImmo:70000,immoMin:2,fuelRef:'10,5',conso:1100,signataire:' Hicham QADRI '}); attendu(v&&v.tarifVol===75000&&v.fuelRef===10.5&&v.signataire==='Hicham QADRI',JSON.stringify(v)); });
  test("tarif hors limites refusé (bornes d'Airshow)", ()=>attendu(T.comParamsValides({tarifVol:500,tarifImmo:0,immoMin:2,fuelRef:10,conso:1100,signataire:'HQ'})===null,"accepté"));
  test("référence carburant nulle refusée", ()=>attendu(T.comParamsValides({tarifVol:75000,tarifImmo:0,immoMin:2,fuelRef:0,conso:1100,signataire:'HQ'})===null,"accepté"));
  test("signataire vide refusé", ()=>attendu(T.comParamsValides({tarifVol:75000,tarifImmo:0,immoMin:2,fuelRef:10,conso:1100,signataire:' '})===null,"accepté"));
  test("numéro suivant après l'import", ()=>attendu(T.comProchainNumero([{numero:'DEV-2026-0003'},{numero:'DEV-2026-0017'},{numero:'x'}],2026)==='DEV-2026-0018',"numéro"));
  test("premier numéro sans devis", ()=>attendu(T.comProchainNumero([],2026)==='DEV-2026-0001',"numéro"));
}


console.log('\nModule Commercial — calcul des devis (identique à Fiches Airshow)');
{
  // Les 3 devis réels de la sauvegarde Airshow du 30/09/2026 (champs de calcul seulement)
  const REELS=[{"numero": "DEV-2026-0001", "version": 1, "tarif": 70000, "immobilisation": 1, "base": {"icao": "GMME", "ville": "Rabat"}, "retour": {"icao": "GMME", "ville": "Rabat"}, "totalHT": 375668, "tva": 75134, "ttc": 450802, "national": true, "lignes": [{"type": "mep", "libelle": "Mise en place", "jours": 0, "de": {"icao": "GMME", "ville": "Rabat"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}, {"type": "vol", "libelle": "Vol aller", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "GMMH", "ville": "Dakhla"}, "national": true, "passagers": true, "distance": 727, "minutes": 136, "montant": 158667}, {"type": "vol", "libelle": "Vol retour", "jours": 0, "de": {"icao": "GMMH", "ville": "Dakhla"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": true, "passagers": true, "distance": 727, "minutes": 136, "montant": 158667}, {"type": "mep", "libelle": "Retour de l'avion", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "GMME", "ville": "Rabat"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}]}, {"numero": "DEV-2026-0002", "version": 1, "tarif": 70000, "immobilisation": 1, "base": {"icao": "GMME", "ville": "Rabat"}, "retour": {"icao": "GMME", "ville": "Rabat"}, "totalHT": 207668, "tva": 41534, "ttc": 249202, "national": true, "lignes": [{"type": "mep", "libelle": "Mise en place", "jours": 0, "de": {"icao": "GMME", "ville": "Rabat"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}, {"type": "vol", "libelle": "Vol aller", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "GMFO", "ville": "Oujda"}, "national": true, "passagers": true, "distance": 294, "minutes": 64, "montant": 74667}, {"type": "vol", "libelle": "Vol retour", "jours": 0, "de": {"icao": "GMFO", "ville": "Oujda"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": true, "passagers": true, "distance": 294, "minutes": 64, "montant": 74667}, {"type": "mep", "libelle": "Retour de l'avion", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "GMME", "ville": "Rabat"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}]}, {"numero": "DEV-2026-0003", "version": 1, "tarif": 70000, "immobilisation": 2, "base": {"icao": "GMME", "ville": "Rabat"}, "retour": {"icao": "GMME", "ville": "Rabat"}, "totalHT": 1236668, "tva": 0, "ttc": 1236668, "national": false, "lignes": [{"type": "mep", "libelle": "Mise en place", "jours": 0, "de": {"icao": "GMME", "ville": "Rabat"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}, {"type": "vol", "libelle": "Vol aller", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "FCBB", "ville": "Brazzaville"}, "national": false, "passagers": true, "distance": 2606, "minutes": 445, "montant": 519167}, {"type": "vol", "libelle": "Vol retour", "jours": 0, "de": {"icao": "FCBB", "ville": "Brazzaville"}, "vers": {"icao": "GMMN", "ville": "Casablanca"}, "national": false, "passagers": true, "distance": 2606, "minutes": 445, "montant": 519167}, {"type": "mep", "libelle": "Retour de l'avion", "jours": 0, "de": {"icao": "GMMN", "ville": "Casablanca"}, "vers": {"icao": "GMME", "ville": "Rabat"}, "national": true, "passagers": false, "distance": 58, "minutes": 25, "montant": 29167}, {"type": "immo", "libelle": "Immobilisation de l'appareil", "jours": 1, "de": {"icao": "", "ville": ""}, "vers": {"icao": "", "ville": ""}, "national": false, "passagers": false, "distance": 0, "minutes": 120, "montant": 140000}]}];
  const apts=T.comAptListe(JSON.parse(fs.readFileSync(require('path').join(__dirname,'..','aeroports.json'),'utf8')));
  test("438 aéroports chargés", ()=>attendu(apts.length===438&&T.comAptBy(apts,'GMAZ').ville==='Zagora',"liste"));
  REELS.forEach(d=>{
    const V={tarifVol:d.tarif,tarifImmo:d.tarif,immoMin:2,fuelRef:10,conso:1100};
    const p=d.lignes.filter(l=>l.passagers), by=i=>T.comAptBy(apts,i);
    const e={dep:by(p[0].de.icao),arr:by(p[0].vers.icao),ar:p.length>1,immo:d.immobilisation,bas:by(d.base.icao),ret:by(d.retour.icao),ovr:{},fuelForce:{}};
    const L=T.comDvLegs(e,V,null), Tt=T.comTotaux(L,V);
    test(d.numero+" : vols reconstruits à l'identique (distances et minutes)", ()=>attendu(JSON.stringify(L.map(l=>[l.type,l.distance,l.minutes]))===JSON.stringify(d.lignes.map(l=>[l.type,l.distance,l.minutes])),JSON.stringify(L.map(l=>[l.type,l.distance,l.minutes]))));
    test(d.numero+" : total HT, TVA et TTC identiques ("+d.totalHT+" MAD)", ()=>attendu(Tt.ht===d.totalHT&&Tt.tva===d.tva&&Tt.ttc===d.ttc,JSON.stringify(Tt)));
    test(d.numero+" : contrôle du devis enregistré, écart 0", ()=>attendu(T.comRecalcul(d).ecart===0,String(T.comRecalcul(d).ecart)));
  });
  const by=i=>T.comAptBy(apts,i), V={tarifVol:75000,tarifImmo:75000,immoMin:2,fuelRef:10,conso:1100};
  test("Casablanca → Dakhla : 727 NM, 136 min (distance non arrondie, comme Airshow)", ()=>{ const L=T.comBuildLegs(by('GMMN'),by('GMMH'),false,by('GMMN'),by('GMMH')); attendu(L.length===1&&L[0].distance===727&&L[0].minutes===136,JSON.stringify(L)); });
  test("départ depuis la base : pas de mise en place", ()=>attendu(!T.comBuildLegs(by('GMME'),by('GMMX'),true,by('GMME'),by('GMME')).some(l=>l.type==='mep'),"mise en place en trop"));
  test("aller-retour hors base : mise en place et retour de l'avion", ()=>attendu(T.comBuildLegs(by('GMMN'),by('GQNO'),true,by('GMME'),by('GMME')).map(l=>l.libelle).join('|')==="Mise en place|Vol aller|Vol retour|Retour de l'avion","ordre"));
  test("même aéroport au départ et à l'arrivée : aucun vol", ()=>attendu(T.comBuildLegs(by('GMMN'),by('GMMN'),true,by('GMME'),by('GMME')).length===0,"vol créé"));
  test("vol national : TVA 20 %", ()=>{ const L=T.comDvLegs({dep:by('GMMN'),arr:by('GMMH'),ar:false,immo:1,bas:by('GMMN'),ret:by('GMMH'),ovr:{},fuelForce:{}},V,null); attendu(T.comTotaux(L,V).tva===Math.round(T.comTotaux(L,V).ht*0.2),"TVA"); });
  test("vol international : TVA 0", ()=>{ const L=T.comDvLegs({dep:by('GMMN'),arr:by('GQNO'),ar:true,immo:2,bas:by('GMME'),ret:by('GMME'),ovr:{},fuelForce:{}},V,null); attendu(T.comTotaux(L,V).tva===0,"TVA"); });
  test("2 jours sur place : 1 jour inclus, 1 jour facturé 2 h", ()=>{ const L=T.comDvLegs({dep:by('GMMN'),arr:by('GQNO'),ar:true,immo:2,bas:by('GMME'),ret:by('GMME'),ovr:{},fuelForce:{}},V,null), im=L.find(l=>l.type==='immo'); attendu(im&&im.jours===1&&T.comLineAmt(im,V)===150000,JSON.stringify(im)); });
  test("aller simple : jamais d'immobilisation", ()=>attendu(!T.comDvLegs({dep:by('GMMN'),arr:by('GQNO'),ar:false,immo:5,bas:by('GMME'),ret:by('GMME'),ovr:{},fuelForce:{}},V,null).some(l=>l.type==='immo'),"immobilisation"));
  test("rayon d'action : Casablanca → Brazzaville refusé", ()=>attendu(T.comBuildLegs(by('GMMN'),by('FCBB'),false,by('GMMN'),by('FCBB')).some(T.comHorsRange),"accepté"));
  test("rayon d'action : Casablanca → Nouakchott accepté", ()=>attendu(!T.comBuildLegs(by('GMMN'),by('GQNO'),false,by('GMMN'),by('GQNO')).some(T.comHorsRange),"refusé"));
  test("durée modifiée à la main : prise en compte", ()=>{ const L=T.comDvLegs({dep:by('GMMN'),arr:by('GMMH'),ar:false,immo:1,bas:by('GMMN'),ret:by('GMMH'),ovr:{0:150},fuelForce:{}},V,null); attendu(L[0].minutes===150&&T.comLineAmt(L[0],V)===187500,"durée"); });
  const E={dep:by('GMMN'),arr:by('GQNO'),ar:true,immo:2,bas:by('GMME'),ret:by('GMME'),ovr:{}};
  test("carburant : exemple de la maquette (11,20 MAD/L → 9 108 MAD)", ()=>{ const L=T.comDvLegs({...E,fuelForce:{}},V,{madL:11.2}), f=L.find(l=>l.type==='fuel'); attendu(f&&f.montant===9108&&T.comTotaux(L,V).ht===676608,JSON.stringify(f&&f.montant)); });
  test("carburant sous la référence : remise", ()=>{ const f=T.comDvLegs({...E,fuelForce:{}},V,{madL:9}).find(l=>l.type==='fuel'); attendu(f&&f.montant<0,"pas de remise"); });
  test("carburant : prix forcé sur un seul aéroport", ()=>{ const A=T.comFuelAirports(T.comDvLegs({...E,fuelForce:{GQNO:12}},V,{madL:11.2}),{madL:11.2},{GQNO:12},V); attendu(A.find(a=>a.icao==='GQNO').force&&A.find(a=>a.icao==='GMMN').prix===11.2,"forçage"); });
  test("sans indice ni prix forcé : pas de surcharge", ()=>attendu(!T.comDvLegs({...E,fuelForce:{}},V,null).some(l=>l.type==='fuel'),"surcharge"));
  test("recherche : code IATA exact en premier", ()=>attendu(T.comAptSearch(apts,'cmn')[0].icao==='GMMN',"ordre"));
  test("recherche : ville du salon reconnue", ()=>attendu(T.comAptGuess(apts,'Dakhla').icao==='GMMH'&&T.comAptGuess(apts,'Casablanca').icao==='GMMN',"ville"));
  const f={id:'x',etape:0,relances:{brochure:null,devis:null,j2:{date:'a'},j7:null},historique:[]};
  test("devis envoyé : relances J+2 et J+7 repartent, étape « Devis envoyé »", ()=>{ const g=T.comDevisEnvoye(f,'DEV-2026-0004 v1','2026-10-11T09:00:00.000Z','Anas'); attendu(g.relances.devis.auteur==='Anas'&&g.relances.j2===null&&g.etape===2,JSON.stringify(g.relances)); });
  test("introduction de secours sans IA", ()=>attendu(/^Suite à notre échange/.test(T.comIntroSecours({organisation:'OCP'},by('GMMN'),by('GMMH'))),"texte"));
  test("contexte de l'IA : libellés en clair", ()=>attendu(T.comContexteIA({nom:'A',groupe:'10a18',types:['delegation'],notes:[{texte:'n'}]},by('GMMN'),by('GMMH'),true).groupe==='10 à 18',"libellé"));
}


console.log('\nModule Commercial — transmission aux Opérations (lot C)');
{
  const apts=T.comAptListe(JSON.parse(fs.readFileSync(require('path').join(__dirname,'..','aeroports.json'),'utf8')));
  const d={id:'dv1',numero:'DEV-2026-0024',version:1,ficheId:'p1',lignes:[
    {type:'mep',libelle:'Mise en place',de:{icao:'GMME',ville:'Rabat'},vers:{icao:'GMMN',ville:'Casablanca'},minutes:25},
    {type:'vol',libelle:'Vol aller',de:{icao:'GMMN',ville:'Casablanca'},vers:{icao:'GQNO',ville:'Nouakchott'},minutes:182},
    {type:'vol',libelle:'Vol retour',de:{icao:'GQNO',ville:'Nouakchott'},vers:{icao:'GMMN',ville:'Casablanca'},minutes:182},
    {type:'mep',libelle:"Retour de l'avion",de:{icao:'GMMN',ville:'Casablanca'},vers:{icao:'GMME',ville:'Rabat'},minutes:25},
    {type:'immo',libelle:'Immobilisation',minutes:120},{type:'fuel',libelle:'Surcharge carburant',montant:9108}]};
  const legs=T.comLegsDevis(d);
  test("vols à planifier : mises en place et vols clients seulement", ()=>attendu(legs.length===4&&legs.every(l=>l.type==='mep'||l.type==='vol'),JSON.stringify(legs.map(l=>l.type))));
  const S={vols:[{date:'2026-10-22',heure:'06:45'},{date:'2026-10-22',heure:'08:00'},{date:'2026-10-23',heure:'23:30'},{date:'2026-10-23',heure:''}],pax:'14',note:'Bagages lourds'};
  test("saisie complète acceptée", ()=>attendu(T.comValiderSaisie(legs,S,'2026-10-14')===null,T.comValiderSaisie(legs,S,'2026-10-14')));
  test("date manquante refusée", ()=>attendu(/date souhaitée/.test(T.comValiderSaisie(legs,{...S,vols:[{date:''},...S.vols.slice(1)]},'2026-10-14')),"acceptée"));
  test("date passée refusée", ()=>attendu(/passée/.test(T.comValiderSaisie(legs,S,'2026-10-23')),"acceptée"));
  test("dates dans le désordre refusées", ()=>attendu(/ordre des vols/.test(T.comValiderSaisie(legs,{...S,vols:[S.vols[0],{date:'2026-10-21'},S.vols[2],S.vols[3]]},'2026-10-14')),"acceptée"));
  test("heure incorrecte refusée", ()=>attendu(/Heure incorrecte/.test(T.comValiderSaisie(legs,{...S,vols:[{date:'2026-10-22',heure:'25:00'},...S.vols.slice(1)]},'2026-10-14')),"acceptée"));
  test("19 passagers refusés, 0 refusé", ()=>attendu(T.comValiderSaisie(legs,{...S,pax:19},'2026-10-14')&&T.comValiderSaisie(legs,{...S,pax:0},'2026-10-14'),"accepté"));
  const dem=T.comCreerDemande(d,{id:'C7',nom:'Mines du Sud'},S,apts,'2026-10-14T16:05:00.000Z','Anas BENNANI','D1');
  test("demande : codes IATA des aéroports", ()=>attendu(dem.vols.map(v=>v.de.iata+'-'+v.vers.iata).join(' ')==='RBA-CMN CMN-NKC NKC-CMN CMN-RBA',dem.vols.map(v=>v.de.iata+'-'+v.vers.iata).join(' ')));
  test("demande : client, passagers, note, dates", ()=>attendu(dem.clientId==='C7'&&dem.pax===14&&dem.note==='Bagages lourds'&&dem.vols[2].date==='2026-10-23'&&dem.statut==='active',JSON.stringify(dem).slice(0,200)));
  test("demande neuve : 4 vols à planifier", ()=>attendu(T.comEtatDemande(dem,[]).statut==='a_planifier'&&T.comVolsAPlanifier([dem],[]).length===4,"état"));
  const pVol=T.comPrefillVol(dem,dem.vols[1]), pPos=T.comPrefillVol(dem,dem.vols[0]);
  test("pré-remplissage d'un vol client : COM, client, passagers, arrivée calculée", ()=>attendu(pVol.flightType==='Commercial'&&pVol.clientId==='C7'&&pVol.pax===14&&pVol.from==='CMN'&&pVol.to==='NKC'&&pVol.dep==='08:00'&&pVol.arr==='11:02',JSON.stringify(pVol)));
  test("pré-remplissage d'une mise en place : POS, client du dossier, sans passagers", ()=>attendu(pPos.flightType==='Positioning'&&pPos.clientId==='C7'&&pPos.clientNom==='Mines du Sud'&&pPos.pax===0,JSON.stringify(pPos)));
  test("liste des clients : client pas encore reçu sur ce téléphone, affiché avec son nom", ()=>{ const o=T.comOptionsClients([{id:'C1',nom:'OCP',type:'Corporate',ville:'Casablanca'}],'C7','Mines du Sud'); attendu(o.length===2&&o[0].value==='C7'&&o[0].label==='Mines du Sud',JSON.stringify(o)); });
  test("liste des clients : client déjà connu, pas de doublon", ()=>{ const o=T.comOptionsClients([{id:'C7',nom:'Mines du Sud',type:'Corporate',ville:'Casablanca'}],'C7','Mines du Sud'); attendu(o.length===1&&o[0].sub==='Corporate · Casablanca',JSON.stringify(o)); });
  test("liste des clients : saisie manuelle, liste inchangée", ()=>{ const o=T.comOptionsClients([{id:'C1',nom:'OCP',type:'Corporate',ville:'Casablanca'}],'',''); attendu(o.length===1&&o[0].label==='OCP',JSON.stringify(o)); });
  test("arrivée après minuit : 23:30 + 3 h 02 = 02:32", ()=>attendu(T.comPrefillVol(dem,dem.vols[2]).arr==='02:32',T.comPrefillVol(dem,dem.vols[2]).arr));
  test("heure non fixée : ni départ ni arrivée", ()=>{ const v=T.comPrefillVol(dem,dem.vols[3]); attendu(v.dep===''&&v.arr==='',JSON.stringify(v)); });
  const F=[{demandeId:'D1',demandeVol:0,date:'2026-10-22',dep:'06:45',arr:'07:10'},{demandeId:'D1',demandeVol:1,date:'2026-10-22',dep:'08:15',arr:'11:17'},{demandeId:'AUTRE',demandeVol:2}];
  test("avancement : 2 sur 4, la demande d'un autre dossier ne compte pas", ()=>{ const e=T.comEtatDemande(dem,F); attendu(e.statut==='partiel'&&e.planifies===2&&T.comVolsAPlanifier([dem],F).map(x=>x.leg.i).join()==='2,3',JSON.stringify(e.planifies)); });
  test("vol supprimé du planning : redevient à planifier", ()=>attendu(T.comEtatDemande(dem,F.slice(0,1)).planifies===1,"reste planifié"));
  const tout=[0,1,2,3].map(i=>({demandeId:'D1',demandeVol:i,date:'2026-10-2'+(i<2?2:3),dep:'10:00',arr:'12:00'}));
  test("tous planifiés : « Vols planifiés »", ()=>attendu(T.comEtatDemande(dem,tout).statut==='planifie'&&T.comVolsAPlanifier([dem],tout).length===0,"état"));
  test("liste repliable : une ligne par client, vols dans l'ordre du devis", ()=>{
    const d2={...dem,id:'D2',clientNom:'OCP',transmisLe:'2026-10-15T09:00:00.000Z',vols:[{...dem.vols[1],date:'2026-10-25'},{...dem.vols[2],date:'2026-10-26'}].map((v,k)=>({...v,i:k}))};
    const d3={...dem,id:'D3',clientNom:'MASEN',transmisLe:'2026-10-13T09:00:00.000Z',vols:[{...dem.vols[1],i:0,date:'2026-10-20'}]};
    const G=T.comGroupesAPlanifier(T.comVolsAPlanifier([dem,d2,d3],F));
    attendu(G.map(g=>g.dem.clientNom+':'+g.legs.map(l=>l.i).join('')).join(' ')==='MASEN:0 Mines du Sud:23 OCP:01'&&G[1].premier==='2026-10-23',G.map(g=>g.dem.clientNom+':'+g.legs.map(l=>l.i).join('')+'@'+g.premier).join(' ')); });
  test("liste repliable : client entièrement planifié, ligne retirée", ()=>attendu(T.comGroupesAPlanifier(T.comVolsAPlanifier([dem],tout)).length===0,"ligne restante"));
  test("saisie à la main : seulement FRY et POS proposés", ()=>attendu(T.comTypesVol(null).join()==='Ferry,Positioning',T.comTypesVol(null).join()));
  test("saisie à la main : vol COM refusé", ()=>attendu(/uniquement à partir d'une demande du Commercial/.test(T.comControleType('Commercial',null)),"accepté"));
  test("saisie à la main : FRY et POS acceptés", ()=>attendu(T.comControleType('Ferry',null)===null&&T.comControleType('Positioning',null)===null,"refusé"));
  test("vol pris dans une demande : COM accepté", ()=>attendu(T.comControleType('Commercial',{flightType:'Commercial'})===null,"refusé"));
  test("vol pris dans une demande : type verrouillé", ()=>attendu(T.comTypesVol({flightType:'Commercial'}).join()==='Commercial'&&/fixé par la demande/.test(T.comControleType('Ferry',{flightType:'Commercial'})),"modifiable"));
  test("mise en place d'une demande : POS seulement", ()=>attendu(T.comTypesVol({flightType:'Positioning'}).join()==='Positioning'&&T.comControleType('Positioning',{flightType:'Positioning'})===null,"type"));
  test("demande annulée : plus rien à planifier", ()=>attendu(T.comVolsAPlanifier([{...dem,statut:'annulee'}],[]).length===0&&T.comEtatDemande({...dem,statut:'annulee'},[]).statut==='annulee',"à planifier"));
  test("horaires au client : vols avec passagers seulement, heures définitives", ()=>{ const t=T.comTexteHoraires(dem,T.comEtatDemande(dem,F)); attendu(/Casablanca → Nouakchott · départ 08:15, arrivée 11:17/.test(t)&&!/Rabat/.test(t),t); });
  test("client d'un devis fait depuis une fiche prospect devenue cliente", ()=>{ const r=T.comClientDuDevis(d,[{id:'p1',clientRef:'C7'}],[{id:'C7',nom:'Mines du Sud'}]); attendu(r.prospect.id==='p1'&&r.client.id==='C7',"client"); });
  test("client d'un devis fait directement depuis la fiche client", ()=>{ const r=T.comClientDuDevis({...d,ficheId:'C8'},[],[{id:'C8',nom:'MASEN'}]); attendu(!r.prospect&&r.client.nom==='MASEN',"client"); });
  test("fiche client présentée à l'éditeur de devis", ()=>{ const f=T.comFicheClient({id:'C8',nom:'MASEN',contact:'M. Alami',tel:'05',email:'a@b.ma'}); attendu(f.id==='C8'&&f.organisation==='MASEN'&&f.nom==='M. Alami'&&f.estClient,JSON.stringify(f)); });
}

console.log('\nModule Commercial — archivage des prospects');
{
  const f={id:'a1',statut:'prospect',etape:1,suites:['devis'],createdAt:'2026-10-01T09:00:00.000Z',relances:{brochure:{date:'2026-10-02T09:00:00.000Z'},devis:null,j2:null,j7:null},historique:[]};
  const a=T.comArchiver(f,'Prix','budget dépassé','2026-10-10T09:00:00.000Z','Anas');
  test("archivage avec motif : statut, motif, historique", ()=>attendu(a.statut==='archive'&&a.archive.motif==='Prix'&&/Archivée : Prix \(budget dépassé\)/.test(a.historique.pop().texte),"archivage"));
  test("motif inconnu : rien n'est archivé", ()=>attendu(T.comArchiver(f,'Autre chose','','x','A')===f,"archivé"));
  test("fiche archivée : plus de relance, plus active", ()=>attendu(T.comDueInfo(a,new Date('2026-10-30T12:00:00'))===null&&!T.comEstActif(a),"relance"));
  test("réactivation : la fiche redevient un prospect suivi", ()=>{ const r=T.comReactiver(a,'2026-10-12T09:00:00.000Z','Anas'); attendu(r.statut==='prospect'&&!r.archive&&T.comEstActif(r),"réactivation"); });
  test("réimport Airshow : une fiche archivée le reste", ()=>{ const F={app:'fiches-airshow',format:1,fiches:[{...f,statut:undefined,updatedAt:'2026-10-20T00:00:00.000Z',etapesV:3}],devis:[]};
    const r=T.comFusionImport({prospects:[a],devis:[],clients:[]},F,'n','A'); attendu(r.prospects[0].statut==='archive',r.prospects[0].statut); });
}


console.log('\nModule Commercial — équipage repris d\'un vol à l\'autre du même devis');
{
  const crew=[{nom:'MAIDANE',prenom:'NOUR',role:'TRI'},{nom:'CHERKAOUI',prenom:'SAID',role:'TRI'},{nom:'ALAMI',prenom:'KARIM',role:'CM1'},{nom:'BENALI',prenom:'OMAR',role:'CM1'},
    {nom:'IDRISSI',prenom:'OMAR',role:'CM2'},{nom:'CHRAIBI',prenom:'NADIA',role:'CC'}];
  const dem={id:'D1'}, L=i=>({i});
  const vol=(i,cm1,cm2,cc)=>({demandeId:'D1',demandeVol:i,cm1,cm2,cc});
  test("premier vol du devis : rien n'est proposé", ()=>attendu(T.comEquipageSuivant(dem,L(0),[],crew)===null,"proposé"));
  test("CDB + OPL : on garde, CDB en CM1, OPL en CM2", ()=>{ const e=T.comEquipageSuivant(dem,L(1),[vol(0,'ALAMI KARIM','IDRISSI OMAR','CHRAIBI NADIA')],crew); attendu(e.cm1==='ALAMI KARIM'&&e.cm2==='IDRISSI OMAR'&&e.cc==='CHRAIBI NADIA',JSON.stringify(e)); });
  test("TRI + OPL : on garde, TRI en CM1, OPL en CM2", ()=>{ const e=T.comEquipageSuivant(dem,L(1),[vol(0,'MAIDANE NOUR','IDRISSI OMAR','')],crew); attendu(e.cm1==='MAIDANE NOUR'&&e.cm2==='IDRISSI OMAR',JSON.stringify(e)); });
  test("OPL saisi en CM1 par erreur : le commandant repasse en CM1", ()=>{ const e=T.comEquipageSuivant(dem,L(1),[vol(0,'IDRISSI OMAR','ALAMI KARIM','')],crew); attendu(e.cm1==='ALAMI KARIM'&&e.cm2==='IDRISSI OMAR',JSON.stringify(e)); });
  test("2 CDB : on alterne", ()=>{ const e=T.comEquipageSuivant(dem,L(1),[vol(0,'ALAMI KARIM','BENALI OMAR','')],crew); attendu(e.cm1==='BENALI OMAR'&&e.cm2==='ALAMI KARIM',JSON.stringify(e)); });
  test("TRI + CDB : on alterne", ()=>{ const e=T.comEquipageSuivant(dem,L(1),[vol(0,'MAIDANE NOUR','ALAMI KARIM','')],crew); attendu(e.cm1==='ALAMI KARIM'&&e.cm2==='MAIDANE NOUR',JSON.stringify(e)); });
  test("TRI + TRI : on alterne", ()=>{ const e=T.comEquipageSuivant(dem,L(1),[vol(0,'MAIDANE NOUR','CHERKAOUI SAID','')],crew); attendu(e.cm1==='CHERKAOUI SAID',JSON.stringify(e)); });
  test("2 CDB sur 4 vols : Alami, Benali, Alami, Benali en CM1", ()=>{ const F=[vol(0,'ALAMI KARIM','BENALI OMAR','')];
    for(let i=1;i<4;i++){ const e=T.comEquipageSuivant(dem,L(i),F,crew); F.push(vol(i,e.cm1,e.cm2,e.cc)); }
    attendu(F.map(f=>f.cm1.split(' ')[0]).join(',')==='ALAMI,BENALI,ALAMI,BENALI',F.map(f=>f.cm1).join(',')); });
  test("vols planifiés dans le désordre : le vol 3 reprend l'ordre du vol 1", ()=>{ const e=T.comEquipageSuivant(dem,L(2),[vol(0,'ALAMI KARIM','BENALI OMAR','')],crew); attendu(e.cm1==='ALAMI KARIM'&&e.cm2==='BENALI OMAR',JSON.stringify(e)); });
  test("vol d'un autre devis : rien n'est proposé", ()=>attendu(T.comEquipageSuivant({id:'D2'},L(1),[vol(0,'ALAMI KARIM','BENALI OMAR','')],crew)===null,"proposé"));
  test("vol précédent sans équipage : rien n'est proposé", ()=>attendu(T.comEquipageSuivant(dem,L(1),[vol(0,'','','')],crew)===null,"proposé"));
}


console.log('\nModule Commercial — équipage et avion valables jusqu\'au retour du dossier');
{
  const crewD=[{nom:'ALAMI',prenom:'KARIM',role:'CM1',dates:{med:'2026-10-22',qt:'2027-12-31',opc:'2027-12-31'}},{nom:'BENALI',prenom:'OMAR',role:'CM1',dates:{med:'2027-06-30',qt:'2027-12-31',opc:'2027-12-31'}}];
  const acD=m=>[{id:'AC1',immat:'CN-KTA',mels:m?[{mel:'MEL 34-41',sys:'Radar',sev:'B',exp:m}]:[]}];
  const dem={vols:[{date:'2026-10-21'},{date:'2026-10-21'},{date:'2026-10-24'},{date:'2026-10-24'}]};
  const aller={date:'2026-10-21',acId:'AC1',cm1:'ALAMI KARIM',cm2:'BENALI OMAR'};
  test("fin du dossier : date du dernier vol", ()=>attendu(T.comFinDossier(dem)==='2026-10-24',T.comFinDossier(dem)));
  test("aller : valable à sa date", ()=>attendu(T.volCompromis(aller,crewD,acD(null)).length===0,"bloqué"));
  test("médical qui expire entre l'aller et le retour : refusé", ()=>{ const p=T.comControleDossier(aller,'2026-10-24',crewD,acD(null)); attendu(p.length===1&&p[0].type==='crew'&&/ALAMI KARIM/.test(p[0].label),JSON.stringify(p)); });
  test("MEL qui expire entre l'aller et le retour : refusée", ()=>{ const p=T.comControleDossier({...aller,cm1:'BENALI OMAR',cm2:''},'2026-10-24',crewD,acD('22/10/26')); attendu(p.length===1&&p[0].type==='mel',JSON.stringify(p)); });
  test("expiration le jour même du retour : acceptée", ()=>attendu(T.comControleDossier({...aller,cm1:'BENALI OMAR',cm2:''},'2026-10-24',crewD,acD('24/10/26')).length===0,"refusée"));
  test("équipage et avion valables jusqu'au retour : accepté", ()=>attendu(T.comControleDossier({...aller,cm1:'BENALI OMAR',cm2:''},'2026-10-24',crewD,acD('31/12/26')).length===0,"refusé"));
  test("dernier vol du dossier : pas de contrôle supplémentaire (le contrôle habituel suffit)", ()=>attendu(T.comControleDossier({...aller,date:'2026-10-24'},'2026-10-24',crewD,acD('22/10/26')).length===0,"contrôle en double"));
  test("vol hors dossier : contrôlé à sa seule date", ()=>attendu(T.comControleDossier(aller,'',crewD,acD('22/10/26')).length===0,"contrôlé au-delà"));
}


console.log('\nModule Commercial — tableau de bord');
{
  const NOW='2026-10-25T10:00:00.000Z';
  test("période : trimestre en cours", ()=>{ const p=T.comPeriode('trimestre','2026-11-15T10:00:00Z'); attendu(p.debut==='2026-10-01'&&p.fin==='2026-12-31',JSON.stringify(p)); });
  test("période : mois de février", ()=>{ const p=T.comPeriode('mois','2026-02-10T10:00:00Z'); attendu(p.debut==='2026-02-01'&&p.fin==='2026-02-28',JSON.stringify(p)); });
  test("période : année", ()=>{ const p=T.comPeriode('annee',NOW); attendu(p.debut==='2026-01-01'&&p.fin==='2026-12-31',JSON.stringify(p)); });
  const L=(v,m)=>[{type:'mep',minutes:m||30},{type:'vol',minutes:v||120},{type:'immo',minutes:120},{type:'fuel',minutes:0}];
  const dv=(numero,version,o)=>Object.assign({id:numero+version,numero,version,ficheId:'p1',totalHT:100000,validite:'2026-11-30',creePar:'Anas BENNANI',client:{nom:'X',organisation:'OCP'},lignes:L()},o);
  const D=[
    dv('A',1,{envoye:{date:'2026-10-05T09:00:00Z'},totalHT:450000}),
    dv('A',2,{envoye:{date:'2026-10-08T09:00:00Z'},accepte:{date:'2026-10-12T09:00:00Z'},totalHT:500000,client:{organisation:'Mines du Sud'}}),
    dv('B',1,{envoye:{date:'2026-10-20T09:00:00Z'},totalHT:300000,creePar:'Hicham QADRI'}),
    dv('C',1,{envoye:{date:'2026-10-01T09:00:00Z'},validite:'2026-10-16',totalHT:999000}),
    dv('D',1,{envoye:{date:'2026-10-10T09:00:00Z'},ficheId:'pArch',totalHT:888000}),
    dv('E',1,{envoye:{date:'2026-09-01T09:00:00Z'},accepte:{date:'2026-09-10T09:00:00Z'},totalHT:777000}),
    dv('F',1,{totalHT:111000})];
  const P=[{id:'p1',statut:'client',guide:'Anas BENNANI',createdAt:'2026-10-02T09:00:00Z',source:'airshow',etape:2},
    {id:'p2',statut:'prospect',guide:'Hicham QADRI',createdAt:'2026-10-03T09:00:00Z',source:'kpi',etape:0,suites:['devis'],relances:{}},
    {id:'pArch',statut:'archive',guide:'Hicham QADRI',createdAt:'2026-10-04T09:00:00Z',source:'airshow',etape:1,archive:{date:'2026-10-15T09:00:00Z',motif:'Prix'}}];
  const R=T.comTableau(P,D,[],[],'trimestre',NOW);
  test("CA signé : dernière version acceptée, une fois par numéro", ()=>attendu(R.caSigne===500000&&R.nbAcceptes===1,R.caSigne+' / '+R.nbAcceptes));
  test("devis accepté hors période : pas compté", ()=>attendu(!R.clients.some(c=>c.ca===777000),"compté"));
  test("envoyés : un numéro compte une fois, jamais envoyé non compté", ()=>attendu(R.nbEnvoyes===4,String(R.nbEnvoyes)));
  test("taux de transformation : 1 accepté sur 4 envoyés = 25 %", ()=>attendu(R.taux===25,String(R.taux)));
  test("en négociation : ni expiré, ni archivé, ni accepté", ()=>attendu(R.caNego===300000&&R.nbNego===1,R.caNego+' / '+R.nbNego));
  test("heures vendues : vols et mises en place du devis accepté", ()=>attendu(R.minutes===150&&R.minutesMep===30,R.minutes+' / '+R.minutesMep));
  test("délai moyen : du premier envoi à l'acceptation (7 jours)", ()=>attendu(R.delai===7,String(R.delai)));
  test("CA par mois : octobre, signé et en négociation", ()=>{ const o=R.mois.find(m=>m.cle==='2026-10'); attendu(R.mois.length===3&&o.signe===500000&&o.nego===300000,JSON.stringify(R.mois)); });
  test("par commercial : auteur du devis", ()=>{ const a=R.commerciaux.find(c=>c.nom==='Anas BENNANI'), h=R.commerciaux.find(c=>c.nom==='Hicham QADRI'); attendu(a.ca===500000&&a.acceptes===1&&a.envoyes===3&&h.envoyes===1&&h.fiches===2,JSON.stringify(R.commerciaux)); });
  test("meilleurs clients : organisation du devis accepté", ()=>attendu(R.clients.length===1&&R.clients[0].nom==='Mines du Sud',JSON.stringify(R.clients)));
  test("motifs de perte : fiches archivées dans la période", ()=>attendu(R.motifs.length===1&&R.motifs[0].motif==='Prix'&&R.nbArchivesPeriode===1,JSON.stringify(R.motifs)));
  test("entonnoir : état actuel, clients et archivés à part", ()=>attendu(R.entonnoir.total===3&&R.entonnoir.clients===1&&R.entonnoir.archives===1&&R.entonnoir.etapes[0].n===1,JSON.stringify(R.entonnoir)));
  test("origine des prospects créés dans la période", ()=>attendu(R.origine.airshow===2&&R.origine.kpi===1,JSON.stringify(R.origine)));
  test("relances en retard : prospects actifs seulement", ()=>attendu(R.relances===1,String(R.relances)));
  const Rtout=T.comTableau(P,D,[],[],'tout',NOW);
  test("tout : les deux devis acceptés", ()=>attendu(Rtout.caSigne===1277000&&Rtout.nbAcceptes===2,String(Rtout.caSigne)));
  test("aucune donnée : pas de division par zéro", ()=>{ const r=T.comTableau([],[],[],[],'mois',NOW); attendu(r.taux===null&&r.delai===null&&r.caSigne===0&&r.minutes===0,JSON.stringify([r.taux,r.delai])); });
}


console.log('\nRestauration — résumé affiché avant confirmation');
{
  const d={flights:[{},{}],crew:[{}],prospects:[{},{},{},{},{}],devis:[{numero:'A',version:1},{numero:'A',version:2},{numero:'B',version:1}],clients:[{},{}],demandes:[{}]};
  const r=T.restoreResume(d);
  test("résumé : ligne Commercial avec prospects, devis, clients et demandes", ()=>attendu(/Commercial : 5 prospects · 2 devis · 2 clients · 1 demande de vols/.test(r),r));
  test("résumé : un devis à deux versions compte une fois", ()=>attendu(/ 2 devis /.test(r),r));
  test("résumé : ligne d'exploitation inchangée", ()=>attendu(/^2 vols · 0 danger · 0 action · 0 enquête · 1 membre d'équipage/.test(r),r));
  test("résumé : ancienne sauvegarde sans module Commercial", ()=>attendu(/Commercial : 0 prospect · 0 devis · 0 client · 0 demande de vols/.test(T.restoreResume({flights:[]})),T.restoreResume({flights:[]})));
}


console.log('\nFiche d\'analyse — date de réception automatique');
{
  test("réception : jour d'enregistrement du compte rendu", ()=>attendu(T.sgsReceptionAuto({date:'2026-10-10',timestamp:'2026-10-12T11:20:00.000Z'})==='2026-10-12',T.sgsReceptionAuto({timestamp:'2026-10-12T11:20:00.000Z'})));
  test("réception : compte rendu anonyme, mois seulement", ()=>attendu(T.sgsReceptionAuto({anonyme:true,date:'2026-10-01',timestamp:'2026-10-12T11:20:00.000Z'})==='2026-10',"jour exposé"));
  test("réception : ancien compte rendu sans horodatage, à saisir", ()=>attendu(T.sgsReceptionAuto({date:'2026-10-10'})===''&&T.sgsReceptionAuto({timestamp:3})===''&&T.sgsReceptionAuto({timestamp:'n\'importe quoi'})==='',"rempli à tort"));
  test("mois en clair", ()=>attendu(T.sgsMoisFr('2026-10')==='octobre 2026'&&T.sgsMoisFr('')==='',T.sgsMoisFr('2026-10')));
}


console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko?1:0);
