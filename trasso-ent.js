/* Trasso – drepturi PRO / PRO+ (sincron, merge și offline).
   Se încarcă ÎNAINTEA scriptului principal din index.html.
   Citește ultima stare salvată de trasso-cloud.js. Cât timp butonul „Abonamente active”
   e oprit (billingEnabled = false), totul e gratuit, exact ca PRO_LAUNCH_FREE de acum. */
(function () {
  var KEY = 'trasso-cloud-v1';
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  /* tier: 'pro' sau 'proplus'. PRO+ include PRO. */
  window.trEnt = function (tier) {
    var s = load(), cfg = s.cfg;
    if (!cfg || cfg.billingEnabled !== true) return true; // perioada gratuită (sau nu știm încă)
    var e = s.ent || {}, now = Date.now();
    var pp = +e.proplus || 0, p = Math.max(+e.pro || 0, pp);
    return tier === 'proplus' ? pp > now : p > now;
  };
  /* Când abonamentele sunt pornite și cineva atinge o funcție PRO: deschide ecranul cu planuri
     (cere întâi contul). Întoarce true dacă s-a deschis ecranul. Cât timp sunt oprite, nu se ajunge aici. */
  window.trUpsell = function (tier) {
    var s = load();
    if (!s.cfg || s.cfg.billingEnabled !== true) return false;
    if (!window.TC || typeof window.TC.openPlans !== 'function') return false;
    window.TC.openPlans(tier === 'proplus' ? 'proplus' : 'pro');
    return true;
  };
  /* codul de invitație din link (?inv=ABC123) se ține minte până se folosește */
  try {
    var m = /[?&]inv=([A-Za-z0-9]{6})\b/.exec(location.search);
    if (m) localStorage.setItem('trasso-inv', m[1].toUpperCase());
  } catch (e) {}
})();
