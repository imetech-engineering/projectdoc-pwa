/**
 * Spraak in en uit.
 *
 * Invoer gaat via de Web Speech API (in Chrome op Android gaat de audio langs
 * Google — dat is de enige manier die daar werkt). Uitvoer gaat via
 * SpeechSynthesis en blijft volledig op het toestel.
 *
 * Belangrijk detail: we plakken herkende stukken niet aan elkaar, maar bouwen
 * de tekst elke keer opnieuw op uit alle afgeronde resultaten. Android stuurt
 * hetzelfde stuk namelijk meermaals door terwijl het nog bijgeschaafd wordt;
 * bij aanplakken krijg je dan dezelfde zin vijf of tien keer achter elkaar.
 * Opnieuw opbouwen kan per definitie niet dubbel gaan.
 *
 * Android stopt de herkenning ook uit zichzelf na een stilte. Daarom starten we
 * hem weer op zolang de gebruiker niet zelf op stop heeft gedrukt; wat tot dan
 * herkend was, gaat mee als vaste basis de volgende ronde in.
 */
(function (global) {
  const Herkenner = global.SpeechRecognition || global.webkitSpeechRecognition;

  let sessie = null;
  let gewenst = false;
  let handlers = {};
  let afgerond = ""; // uit eerdere ronden, na een herstart
  let ronde = ""; // uit de lopende ronde

  const luisterenKan = () => !!Herkenner;
  const sprekenKan = () => "speechSynthesis" in global;

  /**
   * Twee stukken herkende tekst samenvoegen zonder te herhalen.
   *
   * Android levert een zin vaak groeiend aan — "vanochtend", "vanochtend met",
   * "vanochtend met Carl" — en markeert die tussenstappen soms alle drie als
   * afgerond. Achter elkaar plakken geeft dan de hele zin een paar keer. Daarom
   * kijken we eerst of het nieuwe stuk een uitbreiding is van wat er al staat,
   * of er deels overheen valt.
   */
  function voegSamen(basis, stuk) {
    const b = (basis || "").trim();
    const s = (stuk || "").trim();
    if (!b) return s;
    if (!s) return b;
    if (s.startsWith(b)) return s; // groeiende versie van hetzelfde
    if (b.endsWith(s) || b.includes(s)) return b; // staat er al

    // Overlap op woordgrens: het einde van b is het begin van s.
    const bw = b.split(/\s+/);
    const sw = s.split(/\s+/);
    for (let n = Math.min(bw.length, sw.length); n > 0; n--) {
      if (bw.slice(-n).join(" ").toLowerCase() === sw.slice(0, n).join(" ").toLowerCase()) {
        return [...bw, ...sw.slice(n)].join(" ");
      }
    }
    return b + " " + s;
  }

  function samen(extra) {
    return [afgerond, ronde, extra].reduce((uit, deel) => voegSamen(uit, deel), "");
  }

  function start(opties = {}) {
    if (!luisterenKan()) {
      opties.onFout?.("Spraakherkenning werkt niet in deze browser. Gebruik Chrome op Android.");
      return false;
    }
    if (gewenst) return true;
    handlers = opties;
    afgerond = "";
    ronde = "";
    gewenst = true;
    open();
    return true;
  }

  function open() {
    sessie = new Herkenner();
    sessie.lang = "nl-NL";
    sessie.continuous = true;
    sessie.interimResults = true;

    sessie.onresult = (e) => {
      // Alles opnieuw opbouwen uit e.results — niet aanvullen vanaf resultIndex.
      let vast = "";
      let voorlopig = "";
      for (let i = 0; i < e.results.length; i++) {
        const stuk = e.results[i][0]?.transcript || "";
        if (e.results[i].isFinal) vast = voegSamen(vast, stuk);
        else voorlopig = voegSamen(voorlopig, stuk);
      }
      ronde = vast;
      handlers.onTekst?.(samen(""));
      handlers.onTussentijds?.(voorlopig.trim());
    };

    sessie.onerror = (e) => {
      // Een stilte of een afgebroken herkenning is geen echte fout: gewoon
      // opnieuw beginnen. Bij een geweigerde microfoon stoppen we wel.
      if (e.error === "no-speech" || e.error === "aborted") return;
      gewenst = false;
      handlers.onFout?.(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Geen toegang tot de microfoon. Sta dit toe in de browserinstellingen."
          : e.error === "network"
            ? "Spraakherkenning heeft internet nodig en kan er nu niet bij."
            : "Spraakherkenning stopte onverwacht."
      );
    };

    sessie.onend = () => {
      // Wat deze ronde opleverde is nu definitief; de volgende ronde begint
      // met een lege resultatenlijst en mag daar niet overheen schrijven.
      afgerond = samen("");
      ronde = "";
      if (gewenst) {
        try {
          sessie.start();
          return;
        } catch (_) {
          gewenst = false;
        }
      }
      handlers.onEinde?.();
    };

    try {
      sessie.start();
    } catch (_) {
      gewenst = false;
      handlers.onFout?.("Kon de microfoon niet starten.");
      handlers.onEinde?.();
    }
  }

  function stop() {
    gewenst = false;
    try {
      sessie?.stop();
    } catch (_) {}
  }

  const luistert = () => gewenst;

  /* ------------------------------------------------------------ voorlezen */

  function stemmen() {
    if (!sprekenKan()) return [];
    return global.speechSynthesis.getVoices().filter((s) => /^nl/i.test(s.lang));
  }

  function spreek(tekst, stemNaam) {
    if (!sprekenKan() || !tekst) return;
    stil();
    const uiting = new SpeechSynthesisUtterance(String(tekst).slice(0, 4000));
    uiting.lang = "nl-NL";
    uiting.rate = 1.05;
    const stem = stemmen().find((s) => s.name === stemNaam);
    if (stem) uiting.voice = stem;
    global.speechSynthesis.speak(uiting);
  }

  function stil() {
    if (sprekenKan()) global.speechSynthesis.cancel();
  }

  global.Spraak = { luisterenKan, sprekenKan, start, stop, luistert, stemmen, spreek, stil, voegSamen };
})(window);
