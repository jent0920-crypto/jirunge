/* 지렁이 대작전 — 화면·입력·소리·저장·순위 (worm/game.js)
   세계·충돌·컴퓨터 지렁이는 core.js(WormCore). 여기는 그것을 그리고 조작을 받는다.
   - 1/60초 고정 스텝(누적기), 그리기는 requestAnimationFrame 마다
   - 캔버스 논리 크기 = 감싸는 상자의 CSS 픽셀, devicePixelRatio(화질 단계에 따라 2 → 1)로 선명하게
   - 마디·먹이는 미리 그린 작은 캔버스(스프라이트)를 drawImage 로 찍는다(원 수천 개를 매번 그리지 않음)
   - 프레임이 느리면 화질을 한 단계씩 낮춘다: 해상도 → 먹이 수 → 컴퓨터 지렁이 수
   - 그림은 모두 캔버스 도형, 소리는 WebAudio 합성(에셋 파일 없음) */
(function () {
'use strict';
var C = window.WormCore;
var Net = window.WormNet;
if (!C) return;
var STEP = C.STEP, URL = 'https://funsoft.co.kr/worm/', RK = 'worm', TAU = Math.PI * 2;
var wrap = document.getElementById('wm-wrap'), cv = document.getElementById('wm-cv'), X = cv.getContext('2d');
var ui = document.getElementById('wm-ui'), bMute = document.getElementById('wm-mute'), bPause = document.getElementById('wm-pause'), toastEl = document.getElementById('wm-toast'), bFull = document.getElementById('wm-full'), bOrient = document.getElementById('wm-orient');
var bRoom = document.createElement('button');
bRoom.id = 'wm-room';
bRoom.className = 'wm-room-badge';
bRoom.style.display = 'none';
bRoom.innerHTML = '🌐 <span>방 코드</span>';
wrap.appendChild(bRoom);
bRoom.addEventListener('click', function () {
  if (Net && Net.roomCode) copyInviteLink(Net.roomCode);
});
var initialRoomCode = '';
try {
  var qp = new URLSearchParams(window.location.search);
  var r = qp.get('room');
  if (r) initialRoomCode = r.trim().toUpperCase();
} catch (e) {}

var W = 390, H = 700, DPR = 1;
var DPR_CAP = [2, 1.5, 1.25, 1];

/* ── 저장 (localStorage 는 막혀 있을 수 있다) ── */
var SKEY = 'worm_v1';
/* v:1 그대로 두고 칸만 더한다(예전 저장값은 그대로 읽힌다).
   mode = 고른 모드, tbest = 3분 타임어택 최고 길이, dDays = 오늘의 도전 참가한 날 수, dLast = 마지막 참가 날, dDay/dBest = 그날 최고 */
function blank() { return { v: 1, best: 0, skin: 'sprout', ctrl: 'stick', bots: 20, mute: false, nick: '', games: 0, kills: 0, bestKills: 0, q: 0, mode: 'classic', tbest: 0, dDays: 0, dLast: '', dDay: '', dBest: 0 }; }
function rec(d) { return { best: d.best, games: d.games, bestKills: d.bestKills, tbest: d.tbest, dDays: d.dDays }; }
function load() {
  var d = blank();
  try { var j = JSON.parse(localStorage.getItem(SKEY) || 'null'); if (j && j.v === 1) for (var k in d) if (j[k] !== undefined && typeof j[k] === typeof d[k]) d[k] = j[k]; } catch (e) {}
  try { if (!d.nick) d.nick = localStorage.getItem('fs_nick') || ''; } catch (e) {}
  if ([15, 20, 25].indexOf(d.bots) < 0) d.bots = 20;
  if (d.ctrl !== 'follow') d.ctrl = 'stick';
  if (!C.MODES[d.mode]) d.mode = 'classic';
  d.q = C.clamp(d.q | 0, 0, 2);
  if (C.unlockedRec(rec(d)).indexOf(d.skin) < 0) d.skin = 'sprout';
  if (initialRoomCode) d.mode = 'online';
  return d;
}
function kstDay() { var d = new Date(Date.now() + 9 * 3600000); return d.getUTCFullYear() + ('0' + (d.getUTCMonth() + 1)).slice(-2) + ('0' + d.getUTCDate()).slice(-2); }
function dayLabel(day) { return (+day.slice(4, 6)) + '월 ' + (+day.slice(6, 8)) + '일'; }
function rkKey(md, day) { return md === 'time' ? 'worm-t3' : md === 'daily' ? 'worm-d' + (day || kstDay()) : 'worm'; }
function fmtT(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
function lockText(s) {   // 잠긴 무늬를 여는 조건(짧게, 길게)
  if (!s.req) return ['🔒 ' + fmt(s.need), '최고 길이 ' + fmt(s.need) + '이 되면 열려요'];
  var k = s.req[0], n = s.req[1];
  if (k === 'games') return ['🔒 ' + n + '판', n + '판을 하면 열려요'];
  if (k === 'bestKills') return ['🔒 ' + n + '처치', '한 판에 ' + n + '마리를 잡으면 열려요'];
  if (k === 'tbest') return ['🔒 3분 ' + fmt(n), '3분 타임어택에서 길이 ' + fmt(n) + '을 넘기면 열려요'];
  return ['🔒 도전 ' + n + '일', '오늘의 도전을 서로 다른 ' + n + '일 하면 열려요'];
}
var SV = load();
function save() { try { localStorage.setItem(SKEY, JSON.stringify(SV)); } catch (e) {} }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmt(n) { return Math.floor(n).toLocaleString('ko-KR'); }

/* ── 소리 (WebAudio 합성) ── */
var AC = null, master = null, boostG = null, eatT = 0, eatCombo = 0;
function audio() {
  if (!AC) {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = SV.mute ? 0 : 0.9; master.connect(AC.destination);
      /* 부스트 바람 소리: 잡음 → 대역 필터 → 평소엔 소리 0 */
      var n = AC.sampleRate, b = AC.createBuffer(1, n, n), ch = b.getChannelData(0), last = 0;
      for (var i = 0; i < n; i++) { last = last * 0.82 + (Math.random() * 2 - 1) * 0.18; ch[i] = last; }
      var src = AC.createBufferSource(); src.buffer = b; src.loop = true;
      var f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.8;
      boostG = AC.createGain(); boostG.gain.value = 0;
      src.connect(f); f.connect(boostG); boostG.connect(master); src.start();
    } catch (e) { AC = null; }
  }
  if (AC && AC.state === 'suspended' && mode !== 'pause') AC.resume().catch(function () {});
  return AC;
}
function tone(fr, d, type, v, f2, delay) {
  if (!AC || SV.mute) return;
  try {
    var t = AC.currentTime + (delay || 0), o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(fr, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v || 0.1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.03);
  } catch (e) {}
}
var SFX = {
  eat: function (v) {
    var now = performance.now();
    if (now - eatT < 55) return;
    eatCombo = now - eatT < 400 ? Math.min(eatCombo + 1, 16) : 0; eatT = now;
    tone(520 + eatCombo * 38 + Math.min(v, 20) * 10, 0.07, 'sine', v > 3 ? 0.07 : 0.045);
  },
  kill: function () { tone(523, 0.12, 'triangle', 0.12); tone(659, 0.12, 'triangle', 0.12, 0, 0.08); tone(784, 0.22, 'triangle', 0.13, 0, 0.16); },
  die: function () { tone(420, 0.6, 'sawtooth', 0.09, 70); tone(210, 0.5, 'square', 0.05, 50, 0.05); },
  bananaPickup: function () { tone(659, 0.1, 'sine', 0.12); tone(880, 0.18, 'sine', 0.14, 0, 0.08); },
  bananaUse: function () { tone(440, 0.35, 'sawtooth', 0.15, 110); tone(330, 0.3, 'sine', 0.12, 55, 0.05); },
  jellyPickup: function () { tone(784, 0.1, 'sine', 0.13); tone(1046, 0.18, 'sine', 0.15, 0, 0.07); tone(1318, 0.22, 'triangle', 0.12, 0, 0.14); },
  jellyJump: function () { tone(320, 0.32, 'sine', 0.18, 520); tone(480, 0.25, 'triangle', 0.12, 240, 0.05); },
  jellyLand: function () { tone(180, 0.15, 'triangle', 0.14, -60); },
  durianPickup: function () { tone(493, 0.12, 'triangle', 0.14); tone(659, 0.15, 'sine', 0.15, 0, 0.08); },
  fart: function () {
    tone(140, 0.45, 'sawtooth', 0.22, -80);
    tone(95, 0.38, 'square', 0.18, -40, 0.04);
    tone(180, 0.25, 'sawtooth', 0.14, -110, 0.12);
  },
  unlock: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.16, 'sine', 0.1, 0, i * 0.08); }); },
  start: function () { tone(392, 0.1, 'triangle', 0.1); tone(587, 0.16, 'triangle', 0.11, 0, 0.09); },
  tick: function () { tone(880, 0.04, 'sine', 0.04); },
  pop: function (near) { tone(near ? 300 : 220, 0.18, 'triangle', near ? 0.08 : 0.04, 90); }
};
function setBoostSound(on) {
  if (!boostG || !AC) return;
  try { boostG.gain.setTargetAtTime(on && !SV.mute ? 0.12 : 0, AC.currentTime, 0.06); } catch (e) {}
}
function setMute(m) {
  SV.mute = !!m; save();
  bMute.textContent = SV.mute ? '🔇' : '🔊';
  bMute.setAttribute('aria-label', SV.mute ? '소리 켜기' : '소리 끄기');
  if (master) master.gain.value = SV.mute ? 0 : 0.9;
  if (SV.mute) setBoostSound(false);
}

/* ── 스프라이트 ── */
function shade(hex, k) {   // k>0 밝게(흰색 쪽), k<0 어둡게
  var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}
function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
var SEG = {}, ORB = {}, DOT = {};
function segSprite(col) {
  var s = SEG[col]; if (s) return s;
  s = mkCanvas(64, 64); var g = s.getContext('2d');
  var gr = g.createRadialGradient(25, 22, 3, 32, 32, 31);
  gr.addColorStop(0, shade(col, 0.45)); gr.addColorStop(0.55, col); gr.addColorStop(1, shade(col, -0.42));
  g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 30.5, 0, TAU); g.fill();
  g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.28)'; g.stroke();
  return (SEG[col] = s);
}
function orbSprite(col) {
  var s = ORB[col]; if (s) return s;
  s = mkCanvas(48, 48); var g = s.getContext('2d');
  var gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.16, shade(col, 0.5)); gr.addColorStop(0.3, col);
  gr.addColorStop(0.5, col.replace(/^#(..)(..)(..)$/, function (m, r, gg, b) { return 'rgba(' + parseInt(r, 16) + ',' + parseInt(gg, 16) + ',' + parseInt(b, 16) + ',.35)'; }));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 48, 48);
  return (ORB[col] = s);
}
function dotSprite(col) {
  var s = DOT[col]; if (s) return s;
  s = mkCanvas(16, 16); var g = s.getContext('2d');
  var gr = g.createRadialGradient(8, 8, 0, 8, 8, 8); gr.addColorStop(0, col); gr.addColorStop(0.5, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
  return (DOT[col] = s);
}
var GLOW = (function () {
  var s = mkCanvas(64, 64), g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 8, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,230,.55)'); gr.addColorStop(1, 'rgba(255,255,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return s;
})();
var BANANA_SPRITE = (function () {
  var c = mkCanvas(64, 64), g = c.getContext('2d');
  g.save();
  g.translate(32, 32);
  g.rotate(-0.4);
  g.shadowColor = 'rgba(255,230,0,0.6)';
  g.shadowBlur = 10;
  g.fillStyle = '#ffe066';
  g.beginPath();
  g.moveTo(-18, 14);
  g.bezierCurveTo(-14, -18, 10, -22, 22, -8);
  g.bezierCurveTo(8, -12, -8, -6, -18, 14);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff9db';
  g.beginPath();
  g.moveTo(-14, 10);
  g.bezierCurveTo(-10, -14, 8, -18, 18, -8);
  g.bezierCurveTo(6, -11, -6, -5, -14, 10);
  g.closePath();
  g.fill();
  g.fillStyle = '#5c3c10';
  g.beginPath();
  g.arc(22, -8, 2.8, 0, TAU);
  g.arc(-18, 14, 2, 0, TAU);
  g.fill();
  g.restore();
  return c;
})();
var APPLE_JELLY_SPRITE = (function () {
  var c = mkCanvas(64, 64), g = c.getContext('2d');
  g.save();
  g.translate(32, 32);
  g.shadowColor = 'rgba(255, 71, 87, 0.7)';
  g.shadowBlur = 12;
  var gr = g.createRadialGradient(-6, -8, 2, 0, 2, 24);
  gr.addColorStop(0, '#ff99a8');
  gr.addColorStop(0.4, '#ff4757');
  gr.addColorStop(0.85, '#ee1133');
  gr.addColorStop(1, '#a30018');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(-18, 14);
  g.bezierCurveTo(-22, 6, -19, -12, -2, -18);
  g.bezierCurveTo(4, -19, 19, -12, 19, 14);
  g.bezierCurveTo(12, 20, -12, 20, -18, 14);
  g.closePath();
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255, 255, 255, 0.65)';
  g.beginPath();
  g.ellipse(-6, -7, 8, 4.5, -0.4, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255, 255, 255, 0.4)';
  g.beginPath();
  g.arc(8, -5, 2.5, 0, TAU);
  g.fill();
  g.fillStyle = '#6b4423';
  g.beginPath();
  g.rect(-2, -22, 3, 5);
  g.fill();
  g.fillStyle = '#2ed573';
  g.beginPath();
  g.ellipse(6, -21, 6, 3, 0.45, 0, TAU);
  g.fill();
  g.restore();
  return c;
})();
var DURIAN_SPRITE = (function () {
  var c = mkCanvas(64, 64), g = c.getContext('2d');
  g.save();
  g.translate(32, 32);
  g.shadowColor = 'rgba(140, 180, 20, 0.6)';
  g.shadowBlur = 10;
  var gr = g.createRadialGradient(-4, -6, 2, 0, 0, 24);
  gr.addColorStop(0, '#d4c060');
  gr.addColorStop(0.5, '#8ba630');
  gr.addColorStop(0.85, '#5c731e');
  gr.addColorStop(1, '#3b4d11');
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(0, 2, 19, 23, 0, 0, TAU);
  g.fill();
  g.shadowBlur = 0;

  g.fillStyle = '#4d6113';
  var thornCount = 18;
  for (var i = 0; i < thornCount; i++) {
    var an = (i / thornCount) * TAU;
    var bx = Math.cos(an) * 18, by = Math.sin(an) * 22 + 2;
    var tx = Math.cos(an) * 25, ty = Math.sin(an) * 29 + 2;
    var tanX = -Math.sin(an) * 3, tanY = Math.cos(an) * 3;
    g.beginPath();
    g.moveTo(bx - tanX, by - tanY);
    g.lineTo(tx, ty);
    g.lineTo(bx + tanX, by + tanY);
    g.closePath();
    g.fill();
  }

  g.fillStyle = '#ffe066';
  for (var j = 0; j < 8; j++) {
    var jx = (Math.cos(j * 1.7) * 9), jy = (Math.sin(j * 1.7) * 11) + 2;
    g.beginPath();
    g.arc(jx, jy, 2.5, 0, TAU);
    g.fill();
  }

  g.fillStyle = '#5c3a10';
  g.beginPath();
  g.rect(-3, -25, 6, 7);
  g.fill();
  g.restore();
  return c;
})();
var shockwaves = [];
var fartClouds = [];
var HUES = []; for (var hi = 0; hi < 24; hi++) HUES.push(hsl2hex(hi * 15, 0.85, 0.6));
function hsl2hex(h, s, l) {
  var a = s * Math.min(l, 1 - l), f = function (n) { var k = (n + h / 30) % 12, c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return ('0' + Math.round(c * 255).toString(16)).slice(-2); };
  return '#' + f(0) + f(8) + f(4);
}
function segCol(sk, i, t) {
  if (sk.rainbow) return HUES[((i + (t * 12 | 0)) % 24 + 24) % 24];
  return sk.cols[sk.seq[i % sk.seq.length]];
}
/* 바닥 무늬: 흙 속 육각 타일 (월드 단위 120×70) */
var BG_TILE = (function () {
  var s = mkCanvas(120, 70), g = s.getContext('2d');
  g.fillStyle = '#0d1a12'; g.fillRect(0, 0, 120, 70);
  g.save(); g.scale(1, 70 / 69.282);
  function hex(cx, cy) {
    g.beginPath();
    for (var k = 0; k < 6; k++) { var an = k * Math.PI / 3; g.lineTo(cx + Math.cos(an) * 37, cy + Math.sin(an) * 37); }
    g.closePath(); g.fillStyle = '#132619'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#0a140d'; g.stroke();
    g.beginPath(); g.arc(cx - 8, cy - 9, 3, 0, TAU); g.fillStyle = 'rgba(255,255,255,.035)'; g.fill();
  }
  hex(0, 0); hex(120, 0); hex(60, 34.641); hex(0, 69.282); hex(120, 69.282);
  g.restore();
  return s;
})();
var bgPat = X.createPattern(BG_TILE, 'repeat');

/* ── 상태 ── */
var mode = 'title';           // title · play · dying · over · pause
var G = null, BG = null, acc = 0, last = performance.now(), rt = 0;
var cam = { x: 0, y: 0, s: 1, follow: 0 };
var match = null;             // 이번 판 기록
var ptrs = {}, mouse = { x: 0, y: 0, has: false, down: false }, keys = {}, touchUI = false, lastSteer = 0;
var perf = { burn: 0, sim: 0, draw: 0, win: 0, winN: 0, slow: 0, frames: 0, t0: performance.now(), fps: 60, ms: 16.7, q: SV.q };
var deathAt = 0, toastT = 0, prevMode = 'play';
try { touchUI = window.matchMedia('(pointer: coarse)').matches; } catch (e) {}

function resize() {
  var r = wrap.getBoundingClientRect();
  W = Math.max(280, Math.round(r.width)); H = Math.max(320, Math.round(r.height));
  DPR = Math.min(window.devicePixelRatio || 1, DPR_CAP[perf.q] || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  bgPat = X.createPattern(BG_TILE, 'repeat');
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });

function setMode(m) {
  mode = m;
  var lock = m === 'play' || m === 'pause' || m === 'dying';
  document.documentElement.classList.toggle('wm-lock', lock);
  wrap.classList.toggle('wm-playing', lock);
  bPause.textContent = m === 'pause' ? '▶' : 'II';
  bPause.style.visibility = (m === 'play' || m === 'pause') ? 'visible' : 'hidden';
  if (m !== 'play') setBoostSound(false);
  if (m === 'title') {
    if (bRoom) bRoom.style.display = 'none';
    if (Net && Net.isOnline) Net.close();
  }
}
function toTop() { var r = wrap.getBoundingClientRect(); if (Math.abs(r.top) > 2) window.scrollTo(0, window.pageYOffset + r.top); }
function showUI(html) { ui.innerHTML = html; ui.classList.add('on'); ui.scrollTop = 0; }
function hideUI() { ui.classList.remove('on'); ui.innerHTML = ''; }
function toast(t, ms) {
  toastEl.textContent = t; toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, ms || 1800);
}

function copyInviteLink(code) {
  var c = code || (Net && Net.roomCode) || '';
  var url = window.location.origin + window.location.pathname + '?room=' + encodeURIComponent(c);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function () {
      toast('📋 초대 링크를 복사했어요! 친구에게 보내보세요.', 2500);
    }).catch(function () {
      window.prompt('초대 링크:', url);
    });
  } else {
    window.prompt('초대 링크:', url);
  }
}

function updateRoomBadge() {
  if (!bRoom) return;
  if (!Net || !Net.isOnline || !Net.roomCode) {
    bRoom.style.display = 'none';
    return;
  }
  bRoom.style.display = 'flex';
  var cnt = 1;
  if (G && G.worms && G.worms.length > 0) {
    cnt = G.worms.filter(function (w) { return w.alive; }).length;
  } else if (Net && Net.getPlayerCount) {
    cnt = Net.getPlayerCount();
  }
  if (cnt < 1) cnt = 1;
  bRoom.innerHTML = '🌐 <b>' + esc(Net.roomCode) + '</b> · ' + cnt + '명 <small style="opacity:0.85;margin-left:4px;">(초대 복사)</small>';
}

function triggerBanana() {
  if (Net && Net.isGuest) {
    if (G && G.player && G.player.alive && (G.player.bananas || 0) > 0) {
      Net.sendSkill('banana');
      G.player.bananas--;
      return true;
    }
    return false;
  }
  return G && C.useBanana(G);
}

function triggerAppleJelly() {
  if (Net && Net.isGuest) {
    if (G && G.player && G.player.alive && (G.player.appleJellies || 0) > 0 && (G.player.jumpTimer || 0) <= 0) {
      Net.sendSkill('jelly');
      G.player.appleJellies--;
      G.player.jumpTimer = 1.0;
      return true;
    }
    return false;
  }
  return G && C.useAppleJelly(G);
}

function triggerDurian() {
  if (Net && Net.isGuest) {
    if (G && G.player && G.player.alive && (G.player.durians || 0) > 0) {
      Net.sendSkill('durian');
      G.player.durians--;
      return true;
    }
    return false;
  }
  return G && C.useDurian(G);
}

function startHostOnline(customCode) {
  audio(); SFX.start();
  var nick = (document.getElementById('wm-nick') || {}).value;
  if (nick !== undefined) { SV.nick = String(nick).trim().slice(0, 12); try { localStorage.setItem('fs_nick', SV.nick); } catch (e) {} }
  save();

  toast('방을 개설하는 중…', 2000);
  Net.createRoom(customCode, {
    onOpen: function (code) {
      toast('👑 방 생성 완료! 코드: ' + code, 3500);
      updateRoomBadge();
      copyInviteLink(code);
    },
    onGuestJoin: function (peerId, name, skin) {
      var w = C.spawnGuestWorm(G, name, skin);
      toast('👋 「' + name + '」님이 참가했습니다!', 2000);
      updateRoomBadge();
      return w.id;
    },
    onGuestInput: function (peerId, a, boost) {
      var wId = Net.guestWorms[peerId];
      if (wId && G && G.byId[wId]) {
        var w = G.byId[wId];
        w.ta = a;
        w.bIn = boost;
      }
    },
    onGuestSkill: function (peerId, skill) {
      var wId = Net.guestWorms[peerId];
      if (wId && G && G.byId[wId]) {
        var w = G.byId[wId];
        if (skill === 'banana') C.useBanana(G, w);
        else if (skill === 'jelly') C.useAppleJelly(G, w);
        else if (skill === 'durian') C.useDurian(G, w);
      }
    },
    onGuestRespawn: function (peerId, name, skin) {
      var nick = name || '참가자', sk = skin || 'grass';
      var oldWId = Net.guestWorms[peerId];
      if (!name && oldWId && G && G.byId[oldWId]) {
        nick = G.byId[oldWId].name;
        sk = (G.byId[oldWId].skin && G.byId[oldWId].skin.id) || 'grass';
      }
      var w = C.spawnGuestWorm(G, nick, sk);
      updateRoomBadge();
      return w.id;
    },
    onGuestLeave: function (peerId, wId) {
      if (wId && G && G.byId[wId]) {
        G.byId[wId].alive = false;
        toast('💨 참가자가 나갔습니다.', 1800);
      }
      updateRoomBadge();
    },
    getInitialSnapshot: function () {
      return G ? C.serializeSnapshot(G) : null;
    },
    onError: function (err) {
      toast('방 연결 오류: ' + (err.type || err.message || err), 3000);
    }
  });

  var opt = { seed: (Math.random() * 1e9) | 0, bots: 0, player: true, name: SV.nick || '방장', skin: SV.skin, quality: perf.q, limit: 0 };
  G = C.newGame(opt);
  match = { mode: 'online', day: kstDay(), rule: null, real0: performance.now(), t0: G.tick, maxRank: 99, best: G.player.m, best0: SV.best, unl0: C.unlockedRec(rec(SV)), posted: false, kills: 0, lives: 1, killer: '', cause: '', end: '' };
  ptrs = {}; mouse.down = false; keys = {};
  cam.x = G.player.x; cam.y = G.player.y; cam.s = viewScale(G.player.r);
  perf.win = 0; perf.winN = 0; perf.slow = 0;
  hideUI(); setMode('play'); toTop(); acc = 0; last = performance.now();
  updateRoomBadge();
}

function joinOnline(code) {
  audio(); SFX.start();
  var nick = (document.getElementById('wm-nick') || {}).value;
  if (nick !== undefined) { SV.nick = String(nick).trim().slice(0, 12); try { localStorage.setItem('fs_nick', SV.nick); } catch (e) {} }
  save();

  toast('방에 접속하는 중… (' + code.toUpperCase() + ')', 3000);
  G = C.newGame({ bots: 0, player: false });
  match = { mode: 'online', day: kstDay(), rule: null, real0: performance.now(), t0: 0, maxRank: 99, best: 20, best0: SV.best, unl0: C.unlockedRec(rec(SV)), posted: false, kills: 0, lives: 1, killer: '', cause: '', end: '' };

  Net.joinRoom(code, SV.nick || '참가자', SV.skin, {
    onJoined: function (data) {
      updateRoomBadge();
      hideUI();
      setMode('play');
      toTop();
      toast('🎉 방에 접속했습니다!', 2000);
    },
    onSnapshot: function (data) {
      if (!G) G = C.newGame({ bots: 0, player: false });
      C.applySnapshot(G, data.s);
      if (Net.myWormId && G.byId[Net.myWormId]) {
        var prevAlive = G.player ? G.player.alive : false;
        G.player = G.byId[Net.myWormId];
        if (!prevAlive && G.player.alive) {
          cam.follow = 0;
          cam.x = G.player.x;
          cam.y = G.player.y;
          cam.s = viewScale(G.player.r);
          deathAt = 0;
          match.killer = '';
          match.cause = '';
          if (mode !== 'play') {
            hideUI();
            setMode('play');
          }
        }
      }
      if (mode === 'play' || mode === 'dying') handleEvents(G);
      updateRoomBadge();
    },
    onRespawned: function (newId) {
      Net.myWormId = newId;
      if (G && G.byId[newId]) {
        G.player = G.byId[newId];
        cam.follow = 0;
        cam.x = G.player.x;
        cam.y = G.player.y;
        cam.s = viewScale(G.player.r);
      }
      match.killer = '';
      match.cause = '';
      deathAt = 0;
      ptrs = {};
      mouse.down = false;
      keys = {};
      last = performance.now();
      acc = 0;
      hideUI();
      setMode('play');
      toast('🌱 다시 태어났어요!', 1800);
      updateRoomBadge();
    },
    onDisconnect: function (reason) {
      toast(reason || '방장과의 연결이 끊어졌습니다.', 3000);
      bRoom.style.display = 'none';
      setMode('title');
      showTitle();
    },
    onError: function (err) {
      toast('접속 실패: 방 코드를 확인해주세요.', 3000);
      bRoom.style.display = 'none';
      setMode('title');
      showTitle();
    }
  });
}

function quickMatchOnline() {
  audio(); SFX.start();
  toast('빠른 매칭 검색 중…', 2000);
  var quickCode = 'PUBLIC';
  var joined = false;
  var timer = setTimeout(function () {
    if (!joined) {
      toast('공개 방을 개설합니다!', 2000);
      startHostOnline(quickCode);
    }
  }, 1800);

  Net.joinRoom(quickCode, SV.nick || '참가자', SV.skin, {
    onJoined: function (data) {
      joined = true;
      clearTimeout(timer);
      updateRoomBadge();
      hideUI();
      setMode('play');
      toTop();
      toast('🎉 공개 대전 방에 접속했습니다!', 2000);
    },
    onSnapshot: function (data) {
      if (!G) G = C.newGame({ bots: 0, player: false });
      C.applySnapshot(G, data.s);
      if (Net.myWormId && G.byId[Net.myWormId]) {
        var prevAlive = G.player ? G.player.alive : false;
        G.player = G.byId[Net.myWormId];
        if (!prevAlive && G.player.alive) {
          cam.follow = 0;
          cam.x = G.player.x;
          cam.y = G.player.y;
          cam.s = viewScale(G.player.r);
          deathAt = 0;
          match.killer = '';
          match.cause = '';
          if (mode !== 'play') {
            hideUI();
            setMode('play');
          }
        }
      }
      if (mode === 'play' || mode === 'dying') handleEvents(G);
      updateRoomBadge();
    },
    onRespawned: function (newId) {
      Net.myWormId = newId;
      if (G && G.byId[newId]) {
        G.player = G.byId[newId];
        cam.follow = 0;
        cam.x = G.player.x;
        cam.y = G.player.y;
        cam.s = viewScale(G.player.r);
      }
      match.killer = '';
      match.cause = '';
      deathAt = 0;
      ptrs = {};
      mouse.down = false;
      keys = {};
      last = performance.now();
      acc = 0;
      hideUI();
      setMode('play');
      toast('🌱 다시 태어났어요!', 1800);
      updateRoomBadge();
    },
    onDisconnect: function () {
      bRoom.style.display = 'none';
      showTitle();
    },
    onError: function () {
      if (!joined) {
        clearTimeout(timer);
        startHostOnline(quickCode);
      }
    }
  });
}

/* ── 게임 시작·끝 ── */
function newBG() { BG = C.newGame({ seed: (Math.random() * 1e9) | 0, bots: 14, quality: Math.max(perf.q, 1) }); }
function start() {
  audio(); SFX.start();
  var nick = (document.getElementById('wm-nick') || {}).value;
  if (nick !== undefined) { SV.nick = String(nick).trim().slice(0, 12); try { localStorage.setItem('fs_nick', SV.nick); } catch (e) {} }
  save();
  var md = SV.mode, M = C.MODES[md], day = kstDay(), rule = null;
  var opt = { seed: (Math.random() * 1e9) | 0, bots: SV.bots, player: true, name: SV.nick || '나', skin: SV.skin, quality: perf.q, limit: M.limit, orbMul: M.orbMul };
  if (md === 'daily') {
    /* 오늘의 도전: 모두 같은 시드·같은 규칙. 처음 판은 화질 0 으로 만들어 기기와 상관없이 같은 경기장이 되게 하고, 그다음 화질을 맞춘다 */
    rule = C.dailyRule(day);
    opt.seed = C.dailySeed(day); opt.bots = rule.bots || 20; opt.quality = 0;
    opt.orbMul = rule.orbMul; opt.orbVal = rule.orbVal; opt.types = rule.types; opt.botMass = rule.botMass; opt.mass = rule.start;
  }
  G = C.newGame(opt);
  if (md === 'daily' && perf.q) C.setQuality(G, perf.q);
  match = { mode: md, day: day, rule: rule, real0: performance.now(), t0: G.tick, maxRank: 99, best: G.player.m, best0: SV.best, unl0: C.unlockedRec(rec(SV)), posted: false, kills: 0, lives: 1, killer: '', cause: '', end: '' };
  ptrs = {}; mouse.down = false; keys = {};
  cam.x = G.player.x; cam.y = G.player.y; cam.s = viewScale(G.player.r);
  perf.win = 0; perf.winN = 0; perf.slow = 0;
  hideUI(); setMode('play'); toTop(); acc = 0; last = performance.now();
  if (md === 'time') toast('⏱ 3분 동안 최대한 길게! 터져도 다시 태어나요', 2800);
  else if (md === 'daily') toast('📅 오늘의 규칙: ' + rule.name + ' · 3분 한 목숨', 2800);
  else if (!touchUI) toast('마우스 쪽으로 기어가요 · 누르고 있으면 부스트 ⚡', 2600);
  else toast(SV.ctrl === 'stick' ? '아무 데나 눌러 끄는 쪽으로 · ⚡ 부스트' : '손가락 쪽으로 기어가요 · ⚡ 꾹 = 부스트', 2600);
}
/* 3분 타임어택: 터지면 잠깐 뒤 새 지렁이로 다시(이번 판 최대 길이는 그대로) */
function respawn() {
  var nick = SV.nick || (Net && Net.isOnline ? '방장' : '나');
  C.respawnPlayer(G, nick, C.skinById(SV.skin));
  match.lives++;
  match.killer = '';
  match.cause = '';
  deathAt = 0;
  cam.follow = 0;
  cam.x = G.player.x;
  cam.y = G.player.y;
  cam.s = viewScale(G.player.r);
  ptrs = {};
  mouse.down = false;
  keys = {};
  last = performance.now();
  acc = 0;
  setMode('play');
  if (Net && Net.isHost && G) {
    Net.broadcastSnapshot(C.serializeSnapshot(G));
  }
  toast(G.limit ? '🌱 다시 태어났어요! 남은 시간 ' + fmtT(G.limit - G.tick * STEP) : '🌱 다시 태어났어요!', 1800);
}

function onlineRespawn() {
  audio();
  if (Net && Net.isOnline) {
    if (Net.isHost) {
      respawn();
      hideUI();
    } else if (Net.isGuest) {
      match.lives++;
      match.killer = '';
      match.cause = '';
      deathAt = 0;
      cam.follow = 0;
      ptrs = {};
      mouse.down = false;
      keys = {};
      last = performance.now();
      acc = 0;
      hideUI();
      setMode('play');
      Net.requestRespawn(SV.nick || '참가자', SV.skin);
      toast('🌱 부활하는 중…', 1500);
    }
  } else {
    respawn();
    hideUI();
  }
}
function liveBest(m) {
  /* 판 도중에도 최고 기록을 넘으면 바로 무늬를 연다 */
  if (m <= SV.best) return;
  var before = C.unlocked(SV.best);
  SV.best = Math.floor(m);
  var after = C.unlocked(SV.best);
  if (after.length > before.length) {
    var sk = C.skinById(after[after.length - 1]);
    SFX.unlock(); toast('🎨 새 무늬 「' + sk.name + '」 열림!', 2200);
    save();
  }
}
function endMatch() {
  var p = G && G.player, md = match.mode, life = (G.tick - match.t0) * STEP, sc = Math.floor(match.best);
  if (p && p.maxM > match.best) sc = Math.floor(match.best = p.maxM);
  match.end = G.done ? 'time' : 'dead'; match.life = life; match.score = sc;
  SV.games++; SV.kills += match.kills; if (match.kills > SV.bestKills) SV.bestKills = match.kills;
  var newBest = md === 'time' ? sc > SV.tbest : md === 'daily' ? (SV.dDay !== match.day || sc > SV.dBest) : sc > match.best0;
  if (md === 'time' && sc > SV.tbest) SV.tbest = sc;
  if (md === 'daily') {
    if (SV.dLast !== match.day) { SV.dDays++; SV.dLast = match.day; }
    if (SV.dDay !== match.day) { SV.dDay = match.day; SV.dBest = 0; }
    if (sc > SV.dBest) SV.dBest = sc;
  }
  liveBest(match.best); save();
  match.newBest = newBest;
  match.unl = C.unlockedRec(rec(SV)).filter(function (id) { return match.unl0.indexOf(id) < 0; }).map(function (id) { return C.skinById(id).name; });
  if (match.unl.length) SFX.unlock();
  showOver();
  setMode('over');
}
/* 다음에 열 수 있는 길이 무늬 */
function nextSkin() {
  for (var i = 0; i < C.SKINS.length; i++) { var s = C.SKINS[i]; if (!s.req && s.need > SV.best) return s; }
  return null;
}
function showOver() {
  if (Net && Net.isOnline) {
    var sc = match ? Math.floor(match.best) : 0;
    var why = match.killer ? '「' + esc(match.killer) + '」 몸에 부딪혔어요' : match.cause === 'wall' ? '경기장 끝에 부딪혔어요' : '부딪혔어요';
    showUI('<div class="wm-card"><p class="wm-mode">🌐 온라인 대전 (방: ' + esc(Net.roomCode) + ')</p><h2>꿈틀… 펑!</h2><p class="wm-sub">' + why + '</p>'
      + '<div class="wm-big">' + fmt(sc) + '<small>이번 판 최대 길이</small></div>'
      + '<div class="wm-stat"><span>처치 <b>' + (match ? match.kills : 0) + '</b></span></div>'
      + '<div class="wm-row"><button class="wm-btn go" data-a="online-respawn" type="button">🌱 다시 태어나기</button></div>'
      + '<div class="wm-row"><button class="wm-btn g" data-a="online-share" type="button">📋 초대 링크 복사</button><button class="wm-btn g" data-a="card" type="button">📸 결과 카드</button><button class="wm-btn g" data-a="title" type="button">방 나가기</button></div>'
      + '</div>');
    return;
  }
  var md = match.mode, sc = match.score, life = match.life, mi = Math.floor(life / 60), se = Math.floor(life % 60);
  var why = match.end === 'time' ? '3분이 지났어요' + (md === 'time' && match.lives > 1 ? ' · 다시 태어난 횟수 ' + (match.lives - 1) : '')
    : match.cause === 'wall' ? '경기장 끝에 부딪혔어요' : match.killer ? '「' + esc(match.killer) + '」 몸에 부딪혔어요' : '부딪혔어요';
  var bestTxt = md === 'time' ? '3분 타임어택 최고 ' + fmt(SV.tbest) : md === 'daily' ? '오늘(' + dayLabel(match.day) + ') 내 최고 ' + fmt(SV.dBest) : '내 최고 기록 ' + fmt(SV.best);
  var nx = nextSkin();
  var label = md === 'daily' ? '📅 오늘의 도전 · ' + esc(match.rule.name) : md === 'time' ? '⏱ 3분 타임어택' : '🌱 자유 대전';
  showUI('<div class="wm-card"><p class="wm-mode">' + label + '</p><h2>' + (match.end === 'time' ? '시간 끝!' : '꿈틀… 펑!') + '</h2><p class="wm-sub">' + why + '</p>'
    + '<div class="wm-big">' + fmt(sc) + '<small>' + (md === 'classic' ? '최대 길이' : '이번 판 최대 길이') + '</small></div>'
    + (match.newBest ? '<p class="wm-new">🎉 ' + (md === 'daily' ? '오늘의 내 최고 기록!' : '내 최고 기록!') + '</p>' : '<p class="wm-tiny">' + bestTxt + '</p>')
    + '<div class="wm-stat"><span>처치 <b>' + match.kills + '</b></span><span>' + (match.end === 'time' ? '시간' : '생존') + ' <b>' + (mi ? mi + '분 ' : '') + se + '초</b></span><span>최고 순위 <b>' + (match.maxRank < 99 ? match.maxRank + '위' : '-') + '</b></span></div>'
    + (match.unl.length ? '<div class="wm-unl">🎨 새 무늬 열림: ' + match.unl.map(esc).join(', ') + '</div>' : nx ? '<p class="wm-tiny">다음 무늬 「' + esc(nx.name) + '」까지 최고 길이 ' + fmt(nx.need - SV.best) + ' 남았어요</p>' : '')
    + '<div class="wm-reg"><input id="wm-nk" maxlength="12" placeholder="닉네임" value="' + esc(SV.nick) + '" aria-label="닉네임"><button class="wm-btn" data-a="post" type="button"' + (match.posted ? ' disabled' : '') + '>' + (match.posted ? (match.postedTxt || '등록 완료') : '순위 등록') + '</button></div>'
    + '<div class="wm-row"><button class="wm-btn go" data-a="start" type="button">' + (md === 'daily' ? '한 번 더 도전' : '다시 하기') + '</button></div>'
    + '<div class="wm-row"><button class="wm-btn g" data-a="card" type="button">📸 결과 카드</button><button class="wm-btn g" data-a="share" type="button">공유</button><button class="wm-btn g" data-a="title" type="button">모드·무늬</button></div>'
    + '<p class="wm-tiny">🏆 ' + rankTitle(md, match.day) + '</p><div class="wm-rk" id="wm-rk"></div></div>');
  rank(document.getElementById('wm-rk'), md, match.day);
}
function rankTitle(md, day) { return md === 'time' ? '3분 타임어택 전국 순위' : md === 'daily' ? '오늘의 도전 순위 (' + dayLabel(day || kstDay()) + ')' : md === 'online' ? '온라인 대전 최고 기록' : '자유 대전 전국 최대 길이 순위'; }
function pause() {
  if (mode !== 'play') return;
  setMode('pause'); ptrs = {}; mouse.down = false; keys = {};
  if (AC && AC.state === 'running') AC.suspend().catch(function () {});
  var p = G.player;
  showUI('<div class="wm-card"><h2>일시정지</h2><p class="wm-sub">길이 ' + fmt(p.m) + ' · 처치 ' + match.kills + (G.limit ? ' · 남은 시간 ' + fmtT(G.limit - G.tick * STEP) : '') + '</p>'
    + '<div class="wm-row"><button class="wm-btn" data-a="resume" type="button">계속하기</button><button class="wm-btn g" data-a="quit" type="button">그만하기</button></div><p class="wm-tiny">P·Esc 로도 계속할 수 있어요</p></div>');
}
function resume() {
  if (mode !== 'pause') return;
  hideUI(); setMode('play'); audio();
  last = performance.now(); acc = 0;
}

/* ── 처음 화면 ── */
function showTitle() {
  setMode('title'); G = null; if (!BG) newBG();
  var un = C.unlockedRec(rec(SV));
  var skins = C.SKINS.map(function (s) {
    var lock = un.indexOf(s.id) < 0, lt = lockText(s);
    return '<button class="wm-skin' + (s.id === SV.skin ? ' on' : '') + (lock ? ' lock' : '') + '" data-a="skin" data-v="' + s.id + '" type="button"' + (lock ? ' aria-disabled="true"' : '') + ' aria-label="' + esc(s.name) + (lock ? ' (' + lt[1] + ')' : '') + '">'
      + '<canvas width="96" height="48" data-skin="' + s.id + '"></canvas><small>' + (lock ? lt[0] : esc(s.name)) + '</small></button>';
  }).join('');
  var modes = ['classic', 'time', 'daily', 'online'].map(function (m) { return '<button data-a="mode" data-v="' + m + '" class="' + (SV.mode === m ? 'on' : '') + '" type="button">' + (m === 'daily' ? '📅 ' : m === 'time' ? '⏱ ' : m === 'online' ? '🌐 ' : '') + esc(C.MODES[m].name) + '</button>'; }).join('');
  var onlineBox = '<div class="wm-online-box" id="wm-online-box"' + (SV.mode === 'online' ? '' : ' hidden') + '>'
    + '<div class="wm-online-row">'
    + '<button class="wm-btn go" data-a="online-create" type="button" style="flex:1;font-size:14px;padding:9px 6px;">👑 방 만들기</button>'
    + '<button class="wm-btn" data-a="online-quick" type="button" style="flex:1;font-size:14px;padding:9px 6px;background:#339af0;color:#fff;">🚀 빠른 매칭</button>'
    + '</div>'
    + '<div class="wm-online-row">'
    + '<input id="wm-room-input" maxlength="10" placeholder="방 코드 입력" style="flex:1;text-transform:uppercase;text-align:center;font-weight:900;letter-spacing:2px;font-size:14px;padding:8px;" value="' + esc(initialRoomCode || '') + '">'
    + '<button class="wm-btn" data-a="online-join" type="button" style="padding:8px 16px;font-size:14px;">참가</button>'
    + '</div>'
    + '</div>';
  showUI('<div class="wm-card"><div class="wm-logo"><span>꿈틀꿈틀 먹고 크고 가로막기</span><b>지렁이 대작전</b></div>'
    + '<div class="wm-name"><input id="wm-nick" maxlength="12" placeholder="내 지렁이 이름" value="' + esc(SV.nick) + '" aria-label="내 지렁이 이름"></div>'
    + '<div class="wm-seg wm-modes" role="group" aria-label="모드">' + modes + '</div><p class="wm-tiny wm-mdesc" id="wm-mdesc">' + modeDesc(SV.mode) + '</p>'
    + onlineBox
    + '<div class="wm-row"><button class="wm-btn go" data-a="start" type="button">' + (SV.mode === 'online' ? '온라인 시작 (방 만들기)' : '시작하기') + '</button></div>'
    + '<div class="wm-skins">' + skins + '</div>'
    + (touchUI ? '<div class="wm-opt"><span>조작</span><div class="wm-seg"><button data-a="ctrl" data-v="follow" class="' + (SV.ctrl === 'follow' ? 'on' : '') + '" type="button">손가락 따라가기</button><button data-a="ctrl" data-v="stick" class="' + (SV.ctrl === 'stick' ? 'on' : '') + '" type="button">조이스틱</button></div></div>' : '')
    + '<div class="wm-opt" id="wm-botopt"' + (SV.mode === 'daily' || SV.mode === 'online' ? ' hidden' : '') + '><span>컴퓨터 지렁이</span><div class="wm-seg">' + [15, 20, 25].map(function (n) { return '<button data-a="bots" data-v="' + n + '" class="' + (SV.bots === n ? 'on' : '') + '" type="button">' + n + '마리</button>'; }).join('') + '</div></div>'
    + '<div class="wm-stat"><span>최고 길이 <b>' + fmt(SV.best) + '</b></span><span>3분 최고 <b>' + fmt(SV.tbest) + '</b></span><span>판 수 <b>' + SV.games + '</b></span><span>총 처치 <b>' + SV.kills + '</b></span></div>'
    + '<p class="wm-tiny">' + (touchUI ? '⚡ 버튼을 꾹 누르면 부스트(길이가 줄어요)' : '마우스로 방향 · 클릭 유지·스페이스 = 부스트 · P 일시정지') + '</p>'
    + '<p class="wm-tiny" id="wm-rkt">🏆 ' + rankTitle(SV.mode) + '</p><div class="wm-rk" id="wm-rk"></div></div>');
  ui.querySelectorAll('canvas[data-skin]').forEach(function (c) { drawPreview(c, C.skinById(c.getAttribute('data-skin'))); });
  rank(document.getElementById('wm-rk'), SV.mode);
}
function modeDesc(md) {
  if (md === 'time') return '3분 동안 얼마나 길어질까? 터져도 바로 다시 태어나고, 3분 안에 가장 길었던 길이가 기록이에요. 먹이가 조금 더 많아요.';
  if (md === 'daily') {
    var day = kstDay(), r = C.dailyRule(day);
    return '<b>' + dayLabel(day) + ' 규칙: ' + esc(r.name) + '</b> — ' + esc(r.desc) + '. 모두 같은 경기장·같은 지렁이로 시작하는 3분 한 목숨 승부, 매일 0시(한국 시간)에 바뀌어요.' + (SV.dDay === day && SV.dBest ? ' 오늘 내 최고 ' + fmt(SV.dBest) : '');
  }
  if (md === 'online') {
    return '<b>🌐 실시간 온라인 멀티플레이어</b> — P2P WebRTC로 친구들과 지연 없이 대전하세요! 방을 만들어 초대 링크를 공유하거나 방 코드로 참가할 수 있어요.';
  }
  return '시간 제한 없이 한 목숨으로 최대한 길게! 예전부터 있던 전국 최대 길이 순위에 올라가요.';
}
function drawPreview(c, sk) {
  var g = c.getContext('2d'), n = 14, r = 8;
  g.clearRect(0, 0, c.width, c.height);
  for (var i = n - 1; i >= 0; i--) {
    var x = 12 + (n - 1 - i) * 5.4, y = 24 + Math.sin(i * 0.55) * 9, rr = r * (i > n - 4 ? 0.65 + (n - i) * 0.09 : 1);
    g.drawImage(segSprite(segCol(sk, i, 0)), x - rr, y - rr, rr * 2, rr * 2);
    if (sk.dot && i % 3 === 1) g.drawImage(dotSprite(sk.dot), x - 3, y - 3, 6, 6);
  }
  var hx = 12 + (n - 1) * 5.4, hy = 24;
  g.fillStyle = '#fff'; g.beginPath(); g.arc(hx + 2, hy - 3.5, 3, 0, TAU); g.arc(hx + 2, hy + 3.5, 3, 0, TAU); g.fill();
  g.fillStyle = '#111'; g.beginPath(); g.arc(hx + 3, hy - 3.5, 1.5, 0, TAU); g.arc(hx + 3, hy + 3.5, 1.5, 0, TAU); g.fill();
}

/* ── 순위 ── */
var rankSeq = 0;
function rank(el, md, day) {
  if (!el) return;
  var seq = ++rankSeq;
  el.textContent = '순위 불러오는 중…';
  fetch('/api/rank.php?game=' + encodeURIComponent(rkKey(md, day))).then(function (r) { return r.json(); }).then(function (j) {
    if (seq !== rankSeq) return;   // 모드를 빨리 바꾸면 늦게 온 예전 응답은 버린다
    if (!Array.isArray(j)) { el.textContent = '순위를 불러오지 못했어요'; return; }
    el.innerHTML = j.length ? j.slice(0, 10).map(function (x, i) { return '<div><span>' + (i + 1) + '. ' + esc(x.nickname) + '</span><span>길이 ' + (+x.score).toLocaleString('ko-KR') + (x.grade ? ' · ' + esc(x.grade) : '') + '</span></div>'; }).join('')
      : '<div class="wm-muted">' + (md === 'daily' ? '오늘은 아직 기록이 없어요. 오늘의 1등이 되어 보세요!' : '아직 기록이 없어요. 첫 1등이 되어 보세요!') + '</div>';
  }).catch(function () { if (seq === rankSeq) el.textContent = '순위를 불러오지 못했어요'; });
}
function post(btn) {
  if (!G || !match || match.posted || mode !== 'over') return;
  var md = match.mode, real = (performance.now() - match.real0) / 1000;
  /* 시간 모드는 실제로 흐른 시간보다 게임 시간이 길 수 없다 */
  if (G.limit && match.life > real + 5) { btn.textContent = '등록할 수 없는 기록'; btn.disabled = true; return; }
  var inp = document.getElementById('wm-nk'), n = ((inp && inp.value) || '').trim().slice(0, 12) || '익명';
  SV.nick = n; save(); try { localStorage.setItem('fs_nick', n); } catch (e) {}
  var body = { nickname: n, score: match.score, grade: '처치 ' + match.kills };
  btn.disabled = true; btn.textContent = '등록 중…';
  fetch('/api/rank.php?game=' + encodeURIComponent(rkKey(md, match.day)), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json(); })
    .then(function (j) { match.posted = true; match.rank = j && j.rank; match.postedTxt = j && j.rank ? (md === 'daily' ? '오늘 ' : '전국 ') + j.rank + '위!' : '등록 완료'; btn.textContent = match.postedTxt; rank(document.getElementById('wm-rk'), md, match.day); })
    .catch(function () { btn.textContent = '실패 · 다시'; btn.disabled = false; });
}
function shareText() {
  var md = match ? match.mode : SV.mode, v = match && match.score ? match.score : SV.best;
  var head = md === 'daily' ? '📅 지렁이 대작전 오늘의 도전(' + dayLabel(match.day) + ' · ' + match.rule.name + ')' : md === 'time' ? '⏱ 지렁이 대작전 3분 타임어택' : '🪱 지렁이 대작전';
  return head + ' — 길이 ' + fmt(v) + '까지 컸어요' + (match && match.kills ? ', ' + match.kills + '마리 잡았어요' : '') + '! 나보다 길게 자랄 수 있어?\n' + URL;
}
function share() {
  var t = shareText();
  if (navigator.share) { navigator.share({ title: '지렁이 대작전', text: t }).catch(function () {}); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('복사했어요! 친구에게 보내 보세요.'); }, function () { window.prompt('복사해서 보내 주세요', t); });
  else window.prompt('복사해서 보내 주세요', t);
}
/* ── 결과 카드(1080×1080 PNG) — 캔버스로 직접 그린다 ── */
function drawCard() {
  var c = mkCanvas(1080, 1080), g = c.getContext('2d'), md = match.mode, sk = C.skinById(SV.skin);
  g.fillStyle = '#0d1a12'; g.fillRect(0, 0, 1080, 1080);
  g.save(); g.scale(3, 3); g.fillStyle = g.createPattern(BG_TILE, 'repeat'); g.fillRect(0, 0, 360, 360); g.restore();
  var vg = g.createRadialGradient(540, 470, 120, 540, 540, 760); vg.addColorStop(0, 'rgba(8,20,12,.2)'); vg.addColorStop(1, 'rgba(3,8,5,.88)');
  g.fillStyle = vg; g.fillRect(0, 0, 1080, 1080);
  /* 빙글 도는 내 지렁이 */
  var n = 64, pts = [];
  for (var i = 0; i < n; i++) { var t = i / n, an = -0.6 + t * 7.2, rr = 250 - t * 175; pts.push([540 + Math.cos(an) * rr, 640 + Math.sin(an) * rr * 0.5]); }
  for (i = n - 1; i >= 0; i--) {
    var r = 30 * (i > n - 7 ? 0.55 + (n - i) * 0.075 : 1);
    g.drawImage(segSprite(segCol(sk, i, 0)), pts[i][0] - r, pts[i][1] - r, r * 2, r * 2);
    if (sk.dot && i % 3 === 1) g.drawImage(dotSprite(sk.dot), pts[i][0] - 8, pts[i][1] - 12, 16, 16);
  }
  var hx = pts[0][0], hy = pts[0][1], ha = Math.atan2(pts[0][1] - pts[1][1], pts[0][0] - pts[1][0]), ca = Math.cos(ha), sa = Math.sin(ha);
  [1, -1].forEach(function (sd) {
    var ex = hx + ca * 8 - sa * 13 * sd, ey = hy + sa * 8 + ca * 13 * sd;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(ex, ey, 10, 0, TAU); g.fill();
    g.fillStyle = '#141414'; g.beginPath(); g.arc(ex + ca * 3, ey + sa * 3, 5.5, 0, TAU); g.fill();
  });
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = '900 64px "Black Han Sans","Noto Sans KR",sans-serif'; g.fillStyle = '#c0eb75'; g.fillText('지렁이 대작전', 540, 120);
  var label = md === 'daily' ? '오늘의 도전 · ' + dayLabel(match.day) + ' · ' + match.rule.name : md === 'time' ? '3분 타임어택' : '자유 대전';
  g.font = '700 36px "Noto Sans KR",sans-serif'; g.fillStyle = '#ffe066'; g.fillText(label, 540, 178);
  g.font = '900 150px "Noto Sans KR",sans-serif'; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillText(fmt(match.score), 544, 364); g.fillStyle = '#fff'; g.fillText(fmt(match.score), 540, 360);
  g.font = '700 40px "Noto Sans KR",sans-serif'; g.fillStyle = '#dcefe0'; g.fillText('최대 길이', 540, 420);
  var mi = Math.floor(match.life / 60), se = Math.floor(match.life % 60);
  var stats = ['처치 ' + match.kills, (mi ? mi + '분 ' : '') + se + '초', '최고 ' + (match.maxRank < 99 ? match.maxRank + '위' : '-')];
  if (match.rank) stats.push((md === 'daily' ? '오늘 ' : '전국 ') + match.rank + '위');
  g.font = '800 36px "Noto Sans KR",sans-serif';
  var ws = stats.map(function (s) { return g.measureText(s).width + 56; }), tot = ws.reduce(function (a, b) { return a + b; }, 0) + (stats.length - 1) * 18, x = 540 - tot / 2;
  stats.forEach(function (s, k) {
    g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); var w = ws[k], y = 860;
    g.moveTo(x + 32, y); g.arcTo(x + w, y, x + w, y + 64, 32); g.arcTo(x + w, y + 64, x, y + 64, 32); g.arcTo(x, y + 64, x, y, 32); g.arcTo(x, y, x + w, y, 32); g.fill();
    g.fillStyle = '#ffe066'; g.fillText(s, x + w / 2, y + 45); x += w + 18;
  });
  g.font = '700 34px "Noto Sans KR",sans-serif'; g.fillStyle = '#a7c4ae'; g.fillText((SV.nick ? SV.nick + ' · ' : '') + '무늬 「' + sk.name + '」', 540, 990);
  g.font = '800 34px "Noto Sans KR",sans-serif'; g.fillStyle = '#c0eb75'; g.fillText('funsoft.co.kr/worm', 540, 1040);
  return c;
}
function showCard() {
  var c = drawCard(), url = c.toDataURL('image/png');
  showUI('<div class="wm-card"><h2>결과 카드</h2><img class="wm-cardimg" src="' + url + '" alt="지렁이 대작전 결과 카드: 최대 길이 ' + fmt(match.score) + '" width="1080" height="1080">'
    + '<div class="wm-row"><button class="wm-btn" data-a="cardshare" type="button">이미지 공유</button><button class="wm-btn g" data-a="cardsave" type="button">저장</button></div>'
    + '<div class="wm-row"><button class="wm-btn g" data-a="back" type="button">← 결과로</button></div><p class="wm-tiny">휴대폰에서는 이미지를 길게 눌러 저장할 수도 있어요</p></div>');
  ui._card = c;
}
function cardBlob(cb) { var c = ui._card; if (!c) return; if (c.toBlob) c.toBlob(cb, 'image/png'); else cb(null); }
function saveCard() {
  cardBlob(function (b) {
    if (!b) return;
    var a = document.createElement('a'); a.href = URL_.createObjectURL(b); a.download = 'worm-' + match.score + '.png';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL_.revokeObjectURL(a.href); }, 3000);
  });
}
function shareCard() {
  cardBlob(function (b) {
    var f = null; try { f = b && new File([b], 'worm-' + match.score + '.png', { type: 'image/png' }); } catch (e) {}
    if (f && navigator.canShare && navigator.canShare({ files: [f] })) navigator.share({ files: [f], text: shareText() }).catch(function () {});
    else { saveCard(); toast('이미지를 저장했어요. 친구에게 보내 보세요!'); }
  });
}
var URL_ = window.URL || window.webkitURL;
ui.addEventListener('click', function (e) {
  var b = e.target.closest('[data-a]'); if (!b || !ui.contains(b)) return;
  var a = b.getAttribute('data-a'), v = b.getAttribute('data-v');
  audio(); if (a !== 'start') SFX.tick();
  switch (a) {
    case 'start':
      if (Net && Net.isOnline) {
        onlineRespawn();
      } else if (SV.mode === 'online') {
        var cInp = (document.getElementById('wm-room-input') || {}).value;
        if (cInp && cInp.trim()) joinOnline(cInp.trim());
        else startHostOnline();
      } else {
        start();
      }
      break;
    case 'online-create': startHostOnline(); break;
    case 'online-quick': quickMatchOnline(); break;
    case 'online-join':
      var cInp2 = (document.getElementById('wm-room-input') || {}).value;
      if (cInp2 && cInp2.trim()) joinOnline(cInp2.trim());
      else toast('방 코드를 입력해주세요!');
      break;
    case 'online-respawn':
      onlineRespawn();
      break;
    case 'online-share':
      copyInviteLink(Net && Net.roomCode);
      break;
    case 'skin': if (b.classList.contains('lock')) { toast(lockText(C.skinById(v))[1]); break; } SV.skin = v; save(); ui.querySelectorAll('.wm-skin').forEach(function (x) { x.classList.toggle('on', x === b); }); break;
    case 'mode':
      SV.mode = C.MODES[v] ? v : 'classic'; save();
      ui.querySelectorAll('[data-a="mode"]').forEach(function (x) { x.classList.toggle('on', x === b); });
      var dd = document.getElementById('wm-mdesc'); if (dd) dd.innerHTML = modeDesc(SV.mode);
      var bo = document.getElementById('wm-botopt'); if (bo) bo.hidden = SV.mode === 'daily' || SV.mode === 'online';
      var obo = document.getElementById('wm-online-box'); if (obo) obo.hidden = SV.mode !== 'online';
      var startBtn = ui.querySelector('[data-a="start"]');
      if (startBtn) startBtn.textContent = (SV.mode === 'online' ? '온라인 시작 (방 만들기)' : '시작하기');
      var rt2 = document.getElementById('wm-rkt'); if (rt2) rt2.textContent = '🏆 ' + rankTitle(SV.mode);
      rank(document.getElementById('wm-rk'), SV.mode);
      break;
    case 'card': showCard(); break;
    case 'cardsave': saveCard(); break;
    case 'cardshare': shareCard(); break;
    case 'back': showOver(); break;
    case 'ctrl': SV.ctrl = v === 'stick' ? 'stick' : 'follow'; save(); ui.querySelectorAll('[data-a="ctrl"]').forEach(function (x) { x.classList.toggle('on', x === b); }); break;
    case 'bots': SV.bots = +v; save(); ui.querySelectorAll('[data-a="bots"]').forEach(function (x) { x.classList.toggle('on', x === b); }); break;
    case 'title': showTitle(); break;
    case 'resume': resume(); break;
    case 'quit': hideUI(); showTitle(); break;
    case 'post': post(b); break;
    case 'share': share(); break;
  }
});
ui.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.id === 'wm-nick') { e.preventDefault(); start(); } });

/* ── 입력 ── */
function local(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function boostBtn() {
  var rr = Math.max(28, Math.min(38, Math.min(W, H) * 0.085));
  return { x: W - rr - 18, y: H - rr - 18, r: rr };
}
function joystickPos() {
  var jr = (W > H ? Math.min(48, Math.max(38, H * 0.125)) : Math.max(46, Math.min(60, Math.min(W, H) * 0.135)));
  return { x: jr + 18, y: H - jr - 18, r: jr };
}
function bananaBtn() {
  var bb = boostBtn();
  var ir = Math.max(22, Math.min(30, bb.r * 0.82));
  return { x: bb.x - bb.r - ir - 14, y: bb.y, r: ir };
}
function appleJellyBtn() {
  var bb = boostBtn();
  var ir = Math.max(22, Math.min(30, bb.r * 0.82));
  return { x: bb.x, y: bb.y - bb.r - ir - 14, r: ir };
}
function durianBtn() {
  var bb = boostBtn();
  var ir = Math.max(22, Math.min(30, bb.r * 0.82));
  return { x: bb.x - bb.r - ir - 14, y: bb.y - bb.r - ir - 14, r: ir };
}
cv.addEventListener('pointerdown', function (e) {
  audio();
  if (mode === 'over' && Net && Net.isOnline) {
    onlineRespawn();
    return;
  }
  if (mode !== 'play') return;
  var p = local(e);
  var joy = joystickPos();
  if (e.pointerType === 'mouse') {
    mouse.x = p.x; mouse.y = p.y; mouse.has = true; mouse.down = true;
    mouse.onJoy = (Math.hypot(p.x - joy.x, p.y - joy.y) < joy.r * 1.5);
    return;
  }
  touchUI = true;
  var bb = boostBtn(), bnb = bananaBtn(), ajb = appleJellyBtn(), drb = durianBtn();
  if (Math.hypot(p.x - drb.x, p.y - drb.y) < drb.r + 14) {
    if (triggerDurian()) {
      e.preventDefault();
      return;
    }
  }
  if (Math.hypot(p.x - ajb.x, p.y - ajb.y) < ajb.r + 14) {
    if (triggerAppleJelly()) {
      e.preventDefault();
      return;
    }
  }
  if (Math.hypot(p.x - bnb.x, p.y - bnb.y) < bnb.r + 14) {
    if (triggerBanana()) {
      e.preventDefault();
      return;
    }
  }
  if (Math.hypot(p.x - bb.x, p.y - bb.y) < bb.r + 20) {
    ptrs[e.pointerId] = { role: 'boost', x: p.x, y: p.y };
    try { cv.setPointerCapture(e.pointerId); } catch (er) {}
    e.preventDefault();
    return;
  }
  var hasSteer = false;
  for (var k in ptrs) if (ptrs[k].role === 'steer') hasSteer = true;
  var distToJoy = Math.hypot(p.x - joy.x, p.y - joy.y);
  var role = (!hasSteer && (distToJoy < joy.r * 2.2 || p.x < W * 0.55)) ? 'steer' : (hasSteer ? 'boost' : 'steer');
  ptrs[e.pointerId] = { role: role, x: p.x, y: p.y, bx: joy.x, by: joy.y, isJoy: (role === 'steer') };
  try { cv.setPointerCapture(e.pointerId); } catch (er) {}
  e.preventDefault();
});
cv.addEventListener('pointermove', function (e) {
  var p = local(e);
  if (e.pointerType === 'mouse') {
    mouse.x = p.x; mouse.y = p.y; mouse.has = true; lastSteer = 1;
    var joy = joystickPos();
    if (mouse.down && Math.hypot(p.x - joy.x, p.y - joy.y) < joy.r * 1.8) {
      mouse.onJoy = true;
    }
    return;
  }
  var q = ptrs[e.pointerId]; if (!q) return;
  q.x = p.x; q.y = p.y;
});
function ptrEnd(e) {
  if (e.pointerType === 'mouse') { mouse.down = false; mouse.onJoy = false; return; }
  delete ptrs[e.pointerId];
}
cv.addEventListener('pointerup', ptrEnd);
cv.addEventListener('pointercancel', ptrEnd);
cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
wrap.addEventListener('touchmove', function (e) { if (mode === 'play' || mode === 'dying') e.preventDefault(); }, { passive: false });
wrap.addEventListener('wheel', function (e) { if (mode === 'play' || mode === 'dying') e.preventDefault(); }, { passive: false });
document.addEventListener('keydown', function (e) {
  var k = e.key, t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (k === 'm' || k === 'M') { audio(); setMute(!SV.mute); return; }
  if (k === 'p' || k === 'P' || k === 'Escape') { if (mode === 'pause') { e.preventDefault(); resume(); } else if (mode === 'play') { e.preventDefault(); pause(); } return; }
  if (mode === 'title' && k === 'Enter') { e.preventDefault(); start(); return; }
  if (mode === 'over' && (k === 'Enter' || k === ' ')) {
    e.preventDefault();
    if (Net && Net.isOnline) onlineRespawn();
    else start();
    return;
  }
  if (mode !== 'play') return;
  if (k === ' ' && G && G.player && G.player.alive && G.player.appleJellies > 0 && G.player.jumpTimer <= 0) {
    if (triggerAppleJelly()) { e.preventDefault(); return; }
  }
  if (k === 'f' || k === 'F') { if (triggerBanana()) { e.preventDefault(); return; } }
  if (k === 'c' || k === 'C') { if (triggerDurian()) { e.preventDefault(); return; } }
  if (/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown| |a|d|w|A|D|W)$/.test(k)) { e.preventDefault(); keys[k.toLowerCase()] = true; if (k !== ' ' && k !== 'ArrowUp' && k !== 'w' && k !== 'W') lastSteer = 2; }
});
document.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
bMute.addEventListener('click', function () { audio(); setMute(!SV.mute); bMute.blur(); });
bPause.addEventListener('click', function () { if (mode === 'pause') resume(); else if (mode === 'play') pause(); bPause.blur(); });
if (bFull) {
  bFull.addEventListener('click', function () {
    audio();
    var doc = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (doc.requestFullscreen) doc.requestFullscreen().catch(function () {});
      else if (doc.webkitRequestFullscreen) doc.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
    bFull.blur();
  });
}
function updateFullscreenBtn() {
  if (!bFull) return;
  var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  bFull.textContent = isFs ? '🗗' : '⛶';
  bFull.title = isFs ? '전체화면 해제' : '화면 풀로 채우기';
  bFull.setAttribute('aria-label', bFull.title);
}
document.addEventListener('fullscreenchange', updateFullscreenBtn);
document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);

if (bOrient) {
  bOrient.addEventListener('click', function () {
    audio();
    var isLandscape = W > H;
    if (!isLandscape) {
      var doc = document.documentElement;
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (doc.requestFullscreen) doc.requestFullscreen().catch(function () {});
        else if (doc.webkitRequestFullscreen) doc.webkitRequestFullscreen();
      }
      var locked = false;
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').then(function () {
          toast('🔄 가로 모드로 변경되었습니다', 2000);
        }).catch(function () {
          toast('기기를 가로로 회전해주세요 📱↔', 2200);
        });
        locked = true;
      } else if (screen.lockOrientation) {
        try {
          if (screen.lockOrientation('landscape')) {
            toast('🔄 가로 모드로 변경되었습니다', 2000);
            locked = true;
          }
        } catch (e) {}
      }
      if (!locked) toast('기기를 가로로 회전해주세요 📱↔', 2200);
    } else {
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(function () {});
      }
      toast('🔄 세로 모드로 변경되었습니다', 2000);
    }
    bOrient.blur();
  });
}
document.addEventListener('visibilitychange', function () { if (document.hidden && mode === 'play') pause(); });
window.addEventListener('blur', function () { ptrs = {}; mouse.down = false; keys = {}; });

/* 한 스텝마다 조작을 입력으로 바꾼다 */
function applyInput() {
  var p = G.player; if (!p || !p.alive) return;
  var inp = G.input, steerP = null, boost = false, k;
  for (k in ptrs) { var q = ptrs[k]; if (q.role === 'steer') steerP = q; else boost = true; }
  var cx = W / 2, cy = H / 2;
  var joy = joystickPos();

  if (keys.arrowleft || keys.a) inp.a = C.wrapA(inp.a - 3.4 * STEP);
  else if (keys.arrowright || keys.d) inp.a = C.wrapA(inp.a + 3.4 * STEP);
  else if (steerP) {
    if (steerP.isJoy || SV.ctrl === 'stick' || steerP.x < W * 0.6) {
      var dx = steerP.x - joy.x, dy = steerP.y - joy.y;
      if (dx * dx + dy * dy > 36) inp.a = Math.atan2(dy, dx);
    } else {
      var fx = steerP.x - cx, fy = steerP.y - cy;
      if (fx * fx + fy * fy > 100) inp.a = Math.atan2(fy, fx);
    }
  } else if (mouse.has && lastSteer === 1) {
    if (mouse.down && mouse.onJoy) {
      var dx = mouse.x - joy.x, dy = mouse.y - joy.y;
      if (dx * dx + dy * dy > 36) inp.a = Math.atan2(dy, dx);
    } else {
      var mx = mouse.x - cx, my = mouse.y - cy;
      if (mx * mx + my * my > 36) inp.a = Math.atan2(my, mx);
    }
  }
  var spaceBoost = keys[' '] && (!G.player || (G.player.appleJellies || 0) <= 0 || (G.player.jumpTimer || 0) > 0);
  if ((mouse.down && !mouse.onJoy) || spaceBoost || (keys.arrowup && !keys.arrowleft && !keys.arrowright) || keys.w) boost = true;
  inp.boost = boost;
  if (Net && Net.isGuest) {
    Net.sendInput(inp.a, inp.boost);
  }
}

/* ── 사건(먹기·죽음) ── */
function handleEvents(g) {
  var ev = g.ev; if (!ev.length) return;
  if (mode === 'over') { ev.length = 0; return; }   // 3분이 끝난 뒤에도 세계는 배경으로 돌지만, 그때 일어난 일은 기록에 넣지 않는다
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i];
    if (g !== G) continue;
    if (e.t === 'eat') { SFX.eat(e.v); continue; }
    if (e.t === 'banana_pickup') { SFX.bananaPickup(); toast('🍌 바나나 획득! (' + e.count + '/3) — [F]키로 감속 사용', 1600); continue; }
    if (e.t === 'banana_use') { SFX.bananaUse(); shockwaves.push({ x: e.x, y: e.y, r: 0, maxR: 800, life: 0.6, maxLife: 0.6 }); toast('🍌 바나나 사용! ' + (e.affected > 0 ? e.affected + '마리 5초간 50% 감속!' : '주변 지렁이 50% 감속!'), 1800); continue; }
    if (e.t === 'banana_spawn') { if (G.player && G.player.alive) toast('🍌 바나나가 떨어졌어요! (지도 확인)', 1400); continue; }
    if (e.t === 'jelly_pickup') { SFX.jellyPickup(); toast('🍎 사과젤리 획득! (' + e.count + '/3) — [Space] 점프', 1600); continue; }
    if (e.t === 'jelly_jump') { SFX.jellyJump(); toast('🍎 1초간 점프! (충돌 무적 회피)', 1400); continue; }
    if (e.t === 'jelly_land') { SFX.jellyLand(); continue; }
    if (e.t === 'jelly_spawn') { if (G.player && G.player.alive) toast('🍎 사과젤리가 떨어졌어요! (지도 확인)', 1400); continue; }
    if (e.t === 'durian_pickup') { SFX.durianPickup(); toast('🍈 두리안 획득! (' + e.count + '/3) — [C]키로 방귀 분출', 1600); continue; }
    if (e.t === 'durian_fart') {
      SFX.fart();
      for (var fci = 0; fci < 14; fci++) {
        var spreadA = e.a + (Math.random() - 0.5) * 1.6;
        var spd = 70 + Math.random() * 220;
        fartClouds.push({
          x: e.x + (Math.random() - 0.5) * 24,
          y: e.y + (Math.random() - 0.5) * 24,
          vx: Math.cos(spreadA) * spd,
          vy: Math.sin(spreadA) * spd,
          r: 20 + Math.random() * 16,
          maxR: 60 + Math.random() * 45,
          life: 1.2,
          maxLife: 1.2,
          rot: Math.random() * TAU,
          vrot: (Math.random() - 0.5) * 4
        });
      }
      toast('💨 뿌우웅! 방귀 발사! ' + (e.affected > 0 ? e.affected + '마리 10초간 30% 감속/질량감소 + 0.5초 기절!' : '적중 없음!'), 1800);
      continue;
    }
    if (e.t === 'durian_spawn') { if (G.player && G.player.alive) toast('🍈 두리안이 떨어졌어요! (지도 확인)', 1400); continue; }
    if (e.t === 'die') {
      var isMe = false, byMe = false;
      if (Net && Net.isOnline) {
        if (Net.isGuest) {
          isMe = !!(Net.myWormId && e.id === Net.myWormId);
          byMe = !!(Net.myWormId && e.by === Net.myWormId);
        } else if (Net.isHost) {
          isMe = !!(G.player && e.id === G.player.id);
          byMe = !!(G.player && e.by === G.player.id);
        }
      } else {
        isMe = !!e.player;
        byMe = !!e.byPlayer;
      }
      if (isMe) {
        match.killer = e.byName; match.cause = e.cause;
        SFX.die(); setMode('dying'); deathAt = rt; cam.follow = e.by || 0;
      } else if (byMe) {
        match.kills++; SFX.kill(); toast('🎯 「' + e.name + '」을(를) 잡았어요! (길이 ' + fmt(e.m) + ')', 2000);
        if (match.kills === 5 && SV.bestKills < 5) setTimeout(function () { toast('🐯 한 판 5마리! 「호랑이」 무늬가 열려요', 2200); }, 2100);
      } else if (G.player && G.player.alive) {
        var dx = e.x - G.player.x, dy = e.y - G.player.y;
        if (dx * dx + dy * dy < 700 * 700) SFX.pop(false);
      }
    }
  }
  ev.length = 0;
}

/* ── 화면 ── */
/* 휴대폰(짧은 변 500 미만)은 지렁이가 너무 작아 보여 조금 더 가까이 본다 */
function viewScale(r) { var half = 340 + (r - 7) * 11, mn = Math.min(W, H); return mn / (2 * half) * (Math.max(W, H) > 1000 ? 1.05 : mn < 500 ? 1.15 : 1); }
function render(g, dt) {
  X.setTransform(1, 0, 0, 1, 0, 0);
  X.fillStyle = '#060c08'; X.fillRect(0, 0, cv.width, cv.height);
  if (!g) return;
  var p = g.player, tx = cam.x, ty = cam.y, tr = 12;
  if (p && p.alive) { tx = p.x; ty = p.y; tr = p.r; }
  else if (g === G && cam.follow && g.byId[cam.follow]) { var kw = g.byId[cam.follow]; tx = kw.x; ty = kw.y; tr = kw.r; }
  else if (g === BG) { var top = g.worms[0]; for (var i = 1; i < g.worms.length; i++) if (g.worms[i].m > top.m) top = g.worms[i]; if (top) { if (cam.follow !== top.id) cam.follow = top.id; var tw = g.byId[cam.follow]; if (tw) { tx = tw.x; ty = tw.y; tr = tw.r; } } }
  if (p && p.alive && mode !== 'dying') { cam.x = tx; cam.y = ty; }
  else { var kk = Math.min(1, dt * 2.2); cam.x += (tx - cam.x) * kk; cam.y += (ty - cam.y) * kk; }
  var ts = viewScale(tr); cam.s += (ts - cam.s) * Math.min(1, dt * 2.5);
  var s = cam.s, k = DPR * s;
  var wx0 = cam.x - W / 2 / s, wy0 = cam.y - H / 2 / s, wx1 = cam.x + W / 2 / s, wy1 = cam.y + H / 2 / s, A = C.ARENA;
  X.setTransform(k, 0, 0, k, DPR * (W / 2 - cam.x * s), DPR * (H / 2 - cam.y * s));
  /* 바닥 */
  X.fillStyle = bgPat; X.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  /* 경기장 밖 어둡게 + 빨간 테두리 */
  if (Math.hypot(cam.x, cam.y) + Math.hypot(W, H) / s > A) {
    X.beginPath(); X.rect(wx0, wy0, wx1 - wx0, wy1 - wy0); X.arc(0, 0, A, 0, TAU, true);
    X.fillStyle = 'rgba(20,0,0,.72)'; X.fill();
    X.beginPath(); X.arc(0, 0, A, 0, TAU);
    X.lineWidth = 14; X.strokeStyle = 'rgba(255,60,60,.25)'; X.stroke();
    X.lineWidth = 5; X.strokeStyle = '#ff4d4d'; X.stroke();
  }
  /* 먹이 */
  var pad = 30, ox = g.ox, oy = g.oy, ov = g.ov, oa = g.oa, oc = g.oc, PAL = C.PALETTE, OC = C.ORB_CAP;
  for (i = 0; i < OC; i++) {
    if (!oa[i]) continue;
    var x = ox[i], y = oy[i];
    if (x < wx0 - pad || x > wx1 + pad || y < wy0 - pad || y > wy1 + pad) continue;
    var r = C.orbRadius(ov[i]) * (1 + 0.16 * Math.sin(rt * 4 + i * 1.7)) * 2.4;
    if (g.ok[i] === 1 && g.ol[i] < 6) X.globalAlpha = Math.max(0.1, g.ol[i] / 6);
    X.drawImage(orbSprite(PAL[oc[i]]), x - r, y - r, r * 2, r * 2);
    X.globalAlpha = 1;
  }
  /* 바나나 아이템 (100% 확대 + 반짝이 효과) */
  if (g.bananas && g.bananas.length) {
    for (i = 0; i < g.bananas.length; i++) {
      var bn = g.bananas[i];
      if (bn.x < wx0 - 70 || bn.x > wx1 + 70 || bn.y < wy0 - 70 || bn.y > wy1 + 70) continue;
      var byOff = Math.sin(rt * 4 + bn.id * 1.5) * 7;
      var bPulse = 1 + 0.1 * Math.sin(rt * 6 + bn.id);
      var bSize = 88 * bPulse;
      var bglowR = bSize * 0.7;

      /* 반짝이는 후광 & 별빛 */
      X.save();
      X.beginPath();
      X.arc(bn.x, bn.y + byOff, bglowR, 0, TAU);
      X.fillStyle = 'rgba(255, 230, 60, ' + (0.28 + 0.18 * Math.sin(rt * 8 + bn.id)) + ')';
      X.fill();
      var stA = rt * 3.5 + bn.id;
      for (var spk = 0; spk < 4; spk++) {
        var sa = stA + spk * (Math.PI / 2);
        var sx1 = bn.x + Math.cos(sa) * (bglowR * 1.08), sy1 = bn.y + byOff + Math.sin(sa) * (bglowR * 1.08);
        X.beginPath();
        X.arc(sx1, sy1, 4 + 2 * Math.sin(rt * 10 + spk), 0, TAU);
        X.fillStyle = 'rgba(255, 255, 180, 0.9)';
        X.fill();
      }
      X.restore();

      X.fillStyle = 'rgba(0,0,0,0.35)';
      X.beginPath();
      X.ellipse(bn.x, bn.y + 26, 30 * bPulse, 13 * bPulse, 0, 0, TAU);
      X.fill();
      X.drawImage(BANANA_SPRITE, bn.x - bSize / 2, bn.y - bSize / 2 + byOff, bSize, bSize);
    }
  }
  /* 사과젤리 아이템 (100% 확대 + 반짝이 효과) */
  if (g.appleJellies && g.appleJellies.length) {
    for (i = 0; i < g.appleJellies.length; i++) {
      var aj = g.appleJellies[i];
      if (aj.x < wx0 - 70 || aj.x > wx1 + 70 || aj.y < wy0 - 70 || aj.y > wy1 + 70) continue;
      var ayOff = Math.sin(rt * 4.5 + aj.id * 1.7) * 7;
      var aPulse = 1 + 0.1 * Math.sin(rt * 6 + aj.id);
      var aSize = 92 * aPulse;
      var aglowR = aSize * 0.7;

      /* 반짝이는 후광 & 별빛 */
      X.save();
      X.beginPath();
      X.arc(aj.x, aj.y + ayOff, aglowR, 0, TAU);
      X.fillStyle = 'rgba(255, 75, 95, ' + (0.28 + 0.18 * Math.sin(rt * 8.5 + aj.id)) + ')';
      X.fill();
      var astA = -rt * 3.5 + aj.id;
      for (var aspk = 0; aspk < 4; aspk++) {
        var asa = astA + aspk * (Math.PI / 2);
        var asx1 = aj.x + Math.cos(asa) * (aglowR * 1.08), asy1 = aj.y + ayOff + Math.sin(asa) * (aglowR * 1.08);
        X.beginPath();
        X.arc(asx1, asy1, 4 + 2 * Math.sin(rt * 10 + aspk), 0, TAU);
        X.fillStyle = 'rgba(255, 220, 220, 0.9)';
        X.fill();
      }
      X.restore();

      X.fillStyle = 'rgba(255, 71, 87, 0.35)';
      X.beginPath();
      X.ellipse(aj.x, aj.y + 25, 28 * aPulse, 12 * aPulse, 0, 0, TAU);
      X.fill();
      X.drawImage(APPLE_JELLY_SPRITE, aj.x - aSize / 2, aj.y - aSize / 2 + ayOff, aSize, aSize);
    }
  }
  /* 두리안 아이템 (100% 확대 + 반짝이 효과) */
  if (g.durians && g.durians.length) {
    for (i = 0; i < g.durians.length; i++) {
      var dr = g.durians[i];
      if (dr.x < wx0 - 70 || dr.x > wx1 + 70 || dr.y < wy0 - 70 || dr.y > wy1 + 70) continue;
      var dyOff = Math.sin(rt * 4.2 + dr.id * 1.6) * 7;
      var dPulse = 1 + 0.1 * Math.sin(rt * 6 + dr.id);
      var dSize = 100 * dPulse;
      var dglowR = dSize * 0.7;

      /* 반짝이는 후광 & 별빛 */
      X.save();
      X.beginPath();
      X.arc(dr.x, dr.y + dyOff, dglowR, 0, TAU);
      X.fillStyle = 'rgba(150, 225, 35, ' + (0.28 + 0.18 * Math.sin(rt * 8.2 + dr.id)) + ')';
      X.fill();
      var dstA = rt * 3.2 + dr.id;
      for (var dspk = 0; dspk < 4; dspk++) {
        var dsa = dstA + dspk * (Math.PI / 2);
        var dsx1 = dr.x + Math.cos(dsa) * (dglowR * 1.08), dsy1 = dr.y + dyOff + Math.sin(dsa) * (dglowR * 1.08);
        X.beginPath();
        X.arc(dsx1, dsy1, 4 + 2 * Math.sin(rt * 10 + dspk), 0, TAU);
        X.fillStyle = 'rgba(225, 255, 170, 0.9)';
        X.fill();
      }
      X.restore();

      X.fillStyle = 'rgba(70, 90, 15, 0.35)';
      X.beginPath();
      X.ellipse(dr.x, dr.y + 25, 30 * dPulse, 13 * dPulse, 0, 0, TAU);
      X.fill();
      X.drawImage(DURIAN_SPRITE, dr.x - dSize / 2, dr.y - dSize / 2 + dyOff, dSize, dSize);
    }
  }
  /* 바나나 충격파 이펙트 */
  for (i = shockwaves.length - 1; i >= 0; i--) {
    var sw = shockwaves[i];
    sw.life -= dt;
    if (sw.life <= 0) { shockwaves.splice(i, 1); continue; }
    var prog = 1 - sw.life / sw.maxLife;
    var cr = sw.maxR * Math.sqrt(prog);
    X.save();
    X.beginPath();
    X.arc(sw.x, sw.y, cr, 0, TAU);
    X.lineWidth = 14 * (1 - prog);
    X.strokeStyle = 'rgba(255, 230, 70, ' + (0.85 * (1 - prog)) + ')';
    X.stroke();
    X.fillStyle = 'rgba(255, 240, 100, ' + (0.12 * (1 - prog)) + ')';
    X.fill();
    X.restore();
  }
  /* 두리안 방귀 구름 이펙트 */
  for (i = fartClouds.length - 1; i >= 0; i--) {
    var fc = fartClouds[i];
    fc.life -= dt;
    if (fc.life <= 0) { fartClouds.splice(i, 1); continue; }
    fc.x += fc.vx * dt; fc.y += fc.vy * dt;
    fc.vx *= 0.94; fc.vy *= 0.94;
    fc.rot += fc.vrot * dt;
    var fProg = 1 - fc.life / fc.maxLife;
    var curR = fc.r + (fc.maxR - fc.r) * fProg;
    var fAlpha = Math.sin((1 - fProg) * Math.PI) * 0.52;
    X.save();
    X.translate(fc.x, fc.y);
    X.rotate(fc.rot);
    X.fillStyle = 'rgba(120, 185, 30, ' + fAlpha + ')';
    X.beginPath();
    X.arc(0, 0, curR, 0, TAU);
    X.fill();
    X.fillStyle = 'rgba(180, 220, 40, ' + (fAlpha * 0.75) + ')';
    X.beginPath();
    X.arc(curR * 0.25, -curR * 0.2, curR * 0.65, 0, TAU);
    X.fill();
    X.restore();
  }
  /* 지렁이: 작은 것부터 그려 큰 지렁이가 위로, 내 지렁이는 맨 위 */
  var ws = g.worms.slice().sort(function (a, b) { return a.m - b.m; });
  for (i = 0; i < ws.length; i++) if (ws[i] !== p) drawWorm(ws[i], wx0, wy0, wx1, wy1);
  if (p && p.alive) drawWorm(p, wx0, wy0, wx1, wy1);
  /* 이름표 (화면 좌표) */
  X.setTransform(DPR, 0, 0, DPR, 0, 0);
  X.textAlign = 'center'; X.textBaseline = 'bottom'; X.font = '700 12px "Noto Sans KR",sans-serif';
  for (i = 0; i < ws.length; i++) {
    var w = ws[i];
    if (w.x < wx0 || w.x > wx1 || w.y < wy0 || w.y > wy1) continue;
    var jhOff = w.jumpTimer > 0 ? -28 * Math.sin((1 - w.jumpTimer) * Math.PI) : 0;
    var sx = W / 2 + (w.x - cam.x) * s, sy = H / 2 + (w.y - cam.y + jhOff) * s - w.r * s - 8;
    var tName = w.name + (w.jumpTimer > 0 ? ' 🍎점프' : w.fartConfuseTimer > 0 ? ' 💫방귀혼란' : w.fartPoisonTimer > 0 ? ' 💨방귀독' : w.slowTimer > 0 ? ' (감속)' : '');
    X.fillStyle = 'rgba(0,0,0,.55)'; X.fillText(tName, sx + 1, sy + 1);
    X.fillStyle = w.jumpTimer > 0 ? '#ff6b81' : (w.fartConfuseTimer > 0 || w.fartPoisonTimer > 0) ? '#b5e853' : w.slowTimer > 0 ? '#66d9e8' : w === p ? '#ffe066' : 'rgba(255,255,255,.85)'; X.fillText(tName, sx, sy);
  }
  if (g === G && mode !== 'over') hud(g);
}
function drawWorm(w, wx0, wy0, wx1, wy1) {
  var n = w.n, r = w.r, sk = w.skin, sx = w.sx, sy = w.sy, m = r * 1.6;
  if (!sx) return;
  /* 화면 밖이면 건너뛴다(머리와 몸 길이로 대강) */
  var L = w.len + r;
  if (w.x + L < wx0 || w.x - L > wx1 || w.y + L < wy0 || w.y - L > wy1) return;
  var stepI = perf.q >= 2 && n > 30 ? 2 : 1, i, x, y, rr;

  var isJumping = w.jumpTimer > 0;
  var jArc = isJumping ? Math.sin((1 - w.jumpTimer) * Math.PI) : 0;
  var jScale = 1 + 0.35 * jArc;
  var jOffY = -28 * jArc;

  /* 점프 중 분리된 바닥 그림자 */
  if (isJumping) {
    X.save();
    X.fillStyle = 'rgba(0,0,0,' + (0.35 * (1 - jArc * 0.45)) + ')';
    for (i = n - 1; i >= 0; i -= (perf.q >= 2 ? 3 : 2)) {
      x = sx[i]; y = sy[i];
      if (x < wx0 - m || x > wx1 + m || y < wy0 - m || y > wy1 + m) continue;
      var sr = r * (0.85 - jArc * 0.2);
      X.beginPath();
      X.ellipse(x, y + 8, sr * 1.4, sr * 0.7, 0, 0, TAU);
      X.fill();
    }
    X.restore();
  }

  /* 착지 무적 깜빡임 이펙트 */
  if (w.landImmune > 0) {
    X.globalAlpha = 0.55 + 0.45 * Math.sin(rt * 36);
  }

  if (w.boosting && perf.q < 2) {
    X.globalAlpha = 0.55 + 0.25 * Math.sin(rt * 20);
    for (i = n - 1; i >= 0; i -= 2) {
      x = sx[i]; y = sy[i] + jOffY;
      if (x < wx0 - m || x > wx1 + m || y < wy0 - m || y > wy1 + m) continue;
      rr = r * 1.9 * jScale;
      X.drawImage(GLOW, x - rr, y - rr, rr * 2, rr * 2);
    }
    X.globalAlpha = 1;
  }
  if (w.slowTimer > 0) {
    X.save();
    X.globalAlpha = 0.38 + 0.18 * Math.sin(rt * 12);
    for (i = n - 1; i >= 0; i -= 2) {
      x = sx[i]; y = sy[i] + jOffY;
      if (x < wx0 - m || x > wx1 + m || y < wy0 - m || y > wy1 + m) continue;
      rr = r * 1.6 * jScale;
      X.fillStyle = '#38d9a9';
      X.beginPath(); X.arc(x, y, rr, 0, TAU); X.fill();
    }
    X.restore();
  }
  if (w.fartPoisonTimer > 0) {
    X.save();
    X.globalAlpha = 0.4 + 0.2 * Math.sin(rt * 14);
    for (i = n - 1; i >= 0; i -= 2) {
      x = sx[i]; y = sy[i] + jOffY;
      if (x < wx0 - m || x > wx1 + m || y < wy0 - m || y > wy1 + m) continue;
      rr = r * 1.5 * jScale;
      X.fillStyle = '#70b81e';
      X.beginPath(); X.arc(x, y, rr, 0, TAU); X.fill();
    }
    X.restore();
  }
  var start = n - 1;
  if (stepI === 2 && (start & 1)) start--;
  for (i = start; i >= 0; i -= stepI) {
    x = sx[i]; y = sy[i] + jOffY;
    if (x < wx0 - m || x > wx1 + m || y < wy0 - m || y > wy1 + m) continue;
    rr = r * (i > n - 6 ? 0.55 + (n - i) * 0.075 : 1) * jScale;
    X.drawImage(segSprite(segCol(sk, i, rt)), x - rr, y - rr, rr * 2, rr * 2);
    if (sk.dot && i % 3 === 1) { var dr = r * 0.32 * jScale; X.drawImage(dotSprite(sk.dot), x - dr + r * 0.2 * jScale, y - dr - r * 0.15 * jScale, dr * 2, dr * 2); }
  }
  /* 눈 */
  var hx = w.x, hy = w.y + jOffY, ca = Math.cos(w.a), sa = Math.sin(w.a), px = -sa, py = ca, er = r * 0.36 * jScale, pr = r * 0.2 * jScale, la = w.ta;
  var lx = Math.cos(la) * r * 0.13 * jScale, ly = Math.sin(la) * r * 0.13 * jScale;
  X.fillStyle = '#fff';
  X.beginPath(); X.arc(hx + (ca * r * 0.25 + px * r * 0.45) * jScale, hy + (sa * r * 0.25 + py * r * 0.45) * jScale, er, 0, TAU); X.arc(hx + (ca * r * 0.25 - px * r * 0.45) * jScale, hy + (sa * r * 0.25 - py * r * 0.45) * jScale, er, 0, TAU); X.fill();
  X.fillStyle = '#141414';
  X.beginPath(); X.arc(hx + (ca * r * 0.25 + px * r * 0.45) * jScale + lx, hy + (sa * r * 0.25 + py * r * 0.45) * jScale + ly, pr, 0, TAU); X.arc(hx + (ca * r * 0.25 - px * r * 0.45) * jScale + lx, hy + (sa * r * 0.25 - py * r * 0.45) * jScale + ly, pr, 0, TAU); X.fill();

  /* 점프 중 궤적 이펙트 */
  if (isJumping && perf.q < 2) {
    X.save();
    X.beginPath();
    X.arc(hx, hy, r * 1.3 * jScale, 0, TAU);
    X.lineWidth = 3;
    X.strokeStyle = 'rgba(255, 255, 255, ' + (0.6 * jArc) + ')';
    X.stroke();
    X.restore();
  }

  /* 방귀 피격 혼란 이펙트 (머리 주위 빙글빙글 별) */
  if (w.fartConfuseTimer > 0) {
    X.save();
    var dRot = rt * 14;
    for (var si = 0; si < 3; si++) {
      var san = dRot + (si / 3) * TAU;
      var starX = hx + Math.cos(san) * (r * 1.5 + 4);
      var starY = hy + Math.sin(san) * (r * 0.9 + 4);
      X.font = '900 13px sans-serif';
      X.textAlign = 'center';
      X.textBaseline = 'middle';
      X.fillText('💫', starX, starY);
    }
    X.restore();
  }

  X.globalAlpha = 1;
}
function hud(g) {
  var p = g.player, rk = C.ranking(g), my = p ? rk.indexOf(p) + 1 : 0, small = W < 420;
  X.setTransform(DPR, 0, 0, DPR, 0, 0);
  X.textBaseline = 'alphabetic';
  if (Net && Net.isOnline) {
    X.textAlign = 'left';
    X.font = '800 13px "Noto Sans KR",sans-serif';
    X.fillStyle = '#66d9e8';
    X.fillText('🌐 온라인 대전 (방: ' + Net.roomCode + ' · ' + Net.getPlayerCount() + '명)', 10, 52);
  }
  /* 내 길이·순위 */
  if (p && p.alive) {
    X.textAlign = 'left';
    X.font = '900 ' + (small ? 22 : 26) + 'px "Noto Sans KR",sans-serif';
    X.fillStyle = 'rgba(0,0,0,.5)'; X.fillText('길이 ' + fmt(p.m), 11, 77);
    X.fillStyle = '#fff'; X.fillText('길이 ' + fmt(p.m), 10, 76);
    X.font = '700 12px "Noto Sans KR",sans-serif'; X.fillStyle = '#cfe3d4';
    X.fillText('순위 ' + my + ' / ' + rk.length + ' · 처치 ' + match.kills + (match.mode === 'time' && match.best > p.m + 1 ? ' · 최고 ' + fmt(match.best) : ''), 10, 94);
    /* 바나나 보유 개수 표시 */
    var bcnt = p.bananas || 0;
    X.font = '800 12px "Noto Sans KR",sans-serif';
    X.fillStyle = bcnt > 0 ? '#ffe066' : '#a7c4ae';
    var bText = '🍌 ' + bcnt + '/3' + (bcnt > 0 ? (touchUI ? ' (🍌버튼 터치)' : ' [F키 감속]') : ' (15초마다)');
    X.fillText(bText, 10, g.limit ? 156 : 112);

    /* 사과젤리 보유 개수 표시 */
    var jcnt = p.appleJellies || 0;
    X.fillStyle = jcnt > 0 ? '#ff6b81' : '#a7c4ae';
    var jText = '🍎 ' + jcnt + '/3' + (jcnt > 0 ? (touchUI ? ' (🍎버튼 터치)' : ' [Space 점프]') : ' (30초마다)');
    X.fillText(jText, 10, g.limit ? 172 : 128);

    /* 두리안 보유 개수 표시 */
    var dcnt = p.durians || 0;
    X.fillStyle = dcnt > 0 ? '#b5e853' : '#a7c4ae';
    var dText = '🍈 ' + dcnt + '/3' + (dcnt > 0 ? (touchUI ? ' (두리안버튼 터치)' : ' [C키 방귀]') : ' (30초마다)');
    X.fillText(dText, 10, g.limit ? 188 : 144);
    if (my && my < match.maxRank) match.maxRank = my;
  } else if (Net && Net.isOnline && (!p || !p.alive)) {
    X.textAlign = 'center';
    X.font = '700 15px "Noto Sans KR",sans-serif';
    X.fillStyle = '#ffe066';
    X.fillText('지렁이 준비 중…', W / 2, 70);
  }
  /* 남은 시간(시간 모드) — 위 가운데, 순위표와 겹치지 않게 왼쪽 글자 아래 */
  if (g.limit) {
    var left = g.limit - g.tick * STEP, warn = left < 20;
    X.textAlign = 'left'; X.font = '900 ' + (small ? 18 : 22) + 'px "Noto Sans KR",sans-serif';
    var tl = '⏱ ' + fmtT(left);
    X.fillStyle = 'rgba(0,0,0,.5)'; X.fillText(tl, 11, 121);
    X.fillStyle = warn ? (Math.floor(rt * 4) % 2 ? '#ff6b6b' : '#ffe066') : '#ffe066'; X.fillText(tl, 10, 120);
    if (match.mode === 'daily' && match.rule) { X.font = '700 11px "Noto Sans KR",sans-serif'; X.fillStyle = '#cfe3d4'; X.fillText('📅 ' + match.rule.name, 10, 138); }
  }
  /* 이번 판 순위표 */
  var bw = small ? 148 : 178, rows = Math.min(10, rk.length), lh = small ? 15 : 17, bx = W - bw - 8, by = 8;
  X.fillStyle = 'rgba(0,0,0,.35)'; roundRect(bx, by, bw, 22 + rows * lh + (my > 10 ? lh : 0) + 6, 10); X.fill();
  X.font = '900 12px "Noto Sans KR",sans-serif'; X.fillStyle = '#ffe066'; X.textAlign = 'left'; X.fillText('🏆 이번 판 순위', bx + 8, by + 16);
  X.font = '700 ' + (small ? 11 : 12) + 'px "Noto Sans KR",sans-serif';
  for (var i = 0; i < rows; i++) row(i + 1, rk[i], by + 22 + (i + 1) * lh - 3);
  if (my > 10 && p) row(my, p, by + 22 + 11 * lh - 3);
  function row(n, w, y) {
    if (!w) return;
    X.fillStyle = w === p ? '#ffe066' : 'rgba(255,255,255,.82)';
    X.textAlign = 'left'; var nm = w.name.length > 7 ? w.name.slice(0, 7) + '…' : w.name;
    X.fillText(n + '. ' + nm, bx + 8, y);
    X.textAlign = 'right'; X.fillText(fmt(w.m), bx + bw - 8, y);
  }
  /* 지도 — 왼쪽 상단 아이템(바나나, 사과, 두리안) 바로 아래로 배치 (세로, 가로모드 동일) */
  var mr = (W > H ? Math.min(36, Math.max(30, H * 0.095)) : Math.max(34, Math.min(46, Math.min(W, H) * 0.11)));
  var mx = mr + 12;
  var itemsBottomY = (p && p.alive) ? ((g.limit ? 188 : 144) + 12) : 70;
  var my2 = itemsBottomY + mr + 8;
  var A = C.ARENA, ks = mr / A;
  X.beginPath(); X.arc(mx, my2, mr, 0, TAU); X.fillStyle = 'rgba(0,0,0,.45)'; X.fill(); X.lineWidth = 2; X.strokeStyle = 'rgba(255,90,90,.6)'; X.stroke();
  X.textAlign = 'center';
  X.textBaseline = 'middle';

  /* 바나나 위치 미니맵 표시 (100% 확대 + 반짝이는 펄스 레이더) */
  if (g.bananas && g.bananas.length) {
    for (i = 0; i < g.bananas.length; i++) {
      var bn = g.bananas[i];
      var bmx = mx + bn.x * ks, bmy = my2 + bn.y * ks;
      var bping = (rt * 2.4 + bn.id * 0.7) % 1;
      X.beginPath();
      X.arc(bmx, bmy, 6 + bping * 20, 0, TAU);
      X.strokeStyle = 'rgba(255, 230, 50, ' + ((1 - bping) * 0.85) + ')';
      X.lineWidth = 2;
      X.stroke();
      X.beginPath();
      X.arc(bmx, bmy, 10, 0, TAU);
      X.fillStyle = 'rgba(255, 220, 50, ' + (0.35 + 0.25 * Math.sin(rt * 10 + bn.id)) + ')';
      X.fill();
      var bp = 1 + 0.18 * Math.sin(rt * 8 + bn.id);
      X.font = Math.round(24 * bp) + 'px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      X.fillText('🍌', bmx, bmy);
    }
  }

  /* 사과젤리 위치 미니맵 표시 (100% 확대 + 반짝이는 펄스 레이더) */
  if (g.appleJellies && g.appleJellies.length) {
    for (i = 0; i < g.appleJellies.length; i++) {
      var aj = g.appleJellies[i];
      var amx = mx + aj.x * ks, amy = my2 + aj.y * ks;
      var aping = (rt * 2.4 + aj.id * 0.7) % 1;
      X.beginPath();
      X.arc(amx, amy, 6 + aping * 20, 0, TAU);
      X.strokeStyle = 'rgba(255, 75, 95, ' + ((1 - aping) * 0.85) + ')';
      X.lineWidth = 2;
      X.stroke();
      X.beginPath();
      X.arc(amx, amy, 10, 0, TAU);
      X.fillStyle = 'rgba(255, 70, 90, ' + (0.35 + 0.25 * Math.sin(rt * 10 + aj.id)) + ')';
      X.fill();
      var ap = 1 + 0.18 * Math.sin(rt * 9 + aj.id);
      X.font = Math.round(24 * ap) + 'px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      X.fillText('🍎', amx, amy);
    }
  }

  /* 두리안 위치 미니맵 표시 (100% 확대 + 반짝이는 펄스 레이더) */
  if (g.durians && g.durians.length) {
    for (i = 0; i < g.durians.length; i++) {
      var dr = g.durians[i];
      var dmx = mx + dr.x * ks, dmy = my2 + dr.y * ks;
      var dping = (rt * 2.4 + dr.id * 0.7) % 1;
      X.beginPath();
      X.arc(dmx, dmy, 6 + dping * 20, 0, TAU);
      X.strokeStyle = 'rgba(160, 230, 40, ' + ((1 - dping) * 0.85) + ')';
      X.lineWidth = 2;
      X.stroke();
      X.beginPath();
      X.arc(dmx, dmy, 10, 0, TAU);
      X.fillStyle = 'rgba(160, 230, 40, ' + (0.35 + 0.25 * Math.sin(rt * 10 + dr.id)) + ')';
      X.fill();
      var dp = 1 + 0.18 * Math.sin(rt * 8 + dr.id);
      var dIconSize = 28 * dp;
      X.drawImage(DURIAN_SPRITE, dmx - dIconSize / 2, dmy - dIconSize / 2, dIconSize, dIconSize);
    }
  }

  /* 상대 지렁이 미니맵 표시 (플레이어 고유 색상 점 및 꼬리) */
  for (i = 0; i < rk.length; i++) {
    var w = rk[i]; if (w === p) continue;
    var wcol = w.skin ? segCol(w.skin, 0, rt) : '#4dabf7';
    var wmx = mx + w.x * ks, wmy = my2 + w.y * ks;
    if (w.sx && w.sy && w.n > 4) {
      X.fillStyle = wcol;
      var stepK = Math.max(2, Math.floor(w.n / 3));
      for (var si = Math.min(w.n - 1, stepK * 2); si >= stepK; si -= stepK) {
        var tsx = mx + w.sx[si] * ks, tsy = my2 + w.sy[si] * ks;
        X.beginPath();
        X.arc(tsx, tsy, 2, 0, TAU);
        X.fill();
      }
    }
    var wSize = 3.5 + Math.min(2.5, w.r / 12);
    X.beginPath();
    X.arc(wmx, wmy, wSize, 0, TAU);
    X.fillStyle = wcol;
    X.fill();
    X.lineWidth = 1;
    X.strokeStyle = 'rgba(0,0,0,0.65)';
    X.stroke();
  }

  /* 내 지렁이 미니맵 표시 (내 플레이어 색상 + 눈에 띄는 펄스 링) */
  if (p && p.alive) {
    var pcol = p.skin ? segCol(p.skin, 0, rt) : '#ffe066';
    var pmx = mx + p.x * ks, pmy = my2 + p.y * ks;
    if (p.sx && p.sy && p.n > 4) {
      X.fillStyle = pcol;
      var pstepK = Math.max(2, Math.floor(p.n / 4));
      for (var psi = Math.min(p.n - 1, pstepK * 3); psi >= pstepK; psi -= pstepK) {
        var ptsX = mx + p.sx[psi] * ks, ptsY = my2 + p.sy[psi] * ks;
        X.beginPath();
        X.arc(ptsX, ptsY, 2.5, 0, TAU);
        X.fill();
      }
    }
    var pPulse = 1 + 0.25 * Math.sin(rt * 8);
    var pHeadR = 5.5 * pPulse;
    X.beginPath();
    X.arc(pmx, pmy, pHeadR + 4, 0, TAU);
    X.fillStyle = 'rgba(255, 255, 255, 0.35)';
    X.fill();
    X.lineWidth = 1.5;
    X.strokeStyle = '#ffffff';
    X.stroke();

    X.beginPath();
    X.arc(pmx, pmy, pHeadR, 0, TAU);
    X.fillStyle = pcol;
    X.fill();
    X.lineWidth = 2;
    X.strokeStyle = '#ffffff';
    X.stroke();
  }
  /* 부스트 버튼 & 바나나 버튼·조이스틱 */
  if (touchUI && p && p.alive && mode === 'play') {
    var bb = boostBtn(), on = p.boosting, can = p.m >= C.MIN_BOOST;
    X.beginPath(); X.arc(bb.x, bb.y, bb.r, 0, TAU);
    X.fillStyle = on ? 'rgba(255,224,102,.55)' : can ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.06)'; X.fill();
    X.lineWidth = 3; X.strokeStyle = on ? '#ffe066' : 'rgba(255,255,255,.45)'; X.stroke();
    X.textAlign = 'center'; X.textBaseline = 'middle'; X.font = '900 ' + Math.round(bb.r * 0.75) + 'px sans-serif'; X.fillStyle = can ? '#fff' : 'rgba(255,255,255,.4)'; X.fillText('⚡', bb.x, bb.y + 1);

    /* 모바일 바나나 버튼 */
    var bnb = bananaBtn(), hasB = (p.bananas || 0) > 0;
    X.beginPath(); X.arc(bnb.x, bnb.y, bnb.r, 0, TAU);
    X.fillStyle = hasB ? 'rgba(255,224,102,.38)' : 'rgba(255,255,255,.06)'; X.fill();
    X.lineWidth = 3; X.strokeStyle = hasB ? '#ffe066' : 'rgba(255,255,255,.3)'; X.stroke();
    X.textAlign = 'center'; X.textBaseline = 'middle'; X.font = '900 ' + Math.round(bnb.r * 0.65) + 'px sans-serif'; X.fillText('🍌', bnb.x, bnb.y + 1);
    if (hasB) {
      X.font = '900 12px sans-serif';
      X.beginPath(); X.arc(bnb.x + bnb.r * 0.6, bnb.y - bnb.r * 0.6, 9, 0, TAU); X.fillStyle = '#ffe066'; X.fill();
      X.fillStyle = '#102a12'; X.fillText(p.bananas, bnb.x + bnb.r * 0.6, bnb.y - bnb.r * 0.6);
    }

    /* 모바일 사과젤리 버튼 */
    var ajb = appleJellyBtn(), hasJ = (p.appleJellies || 0) > 0;
    X.beginPath(); X.arc(ajb.x, ajb.y, ajb.r, 0, TAU);
    X.fillStyle = hasJ ? 'rgba(255,71,87,.42)' : 'rgba(255,255,255,.06)'; X.fill();
    X.lineWidth = 3; X.strokeStyle = hasJ ? '#ff6b81' : 'rgba(255,255,255,.3)'; X.stroke();
    X.textAlign = 'center'; X.textBaseline = 'middle'; X.font = '900 ' + Math.round(ajb.r * 0.65) + 'px sans-serif'; X.fillText('🍎', ajb.x, ajb.y + 1);
    if (hasJ) {
      X.font = '900 12px sans-serif';
      X.beginPath(); X.arc(ajb.x + ajb.r * 0.6, ajb.y - ajb.r * 0.6, 9, 0, TAU); X.fillStyle = '#ff4757'; X.fill();
      X.fillStyle = '#ffffff'; X.fillText(p.appleJellies, ajb.x + ajb.r * 0.6, ajb.y - ajb.r * 0.6);
    }

    /* 모바일 두리안 버튼 */
    var drb = durianBtn(), hasD = (p.durians || 0) > 0;
    X.beginPath(); X.arc(drb.x, drb.y, drb.r, 0, TAU);
    X.fillStyle = hasD ? 'rgba(140,190,30,.42)' : 'rgba(255,255,255,.06)'; X.fill();
    X.lineWidth = 3; X.strokeStyle = hasD ? '#b5e853' : 'rgba(255,255,255,.3)'; X.stroke();
    var drIconSize = drb.r * 1.35;
    X.drawImage(DURIAN_SPRITE, drb.x - drIconSize / 2, drb.y - drIconSize / 2, drIconSize, drIconSize);
    if (hasD) {
      X.font = '900 12px sans-serif';
      X.beginPath(); X.arc(drb.x + drb.r * 0.6, drb.y - drb.r * 0.6, 9, 0, TAU); X.fillStyle = '#b5e853'; X.fill();
      X.fillStyle = '#1b3005'; X.fillText(p.durians, drb.x + drb.r * 0.6, drb.y - drb.r * 0.6);
    }
    X.textBaseline = 'alphabetic';
  }

  /* ── 좌측 하단 상하좌우 조이스틱 ── */
  var showJoystick = (touchUI || window.innerWidth <= 1024 || SV.ctrl === 'stick');
  if (showJoystick && p && p.alive && mode === 'play') {
    var joy = joystickPos();
    var jx = joy.x, jy = joy.y, jr = joy.r;

    var steerTouch = null;
    for (var k in ptrs) {
      if (ptrs[k].role === 'steer') {
        steerTouch = ptrs[k];
        break;
      }
    }
    if (!steerTouch && mouse.down && mouse.onJoy) {
      steerTouch = { x: mouse.x, y: mouse.y };
    }

    var knobX = jx, knobY = jy;
    var isJoyActive = false;
    var activeA = null;

    if (steerTouch) {
      var dx = steerTouch.x - jx, dy = steerTouch.y - jy;
      var d = Math.hypot(dx, dy);
      var maxD = jr * 0.72;
      if (d > 5) {
        isJoyActive = true;
        activeA = Math.atan2(dy, dx);
        var clampedD = Math.min(d, maxD);
        knobX = jx + (dx / d) * clampedD;
        knobY = jy + (dy / d) * clampedD;
      }
    } else if (p && p.alive && (keys.arrowleft || keys.arrowright || keys.arrowup || keys.arrowdown || keys.a || keys.d || keys.w || keys.s)) {
      var curA = G.input.a;
      isJoyActive = true;
      activeA = curA;
      knobX = jx + Math.cos(curA) * (jr * 0.45);
      knobY = jy + Math.sin(curA) * (jr * 0.45);
    }

    var isRightActive = false, isDownActive = false, isLeftActive = false, isUpActive = false;
    if (isJoyActive && activeA !== null) {
      isRightActive = (activeA >= -Math.PI / 4 && activeA <= Math.PI / 4);
      isDownActive = (activeA > Math.PI / 4 && activeA < 3 * Math.PI / 4);
      isUpActive = (activeA < -Math.PI / 4 && activeA > -3 * Math.PI / 4);
      isLeftActive = (activeA >= 3 * Math.PI / 4 || activeA <= -3 * Math.PI / 4);
    }

    X.save();

    // 1. 조이스틱 베이스 외곽 원
    X.beginPath();
    X.arc(jx, jy, jr, 0, TAU);
    X.fillStyle = 'rgba(12, 23, 18, 0.58)';
    X.fill();
    X.lineWidth = 2.5;
    X.strokeStyle = isJoyActive ? 'rgba(255, 224, 102, 0.75)' : 'rgba(255, 255, 255, 0.3)';
    X.stroke();

    // 2. 내부 안내 원 & 십자 가이드라인
    X.beginPath();
    X.arc(jx, jy, jr * 0.52, 0, TAU);
    X.lineWidth = 1.5;
    X.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    X.stroke();

    X.beginPath();
    X.moveTo(jx - jr * 0.85, jy); X.lineTo(jx + jr * 0.85, jy);
    X.moveTo(jx, jy - jr * 0.85); X.lineTo(jx, jy + jr * 0.85);
    X.lineWidth = 1;
    X.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    X.stroke();

    // 3. 상하좌우 (▲ ▼ ◀ ▶) 방향 화살표
    var arrowD = jr * 0.72;
    var arrowSz = Math.round(jr * 0.28);
    X.font = '900 ' + arrowSz + 'px sans-serif';
    X.textAlign = 'center';
    X.textBaseline = 'middle';

    // ▲ 상
    X.fillStyle = isUpActive ? '#ffe066' : 'rgba(255, 255, 255, 0.45)';
    X.fillText('▲', jx, jy - arrowD);

    // ▼ 하
    X.fillStyle = isDownActive ? '#ffe066' : 'rgba(255, 255, 255, 0.45)';
    X.fillText('▼', jx, jy + arrowD);

    // ◀ 좌
    X.fillStyle = isLeftActive ? '#ffe066' : 'rgba(255, 255, 255, 0.45)';
    X.fillText('◀', jx - arrowD, jy);

    // ▶ 우
    X.fillStyle = isRightActive ? '#ffe066' : 'rgba(255, 255, 255, 0.45)';
    X.fillText('▶', jx + arrowD, jy);

    // 4. 스틱 줄기 연결선
    if (isJoyActive && (knobX !== jx || knobY !== jy)) {
      X.beginPath();
      X.moveTo(jx, jy);
      X.lineTo(knobX, knobY);
      X.lineWidth = 4;
      X.strokeStyle = 'rgba(255, 224, 102, 0.5)';
      X.stroke();
    }

    // 5. 조이스틱 조작 노브 (손잡이)
    var knobR = jr * 0.38;
    X.beginPath();
    X.arc(knobX, knobY, knobR, 0, TAU);
    X.fillStyle = isJoyActive ? 'rgba(255, 224, 102, 0.65)' : 'rgba(255, 255, 255, 0.32)';
    X.fill();
    X.lineWidth = 2.5;
    X.strokeStyle = isJoyActive ? '#ffe066' : 'rgba(255, 255, 255, 0.85)';
    X.stroke();

    // 노브 중앙 도트
    X.beginPath();
    X.arc(knobX, knobY, knobR * 0.32, 0, TAU);
    X.fillStyle = isJoyActive ? '#ffe066' : 'rgba(255, 255, 255, 0.65)';
    X.fill();

    X.restore();
  }
}
function roundRect(x, y, w, h, r) { X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r); X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath(); }

/* ── 프레임 ── */
function adapt(dt) {
  perf.frames++;
  var now = performance.now();
  if (now - perf.t0 >= 1000) { perf.fps = perf.frames * 1000 / (now - perf.t0); perf.frames = 0; perf.t0 = now; }
  perf.ms += (dt * 1000 - perf.ms) * 0.05;
  if (mode !== 'play') return;
  perf.win += dt; perf.winN++;
  if (perf.win >= 1.5 && perf.winN >= 10) {   // 1.5초마다 평균 프레임 간격을 본다
    var avg = perf.win / perf.winN * 1000;
    perf.win = 0; perf.winN = 0;
    if (avg > 21) perf.slow += avg > 40 ? 2 : 1; else perf.slow = 0;
    if (perf.slow >= 2 && perf.q < 3) {
      perf.q++; perf.slow = 0; SV.q = Math.min(2, perf.q); save();
      C.setQuality(G, perf.q); resize();
    }
  }
}
function frame(now) {
  var dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; rt += dt;
  adapt(dt);
  var g = mode === 'title' ? BG : G;
  var t1 = performance.now();
  if (g && mode !== 'pause') {
    acc += dt;
    var n = 0;
    while (acc >= STEP && n < 5) {
      if (mode === 'play') applyInput();
      if (!Net || !Net.isGuest) {
        C.step(g);
      }
      acc -= STEP; n++;
      if (g === G) handleEvents(g);
    }
    if (n >= 5) acc = 0;
    if (g === BG) g.ev.length = 0;
    if (Net && Net.isHost && G && (G.tick % 2 === 0)) {
      Net.broadcastSnapshot(C.serializeSnapshot(G));
    }
    if (mode === 'play' && G && G.player && G.player.alive) { setBoostSound(G.player.boosting); liveBest(G.player.maxM); if (G.player.maxM > match.best) match.best = G.player.maxM; }
    if (mode === 'play' && G && G.done) { SFX.unlock(); endMatch(); }
    else if (mode === 'dying' && (G.done || rt - deathAt > 1.4)) {
      if (Net && Net.isOnline) {
        endMatch();
      } else if (C.MODES[match.mode].respawn && !G.done) {
        respawn();
      } else {
        endMatch();
      }
    }
  }
  var t2 = performance.now();
  render(g, dt);
  var t3 = performance.now();
  perf.sim += (t2 - t1 - perf.sim) * 0.05; perf.draw += (t3 - t2 - perf.draw) * 0.05;
  if (perf.burn) { var bz = performance.now() + perf.burn; while (performance.now() < bz) {} }   // 시험용: 일부러 느린 기기 흉내
  requestAnimationFrame(frame);
}

/* 자동 시험용 창구 (게임 진행에는 영향 없음 — 시험 스크립트만 쓴다) */
window.__wm = {
  state: function () {
    var p = G && G.player;
    return { mode: mode, alive: !!(p && p.alive), m: p ? p.m : 0, maxM: p ? p.maxM : 0, kills: p ? p.kills : 0, x: p ? p.x : 0, y: p ? p.y : 0, a: p ? p.a : 0, ia: G ? G.input.a : 0, boost: !!(G && G.input.boost), boosting: !!(p && p.boosting),
      bots: G ? G.worms.filter(function (w) { return w.ai; }).length : 0, orbs: G ? G.orbs : 0, tick: G ? G.tick : 0, best: SV.best, skin: SV.skin, unlocked: C.unlockedRec(rec(SV)), posted: !!(match && match.posted), q: perf.q, W: W, H: H, touch: touchUI, ctrl: SV.ctrl,
      smode: SV.mode, gmode: match ? match.mode : '', limit: G ? G.limit : 0, left: G && G.limit ? G.limit - G.tick * STEP : 0, lives: match ? match.lives : 0, score: match ? Math.floor(match.best) : 0, mkills: match ? match.kills : 0, day: kstDay(), tbest: SV.tbest, dDays: SV.dDays, games: SV.games, pid: G && G.player ? G.player.id : 0 };
  },
  /* 시간 모드 시험: 남은 시간을 sec 초로 당긴다 */
  skipTo: function (sec) { if (G && G.limit) { var t = Math.max(0, Math.round((G.limit - sec) / STEP)); match.real0 -= (t - G.tick) * STEP * 1000; G.tick = t; } },
  firstWorm: function () { return G ? G.worms.filter(function (w) { return w.ai; }).map(function (w) { return w.name + ':' + Math.round(w.m); }).slice(0, 5).join(',') : ''; },
  nearestOrb: function () {
    var p = G && G.player; if (!p || !p.alive) return null;
    var best = -1, bd = 1e18;
    for (var i = 0; i < C.ORB_CAP; i++) { if (!G.oa[i]) continue; var dx = G.ox[i] - p.x, dy = G.oy[i] - p.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    if (best < 0) return null;
    return { x: W / 2 + (G.ox[best] - p.x) * cam.s, y: H / 2 + (G.oy[best] - p.y) * cam.s, d: Math.sqrt(bd) };
  },
  danger: function () { var p = G && G.player; if (!p || !p.alive) return 0; return C.hitAt(G, p.x + Math.cos(p.a) * 60, p.y + Math.sin(p.a) * 60, p.r + 30, p.id, 1, 1) >= 0 ? 1 : 0; },
  teleport: function (x, y, a) { var p = G.player; C.placeWorm(p, x, y, a); G.input.a = a; },
  grow: function (dm) { C.grow(G.player, dm); },
  shield: function () { /* 시험 중 남의 지렁이를 내 반대편으로 멀리 치운다 */
    var p = G.player, d = Math.hypot(p.x, p.y), ux = d > 50 ? -p.x / d : 1, uy = d > 50 ? -p.y / d : 0, k = 0;
    G.worms.forEach(function (w) { if (!w.ai) return; var cx = ux * 1700 + ((k % 5) - 2) * 170, cy = uy * 1700 + (((k / 5) | 0) - 2) * 170; k++; C.placeWorm(w, cx, cy, Math.atan2(uy, ux)); });
    C.buildGrid(G);
  },
  perf: function () { return { fps: perf.fps, ms: perf.ms, sim: perf.sim, draw: perf.draw, q: perf.q, dpr: DPR }; },
  burn: function (ms) { perf.burn = ms; },
  setQ: function (q) { perf.q = q; if (G) C.setQuality(G, q); resize(); }
};

setMute(SV.mute);
resize();
newBG();
showTitle();
if (initialRoomCode) {
  setTimeout(function () {
    toast('🌐 초대 링크로 접속했습니다! [참가]를 눌러 게임에 입장하세요.', 3500);
  }, 400);
}
requestAnimationFrame(frame);
})();
