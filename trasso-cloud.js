/* Trasso Cloud – conturi, abonamente, invitații, salvare în cloud (Firebase, proiect trasso-sub).
   Se încarcă la final, ca modul: <script type="module" src="trasso-cloud.js"></script>
   Dacă nu e internet, aplicația merge normal; trEnt() folosește ultima stare salvată.
   API global: window.TC = { openAccount, signIn, signOut, redeem, cloudSaveCurrent, cloudList, cloudOpen, cloudDelete, state } */
const V = '12.0.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;
const { initializeApp } = await import(`${CDN}/firebase-app.js`);
const A = await import(`${CDN}/firebase-auth.js`);
const F = await import(`${CDN}/firebase-firestore.js`);
const FN = await import(`${CDN}/firebase-functions.js`);

const firebaseConfig = {
  apiKey: 'AIzaSyCse1cEsIUsA89pAMe7GByUXkW6L9Sq0K0',
  authDomain: 'trasso-sub.firebaseapp.com',
  projectId: 'trasso-sub',
  storageBucket: 'trasso-sub.firebasestorage.app',
  messagingSenderId: '1068653973101',
  appId: '1:1068653973101:web:98bb92fd2179b2d9367964',
};

const app = initializeApp(firebaseConfig);
const auth = A.initializeAuth(app, {
  persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence],
  popupRedirectResolver: A.browserPopupRedirectResolver,
});
const db = F.getFirestore(app);
const fns = FN.getFunctions(app, 'europe-west1');
let ST = null; // Storage se încarcă doar când e nevoie
async function storage() {
  if (!ST) {
    const S = await import(`${CDN}/firebase-storage.js`);
    ST = { S, st: S.getStorage(app) };
  }
  return ST;
}

/* ---------- texte RO / EN ---------- */
const EN = () => !!(window.__i18n && window.__i18n.on);
const T = (ro, en) => (EN() ? en : ro);
const say = (m) => { try { (window.drMsg || console.log)(m); } catch (e) {} };
const fmtDate = (n) => new Date(n).toLocaleDateString(EN() ? 'en-GB' : 'ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });

/* ---------- starea salvată local (citită de trasso-ent.js) ---------- */
const KEY = 'trasso-cloud-v1';
const state = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } })();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  window.dispatchEvent(new CustomEvent('trasso-cloud', { detail: state }));
  if (OPEN) render();
}
const toMs = (t) => (t && t.toMillis ? t.toMillis() : 0);

/* ---------- comutatoarele (config/app) ---------- */
F.onSnapshot(F.doc(db, 'config/app'), (s) => {
  const d = s.exists() ? s.data() : {};
  state.cfg = {
    billingEnabled: d.billingEnabled === true,
    referralEnabled: d.referralEnabled !== false,
    referralRewardDays: d.referralRewardDays ?? 30,
    referralMaxPerUser: d.referralMaxPerUser ?? 2,
    cloudMaxProjects: d.cloudMaxProjects ?? 10,
    cloudMaxMB: d.cloudMaxMB ?? 50,
  };
  save();
}, () => {});

/* ---------- contul ---------- */
let unsubUser = null;
A.onAuthStateChanged(auth, async (u) => {
  if (unsubUser) { unsubUser(); unsubUser = null; }
  if (!u) {
    Object.assign(state, { uid: null, name: null, email: null, ent: {}, code: null, bonusDays: 0, invited: 0, referredBy: null });
    save();
    return;
  }
  Object.assign(state, { uid: u.uid, name: u.displayName || '', email: u.email || '' });
  save();
  const ref = F.doc(db, 'users', u.uid);
  try {
    const snap = await F.getDoc(ref);
    const lang = EN() ? 'en' : 'ro';
    if (!snap.exists()) {
      await F.setDoc(ref, {
        email: u.email || '', displayName: (u.displayName || '').slice(0, 80), photoURL: (u.photoURL || '').slice(0, 500),
        lang, createdAt: F.serverTimestamp(), lastSeen: F.serverTimestamp(),
      });
    } else {
      await F.updateDoc(ref, { lastSeen: F.serverTimestamp(), lang });
    }
  } catch (e) { console.warn('[Trasso] profil', e); }
  unsubUser = F.onSnapshot(ref, (s) => {
    const d = s.data() || {};
    const e = d.ent || {};
    Object.assign(state, {
      ent: { pro: toMs(e.pro), proplus: toMs(e.proplus) },
      code: d.referralCode || null,
      bonusDays: d.bonusDays || 0,
      rewarded: d.referralRewarded || 0,
      invited: d.referralCount || 0,
      referredBy: d.referredBy || null,
      createdAt: toMs(d.createdAt),
    });
    save();
    autoRedeem();
  }, () => {});
});

async function signIn() {
  try {
    await A.signInWithPopup(auth, new A.GoogleAuthProvider());
    say(T('Te-ai conectat.', 'You are signed in.'));
  } catch (e) {
    if (e && e.code === 'auth/popup-closed-by-user') return;
    say(T('Nu am putut face conectarea. Verifică internetul.', "Couldn't sign in. Check your internet connection."));
    console.warn(e);
  }
}
async function signOut() { await A.signOut(auth); say(T('Te-ai deconectat.', 'You are signed out.')); }

/* ---------- invitații ---------- */
const ERR = {
  'bad-code': ['Codul are 6 caractere (litere și cifre).', 'The code has 6 characters (letters and digits).'],
  'no-code': ['Codul nu există.', "That code doesn't exist."],
  'own-code': ['Nu poți folosi propriul cod.', "You can't use your own code."],
  'already-used': ['Ai folosit deja un cod de invitație.', 'You already used an invite code.'],
  'account-too-old': ['Codurile de invitație sunt doar pentru conturi noi.', 'Invite codes are only for new accounts.'],
  'campaign-off': ['Campania de invitații s-a încheiat.', 'The invite campaign has ended.'],
  'no-profile': ['Mai încearcă o dată peste câteva secunde.', 'Try again in a few seconds.'],
  'circular': ['Nu poți folosi codul cuiva pe care l-ai invitat tu.', "You can't use the code of someone you invited."],
  'email-not-verified': ['Contul trebuie să aibă emailul confirmat.', 'Your account needs a verified email.'],
};
async function redeem(code) {
  if (!auth.currentUser) return signIn();
  try {
    await FN.httpsCallable(fns, 'redeemInvite')({ code: String(code || '').trim().toUpperCase() });
    try { localStorage.removeItem('trasso-inv'); } catch (e) {}
    say(T('Gata! Prietenul tău a primit recompensa. Bun venit în Trasso!', 'Done! Your friend got the reward. Welcome to Trasso!'));
    return true;
  } catch (e) {
    const k = (e && e.message) || '';
    const m = ERR[k];
    if (k === 'already-used' || k === 'own-code' || k === 'account-too-old' || k === 'campaign-off') { try { localStorage.removeItem('trasso-inv'); } catch (x) {} }
    say(m ? T(m[0], m[1]) : T('Nu am putut folosi codul. Încearcă din nou.', "Couldn't use the code. Try again."));
    return false;
  }
}
let redeeming = false;
function autoRedeem() {
  let c = null;
  try { c = localStorage.getItem('trasso-inv'); } catch (e) {}
  if (!c || redeeming || !state.uid || state.referredBy || !state.createdAt) return;
  if (c === state.code) { try { localStorage.removeItem('trasso-inv'); } catch (e) {} return; }
  redeeming = true;
  redeem(c).finally(() => { redeeming = false; });
}
const inviteLink = () => `https://a4f-del.github.io/aplicatie-desen/?inv=${state.code}`;
async function shareInvite() {
  if (!state.code) return;
  const text = T(
    `Desenez manga în Trasso. Instalează aplicația și folosește codul meu ${state.code}: ${inviteLink()}`,
    `I draw manga in Trasso. Install the app and use my code ${state.code}: ${inviteLink()}`);
  try {
    if (navigator.share) await navigator.share({ title: 'Trasso', text });
    else { await navigator.clipboard.writeText(text); say(T('Am copiat invitația.', 'Invite copied.')); }
  } catch (e) {}
}

/* ---------- salvare în cloud ---------- */
const safeId = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || ('p' + Date.now().toString(36));
async function cloudList() {
  if (!auth.currentUser) return [];
  const q = F.query(F.collection(db, 'users', auth.currentUser.uid, 'projects'), F.orderBy('updatedAt', 'desc'));
  const s = await F.getDocs(q);
  return s.docs.map((d) => ({ id: d.id, ...d.data(), updatedAt: toMs(d.get('updatedAt')) }));
}
async function cloudSaveCurrent() {
  const u = auth.currentUser;
  if (!u) return signIn();
  if (!window.trEnt || !window.trEnt('pro')) return say(T('Salvarea în cloud face parte din Trasso Pro.', 'Cloud saving is part of Trasso Pro.'));
  const DR = window.DR;
  if (!DR || !DR.ready || typeof window.drProjBlob !== 'function') return say(T('Deschide întâi un desen.', 'Open a drawing first.'));
  if (DR.float && typeof window.drFloatCommit === 'function') window.drFloatCommit();
  const cfg = state.cfg || {};
  const pid = safeId(DR.id);
  const list = await cloudList();
  if (!list.some((p) => p.id === pid) && list.length >= (cfg.cloudMaxProjects || 10)) {
    return say(T(`Poți ține cel mult ${cfg.cloudMaxProjects || 10} desene în cloud. Șterge unul mai vechi.`, `You can keep up to ${cfg.cloudMaxProjects || 10} drawings in the cloud. Delete an older one.`));
  }
  say(T('Pregătesc desenul pentru cloud…', 'Preparing the drawing for the cloud…'));
  const blob = await window.drProjBlob();
  const maxB = (cfg.cloudMaxMB || 50) * 1024 * 1024;
  if (blob.size > maxB) return say(T(`Desenul are peste ${cfg.cloudMaxMB || 50} MB și nu încape în cloud.`, `The drawing is over ${cfg.cloudMaxMB || 50} MB and doesn't fit in the cloud.`));
  const path = `users/${u.uid}/projects/${pid}.zip`;
  try {
    const { S, st } = await storage();
    say(T('Încarc în cloud…', 'Uploading to the cloud…'));
    await S.uploadBytes(S.ref(st, path), blob, { contentType: 'application/zip' });
    await F.setDoc(F.doc(db, 'users', u.uid, 'projects', pid), {
      name: String(DR.name || 'Proiect').slice(0, 60), w: DR.w | 0, h: DR.h | 0, kind: String(DR.kind || ''),
      layers: (DR.layers || []).length, size: blob.size, path, updatedAt: F.serverTimestamp(),
    });
    say(T('Salvat în cloud.', 'Saved to the cloud.'));
    if (OPEN) render();
  } catch (e) {
    console.warn(e);
    say(T('Nu am putut salva în cloud. Verifică internetul.', "Couldn't save to the cloud. Check your internet connection."));
  }
}
async function cloudOpen(pid) {
  const u = auth.currentUser;
  if (!u || typeof window.drImportProject !== 'function') return;
  try {
    const { S, st } = await storage();
    say(T('Descarc din cloud…', 'Downloading from the cloud…'));
    const b = await S.getBlob(S.ref(st, `users/${u.uid}/projects/${safeId(pid)}.zip`));
    closeAcc();
    await window.drImportProject(new File([b], pid + '.zip', { type: 'application/zip' }));
  } catch (e) {
    console.warn(e);
    say(T('Nu am putut descărca desenul.', "Couldn't download the drawing."));
  }
}
async function cloudDelete(pid) {
  const u = auth.currentUser;
  if (!u) return;
  const { S, st } = await storage();
  try { await S.deleteObject(S.ref(st, `users/${u.uid}/projects/${safeId(pid)}.zip`)); } catch (e) {}
  await F.deleteDoc(F.doc(db, 'users', u.uid, 'projects', safeId(pid)));
}

async function deleteAccount() {
  if (!auth.currentUser) return;
  const ok1 = confirm(T('Ștergi contul Trasso și tot ce e salvat în cloud? Desenele de pe tabletă rămân.', 'Delete your Trasso account and everything saved in the cloud? Drawings on this tablet stay.'));
  if (!ok1 || !confirm(T('Sigur? Nu se mai poate anula.', "Are you sure? This can't be undone."))) return;
  try {
    await FN.httpsCallable(fns, 'deleteMyAccount')({});
    await A.signOut(auth);
    say(T('Contul a fost șters.', 'Your account was deleted.'));
    closeAcc();
  } catch (e) {
    say(T('Nu am putut șterge contul. Încearcă din nou.', "Couldn't delete the account. Try again."));
  }
}

/* ---------- fereastra „Cont” ---------- */
let OPEN = null;
function E(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function B(txt, fn, cls) { const b = E('button', 'btn' + (cls ? ' ' + cls : ''), txt); b.type = 'button'; b.addEventListener('click', fn); return b; }
function closeAcc() { if (OPEN) { OPEN.close(); OPEN = null; } }
function openAccount() {
  if (OPEN) return;
  if (typeof window.fltOv === 'function') {
    OPEN = window.fltOv(T('Cont Trasso', 'Trasso account'), () => { OPEN = null; });
  } else {
    const ov = E('div', 'chrov'), card = E('div', 'chrcard'), hd = E('div', 'chrhd');
    hd.appendChild(E('b', null, T('Cont Trasso', 'Trasso account')));
    const x = B('✕', () => closeAcc(), 'sm'); hd.appendChild(x);
    card.appendChild(hd); ov.appendChild(card); document.body.appendChild(ov);
    OPEN = { ov, card, close: () => ov.remove() };
  }
  const body = E('div', 'tcbody'); body.style.cssText = 'display:grid;gap:14px;padding:4px 2px 8px;max-width:520px';
  OPEN.card.appendChild(body);
  OPEN.body = body;
  render();
}
function sec(title) { const s = E('section'); s.style.cssText = 'display:grid;gap:8px'; s.appendChild(E('b', null, title)); OPEN.body.appendChild(s); return s; }
function note(p, t) { const n = E('p', 'note', t); n.style.margin = '0'; p.appendChild(n); return n; }
function row(p) { const r = E('div'); r.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center'; p.appendChild(r); return r; }

function render() {
  if (!OPEN || !OPEN.body) return;
  const b = OPEN.body; b.innerHTML = '';
  const cfg = state.cfg || {};
  if (!state.uid) {
    const s = sec(T('Conectează-te', 'Sign in'));
    note(s, T('Cu un cont îți păstrezi abonamentul pe orice tabletă, salvezi desene în cloud și primești PRO+ gratuit când îți inviți prietenii.',
      'With an account you keep your subscription on any tablet, save drawings to the cloud and get free PRO+ when you invite friends.'));
    row(s).appendChild(B(T('Conectează-te cu Google', 'Sign in with Google'), signIn, 'pri'));
    const pn = note(s, T('Continuând, ești de acord cu ', 'By continuing you agree to the '));
    const a = E('a', null, T('politica de confidențialitate', 'privacy policy'));
    a.href = 'privacy.html?lang=' + (EN() ? 'en' : 'ro'); a.target = '_blank'; a.rel = 'noopener';
    pn.appendChild(a); pn.appendChild(document.createTextNode('.'));
    return;
  }
  /* cine ești + abonament */
  const s1 = sec(state.name || state.email || T('Contul tău', 'Your account'));
  if (state.email) note(s1, state.email);
  const now = Date.now(), e = state.ent || {};
  if (!cfg.billingEnabled) {
    note(s1, T('⭐ Acum PRO și PRO+ sunt gratuite pentru toată lumea.', '⭐ PRO and PRO+ are free for everyone right now.'));
  } else if ((e.proplus || 0) > now) {
    note(s1, T(`⭐ PRO+ activ până pe ${fmtDate(e.proplus)}.`, `⭐ PRO+ active until ${fmtDate(e.proplus)}.`));
  } else if ((e.pro || 0) > now) {
    note(s1, T(`⭐ PRO activ până pe ${fmtDate(e.pro)}.`, `⭐ PRO active until ${fmtDate(e.pro)}.`));
  } else {
    note(s1, T('Nu ai un abonament activ.', "You don't have an active subscription."));
  }
  if (state.bonusDays > 0) {
    note(s1, T(`🎁 Ai strâns ${state.bonusDays} zile de PRO+ din invitații. Încep să curgă când pornesc abonamentele, deci nu le pierzi.`,
      `🎁 You've collected ${state.bonusDays} days of PRO+ from invites. They start counting when subscriptions begin, so you won't lose them.`));
  }
  /* invitații */
  if (cfg.referralEnabled) {
    const s2 = sec(T('Invită prieteni', 'Invite friends'));
    const days = cfg.referralRewardDays || 30;
    const maxR = cfg.referralMaxPerUser ?? 2;
    note(s2, T(`Pentru fiecare prieten care își face cont cu codul tău primești ${days} de zile de PRO+ gratuit, pentru cel mult ${maxR} prieteni.`,
      `For every friend who creates an account with your code you get ${days} days of PRO+ for free, for up to ${maxR} friends.`));
    if (state.code) {
      const c = E('div', null, state.code);
      c.style.cssText = 'font:600 28px/1.2 "IBM Plex Mono",monospace;letter-spacing:.18em';
      s2.appendChild(c);
      const r = row(s2);
      r.appendChild(B(T('Trimite invitația', 'Send invite'), shareInvite, 'pri'));
      r.appendChild(B(T('Copiază codul', 'Copy code'), () => navigator.clipboard.writeText(state.code).then(() => say(T('Cod copiat.', 'Code copied.')))));
      if (state.invited) note(s2, T(`Prieteni invitați: ${state.invited} · recompense primite: ${Math.min(state.rewarded || 0, maxR)} din ${maxR}`, `Friends invited: ${state.invited} · rewards received: ${Math.min(state.rewarded || 0, maxR)} of ${maxR}`));
    } else {
      note(s2, T('Îți pregătesc codul…', 'Preparing your code…'));
    }
    if (!state.referredBy && state.createdAt && now - state.createdAt < 14 * 864e5) {
      const s3 = sec(T('Ai un cod de la un prieten?', 'Got a code from a friend?'));
      const r = row(s3);
      const inp = E('input'); inp.type = 'text'; inp.maxLength = 6; inp.placeholder = 'ABC123'; inp.autocapitalize = 'characters';
      inp.style.cssText = 'width:9em;text-transform:uppercase;font-family:"IBM Plex Mono",monospace';
      try { inp.value = localStorage.getItem('trasso-inv') || ''; } catch (x) {}
      r.appendChild(inp);
      r.appendChild(B(T('Folosește codul', 'Use code'), () => redeem(inp.value)));
    }
  }
  /* cloud */
  const s4 = sec(T('Desene în cloud', 'Drawings in the cloud'));
  note(s4, T(`Păstrezi până la ${cfg.cloudMaxProjects || 10} desene, câte ${cfg.cloudMaxMB || 50} MB fiecare, și le deschizi pe altă tabletă.`,
    `Keep up to ${cfg.cloudMaxProjects || 10} drawings, ${cfg.cloudMaxMB || 50} MB each, and open them on another tablet.`));
  if (window.DR && window.DR.ready) row(s4).appendChild(B(T('Salvează desenul deschis în cloud', 'Save the open drawing to the cloud'), cloudSaveCurrent, 'pri'));
  const list = E('div'); list.style.cssText = 'display:grid;gap:6px'; s4.appendChild(list);
  list.appendChild(E('p', 'note', T('Încarc lista…', 'Loading the list…')));
  cloudList().then((items) => {
    list.innerHTML = '';
    if (!items.length) { list.appendChild(E('p', 'note', T('Nimic în cloud încă.', 'Nothing in the cloud yet.'))); return; }
    items.forEach((p) => {
      const r = row(list);
      const t = E('span', null, `${p.name} · ${(p.size / 1048576).toFixed(1)} MB${p.updatedAt ? ' · ' + fmtDate(p.updatedAt) : ''}`);
      t.style.flex = '1';
      r.appendChild(t);
      r.appendChild(B(T('Deschide', 'Open'), () => cloudOpen(p.id), 'sm'));
      r.appendChild(B(T('Șterge', 'Delete'), () => { if (confirm(T(`Ștergi „${p.name}” din cloud?`, `Delete “${p.name}” from the cloud?`))) cloudDelete(p.id).then(render); }, 'sm'));
    });
  }, () => { list.innerHTML = ''; list.appendChild(E('p', 'note', T('Nu am putut încărca lista.', "Couldn't load the list."))); });
  /* ieșire */
  const s5 = sec(T('Cont', 'Account'));
  const r5 = row(s5);
  r5.appendChild(B(T('Deconectează-te', 'Sign out'), signOut));
  r5.appendChild(B(T('Șterge contul', 'Delete account'), deleteAccount));
  const pl = E('a', null, T('Politica de confidențialitate', 'Privacy policy'));
  pl.href = 'privacy.html?lang=' + (EN() ? 'en' : 'ro'); pl.target = '_blank'; pl.rel = 'noopener';
  s5.appendChild(pl);
}

/* ---------- butonul „Cont” în bara de sus de pe Acasă ---------- */
const USVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
function addButton() {
  const top = document.querySelector('#home .hmtop');
  if (!top) return false;
  if (top.querySelector('.tcacc')) return true;
  const b = E('button', 'btn tcacc'); b.type = 'button';
  b.setAttribute('aria-label', T('Cont', 'Account')); b.title = T('Cont', 'Account');
  b.innerHTML = USVG;
  b.addEventListener('click', openAccount);
  const g = top.querySelector('.lgb');
  if (g) top.insertBefore(b, g); else top.appendChild(b);
  return true;
}
let tries = 0;
(function wait() { if (!addButton() && tries++ < 120) setTimeout(wait, 500); })();

window.TC = { openAccount, signIn, signOut, redeem, shareInvite, cloudSaveCurrent, cloudList, cloudOpen, cloudDelete, deleteAccount, state, auth };
