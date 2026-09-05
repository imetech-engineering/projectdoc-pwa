# IMeTech Projectdocumentatie

Projectlogboeken bijwerken en raadplegen vanaf de telefoon — met spraak, in
natuurlijke taal, rechtstreeks in de bestaande `Project_[Naam].docx` bestanden
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
| `projectenMap` | De OneDrive-map waar je `Project_*.docx` bestanden staan (submappen worden meegenomen) |
| `model` | `opus` (beste kwaliteit) of `sonnet` (sneller, minder verbruik van je abonnement) |
| `claudeCommando` | Alleen invullen als `claude` niet in je PATH staat |
| `origins` | Vanaf welke webadressen de app mag verbinden |

Een token maken:

```
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Starten:

```
node server.js
```

of dubbelklik op `start-bridge.bat` — die start hem opnieuw als hij onverhoopt
stopt. Wil je dat hij vanzelf meestart met Windows: maak een snelkoppeling naar
`start-bridge.bat` in `shell:startup`.

Controleren of het docx-werk klopt, zonder internet of Claude:

```
node test/test.js
```

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
  test/test.js       zelftest van het docx-werk
```

De stijlregels van het logboek staan in `bridge/lib/prompts.js`. Klopt er iets
niet aan de toon of de opbouw van de entries, dan is dat de plek om het bij te
schaven.
