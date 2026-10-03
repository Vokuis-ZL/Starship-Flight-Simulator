/* 构建脚本：将 mission14.js / physics.js / render.js / ui.js + ui.css 内联进单文件 HTML */
'use strict';
const fs = require('fs');
const path = require('path');
const dev = __dirname;
const read = f => fs.readFileSync(path.join(dev, f), 'utf8');

const css = read('ui.css');
const m14 = read('mission14.js');
const phys = read('physics.js');
const rend = read('render.js');
const ui = read('ui.js');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>STARSHIP FLIGHT 14 — IFT-14 星舰全任务飞行仿真</title>
<style>
${css}
</style>
</head>
<body>
<canvas id="cv"></canvas>
<script>
${m14}
</script>
<script>
${phys}
</script>
<script>
${rend}
</script>
<script>
${ui}
</script>
<script>
/* ============ 主循环与模块接线（整合者） ============ */
(function () {
  'use strict';
  var canvas = document.getElementById('cv');
  RENDER.init(canvas);

  /* 预初始化：菜单展示期间仿真保持暂停 */
  PHYS.init({ mode: 'auto', timeMode: 'compressed', paramMode: 'script' });
  PHYS.getState().running = false;

  var endShown = false;
  UI.init({
    onStart: function (cfg) {
      PHYS.init(cfg);
      endShown = false;
    },
    onCmd: function (type, v) {
      if (type === 'param') PHYS.cmd({ type: 'param', key: v.key, value: v.value });
      else if (type === 'paramMode') PHYS.cmd({ type: 'paramMode', value: v.value });
      else PHYS.cmd({ type: type, v: v });
    },
    onInput: function (k, v) {
      PHYS.setInput(k, v);
    },
    onRestart: function () {
      PHYS.restart();
      endShown = false;
    },
    onMenu: function () {
      location.reload();
    }
  });

  var last = performance.now();
  function frame(t) {
    var dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    var S = PHYS.getState();
    if (S.running && !S.paused && !S.missionOver) {
      PHYS.step(dt * PHYS.effSpeed());
    }
    RENDER.draw(S, dt);
    UI.update(S);
    if (S.missionOver && !endShown) {
      endShown = true;
      UI.showEnd(S);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>
`;

const out = path.join(dev, '..', '星舰飞行仿真.html');
fs.writeFileSync(out, html);
console.log('OK ->', out, (html.length / 1024).toFixed(1) + ' KB');
