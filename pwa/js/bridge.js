/**
 * Verbinding met de bridge op de eigen pc. Eén plek voor het token, de
 * time-out en het vertalen van technische fouten naar iets leesbaars.
 */
(function (global) {
  let basis = "";
  let token = "";

  function stel(url, sleutel) {
    basis = String(url || "").trim().replace(/\/+$/, "");
    token = String(sleutel || "").trim();
  }

  const ingesteld = () => !!basis && !!token;

  async function roep(pad, opties = {}) {
    if (!ingesteld()) throw new Error("Vul eerst het adres en het token in bij Instellingen.");
    const timeout = opties.timeoutMs || (global.PDOC_CONFIG?.timeoutMs ?? 300000);
    const afbreker = new AbortController();
    const klok = setTimeout(() => afbreker.abort(), timeout);

    let res;
    try {
      res = await fetch(basis + pad, {
        method: opties.body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + token,
          ...(opties.body ? { "Content-Type": "application/json" } : {}),
        },
        body: opties.body ? JSON.stringify(opties.body) : undefined,
        signal: afbreker.signal,
        cache: "no-store",
      });
    } catch (e) {
      throw new Error(
        e.name === "AbortError"
          ? "Het duurde te lang — staat de pc nog aan en draait de bridge?"
          : "Geen verbinding met je pc. Controleer het adres en of de bridge draait."
      );
    } finally {
      clearTimeout(klok);
    }

    if (res.status === 401) throw new Error("Token klopt niet. Controleer Instellingen.");
    let data;
    try {
      data = await res.json();
    } catch (_) {
      throw new Error(`Onverwacht antwoord van de bridge (${res.status}).`);
    }
    if (!res.ok || data.fout) throw new Error(data.fout || `Fout ${res.status} van de bridge.`);
    return data;
  }

  global.Bridge = {
    stel,
    ingesteld,
    basisUrl: () => basis,
    status: () => roep("/api/status", { timeoutMs: 15000 }),
    zelftest: () => roep("/api/zelftest", { timeoutMs: 120000 }),
    projecten: (ververs) => roep("/api/projecten" + (ververs ? "?ververs=1" : ""), { timeoutMs: 20000 }),
    project: (naam) => roep("/api/project?naam=" + encodeURIComponent(naam), { timeoutMs: 20000 }),
    vraag: (body) => roep("/api/vraag", { body }),
    voorstel: (body) => roep("/api/voorstel", { body }),
    opslaan: (body) => roep("/api/opslaan", { body, timeoutMs: 60000 }),
    nieuwProject: (body) => roep("/api/nieuwproject", { body, timeoutMs: 60000 }),
  };
})(window);
