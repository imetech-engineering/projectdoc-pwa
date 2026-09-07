const CACHE = "imtech-projectdoc-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./manifest.webmanifest",
  "./config.js",
  "./branding/logo-zwart.png",
  "./branding/logo-wit.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/opslag.js",
  "./js/bridge.js",
  "./js/spraak.js",
  "./js/install.js",
  "./js/app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // "reload" omzeilt de gewone browsercache. Zonder dat kan een nieuwe
      // versie zichzelf vullen met de oude bestanden die daar nog liggen, en
      // dan meldt de app een nieuwe versie terwijl er niets verandert.
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * De app start uit de cache en werkt zichzelf op de achtergrond bij, zodat
 * openen altijd direct gaat — ook onderweg met een slechte verbinding.
 */
async function uitCacheEnBijwerken(request) {
  const cache = await caches.open(CACHE);
  const opgeslagen = await cache.match(request);
  // Ook hier langs de browsercache heen: anders ververst de app zichzelf met
  // een kopie die net zo oud is als wat er al lag.
  const versVerzoek = request.mode === "navigate" ? request : new Request(request.url, { cache: "no-cache" });
  const netwerk = fetch(versVerzoek)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (opgeslagen) return opgeslagen;
  const vers = await netwerk;
  if (vers) return vers;
  if (request.mode === "navigate") {
    const shell = await cache.match("./index.html");
    if (shell) return shell;
  }
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Alles richting de bridge gaat rechtstreeks: dat zijn live gegevens.
  if (url.origin !== self.location.origin) return;
  event.respondWith(uitCacheEnBijwerken(request));
});
