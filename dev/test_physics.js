/* PHYS v2 无头自动化测试：IFT-14 脚本模式 + 自适应参数模式 */
'use strict';
global.window = global;

const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, 'mission14.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, 'physics.js'), 'utf8'));

let pass = 0, failCnt = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); failCnt++; }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

function runMission(cfg, maxSteps, hook) {
  PHYS.init(cfg);
  for (let i = 0; i < maxSteps; i++) {
    PHYS.step(0.25 * PHYS.effSpeed());
    const s = PHYS.getState();
    if (hook) hook(s);
    if (s.missionOver) break;
  }
  return PHYS.getState();
}

console.log('== TEST 1: 脚本模式（真实 IFT-14 时间线，溅落） ==');
test('script: 时间线节点对齐 + 全任务成功', () => {
  const marks = {};
  const s = runMission({ mode: 'auto', timeMode: 'compressed', paramMode: 'script' }, 200000, (st) => {
    for (const k in st.timelineDone) if (!marks[k]) marks[k] = st.simTime;
  });
  const F = MISSION14.fmtClock;
  console.log('    outcome=' + s.outcome + ' missionT=' + F(s.simTime));
  console.log('    MECO@' + F(marks.MECO || -1) + ' BSPLASH@' + F(marks.BSPLASH || -1)
    + ' SECO1@' + F(marks.SECO1 || -1) + ' ORBIT@' + F(marks.ORBIT || -1)
    + ' ENTRY@' + F(marks.ENTRY || -1) + ' SPLASH@' + F(marks.SPLASH || -1));
  console.log('    stats: maxAlt=' + (s.stats.maxAlt / 1000).toFixed(1) + 'km maxV=' + (s.stats.maxSpeed * 3.6 / 1000).toFixed(2) + 'km/s maxG=' + s.stats.maxG.toFixed(1));
  const b = s.vehicles.booster, sh = s.vehicles.ship;
  console.log('    booster: splashed=' + (b && b.splashed) + ' crashed=' + (b && b.crashed) + ' x=' + (b ? b.x.toFixed(0) : '-'));
  console.log('    ship: landed=' + (sh && sh.landed) + ' crashed=' + (sh && sh.crashed) + ' vy=' + (sh ? sh.vy.toFixed(1) : '-'));
  assert(marks.MECO !== undefined && Math.abs(marks.MECO - 140) < 25, 'MECO 时间偏差过大: ' + marks.MECO);
  assert(marks.BSPLASH !== undefined && marks.BSPLASH > 300 && marks.BSPLASH < 447, '助推器溅落时间偏差: ' + marks.BSPLASH);
  assert(marks.SECO1 !== undefined && Math.abs(marks.SECO1 - 491) < 30, 'SECO-1 时间偏差: ' + marks.SECO1);
  assert(marks.ORBIT !== undefined && Math.abs(marks.ORBIT - 1547) < 40, '入轨时间偏差: ' + marks.ORBIT);
  assert(s.stats.maxSpeed > 7300, '入轨速度不足: ' + s.stats.maxSpeed.toFixed(0));
  assert(b && b.splashed === true && !b.crashed, '助推器未溅落');
  assert(sh && sh.landed === true && !sh.crashed, '飞船未溅落');
  assert(s.outcome === 'success', 'outcome=' + s.outcome + ' ' + s.failReason);
  assert(Math.abs(s.simTime - 35430) < 1300, '任务总时长偏差: ' + s.simTime);
});

console.log('== TEST 2: 自适应模式 + 参数修改 ==');
test('adaptive: 减引擎/减燃料/改分离高度仍完成', () => {
  const s = runMission({
    mode: 'auto', timeMode: 'compressed', paramMode: 'adaptive',
    params: { boosterEngines: 28, shipEngines: 6, thrustScale: 1.0, fuelScale: 0.9, sepAlt: 50, recovery: 0 }
  }, 200000);
  console.log('    outcome=' + s.outcome + ' maxAlt=' + (s.stats.maxAlt / 1000).toFixed(1) + 'km maxV=' + s.stats.maxSpeed.toFixed(0));
  const b = s.vehicles.booster, sh = s.vehicles.ship;
  console.log('    booster: landed=' + (b && b.landed) + ' crashed=' + (b && b.crashed) + ' x=' + (b?b.x.toFixed(0):'-') + ' reason=' + (b&&b.crashed?s.endingNote:''));
  console.log('    ship: landed=' + (sh && sh.landed) + ' crashed=' + (sh && sh.crashed) + ' orbit=' + s._orbitDone + ' reason=' + (sh&&sh.crashed?s.failReason:'') + ' y=' + (sh?sh.y.toFixed(0):'-') + ' vy=' + (sh?sh.vy.toFixed(1):'-'));
  assert(sh && sh.landed === true, '飞船未着陆');
  assert(b && (b.landed || b.caught) && !b.crashed, '助推器未回收');
  assert(s._orbitDone === true, '未入轨');
  assert(s.outcome === 'success' || s.outcome === 'partial', 'outcome=' + s.outcome);
});

test('adaptive: 飞行中实时改参数（cmd param）', () => {
  PHYS.init({ mode: 'auto', timeMode: 'compressed', paramMode: 'adaptive' });
  let switched = false;
  for (let i = 0; i < 200000; i++) {
    const st = PHYS.getState();
    if (!switched && st.simTime > 500) {
      switched = true;
      PHYS.cmd({ type: 'param', key: 'thrustScale', value: 1.15 });
      PHYS.cmd({ type: 'param', key: 'fuelScale', value: 1.0 });
    }
    PHYS.step(0.25 * PHYS.effSpeed());
    if (PHYS.getState().missionOver) break;
  }
  const s = PHYS.getState();
  console.log('    outcome=' + s.outcome + ' thrustScale=' + s.params.thrustScale);
  assert(s.params.thrustScale === 1.15, '参数未生效');
  assert(s.vehicles.ship && s.vehicles.ship.landed === true, '飞船未着陆');
});

console.log('== TEST 3: 脚本模式极端参数（应失败但无异常） ==');
test('script: 参数削弱导致失败/部分成功，不抛异常', () => {
  const s = runMission({
    mode: 'auto', timeMode: 'compressed', paramMode: 'script',
    params: { boosterEngines: 20, shipEngines: 3, thrustScale: 0.85, fuelScale: 0.75, sepAlt: 62, recovery: 0 }
  }, 200000);
  console.log('    outcome=' + s.outcome + ' failReason=' + s.failReason + ' note=' + s.endingNote);
  assert(true);
});

console.log('== TEST 4: 手动冒烟 ==');
test('manual: 极端输入不抛异常', () => {
  PHYS.init({ mode: 'manual', timeMode: 'compressed', paramMode: 'script' });
  for (let i = 0; i < 6000; i++) {
    PHYS.setInput('pitch', (i % 100 < 50) ? 1 : -1);
    PHYS.cmd({ type: 'throttle', v: (i % 20 < 10) ? 1 : 0 });
    if (i === 50) PHYS.cmd({ type: 'engines' });
    if (i === 400) PHYS.cmd({ type: 'sep' });
    if (i === 600) PHYS.cmd({ type: 'switch' });
    if (i % 997 === 0) PHYS.cmd({ type: 'mode' });
    if (i % 991 === 0) PHYS.cmd({ type: 'paramMode', value: 'adaptive' });
    PHYS.step(0.05);
    if (PHYS.getState().missionOver) break;
  }
  assert(true);
});

console.log('\n结果: ' + pass + ' 通过, ' + failCnt + ' 失败');
process.exit(failCnt ? 1 : 0);
