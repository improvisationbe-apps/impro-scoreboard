#!/usr/bin/env node
/**
 * Prépare le site de vote (dossier vote/) pour le déploiement :
 *  - copie joueurs.json, equipes.json et face-positions.json (cadrage des visages) dans vote/data/
 *  - copie les décors d'équipe (assets/layout/<code>-left.svg, -right.svg) dans vote/layout/
 *  - génère des vignettes des photos de joueurs dans vote/photos/ (720 px de large : deux colonnes sur un écran
 *    de téléphone à haute densité, sans flou)
 *    et le manifeste vote/data/photos.json : { "<nom sans extension>": "photos/<fichier>" }
 * Utilise ImageMagick (magick/convert, WebP) si présent, sinon sips (macOS, même format que l'original).
 * Usage : npm run vote:build
 */
const fs = require('fs');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');

const ROOT = path.join(__dirname, '..');
const PHOTOS_DIR = path.join(ROOT, 'src', 'assets', 'joueurs');
const DATA_DIR = path.join(ROOT, 'src', 'assets', 'data');
const OUT_DIR = path.join(ROOT, 'vote');
const OUT_DATA = path.join(OUT_DIR, 'data');
const OUT_PHOTOS = path.join(OUT_DIR, 'photos');
const LAYOUT_DIR = path.join(ROOT, 'src', 'assets', 'layout');
const OUT_LAYOUT = path.join(OUT_DIR, 'layout');
const WIDTH = 720;
/** Largeur des vignettes déjà générées : si elle change, on les refait toutes. */
const WIDTH_MARKER = path.join(OUT_PHOTOS, '.width');
const EXTENSIONS = ['png', 'webp', 'jpg', 'jpeg'];

fs.mkdirSync(OUT_DATA, {recursive: true});
fs.mkdirSync(OUT_PHOTOS, {recursive: true});
for (const file of ['joueurs.json', 'equipes.json', 'face-positions.json']) {
  fs.copyFileSync(path.join(DATA_DIR, file), path.join(OUT_DATA, file));
}
// Décors de fond des cartes joueurs, les mêmes que sur l'écran de projection.
fs.mkdirSync(OUT_LAYOUT, {recursive: true});
for (const file of fs.readdirSync(LAYOUT_DIR).filter(f => f.endsWith('.svg'))) {
  fs.copyFileSync(path.join(LAYOUT_DIR, file), path.join(OUT_LAYOUT, file));
}

function has(cmd) {
  return spawnSync('which', [cmd]).status === 0;
}
const magick = has('magick') ? 'magick' : has('convert') ? 'convert' : null;
const sips = !magick && has('sips');
if (!magick && !sips) {
  console.error('Ni ImageMagick ni sips : impossible de générer les vignettes.');
  process.exit(1);
}

// Une photo par nom, en préférant les formats avec transparence (même règle que photos-manifest.js).
const sources = {};
// Un dossier par joueur : file = <joueur>/<fichier>
const photoFiles = fs.readdirSync(PHOTOS_DIR, {withFileTypes: true})
  .filter(d => d.isDirectory())
  .flatMap(d => fs.readdirSync(path.join(PHOTOS_DIR, d.name)).map(f => `${d.name}/${f}`))
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
for (const file of photoFiles) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!EXTENSIONS.includes(ext)) continue;
  const stem = path.basename(file, path.extname(file));
  const current = sources[stem];
  if (!current || EXTENSIONS.indexOf(ext) < EXTENSIONS.indexOf(path.extname(current).slice(1).toLowerCase())) {
    sources[stem] = file;
  }
}

if (!fs.existsSync(WIDTH_MARKER) || fs.readFileSync(WIDTH_MARKER, 'utf8').trim() !== String(WIDTH)) {
  for (const file of fs.readdirSync(OUT_PHOTOS)) fs.unlinkSync(path.join(OUT_PHOTOS, file));
  fs.writeFileSync(WIDTH_MARKER, `${WIDTH}\n`);
}

const manifest = {};
let generated = 0;
for (const [stem, file] of Object.entries(sources)) {
  const src = path.join(PHOTOS_DIR, file);
  const outName = magick ? `${stem}.webp` : `${stem}${path.extname(file).toLowerCase()}`;
  const out = path.join(OUT_PHOTOS, outName);
  manifest[stem] = `photos/${outName}`;
  // Vignette à jour : on ne régénère que si la source est plus récente.
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) continue;
  try {
    if (magick) {
      execFileSync(magick, [src, '-resize', `${WIDTH}x`, '-quality', '82', '-define', 'webp:alpha-quality=90', out], {stdio: 'ignore'});
    } else {
      fs.copyFileSync(src, out);
      execFileSync('sips', ['--resampleWidth', String(WIDTH), out], {stdio: 'ignore'});
    }
    generated++;
  } catch (e) {
    // ex. fichier dont l'extension ne correspond pas au contenu : pas de vignette, la page affichera les initiales
    console.warn(`  ⚠ vignette impossible pour ${file}`);
    if (fs.existsSync(out)) fs.unlinkSync(out);
    delete manifest[stem];
  }
}
// Vignettes orphelines (photo supprimée)
for (const file of fs.readdirSync(OUT_PHOTOS)) {
  if (file !== '.width' && !Object.values(manifest).includes(`photos/${file}`)) fs.unlinkSync(path.join(OUT_PHOTOS, file));
}
fs.writeFileSync(path.join(OUT_DATA, 'photos.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`vote/ : ${Object.keys(manifest).length} vignettes (${generated} régénérées, ${magick ? 'ImageMagick/WebP' : 'sips'}), données copiées.`);
