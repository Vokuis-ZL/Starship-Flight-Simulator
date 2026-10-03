/* ============================================================
   STARSHIP FLIGHT 14 — 渲染模块 (RENDER)
   全局普通脚本，禁止 import/export。只读 state（PHYS.state），
   内部维护：相机平滑跟随 / 粒子系统(上限600,池化复用) / 屏幕震动 /
   星空缓存 / 机械臂合拢动画 / 爆炸与捕获特效。
   整合者每帧调用 RENDER.draw(PHYS.state, dtReal)。
   本模块不使用 requestAnimationFrame，不依赖 PHYS/UI。
   ============================================================ */
(function(){
'use strict';
const RENDER = {};

/* ---------------- 基础 ---------------- */
let cv = null, ctx = null, W = 0, H = 0, dpr = 1;
let tR = 0;                          // 真实时间累计(秒)，用于闪烁/星空微动

const RAD = Math.PI / 180;
function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
function mix(a, b, t){ return a + (b - a) * t; }
function rnd(a, b){ return a + Math.random() * (b - a); }

/* ---------------- 相机 ---------------- */
let camX = 0, camY = 70, ppm = 1.6, camInit = false;
const CAM_BIAS = 70;                 // 契约外自定：镜头高度偏置，让载具略低于屏幕中心、地面构图更好
function sxOf(x){ return W / 2 + (x - camX) * ppm; }
function syOf(y){ return H / 2 - (y - camY) * ppm; }

/* ---------------- 震动 / 白闪 ---------------- */
let shake = 0, shX = 0, shY = 0, flash = 0;

/* ---------------- 星空缓存(200颗) ---------------- */
const STARN = 200, stars = [];
for (let i = 0; i < STARN; i++){
  stars.push({
    x: Math.random(), y: Math.random(),
    z: 0.2 + Math.random() * 0.8,    // 视差深度
    tw: 0.5 + Math.random() * 2.2,   // 闪烁频率
    ph: Math.random() * 6.283,
    s: 0.6 + Math.random() * 1.4     // 星点大小(px)
  });
}

/* ---------------- 粒子池(上限600，复用，避免每帧分配) ---------------- */
const MAXP = 600;
const pool = [];
let pN = 0;                          // 活跃粒子数，pool[0..pN-1] 有效
for (let i = 0; i < MAXP; i++){
  pool.push({
    type: 'smoke',
    x: 0, y: 0, vx: 0, vy: 0,
    life: 0, ttl: 1,
    size: 2, grow: 0,
    drag: 0, grav: 0,                // 阻力系数 / 重力加速度(正=下坠)
    rot: 0, vr: 0,
    r: 200, g: 200, b: 210, a: 0.3
  });
}
function pSpawn(){                   // 满时随机覆盖一个旧粒子
  if (pN < MAXP) return pool[pN++];
  return pool[(Math.random() * MAXP) | 0];
}
function pKill(i){                   // swap-remove，O(1)
  const p = pool[i], q = pool[pN - 1];
  pool[i] = q; pool[pN - 1] = p;
  pN--;
}

/* ---------------- 冲击波环池 ---------------- */
const waves = [];
for (let i = 0; i < 5; i++) waves.push({ on: false, x: 0, y: 0, t: 0, ttl: 0.9 });

/* ---------------- 边沿检测 / 动画状态 ---------------- */
const prevCrash = { stack: false, booster: false, ship: false };
const seenAlive  = { stack: false, booster: false, ship: false };
let prevCaught = false;
let lastSim = -1e9;
let armT = 0;                                        // 0张开 → 1合拢
const finT  = { stack: 0, booster: 0, ship: 0 };     // 栅格舵展开动画 0..1
const flapT = { stack: 0, ship: 0 };                 // 船体襟翼展开动画 0..1

const LEN = { stack: 123, booster: 71, ship: 52 };

/* 载具几何中心(世界坐标)，结果放 cX_/cY_ 避免分配 */
let cX_ = 0, cY_ = 0;
function vehCenter(v, L){
  const p = (v.pitch || 0) * RAD;
  cX_ = v.x + Math.sin(p) * L / 2;   // y 为载具底部(基部)，中心 = 基部 + 朝向·L/2
  cY_ = v.y + Math.cos(p) * L / 2;
}

/* ---------------- 圆角矩形路径 ---------------- */
function rr(x, y, w, h, r){
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ============================================================
   初始化 / 尺寸
   ============================================================ */
RENDER.init = function (canvas){
  cv = canvas;
  ctx = cv.getContext('2d');
  RENDER.resize();
  window.addEventListener('resize', RENDER.resize);
};

RENDER.resize = function (){
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  cv.width  = Math.max(1, Math.round(W * dpr));
  cv.height = Math.max(1, Math.round(H * dpr));
  if (cv.style){
    cv.style.width  = W + 'px';
    cv.style.height = H + 'px';
  }
};

/* ============================================================
   特效生成
   ============================================================ */

/* 尾焰烟尘粒子 */
function spawnFlameFx(v, dtS){
  const thr = v.throttle || 0;
  const rhoN = Math.exp(-Math.max(0, v.y) / 8500);
  if (rhoN < 0.03 || thr < 0.05) return;
  const p = (v.pitch || 0) * RAD;
  const dx = Math.sin(p), dy = Math.cos(p);
  const bx = v.x - dx * 2, by = v.y - dy * 2;   // 喷口世界位置(基部略后方)
  /* 烟团 */
  let n = Math.min(7, ((9 + 30 * thr) * rhoN * dtS + Math.random()) | 0);
  for (; n > 0; n--){
    const q = pSpawn();
    q.type = 'smoke';
    q.x = bx + rnd(-2, 2); q.y = by + rnd(-1, 3);
    const spd = rnd(20, 80) * (0.4 + thr);
    q.vx = v.vx * 0.3 - dx * spd + rnd(-8, 8);
    q.vy = v.vy * 0.3 - dy * spd + rnd(-4, 10);
    q.ttl = rnd(1.2, 2.8); q.life = 0;
    q.size = rnd(2, 5); q.grow = rnd(6, 14);
    q.drag = 1.1; q.grav = -1.5;               // 轻微上浮
    q.r = 205; q.g = 205; q.b = 212; q.a = 0.30;
    q.rot = 0; q.vr = 0;
  }
  /* 近地扬尘（发射/着陆吹起的地面尘土） */
  if (v.y < 45 && Math.abs(v.x) < 2600){
    let nd = Math.min(5, ((6 + 20 * thr) * dtS + Math.random()) | 0);
    for (; nd > 0; nd--){
      const q = pSpawn();
      q.type = 'dust';
      const side = Math.random() < 0.5 ? -1 : 1;
      q.x = v.x + side * rnd(3, 10); q.y = rnd(0, 4);
      q.vx = side * rnd(15, 80) * (0.5 + thr) + v.vx * 0.1;
      q.vy = rnd(2, 14);
      q.ttl = rnd(0.8, 2.0); q.life = 0;
      q.size = rnd(2, 6); q.grow = rnd(4, 12);
      q.drag = 1.6; q.grav = -0.5;
      q.r = 150; q.g = 138; q.b = 112; q.a = 0.22;
      q.rot = 0; q.vr = 0;
    }
  }
}

/* 再入等离子火花 */
function spawnPlasmaSparks(v, L, dtS){
  const h = v.heat;
  let n = Math.min(9, (h * 130 * dtS + Math.random()) | 0);
  if (n <= 0) return;
  vehCenter(v, L);
  const sp = Math.hypot(v.vx, v.vy) || 1;
  const nx = v.vx / sp, ny = v.vy / sp;
  for (; n > 0; n--){
    const q = pSpawn();
    q.type = 'spark';
    q.x = cX_ + nx * rnd(2, 9);
    q.y = cY_ + ny * rnd(2, 9);
    q.vx = v.vx * 0.45 - nx * sp * rnd(0.15, 0.4) + rnd(-40, 40);
    q.vy = v.vy * 0.45 - ny * sp * rnd(0.15, 0.4) + rnd(-40, 40);
    q.ttl = rnd(0.25, 0.8); q.life = 0;
    q.size = 0; q.grow = 0;
    q.drag = 1.5; q.grav = 0;
    q.r = 255; q.g = (150 + Math.random() * 90) | 0; q.b = (60 + Math.random() * 90) | 0;
    q.a = 1; q.rot = 0; q.vr = 0;
  }
}

/* 爆炸：碎片 + 火球 + 烟 + 冲击波 + 震屏 */
function explode(x, y, vx, vy){
  const n = 80 + ((Math.random() * 70) | 0);   // 80~150 个碎片
  for (let i = 0; i < n; i++){
    const q = pSpawn();
    q.type = 'debris';
    const ang = rnd(0, 6.283), sp = rnd(20, 240);
    q.x = x + rnd(-4, 4); q.y = y + rnd(-4, 4);
    q.vx = vx * 0.35 + Math.cos(ang) * sp;
    q.vy = vy * 0.35 + Math.sin(ang) * sp * 0.8 + rnd(0, 60);
    q.ttl = rnd(1.0, 2.6); q.life = 0;
    q.size = rnd(0.6, 3.2); q.grow = 0;
    q.drag = 0.6; q.grav = 30;
    q.rot = rnd(0, 6.283); q.vr = rnd(-8, 8);
    const c = Math.random();
    if (c < 0.30){ q.r = 255; q.g = 150; q.b = 50; }        // 橙
    else if (c < 0.50){ q.r = 255; q.g = 230; q.b = 180; }  // 亮白
    else if (c < 0.75){ q.r = 165; q.g = 165; q.b = 168; }  // 灰
    else { q.r = 95; q.g = 95; q.b = 98; }                  // 深灰
    q.a = 1;
  }
  for (let i = 0; i < 26; i++){                              // 火球
    const q = pSpawn();
    q.type = 'fire';
    const ang = rnd(0, 6.283), sp = rnd(5, 60);
    q.x = x + rnd(-6, 6); q.y = y + rnd(-6, 6);
    q.vx = vx * 0.2 + Math.cos(ang) * sp;
    q.vy = vy * 0.2 + Math.sin(ang) * sp * 0.7 + rnd(0, 30);
    q.ttl = rnd(0.4, 1.1); q.life = 0;
    q.size = rnd(4, 12); q.grow = rnd(10, 26);
    q.drag = 1.2; q.grav = -4;
    if (Math.random() < 0.5){ q.r = 255; q.g = 150; q.b = 60; }
    else { q.r = 255; q.g = 95; q.b = 40; }
    q.a = 1; q.rot = 0; q.vr = 0;
  }
  for (let i = 0; i < 20; i++){                              // 浓烟
    const q = pSpawn();
    q.type = 'smoke';
    q.x = x + rnd(-8, 8); q.y = y + rnd(-8, 8);
    q.vx = rnd(-30, 30); q.vy = rnd(5, 45);
    q.ttl = rnd(1.5, 3.2); q.life = 0;
    q.size = rnd(6, 16); q.grow = rnd(10, 20);
    q.drag = 0.9; q.grav = -2;
    q.r = 90; q.g = 88; q.b = 88; q.a = 0.38;
    q.rot = 0; q.vr = 0;
  }
  for (let i = 0; i < waves.length; i++){                    // 冲击波环
    const w = waves[i];
    if (!w.on){
      w.on = true; w.x = x; w.y = y; w.t = 0; w.ttl = 0.9;
      break;
    }
  }
  shake = Math.min(1.7, shake + 1.35);
  flash = Math.max(flash, 0.75);
}

/* 捕获瞬间：机械臂火花 + 白闪 */
function captureFx(x, y){
  for (let i = 0; i < 54; i++){
    const q = pSpawn();
    q.type = 'spark';
    const ang = rnd(0, 6.283), sp = rnd(30, 180);
    q.x = x + rnd(-5, 5); q.y = y + rnd(-3, 3);
    q.vx = Math.cos(ang) * sp;
    q.vy = Math.abs(Math.sin(ang)) * sp * 0.8 + rnd(0, 30);  // 向上崩溅
    q.ttl = rnd(0.3, 0.9); q.life = 0;
    q.size = 0; q.grow = 0;
    q.drag = 1.2; q.grav = 60;                               // 受重力下落
    q.r = 255; q.g = (200 + Math.random() * 55) | 0; q.b = (140 + Math.random() * 90) | 0;
    q.a = 1; q.rot = 0; q.vr = 0;
  }
  flash = Math.max(flash, 0.55);
  shake = Math.min(1.0, shake + 0.35);
}

/* ============================================================
   载具绘制（局部坐标系：中心为原点，机鼻在 -L/2·u，基部在 +L/2·u）
   ============================================================ */

/* 超重型助推器：71m × 9m 不锈钢深灰 */
function drawBoosterBody(u, ft){
  const hw = 4.5 * u, top = -35.5 * u, bot = 35.5 * u;
  /* 筒体：横向渐变塑造圆柱立体感 */
  const g = ctx.createLinearGradient(-hw, 0, hw, 0);
  g.addColorStop(0.00, '#43474e');
  g.addColorStop(0.22, '#7d838c');
  g.addColorStop(0.42, '#b7bdc6');   // 高光带
  g.addColorStop(0.60, '#80868f');
  g.addColorStop(1.00, '#31353c');
  rr(-hw, top, hw * 2, bot - top, 1.4 * u);
  ctx.fillStyle = g; ctx.fill();
  /* 环缝 */
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = Math.max(0.6, 0.12 * u);
  ctx.beginPath();
  for (let yy = top + 6 * u; yy < bot - 3 * u; yy += 9 * u){
    ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy);
  }
  ctx.stroke();
  /* 引擎段 */
  ctx.fillStyle = '#22252b';
  rr(-hw, bot - 4.5 * u, hw * 2, 4.5 * u, 0.8 * u);
  ctx.fill();
  /* 引擎喷口(2D侧视可见3台) */
  ctx.fillStyle = '#0d0f12';
  ctx.strokeStyle = '#3c414a';
  ctx.lineWidth = Math.max(0.5, 0.1 * u);
  for (let i = -1; i <= 1; i++){
    const ex = i * 2.1 * u, ey = bot - (i === 0 ? 1.2 : 1.6) * u;
    ctx.beginPath(); ctx.arc(ex, ey, 1.05 * u, 0, 6.283);
    ctx.fill(); ctx.stroke();
  }
  /* 顶部栅格舵（两侧展开动画） */
  if (ft > 0.01){
    const e = 3.6 * u * ft, fy = top + 5 * u, fh = 4.6 * u;
    ctx.fillStyle = '#2a2e34';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    rr(-hw - e, fy, e + 0.5 * u, fh, 0.4 * u); ctx.fill();
    rr(hw - 0.5 * u, fy, e + 0.5 * u, fh, 0.4 * u); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-hw - e * 0.5, fy); ctx.lineTo(-hw - e * 0.5, fy + fh);
    ctx.moveTo(hw + e * 0.5, fy);  ctx.lineTo(hw + e * 0.5, fy + fh);
    ctx.stroke();
  }
  /* 高光竖线 */
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(-hw * 0.45, top + 2 * u, Math.max(0.8, 0.9 * u), bot - top - 4 * u);
}

/* 星舰：52m × 9m 银白 + 黑鼻锥 + 襟翼 */
function drawShipFlap(u, ft, front, near){
  /* front: 前(靠鼻)襟翼 / 后(靠尾)襟翼；near: 近侧(亮) / 远侧(暗) */
  const hw = 4.5 * u;
  const x0 = near ? hw * 0.98 : -hw * 0.98;
  const dir = near ? 1 : -1;
  ctx.fillStyle = near ? '#c3c9d0' : '#7d838b';
  if (front){
    ctx.beginPath();
    ctx.moveTo(x0, -15 * u);
    ctx.lineTo(x0 + dir * 5.5 * u * ft, -2 * u);
    ctx.lineTo(x0, -7 * u);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(x0, 18 * u);
    ctx.lineTo(x0 + dir * 6.5 * u * ft, 30 * u);
    ctx.lineTo(x0, 26.5 * u);
    ctx.closePath(); ctx.fill();
  }
}

function drawShipBody(u, fpt){
  const hw = 4.5 * u, top = -26 * u, bot = 26 * u;
  /* 远侧襟翼（画在机身后） */
  if (fpt > 0.01){
    drawShipFlap(u, fpt, false, false);
    drawShipFlap(u, fpt, true, false);
  }
  /* 筒体 */
  const g = ctx.createLinearGradient(-hw, 0, hw, 0);
  g.addColorStop(0.00, '#9aa0a7');
  g.addColorStop(0.25, '#f3f6f9');   // 高光
  g.addColorStop(0.50, '#e2e7ec');
  g.addColorStop(0.75, '#a8aeb5');
  g.addColorStop(1.00, '#787e86');
  rr(-hw, top + 8 * u, hw * 2, bot - top - 8 * u, 1.2 * u);
  ctx.fillStyle = g; ctx.fill();
  /* 腹部隔热瓦暗带（右半侧） */
  ctx.fillStyle = 'rgba(30,40,55,0.18)';
  ctx.fillRect(hw * 0.15, top + 9 * u, hw * 0.85, bot - top - 9 * u);
  /* 黑鼻锥 */
  const ng = ctx.createLinearGradient(0, top, 0, top + 9 * u);
  ng.addColorStop(0, '#08090b');
  ng.addColorStop(1, '#2a2d33');
  ctx.beginPath();
  ctx.moveTo(-hw, top + 9 * u);
  ctx.quadraticCurveTo(-hw * 0.92, top + 1.5 * u, 0, top);
  ctx.quadraticCurveTo(hw * 0.92, top + 1.5 * u, hw, top + 9 * u);
  ctx.closePath();
  ctx.fillStyle = ng; ctx.fill();
  /* 近侧襟翼（画在机身上） */
  if (fpt > 0.01){
    drawShipFlap(u, fpt, false, true);
    drawShipFlap(u, fpt, true, true);
  }
  /* 引擎喷口 */
  ctx.fillStyle = '#0d0f12';
  for (let i = -1; i <= 1; i++){
    ctx.beginPath();
    ctx.arc(i * 1.9 * u, bot - 1.1 * u, 0.85 * u, 0, 6.283);
    ctx.fill();
  }
}

/* 整体组合：助推器在下(0~71m)，ship 在上(71~123m)，级间环 */
function drawStack(u, ft, fpt){
  ctx.save(); ctx.translate(0, 26 * u);      // 助推器中心在整体中心下方26m
  drawBoosterBody(u, ft);
  ctx.restore();
  ctx.save(); ctx.translate(0, -35.5 * u);   // ship 中心在整体中心上方35.5m
  drawShipBody(u, fpt);
  ctx.restore();
  /* 级间深色环（71m处，即整体中心上方9.5m） */
  ctx.fillStyle = '#17191d';
  ctx.fillRect(-4.62 * u, -11.2 * u, 9.24 * u, 2.8 * u);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(-4.62 * u, -11.2 * u, 9.24 * u, Math.max(0.6, 0.5 * u));
}

/* ---------------- 尾焰 ---------------- */
function drawFlame(v, L, u){
  const thr = v.throttle || 0;
  if (!(v.engines && thr > 0.02)) return;
  const rhoN = Math.exp(-Math.max(0, v.y) / 8500);
  const jit = 0.88 + Math.random() * 0.28;
  const len = (40 + 80 * thr) * (1 + 1.1 * (1 - rhoN)) * jit * u;  // 低气压更细长
  const wB = 3.8 * u * (0.5 + 0.5 * thr) * (0.45 + 0.55 * rhoN);
  const y0 = L / 2 * u;
  const vm = clamp(1 - rhoN / 0.30, 0, 1);   // 真空混合度：稠密橙焰 → 真空蓝紫
  const r1 = mix(255, 175, vm), g1 = mix(155, 150, vm), b1 = mix(70, 255, vm);
  const r2 = mix(255, 215, vm), g2 = mix(235, 220, vm), b2 = mix(225, 255, vm);

  ctx.globalCompositeOperation = 'lighter';
  /* 外层大光晕 */
  let g = ctx.createRadialGradient(0, y0 + len * 0.3, 0, 0, y0 + len * 0.3, len * 0.8);
  g.addColorStop(0, 'rgba(' + (r1 | 0) + ',' + (g1 | 0) + ',' + (b1 | 0) + ',' + (0.28 - 0.10 * vm).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(' + (r1 | 0) + ',' + (g1 | 0) + ',' + (b1 | 0) + ',0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, y0 + len * 0.3, len * 0.8, 0, 6.283); ctx.fill();
  /* 主锥 */
  g = ctx.createLinearGradient(0, y0, 0, y0 + len);
  g.addColorStop(0.00, 'rgba(' + (r2 | 0) + ',' + (g2 | 0) + ',' + (b2 | 0) + ',0.90)');
  g.addColorStop(0.30, 'rgba(' + (r1 | 0) + ',' + (g1 | 0) + ',' + (b1 | 0) + ',0.55)');
  g.addColorStop(0.65, 'rgba(' + (r1 | 0) + ',' + (g1 | 0) + ',' + (b1 | 0) + ',0.22)');
  g.addColorStop(1.00, 'rgba(' + (r1 | 0) + ',' + (g1 | 0) + ',' + (b1 | 0) + ',0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-wB, y0);
  ctx.lineTo(wB, y0);
  ctx.quadraticCurveTo(wB * 0.55, y0 + len * 0.6, 0, y0 + len);
  ctx.quadraticCurveTo(-wB * 0.55, y0 + len * 0.6, -wB, y0);
  ctx.closePath(); ctx.fill();
  /* 内芯 */
  g = ctx.createLinearGradient(0, y0, 0, y0 + len * 0.6);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(' + (r2 | 0) + ',' + (g2 | 0) + ',' + (b2 | 0) + ',0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-wB * 0.42, y0);
  ctx.lineTo(wB * 0.42, y0);
  ctx.lineTo(0, y0 + len * 0.6);
  ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------------- 再入等离子体 ---------------- */
function drawPlasma(v, L){
  const h = v.heat;
  if (!(h > 0.1)) return;
  vehCenter(v, L);
  const scx = sxOf(cX_), scy = syOf(cY_);
  const sp = Math.hypot(v.vx, v.vy) || 1;
  const nx = v.vx / sp, ny = v.vy / sp;
  const ang = Math.atan2(-ny, nx);            // 屏幕坐标速度方向
  const R = Math.max(24, (12 + 26 * h) * ppm);
  ctx.globalCompositeOperation = 'lighter';
  /* 前缘辉光弧（迎风面），橙白核心 → 品红外缘 */
  const lx = scx + Math.cos(ang) * R * 0.4;
  const ly = scy + Math.sin(ang) * R * 0.4;
  ctx.save();
  ctx.translate(lx, ly); ctx.rotate(ang); ctx.scale(1.5, 0.8);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0.00, 'rgba(255,246,228,' + (0.75 * h).toFixed(3) + ')');
  g.addColorStop(0.35, 'rgba(255,' + ((160 - 60 * h) | 0) + ',' + ((70 + 120 * h) | 0) + ',' + (0.50 * h).toFixed(3) + ')');
  g.addColorStop(1.00, 'rgba(255,60,200,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.283); ctx.fill();
  ctx.restore();
  /* 速度反方向拖尾 */
  for (let i = 1; i <= 4; i++){
    const a = (1 - i / 5) * 0.30 * h;
    const rr2 = R * (1 - i * 0.18);
    const tx = scx - Math.cos(ang) * R * 0.55 * i;
    const ty = scy - Math.sin(ang) * R * 0.55 * i;
    ctx.fillStyle = 'rgba(255,' + ((120 + 30 * i) | 0) + ',170,' + a.toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(tx, ty, rr2, 0, 6.283); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------------- 近地喷焰对地面冲刷 ---------------- */
function drawSplash(v){
  const thr = v.throttle || 0;
  if (!(v.engines && thr > 0.05) || v.y > 30) return;
  const rhoN = Math.exp(-Math.max(0, v.y) / 8500);
  if (rhoN < 0.15 || Math.abs(v.x) > 2600) return;   // 仅陆地区域
  const gx = sxOf(v.x), gy = syOf(0);
  const rx = (26 + 50 * thr) * ppm * (0.9 + Math.random() * 0.2);
  if (rx < 4) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.save();
  ctx.translate(gx, gy); ctx.scale(1, 0.22);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, 'rgba(255,220,140,' + (0.40 * rhoN).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.283); ctx.fill();
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
}

/* ============================================================
   场景元素
   ============================================================ */
function drawSky(){
  const altK = Math.max(0, camY) / 1000;
  const t = Math.pow(clamp(altK / 60, 0, 1), 0.85);   // 0km → 60km+
  const rt = Math.round(mix(47, 6, t));
  const gt = Math.round(mix(111, 7, t));
  const bt = Math.round(mix(184, 15, t));
  const rb = Math.round(mix(156, 13, t));
  const gb = Math.round(mix(196, 15, t));
  const bb = Math.round(mix(228, 27, t));
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgb(' + rt + ',' + gt + ',' + bt + ')');
  g.addColorStop(1, 'rgb(' + rb + ',' + gb + ',' + bb + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  /* 星星：30km 以上渐显（屏幕空间 + 轻微视差） */
  const sa = clamp((altK - 30) / 22, 0, 1);
  if (sa > 0){
    ctx.fillStyle = '#dfe8ff';
    for (let i = 0; i < STARN; i++){
      const s = stars[i];
      const px = ((s.x * W + camX * 0.03 * s.z) % W + W) % W;
      const py = s.y * H * 0.92;
      const tw = 0.55 + 0.45 * Math.sin(tR * s.tw + s.ph);
      ctx.globalAlpha = sa * tw * 0.9;
      ctx.fillRect(px, py, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  /* >80km：微曲行星弧 + 大气辉光带 */
  const pg = clamp((camY - 70000) / 50000, 0, 1);
  const pa = clamp((camY - 80000) / 40000, 0, 1);
  if (pa > 0 || pg > 0){
    const ay = H * 0.94;
    const R = Math.max(W * 1.35, 1600);
    const cx2 = W / 2, cy2 = ay + R;
    if (pg > 0){
      ctx.lineWidth = 30;
      ctx.strokeStyle = 'rgba(90,150,255,' + (0.10 * pg).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(cx2, cy2, R, Math.PI, 0); ctx.stroke();
      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(130,190,255,' + (0.20 * pg).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(cx2, cy2, R, Math.PI, 0); ctx.stroke();
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(200,230,255,' + (0.38 * pg).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(cx2, cy2, R, Math.PI, 0); ctx.stroke();
    }
    if (pa > 0){
      ctx.beginPath();
      ctx.arc(cx2, cy2, R, Math.PI, 0);
      ctx.lineTo(W + 50, H + 50);
      ctx.lineTo(-50, H + 50);
      ctx.closePath();
      ctx.fillStyle = 'rgba(6,8,14,' + (0.92 * pa).toFixed(3) + ')';
      ctx.fill();
    }
  }
}

function drawGround(gY, u){
  const g = ctx.createLinearGradient(0, gY, 0, gY + 300);
  g.addColorStop(0, '#2b2f26');
  g.addColorStop(1, '#12140e');
  ctx.fillStyle = g;
  ctx.fillRect(0, gY, W, Math.max(0, H - gY + 2));
  ctx.fillStyle = 'rgba(190,200,170,0.25)';
  ctx.fillRect(0, gY, W, Math.max(1, 0.8 * u));
}

/* 发射台底座 */
function drawPad(gY, u){
  ctx.fillStyle = '#3a3e44';
  ctx.fillRect(sxOf(-60), gY - 10 * u, 120 * u, 10 * u);
  ctx.fillStyle = '#565c66';
  ctx.fillRect(sxOf(-60), gY - 10 * u, 120 * u, Math.max(1, 1.2 * u));
  /* 中央导流槽 */
  ctx.fillStyle = '#101215';
  ctx.fillRect(sxOf(-12), gY - 10 * u, 24 * u, 10 * u);
}

/* 发射塔：x=0 附近，高145m，双柱+横梁+机械臂 */
function drawTower(gY, u){
  const h = 145 * u;
  const x1 = sxOf(-44), x4 = sxOf(-24);
  /* 双柱 */
  ctx.fillStyle = '#3a3f47';
  ctx.fillRect(x1, gY - h, 6 * u, h);
  ctx.fillRect(sxOf(-30), gY - h, 6 * u, h);
  /* 柱身高光 */
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x1, gY - h, Math.max(1, 1.2 * u), h);
  ctx.fillRect(sxOf(-30), gY - h, Math.max(1, 1.2 * u), h);
  /* 横梁 */
  ctx.fillStyle = '#2f343c';
  for (let yy = 20; yy <= 140; yy += 24){
    ctx.fillRect(x1, gY - yy * u - 1.8 * u, x4 - x1, Math.max(1.5, 3.6 * u));
  }
  /* 顶部设备块 */
  ctx.fillStyle = '#262a31';
  ctx.fillRect(sxOf(-46), gY - h - 3 * u, (x4 - x1) + 4 * u, 3 * u);

  /* 机械臂（双臂，默认张开30°，靠近/捕获时合拢至水平） */
  const openAng = (1 - armT) * 30 * RAD;
  for (let i = 0; i < 2; i++){
    const py = i === 0 ? 118 : 106;
    ctx.save();
    ctx.translate(sxOf(-24), gY - py * u);
    ctx.rotate(-openAng);
    ctx.fillStyle = '#494f58';
    ctx.fillRect(0, -1.1 * u, 36 * u, Math.max(1.5, 2.2 * u));
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, -1.1 * u, 36 * u, Math.max(0.8, 0.6 * u));
    /* 臂尖夹爪 */
    ctx.fillStyle = '#5a616b';
    ctx.fillRect(33 * u, -2.6 * u, Math.max(1.5, 3 * u), Math.max(3, 5.2 * u));
    ctx.restore();
  }

  /* 顶部警示红灯（闪烁） */
  if ((tR % 1.4) < 0.15){
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,60,50,0.9)';
    ctx.beginPath();
    ctx.arc(sxOf(-34), gY - h - 4 * u, Math.max(1.5, 1.2 * u), 0, 6.283);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* 海上回收平台（recovery='sea'，x=250km） */
function drawPlatform(gY, u){
  const px = sxOf(250000);
  if (px < -500 || px > W + 500) return;
  const w = 240 * u, deckY = gY - 25 * u, hullH = 12 * u;
  /* 支撑腿 */
  ctx.fillStyle = '#262a30';
  for (let i = -2; i <= 2; i++){
    ctx.fillRect(px + i * 52 * u - 2.5 * u, deckY, Math.max(1.5, 5 * u), gY - deckY);
  }
  /* 船体 */
  const g = ctx.createLinearGradient(px, 0, px + w, 0);
  g.addColorStop(0, '#3c4148');
  g.addColorStop(0.5, '#565d66');
  g.addColorStop(1, '#3c4148');
  ctx.fillStyle = g;
  ctx.fillRect(px - w / 2, deckY, w, hullH);
  /* 甲板边条 */
  ctx.fillStyle = '#6b737d';
  ctx.fillRect(px - w / 2, deckY, w, Math.max(1, 1.5 * u));
  /* 两端警示条纹 */
  ctx.fillStyle = 'rgba(230,190,60,0.8)';
  ctx.fillRect(px - w / 2, deckY + Math.max(1, 1.5 * u), Math.max(1.5, 8 * u), Math.max(1.5, 2 * u));
  ctx.fillRect(px + w / 2 - 8 * u, deckY + Math.max(1, 1.5 * u), Math.max(1.5, 8 * u), Math.max(1.5, 2 * u));
  /* 小字标识 */
  if (u > 0.045){
    ctx.fillStyle = 'rgba(220,228,238,0.75)';
    ctx.font = '8px "Bahnschrift","Segoe UI",Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OCEAN PLATFORM · LZ-A', px, deckY + hullH * 0.62);
  }
  /* 雷达桅杆 + 闪灯 */
  const mx = px - w / 2 + 18 * u;
  ctx.fillStyle = '#3a3f47';
  ctx.fillRect(mx, deckY - 26 * u, Math.max(1, 1.2 * u), 26 * u);
  if ((tR % 1.1) < 0.12){
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(mx, deckY - 26 * u, 1.6, 0, 6.283);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* ============================================================
   主绘制
   ============================================================ */
function drawVehicle(v, kind){
  const L = LEN[kind];
  vehCenter(v, L);
  const scx = sxOf(cX_), scy = syOf(cY_);
  const u = ppm;
  const margin = 300 * u + 260;
  if (scx < -margin || scx > W + margin || scy < -margin || scy > H + margin) return;
  const p = (v.pitch || 0) * RAD;
  ctx.save();
  ctx.translate(scx, scy);
  ctx.rotate(p);
  drawFlame(v, L, u);                    // 先焰后身，机身盖住焰根
  if (kind === 'stack') drawStack(u, finT.stack, flapT.stack);
  else if (kind === 'booster') drawBoosterBody(u, finT.booster);
  else drawShipBody(u, flapT.ship);
  ctx.restore();
  drawPlasma(v, L);
  drawSplash(v);
}

RENDER.draw = function (state, dtReal){
  if (!ctx) return;
  dtReal = dtReal || 0.016;
  tR += dtReal;
  const st = state || {};
  const vs = st.vehicles || {};

  /* ---- dtSim 估计（粒子/发射速率随仿真时间） ---- */
  let dtS = st.simTime - lastSim;
  if (!(dtS > 0) || dtS > 1) dtS = 0;
  if (st.simTime < lastSim - 1){         // 检测到重开：清空全部特效
    pN = 0;
    for (let i = 0; i < waves.length; i++) waves[i].on = false;
    shake = 0; flash = 0;
    prevCrash.stack = prevCrash.booster = prevCrash.ship = false;
    seenAlive.stack = seenAlive.booster = seenAlive.ship = false;
    prevCaught = false;
    camInit = false;
  }
  lastSim = st.simTime;

  /* ---- 相机平滑跟随 active 载具 ---- */
  const tgt = vs[st.active] || vs.stack || vs.booster || vs.ship || null;
  if (tgt){
    if (!camInit){ camX = tgt.x; camY = tgt.y + CAM_BIAS; camInit = true; }
    const k = 1 - Math.exp(-dtReal * 4.2);
    camX += (tgt.x - camX) * k;
    camY += (tgt.y + CAM_BIAS - camY) * k;
  }
  const ppmT = clamp(1.6 * Math.pow(2200 / (camY + 2200), 0.6), 0.02, 1.6);
  ppm += (ppmT - ppm) * (1 - Math.exp(-dtReal * 3));

  /* ---- 动画状态推进 ---- */
  const b = vs.booster;
  let at = 0;
  if (b && st.recovery === 'tower' &&
      (b.caught || (b.y < 400 && Math.abs(b.x) < 150))) at = 1;
  armT += (at - armT) * (1 - Math.exp(-dtReal * 2.6));

  const kA = 1 - Math.exp(-dtReal * 2.2);
  finT.stack  += (((vs.stack  && vs.stack.fins)  ? 1 : 0) - finT.stack)  * kA;
  finT.booster+= (((vs.booster&& vs.booster.fins)? 1 : 0) - finT.booster)* kA;
  finT.ship   += (((vs.ship   && vs.ship.fins)   ? 1 : 0) - finT.ship)   * kA;
  flapT.stack += (((vs.stack  && vs.stack.flaps) ? 1 : 0) - flapT.stack) * kA;
  flapT.ship  += (((vs.ship   && vs.ship.flaps)  ? 1 : 0) - flapT.ship)  * kA;

  /* ---- 边沿检测：爆炸 / 捕获 ---- */
  for (const key of ['stack', 'booster', 'ship']){
    const v = vs[key];
    if (!v){ prevCrash[key] = false; seenAlive[key] = false; continue; }
    if (!v.crashed) seenAlive[key] = true;
    if (v.crashed && seenAlive[key] && !prevCrash[key]){
      vehCenter(v, LEN[key]);
      explode(cX_, cY_, v.vx || 0, v.vy || 0);
    }
    prevCrash[key] = !!v.crashed;
  }
  if (b){
    if (b.caught && !prevCaught) captureFx(b.x, b.y + 66);
    prevCaught = !!b.caught;
  }

  /* ---- 每帧特效粒子生成 ---- */
  for (const key of ['stack', 'booster', 'ship']){
    const v = vs[key];
    if (!v || v.crashed) continue;
    if (v.engines && (v.throttle || 0) > 0.05) spawnFlameFx(v, dtS);
    if ((v.heat || 0) > 0.15) spawnPlasmaSparks(v, LEN[key], dtS);
  }

  /* ---- 粒子推进（用仿真时间，暂停即冻结） ---- */
  const dtP = clamp(dtS, 0, 0.08);
  let i = 0;
  while (i < pN){
    const p = pool[i];
    p.life += dtP;
    if (p.life >= p.ttl){ pKill(i); continue; }
    const dr = Math.exp(-p.drag * dtP);
    p.vx *= dr;
    p.vy = p.vy * dr - p.grav * dtP;
    p.x += p.vx * dtP;
    p.y += p.vy * dtP;
    p.rot += p.vr * dtP;
    p.size += p.grow * dtP;
    i++;
  }
  for (let wi = 0; wi < waves.length; wi++){
    const w = waves[wi];
    if (w.on){ w.t += dtReal; if (w.t >= w.ttl) w.on = false; }
  }

  /* ---- 屏幕震动（爆炸强震 + 低空引擎微振） ---- */
  shake *= Math.exp(-2.8 * dtReal);
  if (shake < 0.002) shake = 0;
  let vib = 0;
  for (const key of ['stack', 'booster', 'ship']){
    const v = vs[key];
    if (v && v.engines && (v.throttle || 0) > 0.05){
      const rhoN = Math.exp(-Math.max(0, v.y) / 8500);
      vib = Math.max(vib, v.throttle * clamp(rhoN * 3, 0, 1));
    }
  }
  const amp = shake * 20 + vib * 2.2;
  shX = (Math.random() * 2 - 1) * amp;
  shY = (Math.random() * 2 - 1) * amp;

  /* ================= 渲染 ================= */
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.translate(shX, shY);

  /* 天空 / 星空 / 行星弧 */
  drawSky();

  /* 地面与设施 */
  const gY = syOf(0), u = ppm;
  if (gY < H + 400){
    drawGround(gY, u);
    drawPad(gY, u);
    drawTower(gY, u);
    if (st.recovery === 'sea') drawPlatform(gY, u);
  }

  /* 载具（stack 优先；分离后分别画 booster / ship；跳过 crash 或不存在） */
  if (vs.stack && !vs.stack.crashed){
    drawVehicle(vs.stack, 'stack');
  } else {
    if (vs.booster && !vs.booster.crashed) drawVehicle(vs.booster, 'booster');
    if (vs.ship && !vs.ship.crashed) drawVehicle(vs.ship, 'ship');
  }

  /* 粒子：第一遍普通混合（烟 / 尘 / 碎片） */
  for (let pi = 0; pi < pN; pi++){
    const p = pool[pi];
    const k = 1 - p.life / p.ttl;
    if (p.type === 'smoke' || p.type === 'dust'){
      const a = k * k * p.a;
      if (a < 0.01) continue;
      const r = Math.max(1, p.size * ppm);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgb(' + p.r + ',' + p.g + ',' + p.b + ')';
      ctx.beginPath();
      ctx.arc(sxOf(p.x), syOf(p.y), r, 0, 6.283);
      ctx.fill();
    } else if (p.type === 'debris'){
      const s = Math.max(1.5, p.size * ppm);
      ctx.save();
      ctx.translate(sxOf(p.x), syOf(p.y));
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, k * 1.8);
      ctx.fillStyle = 'rgb(' + p.r + ',' + p.g + ',' + p.b + ')';
      ctx.fillRect(-s / 2, -s * 0.35, s, s * 0.7);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;

  /* 粒子：第二遍加算混合（火花 / 火球） */
  ctx.globalCompositeOperation = 'lighter';
  for (let pi = 0; pi < pN; pi++){
    const p = pool[pi];
    const k = 1 - p.life / p.ttl;
    if (p.type === 'spark'){
      const px = sxOf(p.x), py = syOf(p.y);
      ctx.globalAlpha = k;
      ctx.strokeStyle = 'rgb(' + p.r + ',' + p.g + ',' + p.b + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - p.vx * ppm * 0.02, py + p.vy * ppm * 0.02);
      ctx.stroke();
    } else if (p.type === 'fire'){
      ctx.globalAlpha = k * 0.5;
      ctx.fillStyle = 'rgb(' + p.r + ',' + p.g + ',' + p.b + ')';
      ctx.beginPath();
      ctx.arc(sxOf(p.x), syOf(p.y), Math.max(1.5, p.size * ppm), 0, 6.283);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  /* 冲击波环 */
  for (let wi = 0; wi < waves.length; wi++){
    const w = waves[wi];
    if (!w.on) continue;
    const k = w.t / w.ttl;
    const r = Math.max(24, 420 * (1 - Math.pow(1 - k, 3)) * ppm);
    ctx.globalAlpha = (1 - k) * 0.6;
    ctx.strokeStyle = 'rgba(255,240,220,1)';
    ctx.lineWidth = 3 + 9 * (1 - k);
    ctx.beginPath();
    ctx.arc(sxOf(w.x), syOf(w.y), r, 0, 6.283);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* 白闪（爆炸 / 捕获，屏幕空间） */
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (flash > 0){
    ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, flash).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
    flash = Math.max(0, flash - dtReal * 2.2);
  }
};

window.RENDER = RENDER;
})();
