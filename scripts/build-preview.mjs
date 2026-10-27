/**
 * 从用户脚本中抽取真实 UI_CSS，生成一份可视化预览页。
 * 目的：不登录夸克网盘也能直接看到界面效果、并在浏览器里拖动窗口宽度验证响应式。
 * CSS 单一来源（始终读脚本里的 UI_CSS），不会出现样式漂移。
 *
 * 用法：npm run preview
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SCRIPT = 'Quark_Enhancement_Master.user.js';
const OUT = 'preview.html';

const src = readFileSync(SCRIPT, 'utf8');
const START = 'const UI_CSS = `';
const ai = src.indexOf(START);
if (ai < 0) throw new Error('未找到 UI_CSS 定义，脚本结构可能已变化');
const bi = src.indexOf('`;', ai + START.length);
if (bi < 0) throw new Error('未找到 UI_CSS 结束标记');
const css = src.slice(ai + START.length, bi);
const version = (src.match(/const VERSION = '([^']+)'/) || [])[1] || '?';

/* ---------- 演示数据（全部为占位内容） ---------- */
const THUMB = (a, b) => `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="60" height="60" fill="url(#g)"/></svg>`,
)}`;

const FILES = [
    { icon: '📁', name: '影视素材', size: '12 项', tag: '文件夹', thumb: '' },
    { icon: '🎬', name: '电影A.2024.1080p.mkv', hl: '电影A.<mark class="qem-hl">2024</mark>.1080p.mkv', size: '2.00 GB', tag: '视频 · mkv', thumb: THUMB('#0f83e6', '#0067c0'), sel: true, cur: true },
    { icon: '🎬', name: '合集教程第01集.mp4', size: '100.00 MB', tag: '视频 · mp4', thumb: THUMB('#2fbf8f', '#16a06b') },
    { icon: '🖼️', name: '设计稿-封面.png', size: '1.24 MB', tag: '图片 · png', thumb: THUMB('#e6a23c', '#d97706') },
    { icon: '📄', name: '项目文档.pdf', size: '840.00 KB', tag: '文档 · pdf', thumb: '' },
    { icon: '🗜️', name: '素材包.zip', size: '512.00 MB', tag: '压缩包 · zip', thumb: '' },
    { icon: '🎵', name: '背景音乐.mp3', size: '8.20 MB', tag: '音频 · mp3', thumb: '' },
];

const TOOLBAR_GROUPS = [
    ['⟳ 刷新', '📁 新建文件夹'],
    ['✏️ 批量重命名', '📥 下载', '🔗 直链', '✂️ 移动', { label: '🗑 删除', cls: 'danger' }],
    ['🔍 文件透视', '🧬 文件查重', '🔤 文件夹查重', '🧹 资源清理'],
    ['🌲 目录树', '🎵 M3U', '📄 磁链', '📊 CSV', '🖼 以图搜图'],
    ['🔗 创建分享', '🧩 解析分享', '♻️ 回收站'],
    ['↩ 撤销', '🕘 操作历史', '🧾 目录快照', '📊 空间分析', '⇕ 标准', '🔲 缩略图'],
];

const toolbarHtml = TOOLBAR_GROUPS
    .map((g) => g.map((b) => (typeof b === 'string'
        ? `<button>${b}</button>`
        : `<button class="${b.cls}">${b.label}</button>`)).join(''))
    .join('<span class="qem-sep"></span>');

const rowsHtml = FILES.map((f) => `
        <tr class="${[f.sel ? 'sel' : '', f.cur ? 'cur' : ''].filter(Boolean).join(' ')}">
          <td><input type="checkbox"${f.sel ? ' checked' : ''}></td>
          <td><div class="name">${f.thumb
        ? `<img class="qem-thumb" src="${f.thumb}" alt="">`
        : `<span>${f.icon}</span>`}<span class="txt">${f.hl || f.name}</span></div></td>
          <td class="num">${f.size}</td>
          <td><span class="qem-tag">${f.tag}</span></td>
          <td>2026-10-11 15:20</td>
        </tr>`).join('');

const rankRows = [
    ['视频（mp4 / mkv）', 68, '8.42 GB'],
    ['压缩包（zip / rar）', 42, '5.10 GB'],
    ['图片（png / jpg）', 21, '2.30 GB'],
    ['文档（pdf / docx）', 8, '640.00 MB'],
].map(([k, pct, v]) => `
      <tr>
        <td><div class="qem-rank"><span class="grow ellipsis">${k}</span>
          <span class="track"><i style="width:${pct}%"></i></span>
          <span class="val">${v}</span></div></td>
        <td class="num">${pct}%</td>
      </tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>夸克增强大师 · UI 预览 v${version}</title>
<style>
/* ============ 以下为本页框架样式（非脚本样式） ============ */
html, body { margin: 0; padding: 0; background: #eef1f5; }
body.page-dark { background: #16181a; }
.pv-bar { position: sticky; top: 0; z-index: 99; display: flex; align-items: center; gap: 10px;
  padding: 12px 20px; background: #fff; border-bottom: 1px solid #e3e6ea; flex-wrap: wrap;
  font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
body.page-dark .pv-bar { background: #1f2123; border-bottom-color: #333; color: #f5f5f5; }
.pv-bar strong { font-size: 14px; }
.pv-bar .pv-muted { color: #7d848c; }
.pv-bar button { font: inherit; padding: 5px 12px; border: 1px solid #d9dce1; border-radius: 6px;
  background: #fff; color: inherit; cursor: pointer; }
.pv-bar button:hover { background: #eef0f3; }
body.page-dark .pv-bar button { background: #26282b; border-color: #404347; }
body.page-dark .pv-bar button:hover { background: #2d2f33; }
.pv-bar button.on { background: #0067c0; border-color: #0067c0; color: #fff; }
.pv-wrap { padding: 22px 20px 60px; max-width: 1240px; margin: 0 auto; }
.pv-sec { margin-bottom: 26px; }
.pv-sec > h2 { font: 600 13px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif;
  color: #7d848c; text-transform: uppercase; letter-spacing: .08em; margin: 0 0 10px; }
body.page-dark .pv-sec > h2 { color: #8a9199; }
.pv-note { font: 12px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif; color: #7d848c; margin-top: 8px; }
/* 预览用：把固定定位的遮罩/弹窗收敛成页内块，便于同屏对比 */
.pv-inline-mask { position: relative !important; inset: auto !important; padding: 24px; border-radius: 12px; }
.pv-inline-toasts { position: static !important; align-items: flex-start; }
/* ============ 以下为脚本抽取的真实样式 ============ */
${css}
</style>
</head>
<body>
<div class="pv-bar">
  <strong>夸克增强大师 · UI 预览</strong>
  <span class="pv-muted">v${version}　（样式直接从用户脚本的 UI_CSS 抽取，非另写一份）</span>
  <span class="grow" style="flex:1"></span>
  <button id="pv-theme">切换深色</button>
  <button id="pv-narrow">模拟窄屏 (420px)</button>
  <button id="pv-reset">恢复宽度</button>
</div>

<div class="pv-wrap">

  <div class="pv-sec">
    <h2>工作台面板（页眉 / 面包屑 / 常用目录条 / 筛选条 / 分组工具栏 / 内容区 / 状态栏）</h2>
    <div class="qem-scope" id="pv-scope">
      <div class="qem-panel qem-lg" style="width:100%;height:auto;max-width:1200px">
        <div class="qem-head">
          <div class="title grow ellipsis">夸克增强大师 · 工作台</div>
          <button class="ghost" title="设置">⚙</button>
          <button class="ghost" title="关闭">✕</button>
        </div>
        <div class="qem-body">
          <div class="col" style="margin-bottom:10px">
            <div class="qem-crumb">
              <button>我的网盘</button><span class="sep">›</span>
              <button>影视素材</button><span class="sep">›</span>
              <button>2024 合集</button>
            </div>
            <div class="qem-books">
              <span class="lab">★</span>
              <button>影视素材</button>
              <button class="on">2024 合集</button>
              <button>待整理</button>
              <button class="bad">已删除的目录</button>
              <button class="ghost">管理</button>
            </div>
            <div class="qem-search on">
              <div class="box">
                <span class="ico">🔎</span>
                <input type="text" value="2024" placeholder="筛选当前目录">
                <button class="clr on">✕</button>
              </div>
              <span class="stat">筛选 1 / 7</span>
              <span class="hint">关键词 2024</span>
              <button>全盘搜索</button>
            </div>
            <div class="qem-toolbar">${toolbarHtml}</div>
          </div>
          <div class="qem-content">
            <div class="qem-scroll" style="max-height:none">
              <table class="qem-table">
                <thead><tr>
                  <th style="width:30px"><input type="checkbox"></th>
                  <th title="点击切换排序">名称 ▲</th>
                  <th style="text-align:right" title="点击切换排序">大小/数量</th>
                  <th>类型</th>
                  <th title="点击切换排序">修改时间</th>
                </tr></thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="qem-foot">
          <span class="muted" style="margin-right:auto">已选 1 项　|　共 7 项　|　可撤销：批量重命名（3 项）</span>
          <button>⚙ 设置</button>
          <button>关闭</button>
        </div>
      </div>
    </div>
    <p class="pv-note">拖动浏览器窗口变窄（或点上方「模拟窄屏」）可验证响应式：小于 720px 时大面板转为全屏、内边距与工具栏间距收紧；触控设备下按钮与表格行会放大点击区域。</p>
  </div>

  <div class="pv-sec">
    <h2>表格密度（视图偏好三档）</h2>
    <div class="qem-scope">
      <div class="row" style="align-items:flex-start;gap:18px;flex-wrap:wrap">
        ${['compact', 'normal', 'loose'].map((d) => `
        <div class="qem-content" style="flex:1;min-width:290px">
          <div class="qem-scroll" style="max-height:none">
            <table class="qem-table d-${d}">
              <thead><tr><th style="width:26px"><input type="checkbox"></th><th>名称</th><th style="text-align:right">大小</th></tr></thead>
              <tbody>
                <tr><td><input type="checkbox"></td><td><div class="name"><span>🎬</span><span class="txt">电影A.2024.1080p.mkv</span></div></td><td class="num">2.00 GB</td></tr>
                <tr class="sel"><td><input type="checkbox" checked></td><td><div class="name"><span>🖼️</span><span class="txt">设计稿-封面.png</span></div></td><td class="num">1.24 MB</td></tr>
                <tr><td><input type="checkbox"></td><td><div class="name"><span>📄</span><span class="txt">项目文档.pdf</span></div></td><td class="num">840.00 KB</td></tr>
              </tbody>
            </table>
          </div>
        </div>`).join('')}
      </div>
      <p class="pv-note">d-compact / d-normal / d-loose　——　与工具栏「⇕」按钮对应，可按目录独立记忆。</p>
    </div>
  </div>

  <div class="pv-sec">
    <h2>弹窗、表单与组件</h2>
    <div class="qem-scope">
      <div class="row" style="align-items:flex-start;gap:18px;flex-wrap:wrap">
        <div class="qem-panel qem-sm" style="flex:0 0 340px">
          <div class="qem-head"><div class="title grow ellipsis">批量重命名</div><button class="ghost">✕</button></div>
          <div class="qem-body col">
            <div class="qem-drop">
              <div style="font-weight:600;margin-bottom:8px">② 查找替换</div>
              <div class="row"><div class="muted" style="min-width:96px">查找</div><input type="text" value="2024" class="grow"></div>
              <div class="row" style="margin-top:8px"><div class="muted" style="min-width:96px">替换为</div><input type="text" value="2026" class="grow"></div>
            </div>
            <div class="row"><div class="muted" style="min-width:96px">类型</div>
              <select class="grow"><option>保持不变</option><option>全小写</option></select></div>
            <label><input type="checkbox" checked> 区分大小写</label>
          </div>
          <div class="qem-foot">
            <span class="muted grow">共 12 项，将重命名 <b>9</b> 项　<span class="qem-tag err">1 项有冲突</span></span>
            <button>关闭</button><button class="primary">应用重命名</button>
          </div>
        </div>

        <div class="qem-scope" style="flex:1;min-width:300px">
          <div class="col">
            <div class="drop qem-drop">
              <div style="font-weight:600;margin-bottom:6px">进度与状态</div>
              <div class="muted" style="margin-bottom:6px">已重命名 342 / 500</div>
              <div class="qem-bar"><i style="width:68%"></i></div>
              <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:6px">
                <span class="qem-tag">默认</span><span class="qem-tag ok">可撤销</span>
                <span class="qem-tag warn">临期 3 天</span><span class="qem-tag err">1 项冲突</span>
              </div>
              <div class="qem-seg" style="margin-top:12px"><button class="active">列表</button><button>网格</button></div>
            </div>

            <div class="qem-content" style="padding:12px">
              <div style="font-weight:600;margin-bottom:8px">空间占用 · 按类型聚合</div>
              <table class="qem-table"><tbody>${rankRows}</tbody></table>
            </div>

            <div class="qem-empty">这里什么也没有</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="pv-sec">
    <h2>提示条（Toast）</h2>
    <div class="qem-scope">
      <div class="qem-toasts pv-inline-toasts">
        <div class="qem-toast">已移入回收站 12 项，可通过 Alt+Z 撤销</div>
        <div class="qem-toast warn">回收站有 3 项即将过期，过期后无法还原</div>
        <div class="qem-toast error">接口连续失败 6 次，已暂停请求 30 秒（疑似官方接口异常）</div>
      </div>
    </div>
  </div>

  <div class="pv-sec">
    <h2>确认弹窗（遮罩 + 面板）</h2>
    <div class="qem-scope">
      <div class="qem-mask pv-inline-mask">
        <div class="qem-panel qem-sm">
          <div class="qem-head"><div class="title grow ellipsis">确认</div><button class="ghost">✕</button></div>
          <div class="qem-body" style="white-space:pre-wrap">将把 12 个项目移入回收站，可稍后还原。是否继续？</div>
          <div class="qem-foot" style="justify-content:flex-end">
            <button>取消</button><button class="danger">移入回收站</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="pv-sec">
    <h2>悬浮球</h2>
    <div class="qem-scope" style="position:relative;height:90px">
      <button class="qem-fab" style="position:static">☁</button>
    </div>
    <p class="pv-note">实际运行时固定在页面右下角（可拖拽），配色与图标已由绿改为上游同源的蓝。</p>
  </div>

</div>

<script>
  // 预览页交互：主题切换 / 宽度模拟（与脚本运行无关）
  var scope = document.getElementById('pv-scope');
  var themeBtn = document.getElementById('pv-theme');
  themeBtn.addEventListener('click', function () {
    var dark = document.body.classList.toggle('page-dark');
    document.querySelectorAll('.qem-scope').forEach(function (el) { el.classList.toggle('qem-dark', dark); });
    themeBtn.classList.toggle('on', dark);
    themeBtn.textContent = dark ? '切换浅色' : '切换深色';
  });
  var wrap = document.querySelector('.pv-wrap');
  var baseWidth = null;
  document.getElementById('pv-narrow').addEventListener('click', function () {
    if (baseWidth === null) baseWidth = wrap.style.maxWidth || '1240px';
    wrap.style.maxWidth = '420px';
  });
  document.getElementById('pv-reset').addEventListener('click', function () {
    wrap.style.maxWidth = baseWidth || '1240px';
  });
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`✅ 已生成 ${OUT}（CSS ${css.split('\n').length} 行，脚本 v${version}）`);
console.log('   直接双击打开即可；拖动窗口宽度或点顶部按钮可验证响应式。');
