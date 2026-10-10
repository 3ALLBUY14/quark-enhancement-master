// 校验用户脚本头部的关键字段，以及版本号在三处（头部 / 脚本常量 / package.json）是否一致
// 版本漂移是用户脚本项目最常见的低级错误，交由 CI 兜住。
import { readFileSync } from 'node:fs';

const SCRIPT = 'Quark_Enhancement_Master.user.js';
const REQUIRED = ['name', 'namespace', 'version', 'match', 'grant', 'run-at', 'description'];

const src = readFileSync(SCRIPT, 'utf8');
const end = src.indexOf('// ==/UserScript==');
if (end < 0) {
    console.error(`用户脚本头校验失败：${SCRIPT} 中找不到 // ==/UserScript== 结束标记`);
    process.exit(1);
}
const head = src.slice(0, end);
const errors = [];

const pick = (key) => {
    const m = new RegExp(`^//\\s*@${key}\\s+(.+)$`, 'm').exec(head);
    return m ? m[1].trim() : '';
};

REQUIRED.forEach((k) => { if (!pick(k)) errors.push(`缺少 @${k}`); });

const matches = (head.match(/^\/\/\s*@match\s+(.+)$/gm) || [])
    .map((s) => s.replace(/^\/\/\s*@match\s+/, '').trim());

const headVersion = pick('version');
const constVersion = (/const VERSION = '([^']+)'/.exec(src) || [])[1];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

if (!constVersion) errors.push('脚本内缺少 VERSION 常量');
else if (constVersion !== headVersion) errors.push(`版本不一致：头部 @version=${headVersion}，脚本常量 VERSION=${constVersion}`);

if (pkg.version !== headVersion) errors.push(`版本不一致：package.json=${pkg.version}，脚本头部=${headVersion}`);

if (!/GM_setValue/.test(head)) errors.push('缺少 GM_setValue 授权（配置持久化依赖）');
if (!/AGPL/.test(head)) errors.push('缺少许可证声明');

if (errors.length) {
    console.error(`用户脚本头校验失败：\n - ${errors.join('\n - ')}`);
    process.exit(1);
}
console.log(`用户脚本头校验通过：v${headVersion}，${matches.length} 条 @match，${(head.match(/@grant/g) || []).length} 项授权`);
