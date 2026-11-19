'use strict';
// ===================== «Урод» — 2D-игра на canvas =====================

// ---------- CONFIG: все «магические числа» здесь ----------
const CONFIG = {
  VMAX: 50 / 3.6,          // жёсткий лимит скорости, м/с (= 50 км/ч)
  UPM: 26,                 // игровых единиц в метре
  ACCEL: 5, BRAKE: 12, DRAG: 1.2,
  BASE_CAP: 9, CAP_GROWTH: 0.05, CAP_BASE_MAX: 13,   // потолок скорости растёт со временем
  GRAVITY: 1400, JUMP_V: 560, AIR_MIN_SPEED: 8.5,    // минимум скорости в прыжке = гарантия перелёта «Жигулей»
  WHEELIE_ACCEL: 120, WHEELIE_RATE: 60, WHEELIE_RETURN: 90, WHEELIE_LIMIT: 80,
  WHEELIE_SPEED_BONUS: 1.5, WHEELIE_POINTS: 5,       // очков за метр в вили
  CAR_W: 104, CAR_H: 46, CAR_GAP: [20, 34],          // зазор между машинами, м
  BOTTLE_SCORE: 10,
  CRASH_WHEELIE: 2, CRASH_CAR: 1, SLOWMO: 0.3,       // длительность роликов (с) и замедление
  STEP: 1 / 120, VIEW_W: 500, CAM_OFFSET: 130,
  CAR_COLORS: ['#d94b3d', '#e8c547', '#3d8fd9', '#f2f2f2', '#4aa36b', '#8e5bd1'],
  SKINS: [
    { id: 'classic', name: 'Классика', price: 0,   shirt: '#e63946', helmet: '#f5f5f5', pack: '#2a6fdb', bike: '#ff8c1a', accent: '#333',    deco: 'none' },
    { id: 'neon',    name: 'Неон',     price: 20,  shirt: '#00e5ff', helmet: '#ff2bd6', pack: '#b6ff00', bike: '#15151f', accent: '#00e5ff', deco: 'neon' },
    { id: 'camo',    name: 'Камуфляж', price: 40,  shirt: '#55672d', helmet: '#3a4a20', pack: '#7a8a45', bike: '#66793a', accent: '#2f3b1b', deco: 'camo' },
    { id: 'fire',    name: 'Огонь',    price: 60,  shirt: '#ff6a00', helmet: '#222',    pack: '#ffb300', bike: '#c1121f', accent: '#ffd23f', deco: 'flame' },
    { id: 'space',   name: 'Космос',   price: 100, shirt: '#6a4ad8', helmet: '#e0e7ff', pack: '#22d3ee', bike: '#231f5c', accent: '#a78bfa', deco: 'space' }
  ]
};
const C = CONFIG;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const hs = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ===================== save =====================
const Save = {
  key: 'urod-save',
  data: { best: 0, bottles: 0, owned: ['classic'], skin: 'classic', mute: false },
  load() { try { Object.assign(this.data, JSON.parse(localStorage.getItem(this.key))); } catch (e) { /* нет доступа */ } },
  write() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { /* игнор */ } }
};
const getSkin = () => C.SKINS.find(s => s.id === Save.data.skin) || C.SKINS[0];

// ===================== audio (Web Audio, без файлов) =====================
const Sound = {
  ctx: null, eng: null, engGain: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.eng = this.ctx.createOscillator(); this.engGain = this.ctx.createGain();
      this.eng.type = 'sawtooth'; this.engGain.gain.value = 0;
      this.eng.connect(this.engGain); this.engGain.connect(this.ctx.destination); this.eng.start();
    } catch (e) { this.ctx = null; }
  },
  tone(f, d, type = 'square', vol = 0.07, f2 = null) {
    if (!this.ctx || Save.data.mute) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + d);
  },
  beep() { this.tone(880, 0.08); setTimeout(() => this.tone(1320, 0.1), 70); },
  thud() { this.tone(140, 0.35, 'sawtooth', 0.2, 30); },
  engine(v, on) {
    if (!this.ctx) return;
    this.engGain.gain.value = (on && !Save.data.mute) ? 0.025 : 0;
    this.eng.frequency.value = 55 + v * 9;
  }
};

// ===================== input =====================
const Input = { gas: false, brake: false, wheelie: false, jump: false };
function bindButton(id, down, up) {
  const el = $(id);
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {}
    Sound.init(); down(); el.classList.add('on');
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev =>
    el.addEventListener(ev, () => { if (up) up(); el.classList.remove('on'); }));
}
bindButton('bGas', () => Input.gas = true, () => Input.gas = false);
bindButton('bBrake', () => Input.brake = true, () => Input.brake = false);
bindButton('bWheelie', () => Input.wheelie = true, () => Input.wheelie = false);
bindButton('bJump', () => Input.jump = true);
const KEYMAP = { ArrowRight: 'gas', ArrowLeft: 'brake', ArrowUp: 'wheelie', KeyW: 'wheelie' };
window.addEventListener('keydown', e => {
  Sound.init();
  if (e.code === 'Space') { Input.jump = true; e.preventDefault(); }
  else if (KEYMAP[e.code]) { Input[KEYMAP[e.code]] = true; e.preventDefault(); }
});
window.addEventListener('keyup', e => { if (KEYMAP[e.code]) Input[KEYMAP[e.code]] = false; });

// ===================== состояние =====================
const canvas = $('game'), ctx = canvas.getContext('2d');
let G = {}, cw = 0, ch = 0, S = 1, groundY = 0, speedoSafe = 12;

function reset(keepCam) {
  const cam = keepCam ? G.camX : -C.CAM_OFFSET;
  G = { state: 'menu', paused: false, x: cam + C.CAM_OFFSET, camX: cam, v: 0, h: 0, vh: 0, a: 0, av: 0, wr: 0, lean: 0,
    time: 0, dist: 0, wheelieScore: 0, runBottles: 0, score: 0, cars: [], bottles: [], parts: [],
    nextX: 700, flash: 0, dustT: 0, crash: null, rider: null, bikeP: null };
}

// ===================== entities / spawn =====================
function spawn() {
  while (G.nextX < G.camX + 1400) {
    const x = G.nextX;
    G.cars.push({ x, col: C.CAR_COLORS[Math.floor(Math.random() * C.CAR_COLORS.length)], hit: 0 });
    for (let i = 0; i < 3; i++) G.bottles.push({ x: x + 16 + i * 36, y: 92 + (i === 1 ? 14 : 0), got: false }); // над машиной
    const gap = rand(C.CAR_GAP[0], C.CAR_GAP[1]) * C.UPM, n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) G.bottles.push({ x: x + C.CAR_W + gap * 0.4 + i * 40, y: 10, got: false }); // на дороге
    G.nextX = x + C.CAR_W + gap;
  }
  G.cars = G.cars.filter(c => c.x > G.camX - 300);
  G.bottles = G.bottles.filter(b => !b.got && b.x > G.camX - 300);
}
function burst(x, h, col, n, sp) {
  for (let i = 0; i < n && G.parts.length < 220; i++)
    G.parts.push({ x, h, vx: rand(-sp, sp), vh: rand(0, sp), life: 0.5, max: 0.5, col, size: rand(2, 4) });
}

// ===================== physics =====================
function updatePlay(dt) {
  G.time += dt;
  const cap = Math.min(C.VMAX, C.BASE_CAP + Math.min(G.time * C.CAP_GROWTH, C.CAP_BASE_MAX - C.BASE_CAP) + (G.a > 8 ? C.WHEELIE_SPEED_BONUS : 0));
  if (Input.gas) { if (G.v < cap) G.v = Math.min(cap, G.v + C.ACCEL * (1.2 - G.v / C.VMAX) * dt); }
  else if (!Input.brake) G.v -= C.DRAG * dt;
  if (Input.brake) G.v -= C.BRAKE * dt;
  if (G.v > cap) G.v -= 2 * dt;
  if (G.h > 0) G.v = Math.max(G.v, C.AIR_MIN_SPEED);
  G.v = clamp(G.v, 0, C.VMAX);

  // прыжок
  if (Input.jump && G.h <= 0) { G.vh = C.JUMP_V; Sound.tone(300, 0.15, 'triangle', 0.08, 600); }
  Input.jump = false;
  if (G.h > 0 || G.vh > 0) {
    G.vh -= C.GRAVITY * dt; G.h += G.vh * dt;
    if (G.h <= 0) { G.h = 0; G.vh = 0; burst(G.x, 0, '#b9a88a', 6, 60); }
  }

  // вили
  const wantW = Input.wheelie && G.h <= 0 && G.v > 1.5;
  if (wantW) {
    G.av = Math.min(C.WHEELIE_RATE, G.av + C.WHEELIE_ACCEL * dt); G.a += G.av * dt;
    if (G.v < cap) G.v = Math.min(cap, G.v + 0.8 * dt);
    if (G.a > 10) G.wheelieScore += G.v * dt * C.WHEELIE_POINTS;
  } else { G.av = 0; G.a = Math.max(0, G.a - C.WHEELIE_RETURN * dt * (G.h > 0 ? 2 : 1)); }
  if (G.a > C.WHEELIE_LIMIT) return startCrash('wheelie');

  // движение
  G.x += G.v * C.UPM * dt; G.dist += G.v * dt; G.wr += G.v * C.UPM * dt / 13;
  G.camX = G.x - C.CAM_OFFSET;
  G.lean += ((Input.gas ? 3 : Input.brake ? -4 : 0) - G.lean) * Math.min(1, 8 * dt);
  G.score = Math.floor(G.dist) + G.runBottles * C.BOTTLE_SCORE + Math.floor(G.wheelieScore);
  spawn();

  // пыль из-под колёс
  G.dustT -= dt;
  if (G.h <= 0 && G.v > 2 && G.dustT <= 0) { G.dustT = 0.05; G.parts.push({ x: G.x - 8, h: 4, vx: -rand(40, 80), vh: rand(20, 50), life: 0.5, max: 0.5, col: '#a89878', size: rand(2, 4) }); }

  // столкновение с машиной (по вертикали — если выше крыши, проезд свободен)
  for (const c of G.cars)
    if (G.x + 60 > c.x + 6 && G.x - 5 < c.x + C.CAR_W - 6 && G.h < C.CAR_H - 4) return startCrash('car', c);

  // бутылки
  for (const b of G.bottles) {
    if (!b.got && Math.abs(G.x + 28 - b.x) < 30 && Math.abs(G.h + 22 - b.y) < 36) {
      b.got = true; G.runBottles++; Save.data.bottles++; Save.write();
      burst(b.x, b.y, '#ffe066', 10, 140); Sound.beep(); refreshHud();
    }
  }
}

// ===================== ролики падения =====================
function startCrash(type, car) {
  const fwd = type === 'car';
  G.state = 'crash';
  G.crash = { type, t: 0, dur: fwd ? C.CRASH_CAR : C.CRASH_WHEELIE };
  G.rider = { x: G.x + 24, h: G.h + 41, vx: fwd ? G.v * C.UPM * 0.5 + 100 : -80, vh: fwd ? 260 : 340, rot: fwd ? 0 : G.a, vr: fwd ? -380 : 420 };
  G.bikeP = { x: G.x, h: G.h, rot: G.a, vx: fwd ? -40 : -70, vh: fwd ? 0 : 120, vr: fwd ? -70 : 150 };
  G.v = 0; Sound.thud(); Sound.engine(0, false);
  if (car) { car.hit = 0.6; G.flash = 0.35; burst(G.x + 60, 30, '#fff3b0', 18, 220); }
  Save.write();
}
function stepPiece(p, d, isRider, type) {
  p.vh -= C.GRAVITY * d; p.h += p.vh * d; p.x += p.vx * d; p.rot += p.vr * d;
  const min = isRider ? 7 : 0;
  if (p.h < min) {
    p.h = min; p.vh = Math.abs(p.vh) > 40 ? -p.vh * 0.4 : 0; p.vx *= 0.75; p.vr *= 0.7;
    if (isRider) { const base = type === 'wheelie' ? 90 : -90, target = base + 360 * Math.round((p.rot - base) / 360); p.rot += (target - p.rot) * Math.min(1, 6 * d); }
  }
  if (!isRider) p.rot = type === 'wheelie' ? Math.min(p.rot, 160) : Math.max(p.rot, -20);
}
function updateCrash(dt) {
  const k = G.crash; k.t += dt;
  let ts = clamp(1 - (k.t / (k.dur * 0.3)) * (1 - C.SLOWMO), C.SLOWMO, 1);   // замедление времени
  const tail = k.dur - k.t; if (tail < 0.3) ts *= Math.max(0, tail / 0.3);    // и остановка мира
  const d = dt * ts;
  stepPiece(G.rider, d, true, k.type); stepPiece(G.bikeP, d, false, k.type);
  G.cars.forEach(c => { if (c.hit > 0) c.hit -= dt; });
  G.flash = Math.max(0, G.flash - dt);
  if (k.t >= k.dur) endGame();
}
function endGame() {
  G.state = 'over';
  const rec = G.score > Save.data.best;
  if (rec) Save.data.best = G.score;
  Save.write(); refreshHud();
  $('fScore').textContent = G.score; $('fBest').textContent = Save.data.best;
  $('newRec').classList.toggle('hidden', !rec || G.score === 0);
  refreshWallet(); $('overOv').classList.remove('hidden');
}
canvas.addEventListener('pointerdown', () => { if (G.state === 'crash') endGame(); });   // пропуск ролика тапом

function updateParticles(dt) {
  for (const p of G.parts) { p.vh -= 600 * dt; p.x += p.vx * dt; p.h += p.vh * dt; p.life -= dt; }
  G.parts = G.parts.filter(p => p.life > 0 && p.h > -5);
}

// ===================== render: рисуем всё кодом =====================
function drawWheel(c, x, wr) {
  c.fillStyle = '#111'; c.beginPath(); c.arc(x, 0, 13, 0, 7); c.fill();
  c.fillStyle = '#bbb'; c.beginPath(); c.arc(x, 0, 7, 0, 7); c.fill();
  c.strokeStyle = '#555'; c.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) { const a = wr + k * 2.094; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + Math.cos(a) * 7, Math.sin(a) * 7); c.stroke(); }
}
// Байкер: начало координат — бедро, ось Y вниз
function drawRider(c, sk, fl) {
  c.lineCap = 'round';
  c.strokeStyle = '#243b6b'; c.lineWidth = 5; c.beginPath(); c.moveTo(0, 0); c.lineTo(10 + fl * 7, 12 - fl * 4); c.stroke();   // нога
  c.fillStyle = sk.pack; c.fillRect(-9, -22, 9, 15);                                                                         // рюкзак
  c.strokeStyle = sk.shirt; c.lineWidth = 10; c.beginPath(); c.moveTo(0, 0); c.lineTo(9, -20); c.stroke();                  // майка
  c.strokeStyle = '#f2b88c'; c.lineWidth = 3.5; c.beginPath(); c.moveTo(9, -17); c.lineTo(20 + fl * 6, -8 - fl * 8); c.stroke(); // рука
  c.fillStyle = sk.helmet; c.beginPath(); c.arc(12, -28, 7, 0, 7); c.fill();                                                 // шлем
  c.fillStyle = '#1d2a44'; c.fillRect(13, -31, 7, 4);
}
// Питбайк: начало координат — центр заднего колеса (колёсная база 56)
function drawBike(c, sk, wr, bob, withRider, fl) {
  drawWheel(c, 0, wr); drawWheel(c, 56, wr);
  c.save(); c.translate(0, bob); c.lineCap = 'round';
  c.strokeStyle = '#333'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 0); c.lineTo(24, -8); c.stroke();           // маятник
  c.strokeStyle = sk.accent === '#333' ? '#888' : sk.accent; c.lineWidth = 4; c.beginPath(); c.moveTo(56, 0); c.lineTo(47, -26); c.stroke(); // вилка
  c.fillStyle = sk.bike; c.fillRect(44, -19, 16, 3);                                                                // крыло
  c.strokeStyle = '#999'; c.lineWidth = 3; c.beginPath(); c.moveTo(24, -8); c.lineTo(6, -12); c.stroke();           // выхлоп
  const frame = new Path2D(); frame.moveTo(14, -8); frame.lineTo(18, -24); frame.lineTo(36, -27); frame.lineTo(48, -25); frame.lineTo(50, -19); frame.lineTo(30, -9); frame.closePath();
  c.fillStyle = sk.bike; c.fill(frame);
  if (sk.deco === 'neon') { c.save(); c.shadowColor = sk.accent; c.shadowBlur = 12; c.strokeStyle = sk.accent; c.lineWidth = 1.6; c.stroke(frame); c.restore(); }
  if (sk.deco === 'camo') { c.fillStyle = sk.accent; [[24, -18, 3], [34, -22, 3.2], [41, -17, 2.5]].forEach(a => { c.beginPath(); c.arc(a[0], a[1], a[2], 0, 7); c.fill(); }); }
  if (sk.deco === 'flame') { c.fillStyle = sk.accent; c.beginPath(); c.moveTo(18, -12); c.lineTo(26, -22); c.lineTo(30, -13); c.lineTo(36, -24); c.lineTo(42, -14); c.lineTo(46, -20); c.lineTo(46, -12); c.fill(); }
  if (sk.deco === 'space') { c.fillStyle = '#fff'; [[22, -16], [32, -21], [40, -15], [28, -12]].forEach(a => c.fillRect(a[0], a[1], 1.6, 1.6)); c.fillStyle = sk.accent; c.beginPath(); c.arc(38, -20, 2.5, 0, 7); c.fill(); }
  c.fillStyle = '#222'; c.fillRect(12, -28, 24, 4);                                                                  // сиденье
  c.strokeStyle = '#222'; c.lineWidth = 3; c.beginPath(); c.moveTo(47, -26); c.lineTo(43, -36); c.lineTo(50, -37); c.stroke(); // руль
  if (withRider) { c.save(); c.translate(24, -30); drawRider(c, sk, fl); c.restore(); }
  c.restore();
}
function drawCar(c, car) {   // ВАЗ-2106: прямые линии, круглые фары, решётка; смотрит влево
  c.save();
  if (car.hit > 0) { c.translate(52, 0); c.rotate(Math.sin(car.hit * 40) * 0.05 * car.hit); c.translate(-52, 0); }
  c.fillStyle = car.col; c.fillRect(0, -30, 104, 20);
  c.beginPath(); c.moveTo(24, -30); c.lineTo(34, -46); c.lineTo(80, -46); c.lineTo(92, -30); c.fill();
  c.fillStyle = '#bfe3f5';
  c.beginPath(); c.moveTo(30, -31); c.lineTo(37, -43); c.lineTo(55, -43); c.lineTo(55, -31); c.fill();
  c.beginPath(); c.moveTo(59, -31); c.lineTo(59, -43); c.lineTo(78, -43); c.lineTo(86, -31); c.fill();
  c.fillStyle = '#0003'; c.fillRect(0, -19, 104, 3);
  c.fillStyle = '#ccc'; c.fillRect(-2, -14, 108, 4);
  c.fillStyle = '#999'; c.fillRect(0, -26, 5, 9);                                    // решётка
  c.strokeStyle = '#555'; c.lineWidth = 0.8; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(0, -25 + i * 3); c.lineTo(5, -25 + i * 3); c.stroke(); }
  c.fillStyle = '#fff6b8'; c.beginPath(); c.arc(11, -23, 4, 0, 7); c.fill(); c.strokeStyle = '#777'; c.stroke();   // круглая фара
  c.fillStyle = '#c1121f'; c.fillRect(100, -26, 4, 6);
  for (const wx of [22, 82]) { c.fillStyle = '#111'; c.beginPath(); c.arc(wx, -9, 9, 0, 7); c.fill(); c.fillStyle = '#aaa'; c.beginPath(); c.arc(wx, -9, 4, 0, 7); c.fill(); }
  c.restore();
}
function drawBottle(c, rot) {
  c.save(); c.rotate(rot);
  c.fillStyle = '#2b1b14'; c.fillRect(-7, -14, 14, 28); c.fillRect(-3, -21, 6, 8);
  c.fillStyle = '#d11'; c.fillRect(-3.5, -24, 7, 3);
  c.fillStyle = '#e0202a'; c.fillRect(-7, -11, 14, 22);
  c.fillStyle = '#fff'; c.font = 'italic bold 7px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.save(); c.rotate(-Math.PI / 2); c.fillText('ГАЗЯВА', 0, 0); c.restore();
  c.restore();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, groundY); g.addColorStop(0, '#4aa3ff'); g.addColorStop(1, '#cfeeff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, groundY);
  ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(cw * 0.78, groundY * 0.28, 34 * S, 0, 7); ctx.fill();
  const base = groundY - 34 * S;
  // дальний слой: дома (параллакс 0.15)
  const f = G.camX * 0.15, W1 = 70;
  for (let i = Math.floor(f / W1) - 1; i < (f + C.VIEW_W * 1.5) / W1 + 1; i++) {
    const h = 60 + hs(i) * 110; ctx.fillStyle = hs(i + 9) > 0.5 ? '#8aa0c6' : '#9db0d0';
    ctx.fillRect((i * W1 - f) * S, base - h * S, (W1 - 4) * S, h * S);
    ctx.fillStyle = '#ffffff55';
    for (let y = 12; y < h - 10; y += 22) ctx.fillRect((i * W1 - f + 12) * S, base - (h - y) * S, 10 * S, 10 * S);
  }
  // средний слой: деревья (параллакс 0.45)
  const m = G.camX * 0.45, W2 = 95;
  for (let i = Math.floor(m / W2) - 1; i < (m + C.VIEW_W * 1.5) / W2 + 1; i++) {
    const x = (i * W2 + hs(i + 3) * 40 - m) * S, r = (22 + hs(i + 5) * 14) * S;
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - 3 * S, base - 36 * S, 6 * S, 36 * S);
    ctx.fillStyle = hs(i) > 0.5 ? '#3f9a5e' : '#2f8450'; ctx.beginPath(); ctx.arc(x, base - 44 * S, r, 0, 7); ctx.fill();
  }
  // обочина и дорога
  ctx.fillStyle = '#9aa7b2'; ctx.fillRect(0, groundY - 36 * S, cw, 14 * S);
  ctx.fillStyle = '#3a3f47'; ctx.fillRect(0, groundY - 22 * S, cw, ch - groundY + 22 * S);
  ctx.fillStyle = '#f4f1e0';
  const off = G.camX % 80;
  for (let u = -80; u < C.VIEW_W * 2.5; u += 80) ctx.fillRect((u - off) * S, groundY + 40 * S, 36 * S, 4 * S);
}

function drawSpeedo() {
  const r = Math.min(cw * 0.17, 80), cx = cw / 2, cy = ch - r * 0.6 - speedoSafe, kmh = G.v * 3.6;
  ctx.save();
  ctx.fillStyle = '#0b1220e6'; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#fff5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.font = `${r * 0.16}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let v = 0; v <= 50; v += 10) {
    const a = Math.PI + (v / 50) * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82); ctx.lineTo(cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94); ctx.stroke();
    ctx.fillText(v, cx + Math.cos(a) * r * 0.68, cy + Math.sin(a) * r * 0.68);
  }
  const na = Math.PI + clamp(kmh / 50, 0, 1) * Math.PI;
  ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(na) * r * 0.8, cy + Math.sin(na) * r * 0.8); ctx.stroke();
  ctx.fillStyle = '#ffcc29'; ctx.font = `bold ${r * 0.3}px sans-serif`; ctx.fillText(Math.round(kmh) + ' км/ч', cx, cy + r * 0.28);
  ctx.restore();
}

function render() {
  const X = wx => (wx - G.camX) * S, Y = h => groundY - h * S;
  drawBackground();

  for (const car of G.cars) { ctx.save(); ctx.translate(X(car.x), groundY); ctx.scale(S, S); drawCar(ctx, car); ctx.restore(); }
  const tt = performance.now() / 1000;
  for (const b of G.bottles) {
    if (b.got) continue;
    ctx.save(); ctx.translate(X(b.x), Y(b.y + (b.y > 20 ? Math.sin(tt * 3 + b.x) * 4 : 0))); ctx.scale(S, S);
    drawBottle(ctx, 1.35 + Math.sin(tt * 2 + b.x) * 0.12); ctx.restore();
  }
  for (const p of G.parts) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.col; ctx.fillRect(X(p.x), Y(p.h), p.size * S, p.size * S); }
  ctx.globalAlpha = 1;

  const sk = getSkin();
  if (G.state === 'crash' || G.state === 'over') {
    const b = G.bikeP, r = G.rider;
    if (b && r) {
      ctx.save(); ctx.translate(X(b.x), Y(b.h + 13)); ctx.scale(S, S); ctx.rotate(-b.rot * Math.PI / 180); drawBike(ctx, sk, G.wr, 0, false, 0); ctx.restore();
      ctx.save(); ctx.translate(X(r.x), Y(r.h)); ctx.scale(S, S); ctx.rotate(-r.rot * Math.PI / 180); drawRider(ctx, sk, Math.sin(performance.now() / 70)); ctx.restore();
    }
  } else {
    const bob = G.h <= 0 && G.v > 0.5 ? Math.sin(G.dist * 3) * 0.8 : 0, tilt = G.vh * 0.015;
    ctx.save(); ctx.translate(X(G.x), Y(G.h + 13)); ctx.scale(S, S);
    ctx.rotate(-(G.a + G.lean + tilt) * Math.PI / 180); drawBike(ctx, sk, G.wr, bob, true, 0); ctx.restore();
    if (G.state === 'play' && G.a > 2) {      // индикатор угла вили: краснеет к 80°
      const f = clamp(G.a / C.WHEELIE_LIMIT, 0, 1), bx = X(G.x) - 10 * S, by = Y(G.h + 105);
      ctx.fillStyle = '#0008'; ctx.fillRect(bx, by, 60 * S, 7 * S);
      ctx.fillStyle = `hsl(${120 * (1 - f)},90%,50%)`; ctx.fillRect(bx, by, 60 * S * f, 7 * S);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${12 * S}px sans-serif`; ctx.textAlign = 'left'; ctx.fillText(Math.round(G.a) + '°', bx, by - 4 * S);
    }
  }
  if (G.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${G.flash * 2})`; ctx.fillRect(0, 0, cw, ch); }
  drawSpeedo();
}

// ===================== ui / shop =====================
function refreshHud() {
  $('hScore').textContent = G.score || 0; $('hBest').textContent = Save.data.best; $('hBottles').textContent = Save.data.bottles;
  refreshWallet();
}
function refreshWallet() { document.querySelectorAll('.wallet').forEach(e => e.textContent = Save.data.bottles); }
function drawPreview(cv, sk) {
  const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#3a3f47'; c.fillRect(0, 78, cv.width, 22);
  c.save(); c.translate(36, 64); c.scale(1.35, 1.35); drawBike(c, sk, 0.5, 0, true, 0); c.restore();
}
function renderShop() {
  const list = $('skinList'); list.innerHTML = ''; refreshWallet();
  C.SKINS.forEach(sk => {
    const card = document.createElement('div'); card.className = 'card';
    const cv = document.createElement('canvas'); cv.width = 150; cv.height = 100; drawPreview(cv, sk);
    const info = document.createElement('div'); info.className = 'info';
    const owned = Save.data.owned.includes(sk.id), selected = Save.data.skin === sk.id, lack = sk.price - Save.data.bottles;
    info.innerHTML = `<b>${sk.name}</b><span>${owned ? 'Куплено' : sk.price + ' бутылок'}</span>`;
    const btn = document.createElement('button');
    if (selected) { btn.textContent = 'Выбрано'; btn.className = 'sel'; btn.disabled = true; }
    else if (owned) { btn.textContent = 'Выбрать'; btn.onclick = () => { Save.data.skin = sk.id; Save.write(); renderShop(); }; }
    else if (lack > 0) { btn.textContent = `Не хватает ${lack}`; btn.disabled = true; }
    else { btn.textContent = 'Купить'; btn.onclick = () => { Save.data.bottles -= sk.price; Save.data.owned.push(sk.id); Save.data.skin = sk.id; Save.write(); refreshHud(); renderShop(); }; }
    card.append(cv, info, btn); list.appendChild(card);
  });
}
function openShop() { renderShop(); $('shopOv').classList.remove('hidden'); }
function closeShop() { $('shopOv').classList.add('hidden'); }

function startGame() {
  Sound.init(); reset(true); G.state = 'play'; G.x = G.camX + C.CAM_OFFSET;
  ['startOv', 'overOv', 'shopOv'].forEach(id => $(id).classList.add('hidden'));
  refreshHud();
}
$('playBtn').onclick = startGame; $('retryBtn').onclick = startGame;
$('shopBtn1').onclick = openShop; $('shopBtn2').onclick = openShop;
$('closeShop').onclick = closeShop;
function setSoundIcon() { $('soundBtn').textContent = Save.data.mute ? '🔇' : '🔊'; }
$('soundBtn').onclick = () => { Sound.init(); Save.data.mute = !Save.data.mute; Save.write(); setSoundIcon(); };

// пауза при сворачивании
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    Save.write(); Sound.engine(0, false);
    if (G.state === 'play') { G.paused = true; $('pauseOv').classList.remove('hidden'); }
  }
});
$('pauseOv').addEventListener('pointerdown', () => { G.paused = false; last = performance.now(); $('pauseOv').classList.add('hidden'); });

// ===================== main loop (фиксированный шаг) =====================
function resize() {
  const dpr = window.devicePixelRatio || 1;
  cw = window.innerWidth; ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S = Math.min(cw / C.VIEW_W, ch / 300); groundY = ch * 0.58;
  speedoSafe = parseFloat(getComputedStyle($('controls')).paddingBottom) || 12;
}
let last = 0, acc = 0;
function step(dt) {
  if (G.state === 'menu') { G.camX += 60 * dt; G.x = G.camX + C.CAM_OFFSET; G.wr += 0; }
  else if (G.state === 'play') { updatePlay(dt); Sound.engine(G.v, true); }
  else if (G.state === 'crash') updateCrash(dt);
  updateParticles(dt);
}
function frame(now) {
  requestAnimationFrame(frame);
  if (G.paused) { last = now; return; }
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= C.STEP) { step(C.STEP); acc -= C.STEP; }
  if (G.state === 'play') refreshScoreOnly();
  render();
}
let shownScore = -1;
function refreshScoreOnly() { if (G.score !== shownScore) { shownScore = G.score; $('hScore').textContent = G.score; } }

Save.load();
if (!Save.data.owned.includes(Save.data.skin)) Save.data.skin = 'classic';
reset(false); G.state = 'menu';
setSoundIcon(); refreshHud(); resize();
window.addEventListener('resize', resize); window.addEventListener('orientationchange', resize);
requestAnimationFrame(t => { last = t; frame(t); });
