#!/usr/bin/env node
/**
 * Aperçu local de la page de vote, sans passer par GitHub Pages.
 *  - prépare vote/data et vote/photos (scripts/vote-build.js)
 *  - sert le dossier vote/ sur http://localhost:4300
 *  - ouvre http://localhost:4300/apercu : la page de vote dans un cadre au format téléphone,
 *    avec un match d'exemple, le choix des deux équipes et un QR code pour l'ouvrir sur un vrai téléphone
 *    (même Wi-Fi que l'ordinateur).
 * Usage : npm run vote:apercu [-- --a lions --b aigles --port 4300]
 * Le vote reste réel : un envoi écrit un bulletin dans Firestore, dans un match dont l'identifiant finit par "-apercu".
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const {execFileSync, spawn} = require('child_process');
const QRCode = require('qrcode');

const ROOT = path.join(__dirname, '..');
const VOTE_DIR = path.join(ROOT, 'vote');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(arg('port', 4300));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

execFileSync(process.execPath, [path.join(__dirname, 'vote-build.js')], {stdio: 'inherit'});

const teams = JSON.parse(fs.readFileSync(path.join(VOTE_DIR, 'data', 'equipes.json'), 'utf8'));
const players = JSON.parse(fs.readFileSync(path.join(VOTE_DIR, 'data', 'joueurs.json'), 'utf8'));
const photos = JSON.parse(fs.readFileSync(path.join(VOTE_DIR, 'data', 'photos.json'), 'utf8'));
const teamCodes = Object.keys(teams);

/** Adresse IPv4 du Wi-Fi/Ethernet, pour ouvrir l'aperçu depuis un téléphone. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const code = (p) => (p.prenom || '') + (p.nom || '');
const stem = (p) => p.img ? p.img.substring(p.img.lastIndexOf('/') + 1) : '';
const PHOTOS_SRC = path.join(ROOT, 'src', 'assets', 'joueurs');
/** Vrai si le joueur a une photo détourée (PNG) aux couleurs de l'équipe dans les sources. */
const hasCutout = (p, teamCode) => fs.existsSync(path.join(PHOTOS_SRC, `${stem(p)}-${teamCode}.png`));

/** Compositions d'exemple par équipe (codes joueur = prénom + nom, comme dans joueurs.json). */
const SAMPLE_TEAMS = {
  aigles: ['ValentineVan Gestel', 'AlexandraDucoux', 'ArnaudVanwelkenhuyzen', 'AlexColussi'],
  requins: ['SophieHoyas', 'EmilieMarlière', 'QuentinGillet', 'Wilhemde Baerdemaecker'],
};

/**
 * Composition d'exemple : celle de SAMPLE_TEAMS si l'équipe en a une, sinon d'abord les photos détourées
 * aux couleurs de l'équipe, puis les autres photos, puis le reste. Numéros pris dans les vareuses de l'équipe.
 */
function samplePlayers(teamCode, exclude, count) {
  const free = players.filter(p => !exclude.has(code(p)));
  const fixed = (SAMPLE_TEAMS[teamCode] || []).map(c => free.find(p => code(p) === c)).filter(Boolean);
  const cutouts = free.filter(p => hasCutout(p, teamCode));
  const withPhoto = free.filter(p => !hasCutout(p, teamCode) && photos[`${stem(p)}-${teamCode}`]);
  const others = free.filter(p => !hasCutout(p, teamCode) && !photos[`${stem(p)}-${teamCode}`]);
  const pool = fixed.length ? fixed : [...cutouts, ...withPhoto, ...others];
  const numbers = teams[teamCode]?.vareuses || [];
  return pool.slice(0, count).map((p, i) => {
    const role = i === 0 ? 'capitaine' : i === 1 ? 'assistant' : '';
    return [code(p), String(numbers[i] ?? 10 + i * 7), role].join(':').replace(/:+$/, '');
  }).join(',');
}

function voteUrl(base, a, b, count, merci) {
  const day = new Date().toISOString().slice(0, 10);
  const pa = samplePlayers(a, new Set(), count);
  const taken = new Set(pa.split(',').map(e => e.split(':')[0]));
  const pb = samplePlayers(b, taken, count);
  const params = new URLSearchParams({m: `${day}-${a}-${b}-apercu`, a, b, pa, pb, reset: '1'});
  if (merci) params.set('merci', '1');
  return `${base}/?${params.toString()}`;
}

/** @param merci  vrai pour /apercu/merci : l'écran de fin (paramètre merci=1 de la page de vote) */
async function apercuPage(query, merci) {
  const a = teamCodes.includes(query.get('a')) ? query.get('a') : arg('a', teamCodes.includes('aigles') ? 'aigles' : teamCodes[0]);
  const b = teamCodes.includes(query.get('b')) ? query.get('b') : arg('b', teamCodes.includes('requins') && a !== 'requins' ? 'requins' : teamCodes.find(c => c !== a) || teamCodes[0]);
  const count = Math.min(6, Math.max(3, Number(query.get('n') || 4)));
  const lan = `http://${lanAddress()}:${PORT}`;
  const local = voteUrl('', a, b, count, merci);
  const phone = voteUrl(lan, a, b, count, merci);
  const qr = await QRCode.toDataURL(phone, {margin: 1, width: 220});
  const options = (selected) => teamCodes.map(c => `<option value="${c}" ${c === selected ? 'selected' : ''}>${teams[c].nom}</option>`).join('');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Aperçu · page de vote</title>
<style>
  body { margin: 0; background: #2a2a2a; color: #eee; font: 14px "Poppins", "Segoe UI", sans-serif; }
  .wrap { display: flex; gap: 32px; padding: 24px; align-items: flex-start; flex-wrap: wrap; }
  .phone { width: 390px; height: 844px; border: 12px solid #111; border-radius: 40px; overflow: hidden; background: #000; flex: 0 0 auto; box-shadow: 0 20px 60px rgba(0,0,0,.6); }
  .phone iframe { border: 0; width: 100%; height: 100%; display: block; }
  .side { max-width: 420px; }
  h1 { font-size: 1.2rem; margin: 0 0 12px; }
  form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 18px; }
  select, button, input { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid #555; background: #1a1a1a; color: #eee; }
  button { cursor: pointer; background: #f5c518; color: #000; font-weight: 700; border-color: #f5c518; }
  .qr { background: #fff; padding: 8px; border-radius: 12px; display: inline-block; }
  .url { word-break: break-all; font-size: 0.8rem; color: #bbb; margin-top: 8px; }
  p.note { color: #bbb; font-size: 0.85rem; line-height: 1.4; }
  code { background: #111; padding: 2px 5px; border-radius: 4px; }
</style></head>
<body><div class="wrap">
  <div class="phone"><iframe src="${local}"></iframe></div>
  <div class="side">
    <h1>Aperçu de la page de vote${merci ? ' · écran « Merci »' : ''}</h1>
    <p class="note"><a href="/apercu?a=${a}&b=${b}&n=${count}" ${merci ? '' : 'style="color:#f5c518"'}>Page de vote</a> ·
      <a href="/apercu/merci?a=${a}&b=${b}&n=${count}" ${merci ? 'style="color:#f5c518"' : ''}>Écran « Merci »</a></p>
    <form method="get" action="${merci ? '/apercu/merci' : '/apercu'}">
      <select name="a">${options(a)}</select> <span>vs</span>
      <select name="b">${options(b)}</select>
      <select name="n">${[3, 4, 5, 6].map(n => `<option value="${n}" ${n === count ? 'selected' : ''}>${n} joueurs</option>`).join('')}</select>
      <button type="submit">Recharger</button>
    </form>
    <div class="qr"><img src="${qr}" alt="QR code" width="220" height="220"></div>
    <div class="url">${phone}</div>
    <p class="note">Scannez le QR code avec un téléphone connecté au même Wi-Fi pour voir la page en vrai.
      Chaque rechargement autorise un nouveau vote (<code>reset=1</code>).
      Un envoi écrit un vrai bulletin dans Firestore, dans un match d'essai dont l'identifiant finit par <code>-apercu</code>.</p>
    <p class="note">Les fichiers de <code>vote/</code> sont servis tels quels : modifiez, rechargez, c'est à jour.</p>
  </div>
</div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname.replace(/\/$/, '');
  if (route === '/apercu' || route === '/apercu/merci') {
    res.writeHead(200, {'Content-Type': MIME['.html'], 'Cache-Control': 'no-store'});
    res.end(await apercuPage(url.searchParams, route === '/apercu/merci'));
    return;
  }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(VOTE_DIR, rel));
  if (!file.startsWith(VOTE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Introuvable');
    return;
  }
  res.writeHead(200, {'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store'});
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  const local = `http://localhost:${PORT}/apercu`;
  console.log(`\nAperçu de la page de vote : ${local}`);
  console.log(`Écran « Merci » : ${local}/merci`);
  console.log(`Depuis un téléphone (même Wi-Fi) : http://${lanAddress()}:${PORT}/apercu\n`);
  if (!args.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [local], {stdio: 'ignore', detached: true, shell: process.platform === 'win32'}).unref();
  }
});
