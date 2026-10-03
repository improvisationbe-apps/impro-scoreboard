#!/usr/bin/env node
/**
 * Génère les décors de coin « drapeau » des équipes internationales, c'est-à-dire celles qui ont
 * un champ "couleurs" (bandes du drapeau, de haut en bas) dans src/assets/data/equipes.json :
 * src/assets/layout/<code>-left.svg et -right.svg, dérivés de ceux des Requins, où le halo et les points
 * de trame sont répartis en bandes horizontales aux couleurs du drapeau.
 * Génère aussi leurs logos improvisation.be src/assets/logos/logo_<kind> - white|black <code>.svg, dérivés des
 * logos rouges : points et « .be » d'une seule teinte, la couleur principale ("couleur") de l'équipe, pour que
 * le logo soit exactement de la couleur du drapeau plutôt que d'une variante de la charte. Avec "pointsDrapeau",
 * les points reprennent en plus les bandes du drapeau (Québec : bleu, blanc, bleu), le « .be » restant uni.
 * Les fichiers générés sont versionnés : relancer le script quand les couleurs changent.
 * Usage : npm run flags:build
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEAMS_FILE = path.join(ROOT, 'src', 'assets', 'data', 'equipes.json');
const LAYOUT_DIR = path.join(ROOT, 'src', 'assets', 'layout');
const LOGOS_DIR = path.join(ROOT, 'src', 'assets', 'logos');

/** Décor de référence dont on reprend la géométrie (masque, halo, trame de points). */
const LAYOUT_TEMPLATE = 'requins';
const LAYOUT_TEMPLATE_COLOR = '#3399CC';
/** Logo de référence : la variante rouge, dont la classe .cls-1 porte les points et le « .be ». */
const LOGO_TEMPLATE = 'red';
const LOGO_KINDS = ['principal', 'secondaire', 'tertiaire'];
const LOGO_THEMES = ['white', 'black'];

/**
 * Le noir d'un drapeau est invisible sur le fond noir de la projection : on le rend par du gris, dans le halo
 * comme dans la trame de points.
 */
const BLACK_GLOW = '#8a8a8a';
const BLACK_DOTS = '#a6a6a6';
/** Le blanc pur d'un drapeau devient gris dans le halo (fondu vers le noir) : on l'éclaircit d'une pointe de bleu. */
const WHITE_GLOW = '#aac4ec';
/** Opacité de la trame de points dans le décor d'origine. */
const DOTS_OPACITY = '0.4';

function isBlack(color) {
  return /^#0{3}(0{3})?$/i.test(color);
}

function isWhite(color) {
  return /^#f{3}(f{3})?$/i.test(color);
}

function glowColor(color) {
  if (isBlack(color)) return BLACK_GLOW;
  if (isWhite(color)) return WHITE_GLOW;
  return color;
}

/** Dégradé vertical par bandes, avec un court fondu entre deux bandes voisines. */
function bandsGradient(id, colors, y1, y2, mapColor = c => c) {
  const n = colors.length;
  const blend = 0.06;
  const stops = [];
  colors.forEach((color, i) => {
    const start = i / n;
    const end = (i + 1) / n;
    const c = mapColor(color);
    stops.push(`<stop offset="${(i === 0 ? 0 : start + blend).toFixed(3)}" stop-color="${c}"/>`);
    stops.push(`<stop offset="${(i === n - 1 ? 1 : end - blend).toFixed(3)}" stop-color="${c}"/>`);
  });
  return `<linearGradient id="${id}" x1="0" y1="${y1}" x2="0" y2="${y2}" gradientUnits="userSpaceOnUse">\n      ${stops.join('\n      ')}\n    </linearGradient>`;
}

/**
 * Décor de coin : chaque dégradé à la couleur de l'équipe devient un masque de luminance (même dégradé, en blanc)
 * appliqué à la même forme remplie par les bandes du drapeau ; les points de trame sont répartis en bandes
 * horizontales sur leur propre emprise, pour que chaque coin montre toutes les couleurs.
 */
function buildLayout(template, colors) {
  const viewBox = template.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const [, vbY, , vbH] = viewBox;
  const templateColor = new RegExp(LAYOUT_TEMPLATE_COLOR, 'gi');
  let svg = template;
  const extraDefs = [bandsGradient('flag_bands', colors, vbY, vbY + vbH, glowColor)];

  // Dégradés à la couleur de l'équipe → copie blanche pour le masque.
  const gradientRe = /<(linearGradient|radialGradient) id="([^"]+)"[^>]*>[\s\S]*?<\/\1>/g;
  const teamGradients = [];
  for (const match of template.matchAll(gradientRe)) {
    if (!templateColor.test(match[0])) continue;
    templateColor.lastIndex = 0;
    teamGradients.push(match[2]);
    const white = match[0]
      .replace(`id="${match[2]}"`, `id="${match[2]}_w"`)
      .replace(templateColor, '#FFFFFF');
    extraDefs.push(white);
  }
  templateColor.lastIndex = 0;

  // Formes remplies par ces dégradés → masque + bandes.
  for (const id of teamGradients) {
    const shapeRe = new RegExp(`<(rect|path)([^>]*?)fill="url\\(#${id}\\)"([^>]*)/>`);
    const shape = svg.match(shapeRe);
    if (!shape) throw new Error(`Forme remplie par #${id} introuvable`);
    const [full, tag, before, after] = shape;
    extraDefs.push(`<mask id="${id}_m" maskUnits="userSpaceOnUse" x="0" y="${vbY - 80}" width="551" height="${vbH + 160}">\n      <${tag}${before}fill="url(#${id}_w)"${after}/>\n    </mask>`);
    svg = svg.replace(full, `<g mask="url(#${id}_m)">\n      <${tag}${before}fill="url(#flag_bands)"${after}/>\n    </g>`);
  }

  // Trame de points : bandes horizontales sur l'emprise des points.
  const dotsRe = new RegExp(`<g opacity="${DOTS_OPACITY}">([\\s\\S]*?)</g>`);
  const dots = svg.match(dotsRe);
  if (!dots) throw new Error('Trame de points introuvable');
  const paths = dots[1].match(/<path [^>]*\/>/g);
  const ys = paths.map(p => Number(p.match(/d="M[\d.-]+ ([\d.-]+)/)[1]));
  const minY = Math.min(...ys);
  const span = Math.max(...ys) - minY;
  const groups = colors.map(() => []);
  paths.forEach((p, i) => {
    const band = Math.min(colors.length - 1, Math.floor(((ys[i] - minY) / span) * colors.length));
    const color = isBlack(colors[band]) ? BLACK_DOTS : colors[band];
    groups[band].push(p.replace(/fill="#[0-9A-Fa-f]+"/, `fill="${color}"`));
  });
  const dotGroups = groups
    .map(g => `<g opacity="${DOTS_OPACITY}">\n      ${g.join('\n      ')}\n    </g>`)
    .join('\n    ');
  svg = svg.replace(dots[0], dotGroups);

  // Ce qui reste à la couleur de l'équipe (aucun cas attendu) prend la première bande.
  svg = svg.replace(templateColor, colors[0]);
  return svg.replace('<defs>', `<defs>\n    ${extraDefs.join('\n    ')}`);
}

/** Sur fond clair (thème black), un point blanc du drapeau serait invisible : on le grise. */
const WHITE_DOT_ON_LIGHT = '#cccccc';
/** Rayon minimal des points du logo : en dessous, c'est le point du « .be », qui reste à la couleur principale. */
const DOT_MIN_RADIUS = 20;

/**
 * Logo : les points et le « .be » (classe .cls-1) prennent la couleur principale de l'équipe.
 * Avec des bandes (pointsDrapeau), chaque point prend une bande du drapeau, réparties du premier au dernier point
 * (3 points ↔ 3 bandes ; 2 points ↔ première et dernière bande), via un style inline qui prime sur la classe.
 */
function buildLogo(template, mainColor, bands, theme) {
  let svg = template.replace(/(\.cls-1 \{\s*fill: )#[0-9a-fA-F]+;/, `$1${mainColor};`);
  if (!bands) return svg;
  const dots = (svg.match(/<circle class="cls-1"[^>]*\/>/g) || [])
    .filter(c => Number(c.match(/ r="([\d.]+)"/)[1]) >= DOT_MIN_RADIUS);
  dots.forEach((dot, i) => {
    const band = dots.length === 1 ? 0 : Math.round((i * (bands.length - 1)) / (dots.length - 1));
    let color = bands[band];
    if (isBlack(color)) color = BLACK_DOTS;
    if (isWhite(color) && theme === 'black') color = WHITE_DOT_ON_LIGHT;
    svg = svg.replace(dot, dot.replace('<circle ', `<circle style="fill: ${color};" `));
  });
  return svg;
}

const teams = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8'));
let generated = 0;
for (const [code, team] of Object.entries(teams)) {
  if (!Array.isArray(team.couleurs) || team.couleurs.length === 0) continue;
  const colors = team.couleurs.map(c => c.toLowerCase());
  const mainColor = (team.couleur || colors[colors.length - 1]).toLowerCase();

  for (const side of ['left', 'right']) {
    const template = fs.readFileSync(path.join(LAYOUT_DIR, `${LAYOUT_TEMPLATE}-${side}.svg`), 'utf8');
    fs.writeFileSync(path.join(LAYOUT_DIR, `${code}-${side}.svg`), buildLayout(template, colors));
    generated++;
  }
  for (const kind of LOGO_KINDS) {
    for (const theme of LOGO_THEMES) {
      const template = fs.readFileSync(path.join(LOGOS_DIR, `logo_${kind} - ${theme} ${LOGO_TEMPLATE}.svg`), 'utf8');
      fs.writeFileSync(path.join(LOGOS_DIR, `logo_${kind} - ${theme} ${code}.svg`),
        buildLogo(template, mainColor, team.pointsDrapeau ? colors : undefined, theme));
      generated++;
    }
  }
  console.log(`${code} : décors ${colors.join(', ')}, logo ${mainColor}${team.pointsDrapeau ? ', points aux bandes' : ''}`);
}
console.log(`${generated} fichier(s) généré(s).`);
