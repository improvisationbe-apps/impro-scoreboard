/**
 * Demandes de la page admin joueurs (vote/admin.html), déposées dans Firestore (collection playerRequests).
 *
 *   node scripts/player-requests.js count   nombre de demandes en attente (écrit aussi pending=<n> dans $GITHUB_OUTPUT)
 *   node scripts/player-requests.js apply   applique les demandes en attente : joueurs.json, photos dans src/assets/joueurs,
 *                                           photos à détourer dans scripts/cutout-queue.json. Les demandes invalides
 *                                           passent en statut "error" ; les autres sont notées dans scripts/.cache.
 *   node scripts/player-requests.js done    supprime de Firestore les demandes appliquées (après le push).
 *
 * Accès : variable FIREBASE_SERVICE_ACCOUNT (JSON de la clé de compte de service) ; firebase-admin doit être
 * installable (dans le workflow : npm install --prefix scripts/.cache/fb firebase-admin, puis NODE_PATH).
 */
const fs = require('fs');
const path = require('path');
const {initializeApp, cert} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');

const ROOT = path.join(__dirname, '..');
const PLAYERS = path.join(ROOT, 'src', 'assets', 'data', 'joueurs.json');
const PHOTOS_DIR = path.join(ROOT, 'src', 'assets', 'joueurs');
const QUEUE = path.join(__dirname, 'cutout-queue.json');
const APPLIED = path.join(__dirname, '.cache', 'player-requests-applied.json');
const REQUESTS = 'playerRequests';
const EXTENSIONS = ['png', 'webp', 'avif', 'jpg', 'jpeg', 'gif'];
const SUFFIXES = ['-tshirt-fight', '-tshirt-happy', '-aigles', '-lions', '-pythons', '-requins'];
const FIELDS = ['prenom', 'nom', 'alias', 'shortName', 'img', 'femme'];

initializeApp({credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}'))});
const db = getFirestore();

/** Demandes en attente, les plus anciennes d'abord (tri en mémoire : pas d'index composite à créer). */
async function pendingRequests() {
  const snap = await db.collection(REQUESTS).where('status', '==', 'pending').get();
  return snap.docs.sort((a, b) => (a.get('createdAt')?.toMillis() || 0) - (b.get('createdAt')?.toMillis() || 0));
}
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const code = (p) => (p.prenom || '') + (p.nom || '');

/** Vérifie une demande ; renvoie le message d'erreur, ou null si elle est applicable. */
function check(request, players) {
  const p = request.player || {};
  if (typeof p.prenom !== 'string' || !p.prenom.trim()) return 'prénom manquant';
  if (Object.keys(p).some(k => !FIELDS.includes(k))) return 'champ inconnu dans la fiche';
  const stem = (p.img || '').replace(/^assets\/joueurs\//, '');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem) || p.img !== `assets/joueurs/${stem}`) return 'nom des fichiers invalide';
  for (const photo of request.photos || []) {
    if (!SUFFIXES.includes(photo.suffix) || !['jpg', 'png', 'webp'].includes(photo.ext)) return 'photo invalide';
  }
  const target = findTarget(request, players);
  if (request.original && target < 0) return 'joueur introuvable (supprimé ou renommé entre-temps)';
  const clash = players.findIndex(q => q.img === p.img);
  if (clash >= 0 && clash !== target) return `nom des fichiers déjà utilisé par ${code(players[clash])}`;
  return null;
}

/**
 * Joueur visé : celui d'origine pour une modification ; pour un nouveau joueur, celui qui porte déjà ce nom de
 * fichiers et ce prénom (demande déjà appliquée mais pas encore supprimée : on la rejoue sans doublon), sinon -1.
 */
function findTarget(request, players) {
  const o = request.original;
  if (o) return players.findIndex(q => (o.img && q.img === o.img) || (!o.img && code(q) === code(o)));
  return players.findIndex(q => q.img === request.player.img && q.prenom === request.player.prenom);
}

/** Met à jour la fiche en place (ordre des champs existants conservé : diff lisible). */
function applyPlayer(target, player) {
  for (const key of FIELDS) {
    if (player[key]) target[key] = player[key];
    else delete target[key];
  }
  return target;
}

/** Contenu d'une photo, recollé à partir de ses morceaux ; erreur si un morceau manque. */
async function readPhoto(ref, photo) {
  const parts = await Promise.all(Array.from({length: photo.parts}, (_, i) => ref.collection('parts').doc(`${photo.suffix.slice(1)}-${i}`).get()));
  if (!photo.parts || parts.some(p => !p.exists)) throw new Error(`photo ${photo.suffix.slice(1)} incomplète`);
  return Buffer.concat(parts.map(p => Buffer.from(p.get('data'))));
}

/** Écrit la photo et renvoie la file de détourage mise à jour. */
function writePhoto(stem, photo, content, queue) {
  const name = `${stem}${photo.suffix}.${photo.ext}`;
  // Les autres formats de la même photo sont supprimés, sinon le manifeste garderait l'ancien PNG.
  for (const ext of EXTENSIONS) {
    const other = path.join(PHOTOS_DIR, `${stem}${photo.suffix}.${ext}`);
    if (ext !== photo.ext && fs.existsSync(other)) fs.unlinkSync(other);
  }
  fs.writeFileSync(path.join(PHOTOS_DIR, name), content);
  const kept = queue.filter(n => n.slice(0, n.lastIndexOf('.')) !== stem + photo.suffix);
  if (photo.cutout) kept.push(name);
  return kept;
}

async function apply() {
  const players = readJson(PLAYERS);
  let queue = readJson(QUEUE, []);
  const applied = [];
  for (const d of await pendingRequests()) {
    const request = d.data();
    const error = check(request, players);
    if (error) {
      console.warn(`✗ ${d.id} : ${error}`);
      await d.ref.update({status: 'error', error});
      continue;
    }
    try {
      const stem = request.player.img.replace(/^assets\/joueurs\//, '');
      // Toutes les photos sont lues avant d'écrire quoi que ce soit : une demande incomplète ne laisse rien derrière elle.
      const contents = await Promise.all((request.photos || []).map(photo => readPhoto(d.ref, photo)));
      (request.photos || []).forEach((photo, i) => { queue = writePhoto(stem, photo, contents[i], queue); });
      const target = findTarget(request, players);
      if (target >= 0) applyPlayer(players[target], request.player);
      else players.push(applyPlayer({}, request.player));
      applied.push({id: d.id, by: request.by, name: [request.player.prenom, request.player.nom].filter(Boolean).join(' ')});
      console.log(`✓ ${d.id} : ${request.player.prenom} ${request.player.nom || ''} (${(request.photos || []).length} photo(s), par ${request.by})`);
    } catch (e) {
      console.warn(`✗ ${d.id} : ${e.message}`);
      await d.ref.update({status: 'error', error: e.message});
    }
  }
  writeJson(PLAYERS, players);
  writeJson(QUEUE, queue);
  fs.mkdirSync(path.dirname(APPLIED), {recursive: true});
  writeJson(APPLIED, applied);
  console.log(`${applied.length} demande(s) appliquée(s).`);
}

async function done() {
  const applied = readJson(APPLIED, []);
  for (const {id} of applied) await db.recursiveDelete(db.collection(REQUESTS).doc(id));
  console.log(`${applied.length} demande(s) supprimée(s) de Firestore.`);
}

async function count() {
  const n = (await pendingRequests()).length;
  console.log(`${n} demande(s) en attente.`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `pending=${n}\n`);
}

const commands = {apply, done, count};
const command = commands[process.argv[2]];
if (!command) {
  console.error('Usage : node scripts/player-requests.js count|apply|done');
  process.exit(1);
}
command().catch(e => {
  console.error(e);
  process.exit(1);
});
