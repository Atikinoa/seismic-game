'use strict';

// ── Canvas setup ─────────────────────────────────────────────────────────────
const C   = document.getElementById('c');
const ctx = C.getContext('2d');
const W   = 800;
const H   = 450;

// ── Asset loading ─────────────────────────────────────────────────────────────
let loaded = 0;

function mkImg(src) {
  const img = new Image();
  img.src = src;
  img.onload = img.onerror = () => {
    if (++loaded >= 3 && gs === 'loading') gs = 'start';
  };
  return img;
}

const I_SIDE  = mkImg('mascot_side.jpg');
const I_FRONT = mkImg('mascot_front.jpg');
const I_XTAL  = mkImg('crystal.png');

// ── Constants ─────────────────────────────────────────────────────────────────
const GRAV     = 0.55;   // gravity per frame
const JUMP     = -14.0;  // jump velocity
const BASE_SPD = 3.2;    // starting scroll speed
const PX       = 165;    // player fixed screen X position
const PW       = 58;     // player sprite width
const PH       = 76;     // player sprite height
const GY       = H - 58; // ground reference Y

// ── Leaderboard ───────────────────────────────────────────────────────────────
const LB_KEY = 'seismicLeaderboard';
let lb = loadLB();

function loadLB() {
  try {
    const d = JSON.parse(localStorage.getItem(LB_KEY) || '[]');
    return Array.isArray(d) ? d : [];
  } catch (_) { return []; }
}

function saveLB() {
  localStorage.setItem(LB_KEY, JSON.stringify(lb));
}

function addToLB(name, s) {
  lb.push({ name: (name || 'Player').slice(0, 16), score: s });
  lb.sort((a, b) => b.score - a.score);
  lb = lb.slice(0, 5);
  saveLB();
}

// ── Game state ────────────────────────────────────────────────────────────────
let gs         = 'loading'; // loading | start | nickname | playing | gameover
let score      = 0;
let best       = 0;
let lives      = 3;
let camX       = 0;         // world X at left edge of screen
let genX       = 0;         // rightmost generated platform right edge (world X)
let spd        = BASE_SPD;  // current scroll speed
let flashA     = 0;         // death flash alpha 0..1
let shakePow   = 0;         // screen shake intensity
let playerName = '';        // name being typed on nickname screen
let nickInput  = '';        // confirmed nickname for current run

// ── Player object ─────────────────────────────────────────────────────────────
const P = { xo: 0, y: 0, vy: 0, ground: false, inv: 0, bob: 0 };

function spawnAt(plat) {
  P.xo     = 0;
  P.vy     = 0;
  P.bob    = 0;
  P.ground = false;
  P.inv    = 0;
  P.y      = plat ? plat.y - PH - 2 : GY - PH;
}

// ── World arrays ──────────────────────────────────────────────────────────────
let plats   = []; // { wx, y, w, h }
let xtals   = []; // { wx, y, w, h, bo, done }
let parts   = []; // { x, y, vx, vy, r, c, life, dec }
let bgRocks = []; // { wx, y, rx, ry, par, hsl }

function initWorld() {
  camX  = 0;
  genX  = 0;
  spd   = BASE_SPD;
  plats   = [];
  xtals   = [];
  parts   = [];
  bgRocks = [];

  // Long starting platform so player can orient
  addPlat(-60, GY, 640);

  // Background decorative rock blobs
  for (let i = 0; i < 48; i++) {
    bgRocks.push({
      wx:  Math.random() * 6000 - 400,
      y:   H * 0.26 + Math.random() * H * 0.58,
      rx:  22 + Math.random() * 78,
      ry:  12 + Math.random() * 50,
      par: 0.12 + Math.random() * 0.36,
      hsl: `hsla(270,${(15 + Math.random() * 20) | 0}%,${(5 + Math.random() * 9) | 0}%,.75)`
    });
  }

  // Pre-generate plenty of platforms ahead
  while (genX - camX < W + 950) genPlat();
}

function addPlat(wx, y, w) {
  plats.push({ wx, y, w, h: 48 });
  if (wx + w > genX) genX = wx + w;
}

function diff() {
  // Difficulty 0 → 1 over first 7500 world units
  return Math.min(camX / 7500, 1);
}

function genPlat() {
  const d   = diff();
  const gap = Math.min(62 + d * 88 + Math.random() * (50 + d * 60), 185);
  const pw  = Math.max(72, 260 - d * 115 - Math.random() * 45);
  const prevY = plats.length ? plats[plats.length - 1].y : GY;
  const ny  = Math.max(GY - 145, Math.min(GY + 18, prevY + (Math.random() - 0.5) * 130));
  const wx  = genX + gap;

  addPlat(wx, ny, pw);

  // Crystals resting on platform surface
  if (Math.random() < 0.65) {
    const n = Math.random() < 0.28 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      xtals.push({
        wx: wx + (i + 0.5) * pw / n + (Math.random() - 0.5) * 14,
        y:  ny - 35 - Math.random() * 38,
        w: 27, h: 27,
        bo: Math.random() * Math.PI * 2,
        done: false
      });
    }
  }

  // Risky crystal floating in the gap before this platform
  if (Math.random() < 0.22) {
    xtals.push({
      wx: wx - gap * 0.42,
      y:  ny - 65 - Math.random() * 30,
      w: 27, h: 27,
      bo: Math.random() * Math.PI * 2,
      done: false
    });
  }
}

// ── Particle helpers ──────────────────────────────────────────────────────────
const XTAL_COLS  = ['#f0abfc', '#e879f9', '#a855f7', '#d946ef', '#fdf4ff'];
const DEATH_COLS = ['#7c3aed', '#c026d3', '#be185d', '#92400e', '#78716c'];

function burst(x, y, cols, n, sm) {
  sm = sm || 1;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * 2 * i / n + (Math.random() - 0.5) * 0.6;
    const s = (1.5 + Math.random() * 3) * sm;
    parts.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 1.5,
      r:  2.5 + Math.random() * 3,
      c:  cols[i % cols.length],
      life: 1,
      dec:  0.028 + Math.random() * 0.022
    });
  }
}

// ── Input ─────────────────────────────────────────────────────────────────────
const K = { L: false, R: false, J: false };

document.addEventListener('keydown', e => {
  const c = e.code;

  // Nickname screen: capture typing, Enter to confirm
  if (gs === 'nickname') {
    e.preventDefault();
    if (c === 'Enter') { confirmNickname(); return; }
    if (c === 'Backspace') { playerName = playerName.slice(0, -1); return; }
    if (e.key.length === 1 && playerName.length < 16) playerName += e.key;
    return;
  }

  if (c === 'ArrowLeft'  || c === 'KeyA') { K.L = true;  e.preventDefault(); }
  if (c === 'ArrowRight' || c === 'KeyD') { K.R = true;  e.preventDefault(); }
  if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') {
    K.J = true;
    e.preventDefault();
    if (gs === 'start' || gs === 'gameover') openNickname();
  }
});

document.addEventListener('keyup', e => {
  const c = e.code;
  if (c === 'ArrowLeft'  || c === 'KeyA') K.L = false;
  if (c === 'ArrowRight' || c === 'KeyD') K.R = false;
  if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') K.J = false;
});

C.addEventListener('click', e => {
  if (gs === 'start')    { openNickname(); return; }
  if (gs === 'nickname') { confirmNickname(); return; }
  if (gs === 'gameover') {
    // Check restart button hit area (matches drawGameOver button position)
    const rect = C.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top)  * (H / rect.height);
    const bx = W / 2 - 105;
    const by = H / 2 - 190 + 322; // cy + 322
    if (mx > bx && mx < bx + 210 && my > by && my < by + 46) openNickname();
  }
});

function openNickname() {
  // Keep last typed name pre-filled for convenience
  gs = 'nickname';
}

function confirmNickname() {
  if (playerName.trim() === '') playerName = 'Player';
  nickInput = playerName.trim();
  K.J   = false; // prevent immediate jump on game start
  score = 0;
  lives = 3;
  initWorld();
  spawnAt(plats[0]);
  gs = 'playing';
}

// ── Game update ───────────────────────────────────────────────────────────────
function update() {
  if (gs !== 'playing') return;

  // Speed increases with distance
  spd   = BASE_SPD + diff() * 1.8;
  camX += spd;

  // Small horizontal nudge
  if (K.L)      P.xo = Math.max(P.xo - 0.6, -45);
  else if (K.R) P.xo = Math.min(P.xo + 0.6,  60);
  else          P.xo *= 0.88;

  // Jump — only from ground
  if (K.J && P.ground) { P.vy = JUMP; P.ground = false; }

  // Physics
  P.vy = Math.min(P.vy + GRAV, 20);
  P.y += P.vy;

  const psx = PX + P.xo;

  // Platform collision (land on top only)
  P.ground = false;
  for (const pl of plats) {
    const sx = pl.wx - camX;
    if (psx + PW <= sx || psx >= sx + pl.w) continue;
    const bot     = P.y + PH;
    const prevBot = bot - P.vy;
    if (bot >= pl.y && prevBot <= pl.y + 10 && P.vy >= 0) {
      P.y = pl.y - PH;
      P.vy = 0;
      P.ground = true;
    }
  }

  if (P.ground) P.bob += 0.15;

  // Crystal collection
  const t = Date.now() * 0.0022;
  for (const xc of xtals) {
    if (xc.done) continue;
    const cx = xc.wx - camX;
    const cy = xc.y + Math.sin(t + xc.bo) * 6;
    if (psx + PW > cx + 3 && psx < cx + xc.w - 3 &&
        P.y + PH > cy + 3  && P.y  < cy + xc.h - 3) {
      xc.done = true;
      score++;
      burst(cx + xc.w / 2, cy + xc.h / 2, XTAL_COLS, 14);
    }
  }

  if (P.inv > 0) P.inv--;

  // Death — fell below screen
  if (P.y > H + 100 && P.inv <= 0) die();

  // Running dust trail
  if (P.ground && Math.random() < 0.18) {
    parts.push({
      x:  psx + PW / 2 + (Math.random() - 0.5) * 12,
      y:  P.y + PH,
      vx: -1.2 - Math.random() * 0.8,
      vy: -0.3 - Math.random() * 0.5,
      r:  2 + Math.random() * 2.5,
      c:  `rgba(${(110 + Math.random() * 30) | 0},${(75 + Math.random() * 20) | 0},${(40 + Math.random() * 15) | 0},.5)`,
      life: 1,
      dec:  0.07
    });
  }

  // Decay effects
  if (flashA   > 0) flashA   -= 0.04;
  if (shakePow > 0) shakePow -= 0.9;

  // Generate more level ahead
  while (genX - camX < W + 750) genPlat();

  // Remove off-screen objects
  plats = plats.filter(p => p.wx + p.w - camX > -260);
  xtals = xtals.filter(x => x.wx          - camX > -260);
  parts = parts.filter(p => p.life > 0);

  // Advance particles
  for (const p of parts) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.18;
    p.vx *= 0.98;
    p.life -= p.dec;
  }
}

function die() {
  lives--;
  flashA   = 1.0;
  shakePow = 15;
  burst(PX + P.xo + PW / 2, P.y + PH / 2, DEATH_COLS, 20, 1.2);

  if (lives <= 0) {
    lives = 0;
    if (score > best) best = score;
    addToLB(nickInput, score);
    gs = 'gameover';
    return;
  }

  // Insert a guaranteed wide respawn platform at the current position
  // so the player has plenty of runway after losing a life.
  const respWX = camX + PX - 80; // world X: 80px to the left of the player
  const respY  = GY;             // at ground level
  const respW  = 460;            // wide enough to react
  plats.push({ wx: respWX, y: respY, w: respW, h: 48 });
  if (respWX + respW > genX) genX = respWX + respW;

  // Place player just above the platform; vy=1 triggers collision on frame 1
  P.y      = respY - PH;
  P.vy     = 1;
  P.xo     = 0;
  P.bob    = 0;
  P.ground = false;
  P.inv    = 150; // ~2.5 s of invincibility
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
function rrect(x, y, w, h, r) {
  r = r || 8;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// Draw image; useScreen=true removes black JPG background via blend mode
function drawImg(im, x, y, w, h, useScreen) {
  if (!im.complete || !im.naturalWidth) return;
  if (useScreen) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(im, x, y, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(im, x, y, w, h);
  }
}

// ── Background ────────────────────────────────────────────────────────────────
function drawBG() {
  // Sky gradient
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0,    '#050310');
  g.addColorStop(0.55, '#0c0620');
  g.addColorStop(1,    '#190830');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Twinkling stars with slow parallax
  const ts = Date.now() * 0.00009;
  for (let i = 0; i < 120; i++) {
    const sx = ((i * 173.7 - camX * 0.018) % W + W) % W;
    const sy = (i * 97.3) % (H * 0.72);
    const tw = 0.18 + 0.55 * Math.abs(Math.sin(ts * 2.1 + i));
    ctx.fillStyle = `rgba(215,185,255,${tw.toFixed(2)})`;
    const s = i % 5 ? 0.8 : 1.6;
    ctx.fillRect(sx, sy, s, s);
  }

  // Background rock blobs (parallax layers)
  for (const r of bgRocks) {
    const bx = ((r.wx - camX * r.par) % (W + 380) + (W + 380)) % (W + 380) - 130;
    ctx.fillStyle = r.hsl;
    ctx.beginPath();
    ctx.ellipse(bx, r.y, r.rx, r.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Danger void glow at the bottom (the death pit)
  const vg = ctx.createLinearGradient(0, H * 0.78, 0, H);
  vg.addColorStop(0,    'rgba(0,0,0,0)');
  vg.addColorStop(0.55, 'rgba(100,0,140,.10)');
  vg.addColorStop(1,    'rgba(160,0,80,.22)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ── Platforms ─────────────────────────────────────────────────────────────────
function drawPlats() {
  for (const pl of plats) {
    const sx = pl.wx - camX;
    if (sx + pl.w < -4 || sx > W + 4) continue;
    const { y, w, h } = pl;

    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(sx + 5, y + 7, w, h);

    // Stone body gradient
    const g = ctx.createLinearGradient(sx, y, sx, y + h);
    g.addColorStop(0,   '#8b6340');
    g.addColorStop(0.3, '#7a5230');
    g.addColorStop(0.7, '#5c3c1e');
    g.addColorStop(1,   '#2d1a08');
    ctx.fillStyle = g;
    ctx.fillRect(sx, y, w, h);

    // Purple glow stripe on top edge
    ctx.fillStyle = 'rgba(168,85,247,.78)';
    ctx.fillRect(sx, y, w, 3);
    // Warm amber highlight just below stripe
    ctx.fillStyle = 'rgba(255,180,60,.13)';
    ctx.fillRect(sx, y + 3, w, 5);

    // Deterministic stone crack lines
    ctx.strokeStyle = 'rgba(22,10,3,.52)';
    ctx.lineWidth = 1;
    const seed = Math.floor(pl.wx / 13);
    const nc   = Math.floor(w / 38) + 1;
    for (let i = 0; i < nc; i++) {
      const lx = sx + (seed + i * 43) % Math.max(1, w - 10);
      const dy = (seed + i * 7)  % 5 - 2;
      ctx.beginPath();
      ctx.moveTo(lx, y + 3);
      ctx.lineTo(lx + dy, y + h - 2);
      ctx.stroke();
    }

    // Bottom dark edge
    ctx.fillStyle = '#120903';
    ctx.fillRect(sx, y + h - 4, w, 4);

    // Ambient purple glow rising above the platform
    const ag = ctx.createLinearGradient(sx, y - 18, sx, y);
    ag.addColorStop(0, 'rgba(139,60,230,0)');
    ag.addColorStop(1, 'rgba(139,60,230,.08)');
    ctx.fillStyle = ag;
    ctx.fillRect(sx, y - 18, w, 18);
  }
}

// ── Crystals ──────────────────────────────────────────────────────────────────
function drawXtals() {
  const t = Date.now() * 0.0022;
  for (const xc of xtals) {
    if (xc.done) continue;
    const sx = xc.wx - camX;
    if (sx + xc.w < -4 || sx > W + 4) continue;
    const sy = xc.y + Math.sin(t + xc.bo) * 6; // gentle bob

    // Radial glow halo
    const grd = ctx.createRadialGradient(
      sx + xc.w / 2, sy + xc.h / 2, 1,
      sx + xc.w / 2, sy + xc.h / 2, 28
    );
    grd.addColorStop(0,   'rgba(232,121,249,.40)');
    grd.addColorStop(0.5, 'rgba(168,85,247,.16)');
    grd.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(sx - 18, sy - 18, xc.w + 36, xc.h + 36);

    drawImg(I_XTAL, sx, sy, xc.w, xc.h);
  }
}

// ── Player ────────────────────────────────────────────────────────────────────
function drawPlayer() {
  if (gs !== 'playing' && gs !== 'gameover') return;

  // Blink effect during invincibility
  if (P.inv > 0 && Math.floor(P.inv / 5) % 2 === 0) return;

  const psx  = PX + P.xo;
  const bobY = P.ground ? Math.sin(P.bob * 2) * 2.5 : 0;

  // Squash on landing, stretch while airborne
  const sy  = P.vy < -5 ? 1.07 : P.vy > 8 ? 0.91 : 1.0;
  const dw  = PW * (2 - sy);
  const dh  = PH * sy;
  const dx  = psx + (PW - dw) / 2;
  const dy  = P.y + bobY;

  // Ellipse shadow on the ground
  if (P.ground) {
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.beginPath();
    ctx.ellipse(psx + PW / 2, P.y + PH + 2, PW * 0.44, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw sprite flipped horizontally so the character faces right.
  // Translate origin to the right edge of the sprite, then scale(-1,1)
  // so the image is mirrored and still occupies [dx, dx+dw] on screen.
  if (!I_SIDE.complete || !I_SIDE.naturalWidth) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.translate(dx + dw, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(I_SIDE, 0, 0, dw, dh);
  ctx.restore();
}

// ── Particles ─────────────────────────────────────────────────────────────────
function drawParts() {
  for (const p of parts) {
    if (p.life <= 0) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle   = p.c;
    ctx.shadowColor = p.c;
    ctx.shadowBlur  = 5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.1, p.r * p.life), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── HUD ───────────────────────────────────────────────────────────────────────
function drawHUD() {
  // Score panel
  ctx.fillStyle = 'rgba(6,3,16,.78)';
  rrect(10, 10, 158, 44); ctx.fill();
  ctx.strokeStyle = 'rgba(109,40,217,.45)';
  ctx.lineWidth = 1;
  rrect(10, 10, 158, 44); ctx.stroke();
  drawImg(I_XTAL, 16, 16, 26, 26);
  ctx.fillStyle = '#f0abfc';
  ctx.font = 'bold 22px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(score).padStart(4, '0'), 50, 37);

  // Lives panel
  ctx.fillStyle = 'rgba(6,3,16,.78)';
  rrect(W - 148, 10, 138, 44); ctx.fill();
  ctx.strokeStyle = 'rgba(109,40,217,.45)';
  ctx.lineWidth = 1;
  rrect(W - 148, 10, 138, 44); ctx.stroke();
  ctx.fillStyle = '#c084fc';
  ctx.font = 'bold 13px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('LIVES', W - 14, 23);
  for (let i = 2; i >= 0; i--) {
    ctx.globalAlpha = i < lives ? 1 : 0.18;
    drawImg(I_XTAL, W - 40 - (2 - i) * 34, 18, 24, 24);
  }
  ctx.globalAlpha = 1;

  // Subtle Seismic branding
  ctx.fillStyle = 'rgba(168,85,247,.22)';
  ctx.font = '11px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⬡ SEISMIC', W / 2, H - 7);
  ctx.textAlign = 'left';
}

// ── Shared leaderboard panel ──────────────────────────────────────────────────
function drawLBPanel(x, y, w, h) {
  // Panel background
  ctx.fillStyle = 'rgba(10,4,28,.95)';
  rrect(x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = '#6d28d9';
  ctx.lineWidth = 1.5;
  rrect(x, y, w, h, 12); ctx.stroke();

  // Header
  ctx.fillStyle = '#a855f7';
  ctx.font = 'bold 13px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TOP SCORES', x + w / 2, y + 22);

  // Separator
  ctx.strokeStyle = 'rgba(109,40,217,.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 30);
  ctx.lineTo(x + w - 12, y + 30);
  ctx.stroke();

  if (lb.length === 0) {
    ctx.fillStyle = 'rgba(168,85,247,.38)';
    ctx.font = '12px "Segoe UI",Verdana,sans-serif';
    ctx.fillText('No scores yet', x + w / 2, y + 52);
    ctx.textAlign = 'left';
    return;
  }

  const rankColors = ['#fbbf24', '#94a3b8', '#a16207', '#7c3aed', '#7c3aed'];
  const rowH = Math.min(22, (h - 40) / 5);

  for (let i = 0; i < Math.min(lb.length, 5); i++) {
    const entry = lb[i];
    const ey = y + 46 + i * rowH;

    // Subtle row highlight for top 3
    if (i < 3) {
      const rowTints = ['rgba(250,200,0,.06)', 'rgba(180,180,180,.04)', 'rgba(160,100,0,.04)'];
      ctx.fillStyle = rowTints[i];
      ctx.fillRect(x + 8, ey - 14, w - 16, rowH);
    }

    // Rank
    ctx.fillStyle = rankColors[i];
    ctx.font = 'bold 12px "Segoe UI",Verdana,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`#${i + 1}`, x + 12, ey);

    // Name (truncated at 12 chars)
    ctx.fillStyle = '#ddd0ff';
    ctx.font = '12px "Segoe UI",Verdana,sans-serif';
    const nameStr = entry.name.length > 12 ? entry.name.slice(0, 12) + '\u2026' : entry.name;
    ctx.fillText(nameStr, x + 38, ey);

    // Score
    ctx.fillStyle = '#f0abfc';
    ctx.font = 'bold 12px "Segoe UI",Verdana,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(entry.score, x + w - 12, ey);
  }
  ctx.textAlign = 'left';
}

// ── Screen: Loading ───────────────────────────────────────────────────────────
function drawLoading() {
  ctx.fillStyle = '#030208';
  ctx.fillRect(0, 0, W, H);
  const dots = '.'.repeat((Date.now() / 400 | 0) % 4);
  ctx.fillStyle = '#a855f7';
  ctx.font = 'bold 24px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Loading' + dots, W / 2, H / 2);
  ctx.textAlign = 'left';
}

// ── Screen: Start ─────────────────────────────────────────────────────────────
function drawStart() {
  ctx.fillStyle = 'rgba(3,1,10,.82)';
  ctx.fillRect(0, 0, W, H);

  // Main panel (left side)
  const cw = 460, ch = 360;
  const cx = 15;
  const cy = (H - ch) / 2; // 45

  ctx.fillStyle = 'rgba(10,5,26,.97)';
  rrect(cx, cy, cw, ch, 18); ctx.fill();
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 2;
  rrect(cx, cy, cw, ch, 18); ctx.stroke();

  // Title with glow
  ctx.save();
  ctx.shadowColor = '#a855f7';
  ctx.shadowBlur  = 22;
  ctx.fillStyle   = '#e879f9';
  ctx.font = 'bold 40px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SEISMIC RUN', cx + cw / 2, cy + 50);
  ctx.restore();

  // Mascot front view
  drawImg(I_FRONT, cx + cw / 2 - 52, cy + 62, 104, 114, true);

  // Instructions
  ctx.fillStyle = '#c084fc';
  ctx.font = '15px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Run · Jump · Collect Crystals · Survive!', cx + cw / 2, cy + 200);
  ctx.fillStyle = 'rgba(168,85,247,.7)';
  ctx.font = '13px "Segoe UI",Verdana,sans-serif';
  ctx.fillText('SPACE / \u2191  to jump      \u2190 \u2192 / A D  to nudge', cx + cw / 2, cy + 220);

  // Blinking call-to-action
  const bl = (Date.now() / 560 | 0) % 2;
  ctx.save();
  ctx.shadowColor = bl ? '#e879f9' : 'transparent';
  ctx.shadowBlur  = bl ? 14 : 0;
  ctx.fillStyle   = bl ? '#e879f9' : '#9333ea';
  ctx.font = 'bold 17px "Segoe UI",Verdana,sans-serif';
  ctx.fillText('\u25b6  PRESS SPACE OR CLICK TO START', cx + cw / 2, cy + 328);
  ctx.restore();

  ctx.textAlign = 'left';

  // Leaderboard panel (right side)
  const lx = cx + cw + 15; // 490
  const lw = W - lx - 15;  // 295
  drawLBPanel(lx, cy, lw, ch);
}

// ── Screen: Nickname ──────────────────────────────────────────────────────────
function drawNickname() {
  ctx.fillStyle = 'rgba(3,1,10,.82)';
  ctx.fillRect(0, 0, W, H);

  const cw = 420, ch = 220;
  const cx = W / 2 - cw / 2;
  const cy = H / 2 - ch / 2;

  ctx.fillStyle = 'rgba(10,5,26,.97)';
  rrect(cx, cy, cw, ch, 18); ctx.fill();
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 2;
  rrect(cx, cy, cw, ch, 18); ctx.stroke();

  // Title
  ctx.save();
  ctx.shadowColor = '#a855f7';
  ctx.shadowBlur  = 18;
  ctx.fillStyle   = '#e879f9';
  ctx.font = 'bold 26px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ENTER YOUR NAME', W / 2, cy + 50);
  ctx.restore();

  // Input box
  const ibx = cx + 28;
  const iby = cy + 72;
  const ibw = cw - 56;
  const ibh = 44;

  ctx.fillStyle = 'rgba(30,10,60,.9)';
  rrect(ibx, iby, ibw, ibh, 8); ctx.fill();
  ctx.strokeStyle = '#9333ea';
  ctx.lineWidth = 1.5;
  rrect(ibx, iby, ibw, ibh, 8); ctx.stroke();

  // Typed name with blinking cursor
  const cursor = (Date.now() / 500 | 0) % 2 ? '|' : ' ';
  ctx.fillStyle = '#f0e8ff';
  ctx.font = 'bold 20px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText((playerName || '') + cursor, ibx + 12, iby + 29);

  // Hint
  ctx.fillStyle = 'rgba(168,85,247,.6)';
  ctx.font = '12px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Type your nickname  \u00b7  Enter or click to confirm', W / 2, cy + 155);

  // Confirm button
  const btnx = W / 2 - 90;
  const btny = cy + 170;
  ctx.fillStyle = '#6d28d9';
  rrect(btnx, btny, 180, 36, 8); ctx.fill();
  ctx.strokeStyle = '#e879f9';
  ctx.lineWidth = 1.5;
  rrect(btnx, btny, 180, 36, 8); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px "Segoe UI",Verdana,sans-serif';
  ctx.fillText('\u25b6  CONFIRM', W / 2, btny + 24);

  ctx.textAlign = 'left';
}

// ── Screen: Game Over ─────────────────────────────────────────────────────────
function drawGameOver() {
  ctx.fillStyle = 'rgba(3,1,10,.88)';
  ctx.fillRect(0, 0, W, H);

  const cw = 480, ch = 380;
  const cx = W / 2 - cw / 2;
  const cy = H / 2 - ch / 2;

  ctx.fillStyle = 'rgba(12,4,30,.97)';
  rrect(cx, cy, cw, ch, 18); ctx.fill();
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 2;
  rrect(cx, cy, cw, ch, 18); ctx.stroke();

  // Game Over title
  ctx.save();
  ctx.shadowColor = '#dc2626';
  ctx.shadowBlur  = 20;
  ctx.fillStyle   = '#f87171';
  ctx.font = 'bold 46px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', W / 2, cy + 62);
  ctx.restore();

  // Score
  ctx.fillStyle = '#f0abfc';
  ctx.font = 'bold 24px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Crystals: ' + score, W / 2, cy + 106);

  // Best score
  if (best > 0) {
    ctx.fillStyle = '#a78bfa';
    ctx.font = '16px "Segoe UI",Verdana,sans-serif';
    ctx.fillText('Best: ' + best, W / 2, cy + 130);
  }

  // Leaderboard sub-panel
  drawLBPanel(cx + 20, cy + 148, cw - 40, 162);

  // Restart button
  const bx = W / 2 - 105;
  const by = cy + 322;
  ctx.fillStyle = '#6d28d9';
  rrect(bx, by, 210, 46, 10); ctx.fill();
  ctx.strokeStyle = '#e879f9';
  ctx.lineWidth = 2;
  rrect(bx, by, 210, 46, 10); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('\u25b6  PLAY AGAIN', W / 2, by + 30);

  ctx.textAlign = 'left';
}

// ── Main render loop ──────────────────────────────────────────────────────────
function loop() {
  ctx.save();

  // Screen shake offset — only during active gameplay
  if (gs === 'playing' && shakePow > 1) {
    ctx.translate(
      (Math.random() - 0.5) * shakePow * 0.6,
      (Math.random() - 0.5) * shakePow * 0.4
    );
  }

  drawBG();

  if (gs === 'playing' || gs === 'gameover') {
    update();
    drawPlats();
    drawXtals();
    drawPlayer();
    drawParts();
    drawHUD();

    // Red death flash overlay
    if (flashA > 0) {
      ctx.fillStyle = `rgba(200,0,100,${(flashA * 0.38).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  if (gs === 'loading')  drawLoading();
  if (gs === 'start')    drawStart();
  if (gs === 'nickname') drawNickname();
  if (gs === 'gameover') drawGameOver();

  ctx.restore();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
