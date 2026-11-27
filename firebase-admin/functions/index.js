/* Trasso – funcție doar pentru admin: „Dă PRO+ unui cont” (din admin.html).
   E într-un codebase separat („admin”), ca să nu atingă funcțiile existente la deploy.
   Scrie în bonusEnt, la fel ca recompensele din invitații, deci se păstrează când
   abonamentele pornesc și când Google Play trimite notificări. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

const ADMINS = ['asahixu02@gmail.com'];
const DAY = 24 * 60 * 60 * 1000;
const FOREVER = Date.UTC(2100, 0, 1); // „permanent”

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
const ts = (n) => (n > 0 ? Timestamp.fromMillis(n) : null);
function computeEnt(playEnt = {}, bonusEnt = {}) {
  const proplus = Math.max(ms(playEnt.proplus), ms(bonusEnt.proplus));
  const pro = Math.max(ms(playEnt.pro), ms(bonusEnt.pro), proplus);
  return { pro: ts(pro), proplus: ts(proplus) };
}

exports.adminGrant = onCall({ region: 'europe-west1', maxInstances: 2 }, async (req) => {
  const t = req.auth && req.auth.token;
  if (!t || t.email_verified !== true || !ADMINS.includes(t.email)) throw new HttpsError('permission-denied', 'not-admin');
  const email = String((req.data && req.data.email) || '').trim().toLowerCase();
  const tier = req.data && req.data.tier === 'pro' ? 'pro' : 'proplus';
  const mode = req.data && req.data.mode; // 'days' | 'forever' | 'revoke'
  const days = Math.floor(+((req.data && req.data.days) || 0));
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || email.length > 200) throw new HttpsError('invalid-argument', 'bad-email');
  if (mode === 'days' && (days < 1 || days > 3650)) throw new HttpsError('invalid-argument', 'bad-days');
  if (!['days', 'forever', 'revoke'].includes(mode)) throw new HttpsError('invalid-argument', 'bad-mode');

  let user;
  try { user = await admin.auth().getUserByEmail(email); }
  catch (e) { throw new HttpsError('not-found', 'no-user'); }
  const ref = db.doc(`users/${user.uid}`);

  return db.runTransaction(async (tx) => {
    const u = await tx.get(ref);
    if (!u.exists) throw new HttpsError('not-found', 'no-profile');
    const bonusEnt = { ...(u.get('bonusEnt') || {}) };
    if (mode === 'revoke') {
      bonusEnt[tier] = null;
    } else {
      const until = mode === 'forever' ? FOREVER : Math.max(Date.now(), ms(bonusEnt[tier])) + days * DAY;
      bonusEnt[tier] = Timestamp.fromMillis(until);
    }
    const ent = computeEnt(u.get('playEnt') || {}, bonusEnt);
    tx.update(ref, { bonusEnt, ent, grantedBy: { email: t.email, at: FieldValue.serverTimestamp(), mode, tier } });
    return { ok: true, uid: user.uid, until: ms(bonusEnt[tier]) || 0 };
  });
});
