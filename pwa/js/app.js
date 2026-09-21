/**
 * Projectdocumentatie-app.
 *
 * Twee dingen kun je hier doen: een logboek-entry laten maken uit losse
 * notities, en vragen stellen over een project. Het echte werk gebeurt op de
 * pc thuis; deze app is de bediening.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    projecten: [],
    project: null,
    projectInfo: null,
    entries: [],
    voorstel: null,
    headerAan: [],
    gesprek: [],
    openEntry: null,
    bezig: false,
    dicteerDoel: null,
    bridgeVersie: null,
    claudeInfo: null,
    wachtOpPc: false,
    geld: null,
    filter: "alles",
    kiezerDoel: null,
  };

  /* ------------------------------------------------------------ hulpjes */

  let toastKlok = null;
  /**
   * Een kort bericht onderin. Met `actie` ({ label, doe }) komt er een knop bij
   * te staan; die krijgt wat langer de tijd, want er moet nog op gedrukt worden.
   */
  function toast(tekst, isFout, actie) {
    const el = $("toast");
    const knop = $("toast-actie");
    $("toast-tekst").textContent = tekst;
    knop.textContent = actie ? actie.label : "";
    knop.classList.toggle("hidden", !actie);
    knop.onclick = actie
      ? () => {
          clearTimeout(toastKlok);
          el.classList.add("hidden");
          actie.doe();
        }
      : null;
    el.classList.toggle("fout", !!isFout);
    el.classList.remove("hidden");
    clearTimeout(toastKlok);
    toastKlok = setTimeout(() => el.classList.add("hidden"), actie ? 12000 : isFout ? 6000 : 3200);
  }

  function zetStatus(tekst, soort) {
    const el = $("status-regel");
    el.textContent = tekst;
    el.className = "sub" + (soort ? " " + soort : "");
  }

  function bezig(aan, tekst) {
    state.bezig = aan;
    const kaart = $("bezig-kaart");
    if (kaart) {
      kaart.classList.toggle("hidden", !aan);
      if (aan) $("bezig-tekst").textContent = tekst || "Bezig…";
    }
    document.querySelectorAll("button.btn-primary").forEach((b) => {
      if (b.dataset.altijdAan !== "1") b.disabled = aan;
    });
    if (aan) zetStatus(tekst || "Bezig…", "bezig");
    else toonVerbindingsstatus();
  }

  function fout(e) {
    toast(e.message || String(e), true);
    zetStatus(e.message || "Er ging iets mis", "fout");
  }

  /** Kort trillinkje als bevestiging; niet elk toestel kan het, dat geeft niet. */
  function haptic(patroon) {
    if (!navigator.vibrate) return;
    try {
      navigator.vibrate(patroon);
    } catch (_) {}
  }

  /* -------------------------------------------------------------- thema */

  function pasThemaToe() {
    const keuze = Opslag.instellingen().thema;
    const donker =
      keuze === "donker" ||
      (keuze === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = donker ? "dark" : "light";
    $("meta-theme-color").setAttribute("content", donker ? "#1c1c1a" : "#2563EB");
    $("header-logo").src = donker ? "branding/logo-wit.png" : "branding/logo-zwart.png";
  }

  /* --------------------------------------------------------------- tabs */

  function naarTab(naam) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("actief", t.dataset.tab === naam));
    ["loggen", "vragen", "instellingen"].forEach((n) =>
      $("panel-" + n).classList.toggle("hidden", n !== naam)
    );
    if (naam === "vragen") tekenGesprek();
  }

  /* ---------------------------------------------------------- projecten */

  let oudeBridgeGemeld = false;
  async function laadProjecten(ververs) {
    // Meteen ook de versie van de bridge ophalen: zo zie je in één oogopslag
    // of beide helften bijgewerkt zijn.
    Bridge.status()
      .then((st) => {
        state.bridgeVersie = st.versie;
        state.claudeInfo = st.claude;
        toonVersies();
        toonMailStatus(st.mail);
        if (bridgeLooptAchter() && !oudeBridgeGemeld) {
          oudeBridgeGemeld = true;
          toast(`De bridge op je pc is versie ${st.versie} — herstart hem even, de app verwacht ${window.PDOC_CONFIG.minimaleBridge}.`, true);
        }
      })
      .catch(() => {});
    const data = await Bridge.projecten(ververs);
    state.projecten = data.projecten || [];
    vulSjabloonKeuze();
    return state.projecten;
  }

  function tekenKiezer() {
    const zoek = $("kiezer-zoek").value.trim().toLowerCase();
    const lijst = $("kiezer-lijst");
    lijst.innerHTML = "";
    const treffers = state.projecten.filter((p) => !zoek || p.naam.toLowerCase().includes(zoek));
    if (state.kiezerDoel) {
      const opties = [["-", "Geen project", "Hoort nergens bij, bijv. een afgewezen offerte"]];
      if (state.kiezerDoel.handmatig) opties.push([null, "Automatisch", "De bridge kiest weer zelf op basis van klant en nummer"]);
      for (const [waarde, titel, uitleg] of opties) {
        const knop = document.createElement("button");
        knop.type = "button";
        knop.className = "kiezer-item kiezer-bijzonder";
        knop.innerHTML = `<strong>${esc(titel)}</strong><span>${esc(uitleg)}</span>`;
        knop.addEventListener("click", () => koppelVanuitKiezer(waarde));
        lijst.appendChild(knop);
      }
    }
    if (!treffers.length) {
      lijst.insertAdjacentHTML("beforeend", `<p class="hint">${
        state.projecten.length ? "Geen project met die naam." : "Geen projecten gevonden in de map op je pc."
      }</p>`);
      return;
    }
    for (const p of treffers) {
      const knop = document.createElement("button");
      knop.type = "button";
      knop.className = "kiezer-item" + (p.naam === state.project ? " actief" : "");
      knop.innerHTML = `<strong></strong><span></span>`;
      knop.querySelector("strong").textContent = p.naam;
      // De map erbij: twee projecten kunnen dezelfde naam hebben in verschillende
      // klantmappen, en dan wil je zien welke je kiest.
      knop.querySelector("span").textContent = [p.map, "bijgewerkt " + datumKort(p.gewijzigd)]
        .filter(Boolean)
        .join(" · ");
      knop.addEventListener("click", () => {
        if (state.kiezerDoel) return koppelVanuitKiezer(p.naam);
        kiesProject(p.naam);
        sluitOverlay("kiezer");
      });
      lijst.appendChild(knop);
    }
  }

  function datumKort(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "onbekend";
    const dagen = Math.floor((Date.now() - d) / 86400000);
    if (dagen === 0) return "vandaag";
    if (dagen === 1) return "gisteren";
    if (dagen < 30) return `${dagen} dagen geleden`;
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
  }

  async function kiesProject(naam) {
    // Wat je nog niet verstuurd had, hoort bij het project dat je verlaat.
    if (state.project) Opslag.zetConcept(state.project, $("notities").value);
    state.project = naam;
    state.projectInfo = null;
    state.voorstel = null;
    Opslag.zetLaatsteProject(naam);
    $("project-naam").textContent = naam || "Kies een project";
    state.openEntry = null;
    // Alleen de kaart opruimen: het voorstel dat bij dít project bewaard is
    // moet blijven staan, dat lezen we hieronder juist terug.
    sluitVoorstelKaart();
    $("opslag-bevestiging").classList.add("hidden");

    const concept = Opslag.concept(naam);
    $("notities").value = concept;
    pasHoogteAan();
    $("concept-hint").classList.toggle("hidden", !concept);
    if (concept) $("concept-hint").textContent = "Onopgeslagen notities van eerder teruggezet.";

    state.gesprek = Opslag.gesprek(naam);
    tekenGesprek();
    state.entries = [];
    state.geld = null;
    tekenOfferteKnop();
    tekenLogboek();

    state.voorstel = Opslag.voorstel(naam);
    if (state.voorstel) {
      state.headerAan = (state.voorstel.headerWijzigingen || []).map(() => true);
      tekenVoorstel();
    }

    try {
      laadGeld(naam);
      state.projectInfo = await Bridge.project(naam);
      state.entries = state.projectInfo.entries || [];
      tekenLogboek();
      toonVerbindingsstatus();
      haalLopendVoorstel();
    } catch (e) {
      fout(e);
    }
  }

  /**
   * Een voorstel dat op de pc gemaakt is terwijl de app dicht was.
   *
   * Een telefoon sluit de app af zodra je hem wegklikt; het antwoord onderweg
   * is dan weg, terwijl Claude op de pc gewoon doorwerkt. Bij terugkomst vragen
   * we daarom of er nog iets klaarstaat, in plaats van je opnieuw te laten
   * wachten op werk dat al gedaan is.
   */
  let volgKlok = null;
  async function haalLopendVoorstel() {
    clearTimeout(volgKlok);
    // Wel stoppen als de app zélf net iets aan het doen is, maar niet als we
    // alleen op de pc staan te wachten — dan moeten we juist blijven kijken.
    if (!state.project) return;
    if (state.bezig && !state.wachtOpPc) return;
    let uit;
    try {
      uit = await Bridge.laatsteVoorstel(state.project);
    } catch (_) {
      return;
    }
    if (uit.bezig) {
      state.wachtOpPc = true;
      bezig(true, "Je pc is nog bezig met het voorstel…");
      volgKlok = setTimeout(haalLopendVoorstel, 4000);
      return;
    }
    if (state.wachtOpPc) {
      state.wachtOpPc = false;
      bezig(false);
    }
    // Weggegooid of al opgeslagen: de bridge houdt zijn kopie een half uur
    // vast, en die hoort niet opnieuw in beeld te komen.
    const afgehandeld = Opslag.afgehandeldVoorstel(state.project);
    if (uit.foutmelding && !state.voorstel) {
      const kenmerk = uit.voorstelId || "fout:" + vingerafdruk(uit.foutmelding);
      if (kenmerk === afgehandeld) return;
      toast(uit.foutmelding, true);
      vergeetVoorstel(state.project, kenmerk);
      return;
    }
    if (uit.resultaat && voorstelKenmerk(uit.resultaat) === afgehandeld) return;
    // Staat er al een voorstel in beeld, dan blijft dat staan: dat is waar je
    // net naar zat te kijken.
    if (!uit.resultaat || state.voorstel) return;
    state.voorstel = uit.resultaat;
    state.headerAan = (uit.resultaat.headerWijzigingen || []).map(() => true);
    Opslag.zetVoorstel(state.project, uit.resultaat);
    tekenVoorstel();
    toast("Voorstel opgehaald dat je pc had klaargezet.");
  }

  function toonInfo() {
    if (!state.projectInfo) {
      toast("Nog geen projectgegevens geladen.");
      return;
    }
    const info = state.projectInfo;
    $("info-titel").textContent = info.naam;
    const delen = [];
    for (const v of info.header || []) {
      delen.push(
        `<div class="info-rij"><span class="il">${esc(v.label)}</span><span class="iv">${esc(v.waarde)}</span></div>`
      );
    }
    delen.push(`<p class="hint">${(info.entries || []).length} entries in het logboek.</p>`);
    delen.push(`<p class="hint">Bestand: ${esc(info.bestand)}${info.map ? ` (map: ${esc(info.map)})` : ""}</p>`);
    $("info-inhoud").innerHTML = delen.join("");
    openOverlay("infoblad");
  }

  function tekenLogboek() {
    const el = $("logboek");
    if (!el) return;
    if (!state.project) {
      el.innerHTML = '<p class="logboek-leeg">Kies eerst een project bovenaan.</p>';
      return;
    }
    const heeftGeld = geldItems().length > 0;
    const filter = heeftGeld ? state.filter : "logboek";
    const filterBalk = heeftGeld
      ? `<div class="tijdlijn-filter" role="tablist" aria-label="Wat laten zien">${[
          ["alles", "Alles"],
          ["logboek", "Logboek"],
          ["geld", "Offertes & facturen"],
        ]
          .map(
            ([f, t]) =>
              `<button type="button" role="tab" data-filter="${f}" aria-selected="${filter === f}" class="${filter === f ? "actief" : ""}">${t}</button>`
          )
          .join("")}</div>`
      : "";
    const items = tijdlijn(filter);
    if (!items.length) {
      el.innerHTML =
        filterBalk +
        (filter === "geld"
          ? '<p class="logboek-leeg">Geen offertes of facturen bij dit project.</p>'
          : '<p class="logboek-leeg">Nog geen entries in dit logboek.<br />Spreek hieronder in wat er gebeurd is.</p>');
    } else {
      el.innerHTML = filterBalk + items.map((it) => (it.entry ? entryHtml(it.entry) : geldRegelHtml(it))).join("");
    }
    el.querySelectorAll("details.logboek-entry").forEach((blok) =>
      blok.addEventListener("toggle", () => vouwEntry(el, blok))
    );
    el.querySelectorAll("[data-filter]").forEach((knop) =>
      knop.addEventListener("click", () => {
        state.filter = knop.dataset.filter;
        Opslag.zetFilter(state.filter);
        tekenLogboek();
      })
    );
    el.querySelectorAll("[data-geld]").forEach((knop) =>
      knop.addEventListener("click", () => openGeldblad(knop.dataset.geld))
    );
  }

  /** Logboek en geld door elkaar, op datum; de volgorde van het document blijft leidend. */
  function tijdlijn(filter) {
    const entries = filter === "geld" ? [] : state.entries.map((entry) => ({ entry, datum: entry.datum }));
    const geld = filter === "logboek" ? [] : geldItems();
    const uit = [];
    let g = 0;
    for (const e of entries) {
      while (g < geld.length && geld[g].datum > e.datum) uit.push(geld[g++]);
      uit.push(e);
    }
    return uit.concat(geld.slice(g));
  }

  /**
   * Eén entry tegelijk open: een logboek van dertig entries is anders een lap
   * tekst waarin je alleen nog kunt scrollen.
   */
  function vouwEntry(lijst, blok) {
    if (!blok.open) {
      if (state.openEntry === blok.dataset.sleutel) state.openEntry = null;
      return;
    }
    state.openEntry = blok.dataset.sleutel;
    lijst.querySelectorAll("details.logboek-entry[open]").forEach((ander) => {
      if (ander !== blok) ander.open = false;
    });
    // Sluit er iets boven je dicht, dan schuift deze entry mee omhoog; even
    // terugbrengen in beeld scheelt zoeken.
    blok.scrollIntoView({ block: "nearest" });
  }

  const entrySleutel = (entry) => `${entry.datum}|${entry.kop}`;

  function entryHtml(entry) {
    const delen = [];
    let punten = [];
    const spoelPunten = () => {
      if (!punten.length) return;
      delen.push("<ul>" + punten.map((p) => `<li>${esc(p)}</li>`).join("") + "</ul>");
      punten = [];
    };
    for (const blok of entry.blokken || []) {
      if (blok.soort === "punt") {
        punten.push(blok.tekst);
        continue;
      }
      spoelPunten();
      delen.push(
        blok.soort === "kop"
          ? `<p class="sectiekop">${esc(blok.tekst)}</p>`
          : `<p>${esc(blok.tekst)}</p>`
      );
    }
    spoelPunten();
    const sleutel = entrySleutel(entry);
    return (
      `<details class="logboek-entry" data-sleutel="${esc(sleutel)}"${state.openEntry === sleutel ? " open" : ""}>` +
      `<summary><span class="datum">${esc(entry.datum)}</span><span class="entry-kop">${esc(entry.kop)}</span>` +
      `<svg class="ic entry-chevron" aria-hidden="true"><use href="#ic-chevron"></use></svg></summary>` +
      `<div class="entry-inhoud">${delen.join("")}</div></details>`
    );
  }

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /* -------------------------------------------------- offertes en facturen */

  const jjmmdd = (iso) => String(iso || "").replace(/^\d{2}(\d{2})-(\d{2})-(\d{2}).*$/, "$1$2$3");
  const dagenGeleden = (iso) => Math.floor((Date.now() - new Date(iso + "T12:00:00")) / 86400000);

  function euro(n, altijdCenten) {
    if (n == null || !isFinite(n)) return "";
    const heel = Math.abs(n - Math.round(n)) < 0.005;
    return (
      "€ " +
      Number(n).toLocaleString("nl-NL", {
        minimumFractionDigits: heel && !altijdCenten ? 0 : 2,
        maximumFractionDigits: heel && !altijdCenten ? 0 : 2,
      })
    );
  }

  function datumNl(iso) {
    const d = new Date(iso + "T12:00:00");
    return isNaN(d) ? "" : d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
  }

  const STATUS = {
    open: "Open",
    loopt: "Loopt",
    doorlopend: "Doorlopend",
    afgerond: "Afgerond",
    vervallen: "Vervallen",
    vervangen: "Vervangen",
  };
  const isLopend = (o) => o.status === "open" || o.status === "loopt";
  const isKlaar = (o) => ["afgerond", "vervallen", "vervangen"].includes(o.status);

  /** Omschrijving zonder wat je toch al weet: projectnummer en projectnaam. */
  function kort(tekst, reserve) {
    const naam = String(state.project || "").toLowerCase();
    let t = String(tekst || "").replace(/^\d{4}\s+/, "").trim();
    if (naam && t.toLowerCase().startsWith(naam)) t = t.slice(naam.length);
    t = t.replace(/^[\s,.:;\-–(]+|[\s,.;)]+$/g, "").trim();
    return t || reserve || "";
  }
  const offerteTitel = (o) => kort(o.onderwerp, "") || kort(o.referentie, "") || o.onderwerp || "Offerte";

  function factuurPil(f) {
    if (f.betaald) return `<span class="pil goed"${f.betaaldOp ? ` title="Betaald op ${esc(datumNl(f.betaaldOp))}"` : ""}>Betaald</span>`;
    const d = dagenGeleden(f.datum);
    return d > 30
      ? `<span class="pil fout">Open · ${d} d</span>`
      : '<span class="pil let-op">Open</span>';
  }

  async function laadGeld(naam) {
    try {
      const geld = await Bridge.geld(naam);
      if (state.project !== naam) return;
      state.geld = geld;
    } catch (_) {
      // Oudere bridge of bestanden even niet bereikbaar: dan gewoon zonder.
      if (state.project === naam) state.geld = null;
    }
    tekenOfferteKnop();
    tekenLogboek();
    if (!$("geldblad").classList.contains("hidden")) tekenGeldblad();
  }

  function geldItems() {
    if (!state.geld) return [];
    const uit = [
      ...(state.geld.offertes || []).map((o) => ({ soort: "offerte", datum: jjmmdd(o.datum), o })),
      ...(state.geld.facturen || []).map((f) => ({ soort: "factuur", datum: jjmmdd(f.datum), f })),
    ];
    return uit.sort((a, b) => b.datum.localeCompare(a.datum) || (a.soort === "factuur" ? -1 : 1));
  }

  function geldRegelHtml(it) {
    if (it.soort === "offerte") {
      const o = it.o;
      return (
        `<button type="button" class="geld-regel offerte" data-geld="${esc(o.nummer)}">` +
        `<svg class="ic geld-ic" aria-hidden="true"><use href="#ic-offerte"></use></svg>` +
        `<span class="datum">${esc(it.datum)}</span>` +
        `<span class="geld-tekst"><strong>${esc(o.nummer)}</strong> ${esc(offerteTitel(o))}</span>` +
        `<span class="geld-rechts"><span class="geld-bedrag">${euro(o.totaalExcl)}</span><span class="pil ${o.status}">${STATUS[o.status]}</span></span>` +
        `</button>`
      );
    }
    const f = it.f;
    return (
      `<button type="button" class="geld-regel factuur" data-geld="${esc(f.nummer)}">` +
      `<span class="geld-ic euro" aria-hidden="true">€</span>` +
      `<span class="datum">${esc(it.datum)}</span>` +
      `<span class="geld-tekst"><strong>${esc(f.nummer)}</strong> ${esc(kort(f.omschrijving, "Factuur"))}</span>` +
      `<span class="geld-rechts"><span class="geld-bedrag">${euro(f.netto)}</span>${factuurPil(f)}</span>` +
      `</button>`
    );
  }

  /** De knop bovenin: in één blik welke offerte er loopt. */
  function tekenOfferteKnop() {
    const knop = $("btn-offerte");
    const g = state.geld;
    const offertes = (g && g.offertes) || [];
    const facturen = (g && g.facturen) || [];
    if (!state.project || (!offertes.length && !facturen.length)) {
      knop.classList.add("hidden");
      return;
    }
    const lopend = offertes.filter(isLopend);
    const doorlopend = offertes.filter((o) => o.status === "doorlopend");
    let label, waarde, soort, extra;
    if (lopend.length === 1) {
      const o = lopend[0];
      label = STATUS[o.status];
      waarde = [o.nummer, euro(o.totaalExcl)].filter(Boolean).join(" · ");
      extra = o.gefactureerd && o.totaalExcl ? `${Math.round((o.gefactureerd / o.totaalExcl) * 100)}% gefactureerd` : offerteTitel(o);
      soort = o.status;
    } else if (lopend.length > 1) {
      label = `${lopend.length} lopend`;
      waarde = lopend.map((o) => o.nummer).join(", ");
      extra = euro(lopend.reduce((t, o) => t + (o.totaalExcl || 0), 0));
      soort = "open";
    } else if (doorlopend.length) {
      const o = doorlopend[0];
      label = "Doorlopend";
      waarde = doorlopend.map((x) => x.nummer).join(", ");
      extra = o.gefactureerd ? `${euro(doorlopend.reduce((t, x) => t + (x.gefactureerd || 0), 0))} gefactureerd` : offerteTitel(o);
      soort = "doorlopend";
    } else if (offertes.length) {
      label = "Offertes";
      waarde = "Alles afgerond";
      soort = "afgerond";
    } else {
      const open = facturen.filter((f) => !f.betaald).length;
      label = "Facturen";
      waarde = open ? `${open} open` : `${facturen.length} betaald`;
      soort = open ? "open" : "afgerond";
    }
    $("offerte-label").textContent = label;
    $("offerte-waarde").textContent = waarde;
    $("offerte-extra").textContent = extra || "";
    knop.className = `offerte-knop ${soort}`;
    knop.setAttribute("aria-label", `${label}: ${waarde}`);
  }

  let geldFocus = null;
  function openGeldblad(focus) {
    if (!state.geld) {
      toast("Offertes en facturen zijn nog niet geladen.");
      return;
    }
    geldFocus = focus || null;
    if ($("geldblad").classList.contains("hidden")) $("geld-inhoud").innerHTML = "";
    tekenGeldblad();
    openOverlay("geldblad");
    const doel = geldFocus && document.getElementById("gb-" + geldFocus);
    if (doel) {
      const afgerond = doel.closest("details.gb-afgerond");
      if (afgerond) afgerond.open = true;
      doel.classList.add("focus");
      doel.scrollIntoView({ block: "center" });
      setTimeout(() => doel.classList.remove("focus"), 1600);
    } else {
      $("geld-inhoud").scrollTop = 0;
    }
  }

  const iconKnop = (actie, soort, nr, icoon, label) =>
    `<button type="button" class="btn-mini" data-actie="${actie}" data-soort="${soort}" data-nr="${esc(nr)}" aria-label="${esc(label)}" title="${esc(label)}"><svg class="ic" aria-hidden="true"><use href="#${icoon}"></use></svg></button>`;

  function factuurRijHtml(f) {
    return (
      `<div class="gb-factuur" id="gb-${esc(f.nummer)}">` +
      `<div class="gb-f-tekst"><strong>${esc(f.nummer)}</strong> ${esc(kort(f.omschrijving, ""))}` +
      `<span class="gb-f-meta">${esc(datumNl(f.datum))} · ${euro(f.netto)} excl.</span></div>` +
      factuurPil(f) +
      (f.heeftBestand ? iconKnop("pdf", "factuur", f.nummer, "ic-offerte", "Factuur bekijken") : "") +
      iconKnop("koppel", "factuur", f.nummer, "ic-koppel", "Ander project") +
      `</div>`
    );
  }

  function offerteKaartHtml(o, facturen) {
    const eigen = facturen.filter((f) => f.offerte === o.nummer);
    const gef = o.gefactureerd
      ? `Gefactureerd ${euro(o.gefactureerd)}${o.totaalExcl ? ` van ${euro(o.totaalExcl)}` : ""} · `
      : "";
    const regels = (o.regels || []).length
      ? `<details class="gb-regels"><summary>${o.regels.length} ${o.regels.length === 1 ? "regel" : "regels"}</summary>${o.regels
          .map((r) => `<div class="gb-regel"><span>${esc(r.omschrijving)}</span><span>${euro(r.bedrag)}</span></div>`)
          .join("")}</details>`
      : "";
    const knoppen = [
      isKlaar(o)
        ? ""
        : `<button type="button" class="btn-primary btn-compact" data-actie="afronden" data-soort="offerte" data-nr="${esc(o.nummer)}">Afronden</button>`,
      `<label class="status-kies"><span class="sr">Status van ${esc(o.nummer)}</span><select data-status-nr="${esc(o.nummer)}">${[
        ["", "Automatisch"],
        ["open", "Open"],
        ["doorlopend", "Doorlopend"],
        ["afgerond", "Afgerond"],
        ["vervallen", "Vervallen"],
      ]
        .map(([w, t]) => `<option value="${w}"${(o.handmatig ? w === (o.status === "loopt" ? "open" : o.status) : w === "") ? " selected" : ""}>${t}</option>`)
        .join("")}</select></label>`,
      o.heeftPdf || o.heeftDocx ? iconKnop("pdf", "offerte", o.nummer, "ic-offerte", o.heeftPdf ? "Offerte bekijken" : "Word-bestand openen") : "",
      iconKnop("koppel", "offerte", o.nummer, "ic-koppel", "Ander project"),
    ].join("");
    return (
      `<div class="gb-kaart ${o.status}" id="gb-${esc(o.nummer)}">` +
      `<div class="gb-kop"><strong>${esc(o.nummer)}</strong><span class="pil ${o.status}">${STATUS[o.status]}</span>` +
      `<span class="gb-bedrag">${euro(o.totaalExcl)}${o.totaalExcl != null ? '<small> excl.</small>' : ""}</span></div>` +
      `<div class="gb-onderwerp">${esc(o.referentie && kort(o.onderwerp, "") === "" ? o.referentie : o.onderwerp || o.referentie || "Offerte")}</div>` +
      `<div class="gb-meta">${[datumNl(o.datum), o.klant, o.geldigheid ? `geldig ${o.geldigheid}` : ""].filter(Boolean).map(esc).join(" · ")}</div>` +
      `<div class="gb-reden">${gef}${
        o.vervangenDoor
          ? `Vervangen door <button type="button" class="link-knop" data-actie="naar" data-nr="${esc(o.vervangenDoor)}">${esc(o.vervangenDoor)}</button>`
          : esc(o.reden || "")
      }${o.handmatig ? ` · <button type="button" class="link-knop" data-actie="auto" data-soort="offerte" data-nr="${esc(o.nummer)}">weer automatisch</button>` : ""}</div>` +
      regels +
      (eigen.length ? `<div class="gb-facturen">${eigen.map(factuurRijHtml).join("")}</div>` : "") +
      `<div class="gb-knoppen">${knoppen}</div>` +
      `</div>`
    );
  }

  function tekenGeldblad() {
    const g = state.geld || { offertes: [], facturen: [], losseOffertes: [], losseFacturen: [] };
    // Wat je open had staan blijft open na een wijziging.
    const wasOpen = {};
    for (const d of $("geld-inhoud").querySelectorAll("details[data-vak]")) wasOpen[d.dataset.vak] = d.open;
    const openAttr = (vak, standaard) => ((vak in wasOpen ? wasOpen[vak] : standaard) ? " open" : "");
    const offertes = g.offertes || [];
    const facturen = g.facturen || [];
    $("geld-titel").textContent = state.project || "Offertes en facturen";
    const lopend = offertes.filter(isLopend);
    const doorlopend = offertes.filter((o) => o.status === "doorlopend");
    const klaar = offertes.filter(isKlaar);
    const los = facturen.filter((f) => !f.offerte);
    const openstaand = facturen.filter((f) => !f.betaald).reduce((t, f) => t + (f.netto || 0), 0);
    const delen = [];
    delen.push(
      `<div class="gb-tegels">` +
        `<div><span>Open offerte</span><strong>${euro(lopend.reduce((t, o) => t + Math.max(0, (o.totaalExcl || 0) - (o.gefactureerd || 0)), 0)) || "€ 0"}</strong></div>` +
        `<div><span>Gefactureerd</span><strong>${euro(facturen.reduce((t, f) => t + (f.netto || 0), 0)) || "€ 0"}</strong></div>` +
        `<div class="${openstaand > 0.5 ? "let-op" : ""}"><span>Te ontvangen</span><strong>${euro(openstaand) || "€ 0"}</strong></div>` +
        `</div>`
    );
    if (lopend.length) delen.push(`<h3 class="gb-sectie">Lopend</h3>` + lopend.map((o) => offerteKaartHtml(o, facturen)).join(""));
    if (doorlopend.length)
      delen.push(`<h3 class="gb-sectie">Doorlopend (regie)</h3>` + doorlopend.map((o) => offerteKaartHtml(o, facturen)).join(""));
    if (!offertes.length) delen.push('<p class="hint">Geen offerte gevonden bij dit project. Koppel er hieronder eentje als die er wel is.</p>');
    if (klaar.length)
      delen.push(
        `<details class="gb-afgerond" data-vak="afgerond"${openAttr("afgerond", !lopend.length && !doorlopend.length)}><summary>Afgerond en vervallen (${klaar.length})</summary>${klaar
          .map((o) => offerteKaartHtml(o, facturen))
          .join("")}</details>`
      );
    if (los.length)
      delen.push(`<h3 class="gb-sectie">Facturen zonder offerte</h3><div class="gb-kaart los">${los.map(factuurRijHtml).join("")}</div>`);
    const losO = g.losseOffertes || [];
    const losF = g.losseFacturen || [];
    if (losO.length || losF.length) {
      const rij = (soort, nr, titel, sub) =>
        `<div class="gb-los"><div class="gb-f-tekst"><strong>${esc(nr)}</strong> ${esc(titel)}<span class="gb-f-meta">${esc(sub)}</span></div>` +
        `<button type="button" class="btn-secondary btn-compact" data-actie="hier" data-soort="${soort}" data-nr="${esc(nr)}">Koppel</button></div>`;
      delen.push(
        `<details class="gb-toevoegen" data-vak="toevoegen"${openAttr("toevoegen", false)}><summary>Offerte of factuur koppelen</summary>` +
          (losO.length ? `<p class="gb-sub">Offertes zonder project</p>` + losO.map((o) => rij("offerte", o.nummer, o.onderwerp || o.klant, [datumNl(o.datum), o.klant, euro(o.totaalExcl)].filter(Boolean).join(" · "))).join("") : "") +
          (losF.length ? `<p class="gb-sub">Facturen zonder project</p>` + losF.map((f) => rij("factuur", f.nummer, f.omschrijving || f.klant, [datumNl(f.datum), f.klant, euro(f.netto)].filter(Boolean).join(" · "))).join("") : "") +
          `</details>`
      );
    }
    $("geld-inhoud").innerHTML = delen.join("");
  }

  function vindGeld(soort, nr) {
    const g = state.geld || {};
    return soort === "offerte"
      ? (g.offertes || []).find((o) => o.nummer === nr)
      : (g.facturen || []).find((f) => f.nummer === nr);
  }

  async function geldZet(wijziging, melding, terug) {
    const project = state.project;
    try {
      await Bridge.geldZet(wijziging);
    } catch (e) {
      fout(e);
      return;
    }
    haptic(15);
    await laadGeld(project);
    toast(melding, false, terug ? { label: "Ongedaan", doe: () => geldZet(terug, "Teruggezet.") } : null);
  }

  async function geldActie(knop) {
    const { actie, soort, nr } = knop.dataset;
    const item = vindGeld(soort, nr);
    const basis = { soort, nummer: nr };
    if (actie === "pdf") return openBestand(soort, nr, knop);
    if (actie === "naar") {
      const doel = document.getElementById("gb-" + nr);
      if (doel) {
        doel.scrollIntoView({ block: "center", behavior: "smooth" });
        doel.classList.add("focus");
        setTimeout(() => doel.classList.remove("focus"), 1600);
      }
      return;
    }
    if (actie === "afronden") {
      const terug = { ...basis, status: item && item.handmatig ? (item.status === "loopt" ? "open" : item.status) : null };
      try {
        await Bridge.geldZet({ ...basis, status: "afgerond" });
      } catch (e) {
        return fout(e);
      }
      haptic(15);
      const klaargezet = item ? zetAfrondEntry(item) : false;
      await laadGeld(state.project);
      if (klaargezet) sluitOverlay("geldblad");
      toast(
        klaargezet ? `${nr} afgerond. Logboek-entry staat klaar, tik op Opslaan.` : `${nr} afgerond.`,
        false,
        {
          label: "Ongedaan",
          doe: async () => {
            if (klaargezet && state.voorstel && state.voorstel.voorstelId === "lokaal-" + nr) gooiVoorstelWeg();
            await geldZet(terug, "Teruggezet.");
          },
        }
      );
      return;
    }
    if (actie === "heropen" || actie === "auto") {
      const vorige = item && item.handmatig ? item.status === "afgerond" : null;
      const nieuw = actie === "afronden" ? true : actie === "heropen" ? false : null;
      geldFocus = nr;
      return geldZet(
        { ...basis, afgerond: nieuw },
        actie === "afronden" ? `${nr} afgerond.` : actie === "heropen" ? `${nr} staat weer open.` : `${nr} volgt weer de facturen.`,
        { ...basis, afgerond: vorige }
      );
    }
    if (actie === "hier") {
      return geldZet({ ...basis, project: state.project }, `${nr} gekoppeld aan ${state.project}.`, { ...basis, project: null });
    }
    if (actie === "koppel") {
      state.kiezerDoel = { ...basis, handmatig: item && item.koppeling === "handmatig" };
      sluitOverlay("geldblad");
      $("kiezer-titel").textContent = `${nr} koppelen aan`;
      $("kiezer-zoek").value = "";
      tekenKiezer();
      openOverlay("kiezer");
    }
  }

  async function kiesStatus(select) {
    const nr = select.dataset.statusNr;
    const item = vindGeld("offerte", nr);
    const status = select.value || null;
    const terug = { soort: "offerte", nummer: nr, status: item && item.handmatig ? (item.status === "loopt" ? "open" : item.status) : null };
    geldFocus = nr;
    await geldZet(
      { soort: "offerte", nummer: nr, status },
      status ? `${nr} staat nu op ${STATUS[status].toLowerCase()}.` : `${nr} volgt weer de facturen en de urenadministratie.`,
      terug
    );
  }

  /**
   * Bij afronden een korte logboek-entry klaarzetten. Geen Claude nodig: de
   * gegevens liggen er al. Staat er al een voorstel open, dan laten we dat staan.
   */
  function zetAfrondEntry(o) {
    if (state.voorstel) return false;
    const nu = new Date();
    const kortNu = `${String(nu.getFullYear()).slice(2)}${String(nu.getMonth() + 1).padStart(2, "0")}${String(nu.getDate()).padStart(2, "0")}`;
    const facturen = ((state.geld && state.geld.facturen) || []).filter((f) => f.offerte === o.nummer);
    const onderwerp = offerteTitel(o);
    const gedekt = o.totaalExcl && o.gefactureerd >= o.totaalExcl * 0.98;
    const zin = [
      `Offerte ${o.nummer}${onderwerp ? ` (${onderwerp}` : ""}${o.totaalExcl ? `${onderwerp ? ", " : " ("}${euro(o.totaalExcl, true)} excl. btw)` : onderwerp ? ")" : ""} is afgerond.`,
      facturen.length
        ? `Gefactureerd ${euro(o.gefactureerd, true)} excl. btw via ${facturen.map((f) => `${f.nummer} (${f.betaald ? "betaald" : "nog open"})`).join(", ")}.`
        : "Er is niets op gefactureerd.",
    ].join(" ");
    const open = facturen.filter((f) => !f.betaald);
    state.voorstel = {
      voorstelId: "lokaal-" + o.nummer,
      project: state.project,
      entry: {
        kop: `${kortNu} Offerte ${o.nummer} afgerond${gedekt ? ", volledig gefactureerd" : ""}`,
        alineas: [zin],
        secties: open.length ? [{ kop: "Openstaand", punten: open.map((f) => `${f.nummer}: ${euro(f.netto, true)} excl. btw nog niet ontvangen`) }] : [],
      },
      headerWijzigingen: [],
    };
    state.headerAan = [];
    Opslag.zetVoorstel(state.project, state.voorstel);
    tekenVoorstel();
    naarTab("loggen");
    $("loggen-scroll").scrollTop = 0;
    return true;
  }

  async function koppelVanuitKiezer(naam) {
    const doel = state.kiezerDoel;
    state.kiezerDoel = null;
    sluitOverlay("kiezer");
    $("kiezer-titel").textContent = "Project kiezen";
    const terug = { soort: doel.soort, nummer: doel.nummer, project: doel.handmatig ? state.project : null };
    await geldZet(
      { soort: doel.soort, nummer: doel.nummer, project: naam },
      naam === "-" ? `${doel.nummer} hoort nu bij geen project.` : naam === null ? `${doel.nummer} wordt weer automatisch gekoppeld.` : `${doel.nummer} verplaatst naar ${naam}.`,
      terug
    );
    openGeldblad();
  }

  /* PDF bekijken in de app met pdf.js; alleen geladen als je een PDF opent. */
  const PDFJS_BRONNEN = [
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/",
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/",
  ];
  let pdfJsBelofte = null;
  function laadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfJsBelofte) return pdfJsBelofte;
    const probeer = (i) =>
      new Promise((ok, nee) => {
        if (i >= PDFJS_BRONNEN.length) return nee(new Error("De PDF-weergave kon niet laden. Staat internet aan?"));
        const sc = document.createElement("script");
        sc.src = PDFJS_BRONNEN[i] + "pdf.min.js";
        sc.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BRONNEN[i] + "pdf.worker.min.js";
          ok(window.pdfjsLib);
        };
        sc.onerror = () => {
          sc.remove();
          probeer(i + 1).then(ok, nee);
        };
        document.head.appendChild(sc);
      });
    pdfJsBelofte = probeer(0).catch((e) => {
      pdfJsBelofte = null;
      throw e;
    });
    return pdfJsBelofte;
  }

  const pdfStaat = { doc: null, zoom: 1, blob: null, naam: "", teken: 0 };

  async function tekenPdf() {
    const doel = $("pdf-paginas");
    const beurt = ++pdfStaat.teken;
    const breedte = Math.max(200, doel.clientWidth - 20) * pdfStaat.zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    $("pdf-zoom").textContent = Math.round(pdfStaat.zoom * 100) + "%";
    doel.innerHTML = "";
    for (let n = 1; n <= pdfStaat.doc.numPages; n++) {
      const pagina = await pdfStaat.doc.getPage(n);
      if (beurt !== pdfStaat.teken) return;
      const basis = pagina.getViewport({ scale: 1 });
      const schaal = breedte / basis.width;
      const vp = pagina.getViewport({ scale: schaal * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = Math.floor(breedte) + "px";
      canvas.style.height = Math.floor(basis.height * schaal) + "px";
      doel.appendChild(canvas);
      await pagina.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }
  }

  function zoomPdf(stap) {
    if (!pdfStaat.doc) return;
    const stappen = [1, 1.5, 2, 3];
    const i = Math.max(0, Math.min(stappen.length - 1, stappen.indexOf(pdfStaat.zoom) + stap));
    if (stappen[i] === pdfStaat.zoom) return;
    pdfStaat.zoom = stappen[i];
    tekenPdf();
  }

  function bewaarBlob(blob, naam) {
    const bestand = new File([blob], naam, { type: blob.type || "application/octet-stream" });
    if (navigator.canShare && navigator.canShare({ files: [bestand] })) {
      navigator.share({ files: [bestand], title: naam }).catch(() => {});
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = naam;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`${naam} staat in je downloads.`);
  }

  async function openBestand(soort, nr, knop) {
    if (knop) knop.disabled = true;
    try {
      const { blob, naam } = await Bridge.bestand(soort, nr);
      if (!/\.pdf$/i.test(naam) && blob.type !== "application/pdf") {
        // Alleen een Word-bestand: dat kan de telefoon zelf beter openen.
        bewaarBlob(blob, naam);
        return;
      }
      pdfStaat.blob = blob;
      pdfStaat.naam = naam;
      pdfStaat.zoom = 1;
      $("pdf-titel").textContent = naam.replace(/\.pdf$/i, "");
      $("pdf-paginas").innerHTML = '<p class="pdf-laden">Document laden…</p>';
      $("pdfblad").classList.remove("hidden");
      const lib = await laadPdfJs();
      pdfStaat.doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      await tekenPdf();
    } catch (e) {
      if (!$("pdfblad").classList.contains("hidden") && pdfStaat.blob) {
        $("pdf-paginas").innerHTML = `<p class="pdf-laden">${esc(e.message)}<br /><br /><button type="button" class="btn-secondary btn-compact" id="pdf-toch-bewaren">Opslaan of openen met een andere app</button></p>`;
        const k = $("pdf-toch-bewaren");
        if (k) k.addEventListener("click", () => bewaarBlob(pdfStaat.blob, pdfStaat.naam));
      } else fout(e);
    } finally {
      if (knop) knop.disabled = false;
    }
  }

  function sluitPdf() {
    $("pdfblad").classList.add("hidden");
    pdfStaat.teken++;
    if (pdfStaat.doc) pdfStaat.doc.destroy();
    pdfStaat.doc = null;
    pdfStaat.blob = null;
    $("pdf-paginas").innerHTML = "";
  }

  /* ----------------------------------------------------------- voorstel */

  /** Het invoerveld groeit mee met de tekst, tot de ingestelde maximumhoogte. */
  function pasHoogteAan() {
    const veld = $("notities");
    veld.style.height = "auto";
    veld.style.height = Math.min(veld.scrollHeight, window.innerHeight * (veld.classList.contains("groot") ? 0.55 : 0.28)) + "px";
  }

  let conceptKlok = null;
  function bewaarConcept() {
    clearTimeout(conceptKlok);
    conceptKlok = setTimeout(() => Opslag.zetConcept(state.project, $("notities").value), 400);
  }

  /** Alleen de kaart uit beeld halen; het voorstel zelf blijft bewaard. */
  function sluitVoorstelKaart() {
    $("voorstel-kaart").classList.add("hidden");
    $("voorstel-bijsturen").value = "";
    $("voorstel-vragen-lijst").innerHTML = "";
  }

  /**
   * Een voorstel waar je klaar mee bent: hier weg, en ook op de pc.
   *
   * De bridge houdt het laatste voorstel een half uur vast, zodat de app het
   * kan ophalen als de telefoon tussendoor is afgesloten. Zonder dit seintje
   * zet hij precies dat voorstel bij de volgende keer openen weer terug — ook
   * het voorstel dat je net had weggegooid of al had opgeslagen.
   */
  function vergeetVoorstel(project, kenmerk) {
    if (!project) return;
    Opslag.zetVoorstel(project, null);
    // Ook zonder bereikbare pc mag het niet terugkomen; daarom onthouden we
    // hier welk voorstel je gehad hebt.
    if (kenmerk) Opslag.zetAfgehandeldVoorstel(project, kenmerk);
    Bridge.voorstelWeg(project).catch(() => {});
  }

  function gooiVoorstelWeg() {
    const project = state.project;
    const kenmerk = voorstelKenmerk(state.voorstel);
    state.voorstel = null;
    sluitVoorstelKaart();
    vergeetVoorstel(project, kenmerk);
  }

  /**
   * Waaraan de app een voorstel herkent dat ze al gehad heeft.
   *
   * Het liefst aan het kenmerk van de bridge, maar dat geeft alleen een bridge
   * van 1.10.0 of nieuwer mee. Draait er op de pc nog een oudere, dan zou dat
   * het vangnet stilzwijgend uitschakelen — en komt een weggegooid voorstel
   * alsnog terug. Vandaar de terugval op de inhoud zelf: die heeft elk
   * voorstel, van welke bridge dan ook.
   */
  function voorstelKenmerk(v) {
    if (!v) return null;
    if (v.voorstelId) return v.voorstelId;
    if (!v.entry?.kop) return null;
    return "inhoud:" + vingerafdruk(voorstelAlsTekst(v));
  }

  /** Korte, stabiele afdruk van een stuk tekst (FNV-1a). */
  function vingerafdruk(tekst) {
    let h = 0x811c9dc5;
    for (let i = 0; i < tekst.length; i++) {
      h ^= tekst.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  /** Het voorstel als tekst — dat sturen we mee als je iets wilt bijsturen. */
  function voorstelAlsTekst(v) {
    const regels = [v.entry.kop, ...(v.entry.alineas || [])];
    for (const s of v.entry.secties || []) {
      regels.push((s.kop || "") + ":");
      for (const p of s.punten || []) regels.push("- " + p);
    }
    for (const h of v.headerWijzigingen || []) regels.push(`[kopgegeven] ${h.label}: ${h.nieuweWaarde}`);
    return regels.join("\n");
  }

  async function maakVoorstel(bijsturing) {
    if (!state.project) return toast("Kies eerst een project.");
    const notities = $("notities").value.trim();
    if (!notities) return toast("Schrijf of spreek eerst in wat er gebeurd is.");

    const historie = [];
    if (bijsturing && state.voorstel) {
      historie.push({ rol: "jij", tekst: "Eerder voorstel:\n" + voorstelAlsTekst(state.voorstel) });
      historie.push({ rol: "ik", tekst: "Pas het zo aan:\n" + bijsturing });
    }

    bezig(true, bijsturing ? "Voorstel bijwerken…" : "Voorstel maken…");
    try {
      const v = await Bridge.voorstel({ project: state.project, notities, historie });
      state.voorstel = v;
      // Vraag je hetzelfde voorstel bewust opnieuw aan, dan wil je het zien.
      Opslag.zetAfgehandeldVoorstel(state.project, null);
      Opslag.zetVoorstel(state.project, v);
      state.headerAan = (v.headerWijzigingen || []).map(() => true);
      tekenVoorstel();
      $("loggen-scroll").scrollTop = 0;
    } catch (e) {
      fout(e);
    } finally {
      bezig(false);
    }
  }

  function tekenVoorstel() {
    const v = state.voorstel;
    if (!v) return;
    $("voorstel-kaart").classList.remove("hidden");
    $("opslag-bevestiging").classList.add("hidden");
    $("voorstel-meta").textContent = v.duurMs ? `${Math.round(v.duurMs / 1000)} sec` : "";

    // Zonder kop is er niets om op te slaan; dat komt voor als Claude vindt dat
    // het al in het logboek staat. Dan is stilzwijgend niets doen het slechtste
    // wat de knop kan doen.
    const leeg = !v.entry?.kop;
    const dup = $("voorstel-duplicaat");
    dup.classList.toggle("hidden", !v.duplicaat && !leeg);
    if (v.duplicaat || leeg) {
      dup.textContent = v.duplicaat
        ? "Dit lijkt al in het logboek te staan. " + (v.duplicaatToelichting || "")
        : "Claude heeft hier geen entry van gemaakt. Vul de notities aan of stuur hieronder bij.";
    }
    $("btn-opslaan").disabled = leeg;
    $("btn-opslaan").dataset.altijdAan = leeg ? "" : "1";

    const delen = [`<p class="v-kop">${esc(v.entry.kop)}</p>`];
    for (const a of v.entry.alineas || []) delen.push(`<p>${esc(a)}</p>`);
    for (const s of v.entry.secties || []) {
      if (s.kop) delen.push(`<p class="v-sectiekop">${esc(s.kop.replace(/:$/, ""))}:</p>`);
      if (s.punten?.length) {
        delen.push("<ul>" + s.punten.map((p) => `<li>${esc(p)}</li>`).join("") + "</ul>");
      }
    }
    $("voorstel-inhoud").innerHTML = delen.join("");

    tekenMail($("voorstel-mail"), $("voorstel-mail-lijst"), v.mailGebruikt);
    if (v.mailMelding) toast(v.mailMelding, true);

    const wijzigingen = v.headerWijzigingen || [];
    $("voorstel-header").classList.toggle("hidden", !wijzigingen.length);
    const hl = $("voorstel-header-lijst");
    hl.innerHTML = "";
    wijzigingen.forEach((h, i) => {
      const rij = document.createElement("label");
      rij.className = "header-wijziging";
      rij.innerHTML =
        `<input type="checkbox" ${state.headerAan[i] ? "checked" : ""} />` +
        `<span class="hw-tekst"><span class="hw-label"></span><br /><span class="hw-waarde"></span>` +
        `<br /><span class="hw-reden"></span></span>`;
      rij.querySelector(".hw-label").textContent = h.label;
      rij.querySelector(".hw-waarde").textContent = h.nieuweWaarde;
      rij.querySelector(".hw-reden").textContent = h.reden || "";
      rij.querySelector("input").addEventListener("change", (e) => {
        state.headerAan[i] = e.target.checked;
      });
      hl.appendChild(rij);
    });

    const vragen = v.vragen || [];
    $("voorstel-vragen").classList.toggle("hidden", !vragen.length);
    const vl = $("voorstel-vragen-lijst");
    vl.innerHTML = "";
    vragen.forEach((vraag, i) => {
      const blok = document.createElement("div");
      blok.className = "vraag-blok";
      blok.innerHTML = `<span></span><input type="text" placeholder="Jouw antwoord (leeg laten mag)" data-vraag="${i}" />`;
      blok.querySelector("span").textContent = vraag;
      vl.appendChild(blok);
    });
  }

  /** De berichten die Claude erbij gelezen heeft, zodat je kunt controleren
      dat hij niet de verkeerde draad heeft gepakt. */
  function tekenMail(blok, lijst, berichten) {
    const heeft = berichten && berichten.length;
    blok.classList.toggle("hidden", !heeft);
    if (!heeft) return;
    lijst.innerHTML = "";
    for (const b of berichten) {
      const rij = document.createElement("div");
      rij.className = "mail-item";
      rij.innerHTML = "<strong></strong><span></span>";
      rij.querySelector("strong").textContent = b.onderwerp;
      rij.querySelector("span").textContent =
        `${datumKort(b.datum)} · ${b.van}` + (b.gevondenOp ? ` · gevonden op "${b.gevondenOp}"` : "");
      lijst.appendChild(rij);
    }
  }

  /** Antwoorden op de vragen van Claude plus de vrije bijsturing. */
  function bijsturingsTekst() {
    const delen = [];
    document.querySelectorAll("#voorstel-vragen-lijst input[data-vraag]").forEach((inp) => {
      const antwoord = inp.value.trim();
      if (!antwoord) return;
      const vraag = state.voorstel?.vragen?.[Number(inp.dataset.vraag)] || "";
      delen.push(`${vraag} → ${antwoord}`);
    });
    const vrij = $("voorstel-bijsturen").value.trim();
    if (vrij) delen.push(vrij);
    return delen.join("\n");
  }

  async function slaVoorstelOp() {
    const v = state.voorstel;
    if (!v || !state.project) return;
    if (!v.entry?.kop) return toast("Er is geen entry om op te slaan.", true);
    const wijzigingen = (v.headerWijzigingen || []).filter((_, i) => state.headerAan[i]);

    bezig(true, "Opslaan in document…");
    try {
      const uit = await Bridge.opslaan({
        project: state.project,
        entry: v.entry,
        headerWijzigingen: wijzigingen,
      });
      gooiVoorstelWeg();
      $("notities").value = "";
      pasHoogteAan();
      Opslag.zetConcept(state.project, "");
      $("concept-hint").classList.add("hidden");

      const bevestiging = $("opslag-bevestiging");
      const extra = uit.headerToegepast?.length ? ` Kopgegevens bijgewerkt: ${uit.headerToegepast.join(", ")}.` : "";
      const gemist = uit.headerOvergeslagen?.length
        ? ` Niet gevonden in de kop-tabel: ${uit.headerOvergeslagen.join(", ")}.`
        : "";
      bevestiging.innerHTML =
        `<h2>Opgeslagen</h2><p class="hint">Toegevoegd aan <strong>${esc(uit.bestand)}</strong>.` +
        `${esc(extra)}${esc(gemist)} Een kopie van de vorige versie staat in de map <code>_backups</code>.</p>`;
      bevestiging.classList.remove("hidden");
      toast("Entry toegevoegd aan het projectdocument.");
      seinAssistent();

      state.projectInfo = await Bridge.project(state.project).catch(() => state.projectInfo);
      state.entries = state.projectInfo?.entries || state.entries;
      tekenLogboek();
      $("loggen-scroll").scrollTop = 0;
    } catch (e) {
      fout(e);
    } finally {
      bezig(false);
    }
  }

  /* ------------------------------------------------------------- vragen */

  function tekenGesprek() {
    const el = $("gesprek");
    el.innerHTML = "";
    if (!state.project) {
      el.innerHTML = '<p class="gesprek-leeg">Kies eerst een project bovenaan.</p>';
      return;
    }
    if (!state.gesprek.length) {
      el.innerHTML =
        '<p class="gesprek-leeg">Stel een vraag over dit project.<br />Bijvoorbeeld: "wat staat er nog open?" of "wat is er afgesproken over de levertijd?"</p>';
      return;
    }
    for (const beurt of state.gesprek) {
      const bel = document.createElement("div");
      bel.className = "bel " + (beurt.rol === "ik" ? "bel-ik" : beurt.fout ? "bel-fout" : "bel-claude");
      bel.textContent = beurt.tekst;
      el.appendChild(bel);
      if (beurt.mail) {
        const bron = document.createElement("div");
        bron.className = "bel-bron";
        bron.textContent = `${beurt.mail} mailbericht${beurt.mail === 1 ? "" : "en"} meegelezen`;
        el.appendChild(bron);
      }
    }
    el.scrollTop = el.scrollHeight;
  }

  async function stelVraag() {
    if (!state.project) return toast("Kies eerst een project.");
    const tekst = $("vraag-tekst").value.trim();
    if (!tekst) return;
    $("vraag-tekst").value = "";
    Spraak.stil();

    state.gesprek.push({ rol: "ik", tekst });
    tekenGesprek();

    const wacht = document.createElement("div");
    wacht.className = "bel bel-claude bel-bezig";
    wacht.textContent = "Aan het lezen…";
    $("gesprek").appendChild(wacht);
    $("gesprek").scrollTop = $("gesprek").scrollHeight;

    try {
      const uit = await Bridge.vraag({
        project: state.project,
        vraag: tekst,
        historie: state.gesprek.slice(0, -1),
      });
      state.gesprek.push({ rol: "claude", tekst: uit.antwoord, mail: (uit.mailGebruikt || []).length });
      if (Opslag.instellingen().voorlezen) Spraak.spreek(uit.antwoord, Opslag.instellingen().stem);
    } catch (e) {
      state.gesprek.push({ rol: "claude", tekst: e.message, fout: true });
    } finally {
      Opslag.zetGesprek(state.project, state.gesprek);
      tekenGesprek();
    }
  }

  /* ------------------------------------------------------------- dictaat */

  function dicteerNaar(doel, knop) {
    if (Spraak.luistert() && state.dicteerDoel === doel) {
      Spraak.stop();
      return;
    }
    if (Spraak.luistert()) Spraak.stop();
    state.dicteerDoel = doel;

    const veld = $(doel);
    // Wat je al had getypt blijft staan; het ingesproken deel komt erachter.
    const basis = veld.value.trim();

    const stopWeergave = () => {
      knop.setAttribute("aria-pressed", "false");
      knop.title = "Inspreken";
      $("dicteer-hint").classList.add("hidden");
      state.dicteerDoel = null;
    };

    const gestart = Spraak.start({
      // De volledige ingesproken tekst tot nu toe, niet alleen het nieuwe stuk.
      // Daarom overschrijven we het veld in plaats van eraan te plakken.
      onTekst(volledig) {
        veld.value = [basis, volledig].filter(Boolean).join(" ");
        veld.dispatchEvent(new Event("input"));
      },
      onTussentijds(voorlopig) {
        if (doel !== "notities") return;
        const hint = $("dicteer-hint");
        hint.textContent = voorlopig ? "… " + voorlopig : "";
        hint.classList.toggle("hidden", !voorlopig);
      },
      onFout: (m) => toast(m, true),
      onEinde: stopWeergave,
    });

    if (gestart) {
      knop.setAttribute("aria-pressed", "true");
      knop.title = "Stoppen met inspreken";
    }
  }

  /* -------------------------------------------------------- instellingen */

  function vulInstellingen() {
    const i = Opslag.instellingen();
    $("cfg-url").value = i.bridgeUrl;
    $("cfg-token").value = i.token;
    $("cfg-voorlezen").checked = i.voorlezen;
    $("cfg-thema").value = i.thema;
    vulStemmen();
    $("spraak-hint").textContent = Spraak.luisterenKan()
      ? "Inspreken werkt het best in Chrome op Android."
      : "Deze browser kan niet naar spraak luisteren; typen kan altijd.";
    toonVersies();
    $("over-tekst").textContent =
      "De app praat met Claude Code op je eigen pc. Er is geen API-sleutel en er zijn geen " +
      "losse API-kosten — het draait op je Claude-abonnement.";
  }

  function toonMailStatus(status) {
    const el = $("mail-status");
    if (!el) return;
    if (!status) return void (el.textContent = "");
    el.textContent = !status.aan
      ? "Mail meelezen staat uit."
      : status.gekoppeld
        ? "Mail meelezen staat aan."
        : "Mail staat aan maar is nog niet gekoppeld — draai op je pc: node koppel-mail.js";
    el.classList.toggle("fout", status.aan && !status.gekoppeld);
  }

  function toonVersies() {
    const regel = $("versie-regel");
    if (!regel) return;
    const app = window.PDOC_CONFIG?.versie || "?";
    regel.classList.remove("fout");
    if (!state.bridgeVersie) {
      regel.textContent = `App ${app} · bridge niet bereikt`;
      return;
    }
    const routes = { node: "node", cmd: "opdrachtprompt", direct: "direct" };
    const claude = state.claudeInfo?.gevonden
      ? ` · Claude via ${routes[state.claudeInfo.route] || state.claudeInfo.route}`
      : state.claudeInfo
        ? " · Claude niet gevonden"
        : "";
    const oud = bridgeLooptAchter();
    regel.classList.toggle("fout", oud);
    regel.textContent =
      `App ${app} · bridge ${state.bridgeVersie}${claude}` +
      (oud ? ` — verouderd, herstart de bridge op je pc (${window.PDOC_CONFIG.minimaleBridge} of nieuwer)` : "");
  }

  /**
   * Een bridge die achterloopt mist routes die de app gebruikt, en dat merk je
   * niet vanzelf: zo'n verzoek mislukt stilletjes. Daarom zeggen we het.
   */
  function bridgeLooptAchter() {
    const minimaal = window.PDOC_CONFIG?.minimaleBridge;
    if (!minimaal || !state.bridgeVersie) return false;
    const heeft = String(state.bridgeVersie).split(".").map(Number);
    const nodig = String(minimaal).split(".").map(Number);
    for (let i = 0; i < nodig.length; i++) {
      const a = heeft[i] || 0;
      const b = nodig[i] || 0;
      if (a !== b) return a < b;
    }
    return false;
  }

  function vulStemmen() {
    const kiezer = $("cfg-stem");
    const huidig = Opslag.instellingen().stem;
    const stemmen = Spraak.stemmen();
    kiezer.innerHTML = '<option value="">Standaardstem</option>';
    for (const s of stemmen) {
      const optie = document.createElement("option");
      optie.value = s.name;
      optie.textContent = s.name;
      if (s.name === huidig) optie.selected = true;
      kiezer.appendChild(optie);
    }
    kiezer.disabled = !Spraak.sprekenKan();
  }

  function vulSjabloonKeuze() {
    const kiezer = $("nieuw-sjabloon");
    kiezer.innerHTML = "";
    for (const p of state.projecten) {
      const optie = document.createElement("option");
      optie.value = p.naam;
      optie.textContent = p.naam;
      kiezer.appendChild(optie);
    }
  }

  async function bewaarInstellingen() {
    Opslag.zetInstellingen({
      bridgeUrl: $("cfg-url").value.trim(),
      token: $("cfg-token").value.trim(),
      voorlezen: $("cfg-voorlezen").checked,
      stem: $("cfg-stem").value,
      thema: $("cfg-thema").value,
    });
    pasThemaToe();
    const i = Opslag.instellingen();
    Bridge.stel(i.bridgeUrl, i.token);
    toast("Instellingen opgeslagen.");
    await verbind();
  }

  async function testVerbinding() {
    const uitslag = $("test-uitslag");
    uitslag.classList.remove("hidden", "fout", "goed");
    uitslag.textContent = "Bezig met testen…";
    Bridge.stel($("cfg-url").value.trim(), $("cfg-token").value.trim());
    try {
      const st = await Bridge.status();
      uitslag.textContent = `Verbonden met bridge ${st.versie}. ${st.aantalProjecten} projecten, model ${st.model}. Nu Claude nog even proberen…`;
      const test = await Bridge.zelftest();
      uitslag.textContent = test.ok
        ? `Alles werkt. Bridge ${st.versie}, ${st.aantalProjecten} projecten, model ${st.model}.`
        : `Bridge ${st.versie} werkt, maar Claude reageerde niet zoals verwacht: ${test.melding}`;
      uitslag.classList.add(test.ok ? "goed" : "fout");
    } catch (e) {
      uitslag.textContent = e.message;
      uitslag.classList.add("fout");
    }
  }

  async function maakNieuwProject() {
    const naam = $("nieuw-naam").value.trim();
    const uitslag = $("nieuw-uitslag");
    uitslag.classList.remove("hidden", "fout", "goed");
    if (!naam) {
      uitslag.textContent = "Vul een projectnaam in.";
      uitslag.classList.add("fout");
      return;
    }
    uitslag.textContent = "Bezig…";
    try {
      const uit = await Bridge.nieuwProject({
        naam,
        titel: $("nieuw-titel").value.trim() || naam,
        sjabloon: $("nieuw-sjabloon").value,
      });
      uitslag.textContent = `${uit.bestand} aangemaakt. Vul de kopgegevens nog even aan in Word.`;
      uitslag.classList.add("goed");
      $("nieuw-naam").value = "";
      $("nieuw-titel").value = "";
      await laadProjecten(true);
      kiesProject(uit.naam);
    } catch (e) {
      uitslag.textContent = e.message;
      uitslag.classList.add("fout");
    }
  }

  /* ------------------------------------------------------------ overlays */

  const openOverlay = (id) => $(id).classList.remove("hidden");
  const sluitOverlay = (id) => $(id).classList.add("hidden");

  /* -------------------------------------------------------------- opstart */

  function toonVerbindingsstatus() {
    if (!Bridge.ingesteld()) {
      zetStatus("Nog niet verbonden — vul Instellingen in", "fout");
      return;
    }
    if (!state.project) {
      const n = state.projecten.length;
      zetStatus(n === 1 ? "1 project gevonden — kies het" : `${n} projecten — kies er een`);
      return;
    }
    // De status staat meestal verstopt in een veld als "2026-03 | Status: Actief".
    let status = null;
    for (const veld of state.projectInfo?.header || []) {
      const m = /status\s*:\s*(.+)$/i.exec(veld.waarde);
      if (m) status = m[1].trim();
    }
    zetStatus(status ? `Status: ${status}` : "Verbonden");
  }

  async function verbind() {
    if (!Bridge.ingesteld()) {
      toonVerbindingsstatus();
      return;
    }
    zetStatus("Verbinden met je pc…", "bezig");
    try {
      await laadProjecten();
      const vorige = Opslag.laatsteProject();
      if (vorige && state.projecten.some((p) => p.naam === vorige)) await kiesProject(vorige);
      else toonVerbindingsstatus();
    } catch (e) {
      fout(e);
    }
  }

  /* ------------------------------------------ trekken om te verversen */

  /**
   * Opnieuw ophalen wat er op de pc staat: de projectenlijst (met een verse
   * scan van de map) en het logboek van het project dat je open hebt. Wat je
   * nog niet verstuurd had - notities, een voorstel, het gesprek - blijft
   * staan; alleen de gegevens van de pc worden vervangen.
   */
  let bezigMetVerversen = false;
  async function verversAlles() {
    if (bezigMetVerversen || state.bezig) return;
    if (!Bridge.ingesteld()) {
      toast("Vul eerst het adres en het token in bij Instellingen.", true);
      return;
    }
    bezigMetVerversen = true;
    zetStatus("Verversen…", "bezig");
    try {
      await laadProjecten(true);
      if (state.project) {
        state.projectInfo = await Bridge.project(state.project);
        state.entries = state.projectInfo.entries || [];
        tekenLogboek();
        await laadGeld(state.project);
      }
      toonVerbindingsstatus();
      toast("Bijgewerkt.");
    } catch (e) {
      fout(e);
    } finally {
      bezigMetVerversen = false;
    }
  }

  // Bij geneste scrollvakken (het logboek zit in main) mag alleen het binnenste
  // vak op de beweging reageren, anders ververst main mee terwijl het logboek
  // al halverwege staat.
  const trekVakken = [];
  let trekVak = null;

  function binnensteVak(doel) {
    for (let el = doel; el; el = el.parentElement) {
      if (trekVakken.includes(el)) return el;
    }
    return null;
  }

  function bindTrekVerversen(vak) {
    const balkje = $("pull-indicator");
    let startY = null;
    trekVakken.push(vak);

    vak.addEventListener(
      "touchstart",
      (e) => {
        if (trekVak || vak.scrollTop > 0 || state.bezig || bezigMetVerversen) return;
        if (binnensteVak(e.target) !== vak) return;
        // In een openstaand blad (projectkiezer, projectgegevens) hoort de
        // beweging bij dat blad, niet bij de app eronder.
        if (document.querySelector(".overlay:not(.hidden)")) return;
        trekVak = vak;
        startY = e.touches[0].clientY;
      },
      { passive: true }
    );

    vak.addEventListener(
      "touchmove",
      (e) => {
        if (trekVak !== vak || startY == null) return;
        const dy = e.touches[0].clientY - startY;
        balkje.classList.toggle("hidden", dy < 50 || vak.scrollTop > 0);
      },
      { passive: true }
    );

    const klaar = (e) => {
      if (trekVak !== vak || startY == null) return;
      const dy = (e.changedTouches?.[0]?.clientY ?? startY) - startY;
      const genoeg = dy > 80 && vak.scrollTop <= 0 && e.type === "touchend";
      balkje.classList.add("hidden");
      trekVak = null;
      startY = null;
      if (genoeg) {
        haptic(15);
        verversAlles();
      }
    };
    vak.addEventListener("touchend", klaar);
    vak.addEventListener("touchcancel", klaar);
  }

  function bindPullToRefresh() {
    // Elk tabblad heeft zijn eigen scrollvak: loggen scrolt in het logboek,
    // vragen in het gesprek, instellingen in main zelf.
    for (const vak of [$("loggen-scroll"), $("gesprek"), document.querySelector("main")]) {
      if (vak) bindTrekVerversen(vak);
    }
  }

  function bindGebeurtenissen() {
    document.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => naarTab(t.dataset.tab))
    );

    $("btn-project").addEventListener("click", async () => {
      state.kiezerDoel = null;
      $("kiezer-titel").textContent = "Project kiezen";
      openOverlay("kiezer");
      $("kiezer-zoek").value = "";
      tekenKiezer();
      if (!state.projecten.length && Bridge.ingesteld()) {
        try {
          await laadProjecten(true);
          tekenKiezer();
        } catch (e) {
          fout(e);
        }
      }
    });
    $("btn-project-info").addEventListener("click", toonInfo);
    const sluitKiezer = () => {
      sluitOverlay("kiezer");
      if (state.kiezerDoel) {
        state.kiezerDoel = null;
        $("kiezer-titel").textContent = "Project kiezen";
        openGeldblad();
      }
    };
    $("btn-kiezer-dicht").addEventListener("click", sluitKiezer);
    $("btn-offerte").addEventListener("click", () => {
      const lopend = ((state.geld && state.geld.offertes) || []).filter(isLopend);
      openGeldblad(lopend.length === 1 ? lopend[0].nummer : null);
    });
    $("btn-geld-dicht").addEventListener("click", () => sluitOverlay("geldblad"));
    $("geld-inhoud").addEventListener("click", (e) => {
      const knop = e.target.closest("[data-actie]");
      if (knop) geldActie(knop);
    });
    $("btn-pdf-dicht").addEventListener("click", sluitPdf);
    $("btn-pdf-in").addEventListener("click", () => zoomPdf(1));
    $("btn-pdf-uit").addEventListener("click", () => zoomPdf(-1));
    $("btn-pdf-bewaar").addEventListener("click", () => pdfStaat.blob && bewaarBlob(pdfStaat.blob, pdfStaat.naam));
    $("geld-inhoud").addEventListener("change", (e) => {
      if (e.target.matches("select[data-status-nr]")) kiesStatus(e.target);
    });
    $("btn-info-dicht").addEventListener("click", () => sluitOverlay("infoblad"));
    $("kiezer-zoek").addEventListener("input", tekenKiezer);
    $("btn-kiezer-ververs").addEventListener("click", async () => {
      try {
        await laadProjecten(true);
        tekenKiezer();
        toast("Lijst bijgewerkt.");
      } catch (e) {
        fout(e);
      }
    });
    ["kiezer", "infoblad", "geldblad"].forEach((id) =>
      $(id).addEventListener("click", (e) => {
        if (e.target.id !== id) return;
        if (id === "kiezer") sluitKiezer();
        else sluitOverlay(id);
      })
    );

    $("notities").addEventListener("input", () => {
      pasHoogteAan();
      bewaarConcept();
      $("concept-hint").classList.add("hidden");
    });
    $("btn-groter").addEventListener("click", () => {
      const veld = $("notities");
      const knop = $("btn-groter");
      const uitgeklapt = knop.getAttribute("aria-expanded") === "true";
      knop.setAttribute("aria-expanded", uitgeklapt ? "false" : "true");
      veld.classList.toggle("groot", !uitgeklapt);
      knop.querySelector("use").setAttribute("href", uitgeklapt ? "#ic-groter" : "#ic-kleiner");
      knop.title = uitgeklapt ? "Groter" : "Kleiner";
      pasHoogteAan();
      veld.focus();
    });
    $("btn-notities-wis").addEventListener("click", () => {
      const veld = $("notities");
      const vorige = veld.value;
      if (!vorige) return;
      const project = state.project;
      veld.value = "";
      pasHoogteAan();
      Opslag.zetConcept(project, "");
      $("concept-hint").classList.add("hidden");
      // Een misgetikte prullenbak kost anders een heel ingesproken verhaal.
      toast("Notities gewist.", false, {
        label: "Ongedaan maken",
        doe() {
          if (state.project !== project) return toast("Die notities horen bij een ander project.", true);
          veld.value = vorige;
          pasHoogteAan();
          Opslag.zetConcept(project, vorige);
        },
      });
    });
    $("btn-dicteer").addEventListener("click", () => dicteerNaar("notities", $("btn-dicteer")));
    $("btn-dicteer-bijsturen").addEventListener("click", () =>
      dicteerNaar("voorstel-bijsturen", $("btn-dicteer-bijsturen"))
    );
    $("btn-dicteer-vraag").addEventListener("click", () =>
      dicteerNaar("vraag-tekst", $("btn-dicteer-vraag"))
    );

    $("btn-voorstel").addEventListener("click", () => maakVoorstel(null));
    $("btn-opnieuw").addEventListener("click", () => {
      const bij = bijsturingsTekst();
      if (!bij) return toast("Zeg eerst wat er anders moet.");
      maakVoorstel(bij);
    });
    $("btn-opslaan").addEventListener("click", slaVoorstelOp);
    $("btn-voorstel-weg").addEventListener("click", gooiVoorstelWeg);

    $("btn-vraag").addEventListener("click", stelVraag);
    $("btn-gesprek-wis").addEventListener("click", () => {
      if (!state.project) return toast("Kies eerst een project.");
      if (!state.gesprek.length) return toast("Er is nog geen gesprek om te wissen.");
      if (!confirm("Het gesprek over dit project wissen?")) return;
      state.gesprek = [];
      Opslag.wisGesprek(state.project);
      tekenGesprek();
      toast("Gesprek gewist.");
    });
    $("vraag-tekst").addEventListener("keydown", (e) => {
      if (e.key === "Enter") stelVraag();
    });

    $("btn-cfg-opslaan").addEventListener("click", bewaarInstellingen);
    $("btn-test").addEventListener("click", testVerbinding);
    $("btn-nieuw-project").addEventListener("click", maakNieuwProject);
    $("cfg-thema").addEventListener("change", () => {
      Opslag.zetInstellingen({ thema: $("cfg-thema").value });
      pasThemaToe();
    });
    $("cfg-voorlezen").addEventListener("change", () => {
      Opslag.zetInstellingen({ voorlezen: $("cfg-voorlezen").checked });
      if (!$("cfg-voorlezen").checked) Spraak.stil();
    });
    $("cfg-stem").addEventListener("change", () => {
      Opslag.zetInstellingen({ stem: $("cfg-stem").value });
      Spraak.spreek("Zo klink ik.", $("cfg-stem").value);
    });
    $("btn-update").addEventListener("click", zoekNieuweVersie);
    $("btn-wis-lokaal").addEventListener("click", () => {
      if (!confirm("Alle lokale instellingen, concepten en gesprekken wissen?")) return;
      Opslag.wisAlles();
      location.reload();
    });

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", pasThemaToe);
    if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = vulStemmen;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) Spraak.stop();
      else haalLopendVoorstel();
    });
  }

  /** Zelf naar een nieuwe versie zoeken, voor als het wachten te lang duurt. */
  async function zoekNieuweVersie() {
    if (!("serviceWorker" in navigator)) return toast("Deze browser werkt niet met versiebeheer.");
    toast("Zoeken naar een nieuwe versie…");
    try {
      const registratie = await navigator.serviceWorker.getRegistration();
      if (!registratie) return toast("Nog geen versiebeheer actief; herlaad de pagina.");
      await registratie.update();
      // Is er iets nieuws, dan neemt dat het zo over en herlaadt de app zichzelf.
      if (registratie.installing || registratie.waiting) toast("Nieuwe versie gevonden — even opnieuw laden.");
      else toast(`Je hebt de nieuwste versie (${window.PDOC_CONFIG?.versie || "?"}).`);
    } catch (_) {
      toast("Kon niet naar een nieuwe versie zoeken.", true);
    }
  }

  function registreerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("service-worker.js").catch(() => {});

    // Bij een nieuwe versie de pagina één keer herladen. Zonder dat draait de
    // oude code nog tot de volgende keer openen, en dan zit je een reparatie
    // lang met een fout die al verholpen is.
    const hadAlEenVersie = !!navigator.serviceWorker.controller;
    let bezig = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (bezig || !hadAlEenVersie) return;
      bezig = true;
      // Niet vanzelf herladen (je kunt midden in je notities zitten): melden, jij tikt als het uitkomt.
      toast("Nieuwe versie klaar", false, { label: "Vernieuwen", doe: () => location.reload() });
    });
  }

  // Link vanuit de assistent (?project=...&tekst=...): meteen bij het laden vastpakken, voor iets anders de adresbalk opschoont.
  const linkParams = new URLSearchParams(location.search);

  function sleutel(naam) {
    return String(naam || "").toLowerCase().replace(/^\s*\d{3,}\s*/, "").replace(/[^a-z0-9]/g, "");
  }

  /** Project en notities overnemen uit een link van een andere IMeTech-app. */
  async function openVanuitLink() {
    const project = linkParams.get("project"), tekst = linkParams.get("tekst");
    if (!project && !tekst) return;
    naarTab("loggen");
    if (project) {
      const nr = (project.match(/\d{3,}/) || [])[0];
      const k = sleutel(project);
      const p = state.projecten.find((x) => sleutel(x.naam) === k)
        || (nr && state.projecten.find((x) => x.naam.includes(nr) || (x.map || "").includes(nr)))
        || state.projecten.find((x) => k && (sleutel(x.naam).includes(k) || k.includes(sleutel(x.naam))));
      if (p) await kiesProject(p.naam);
      else toast(`Project "${project}" niet gevonden; kies het even zelf.`, true);
    }
    if (tekst) {
      const veld = $("notities");
      veld.value = veld.value.trim() ? veld.value.trim() + "\n" + tekst : tekst;
      pasHoogteAan();
      veld.focus();
      Opslag.zetConcept(state.project, veld.value);
    }
    window.IMeTechApps?.wisParams();
  }

  /** Seintje aan de assistent (zelfde adres/token als in de assistent-app, die op hetzelfde domein staat). */
  async function seinAssistent() {
    try {
      const inst = await new Promise((ok) => {
        const r = indexedDB.open("assistent", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onerror = () => ok(null);
        r.onsuccess = () => {
          try {
            const t = r.result.transaction("kv", "readonly").objectStore("kv").get("instellingen");
            t.onsuccess = () => ok(t.result || null);
            t.onerror = () => ok(null);
          } catch (_) { ok(null); }
        };
      });
      if (!inst?.adres || !inst?.token) return;
      await fetch(inst.adres.replace(/\/$/, "") + "/api/run/projectdoc", { method: "POST", headers: { Authorization: "Bearer " + inst.token } });
    } catch (_) { /* assistent niet bereikbaar: die leest het document bij de volgende ronde */ }
  }

  async function start() {
    const i = Opslag.instellingen();
    if (!i.bridgeUrl && window.PDOC_CONFIG?.standaardBridgeUrl) {
      Opslag.zetInstellingen({ bridgeUrl: window.PDOC_CONFIG.standaardBridgeUrl });
    }
    pasThemaToe();
    state.filter = Opslag.filter();
    bindGebeurtenissen();
    bindPullToRefresh();
    vulInstellingen();
    registreerServiceWorker();
    PdocInstall.init(naarTab);

    const inst = Opslag.instellingen();
    Bridge.stel(inst.bridgeUrl, inst.token);
    if (!Bridge.ingesteld()) naarTab("instellingen");
    await verbind();
    await openVanuitLink().catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", start);
})();
