# Pregled funkcionalnosti

Platforma za koordinacijo ekipe: naloge, delovne ure in sestanki na enem mestu, s pogledom za člana
in pogledom za admina na vsakem področju, ter analitiko za vodjo.

**Živa različica:** https://ai-weekend-solution-six.vercel.app (demo računi so na prijavni strani)
**Podatki:** izključno sandbox (20 izmišljenih članov, 6 serij sestankov, 6 tednov zgodovine)

---

## Pogledi za člana

| Stran | Kaj omogoča |
| --- | --- |
| **Dashboard** | Enostaven pregled: dodeljene naloge, bližnji sestanki in zagon merjenja delovnega časa. |
| **Tasks** | Pregled, ustvarjanje in urejanje dodeljenih nalog ter označevanje zaključenih. Naloge so razvrščene po prioriteti (Urgent / Medium / Low), nato po roku. Oznako »done« je mogoče razveljaviti (Undo). |
| **Hours** | Pregled opravljenih ur v tem tednu, delovnih sej in zgodovine, z napredkom glede na tedensko kvoto tierja (Core 70, Impact 10, GO! 4). Vsak vnos loči **delo v pisarni in delo od doma**. |
| **Meetings** | Pregled trenutnih, prihodnjih in preteklih sestankov, prijava prisotnosti, opravičilo odsotnosti in lastna zgodovina udeležbe. |
| **Projects** | Zbran pogled projektov in pripadajočih nalog. |

## Pogledi za admina

| Stran | Kaj omogoča |
| --- | --- |
| **admin/members** | Urejanje članov: dodajanje novih, urejanje tierov, generiranje enkratnih povezav za nastavitev ali ponastavitev gesla. |
| **admin/departments** | Urejanje departmentov (skupine shaperjev, zadolženih za določena področja). Nalogo je mogoče dodeliti departmentu kot skupini. |
| **admin/hours** | Pregled doseganja časovnih kvot članov: kdo zaostaja ta teden, kdo trenutno dela, zgodovina posameznika in popravki vnosov. |
| **admin/meetings** | Pregled **vseh** sestankov, hitro vnašanje prisotnosti, tabela udeležbe po članih in serijah, odločanje o poznih opravičilih. |
| **admin/slack** | Upravljanje integracije s Slackom. |
| **admin/analytics** | Analitika za vodjo: delovne ure ekipe, opravljeni taski, udeležba po serijah in **seznam članov, ki upadajo** (pod 50 % kvote v 2 od zadnjih 4 tednov ali 2+ neopravičeni odsotnosti v zadnjih 6 sestankih). |
| **admin/settings** | Upravljanje nastavitev za celotno platformo (npr. ali je treba AI naloge ročno odobriti). |

---

## Logika nalog

- Vsaka naloga se dodeli **uporabniku ali departmentu** (nikoli obojemu). Nalogo departmenta lahko
  prevzame kdorkoli iz tega departmenta.
- Določita se tip naloge in projekt, pod katerega spada.
- Naloga ima prioriteto in rok; vsaka sprememba se zapiše v zgodovino (kdo, kdaj, kaj).
- **General task** je stalna naloga, pri kateri kdorkoli lahko pomaga. General taska **ni mogoče
  označiti kot done** — to pravilo je uveljavljeno na strežniku, ne le skrito v vmesniku.
  Člane se nanje napoti po neopravičeni odsotnosti s sestanka.
- Naloge se **dvosmerno sinhronizirajo** z obstoječim Google Sheetom ekipe. Če se spremeni samo
  list, aplikacija spremembo prevzame; če se spremeni samo aplikacija, se zapiše v list; če oboje,
  **obvelja aplikacija**, prepisana vrednost pa se ohrani v zgodovini.

## Logika sestankov

- Sestanki se sinhronizirajo iz **.ics datoteke ali povezanega Google Koledarja** (samo branje —
  aplikacija sestankov nikoli ne ustvarja in ne spreminja). Samodejno osveževanje na 15 minut.
- Sestanki so razvrščeni v **serije sestankov** (Summer School, Grants, Shape Talks, Community,
  Shapers Tech, Shapers Voice).
- Sestanke je mogoče **snemati na platformi (samo admini)**. Posnetki se transkribirajo, iz
  transkripta pa AI predlaga naloge in jih dodeli udeležencem.
- Prisotnost se lahko označi **od 15 minut pred začetkom do 15 minut po koncu** sestanka; admini
  lahko prisotnost kadarkoli vnesejo ali popravijo za vse.
- **Odsotnost je treba najaviti vsaj 72 ur (3 dni) pred sestankom.** Kasnejša najava šteje kot
  neopravičena, dokler je admin ne odobri.
- Kdor na preteklem sestanku nima zapisa, samodejno šteje kot **neopravičeno odsoten**.

## Obvestila

- **Slack:** opomniki za sestanke se pošljejo **3 dni in 1 dan pred** sestankom.
- **E-pošta, sestanki:** opomnik **1 dan in 10 minut pred** začetkom (vsak član si izbere svoje).
- **E-pošta, roki nalog:** opomnik **privzeto 1 dan pred rokom**, ob 8:00; član lahko izbere
  3 dni, 1 dan, na dan roka ali izklop.

## Kaj dela AI

AI se uporablja na treh ozkih mestih, povsod na strežniku in povsod neobvezno:

1. **Zapiski ali transkript sestanka → predlagane naloge.** Vsaka naloga nosi **citat**, iz katerega
   izhaja. Privzeto počaka na potrditev nosilca; nepotrjene AI naloge se nikjer ne štejejo.
   Admin lahko to zahtevo po potrditvi izklopi na *admin/settings*.
2. **Vprašanje o sestanku.** Odgovor nastane izključno iz zapiskov tistega sestanka, citati se
   preverijo; če odgovora v zapiskih ni, AI to pove.
3. **Povzetek sestanka** v nekaj alinejah.

---

## Kaj še ni implementirano

- **AI assistant**
- **Shapergotchi** (gamifikacija)
- Slovenski jezik vmesnika
- Graf ur na dashboardu
- Snemalnik še ni preizkušen na Safariju in na pravem telefonu
- Naloge pri prednaloženih projektih so zaenkrat vzorčne (placeholder)
