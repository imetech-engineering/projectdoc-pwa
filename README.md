# IMeTech Projectdocumentatie

Projectlogboeken bijwerken en raadplegen vanaf de telefoon — met spraak, in
natuurlijke taal, rechtstreeks in de bestaande `Project <Naam>.docx` bestanden
in OneDrive.

De app draait op je Claude-abonnement. Er is **geen API-sleutel** en er zijn
**geen losse API-kosten**: het denkwerk gebeurt door Claude Code op je eigen pc.

## Hoe het in elkaar zit

```
Telefoon                     Jouw pc (staat altijd aan)
┌─────────────────┐          ┌──────────────────────────────────┐
│  PWA            │  https   │  bridge (node)                   │
│  GitHub Pages   ├─────────►│    ├─ leest/schrijft .docx       │
│  spraak in/uit  │  token   │    └─ vraagt Claude Code om tekst │
└─────────────────┘          │                ▼                 │
                             │  OneDrive-map met projecten      │
                             └──────────────────────────────────┘
```

Bewuste rolverdeling:

- **Claude** doet taal: verhaspelde spraakherkenning corrigeren, samenvatten,
  formuleren in de stijl van de bestaande logboeken, twijfels benoemen.
- **De bridge** doet bestanden: openen, entry invoegen, kopgegevens bijwerken,
  back-up maken, opslaan.

Claude komt dus nooit zelf aan een bestand. Nieuwe alinea's krijgen letterlijk
de opmaakeigenschappen van een bestaande alinea van hetzelfde soort uit
hetzelfde document, en alle onderdelen die niet veranderen worden byte voor
byte overgenomen. Daardoor blijft de opmaak precies zoals Word hem had staan.

## Wat je ermee doet

**Loggen.** Kies een project, spreek in wat er gebeurd is ("vandaag bij jan
geweest ongeveer drie uur testbank opgebouwd..."), en je krijgt een voorstel
terug in de vorm van een echte logboek-entry: kop met datum, korte tekst,
actiepunten per persoon. Claude telt gewerkte uren op bij de kopgegevens en
zegt het als hij ergens over twijfelt — die vragen kun je beantwoorden en het
voorstel opnieuw laten maken. Pas als je op **Opslaan** drukt gaat er iets naar
het document.

Onder het invoerveld staat het logboek zelf, ingeklapt: je ziet de datum en de
kop van elke entry, en tikken vouwt er precies één open. Het voorstel waar je
op dat moment aan werkt staat er los boven en blijft wél open staan.

**Vragen.** Stel vragen over het project ("wat staat er nog open?", "wat was er
afgesproken over de levertijd?"). Antwoorden komen alleen uit het
projectdocument zelf, met vermelding van de entry waar ze vandaan komen. Laat
ze desgewenst hardop voorlezen.

---

## Installeren

### 1. De bridge op je pc

Nodig: [Node.js 18 of nieuwer](https://nodejs.org) en Claude Code, ingelogd met
je eigen account (`claude` in een terminal moet werken).

```
git clone https://github.com/imetech-engineering/projectdoc-pwa.git
cd projectdoc-pwa/bridge
copy config.example.json config.json      (Windows)
cp   config.example.json config.json      (macOS/Linux)
```

Vul `config.json` in:

| Veld | Wat erin hoort |
|---|---|
| `token` | Een lang, willekeurig wachtwoord dat je straks ook in de app invult |
| `projectenMap` | De OneDrive-map met je projecten. Submappen tot vijf niveaus diep worden meegenomen; mappen die `Archief` heten en bestanden met `backup` of `kopie` in de naam worden overgeslagen |
| `schrijver` | Jouw naam en bedrijf — Claude schrijft de entries in jouw stijl en noemt je zo |
| `initialen` | Voor actielijsten, bijv. `IM` wordt "Acties IM" |
| `model` | `opus` (beste kwaliteit) of `sonnet` (sneller, minder verbruik van je abonnement) |
| `claudeCommando` | Alleen invullen als de bridge Claude Code niet zelf vindt. Het volledige pad; opvragen met `Get-Command claude \| Select-Object -ExpandProperty Source` |
| `origins` | Vanaf welke webadressen de app mag verbinden |
| `mail` | Meelezen in je eigen Outlook; standaard uit. Zie hieronder |

Een token maken:

```
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Starten:

```
node server.js
```

of dubbelklik op `start-bridge.bat` — die start hem opnieuw als hij onverhoopt
stopt.

Automatisch meestarten met Windows:

```
.\install-autostart.ps1
```

Dat maakt een geplande taak die bij het inloggen begint en zonder venster
draait. Wat de bridge te melden heeft komt in
`%LOCALAPPDATA%\projectdoc-bridge\bridge.log` — bewust buiten de projectmap,
want die staat vaak in OneDrive en een bestand dat continu herschreven wordt
synchroniseert daar niet betrouwbaar. Beheerdersrechten
zijn niet nodig. Weghalen kan met `.\uninstall-autostart.ps1`.

Na een `git pull` herstart je de bridge met:

```
powershell -ExecutionPolicy Bypass -File .\herstart.ps1
```

Dat stopt de taak, ruimt achtergebleven node-processen op — die houden anders
de poort bezet waardoor de nieuwe versie niet start — en laat daarna de laatste
regels van `bridge.log` zien, inclusief de versie en de gevonden projecten.

Waarom bij het inloggen en niet bij het opstarten: Claude Code gebruikt de
inloggegevens uit je gebruikersprofiel, en daar kan een dienst zonder
aangemeld account niet bij. Logt je pc automatisch in na een herstart, dan komt
het op hetzelfde neer.

Controleren of het docx-werk klopt, zonder internet of Claude:

```
node test/test.js
```

Welke bestanden meetellen: alles dat `Project <naam>.docx` of `Project_<naam>.docx`
heet. Kopieën (`... - kopie.docx`, `..._backup_260831.docx`) en de inhoud van
`Archief`-mappen blijven buiten de lijst, zodat je niet per ongeluk in een oude
versie schrijft.

### 1b. Mail meelezen (optioneel)

Staat dit aan, dan zoekt de bridge bij elk voorstel en elke vraag in je eigen
postvak naar berichten die bij het project horen — op het mailadres van de
contactpersoon uit de kop-tabel en op de project- of bedrijfsnaam. Die gaan als
context mee, zodat "zie ook de mail van vanochtend" genoeg is en namen en
bedragen uit de mail correct worden overgenomen. In de app zie je onder het
voorstel welke berichten erbij gepakt zijn.

Alleen lezen, alleen jouw postvak. Nooit versturen, wijzigen of verwijderen.

Eenmalig in Azure, onder **App-registraties → Nieuwe registratie**:

1. **Verificatie** → *Openbare clientstromen toestaan* op **Ja**.
2. **API-machtigingen** → Microsoft Graph → gedelegeerd: `Mail.Read`,
   `offline_access`, `User.Read`. Daarna beheerderstoestemming verlenen.
3. **Overzicht** → neem de *toepassings-id (client)* en de *map-id (tenant)* over.

Dan op je pc, in de map `bridge`:

```
powershell -ExecutionPolicy Bypass -File .\zet-mail.ps1 -ClientId <toepassings-id> -TenantId <map-id>
node koppel-mail.js
```

Het eerste script zet het `mail`-blok op de juiste plek in `config.json` — met
de hand plakken gaat mis, want JSON vergeeft een vergeten komma niet. Met
`-Uit` zet je het meelezen later weer uit zonder de id's kwijt te raken.

Dat toont een code; je logt in op een ander scherm en daarna onthoudt de bridge
de verbinding. Er komt geen wachtwoord in een bestand — alleen een
vernieuwingstoken in `mail-token.json`, dat niet in git staat en dat je op elk
moment kunt intrekken via je Microsoft-account (Beveiliging → Apps met
toegang). Bewaar dat bestand net zo zorgvuldig als je e-mail zelf: wie het
heeft, kan je mail lezen tot je de toegang intrekt.

Gaat het ophalen van mail een keer mis, dan gaat het voorstel gewoon door
zonder — met een melding in de app.

### 2. De bridge bereikbaar maken vanaf je telefoon

De bridge luistert standaard alleen op de pc zelf. Om er veilig vanaf je
telefoon bij te kunnen heb je een **https-adres** nodig (een gewoon
`http://192.168.x.x` weigert de browser, omdat de app zelf via https draait).

**Aanbevolen: Tailscale.** Gratis, geen domeinnaam nodig, en de bridge blijft
onbereikbaar voor de rest van het internet — alleen jouw eigen apparaten komen
erbij.

1. Installeer Tailscale op de pc en op je telefoon, log op beide in.
2. Op de pc:
   ```
   tailscale serve --bg 8787
   ```
3. `tailscale serve status` toont het adres, iets als
   `https://mijn-pc.jouw-tailnet.ts.net`. Dat vul je in de app in.

**Alternatief: Cloudflare Tunnel.** Nodig als je een eigen domein op Cloudflare
hebt en het adres ook buiten je eigen apparaten wilt kunnen gebruiken.

```
cloudflared tunnel login
cloudflared tunnel create projectdoc
cloudflared tunnel route dns projectdoc projectdoc.jouwdomein.nl
cloudflared tunnel run --url http://127.0.0.1:8787 projectdoc
```

Bij een publiek adres is het token het enige dat je beschermt: maak hem lang en
deel hem niet.

### 3. De app op je telefoon

Open `https://imetech-engineering.github.io/projectdoc-pwa/`, ga naar
**Instellingen**, vul het adres en het token in en druk op **Verbinding
testen**. Die controleert eerst de bridge en daarna of Claude reageert.

Voeg de app daarna toe aan je startscherm (de app biedt het zelf aan, of via
het browsermenu → *Toevoegen aan startscherm*).

Inspreken werkt het best in **Chrome op Android**. Let op: de spraakherkenning
van de browser stuurt audio naar Google — dat is de enige manier die daar
beschikbaar is. Voorlezen gebeurt volledig op het toestel zelf.

---

## Veiligheid

- Het token staat in `config.json` (niet in git) en in de opslag van je
  browser. Verder nergens.
- De bridge accepteert alleen verzoeken met het juiste token en alleen vanaf de
  adressen in `origins`.
- Vóór elke wijziging gaat er een kopie van het document naar
  `<projectenmap>/_backups`. De laatste 40 blijven bewaard.
- De bridge draait Claude zonder toegang tot je bestanden: alles wat Claude
  ziet, staat in de prompt, en wat Claude teruggeeft is tekst.

## Onderdelen

```
pwa/                 de app (GitHub Pages)
  js/app.js          schermen en gebruikersinteractie
  js/bridge.js       verbinding met de pc
  js/spraak.js       inspreken en voorlezen
  js/opslag.js       instellingen, concepten en gesprekken op het toestel
bridge/
  server.js          de webserver op je pc
  lib/docx.js        lezen en bewerken van Project_*.docx
  lib/zip.js         zip-lezer/schrijver zonder externe pakketten
  lib/claude.js      aanroepen van Claude Code
  lib/prompts.js     de instructies en de stijlregels van het logboek
  lib/graph.js       inloggen bij Microsoft (apparaatcode) en Graph bevragen
  lib/mail.js        berichten zoeken die bij een project horen
  koppel-mail.js     eenmalig je Outlook koppelen
  zet-mail.ps1       het mail-blok in config.json zetten
  test/test.js       zelftest van het docx-werk
  install-autostart.ps1  meestarten met Windows aan/uit zetten
```

De stijlregels van het logboek staan in `bridge/lib/prompts.js`. Klopt er iets
niet aan de toon of de opbouw van de entries, dan is dat de plek om het bij te
schaven.
