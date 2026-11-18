// VOIDHARVEST — a roguelite arena survival game in a single ES module.
// You pilot the last skiff of a dying star through ten waves of the Hollow
// swarm. Weapons fire on their own; you fly, dodge, harvest the light (XP)
// that falls from the dead, and pick one of three upgrades at every level.
// Elites drop star-cores and hearts. In wave 10 the Hollow Maw arrives:
// kill it to seal the breach and win. Die, and the void keeps you.
//
// Structure: a fixed-step update over plain entity arrays, a canvas 2D
// renderer with pre-rendered nebula/starfield layers, DOM for HUD + menus,
// and a WebAudio synth (see audio.js). No assets, no network, deterministic
// under ?seed=N. window.VOIDHARVEST exposes a small handle for testing.

import { AudioEngine } from './audio.js';

// ---------------------------------------------------------------- utils
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };

// Deterministic RNG (mulberry-style LCG); ?seed= fixes a run for testing.
const params = new URLSearchParams(location.search);
let _s = (parseInt(params.get('seed') || '', 10) || (Date.now() % 2147483646) + 1) >>> 0;
function rnd() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }
const rr = (a, b) => a + rnd() * (b - a);
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

// ---------------------------------------------------------------- dom
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const hud = $('hud'), hpfill = $('hpfill'), hptext = $('hptext'), xpfill = $('xpfill');
const lvlbadge = $('lvlbadge'), timerEl = $('timer'), waveEl = $('waveinfo');
const scoreEl = $('score'), killEl = $('killinfo'), loadoutEl = $('loadout');
const bossbar = $('bossbar'), bossfill = $('bossfill');
const banner = $('banner'), bannerTitle = $('bannerTitle'), bannerSub = $('bannerSub');
const hurtflash = $('hurtflash');

const audio = new AudioEngine();

// ---------------------------------------------------------------- world
const WORLD = { w: 2600, h: 2000 };
const WAVE_TIME = 30;           // seconds per wave
const MAX_WAVE = 10;
const RUN_TIME = WAVE_TIME * MAX_WAVE;

const WEAPON_DEFS = {
  pulse:  { name: 'Pulse Blaster', kind: 'WEAPON', max: 5,
            blurb: (l) => `Rapid bolts seek the nearest Hollow. Lv${l}: more damage, faster fire, extra bolts at Lv3 and Lv5.` },
  orbit:  { name: 'Orbit Blades', kind: 'WEAPON', max: 5,
            blurb: (l) => `Spectral blades circle your skiff and shred anything they touch. Lv${l}: more blades, wider orbit.` },
  nova:   { name: 'Nova Bloom', kind: 'WEAPON', max: 5,
            blurb: (l) => `Periodic starbursts fire a ring of piercing shards in every direction. Lv${l}: more shards, shorter fuse.` },
  arc:    { name: 'Arc Conductor', kind: 'WEAPON', max: 5,
            blurb: (l) => `Lightning leaps between clustered Hollow. Lv${l}: more chains, harder strikes.` },
  seeker: { name: 'Seeker Swarm', kind: 'WEAPON', max: 5,
            blurb: (l) => `Homing fireflies that hunt the swarm and burst on impact. Lv${l}: bigger volleys, bigger booms.` },
};
const PASSIVE_DEFS = {
  thrusters: { name: 'Swift Thrusters', kind: 'MODULE', max: 5, blurb: (l) => `+9% movement speed per level (now Lv${l}). Outrun the tide.` },
  plating:   { name: 'Aegis Plating', kind: 'MODULE', max: 5, blurb: (l) => `+22 max hull and +1 armour per level (now Lv${l}).` },
  magnet:    { name: 'Magnet Coil', kind: 'MODULE', max: 5, blurb: (l) => `+45% light-harvest radius per level (now Lv${l}).` },
  nanites:   { name: 'Repair Nanites', kind: 'MODULE', max: 5, blurb: (l) => `Regenerate +0.7 hull per second per level (now Lv${l}).` },
  overcharge:{ name: 'Overcharge Core', kind: 'MODULE', max: 5, blurb: (l) => `+12% damage on every weapon per level (now Lv${l}).` },
};
const ENEMY_TYPES = {
  drifter: { hp: 16, speed: 74,  r: 15, dmg: 10, xp: 1, score: 10, color: '#b388ff' },
  skitter: { hp: 9,  speed: 138, r: 11, dmg: 7,  xp: 1, score: 15, color: '#6ff3ff' },
  spitter: { hp: 22, speed: 62,  r: 16, dmg: 8,  xp: 2, score: 25, color: '#8dff6f' },
  bulwark: { hp: 95, speed: 38,  r: 27, dmg: 16, xp: 3, score: 40, color: '#ff8a5d' },
};

// ---------------------------------------------------------------- state
let state = 'title'; // title | playing | levelup | paused | over | victory
let player, enemies, bullets, ebullets, gems, pickups, particles, floaters, arcs;
let cam, elapsed, wave, kills, score, shake, hitstop, spawnT, boss, bossSpawned;
let pendingLevels, best;

function loadBest() {
  try { return JSON.parse(localStorage.getItem('voidharvest_best') || 'null'); }
  catch { return null; }
}
function saveBest() {
  const rec = { score, wave, kills, time: Math.floor(elapsed) };
  if (!best || score > best.score) { best = rec; try { localStorage.setItem('voidharvest_best', JSON.stringify(rec)); } catch {} }
  return rec;
}

function newPlayer() {
  return {
    x: WORLD.w / 2, y: WORLD.h / 2, vx: 0, vy: 0, r: 14, angle: -Math.PI / 2,
    hp: 100, maxhp: 100, level: 1, xp: 0, xpNext: 8,
    weapons: { pulse: 1 }, passives: {},
    timers: { pulse: 0, nova: 1.2, arc: 0.6, seeker: 0.8 },
    hurtCd: 0, regen: 0,
  };
}
const dmgMul = () => 1 + 0.12 * (player.passives.overcharge || 0);
const speedMul = () => 1 + 0.09 * (player.passives.thrusters || 0);
const magnetR = () => 95 * (1 + 0.45 * (player.passives.magnet || 0));
const armor = () => player.passives.plating || 0;

function reset() {
  player = newPlayer();
  enemies = []; bullets = []; ebullets = []; gems = []; pickups = [];
  particles = []; floaters = []; arcs = [];
  cam = { x: player.x - W / 2, y: player.y - H / 2 };
  elapsed = 0; wave = 1; kills = 0; score = 0;
  shake = 0; hitstop = 0; spawnT = 0.5; boss = null; bossSpawned = false;
  pendingLevels = 0;
}

function startRun() {
  audio.init();
  reset();
  state = 'playing';
  $('title').classList.add('hidden');
  $('over').classList.add('hidden');
  $('victory').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('levelup').classList.add('hidden');
  hud.classList.add('on');
  audio.startMusic();
  showBanner('WAVE 1', 'THE SWARM STIRS');
  syncLoadout();
}

// ---------------------------------------------------------------- input
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
  if (state === 'playing' && (e.key === 'p' || e.key === 'P' || e.key === 'Escape')) pauseGame();
  else if (state === 'paused' && (e.key === 'p' || e.key === 'P' || e.key === 'Escape')) resumeGame();
  else if (state === 'levelup' && ['1', '2', '3'].includes(e.key)) {
    const card = document.querySelectorAll('.card')[Number(e.key) - 1];
    if (card) card.click();
  }
  if (e.key.toLowerCase() === 'm') toggleMute();
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

function toggleMute() {
  audio.init();
  audio.setMuted(!audio.muted);
  $('muteBtn').textContent = audio.muted ? 'SOUND OFF' : 'SOUND ON';
}
$('muteBtn').addEventListener('click', toggleMute);
$('startBtn').addEventListener('click', () => { audio.uiClick(); startRun(); });
$('retryBtn').addEventListener('click', () => { audio.uiClick(); startRun(); });
$('againBtn').addEventListener('click', () => { audio.uiClick(); startRun(); });
$('resumeBtn').addEventListener('click', () => { audio.uiClick(); resumeGame(); });
$('restartBtn').addEventListener('click', () => { audio.uiClick(); startRun(); });

function pauseGame() { if (state !== 'playing') return; state = 'paused'; $('pause').classList.remove('hidden'); }
function resumeGame() { if (state !== 'paused') return; state = 'playing'; $('pause').classList.add('hidden'); }

// ---------------------------------------------------------------- banner / hud
let bannerTimer = null;
function showBanner(title, sub) {
  bannerTitle.textContent = title;
  bannerSub.textContent = sub || '';
  banner.classList.add('on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove('on'), 2100);
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function syncLoadout() {
  const parts = [];
  for (const [k, l] of Object.entries(player.weapons)) parts.push(`${WEAPON_DEFS[k].name} <b>Lv${l}</b>`);
  for (const [k, l] of Object.entries(player.passives)) parts.push(`${PASSIVE_DEFS[k].name} <b>Lv${l}</b>`);
  loadoutEl.innerHTML = parts.join('<br>');
}

function syncHud() {
  hpfill.style.width = clamp((player.hp / player.maxhp) * 100, 0, 100) + '%';
  hptext.textContent = `${Math.ceil(player.hp)} / ${player.maxhp} HULL`;
  xpfill.style.width = clamp((player.xp / player.xpNext) * 100, 0, 100) + '%';
  lvlbadge.textContent = 'LV ' + player.level;
  timerEl.textContent = fmtTime(elapsed);
  waveEl.textContent = boss ? 'THE HOLLOW MAW' : 'WAVE ' + wave + ' / ' + MAX_WAVE;
  scoreEl.textContent = score.toLocaleString('en-US');
  killEl.textContent = '☠ ' + kills;
  if (boss && boss.hp > 0) { bossbar.classList.add('on'); bossfill.style.width = clamp((boss.hp / boss.maxhp) * 100, 0, 100) + '%'; }
  else bossbar.classList.remove('on');
}

// ---------------------------------------------------------------- upgrades
function upgradePool() {
  const pool = [];
  for (const [k, def] of Object.entries(WEAPON_DEFS)) {
    const cur = player.weapons[k] || 0;
    if (cur < def.max) pool.push({ id: k, type: 'weapon', cur, def });
  }
  for (const [k, def] of Object.entries(PASSIVE_DEFS)) {
    const cur = player.passives[k] || 0;
    if (cur < def.max) pool.push({ id: k, type: 'passive', cur, def });
  }
  return pool;
}

function drawUpgrades() {
  const pool = upgradePool();
  const chosen = [];
  while (chosen.length < 3 && pool.length) {
    const i = Math.floor(rnd() * pool.length);
    chosen.push(pool.splice(i, 1)[0]);
  }
  return chosen;
}

function applyUpgrade(u) {
  if (u.type === 'weapon') {
    player.weapons[u.id] = (player.weapons[u.id] || 0) + 1;
  } else {
    player.passives[u.id] = (player.passives[u.id] || 0) + 1;
    if (u.id === 'plating') { player.maxhp += 22; player.hp = Math.min(player.maxhp, player.hp + 22); }
  }
  syncLoadout();
}

function openLevelUp() {
  state = 'levelup';
  audio.levelup();
  const cards = $('cards');
  cards.innerHTML = '';
  drawUpgrades().forEach((u, i) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="kind">${u.cur === 0 ? 'NEW ' + u.def.kind : u.def.kind + ' UPGRADE'}</div>
      <h3>${u.def.name}</h3><div class="lv">${u.cur === 0 ? 'UNLOCK' : 'LV ' + u.cur + ' → LV ' + (u.cur + 1)}</div>
      <p>${u.def.blurb(u.cur + 1)}</p><div class="key">PRESS ${i + 1} OR CLICK</div>`;
    el.addEventListener('click', () => {
      audio.uiClick();
      applyUpgrade(u);
      $('levelup').classList.add('hidden');
      pendingLevels--;
      if (pendingLevels > 0) openLevelUp();
      else state = 'playing';
    });
    cards.appendChild(el);
  });
  $('levelup').classList.remove('hidden');
}

function gainXp(n) {
  player.xp += n;
  while (player.xp >= player.xpNext) {
    player.xp -= player.xpNext;
    player.level++;
    player.xpNext = Math.round(8 + player.level * 5 + Math.pow(player.level, 1.75));
    pendingLevels++;
  }
  if (pendingLevels > 0 && state === 'playing') openLevelUp();
}

// ---------------------------------------------------------------- spawning
function spawnPos() {
  // On a ring just outside the camera view, clamped inside the world.
  const a = rr(0, TAU), d = rr(560, 760);
  return {
    x: clamp(player.x + Math.cos(a) * d, 30, WORLD.w - 30),
    y: clamp(player.y + Math.sin(a) * d, 30, WORLD.h - 30),
  };
}

function hpScale() { return 1 + elapsed / 40 * 0.55 + (wave - 1) * 0.18; }

function spawnEnemy(type, elite = false, at = null) {
  const def = ENEMY_TYPES[type];
  const p = at || spawnPos();
  const mul = hpScale() * (elite ? 9 : 1);
  enemies.push({
    type, x: p.x, y: p.y, vx: 0, vy: 0,
    hp: def.hp * mul, maxhp: def.hp * mul,
    speed: def.speed * rr(0.88, 1.12) * (elite ? 0.8 : 1),
    r: def.r * (elite ? 1.9 : 1), dmg: def.dmg * (elite ? 1.6 : 1),
    xp: def.xp * (elite ? 6 : 1), score: def.score * (elite ? 8 : 1),
    color: def.color, elite, flash: 0, touchCd: 0, shootCd: rr(1, 2.4), wob: rr(0, TAU),
  });
}

function director(dt) {
  spawnT -= dt;
  const cap = 26 + wave * 9;
  if (spawnT <= 0 && enemies.length < cap + 40) {
    spawnT = Math.max(0.16, 1.15 - wave * 0.09 - elapsed / 600);
    const batch = 1 + Math.floor(wave / 2) + (rnd() < 0.35 ? 1 : 0);
    for (let i = 0; i < batch; i++) {
      let type = 'drifter';
      const roll = rnd();
      if (wave >= 2 && roll < 0.24) type = 'skitter';
      else if (wave >= 3 && roll < 0.40) type = 'spitter';
      else if (wave >= 4 && roll < 0.52) type = 'bulwark';
      spawnEnemy(type);
    }
    // Elites: rare, announced by their size and the core they carry.
    if (wave >= 3 && rnd() < 0.028) spawnEnemy(pick(['drifter', 'bulwark', 'spitter']), true);
  }
  // Wave clock.
  const w = Math.min(MAX_WAVE, Math.floor(elapsed / WAVE_TIME) + 1);
  if (w !== wave) {
    wave = w;
    score += 100 * wave;
    const subs = ['', 'THE SWARM STIRS', 'THEY LEARN TO RUN', 'SPIT AND VENOM', 'THE WALLS CLOSE IN',
      'A HUNGER, ORGANISED', 'THE DARK THICKENS', 'NO QUARTER GIVEN', 'THE BREACH WIDENS', 'IT COMES', 'THE MAW OPENS'];
    showBanner('WAVE ' + wave, subs[wave] || '');
    if (wave === MAX_WAVE && !bossSpawned) spawnBoss();
  }
}

function spawnBoss() {
  bossSpawned = true;
  const p = spawnPos();
  const hp = 5200 * (1 + (player.level - 1) * 0.06);
  boss = {
    type: 'maw', x: p.x, y: p.y, vx: 0, vy: 0, r: 64,
    hp, maxhp: hp, speed: 52, dmg: 26, xp: 150, score: 5000,
    color: '#ff5da2', elite: true, flash: 0, touchCd: 0, shootCd: 2,
    mode: 'chase', modeT: 3, atkT: 2.5, wob: 0,
  };
  enemies.push(boss);
  audio.bossRoar();
  showBanner('THE HOLLOW MAW', 'KILL IT AND SEAL THE BREACH');
  shake = Math.max(shake, 14);
}

// ---------------------------------------------------------------- effects
function burst(x, y, color, n, speed = 260, life = 0.55, size = 3) {
  for (let i = 0; i < n; i++) {
    if (particles.length > 900) break;
    const a = rr(0, TAU), v = rr(speed * 0.25, speed);
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rr(life * 0.4, life), maxlife: life, color, size: rr(1.5, size) });
  }
}
function floater(x, y, text, color, size = 14) {
  floaters.push({ x: x + rr(-8, 8), y, vy: -56, life: 0.8, text, color, size });
  if (floaters.length > 60) floaters.shift();
}
function addShake(n) { shake = Math.min(20, Math.max(shake, n)); }

// ---------------------------------------------------------------- combat
function nearestEnemy(x, y, maxD = 1e9) {
  let bestE = null, bd = maxD * maxD;
  for (const e of enemies) { const d = dist2(x, y, e.x, e.y); if (d < bd) { bd = d; bestE = e; } }
  return bestE;
}

function fireWeapons(dt) {
  const p = player, T = p.timers;
  // Pulse Blaster: bolts at the nearest Hollow.
  if (p.weapons.pulse) {
    T.pulse -= dt;
    const lv = p.weapons.pulse;
    if (T.pulse <= 0) {
      const target = nearestEnemy(p.x, p.y, 560);
      if (target) {
        T.pulse = Math.max(0.16, 0.34 - lv * 0.03);
        const shots = lv >= 5 ? 3 : lv >= 3 ? 2 : 1;
        for (let i = 0; i < shots; i++) {
          const spread = (i - (shots - 1) / 2) * 0.14;
          const a = Math.atan2(target.y - p.y, target.x - p.x) + spread;
          bullets.push({ x: p.x, y: p.y, vx: Math.cos(a) * 660, vy: Math.sin(a) * 660, r: 5, dmg: (10 + lv * 3.4) * dmgMul(), life: 0.85, color: '#6ff3ff', pierce: 0 });
        }
        audio.shoot();
      } else T.pulse = 0.08;
    }
  }
  // Nova Bloom: radial shard ring.
  if (p.weapons.nova) {
    T.nova -= dt;
    const lv = p.weapons.nova;
    if (T.nova <= 0) {
      T.nova = Math.max(1.5, 3.4 - lv * 0.34);
      const n = 8 + lv * 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + elapsed;
        bullets.push({ x: p.x, y: p.y, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480, r: 5, dmg: (9 + lv * 3) * dmgMul(), life: 0.62, color: '#ffc857', pierce: 1 });
      }
      burst(p.x, p.y, '#ffc857', 10, 160, 0.3, 2.5);
      audio.explode(false);
    }
  }
  // Arc Conductor: chain lightning.
  if (p.weapons.arc) {
    T.arc -= dt;
    const lv = p.weapons.arc;
    if (T.arc <= 0) {
      let from = { x: p.x, y: p.y };
      let hitSet = new Set();
      let chains = 2 + lv;
      let range = 330;
      let struck = false;
      while (chains-- > 0) {
        let bestE = null, bd = range * range;
        for (const e of enemies) { if (hitSet.has(e)) continue; const d = dist2(from.x, from.y, e.x, e.y); if (d < bd) { bd = d; bestE = e; } }
        if (!bestE) break;
        hitSet.add(bestE);
        arcs.push({ x1: from.x, y1: from.y, x2: bestE.x, y2: bestE.y, life: 0.14 });
        damageEnemy(bestE, (13 + lv * 4.5) * dmgMul(), from.x, from.y, 60);
        from = bestE; struck = true;
      }
      if (struck) { T.arc = Math.max(0.5, 1.25 - lv * 0.12); audio.arcZap(); }
      else T.arc = 0.15;
    }
  }
  // Seeker Swarm: homing fireflies.
  if (p.weapons.seeker) {
    T.seeker -= dt;
    const lv = p.weapons.seeker;
    if (T.seeker <= 0) {
      if (enemies.length) {
        T.seeker = Math.max(0.55, 1.5 - lv * 0.16);
        const n = 1 + Math.floor(lv / 1.5);
        for (let i = 0; i < n; i++) {
          const a = rr(0, TAU);
          bullets.push({ x: p.x, y: p.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, r: 6, dmg: (14 + lv * 4) * dmgMul(), life: 2.4, color: '#8dff6f', homing: true, aoe: 46 + lv * 5, turn: 5.2 });
        }
        audio.seeker();
      } else T.seeker = 0.2;
    }
  }
}

function damageEnemy(e, dmg, fromX, fromY, knock = 130) {
  e.hp -= dmg;
  e.flash = 0.09;
  const a = Math.atan2(e.y - fromY, e.x - fromX);
  const kb = e.type === 'maw' ? 0 : knock / (e.r * 0.14 + 6);
  e.vx += Math.cos(a) * kb; e.vy += Math.sin(a) * kb;
  floater(e.x, e.y - e.r, String(Math.round(dmg)), '#eaf7ff', dmg > 40 ? 17 : 13);
  if (e.hp <= 0 && !e.dead) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  kills++;
  score += e.score;
  burst(e.x, e.y, e.color, e.type === 'maw' ? 130 : e.elite ? 42 : 14, e.type === 'maw' ? 430 : 280, 0.7, 3.4);
  burst(e.x, e.y, '#ffffff', 5, 200, 0.3, 2);
  if (e.elite && e.type !== 'maw') {
    addShake(7); hitstop = Math.max(hitstop, 0.05);
    pickups.push({ x: e.x, y: e.y, kind: 'core', r: 11 });
    if (rnd() < 0.65) pickups.push({ x: e.x + rr(-26, 26), y: e.y + rr(-26, 26), kind: 'heart', r: 10 });
    audio.explode(true);
  } else if (e.type === 'maw') {
    addShake(20); hitstop = Math.max(hitstop, 0.22);
    audio.explode(true);
  } else audio.hit();
  // Light falls from the dead.
  let xpLeft = e.xp;
  while (xpLeft > 0) {
    const v = xpLeft >= 5 ? 5 : 1;
    xpLeft -= v;
    gems.push({ x: e.x + rr(-14, 14), y: e.y + rr(-14, 14), vx: rr(-40, 40), vy: rr(-40, 40), v, r: v >= 5 ? 7 : 5, mag: false });
  }
  if (e.type === 'maw') onBossDeath();
}

function hurtPlayer(dmg) {
  const real = Math.max(1, dmg - armor());
  player.hp -= real;
  player.hurtCd = 0.45;
  hurtflash.style.opacity = 1;
  setTimeout(() => { hurtflash.style.opacity = 0; }, 90);
  addShake(8);
  audio.hurt();
  burst(player.x, player.y, '#ff5d7a', 12, 240, 0.4, 3);
  if (player.hp <= 0) { player.hp = 0; onDeath(); }
}

function onDeath() {
  state = 'over';
  audio.stopMusic();
  audio.explode(true);
  audio.gameover();
  burst(player.x, player.y, '#6ff3ff', 90, 420, 1.1, 4);
  const rec = saveBest();
  $('overStats').innerHTML =
    `SCORE <b>${score.toLocaleString('en-US')}</b> · BEST <b>${rec.score.toLocaleString('en-US')}</b><br>` +
    `SURVIVED <b>${fmtTime(elapsed)}</b> · REACHED <b>WAVE ${wave}</b><br>` +
    `LEVEL <b>${player.level}</b> · KILLS <b>${kills}</b>`;
  $('over').classList.remove('hidden');
}

function onBossDeath() {
  boss = null;
  state = 'victory';
  score += 2500;
  audio.stopMusic();
  audio.victory();
  const rec = saveBest();
  $('winStats').innerHTML =
    `SCORE <b>${score.toLocaleString('en-US')}</b> · BEST <b>${rec.score.toLocaleString('en-US')}</b><br>` +
    `CLEARED IN <b>${fmtTime(elapsed)}</b> · LEVEL <b>${player.level}</b> · KILLS <b>${kills}</b><br>` +
    `The star breathes again. The light you harvested becomes a dawn.`;
  setTimeout(() => { if (state === 'victory') $('victory').classList.remove('hidden'); }, 650);
}

// ---------------------------------------------------------------- update
function update(dt) {
  elapsed += dt;
  const p = player;

  // Movement: WASD / arrows, smoothed, world-bounded.
  let mx = 0, my = 0;
  if (keys['w'] || keys['arrowup']) my -= 1;
  if (keys['s'] || keys['arrowdown']) my += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  const ml = Math.hypot(mx, my) || 1;
  const spd = 238 * speedMul();
  p.vx = lerp(p.vx, (mx / ml) * spd * (mx || my ? 1 : 0), 1 - Math.pow(0.0001, dt));
  p.vy = lerp(p.vy, (my / ml) * spd * (mx || my ? 1 : 0), 1 - Math.pow(0.0001, dt));
  p.x = clamp(p.x + p.vx * dt, p.r, WORLD.w - p.r);
  p.y = clamp(p.y + p.vy * dt, p.r, WORLD.h - p.r);
  if (mx || my) p.angle = Math.atan2(my, mx);
  p.hurtCd = Math.max(0, p.hurtCd - dt);
  if (p.passives.nanites) p.hp = Math.min(p.maxhp, p.hp + 0.7 * p.passives.nanites * dt);
  // Engine trail.
  if ((mx || my) && particles.length < 900 && rnd() < 0.7) {
    particles.push({ x: p.x - Math.cos(p.angle) * 14, y: p.y - Math.sin(p.angle) * 14, vx: -p.vx * 0.3 + rr(-16, 16), vy: -p.vy * 0.3 + rr(-16, 16), life: rr(0.2, 0.42), maxlife: 0.42, color: '#37e0ff', size: rr(1.6, 3) });
  }

  director(dt);
  fireWeapons(dt);

  // Orbit Blades: contact damage on a ring around the skiff.
  if (p.weapons.orbit) {
    const lv = p.weapons.orbit;
    const blades = 1 + lv, orbitR = 62 + lv * 7;
    for (const e of enemies) {
      e.orbitCd = Math.max(0, (e.orbitCd || 0) - dt);
      if (e.orbitCd > 0) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (Math.abs(d - orbitR) < e.r + 13) {
        damageEnemy(e, (12 + lv * 4) * dmgMul(), p.x, p.y, 210);
        e.orbitCd = 0.34;
      }
    }
    p._orbitBlades = blades; p._orbitR = orbitR;
  }

  // Enemies.
  for (const e of enemies) {
    e.flash = Math.max(0, e.flash - dt);
    e.touchCd = Math.max(0, e.touchCd - dt);
    e.wob += dt * 3;
    const a = Math.atan2(p.y - e.y, p.x - e.x);
    let tx = Math.cos(a), ty = Math.sin(a);
    if (e.type === 'skitter') { const w = Math.sin(e.wob * 2.2) * 0.65; const c = Math.cos(w), s = Math.sin(w); const nx = tx * c - ty * s, ny = tx * s + ty * c; tx = nx; ty = ny; }
    if (e.type === 'spitter') {
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d < 210) { tx = -tx; ty = -ty; }
      else if (d < 250) { tx = -ty * 0.6; ty = tx * 0.6; }
      e.shootCd -= dt;
      if (e.shootCd <= 0 && d < 430) {
        e.shootCd = rr(1.7, 2.5);
        ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 265, vy: Math.sin(a) * 265, r: 6, dmg: e.dmg + 4, life: 3.2 });
      }
    }
    if (e.type === 'maw') updateBoss(e, dt, a);
    else {
      e.vx = lerp(e.vx, tx * e.speed, 1 - Math.pow(0.001, dt));
      e.vy = lerp(e.vy, ty * e.speed, 1 - Math.pow(0.001, dt));
    }
    e.x = clamp(e.x + e.vx * dt, e.r, WORLD.w - e.r);
    e.y = clamp(e.y + e.vy * dt, e.r, WORLD.h - e.r);
    // Contact.
    if (e.touchCd <= 0 && p.hurtCd <= 0 && dist2(e.x, e.y, p.x, p.y) < (e.r + p.r) * (e.r + p.r)) {
      hurtPlayer(e.dmg);
      e.touchCd = 0.65;
      e.vx = -tx * 120; e.vy = -ty * 120;
      if (state !== 'playing') return;
    }
  }
  enemies = enemies.filter((e) => !e.dead);

  // Player bullets.
  for (const b of bullets) {
    if (b.homing) {
      const t = nearestEnemy(b.x, b.y, 520);
      if (t) {
        const cur = Math.atan2(b.vy, b.vx), want = Math.atan2(t.y - b.y, t.x - b.x);
        let diff = want - cur;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        const na = cur + clamp(diff, -b.turn * dt, b.turn * dt);
        const sp = Math.min(560, Math.hypot(b.vx, b.vy) + 340 * dt);
        b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || b.x < -30 || b.y < -30 || b.x > WORLD.w + 30 || b.y > WORLD.h + 30) { b.dead = true; continue; }
    for (const e of enemies) {
      if (e.dead) continue;
      if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) * (e.r + b.r)) {
        if (b.aoe) {
          burst(b.x, b.y, '#8dff6f', 16, 300, 0.45, 3);
          audio.explode(false);
          for (const e2 of enemies) if (!e2.dead && dist2(b.x, b.y, e2.x, e2.y) < b.aoe * b.aoe) damageEnemy(e2, b.dmg, b.x, b.y, 160);
          b.dead = true;
        } else {
          damageEnemy(e, b.dmg, b.x - b.vx * 0.01, b.y - b.vy * 0.01, 120);
          if (b.pierce > 0) b.pierce--; else b.dead = true;
        }
        break;
      }
    }
  }
  bullets = bullets.filter((b) => !b.dead);

  // Enemy bullets.
  for (const b of ebullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0) { b.dead = true; continue; }
    if (p.hurtCd <= 0 && dist2(b.x, b.y, p.x, p.y) < (p.r + b.r) * (p.r + b.r)) {
      b.dead = true;
      hurtPlayer(b.dmg);
      if (state !== 'playing') return;
    }
  }
  ebullets = ebullets.filter((b) => !b.dead);

  // Gems: drift, magnet, collect.
  const mag = magnetR();
  for (const g of gems) {
    const d = Math.hypot(p.x - g.x, p.y - g.y);
    if (d < mag) { const pull = 620 * (1 - d / (mag * 1.6)); g.vx += ((p.x - g.x) / (d || 1)) * pull * dt * 4; g.vy += ((p.y - g.y) / (d || 1)) * pull * dt * 4; }
    g.vx *= Math.pow(0.02, dt); g.vy *= Math.pow(0.02, dt);
    g.x += g.vx * dt; g.y += g.vy * dt;
    if (d < p.r + 12) { g.dead = true; gainXp(g.v); audio.pickup(); if (state !== 'playing') return; }
  }
  gems = gems.filter((g) => !g.dead);

  // Pickups.
  for (const pk of pickups) {
    if (dist2(pk.x, pk.y, p.x, p.y) < (p.r + pk.r + 6) * (p.r + pk.r + 6)) {
      pk.dead = true;
      if (pk.kind === 'core') { gainXp(25); floater(p.x, p.y - 26, '+25 LIGHT', '#ffc857', 17); audio.core(); }
      else { player.hp = Math.min(player.maxhp, player.hp + 22); floater(p.x, p.y - 26, '+22 HULL', '#8dff6f', 17); audio.core(); }
      if (state !== 'playing') return;
    }
  }
  pickups = pickups.filter((pk) => !pk.dead);

  // Particles, floaters, arcs.
  for (const pt of particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= Math.pow(0.05, dt); pt.vy *= Math.pow(0.05, dt); pt.life -= dt; }
  particles = particles.filter((pt) => pt.life > 0);
  for (const f of floaters) { f.y += f.vy * dt; f.life -= dt; }
  floaters = floaters.filter((f) => f.life > 0);
  for (const a of arcs) a.life -= dt;
  arcs = arcs.filter((a) => a.life > 0);

  // Camera + shake decay.
  cam.x = lerp(cam.x, clamp(p.x - W / 2, 0, WORLD.w - W), 1 - Math.pow(0.001, dt));
  cam.y = lerp(cam.y, clamp(p.y - H / 2, 0, WORLD.h - H), 1 - Math.pow(0.001, dt));
  shake = Math.max(0, shake - dt * 46);
}

function updateBoss(e, dt, angleToPlayer) {
  e.modeT -= dt;
  e.atkT -= dt;
  if (e.mode === 'chase') {
    e.vx = lerp(e.vx, Math.cos(angleToPlayer) * e.speed, 1 - Math.pow(0.01, dt));
    e.vy = lerp(e.vy, Math.sin(angleToPlayer) * e.speed, 1 - Math.pow(0.01, dt));
    if (e.atkT <= 0) {
      const atk = pick(['radial', 'summon', 'charge']);
      if (atk === 'radial') {
        e.mode = 'radial'; e.modeT = 0.9; e.atkT = rr(3.4, 4.6); e.rings = 3;
        audio.bossRoar();
      } else if (atk === 'summon') {
        e.mode = 'summon'; e.modeT = 0.6; e.atkT = rr(4, 5.4);
      } else {
        e.mode = 'telegraph'; e.modeT = 0.7; e.atkT = rr(3.6, 5);
        e.chargeA = angleToPlayer;
      }
    }
  } else if (e.mode === 'telegraph') {
    e.vx *= Math.pow(0.001, dt); e.vy *= Math.pow(0.001, dt);
    e.chargeA = angleToPlayer; // tracks until the dash fires
    if (e.modeT <= 0) {
      e.mode = 'charge'; e.modeT = 0.5;
      e.vx = Math.cos(e.chargeA) * 560; e.vy = Math.sin(e.chargeA) * 560;
      addShake(10);
      audio.explode(false);
    }
  } else if (e.mode === 'charge') {
    if (e.modeT <= 0) { e.mode = 'chase'; }
  } else if (e.mode === 'radial') {
    e.vx *= Math.pow(0.001, dt); e.vy *= Math.pow(0.001, dt);
    e.ringT = (e.ringT || 0) - dt;
    if (e.ringT <= 0 && e.rings > 0) {
      e.rings--; e.ringT = 0.3;
      const off = rr(0, TAU);
      for (let i = 0; i < 16; i++) {
        const a = off + (i / 16) * TAU;
        ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 215, vy: Math.sin(a) * 215, r: 6, dmg: 13, life: 3.4 });
      }
      audio.explode(false);
      addShake(6);
    }
    if (e.modeT <= 0) e.mode = 'chase';
  } else if (e.mode === 'summon') {
    if (e.modeT <= 0) {
      for (let i = 0; i < 5; i++) spawnEnemy(i % 2 ? 'skitter' : 'drifter', false, { x: e.x + rr(-90, 90), y: e.y + rr(-90, 90) });
      burst(e.x, e.y, '#ff5da2', 26, 300, 0.5, 3);
      e.mode = 'chase';
    }
  }
  // The Maw grows desperate below a third of its hull.
  e.speed = e.hp < e.maxhp / 3 ? 74 : 52;
}

// ---------------------------------------------------------------- rendering
// The starfield + nebulae are pre-rendered once to a world-sized offscreen
// canvas; each frame blits only the camera's slice of it.
const bg = document.createElement('canvas');
bg.width = WORLD.w; bg.height = WORLD.h;
{
  const b = bg.getContext('2d');
  const g = b.createLinearGradient(0, 0, WORLD.w, WORLD.h);
  g.addColorStop(0, '#070a1c'); g.addColorStop(0.5, '#05070f'); g.addColorStop(1, '#0a0618');
  b.fillStyle = g; b.fillRect(0, 0, WORLD.w, WORLD.h);
  const nebCols = ['rgba(64,40,160,0.20)', 'rgba(20,90,160,0.18)', 'rgba(160,40,110,0.13)', 'rgba(20,140,140,0.14)'];
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * WORLD.w, y = Math.random() * WORLD.h, r = 180 + Math.random() * 420;
    const rg = b.createRadialGradient(x, y, 0, x, y, r);
    const c = nebCols[i % nebCols.length];
    rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = rg; b.beginPath(); b.arc(x, y, r, 0, TAU); b.fill();
  }
  for (let i = 0; i < 1100; i++) {
    const x = Math.random() * WORLD.w, y = Math.random() * WORLD.h;
    b.globalAlpha = 0.25 + Math.random() * 0.75;
    b.fillStyle = Math.random() < 0.12 ? '#9fdcff' : '#ffffff';
    const s = Math.random() < 0.06 ? 2.4 : 1.3;
    b.fillRect(x, y, s, s);
  }
  b.globalAlpha = 1;
  b.strokeStyle = 'rgba(111,243,255,0.5)'; b.lineWidth = 4;
  b.strokeRect(4, 4, WORLD.w - 8, WORLD.h - 8);
  b.strokeStyle = 'rgba(111,243,255,0.13)'; b.lineWidth = 22;
  b.strokeRect(16, 16, WORLD.w - 32, WORLD.h - 32);
}
const vignette = document.createElement('canvas');
vignette.width = W; vignette.height = H;
{
  const v = vignette.getContext('2d');
  const rg = v.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.85);
  rg.addColorStop(0, 'rgba(2,3,10,0)'); rg.addColorStop(1, 'rgba(2,3,10,0.52)');
  v.fillStyle = rg; v.fillRect(0, 0, W, H);
}

function poly(points, close = true) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  const flash = e.flash > 0;
  const body = flash ? '#ffffff' : e.color;
  if (e.type === 'drifter') {
    ctx.rotate(e.wob * 0.7);
    ctx.fillStyle = body;
    const spikes = 7;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * TAU, rad = i % 2 ? e.r * 0.62 : e.r * 1.12;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = flash ? '#fff' : '#2a1052';
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.42, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff5da2';
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.18, 0, TAU); ctx.fill();
  } else if (e.type === 'skitter') {
    ctx.rotate(Math.atan2(e.vy, e.vx));
    ctx.fillStyle = body;
    poly([[-e.r, -e.r * 0.8], [e.r * 1.25, 0], [-e.r, e.r * 0.8], [-e.r * 0.4, 0]]);
    ctx.fill();
  } else if (e.type === 'spitter') {
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
    ctx.fillStyle = flash ? '#fff' : '#1d4d12';
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.58, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d6ff6f';
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.26 + Math.sin(e.wob * 3) * 1.5, 0, TAU); ctx.fill();
  } else if (e.type === 'bulwark') {
    ctx.rotate(e.wob * 0.25);
    ctx.fillStyle = body;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * e.r, Math.sin(a) * e.r); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = flash ? '#fff' : '#5e2410';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * e.r * 0.6, Math.sin(a) * e.r * 0.6); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd76f';
    ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, TAU); ctx.fill();
  } else if (e.type === 'maw') {
    // The Hollow Maw: a toothed ring around a lightless core.
    const pulse = 1 + Math.sin(e.wob * 2.4) * 0.05;
    ctx.scale(pulse, pulse);
    ctx.fillStyle = flash ? '#fff' : '#3d0a26';
    ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
    ctx.fillStyle = body;
    const teeth = 14;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * TAU + e.wob * 0.35;
      ctx.save();
      ctx.rotate(a);
      poly([[e.r * 0.55, -7], [e.r * 1.04, 0], [e.r * 0.55, 7]]);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#05010a';
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.55, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff2e7e';
    ctx.beginPath(); ctx.arc(-e.r * 0.24, -e.r * 0.2, 5, 0, TAU); ctx.arc(e.r * 0.24, -e.r * 0.2, 5, 0, TAU); ctx.fill();
    if (e.mode === 'telegraph') {
      ctx.strokeStyle = 'rgba(255,46,126,0.55)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(e.chargeA) * 340, Math.sin(e.chargeA) * 340); ctx.stroke();
    }
  }
  ctx.restore();
  if (e.elite) {
    ctx.strokeStyle = 'rgba(255,200,87,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6 + Math.sin(e.wob * 4) * 2, 0, TAU); ctx.stroke();
    if (e.type !== 'maw') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(e.x - 22, e.y - e.r - 16, 44, 5);
      ctx.fillStyle = '#ffc857'; ctx.fillRect(e.x - 22, e.y - e.r - 16, 44 * clamp(e.hp / e.maxhp, 0, 1), 5);
    }
  }
}

function drawPlayer() {
  const p = player;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  // Engine flame.
  const fl = 12 + Math.sin(elapsed * 31) * 4 + Math.hypot(p.vx, p.vy) * 0.03;
  ctx.fillStyle = 'rgba(55,224,255,0.85)';
  poly([[-13, -5], [-13 - fl, 0], [-13, 5]]);
  ctx.fill();
  // Hull: a sleek dart.
  ctx.fillStyle = p.hurtCd > 0.25 ? '#ffb3c0' : '#eaf7ff';
  poly([[19, 0], [-9, -11], [-14, -5], [-11, 0], [-14, 5], [-9, 11]]);
  ctx.fill();
  ctx.fillStyle = '#2b6bff';
  poly([[12, 0], [-6, -6], [-8, 0], [-6, 6]]);
  ctx.fill();
  ctx.fillStyle = '#6ff3ff';
  ctx.beginPath(); ctx.arc(3, 0, 3.2, 0, TAU); ctx.fill();
  ctx.restore();
  if (p.hurtCd > 0) {
    ctx.strokeStyle = `rgba(111,243,255,${0.35 * (p.hurtCd / 0.45)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 9, 0, TAU); ctx.stroke();
  }
  // Orbit blades.
  if (p.weapons.orbit && p._orbitBlades) {
    for (let i = 0; i < p._orbitBlades; i++) {
      const a = elapsed * 3.4 + (i / p._orbitBlades) * TAU;
      const bx = p.x + Math.cos(a) * p._orbitR, by = p.y + Math.sin(a) * p._orbitR;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = '#c9f7ff';
      poly([[0, -11], [4.5, 4], [0, 9], [-4.5, 4]]);
      ctx.fill();
      ctx.restore();
    }
  }
}

function render() {
  const sx = shake ? (Math.random() * 2 - 1) * shake : 0;
  const sy = shake ? (Math.random() * 2 - 1) * shake : 0;
  const cx = clamp(cam.x + sx, -24, WORLD.w - W + 24), cy = clamp(cam.y + sy, -24, WORLD.h - H + 24);
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bg, cx, cy, W, H, 0, 0, W, H);
  ctx.save();
  ctx.translate(-cx, -cy);

  // Gems (harvested light).
  for (const g of gems) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = g.v >= 5 ? '#ffffff' : '#37e0ff';
    const s = g.r;
    ctx.fillRect(-s / 1.6, -s / 1.6, s * 1.25, s * 1.25);
    ctx.restore();
  }
  // Pickups: star-cores and hearts.
  for (const pk of pickups) {
    ctx.save();
    ctx.translate(pk.x, pk.y + Math.sin(elapsed * 4 + pk.x) * 2.5);
    if (pk.kind === 'core') {
      ctx.fillStyle = '#ffc857';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU - Math.PI / 2, rad = i % 2 ? 5 : 11;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = '#8dff6f';
      ctx.fillRect(-3, -10, 6, 20); ctx.fillRect(-10, -3, 20, 6);
      ctx.strokeStyle = 'rgba(141,255,111,0.6)';
      ctx.beginPath(); ctx.arc(0, 0, 14 + Math.sin(elapsed * 5) * 2, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
  // Enemy bullets.
  ctx.fillStyle = '#ff5da2';
  for (const b of ebullets) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); }
  // Enemies, then the player, then friendly fire with additive glow.
  for (const e of enemies) drawEnemy(e);
  if (state !== 'over') drawPlayer();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of bullets) {
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(b.x - b.vx * 0.02, b.y - b.vy * 0.02, b.r * 1.9, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Chain lightning: jagged polylines.
  ctx.strokeStyle = 'rgba(160,240,255,0.9)';
  ctx.lineWidth = 2;
  for (const a of arcs) {
    ctx.globalAlpha = clamp(a.life / 0.14, 0, 1);
    ctx.beginPath();
    ctx.moveTo(a.x1, a.y1);
    const segs = 5;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      ctx.lineTo(lerp(a.x1, a.x2, t) + (Math.random() - 0.5) * 22, lerp(a.y1, a.y2, t) + (Math.random() - 0.5) * 22);
    }
    ctx.lineTo(a.x2, a.y2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const pt of particles) {
    ctx.globalAlpha = clamp(pt.life / pt.maxlife, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // Damage numbers.
  ctx.textAlign = 'center';
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life / 0.8, 0, 1);
    ctx.font = `700 ${f.size}px "Segoe UI", sans-serif`;
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.drawImage(vignette, 0, 0);
  drawMinimap();
}

function drawMinimap() {
  const mw = 156, mh = 120, x0 = 14, y0 = H - mh - 14;
  const kx = mw / WORLD.w, ky = mh / WORLD.h;
  ctx.fillStyle = 'rgba(6,10,24,0.72)';
  ctx.fillRect(x0, y0, mw, mh);
  ctx.strokeStyle = 'rgba(111,243,255,0.35)';
  ctx.strokeRect(x0, y0, mw, mh);
  for (const e of enemies) {
    ctx.fillStyle = e.type === 'maw' ? '#ff2e7e' : e.elite ? '#ffc857' : 'rgba(255,93,122,0.8)';
    const s = e.type === 'maw' ? 5 : 2.4;
    ctx.fillRect(x0 + e.x * kx - s / 2, y0 + e.y * ky - s / 2, s, s);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0 + player.x * kx - 2.5, y0 + player.y * ky - 2.5, 5, 5);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.strokeRect(x0 + cam.x * kx, y0 + cam.y * ky, W * kx, H * ky);
}

// ---------------------------------------------------------------- loop
function updateFx(dt) {
  for (const pt of particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= Math.pow(0.05, dt); pt.vy *= Math.pow(0.05, dt); pt.life -= dt; }
  particles = particles.filter((pt) => pt.life > 0);
  for (const f of floaters) { f.y += f.vy * dt; f.life -= dt; }
  floaters = floaters.filter((f) => f.life > 0);
  shake = Math.max(0, shake - dt * 46);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'playing') {
    if (hitstop > 0) hitstop -= dt;
    else update(dt);
    syncHud();
  } else if (state === 'over' || state === 'victory') {
    updateFx(dt);
  }
  render();
}

// ---------------------------------------------------------------- boot
best = loadBest();
if (best) $('bestLine').textContent = `BEST — SCORE ${best.score.toLocaleString('en-US')} · WAVE ${best.wave} · ${best.kills} KILLS`;
reset();
requestAnimationFrame(frame);

// Handle for automated play-testing (and curious players in the console).
window.VOIDHARVEST = {
  get state() { return state; },
  get player() { return player; },
  get enemies() { return enemies; },
  get boss() { return boss; },
  get score() { return score; },
  start: startRun,
  debug: {
    grantXp: (n) => gainXp(n),
    hurt: (n) => hurtPlayer(n),
    jumpToWave: (w) => { elapsed = (w - 1) * WAVE_TIME + 0.05; },
    spawnBoss: () => { if (!bossSpawned) spawnBoss(); },
    killBoss: () => { if (boss) damageEnemy(boss, 1e12, player.x, player.y, 0); },
    setHp: (n) => { player.hp = n; },
    give: (kind, id) => {
      if (kind === 'weapon') player.weapons[id] = Math.min(5, (player.weapons[id] || 0) + 1);
      else player.passives[id] = Math.min(5, (player.passives[id] || 0) + 1);
      syncLoadout();
    },
  },
};
