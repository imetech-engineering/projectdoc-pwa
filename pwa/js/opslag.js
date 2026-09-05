/**
 * Alles wat de app lokaal onthoudt: instellingen, het laatst gekozen project,
 * onopgeslagen notities en het gesprek per project.
 *
 * Bewust localStorage en niet IndexedDB: het gaat om weinig, klein en plat.
 * Elke lees- en schrijfactie is afgeschermd, want in een privévenster of met
 * geblokkeerde site-gegevens gooit de browser hier een fout.
 */
(function (global) {
  const PREFIX = "pdoc_";

  function lees(sleutel, standaard) {
    try {
      const ruw = localStorage.getItem(PREFIX + sleutel);
      return ruw === null ? standaard : JSON.parse(ruw);
    } catch (_) {
      return standaard;
    }
  }

  function schrijf(sleutel, waarde) {
    try {
      localStorage.setItem(PREFIX + sleutel, JSON.stringify(waarde));
    } catch (_) {}
  }

  function verwijder(sleutel) {
    try {
      localStorage.removeItem(PREFIX + sleutel);
    } catch (_) {}
  }

  const STANDAARD = {
    bridgeUrl: "",
    token: "",
    voorlezen: false,
    stem: "",
    thema: "auto",
  };

  function instellingen() {
    return { ...STANDAARD, ...lees("instellingen", {}) };
  }

  function zetInstellingen(nieuw) {
    schrijf("instellingen", { ...instellingen(), ...nieuw });
  }

  const sleutelVan = (project) => encodeURIComponent(project || "geen");

  global.Opslag = {
    instellingen,
    zetInstellingen,

    laatsteProject: () => lees("project", null),
    zetLaatsteProject: (naam) => schrijf("project", naam),

    concept: (project) => lees("concept_" + sleutelVan(project), ""),
    zetConcept: (project, tekst) =>
      tekst ? schrijf("concept_" + sleutelVan(project), tekst) : verwijder("concept_" + sleutelVan(project)),

    gesprek: (project) => lees("gesprek_" + sleutelVan(project), []),
    zetGesprek: (project, beurten) => schrijf("gesprek_" + sleutelVan(project), beurten.slice(-20)),

    wisAlles() {
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith(PREFIX))
          .forEach((k) => localStorage.removeItem(k));
      } catch (_) {}
    },
  };
})(window);
