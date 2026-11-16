#!/usr/bin/env node
/**
 * Génère src/assets/data/photos.json : { "<nom de fichier sans extension>": "assets/joueurs/<joueur>/<fichier>" }
 * pour toutes les images de src/assets/joueurs (un dossier par joueur), quelle que soit leur extension.
 * L'app résout ainsi "polo" + "-lions" sans connaître l'extension du fichier.
 * Lancé automatiquement avant `ng serve`, `build` et `test` (voir package.json).
 * Avec --watch (lancé par `npm run start`) : régénéré dès qu'une photo est ajoutée, renommée ou supprimée.
 */
const fs = require('fs');
const path = require('path');

const PHOTOS_DIR = path.join(__dirname, '..', 'src', 'assets', 'joueurs');
const OUTPUT = path.join(__dirname, '..', 'src', 'assets', 'data', 'photos.json');
/** Ordre de préférence quand un même nom existe en plusieurs formats (transparence d'abord). */
const EXTENSIONS = ['png', 'webp', 'avif', 'jpg', 'jpeg', 'gif'];

function generate() {
  const manifest = {};
  const duplicates = [];

  /** Photos de joueurs, chemin relatif à PHOTOS_DIR : <joueur>/<fichier> (un dossier par joueur). */
  const files = fs.readdirSync(PHOTOS_DIR, {withFileTypes: true})
    .filter(d => d.isDirectory())
    .flatMap(d => fs.readdirSync(path.join(PHOTOS_DIR, d.name)).map(f => `${d.name}/${f}`))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  for (const file of files) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!EXTENSIONS.includes(ext)) continue;
    const stem = path.basename(file, path.extname(file));
    const current = manifest[stem];
    if (current) {
      const currentExt = path.extname(current).slice(1).toLowerCase();
      const keepCurrent = EXTENSIONS.indexOf(ext) >= EXTENSIONS.indexOf(currentExt);
      duplicates.push(`${stem} : .${keepCurrent ? currentExt : ext} utilisé, .${keepCurrent ? ext : currentExt} ignoré`);
      if (keepCurrent) continue;
    }
    manifest[stem] = `assets/joueurs/${file}`; // file = <joueur>/<fichier>
  }

  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  const content = JSON.stringify(sorted, null, 2) + '\n';
  // On n'écrit que si le contenu change : pas de rechargement inutile de l'app.
  if (fs.existsSync(OUTPUT) && fs.readFileSync(OUTPUT, 'utf8') === content) return false;
  fs.writeFileSync(OUTPUT, content);
  console.log(`photos.json : ${Object.keys(sorted).length} photos`);
  for (const d of duplicates) console.warn(`  ⚠ plusieurs formats pour ${d}`);
  return true;
}

generate();

if (process.argv.includes('--watch')) {
  console.log('photos.json : surveillance de src/assets/joueurs…');
  let timer;
  // Une copie de plusieurs photos déclenche une rafale d'événements : on attend qu'elle se calme.
  fs.watch(PHOTOS_DIR, {recursive: true}, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        generate();
      } catch (e) {
        console.warn(`photos.json : ${e.message}`);
      }
    }, 500);
  });
}
