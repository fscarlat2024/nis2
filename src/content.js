// Continutul de baza: masurile din Art. 21(2) NIS2, sarcinile de pornire si regulile orientative de incadrare.
// Textele sunt ajutor practic, nu consultanta juridica. De verificat cu OUG 155/2024 si DNSC inainte de lansare.

export const MEASURES = [
  { id: 'a', name: 'Analiza riscurilor', full: 'Politici de analiză a riscurilor și de securitate a sistemelor informatice' },
  { id: 'b', name: 'Gestionarea incidentelor', full: 'Gestionarea incidentelor' },
  { id: 'c', name: 'Continuitate și backup', full: 'Continuitatea activității, backup, recuperare în caz de dezastru și gestionarea crizelor' },
  { id: 'd', name: 'Securitatea furnizorilor', full: 'Securitatea lanțului de aprovizionare' },
  { id: 'e', name: 'Achiziții și vulnerabilități', full: 'Securitate la achiziția, dezvoltarea și întreținerea sistemelor, inclusiv tratarea vulnerabilităților' },
  { id: 'f', name: 'Evaluarea eficacității', full: 'Politici și proceduri de evaluare a eficacității măsurilor' },
  { id: 'g', name: 'Igienă și instruire', full: 'Practici de igienă cibernetică și instruire în securitate' },
  { id: 'h', name: 'Criptografie', full: 'Politici și proceduri privind criptografia și, după caz, criptarea' },
  { id: 'i', name: 'Personal, acces și active', full: 'Securitatea resurselor umane, controlul accesului și gestionarea activelor' },
  { id: 'j', name: 'MFA și comunicații', full: 'Autentificare multifactor și comunicații securizate' },
];
export const BASE_MEASURE = { id: 'x', name: 'Obligații de bază', full: 'Înregistrare, responsabilități și rolul conducerii' };

// [masura, titlu, detaliu]
export const STARTER_TASKS = [
  ['x', 'Confirmați încadrarea firmei', 'Verificați rezultatul din aplicație cu OUG 155/2024 sau cu un consultant. Păstrați concluzia ca dovadă.'],
  ['x', 'Notificați DNSC pentru înregistrare', 'Dacă firma intră sub NIS2, transmiteți notificarea conform procedurii DNSC și păstrați confirmarea. Verificați termenul aplicabil pe dnsc.ro.'],
  ['x', 'Desemnați responsabilul de securitate', 'Numiți persoana responsabilă, printr-o decizie internă, și stabiliți cine o înlocuiește.'],
  ['x', 'Instruiți conducerea', 'Conducerea aprobă măsurile, supraveghează aplicarea lor și urmează o instruire de securitate. Păstrați dovada participării.'],

  ['a', 'Faceți inventarul serviciilor critice', 'Notați serviciile fără de care firma se oprește și sistemele de care depind.'],
  ['a', 'Completați registrul de riscuri', 'Pentru fiecare risc: probabilitate, impact, responsabil și măsura aleasă.'],
  ['a', 'Aprobați planul de tratare a riscurilor', 'Conducerea decide ce riscuri se tratează, în ce ordine și cu ce buget.'],

  ['b', 'Stabiliți cine evaluează incidentele', 'Numiți cel puțin două persoane care pot decide dacă un incident este semnificativ, inclusiv în afara programului.'],
  ['b', 'Anunțați angajații cum raportează', 'Toți angajații trebuie să știe să folosească butonul de raportare din aplicație.'],
  ['b', 'Faceți un exercițiu de incident', 'Simulați un incident, parcurgeți termenele și notați ce trebuie îmbunătățit.'],

  ['c', 'Faceți backup pentru datele critice', 'Stabiliți ce se salvează, cât de des și cât timp se păstrează. Păstrați cel puțin o copie separată de rețeaua firmei.'],
  ['c', 'Testați restaurarea din backup', 'Restaurați un set real de date și notați cât a durat. Un backup netestat nu este o dovadă suficientă.'],
  ['c', 'Scrieți planul de continuitate', 'Notați cum continuă activitatea dacă sistemele principale nu sunt disponibile și cine ia deciziile.'],

  ['d', 'Faceți lista furnizorilor critici', 'Includeți furnizorii IT, de cloud și pe cei cu acces la datele sau sistemele firmei.'],
  ['d', 'Adăugați cerințe de securitate în contracte', 'Includeți obligația de a anunța incidentele, controlul accesului și dreptul de a verifica.'],
  ['d', 'Evaluați furnizorii critici', 'Cereți dovezi de securitate, de exemplu certificări sau un chestionar completat.'],

  ['e', 'Actualizați sistemele la zi', 'Stabiliți un calendar de actualizări pentru sisteme de operare, aplicații și echipamente de rețea.'],
  ['e', 'Scanați periodic vulnerabilitățile', 'Rulați scanări la intervale stabilite și urmăriți remedierea problemelor găsite.'],
  ['e', 'Includeți securitatea în achiziții', 'Adăugați cerințe de securitate înainte de a cumpăra sau de a dezvolta sisteme noi.'],

  ['f', 'Stabiliți indicatorii de securitate', 'Alegeți câțiva indicatori simpli, de exemplu timpul de actualizare sau rezultatul testelor de backup.'],
  ['f', 'Faceți o revizuire anuală', 'Verificați o dată pe an dacă măsurile funcționează și prezentați rezultatul conducerii.'],
  ['f', 'Planificați un audit sau un test', 'Programați un audit intern, extern sau un test de securitate, după caz.'],

  ['g', 'Instruiți angajații', 'Organizați instruirea de bază despre phishing, parole și raportarea incidentelor. Păstrați lista participanților.'],
  ['g', 'Stabiliți regulile de utilizare', 'Aprobați regulile pentru parole, dispozitive, e-mail și date. Angajații confirmă că le-au citit.'],
  ['g', 'Faceți un test de phishing', 'Trimiteți un mesaj de test, măsurați rezultatul și repetați instruirea unde este nevoie.'],

  ['h', 'Criptați laptopurile și stațiile', 'Activați criptarea discului și păstrați cheile de recuperare într-un loc sigur.'],
  ['h', 'Verificați criptarea conexiunilor', 'Folosiți doar protocoale actuale pentru site-uri, e-mail și acces de la distanță.'],
  ['h', 'Aprobați regulile de criptare', 'Stabiliți ce date se criptează, cu ce mijloace și cine gestionează cheile.'],

  ['i', 'Faceți inventarul echipamentelor și aplicațiilor', 'Notați fiecare echipament și aplicație, responsabilul și locul în care se află.'],
  ['i', 'Revizuiți drepturile de acces', 'Fiecare persoană primește doar accesul necesar. Verificați periodic conturile de administrator.'],
  ['i', 'Stabiliți pașii la angajare și la plecare', 'La plecare, accesul se închide imediat, iar echipamentele se predau pe bază de proces-verbal.'],

  ['j', 'Activați MFA pentru administratori', 'Toate conturile de administrator trebuie să folosească autentificare cu doi factori: e-mail, firewall, servere și aplicații cloud.'],
  ['j', 'Activați MFA pentru toți angajații', 'Extindeți autentificarea cu doi factori la e-mail și la accesul de la distanță.'],
  ['j', 'Stabiliți un canal securizat pentru urgențe', 'Alegeți un canal de comunicare criptat, care funcționează și dacă e-mailul firmei este indisponibil.'],
];

// Anexa I = sectoare cu grad ridicat de criticitate; Anexa II = alte sectoare critice (Directiva 2022/2555)
export const SECTORS = [
  { id: 'energie', name: 'Energie', annex: 1 },
  { id: 'transport', name: 'Transport', annex: 1 },
  { id: 'bancar', name: 'Sector bancar', annex: 1 },
  { id: 'financiar', name: 'Infrastructuri ale piețelor financiare', annex: 1 },
  { id: 'sanatate', name: 'Sănătate', annex: 1 },
  { id: 'apa-potabila', name: 'Apă potabilă', annex: 1 },
  { id: 'apa-uzata', name: 'Apă uzată', annex: 1 },
  { id: 'digital', name: 'Infrastructură digitală', annex: 1 },
  { id: 'it-gestionat', name: 'Servicii IT gestionate (B2B)', annex: 1 },
  { id: 'spatiu', name: 'Spațiu', annex: 1 },
  { id: 'public', name: 'Administrație publică', annex: 1 },
  { id: 'postal', name: 'Servicii poștale și de curierat', annex: 2 },
  { id: 'deseuri', name: 'Gestionarea deșeurilor', annex: 2 },
  { id: 'chimice', name: 'Substanțe chimice', annex: 2 },
  { id: 'alimentar', name: 'Producție și distribuție alimentară', annex: 2 },
  { id: 'fabricatie', name: 'Fabricație (dispozitive medicale, electronice, mașini, vehicule)', annex: 2 },
  { id: 'furnizori-digitali', name: 'Furnizori digitali (magazine online, motoare de căutare, rețele sociale)', annex: 2 },
  { id: 'cercetare', name: 'Cercetare', annex: 2 },
  { id: 'altul', name: 'Alt domeniu', annex: 0 },
];
export const EMPLOYEES = ['sub50', '50-249', '250+'];
export const TURNOVERS = ['sub10', '10-50', '50+'];

// Regula orientativa: mare = 250+ angajati sau peste 50 mil. EUR; medie = 50-249 angajati sau 10-50 mil. EUR.
export function classify({ sector, employees, turnover, special }) {
  const s = SECTORS.find((x) => x.id === sector);
  if (!s || !EMPLOYEES.includes(employees) || !TURNOVERS.includes(turnover)) return null;
  const size = employees === '250+' || turnover === '50+' ? 'mare'
    : employees === '50-249' || turnover === '10-50' ? 'medie' : 'mica';
  if (special) {
    return { classification: 'verificare', title: 'Se poate aplica indiferent de mărime', text: 'Unele servicii, de exemplu DNS, domenii de nivel superior, servicii de încredere sau comunicații electronice, pot intra sub NIS2 chiar și la firme mici. Verificați încadrarea cu DNSC sau cu un consultant.' };
  }
  if (!s.annex) return { classification: 'neinclusa', title: 'Probabil nu intrați direct sub NIS2', text: 'Domeniul ales nu pare listat în anexele directivei. Clienții pot totuși să vă ceară aceleași măsuri, dacă sunteți furnizorul lor.' };
  if (size === 'mica') return { classification: 'neinclusa', title: 'Probabil nu intrați direct sub NIS2', text: 'Firmele mici din acest domeniu sunt în general excluse. Clienții pot totuși să vă ceară aceleași măsuri, dacă sunteți furnizorul lor.' };
  if (s.annex === 1 && size === 'mare') return { classification: 'esentiala', title: 'Probabil entitate esențială', text: 'Urmează notificarea DNSC pentru înregistrare și implementarea celor 10 măsuri.' };
  return { classification: 'importanta', title: 'Probabil entitate importantă', text: 'Urmează notificarea DNSC pentru înregistrare și implementarea celor 10 măsuri.' };
}

export const INCIDENT_KINDS = ['Email suspect', 'Virus sau ransomware', 'Cont spart', 'Date pierdute', 'Sistem oprit', 'Altceva'];
