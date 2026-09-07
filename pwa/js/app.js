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
    bezig: false,
    dicteerDoel: null,
    bridgeVersie: null,
    claudeInfo: null,
  };

  /* ------------------------------------------------------------ hulpjes */

  let toastKlok = null;
  function toast(tekst, isFout) {
    const el = $("toast");
    el.textContent = tekst;
    el.classList.toggle("fout", !!isFout);
    el.classList.remove("hidden");
    clearTimeout(toastKlok);
    toastKlok = setTimeout(() => el.classList.add("hidden"), isFout ? 6000 : 3200);
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

  async function laadProjecten(ververs) {
    // Meteen ook de versie van de bridge ophalen: zo zie je in één oogopslag
    // of beide helften bijgewerkt zijn.
    Bridge.status()
      .then((st) => {
        state.bridgeVersie = st.versie;
        state.claudeInfo = st.claude;
        toonVersies();
        toonMailStatus(st.mail);
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
    if (!treffers.length) {
      lijst.innerHTML = `<p class="hint">${
        state.projecten.length ? "Geen project met die naam." : "Geen projecten gevonden in de map op je pc."
      }</p>`;
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
    verbergVoorstel();
    $("opslag-bevestiging").classList.add("hidden");

    const concept = Opslag.concept(naam);
    $("notities").value = concept;
    pasHoogteAan();
    $("concept-hint").classList.toggle("hidden", !concept);
    if (concept) $("concept-hint").textContent = "Onopgeslagen notities van eerder teruggezet.";

    state.gesprek = Opslag.gesprek(naam);
    tekenGesprek();
    state.entries = [];
    tekenLogboek();

    try {
      state.projectInfo = await Bridge.project(naam);
      state.entries = state.projectInfo.entries || [];
      tekenLogboek();
      toonVerbindingsstatus();
    } catch (e) {
      fout(e);
    }
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
    if (!state.entries.length) {
      el.innerHTML =
        '<p class="logboek-leeg">Nog geen entries in dit logboek.<br />Spreek hieronder in wat er gebeurd is.</p>';
      return;
    }
    el.innerHTML = state.entries.map(entryHtml).join("");
  }

  function entryHtml(entry) {
    const delen = [`<h3><span class="datum">${esc(entry.datum)}</span> ${esc(entry.kop)}</h3>`];
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
    return `<article class="logboek-entry">${delen.join("")}</article>`;
  }

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

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

  function verbergVoorstel() {
    state.voorstel = null;
    $("voorstel-kaart").classList.add("hidden");
    $("voorstel-bijsturen").value = "";
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
      verbergVoorstel();
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
    regel.textContent = `App ${app} · bridge ${state.bridgeVersie}${claude}`;
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
    $("btn-kiezer-dicht").addEventListener("click", () => sluitOverlay("kiezer"));
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
    ["kiezer", "infoblad"].forEach((id) =>
      $(id).addEventListener("click", (e) => {
        if (e.target.id === id) sluitOverlay(id);
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
      $("notities").value = "";
      pasHoogteAan();
      Opslag.zetConcept(state.project, "");
      $("concept-hint").classList.add("hidden");
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
    $("btn-voorstel-weg").addEventListener("click", verbergVoorstel);

    $("btn-vraag").addEventListener("click", stelVraag);
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
      toast("Nieuwe versie — even opnieuw laden.");
      setTimeout(() => location.reload(), 400);
    });
  }

  async function start() {
    const i = Opslag.instellingen();
    if (!i.bridgeUrl && window.PDOC_CONFIG?.standaardBridgeUrl) {
      Opslag.zetInstellingen({ bridgeUrl: window.PDOC_CONFIG.standaardBridgeUrl });
    }
    pasThemaToe();
    bindGebeurtenissen();
    bindPullToRefresh();
    vulInstellingen();
    registreerServiceWorker();
    PdocInstall.init(naarTab);

    const inst = Opslag.instellingen();
    Bridge.stel(inst.bridgeUrl, inst.token);
    if (!Bridge.ingesteld()) naarTab("instellingen");
    await verbind();
  }

  document.addEventListener("DOMContentLoaded", start);
})();
