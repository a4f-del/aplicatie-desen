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
  /* funcții noi, ascunse până le pornești din consola admin (config/app: featColor2, featManhwa).
     Pe un singur dispozitiv le poți porni pentru test: din consola admin („pe acest dispozitiv”) sau cu ?beta=color2,manhwa (?beta=off le oprește). */
  window.trFeat = function (name) {
    try { var b = localStorage.getItem('trasso-beta') || ''; if (b === 'all' || (',' + b + ',').indexOf(',' + name + ',') >= 0) return true; } catch (e) {}
    var s = load(), cfg = s.cfg || {};
    /* testeri aleși din consola admin: config/app.beta = { uid: ['manhwa', 'color2'] } */
    var mine = s.uid && cfg.beta ? cfg.beta[s.uid] : null;
    if (Array.isArray(mine) && mine.indexOf(name) >= 0) return true;
    return cfg['feat' + name.charAt(0).toUpperCase() + name.slice(1)] === true;
  };
  try {
    var bm = /[?&]beta=([A-Za-z0-9,]+)/.exec(location.search);
    if (bm) { if (bm[1] === 'off') localStorage.removeItem('trasso-beta'); else localStorage.setItem('trasso-beta', bm[1].toLowerCase()); }
  } catch (e) {}
  /* codul de invitație din link (?inv=ABC123) se ține minte până se folosește */
  try {
    var m = /[?&]inv=([A-Za-z0-9]{6})\b/.exec(location.search);
    if (m) localStorage.setItem('trasso-inv', m[1].toUpperCase());
  } catch (e) {}
})();
