// Page de vote des étoiles.
// L'URL (générée par l'écran « Votez » de l'app) porte tout le nécessaire :
//   ?m=<id du match>&a=<code équipe A>&b=<code équipe B>&pa=<joueurs A>&pb=<joueurs B>
//   joueurs : liste "code:numéro:rôle" séparée par des virgules, code = prénom + nom comme dans joueurs.json.
// Les votes sont écrits dans Firestore : matches/<id>/ballots/<empreinte d'appareil>, donc un seul bulletin par téléphone
// et par match (vérifié par firestore.rules). L'adresse e-mail est facultative : elle sert au tirage au sort de places.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getFirestore, doc, setDoc, serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';

/** Décor utilisé quand l'équipe n'a pas le sien dans layout/ (même repli que l'app). */
const DEFAULT_LAYOUT = 'lions';
/** Zoom sur le visage, et exceptions par joueur : mêmes valeurs que la composition réseaux de l'app. */
const FACE_SCALE = 1.6;
const FACE_SCALE_OVERRIDES = {
  'assets/joueurs/charlotte-otlet': 1.3,
  'assets/joueurs/gab-de-pat': 1.3,
  'assets/joueurs/david-di-gloria': 1.65,
  'assets/joueurs/lenny-b-conil': 1.4,
  'assets/joueurs/elodie': 1.4,
};
const ROLE_LABELS = {capitaine: 'Capitaine', assistant: 'Assistant', coach: 'Coach'};

/** Libellé du rôle, accordé d'après le champ femme de joueurs.json (comme le pipe roleName de l'app). */
function roleLabel(role, code) {
  const label = ROLE_LABELS[role];
  if (!label) return '';
  return role === 'assistant' && playerMeta(code)?.femme ? 'Assistante' : label;
}

const params = new URLSearchParams(location.search);
const matchId = (params.get('m') || '').replace(/[^\w-]/g, '');
const teamCodes = {a: params.get('a') || '', b: params.get('b') || ''};

const $ = (sel) => document.querySelector(sel);
const teamsEl = $('#teams');
const submitEl = $('#submit');
const statusEl = $('#status');
const emailEl = $('#email');
const footerEl = $('#footer');
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** Sélection ordonnée : [{code, team}] (3 max). */
let picks = [];
let players = {a: [], b: []};
let meta = {players: [], teams: {}, photos: {}, faces: {}};

async function loadData() {
  const optional = (url) => fetch(url).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const [joueurs, equipes, photos, faces] = await Promise.all([
    fetch('data/joueurs.json').then(r => r.json()),
    fetch('data/equipes.json').then(r => r.json()),
    optional('data/photos.json'),
    optional('data/face-positions.json'),
  ]);
  meta = {players: joueurs, teams: equipes, photos, faces};
}

function parsePlayers(raw) {
  return (raw || '').split(',').filter(Boolean).map(entry => {
    const [code, number, role] = entry.split(':');
    return {code: decodeURIComponent(code), number: number || '', role: role || ''};
  });
}

function playerMeta(code) {
  return meta.players.find(p => (p.prenom || '') + (p.nom || '') === code);
}

function displayName(code) {
  const p = playerMeta(code);
  return p ? (p.alias || p.prenom || code) : code;
}

function initials(code) {
  const p = playerMeta(code);
  const name = p ? `${p.prenom || ''} ${p.nom || ''}`.trim() : code;
  return name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
}

function photoSrc(code, teamCode) {
  const p = playerMeta(code);
  if (!p?.img) return null;
  const stem = p.img.substring(p.img.lastIndexOf('/') + 1);
  return meta.photos[`${stem}-${teamCode}`] || meta.photos[stem] || null;
}

/**
 * Cadrage de la photo sur le visage (face-positions.json, clé = chemin sans extension + suffixe d'équipe,
 * comme PlayerMetadata.imgKey) : même règle que la composition réseaux de l'app.
 */
function frameOnFace(img, code, teamCode, {zoom = 1, center = false} = {}) {
  const p = playerMeta(code);
  if (!p?.img) return;
  const suffix = meta.teams[teamCode]?.playerImgSuffix ?? `-${teamCode}`;
  const pos = meta.faces[p.img + suffix] || meta.faces[p.img] || {x: 50, y: 25};
  const overrideKey = Object.keys(FACE_SCALE_OVERRIDES).find(k => p.img.startsWith(k));
  const scale = ((overrideKey ? FACE_SCALE_OVERRIDES[overrideKey] : FACE_SCALE) * zoom).toFixed(2);
  if (center) {
    // petite vignette : le visage au milieu du cadre (translation en % du cadre, après le zoom autour du visage)
    const origin = `${pos.x}% ${pos.y}%`;
    img.style.objectPosition = origin;
    img.style.transformOrigin = origin;
    img.style.transform = `translate(${50 - pos.x}%, ${50 - pos.y}%) scale(${scale})`;
  } else {
    // grande carte : point d'ancrage remonté de 20 % pour laisser de l'air au-dessus de la tête (même règle que l'app)
    const origin = `${pos.x}% ${pos.y - 20}%`;
    img.style.objectPosition = origin;
    img.style.transformOrigin = origin;
    img.style.transform = `scale(${scale})`;
  }
}

function teamName(side) {
  const t = meta.teams[teamCodes[side]];
  return t?.nom || teamCodes[side] || (side === 'a' ? 'Équipe A' : 'Équipe B');
}

function teamColor(side) {
  return meta.teams[teamCodes[side]]?.couleur || (side === 'a' ? 'var(--team-a)' : 'var(--team-b)');
}

/** Une grille à deux colonnes : équipe A à gauche, équipe B à droite, ligne par ligne. Pas de titre d'équipe, la couleur suffit. */
function render() {
  teamsEl.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'players';
  const rows = Math.max(players.a.length, players.b.length);
  for (let i = 0; i < rows; i++) {
    for (const side of ['a', 'b']) {
      const pl = players[side][i];
      grid.appendChild(pl ? renderPlayer(pl, side) : document.createElement('span'));
    }
  }
  teamsEl.appendChild(grid);
  updateSelection();
}

function renderPlayer(pl, side) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'player';
  btn.dataset.code = pl.code;
  btn.dataset.team = side;
  btn.style.setProperty('--team-color', teamColor(side));
  // Décors de l'équipe en fond de carte, comme sur l'écran de présentation
  for (const edge of ['left', 'right']) {
    const layout = document.createElement('img');
    layout.className = `card-layout card-layout-${edge}`;
    layout.alt = '';
    layout.draggable = false;
    teamLayout(layout, teamCodes[side], edge);
    btn.appendChild(layout);
  }
  const src = photoSrc(pl.code, teamCodes[side]);
  if (src) {
    const img = document.createElement('img');
    img.className = 'player-photo';
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    frameOnFace(img, pl.code, teamCodes[side]);
    img.onerror = () => { img.replaceWith(initialsEl(pl.code)); };
    btn.appendChild(img);
  } else {
    btn.appendChild(initialsEl(pl.code));
  }
  if (pl.number) {
    const n = document.createElement('span');
    n.className = 'player-number';
    n.textContent = `#${pl.number}`;
    btn.appendChild(n);
  }
  const rank = document.createElement('span');
  rank.className = 'player-rank';
  btn.appendChild(rank);
  const caption = document.createElement('span');
  caption.className = 'player-caption';
  if (roleLabel(pl.role, pl.code)) {
    const role = document.createElement('span');
    role.className = 'player-role';
    role.textContent = roleLabel(pl.role, pl.code);
    caption.appendChild(role);
  }
  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = displayName(pl.code);
  caption.appendChild(name);
  btn.appendChild(caption);
  btn.addEventListener('click', () => toggle(pl.code, side));
  return btn;
}

function initialsEl(code) {
  const el = document.createElement('span');
  el.className = 'player-initials';
  el.textContent = initials(code);
  return el;
}

function toggle(code, team) {
  const index = picks.findIndex(p => p.code === code && p.team === team);
  if (index >= 0) {
    picks.splice(index, 1);
  } else if (picks.length < 3) {
    picks.push({code, team});
  } else {
    // 3 choix déjà faits : on remplace le dernier
    picks[2] = {code, team};
  }
  updateSelection();
}

function updateSelection() {
  document.querySelectorAll('.player').forEach(btn => {
    const index = picks.findIndex(p => p.code === btn.dataset.code && p.team === btn.dataset.team);
    btn.classList.toggle('selected', index >= 0);
    btn.classList.toggle('dimmed', picks.length === 3 && index < 0);
    // rang porté par l'attribut, pour la couleur or / argent / bronze de la pastille
    if (index >= 0) btn.dataset.rank = String(index + 1); else delete btn.dataset.rank;
    btn.querySelector('.player-rank').textContent = index >= 0 ? String(index + 1) : '';
  });
  document.querySelectorAll('.pick').forEach((el, i) => {
    const pick = picks[i];
    el.classList.toggle('filled', !!pick);
    el.querySelector('.pick-name').textContent = pick ? displayName(pick.code) : '—';
  });
  const email = normalizedEmail();
  const emailOk = email === '' || EMAIL_RE.test(email);
  emailEl.classList.toggle('invalid', !emailOk);
  submitEl.disabled = picks.length !== 3 || !emailOk;
  statusEl.classList.remove('error');
  // pas de compteur de choix : le bouton grisé et les trois cadres suffisent
  if (picks.length < 3) {
    statusEl.textContent = '';
  } else if (!emailOk) {
    statusEl.textContent = 'Adresse e-mail incomplète';
  } else {
    statusEl.textContent = '';
  }
}

/** La marge basse de la page suit la hauteur réelle du pied fixe, pour que le dernier joueur reste atteignable. */
function fitFooter() {
  const app = $('#app');
  if (!app || !footerEl?.isConnected) return;
  app.style.paddingBottom = `${footerEl.offsetHeight + 16}px`;
}

function normalizedEmail() {
  return emailEl.value.trim().toLowerCase();
}

/**
 * Signature technique du navigateur, stable en navigation privée : navigateur, système, modèle (Android),
 * écran, langue, fuseau, carte graphique… Envoyée hachée (sig) avec un libellé lisible (agent) pour que la page
 * de résultats repère les rafales de votes venant probablement du même appareil. Ce n'est pas un identifiant
 * unique : des téléphones identiques partagent la même signature.
 */
async function deviceSignature() {
  const n = navigator;
  let model = '', platformVersion = '';
  try {
    const hints = await n.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion']);
    model = hints?.model || '';
    platformVersion = hints?.platformVersion || '';
  } catch { /* pas de Client Hints */ }
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
  } catch { /* WebGL indisponible */ }
  const parts = [
    n.userAgent, n.platform || '', model, platformVersion,
    `${screen.width}x${screen.height}@${devicePixelRatio || 1}`,
    n.language, Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    String(n.hardwareConcurrency || ''), String(n.maxTouchPoints || ''), gpu,
  ];
  let sig = '';
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
    sig = [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { /* pas de crypto : pas de signature */ }
  return {sig, agent: deviceLabel(n.userAgent, model, platformVersion, gpu)};
}

/** Libellé court et lisible de l'appareil, ex. « iPhone · iOS 18.1 · 390×844 » ou « Android · SM-G991B · Chrome ». */
function deviceLabel(ua, model, platformVersion, gpu) {
  const screenLabel = `${Math.min(screen.width, screen.height)}×${Math.max(screen.width, screen.height)}`;
  let device = 'Navigateur';
  if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/iPad|Macintosh.*Mobile/.test(ua)) device = 'iPad';
  else if (/Android/.test(ua)) device = 'Android';
  else if (/Macintosh/.test(ua)) device = 'Mac';
  else if (/Windows/.test(ua)) device = 'Windows';
  const ios = /OS (\d+)[._](\d+)/.exec(ua);
  const os = device === 'iPhone' || device === 'iPad' ? (ios ? `iOS ${ios[1]}.${ios[2]}` : 'iOS')
    : device === 'Android' ? `Android ${platformVersion.split('.')[0] || (/Android (\d+)/.exec(ua) || [])[1] || ''}`.trim() : '';
  const androidModel = model || (/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/.exec(ua) || [])[1] || '';
  const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Safari/.test(ua) ? 'Safari' : '';
  return [device, androidModel, os, browser, screenLabel, gpu && !/Apple GPU/.test(gpu) ? gpu.slice(0, 30) : '']
    .filter(Boolean).join(' · ').slice(0, 110);
}

/** Empreinte d'appareil : identifiant aléatoire conservé dans le navigateur, qui sert d'identifiant au bulletin. */
function deviceId() {
  const key = 'vote-etoiles:device';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    // navigation privée sans stockage : identifiant éphémère, le vote passe quand même
    return 'ephemere-' + String(Math.random()).slice(2) + Date.now();
  }
}

function lockKey() {
  return `vote-etoiles:${matchId}`;
}

/** Décor d'une équipe (layout/<code>-left.svg ou -right.svg), avec repli sur le décor par défaut puis retrait. */
function teamLayout(img, teamCode, edge) {
  img.src = `layout/${teamCode || DEFAULT_LAYOUT}-${edge}.svg`;
  img.onerror = () => {
    if (img.src.includes(`/${DEFAULT_LAYOUT}-`)) img.remove();
    else img.src = `layout/${DEFAULT_LAYOUT}-${edge}.svg`;
  };
}

function showDone() {
  const tpl = document.getElementById('done-template');
  const done = tpl.content.cloneNode(true);
  const app = $('#app');
  // On garde l'en-tête tel quel (logo), sans la consigne ; le reste est remplacé.
  const header = $('.header');
  header.querySelectorAll('.subtitle').forEach(el => el.remove());
  app.innerHTML = '';
  app.appendChild(header);
  app.style.paddingBottom = ''; // plus de pied fixe à compenser
  app.classList.add('done-page');
  document.body.classList.add('done-page');
  app.appendChild(done);
}

async function submit() {
  const email = normalizedEmail();
  if (picks.length !== 3 || (email && !EMAIL_RE.test(email))) return;
  submitEl.disabled = true;
  statusEl.textContent = 'Envoi…';
  statusEl.classList.remove('error');
  try {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const [first, second, third] = picks.map(p => `${p.team}:${p.code}`);
    // L'empreinte d'appareil est l'identifiant du bulletin : un second vote depuis le même téléphone est refusé par les règles.
    const device = deviceId();
    const {sig, agent} = await deviceSignature();
    await setDoc(doc(db, 'matches', matchId, 'ballots', device), {
      device, first, second, third,
      ...(sig ? {sig, agent} : {}),
      ...(email ? {email} : {}),
      createdAt: serverTimestamp(),
    });
    if (email) { try { localStorage.setItem('vote-etoiles:email', email); } catch { /* ignore */ } }
    // Fiche du match (composition) pour la page de résultats ; fusionnée, donc sans écraser les autres votants.
    await setDoc(doc(db, 'matches', matchId), {
      teamA: teamCodes.a, teamB: teamCodes.b,
      playersA: players.a.map(p => p.code), playersB: players.b.map(p => p.code),
      updatedAt: serverTimestamp(),
    }, {merge: true}).catch(() => { /* facultatif */ });
    try { localStorage.setItem(lockKey(), JSON.stringify(picks)); } catch { /* navigation privée */ }
    showDone();
  } catch (e) {
    console.error(e);
    statusEl.textContent = e?.code === 'permission-denied'
      ? 'Un vote a déjà été enregistré depuis ce téléphone pour ce match.'
      : 'Envoi impossible. Vérifiez votre connexion et réessayez.';
    statusEl.classList.add('error');
    submitEl.disabled = false;
  }
}

async function main() {
  if (!matchId || !params.get('pa') && !params.get('pb')) {
    $('#app').innerHTML = '<p class="empty">Ce lien de vote est incomplet.<br>Scannez le QR code affiché à l\'écran.</p>';
    return;
  }
  if (!firebaseConfig?.projectId || firebaseConfig.projectId.startsWith('VOTRE')) {
    console.warn('firebase-config.js n\'est pas renseigné : les votes ne pourront pas être envoyés.');
  }
  await loadData();
  players = {a: parsePlayers(params.get('pa')), b: parsePlayers(params.get('pb'))};
  if (params.has('reset')) {
    // Pour tester : oublie le vote précédent et l'empreinte d'appareil (donc un nouveau bulletin sera accepté).
    try { localStorage.removeItem(lockKey()); localStorage.removeItem('vote-etoiles:device'); } catch { /* ignore */ }
  }
  if (params.has('merci')) {
    // Pour tester : affiche l'écran de fin sans rien enregistrer.
    showDone();
    return;
  }
  let already = null;
  try { already = JSON.parse(localStorage.getItem(lockKey()) || 'null'); } catch { /* ignore */ }
  if (already?.length === 3) {
    showDone();
    return;
  }
  render();
  try { emailEl.value = localStorage.getItem('vote-etoiles:email') || ''; } catch { /* ignore */ }
  emailEl.addEventListener('input', updateSelection);
  submitEl.addEventListener('click', submit);
  updateSelection();
  fitFooter();
  if ('ResizeObserver' in window) new ResizeObserver(fitFooter).observe(footerEl);
  else window.addEventListener('resize', fitFooter);
}

main().catch(e => {
  console.error(e);
  $('#app').innerHTML = '<p class="empty">Impossible de charger la page de vote.</p>';
});
