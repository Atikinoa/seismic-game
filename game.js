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

// ── Game state ────────────────────────────────────────────────────────────────
let gs       = 'loading'; // loading | start | playing | gameover
let score    = 0;
let best     = 0;
let lives    = 3;
let camX     = 0;         // world X at left edge of screen
let genX     = 0;         // rightmost generated platform right edge (world X)
let spd      = BASE_SPD;  // current scroll speed
let flashA   = 0;         // death flash alpha 0..1
let shakePow = 0;         // screen shake intensity

// ── Player object ─────────────────────────────────────────────────────────────
// xo  = horizontal screen offset from PX
// y   = vertical screen position
// vy  = vertical velocity
// ground = is on ground
// inv = invincibility frames remaining
// bob = bob animation timer
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
  if (c === 'ArrowLeft'  || c === 'KeyA') { K.L = true;  e.preventDefault(); }
  if (c === 'ArrowRight' || c === 'KeyD') { K.R = true;  e.preventDefault(); }
  if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') {
    K.J = true;
    e.preventDefault();
    if (gs === 'start' || gs === 'gameover') startGame();
  }
});

document.addEventListener('keyup', e => {
  const c = e.code;
  if (c === 'ArrowLeft'  || c === 'KeyA') K.L = false;
  if (c === 'ArrowRight' || c === 'KeyD') K.R = false;
  if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') K.J = false;
});

C.addEventListener('click', e => {
  if (gs === 'start') { startGame(); return; }
  if (gs === 'gameover') {
    // Check restart button hit area
    const rect = C.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top)  * (H / rect.height);
    const bx = W / 2 - 105;
    const by = H / 2 - 148 + 175;
    if (mx > bx && mx < bx + 210 && my > by && my < by + 50) startGame();
  }
});

function startGame() {
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

  // Jump — only from ground, no restriction during invincibility
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
    gs = 'gameover';
    return;
  }

  // Find the platform closest to screen center to respawn on
  let pick = null;
  let bd   = Infinity;
  for (const pl of plats) {
    const sx = pl.wx - camX;
    if (sx + pl.w < 0 || sx > W) continue;
    const d = Math.abs(sx + pl.w / 2 - W / 2);
    if (d < bd) { bd = d; pick = pl; }
  }

  // Reposition camera so chosen platform sits under the player
  if (pick) {
    camX = pick.wx - PX;
    P.y  = pick.y - PH - 2;
  } else {
    P.y = GY - PH;
  }
  P.xo     = 0;
  P.vy     = 0;
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

  // 'screen' composite removes the black JPG background cleanly
  drawImg(I_SIDE, dx, dy, dw, dh, true);
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

  const cw = 492, ch = 348;
  const cx = W / 2 - cw / 2;
  const cy = H / 2 - ch / 2;

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
  ctx.font = 'bold 44px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SEISMIC RUN', W / 2, cy + 58);
  ctx.restore();

  // Mascot front view — screen blend removes black background
  drawImg(I_FRONT, W / 2 - 62, cy + 68, 124, 136, true);

  // Instructions
  ctx.fillStyle = '#c084fc';
  ctx.font = '16px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Run · Jump · Collect Crystals · Survive!', W / 2, cy + 232);
  ctx.fillStyle = 'rgba(168,85,247,.7)';
  ctx.font = '14px "Segoe UI",Verdana,sans-serif';
  ctx.fillText('SPACE / ↑  to jump      ← → / A D  to nudge', W / 2, cy + 255);

  // Blinking call-to-action
  const bl = (Date.now() / 560 | 0) % 2;
  ctx.save();
  ctx.shadowColor = bl ? '#e879f9' : 'transparent';
  ctx.shadowBlur  = bl ? 14 : 0;
  ctx.fillStyle   = bl ? '#e879f9' : '#9333ea';
  ctx.font = 'bold 20px "Segoe UI",Verdana,sans-serif';
  ctx.fillText('▶  PRESS SPACE OR CLICK TO START', W / 2, cy + 307);
  ctx.restore();

  ctx.textAlign = 'left';
}

// ── Screen: Game Over ─────────────────────────────────────────────────────────
function drawGameOver() {
  ctx.fillStyle = 'rgba(3,1,10,.88)';
  ctx.fillRect(0, 0, W, H);

  const cw = 380, ch = 295;
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
  ctx.font = 'bold 26px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Crystals: ' + score, W / 2, cy + 120);

  // Best score
  if (best > 0) {
    ctx.fillStyle = '#a78bfa';
    ctx.font = '17px "Segoe UI",Verdana,sans-serif';
    ctx.fillText('Best: ' + best, W / 2, cy + 150);
  }

  // Restart button
  const bx = W / 2 - 105;
  const by = cy + 175;
  ctx.fillStyle = '#6d28d9';
  rrect(bx, by, 210, 50, 10); ctx.fill();
  ctx.strokeStyle = '#e879f9';
  ctx.lineWidth = 2;
  rrect(bx, by, 210, 50, 10); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px "Segoe UI",Verdana,sans-serif';
  ctx.fillText('▶  PLAY AGAIN', W / 2, by + 33);

  ctx.textAlign = 'left';
}

// ── Main render loop ──────────────────────────────────────────────────────────
function loop() {
  ctx.save();

  // Screen shake offset
  if (shakePow > 1) {
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
  if (gs === 'gameover') drawGameOver();

  ctx.restore();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
