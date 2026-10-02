// Résultats des votes : connexion Google (adresses autorisées dans firestore.rules), puis dépouillement par match.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getFirestore, collection, getDocs, query, orderBy, limit} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {firebaseConfig} from './firebase-config.js';

const POINTS = [3, 2, 1];
const TOP = 8;
/** Votes suspects : même signature d'appareil et même 1re étoile à moins de SUSPECT_GAP_SECONDS d'intervalle. */
const SUSPECT_GAP_SECONDS = 60;
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const $ = (sel) => document.querySelector(sel);
const signinEl = $('#signin'), signoutEl = $('#signout'), matchEl = $('#match'), refreshEl = $('#refresh'), countEl = $('#count'), statusEl = $('#status'), tableEl = $('#table');
const windowEl = $('#window'), fromEl = $('#from'), toEl = $('#to');
const tabsEl = $('#tabs'), suspectsEl = $('#suspects'), tabSuspectsEl = $('#tab-suspects');
const drawEl = $('#draw'), drawResultEl = $('#draw-result');
const newsletterEl = $('#newsletter'), newsletterTitleEl = $('#newsletter-title'), newsletterListEl = $('#newsletter-list'), copyNewsletterEl = $('#copy-newsletter');

/** Adresses laissées pour le tirage au sort, dédoublonnées, pour le match affiché. */
let emails = [];

let meta = {players: [], teams: {}};
let matches = [];

async function loadData() {
  const [joueurs, equipes] = await Promise.all([
    fetch('data/joueurs.json').then(r => r.json()),
    fetch('data/equipes.json').then(r => r.json()),
  ]);
  meta = {players: joueurs, teams: equipes};
}

/** Nom complet pour le dépouillement : prénom, alias entre guillemets s'il existe, nom. Ex. « Quentin « Q » Gillet ». */
function displayName(code) {
  const p = meta.players.find(p => (p.prenom || '') + (p.nom || '') === code);
  if (!p) return code;
  return [p.prenom, p.alias ? `« ${p.alias} »` : '', p.nom].filter(Boolean).join(' ') || code;
}

/** Jour du match, minuit heure locale, tiré de l'identifiant ("2026-09-17-aigles-requins") ; null si absent. */
function matchDay(matchId) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(matchId);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Créneau [début, fin) des votes retenus, d'après les deux heures saisies. Fin ≤ début : la fin est le lendemain. */
function voteWindow(matchId) {
  const day = matchDay(matchId);
  if (!day) return null;
  const at = (time) => {
    const [h, min] = (time || '00:00').split(':').map(Number);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min);
  };
  const start = at(fromEl.value), end = at(toEl.value);
  if (end <= start) end.setDate(end.getDate() + 1);
  return {start, end};
}

const fmtTime = (d) => d.toLocaleTimeString('fr-BE', {hour: '2-digit', minute: '2-digit'});
const fmtTimeSec = (d) => d.toLocaleTimeString('fr-BE', {hour: '2-digit', minute: '2-digit', second: '2-digit'});

/**
 * Votes suspects : même signature d'appareil (sig) et même 1re étoile à moins de `gapSeconds` du précédent bulletin
 * semblable. Le premier de chaque rafale est gardé. Rien n'est supprimé dans Firestore : c'est un filtre du
 * dépouillement, la liste des écartés est affichée dans l'onglet « Votes suspects ».
 */
function splitSuspects(ballots, gapSeconds) {
  const sorted = [...ballots].sort((a, b) => (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0));
  const lastSeen = new Map();
  const kept = [], suspects = [];
  for (const d of sorted) {
    const b = d.data();
    // sans signature (anciens bulletins, crypto indisponible) le bulletin n'est jamais suspect
    if (!b.sig) { kept.push(d); continue; }
    const key = `${b.sig}|${b.first}`;
    const t = b.createdAt?.toMillis?.() || 0;
    const prev = lastSeen.get(key);
    if (prev !== undefined && t - prev <= gapSeconds * 1000) {
      suspects.push({doc: d, gap: Math.round((t - prev) / 1000)});
    } else {
      kept.push(d);
    }
    lastSeen.set(key, t);
  }
  return {kept, suspects};
}

function renderSuspects(suspects, match) {
  tabSuspectsEl.textContent = `Votes suspects (${suspects.length})`;
  if (!suspects.length) {
    suspectsEl.innerHTML = '<p class="suspect-empty">Aucun vote suspect avec ce réglage.</p>';
    return;
  }
  const name = (key) => {
    const side = key.slice(0, 1), code = key.slice(2);
    const team = meta.teams[side === 'a' ? match.teamA : match.teamB];
    return `<span class="team-tag" style="background:${team?.couleur || '#888'}"></span>${displayName(code)}`;
  };
  suspectsEl.innerHTML = `
    <table>
      <thead><tr><th>Heure</th><th>Écart</th><th>Appareil</th><th>1<sup>re</sup></th><th>2<sup>e</sup></th><th>3<sup>e</sup></th><th>E-mail</th></tr></thead>
      <tbody>${suspects.map(({doc, gap}) => {
        const b = doc.data();
        const t = b.createdAt?.toDate?.();
        return `<tr>
          <td class="time">${t ? fmtTimeSec(t) : '?'}</td>
          <td class="num">+${gap} s</td>
          <td class="agent" title="${b.sig || ''}">${b.agent || '<span class="hint">inconnu</span>'}</td>
          <td>${name(b.first)}</td><td>${name(b.second)}</td><td>${name(b.third)}</td>
          <td>${b.email || '<span class="hint">—</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

async function loadMatches() {
  const snap = await getDocs(query(collection(db, 'matches'), orderBy('updatedAt', 'desc'), limit(30)));
  matches = snap.docs.map(d => ({id: d.id, ...d.data()}));
  matchEl.innerHTML = matches.map(m => `<option value="${m.id}">${m.id}</option>`).join('');
  matchEl.hidden = refreshEl.hidden = windowEl.hidden = tabsEl.hidden = !matches.length;
  if (!matches.length) statusEl.textContent = 'Aucun vote enregistré pour le moment.';
  else await tally();
}

async function tally() {
  const match = matches.find(m => m.id === matchEl.value);
  if (!match) return;
  statusEl.textContent = 'Dépouillement…';
  const snap = await getDocs(collection(db, 'matches', match.id, 'ballots'));
  // Créneau horaire : les bulletins hors créneau (tests, retardataires) sont ignorés.
  const window = voteWindow(match.id);
  const inWindow = (d) => {
    if (!window) return true;
    const t = d.data().createdAt?.toDate?.();
    return !!t && t >= window.start && t < window.end;
  };
  const inTime = snap.docs.filter(inWindow);
  const ignored = snap.size - inTime.length;
  const {kept: ballots, suspects} = splitSuspects(inTime, SUSPECT_GAP_SECONDS);
  renderSuspects(suspects, match);
  statusEl.textContent = '';
  statusEl.classList.remove('error');
  const scores = new Map();
  for (const d of ballots) {
    const b = d.data();
    [b.first, b.second, b.third].forEach((key, i) => {
      if (!key) return;
      const s = scores.get(key) || {key, points: 0, stars: [0, 0, 0]};
      s.points += POINTS[i];
      s.stars[i] += 1;
      scores.set(key, s);
    });
  }
  const rows = [...scores.values()]
    .sort((x, y) => y.points - x.points || y.stars[0] - x.stars[0] || y.stars[1] - x.stars[1] || y.stars[2] - x.stars[2])
    .slice(0, TOP);
  emails = [...new Set(ballots.map(d => d.data().email).filter(Boolean))];
  const n = ballots.length;
  countEl.textContent = `${n} vote${n > 1 ? 's' : ''} capturé${n > 1 ? 's' : ''} sur ${snap.size} reçu${snap.size > 1 ? 's' : ''}`
    + (window ? ` (créneau ${fmtTime(window.start)} – ${fmtTime(window.end)})` : '')
    + (suspects.length ? ` · ${suspects.length} suspect${suspects.length > 1 ? 's' : ''} écarté${suspects.length > 1 ? 's' : ''}` : '')
    + ` · ${emails.length} adresse${emails.length > 1 ? 's' : ''}`;
  if (!snap.size) {
    statusEl.textContent = 'Aucun vote reçu pour ce match.';
  } else if (!n && !inTime.length) {
    statusEl.textContent = `Aucun vote dans le créneau, ${ignored} reçu${ignored > 1 ? 's' : ''} en dehors. `
      + 'Vérifiez l\'heure du match : le créneau sert à écarter les votes faits hors du match.';
  }
  drawEl.hidden = !emails.length;
  // Toutes les adresses laissées, une par ligne, prêtes à copier
  newsletterEl.hidden = !emails.length;
  newsletterTitleEl.textContent = `Adresses e-mail (${emails.length})`;
  newsletterListEl.value = emails.join('\n');
  newsletterListEl.rows = Math.min(20, Math.max(6, emails.length + 1));
  drawResultEl.textContent = '';
  tableEl.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>Joueur</th><th>Équipe</th><th class="num">Points</th><th class="num">1<sup>res</sup></th><th class="num">2<sup>es</sup></th><th class="num">3<sup>es</sup></th></tr></thead>
      <tbody>${rows.map((r, i) => {
        const [side, code] = [r.key.slice(0, 1), r.key.slice(2)];
        const teamCode = side === 'a' ? match.teamA : match.teamB;
        const team = meta.teams[teamCode];
        return `<tr class="${i < 3 ? 'top' : ''}">
          <td class="rank">${i + 1}</td>
          <td>${displayName(code)}</td>
          <td><span class="team-tag" style="background:${team?.couleur || '#888'}"></span>${team?.nom || teamCode || ''}</td>
          <td class="num">${r.points}</td><td class="num">${r.stars[0]}</td><td class="num">${r.stars[1]}</td><td class="num">${r.stars[2]}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

signinEl.addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    statusEl.textContent = `Connexion refusée : ${e.message}`;
    statusEl.classList.add('error');
  }
});
signoutEl.addEventListener('click', async () => {
  await signOut(auth);
  // Retour à l'état initial : plus de match, plus de tableau, plus d'adresses en mémoire.
  matches = []; emails = [];
  matchEl.innerHTML = ''; tableEl.innerHTML = ''; countEl.textContent = ''; drawResultEl.textContent = '';
  matchEl.hidden = refreshEl.hidden = windowEl.hidden = tabsEl.hidden = newsletterEl.hidden = drawEl.hidden = true;
  suspectsEl.innerHTML = '';
  newsletterListEl.value = '';
  statusEl.textContent = 'Déconnecté.';
  statusEl.classList.remove('error');
});
matchEl.addEventListener('change', tally);
fromEl.addEventListener('change', () => tally().catch(showError));
toEl.addEventListener('change', () => tally().catch(showError));
tabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  tabsEl.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
  tableEl.hidden = tab.dataset.tab !== 'table';
  suspectsEl.hidden = tab.dataset.tab !== 'suspects';
});
copyNewsletterEl.addEventListener('click', async () => {
  newsletterListEl.select();
  await navigator.clipboard.writeText(newsletterListEl.value);
  copyNewsletterEl.textContent = 'Copié !';
  setTimeout(() => { copyNewsletterEl.textContent = 'Copier'; }, 1500);
});
// Tirage au sort parmi toutes les adresses laissées, une chance par adresse.
drawEl.addEventListener('click', () => {
  const winner = emails[Math.floor(Math.random() * emails.length)];
  drawResultEl.textContent = winner ? `Gagnant : ${winner}` : '';
});
refreshEl.addEventListener('click', () => loadMatches().catch(showError));

function showError(e) {
  console.error(e);
  statusEl.textContent = e.code === 'permission-denied'
    ? 'Accès refusé : cette adresse Google n\'est pas dans la liste des organisateurs (firestore.rules).'
    : `Erreur : ${e.message}`;
  statusEl.classList.add('error');
}

onAuthStateChanged(auth, async (user) => {
  signinEl.hidden = !!user;
  signoutEl.hidden = !user;
  if (!user) return;
  statusEl.textContent = `Connecté : ${user.email}`;
  statusEl.classList.remove('error');
  try {
    await loadData();
    await loadMatches();
  } catch (e) {
    showError(e);
  }
});
