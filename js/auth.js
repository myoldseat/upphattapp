// ─── All authentication & user processing ───
import {
  auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut,
  collection, setDoc, doc, getDoc, getDocs, query, where, serverTimestamp
} from './firebase-config.js';
import { S }  from './state.js';
import { goTo } from './helpers.js';
import { setupChildHome, cancelReading } from './child-view.js';
import { startFamilyListener } from './parent-view.js';

let _signupInProgress = false;

async function restoreMissingCodeDocsFromProfile(familyId, children) {
  if (!familyId || !Array.isArray(children) || !children.length) return;

  const jobs = children.map(async (c) => {
    const code = (c?.code || '').toString().trim().toUpperCase();
    const childKey = c?.key;
    const childName = c?.name;
    if (!code || !childKey || !childName) return;

    try {
      const ref = doc(db, 'codes', code);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, { familyId, childKey, childName });
      }
    } catch (e) {
      console.warn('Could not restore code doc for', code, e);
    }
  });

  await Promise.all(jobs);
}

// ── Process authenticated parent ──
async function processAuthUser(user) {
  const snap    = await getDoc(doc(db, 'users', user.uid));
  const profile = snap.exists() ? snap.data() : null;

  S.role       = 'parent';
  S.familyId   = profile?.familyId || user.uid;
  S.parentName = (profile?.name || 'Foreldri').split(' ')[0];
  S.parentChildren    = profile?.children || [];
  S.expandedChildren  = {};

  // Self-heal missing code docs so children can always log in with saved profile codes.
  await restoreMissingCodeDocsFromProfile(S.familyId, S.parentChildren);

  document.getElementById('parent-pill').textContent = S.parentName;
  document.getElementById('parent-hero').textContent = `Góðan dag, ${S.parentName}`;

  // Show child codes
  if (S.parentChildren.length) {
    document.getElementById('codes-list').innerHTML =
      S.parentChildren.map(c => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.15)">
          <div style="font-size:13px;font-weight:800;color:white">👦 ${c.name}</div>
          <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:rgba(255,255,255,0.9);letter-spacing:3px">${c.code || '—'}</div>
        </div>`).join('');
  } else {
    // Fallback: fetch codes from codes collection
    try {
      const codesQ    = query(collection(db, 'codes'), where('familyId', '==', S.familyId));
      const codesSnap = await getDocs(codesQ);
      if (!codesSnap.empty) {
        const codes = codesSnap.docs.map(d => ({ code: d.id, ...d.data() }));
        S.parentChildren = codes.map(c => ({ name: c.childName, key: c.childKey, code: c.code }));
        document.getElementById('codes-list').innerHTML =
          codes.map(c => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.15)">
              <div style="font-size:13px;font-weight:800;color:white">👦 ${c.childName}</div>
              <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:rgba(255,255,255,0.9);letter-spacing:3px">${c.code}</div>
            </div>`).join('');
      }
    } catch (e) { console.error('Kóðaleit villa:', e); }
  }

  startFamilyListener();
  goTo('screen-parent-home');

  const _le = document.getElementById('login-email');
  const _lp = document.getElementById('login-pw');
  const _lr = document.getElementById('login-error');
  if (_le) _le.disabled = false;
  if (_lp) _lp.disabled = false;
  if (_lr) _lr.textContent = '';
}

// ── Parent login ──
export async function firebaseLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-pw').value;
  const err   = document.getElementById('login-error');
  err.textContent = '';
  if (!email || !pw) { err.textContent = 'Sláðu inn netfang og lykilorð.'; return; }

  try {
    document.getElementById('login-email').disabled = true;
    document.getElementById('login-pw').disabled    = true;
    const cred = await signInWithEmailAndPassword(auth, email, pw);
    await processAuthUser(cred.user);
  } catch (e) {
    console.error('Login villa:', e);
    err.textContent = 'Innskráning mistókst — athugaðu netfang og lykilorð.';
    document.getElementById('login-email').disabled = false;
    document.getElementById('login-pw').disabled    = false;
  }
}

// ── Parent login popup (from kid landing) ──
export function openParentLoginPopup() {
  const modal = document.getElementById('parent-login-popup');
  if (!modal) return;
  modal.style.display = 'grid';
}

export function closeParentLoginPopup() {
  const modal = document.getElementById('parent-login-popup');
  const err   = document.getElementById('popup-login-error');
  const emailEl = document.getElementById('popup-login-email');
  const pwEl = document.getElementById('popup-login-pw');
  if (modal) modal.style.display = 'none';
  if (err) err.textContent = '';
  if (emailEl) emailEl.disabled = false;
  if (pwEl) pwEl.disabled = false;
}

export async function parentLoginFromPopup() {
  const emailEl = document.getElementById('popup-login-email');
  const pwEl    = document.getElementById('popup-login-pw');
  const errEl   = document.getElementById('popup-login-error');
  if (!emailEl || !pwEl || !errEl) return;

  const email = emailEl.value.trim();
  const pw    = pwEl.value;
  errEl.textContent = '';
  if (!email || !pw) {
    errEl.textContent = 'Sláðu inn netfang og lykilorð.';
    return;
  }

  try {
    emailEl.disabled = true;
    pwEl.disabled    = true;
    const cred = await signInWithEmailAndPassword(auth, email, pw);
    closeParentLoginPopup();
    await processAuthUser(cred.user);
  } catch (e) {
    console.error('Popup login villa:', e);
    errEl.textContent = 'Innskráning mistókst — athugaðu netfang og lykilorð.';
    emailEl.disabled = false;
    pwEl.disabled    = false;
  }
}

// ── Parent signup ──
export function addChildInput() {
  const container = document.getElementById('signup-children-list');
  const div = document.createElement('div');
  div.className = 'form-group';
  div.innerHTML = '<input class="child-name-input" type="text" placeholder="Nafn barns">';
  container.appendChild(div);
}

export async function firebaseSignup() {
  const name    = document.getElementById('reg-name').value.trim();
  const email   = document.getElementById('reg-email').value.trim();
  const pw      = document.getElementById('reg-pw').value.trim();
  const errorEl = document.getElementById('reg-error');
  const childNames = Array.from(document.querySelectorAll('.child-name-input'))
    .map(i => i.value.trim()).filter(v => v !== '');

  if (!name || !email || pw.length < 6 || childNames.length === 0) {
    errorEl.textContent = 'Vinsamlegast fylltu út allt og bættu við barni.'; return;
  }

  try {
    errorEl.style.color = 'var(--ocean)';
    errorEl.textContent = 'Stofna fjölskyldu... ⏳';
    _signupInProgress = true;

    const userCred = await createUserWithEmailAndPassword(auth, email, pw);
    const uid      = userCred.user.uid;
    const familyId = 'FAM-' + Math.random().toString(36).substr(2, 5).toUpperCase();

    const childrenArray = [];
    for (const cName of childNames) {
      const loginCode = cName.replace(/\s/g, '').substr(0, 3).toUpperCase() + Math.floor(10 + Math.random() * 90);
      const childKey  = Math.random().toString(36).substr(2, 8);
      await setDoc(doc(db, 'codes', loginCode), { familyId, childKey, childName: cName });
      childrenArray.push({ name: cName, key: childKey, code: loginCode });
    }

    await setDoc(doc(db, 'users', uid), {
      name, email, role: 'parent', familyId,
      children: childrenArray,
      createdAt: serverTimestamp()
    });

    await signOut(auth);
    _signupInProgress = false;

    alert('Aðgangur tilbúinn! Þú getur nú skráð þig inn.');
    openParentLoginPopup();
  } catch (e) {
    _signupInProgress = false;
    errorEl.style.color = 'var(--coral)';
    errorEl.textContent = 'Villa: ' + e.message;
    try { await signOut(auth); } catch (_) { /* ok */ }
  }
}

// ── Child login ──
export async function childLogin() {
  const rawCode = document.getElementById('child-code-input').value || '';
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  const err  = document.getElementById('child-code-error');
  err.textContent = '';
  if (code.length < 4) { return; }

  try {
    document.getElementById('child-code-input').disabled = true;
    const snap = await getDoc(doc(db, 'codes', code));
    if (!snap.exists()) {
      err.textContent = 'Kóðinn fannst ekki — athugaðu með foreldri.';
      document.getElementById('child-code-input').disabled = false;
      return;
    }
    const data = snap.data();
    S.role = 'child'; S.familyId = data.familyId;
    S.childKey = data.childKey; S.childName = data.childName;
    localStorage.setItem('upphatt_child', JSON.stringify({
      familyId: data.familyId, childKey: data.childKey, childName: data.childName, code
    }));
    localStorage.setItem('childName', data.childName);
    window.location.href = 'child-v2.html';
  } catch (e) {
    err.textContent = 'Villa: ' + e.message;
    document.getElementById('child-code-input').disabled = false;
  }
}

// ── Logout ──
export async function logout() {
  if (S.role === 'child') {
    if (confirm('Skrá þig út? Þú þarft kóðann aftur til að skrá þig inn.')) {
      localStorage.removeItem('upphatt_child');
      S.role = null; S.familyId = null; S.childKey = null; S.childName = null;
      cancelReading();
      goTo('screen-child-login');
    }
    return;
  }
  if (confirm('Viltu skrá þig út?')) {
    if (S.familyUnsub) { S.familyUnsub(); S.familyUnsub = null; }
    await signOut(auth);
    localStorage.clear();
    location.reload();
  }
}

// ── Auth state observer ──
export function initAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (_signupInProgress) return;

    if (user) {
      try {
        await processAuthUser(user);
      } catch (e) {
        console.error('Auth villa:', e);
        const _le = document.getElementById('login-email');
        const _lp = document.getElementById('login-pw');
        const _lr = document.getElementById('login-error');
        if (_le) _le.disabled = false;
        if (_lp) _lp.disabled = false;
        if (_lr) _lr.textContent = 'Villa við innskráningu. Reyndu aftur.';
        openParentLoginPopup();
      }
      return;
    }

    // No user signed in
    if (S.familyUnsub) { S.familyUnsub(); S.familyUnsub = null; }
    S.sessions = [];

    const skipChildRedirectOnce = sessionStorage.getItem('upphatt_skip_child_redirect_once') === '1';
    if (skipChildRedirectOnce) {
      sessionStorage.removeItem('upphatt_skip_child_redirect_once');
      goTo('screen-child-login');
      return;
    }

    // Check for saved child session
    const saved = localStorage.getItem('upphatt_child');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        S.role = 'child'; S.familyId = data.familyId;
        S.childKey = data.childKey; S.childName = data.childName;
          localStorage.setItem('childName', data.childName || 'Lesari');
          window.location.href = 'child-v2.html';
        return;
      } catch (e) { localStorage.removeItem('upphatt_child'); }
    }

    goTo('screen-child-login');
  });
}