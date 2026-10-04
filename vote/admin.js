// Admin joueurs : ajout et modification des joueurs (fiche + photos) par les organisateurs, connectés avec Google.
// La page dépose une demande dans Firestore (playerRequests) ; le workflow .github/workflows/joueurs.yml la reprend
// (scripts/player-requests.js) : commit de joueurs.json et des photos, traitement des photos, redéploiement du vote.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getFirestore, collection, doc, getDocs, setDoc, deleteDoc, query, orderBy, serverTimestamp, Bytes} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {firebaseConfig} from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const REQUESTS = 'playerRequests';
/** Taille d'un morceau de photo dans Firestore (un document est limité à 1 Mio). */
const PART_SIZE = 900 * 1024;
/** Côté le plus long au-delà duquel une photo est réduite avant envoi (les originaux font 2000 × 3000). */
const MAX_SIDE = 3000;

/** Joueur de la ligue : une photo par équipe + les deux t-shirts ; la photo par défaut est le t-shirt fight. */
const LEAGUE_SLOTS = [
  {suffix: '-tshirt-fight', label: 'T-shirt fight', hint: 'photo par défaut', cutout: true},
  {suffix: '-tshirt-happy', label: 'T-shirt happy', hint: 'coach', cutout: true},
  {suffix: '-aigles', label: 'Aigles'},
  {suffix: '-lions', label: 'Lions'},
  {suffix: '-pythons', label: 'Pythons'},
  {suffix: '-requins', label: 'Requins'},
];
/** Joueur hors ligue (équipes internationales…) : une seule photo, au suffixe t-shirt fight. */
const GUEST_SLOTS = [{suffix: '-tshirt-fight', label: 'Photo', hint: 'une seule photo', cutout: true}];
const TEAM_SUFFIXES = ['-aigles', '-lions', '-pythons', '-requins', '-tshirt-happy'];

const $ = (sel) => document.querySelector(sel);
const signinEl = $('#signin'), signoutEl = $('#signout'), whoEl = $('#who'), editorEl = $('#editor'), playerEl = $('#player');
const prenomEl = $('#prenom'), nomEl = $('#nom'), aliasEl = $('#alias'), shortNameEl = $('#shortName'), imgEl = $('#img'), femmeEl = $('#femme');
const slotsEl = $('#slots'), saveEl = $('#save'), dirtyEl = $('#dirty'), statusEl = $('#status');
const requestsSectionEl = $('#requests-section'), requestsEl = $('#requests');

/** Joueurs et vignettes publiés sur la page de vote (data/, copiés par scripts/vote-build.js). */
let players = [];
let photos = {};
/** Joueur en cours d'édition (index dans players), -1 pour un nouveau. */
let current = -1;
/** Nouvelles photos choisies, par suffixe : {blob, ext, cutout}. */
let pending = new Map();
/** Nom des fichiers saisi à la main (nouveau joueur) : on arrête de le déduire du prénom et du nom. */
let imgTouched = false;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const stemOf = (img) => (img || '').replace(/^assets\/joueurs\//, '');
const kind = () => document.querySelector('input[name=kind]:checked').value;
const slots = () => (kind() === 'ligue' ? LEAGUE_SLOTS : GUEST_SLOTS);
const fullName = (p) => [p.prenom, p.alias ? `« ${p.alias} »` : '', p.nom].filter(Boolean).join(' ');

function setStatus(html, error = false) {
  statusEl.innerHTML = html;
  statusEl.classList.toggle('error', error);
}

async function loadPlayers() {
  const json = (url) => fetch(url, {cache: 'no-store'}).then(r => (r.ok ? r.json() : {}));
  [players, photos] = await Promise.all([json('data/joueurs.json'), json('data/photos.json')]);
  if (!Array.isArray(players)) players = [];
}

// --- Formulaire ----------------------------------------------------------------------------------------------------

function renderPlayers() {
  const options = players.map((p, i) => ({i, text: fullName(p)})).sort((a, b) => a.text.localeCompare(b.text, 'fr'));
  playerEl.innerHTML = '<option value="-1">+ Nouveau joueur</option>'
    + options.map(o => `<option value="${o.i}">${escapeHtml(o.text)}</option>`).join('');
  playerEl.value = String(current);
}

function selectPlayer(index) {
  current = index;
  pending = new Map();
  const p = players[index] || {};
  prenomEl.value = p.prenom || '';
  nomEl.value = p.nom || '';
  aliasEl.value = p.alias || '';
  shortNameEl.value = p.shortName || '';
  femmeEl.checked = !!p.femme;
  imgEl.value = stemOf(p.img);
  // Le nom des fichiers d'un joueur existant ne change pas : ses photos sont déjà rangées sous ce nom.
  imgEl.readOnly = !!p.img;
  imgTouched = !!p.img;
  const stem = stemOf(p.img);
  const guest = !!p.img && !!photos[stem + '-tshirt-fight'] && !TEAM_SUFFIXES.some(s => photos[stem + s]);
  document.querySelector(`input[name=kind][value=${guest ? 'hors' : 'ligue'}]`).checked = true;
  renderSlots();
  updateDirty();
}

function renderSlots() {
  const stem = imgEl.value.trim();
  slotsEl.innerHTML = '';
  for (const slot of slots()) {
    const choice = pending.get(slot.suffix);
    const src = choice ? URL.createObjectURL(choice.blob) : (stem && photos[stem + slot.suffix]);
    const el = document.createElement('div');
    el.className = 'slot' + (choice ? ' changed' : '');
    el.innerHTML = `
      <div><div class="slot-title">${slot.label}</div><div class="slot-hint">${slot.hint || '&nbsp;'}</div></div>
      <div class="slot-preview">${src ? `<img src="${src}" alt="" loading="lazy">` : 'aucune photo'}</div>
      <input type="file" accept="image/jpeg,image/png,image/webp">
      <label><input type="checkbox" ${choice ? (choice.cutout ? 'checked' : '') : 'disabled'}> Détourer</label>`;
    const [fileEl, cutoutEl] = el.querySelectorAll('input');
    fileEl.addEventListener('change', async () => {
      const file = fileEl.files[0];
      if (!file) return;
      try {
        const prepared = await prepare(file);
        // Un PNG envoyé est en général déjà détouré : pas de détourage par défaut.
        pending.set(slot.suffix, {...prepared, cutout: prepared.ext !== 'png' && !!slot.cutout});
        renderSlots();
        updateDirty();
      } catch (e) {
        setStatus(escapeHtml(e.message), true);
      }
    });
    cutoutEl.addEventListener('change', () => {
      const c = pending.get(slot.suffix);
      if (c) c.cutout = cutoutEl.checked;
    });
    slotsEl.appendChild(el);
  }
}

function updateDirty() {
  dirtyEl.textContent = pending.size ? `${pending.size} photo${pending.size > 1 ? 's' : ''} à envoyer` : '';
}

/** Photo prête à envoyer : format vérifié, réduite si elle dépasse MAX_SIDE (orientation EXIF appliquée). */
async function prepare(file) {
  const ext = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[file.type];
  if (!ext) throw new Error(`Format non pris en charge (${file.type || file.name}) : envoyer un JPG, PNG ou WebP.`);
  const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
  const scale = MAX_SIDE / Math.max(bitmap.width, bitmap.height);
  if (scale >= 1) return {blob: file, ext};
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.9));
  return {blob, ext: ext === 'png' ? 'png' : 'jpg'};
}

/** Fiche du joueur d'après le formulaire ; les champs vides sont absents. */
function formPlayer() {
  const p = {
    prenom: prenomEl.value.trim(),
    nom: nomEl.value.trim(),
    alias: aliasEl.value.trim(),
    shortName: shortNameEl.value.trim(),
    img: `assets/joueurs/${imgEl.value.trim()}`,
    femme: femmeEl.checked,
  };
  for (const key of Object.keys(p)) if (!p[key]) delete p[key];
  return p;
}

// --- Envoi ---------------------------------------------------------------------------------------------------------

async function save() {
  const stem = imgEl.value.trim();
  if (!prenomEl.value.trim()) return setStatus('Le prénom est obligatoire.', true);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem)) return setStatus('Nom des fichiers : minuscules, chiffres et tirets uniquement (ex. marie-dupont).', true);
  if (players.some((p, i) => i !== current && stemOf(p.img) === stem)) {
    return setStatus(`Le nom de fichiers « ${escapeHtml(stem)} » est déjà utilisé par un autre joueur.`, true);
  }
  const original = players[current];
  const player = formPlayer();
  const same = original && JSON.stringify(Object.entries(player).sort()) === JSON.stringify(Object.entries(original).sort());
  if (same && !pending.size) return setStatus('Rien à enregistrer.');

  saveEl.disabled = true;
  try {
    // Les morceaux des photos d'abord, la demande ensuite : le robot ne voit jamais une demande incomplète.
    const ref = doc(collection(db, REQUESTS));
    const photoList = [];
    for (const [suffix, choice] of pending) {
      const bytes = new Uint8Array(await choice.blob.arrayBuffer());
      const parts = Math.ceil(bytes.length / PART_SIZE);
      for (let i = 0; i < parts; i++) {
        setStatus(`Envoi de la photo ${escapeHtml(suffix.slice(1))} (${i + 1}/${parts})…`);
        await setDoc(doc(ref, 'parts', `${suffix.slice(1)}-${i}`), {data: Bytes.fromUint8Array(bytes.subarray(i * PART_SIZE, (i + 1) * PART_SIZE))});
      }
      photoList.push({suffix, ext: choice.ext, cutout: choice.cutout, parts});
    }
    await setDoc(ref, {
      by: auth.currentUser.email,
      createdAt: serverTimestamp(),
      status: 'pending',
      original: original ? {img: original.img || '', prenom: original.prenom || '', nom: original.nom || ''} : null,
      player,
      photos: photoList,
    });
    setStatus(`Demande envoyée : ${escapeHtml(fullName(player))}. En ligne dans 5 à 15 minutes environ.`);
    pending = new Map();
    renderSlots();
    updateDirty();
    await loadRequests();
  } catch (e) {
    showError(e);
  } finally {
    saveEl.disabled = false;
  }
}

async function loadRequests() {
  const snap = await getDocs(query(collection(db, REQUESTS), orderBy('createdAt', 'desc')));
  requestsSectionEl.hidden = snap.empty;
  requestsEl.innerHTML = '';
  for (const d of snap.docs) {
    const r = d.data();
    const when = r.createdAt?.toDate?.()?.toLocaleString('fr-BE', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) || '';
    const el = document.createElement('div');
    el.className = 'request';
    const photosText = r.photos?.length ? ` · ${r.photos.length} photo${r.photos.length > 1 ? 's' : ''}` : '';
    const state = r.status === 'error'
      ? `<span class="error">Refusée : ${escapeHtml(r.error || 'erreur inconnue')}</span>`
      : '<span class="badge">en attente</span>';
    el.innerHTML = `
      <div class="grow"><strong>${escapeHtml(fullName(r.player || {}))}</strong> ${r.original ? '(modification)' : '(nouveau)'}${photosText}
        <div class="hint">${escapeHtml(when)} · ${escapeHtml(r.by || '')}</div></div>
      ${state}
      <button type="button">Annuler</button>`;
    el.querySelector('button').addEventListener('click', () => cancelRequest(d.id).catch(showError));
    requestsEl.appendChild(el);
  }
}

/** Supprime une demande pas encore traitée (ou refusée), morceaux de photos compris. */
async function cancelRequest(id) {
  if (!confirm('Annuler cette demande ?')) return;
  const ref = doc(db, REQUESTS, id);
  await deleteDoc(ref);
  const parts = await getDocs(collection(ref, 'parts'));
  await Promise.all(parts.docs.map(p => deleteDoc(p.ref)));
  await loadRequests();
}

function showError(e) {
  console.error(e);
  setStatus(e.code === 'permission-denied'
    ? 'Accès refusé : cette adresse Google n\'est pas dans la liste des organisateurs (firestore.rules).'
    : `Erreur : ${escapeHtml(e.message)}`, true);
}

// --- Événements ----------------------------------------------------------------------------------------------------

signinEl.addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    setStatus(`Connexion refusée : ${escapeHtml(e.message)}`, true);
  }
});
signoutEl.addEventListener('click', () => signOut(auth));
playerEl.addEventListener('change', () => {
  if (pending.size && !confirm('Des photos choisies ne sont pas envoyées. Changer de joueur quand même ?')) {
    playerEl.value = String(current);
    return;
  }
  selectPlayer(Number(playerEl.value));
  setStatus('');
});
for (const el of [prenomEl, nomEl]) {
  el.addEventListener('input', () => {
    if (imgTouched) return;
    imgEl.value = slugify([prenomEl.value, nomEl.value].join(' '));
    renderSlots();
  });
}
imgEl.addEventListener('input', () => {
  imgTouched = true;
  renderSlots();
});
document.querySelectorAll('input[name=kind]').forEach(el => el.addEventListener('change', () => {
  // Les photos choisies pour des emplacements masqués ne sont pas envoyées.
  const visible = new Set(slots().map(s => s.suffix));
  for (const suffix of pending.keys()) if (!visible.has(suffix)) pending.delete(suffix);
  renderSlots();
  updateDirty();
}));
saveEl.addEventListener('click', save);

onAuthStateChanged(auth, async (user) => {
  signinEl.hidden = !!user;
  signoutEl.hidden = !user;
  whoEl.textContent = user ? user.email : '';
  editorEl.hidden = requestsSectionEl.hidden = true;
  if (!user) return;
  setStatus('');
  try {
    // La liste des demandes n'est lisible que par les organisateurs : elle sert aussi de contrôle d'accès.
    await loadRequests();
    await loadPlayers();
    renderPlayers();
    selectPlayer(-1);
    editorEl.hidden = false;
  } catch (e) {
    showError(e);
  }
});
