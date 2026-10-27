/**
 * 冒烟测试：在 jsdom 中加载用户脚本，用桩数据验证核心链路。
 * 运行：NODE_PATH=<managed node workspace>/node_modules node smoke-test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SCRIPT = path.join(__dirname, '..', 'Quark_Enhancement_Master.user.js');
const code = fs.readFileSync(SCRIPT, 'utf8');

let pass = 0;
let fail = 0;
const results = [];
function check(name, fn) {
    try {
        const r = fn();
        if (r === false) throw new Error('断言为 false');
        pass++;
        results.push(`  ✅ ${name}${typeof r === 'string' ? ' → ' + r : ''}`);
    } catch (e) {
        fail++;
        results.push(`  ❌ ${name} → ${e.message}`);
    }
}

/** 异步断言：fn 返回 false/Promise<false> 视为失败 */
async function checkAsync(name, fn) {
    try {
        const r = await fn();
        if (r === false) throw new Error('断言为 false');
        pass++;
        results.push(`  ✅ ${name}${typeof r === 'string' ? ' → ' + r : ''}`);
    } catch (e) {
        fail++;
        results.push(`  ❌ ${name} → ${e.message}`);
    }
}

/** 断言工具：不满足时抛出带上下文的错误（避免「返回字符串」被当成通过） */
function expect(cond, detail) {
    if (!cond) throw new Error(detail || '断言为 false');
    return true;
}

/* ---------------- 桩数据 ---------------- */

const FILES = {
    '0': [
        { fid: 'f_a', file_name: '电影A.2024.1080p.mkv', pdir_fid: '0', dir: false, size: 2147483648, updated_at: 1735660800000, created_at: 1730000000000, format_type: 'mkv' },
        { fid: 'f_b', file_name: '电影A·2024·1080p.mkv', pdir_fid: '0', dir: false, size: 2147483648, updated_at: 1735660800000, created_at: 1730000000000, format_type: 'mkv' },
        { fid: 'f_c', file_name: '[合集] 教程 第01集.mp4', pdir_fid: '0', dir: false, size: 104857600, updated_at: 1710000000000, created_at: 1710000000000, format_type: 'mp4' },
        { fid: 'f_d', file_name: '合集教程第1集.mp4', pdir_fid: '0', dir: false, size: 104857600, updated_at: 1710000000000, created_at: 1710000000000, format_type: 'mp4' },
        { fid: 'd_1', file_name: '影视', pdir_fid: '0', dir: true, size: 0, updated_at: 1730000000000, created_at: 1730000000000, include_items: 2 },
        { fid: 'd_2', file_name: '影视 ', pdir_fid: '0', dir: true, size: 0, updated_at: 1730000000000, created_at: 1730000000000, include_items: 2 },
        { fid: 'f_e', file_name: '空文件.txt', pdir_fid: '0', dir: false, size: 0, updated_at: 1700000000000, created_at: 1700000000000, format_type: 'txt' },
        { fid: 'f_f', file_name: '磁力合集.txt', pdir_fid: '0', dir: false, size: 2048, updated_at: 1730000000000, created_at: 1730000000000, format_type: 'txt' },
    ],
    'd_1': [
        { fid: 'f_g', file_name: 'S01E01.mkv', pdir_fid: 'd_1', dir: false, size: 1048576000, updated_at: 1730000000000, created_at: 1730000000000 },
        { fid: 'f_h', file_name: 'S01E02.mkv', pdir_fid: 'd_1', dir: false, size: 1048576000, updated_at: 1730000000000, created_at: 1730000000000 },
    ],
    'd_2': [
        { fid: 'f_i', file_name: 'S01E01.mkv', pdir_fid: 'd_2', dir: false, size: 1048576000, updated_at: 1730000000000, created_at: 1730000000000 },
        { fid: 'f_j', file_name: 'S01E02.mkv', pdir_fid: 'd_2', dir: false, size: 1048576000, updated_at: 1730000000000, created_at: 1730000000000 },
    ],
};

const TXT_BODY = '这是磁链合集\nmagnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\nmagnet:?xt=urn:btih:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\ned2k://|file|x.mkv|1024|CCCC|/\nhttps://example.com/a.torrent\n';

const calls = [];
let deleted = [];              // 模拟回收站：记录被删除的 fid
let recycleFixture = null;     // 覆盖回收站返回（测试临期预警用）
let renameFailsOn = [];        // 这些 fid 的重命名请求返回失败
let deleteFailsOn = [];        // 命中这些 fid 的删除请求整片失败
let listFailsOn = [];          // 这些 pdir 的列表请求返回失败（模拟目录已删除）
let moveFailsOn = [];          // 目标目录命中这些 fid 的移动请求失败
// 缩略图占位（脱敏：纯色 SVG，非真实素材）
const THUMB_DATA = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22%230067c0%22/%3E%3C/svg%3E';
const FLAT = {};
Object.values(FILES).flat().forEach((f) => { FLAT[f.fid] = f; });

function stubFetch(url, init) {
    const u = String(url);
    calls.push({ url: u, method: (init && init.method) || 'GET', body: init && init.body });
    const ok = (data, metadata) => Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ status: 200, code: 0, message: 'ok', data, metadata: metadata || {} }),
    });
    if (u.includes('/file/sort')) {
        const m = /pdir_fid=([^&]*)/.exec(u);
        const fid = m ? decodeURIComponent(m[1]) : '0';
        if (listFailsOn.includes(fid)) {
            return Promise.resolve({
                ok: true, status: 200,
                json: () => Promise.resolve({ status: 500, code: 23010, message: '目录不存在或已删除' }),
            });
        }
        const list = FILES[fid] || [];
        return ok({ list }, { _total: list.length, _count: list.length, _page: 1 });
    }
    if (u.includes('/file/search')) {
        const m = /[?&]q=([^&]*)/.exec(u);
        const q = m ? decodeURIComponent(m[1]).toLowerCase() : '';
        const list = Object.values(FILES).flat().filter((f) => f.file_name.toLowerCase().includes(q));
        return ok({ list }, { _total: list.length, _count: list.length, _page: 1 });
    }
    if (u.includes('/file/rename')) {
        const body = JSON.parse((init && init.body) || '{}');
        if (renameFailsOn.includes(body.fid)) {
            return Promise.resolve({
                ok: true, status: 200,
                json: () => Promise.resolve({ status: 400, code: 23008, message: '模拟重命名失败（同名冲突）' }),
            });
        }
        return ok({});
    }
    if (u.includes('/file/delete')) {
        const body = JSON.parse((init && init.body) || '{}');
        if ((body.filelist || []).some((f) => deleteFailsOn.includes(f))) {
            return Promise.resolve({
                ok: true, status: 200,
                json: () => Promise.resolve({ status: 500, code: 23009, message: '模拟删除失败（服务端繁忙）' }),
            });
        }
        deleted.push(...(body.filelist || []));
        return ok({});
    }
    if (u.includes('/file/move')) {
        const body = JSON.parse((init && init.body) || '{}');
        if (moveFailsOn.includes(body.to_pdir_fid)) {
            return Promise.resolve({
                ok: true, status: 200,
                json: () => Promise.resolve({ status: 500, code: 23011, message: '模拟移动失败' }),
            });
        }
        return ok({});
    }
    if (u.includes('/file/download')) {
        const body = JSON.parse((init && init.body) || '{}');
        return ok((body.fids || []).map((fid, i) => ({
            fid, download_url: 'https://dl.example.com/' + fid,
            md5: fid.startsWith('f_a') || fid.startsWith('f_b') ? 'MD5_SAME' : 'MD5_' + i,
        })));
    }
    if (u.includes('/member')) return ok({ total_capacity: 6 * 1024 ** 4, use_capacity: 1024 ** 4, member_type: 'SVIP' });
    if (u.includes('/file/recycle/list')) {
        const list = recycleFixture || deleted.map((fid) => ({
            fid: 'rc_' + fid,
            file_name: (FLAT[fid] && FLAT[fid].file_name) || fid,
            size: (FLAT[fid] && FLAT[fid].size) || 0,
            dir: false, updated_at: Date.now(),
        }));
        return ok({ list }, { _total: list.length });
    }
    if (u.includes('/share/mypage/detail')) return ok({ list: [] }, { _total: 0 });
    if (u.startsWith('https://dl.example.com/')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(TXT_BODY) });
    }
    return ok({ list: [] }, { _total: 0 });
}

/* ---------------- 启动 jsdom ---------------- */

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://pan.quark.cn/list#/list/all/0',
    pretendToBeVisual: true,
});
const { window } = dom;

// GM 存储桩
const store = new Map();
window.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
window.GM_setValue = (k, v) => { store.set(k, v); };
window.GM_deleteValue = (k) => { store.delete(k); };
window.GM_listValues = () => Array.from(store.keys());
window.GM_setClipboard = () => { };
window.GM_registerMenuCommand = () => { };
window.GM_xmlhttpRequest = () => { };
window.GM_info = { script: { version: '0.1.0' } };
window.fetch = stubFetch;

// 脚本内的 fetch 是注入时绑定的，测试要能中途替换，故通过可变引用桥接
const fetchHolder = { fn: stubFetch };
const bridgedFetch = function () { return fetchHolder.fn.apply(null, arguments); };

// 一次性消费的确认/输入框桩：自动点“确定”
const origAppendChild = window.Node.prototype.appendChild;
origAppendChild.call(window.document.body, window.document.createElement('div'));

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));

// 执行脚本
const runner = new Function('window', 'document', 'location', 'navigator', 'localStorage', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues', 'GM_setClipboard', 'GM_registerMenuCommand', 'GM_xmlhttpRequest', 'GM_info', 'fetch', 'Blob', 'URL', 'MutationObserver', 'unsafeWindow', code);
try {
    runner(window, window.document, window.location, window.navigator, window.localStorage,
        window.GM_getValue, window.GM_setValue, window.GM_deleteValue, window.GM_listValues,
        window.GM_setClipboard, window.GM_registerMenuCommand, window.GM_xmlhttpRequest, window.GM_info,
        bridgedFetch, window.Blob, window.URL, window.MutationObserver, undefined);
} catch (e) {
    console.log('❌ 脚本执行期抛错：', e.message, '\n', (e.stack || '').split('\n').slice(0, 4).join('\n'));
    process.exit(1);
}

window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

const Q = window.__QEM__;
console.log(`\n夸克增强大师 v${Q && Q.version} 冒烟测试\n${'─'.repeat(56)}`);

check('脚本挂载调试入口 __QEM__', () => !!Q);
check('启动无未捕获异常', () => errors.length === 0 || errors.join('; '));

/* ---------------- 纯函数 ---------------- */

check('体积格式化 2GiB', () => Q.util.humanSize(2147483648) === '2.00 GB');
check('体积解析 "2GB"', () => Q.parseSize('2GB') === 2147483648);
check('体积解析 "100MB"', () => Q.parseSize('100MB') === 104857600);
check('半角 ↔ 全角互转', () => {
    const half = Q.util.toHalfWidth('ＡＢＣ１２３');
    return half === 'ABC123' && Q.util.toFullWidth('ABC') === 'ＡＢＣ';
});
check('磁链提取（magnet/ed2k/http）', () => {
    const l = Q.util.extractLinks(TXT_BODY);
    return l.length === 4 && l[0].startsWith('magnet:?xt=urn:btih:AAAA');
});
check('非法文件名字符清理', () => Q.util.sanitizeName('a/b:c*d?"e<f>g|h') === 'a_b_c_d_e_f_g_h');
check('自然排序 第2集 < 第10集', () => Q.util.naturalCompare('第2集', '第10集') < 0);
check('目录名相似度：影视 vs 影视空格', () => Q.nameSimilarity('影视', '影视 ') === 1);
check('目录名相似度：差异明显应偏低', () => Q.nameSimilarity('影视合集', '考研资料') < 0.2);

/* ---------------- 重命名规则引擎 ---------------- */

check('规则：查找替换', () => Q.renameRules.apply('abc old def.mkv', 0, { find: 'old', replace: 'new' }) === 'abc new def.mkv');
check('规则：正则替换', () => Q.renameRules.apply('EP01.mp4', 0, { find: '(\\d+)', replace: '[$1]', useRegex: true }) === 'EP[01].mp4');
check('规则：序号后缀补零', () => Q.renameRules.apply('a.jpg', 3, { seqEnable: true, seqStart: 1, seqStep: 1, seqPad: 2, seqPos: 'suffix' }) === 'a_04.jpg');
check('规则：序号前缀', () => Q.renameRules.apply('a.jpg', 0, { seqEnable: true, seqStart: 5, seqPad: 3, seqPos: 'prefix', seqSep: '-' }) === '005-a.jpg');
check('规则：扩展名大写', () => Q.renameRules.apply('a.mkv', 0, { extMode: 'upper' }) === 'a.MKV');
check('规则：替换扩展名', () => Q.renameRules.apply('a.txt', 0, { extReplace: 'md' }) === 'a.md');
check('规则：模板 ${name}_${n}.${ext}', () => Q.renameRules.apply('a.jpg', 1, { useTemplate: true, template: '${name}_${n}.${ext}', seqPad: 2, seqStart: 1 }) === 'a_02.jpg');
check('规则：全角转半角', () => Q.renameRules.apply('ＡＢＣ.mkv', 0, { widthMode: 'half' }) === 'ABC.mkv');
check('规则：非法字符被清理', () => !/[\\/:*?"<>|]/.test(Q.renameRules.apply('a/b:c*.mkv', 0, {})));

/* ---------------- 接口与列表 ---------------- */

(async () => {
    const dir = await Q.api.list('0');
    check('目录列表接口返回 8 项', () => dir.items.length === 8);
    check('文件模型归一化（类型识别）', () => {
        const v = dir.items.find((i) => i.fid === 'f_a');
        return v.category === 'video' && v.ext === 'mkv' && v.size === 2147483648;
    });
    check('文件夹归一化 dir=true, category=folder', () => {
        const d = dir.items.find((i) => i.fid === 'd_1');
        return d.dir === true && d.category === 'folder';
    });
    check('排序：文件夹置顶 + 名称升序', () => {
        const sorted = Q.fileModel.sort(dir.items, 'name', 'asc');
        return sorted[0].dir === true;
    });
    const cap = await Q.api.capacity();
    check('容量解析 6TB / 已用 1TB', () => cap.total === 6 * 1024 ** 4 && cap.used === 1024 ** 4);
    check('容量接口会员类型', () => cap.vip === 'SVIP');

    const rc = await Q.api.raw('recycleList', { page: 1, size: 1 });
    check('回收站接口返回结构正确', () => Array.isArray((rc.data || {}).list));

    check('请求带 __t/__dt 时间戳', () => calls.some((c) => c.url.includes('__t=') && c.url.includes('__dt=')));
    check('请求带 pr=ucpro&fr=pc 公共参数', () => calls.every((c) => c.url.includes('pr=ucpro&fr=pc')));
    check('请求指向夸克官方接口基址', () => calls.filter((c) => c.url.includes('quark.cn')).every((c) => c.url.startsWith('https://drive-pc.quark.cn/1/clouddrive/')));

    /* ---------------- 递归扫描 ---------------- */

    const walked = await Q.scanner.walk('0', {});
    check('递归扫描覆盖子树（8 + 2 + 2 = 12）', () => walked.length === 12);
    check('扫描结果携带 path', () => walked.some((w) => w.path === '影视/S01E01.mkv'));

    const sum = Q.scanner.summarize(walked);
    check('汇总统计（文件/文件夹/体积）', () => sum.files === 10 && sum.folders === 2 && sum.size > 0);

    /* ---------------- 工作台 UI ---------------- */

    await Q.workspace.open();
    const root = window.document.getElementById('qem-root');
    check('Shadow 宿主已注入', () => !!root && !!root.shadowRoot);
    check('工作台面板已渲染', () => !!Q.state.ui && window.document.getElementById('qem-root').shadowRoot.querySelectorAll('.qem-panel').length >= 1);
    check('当前目录列表已载入 8 项', () => Q.state.items.length === 8);
    check('表格行数与列表一致', () => {
        const trs = Q.state.table.el.querySelectorAll('tbody tr');
        return trs.length === 8;
    });
    check('工具栏包含关键操作按钮', () => {
        const btns = Array.from(window.document.getElementById('qem-root').shadowRoot.querySelectorAll('button')).map((b) => b.textContent).join('|');
        return ['批量重命名', '文件查重', '资源清理', '导出目录树', '导出 M3U', '提取磁链'].every((k) => btns.includes(k));
    });
    check('选中项计数（选中 3 项）', () => {
        Q.sel.set(['f_a', 'f_b', 'f_c']);
        return Q.sel.count() === 3 && Q.sel.items().length === 3;
    });
    check('反选逻辑', () => {
        Q.sel.invert();
        return Q.sel.count() === 5;
    });
    check('全选逻辑', () => { Q.sel.all(); return Q.sel.count() === 8; });

    check('列头点击切换排序并持久化', () => {
        const root = window.document.getElementById('qem-root').shadowRoot;
        const ths = Array.from(root.querySelectorAll('.qem-table th'));
        const nameTh = ths.find((th) => th.textContent.includes('名称'));
        nameTh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const pref = Q.config.get('sortPref', {})['0'];
        const rows = Q.state.table.el.querySelectorAll('tbody tr').length;
        return !!pref && pref.key === 'name' && pref.order === 'asc' && rows === 8;
    });
    check('二次点击切换为降序', () => {
        const root = window.document.getElementById('qem-root').shadowRoot;
        const ths = Array.from(root.querySelectorAll('.qem-table th'));
        const nameTh = ths.find((th) => th.textContent.includes('名称'));
        nameTh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const pref = Q.config.get('sortPref', {})['0'];
        return pref.key === 'name' && pref.order === 'desc';
    });

    const sub = Q.state.items.find((i) => i.fid === 'd_1');
    await Q.workspace.enter(sub);
    check('进入「影视」后列表为 2 项', () => Q.state.items.length === 2);
    check('面包屑路径长度 2', () => Q.state.path.length === 2);
    await Q.workspace.goUp();
    check('返回上级后列表恢复 8 项', () => Q.state.items.length === 8);

    /* ---------------- 导出 ---------------- */

    const csvRows = Q.state.items.length;
    check('CSV 导出可用', () => { Q.exporter.saveCsv('测试', Q.state.items); return csvRows === 8; });
    const links = await Q.downloader.resolve([Q.state.items.find((i) => i.fid === 'f_a')]);
    check('直链接口解析成功', () => links.length === 1 && links[0].url === 'https://dl.example.com/f_a');

    /* ---------------- 可靠性：对话框（回归：close 触发 onClose 抢先决议） ---------------- */

    const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
    const shadow = () => window.document.getElementById('qem-root').shadowRoot;
    const lastMask = () => {
        const masks = shadow().querySelectorAll('.qem-mask');
        return masks[masks.length - 1] || null;
    };
    /** 点击最上层弹窗中指定文案的按钮；弹窗可能异步出现，故轮询等待 */
    async function clickFoot(label, timeout = 4000) {
        const t0 = Date.now();
        for (;;) {
            const mask = lastMask();
            if (mask) {
                const btns = Array.from(mask.querySelectorAll('.qem-foot button'));
                const b = btns.find((x) => x.textContent.includes(label));
                if (b) { b.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); return true; }
            }
            if (Date.now() - t0 > timeout) return false;
            await tick(30);
        }
    }
    const footLabels = () => {
        const mask = lastMask();
        return mask ? Array.from(mask.querySelectorAll('.qem-foot button')).map((x) => x.textContent).join('/') : '无弹窗';
    };

    {
        const p = Q.ui.confirm('测试确认');
        const clicked = await clickFoot('确定');
        const r = await p;
        check('confirm 点「确定」返回 true（回归）', () => expect(clicked && r === true, `找到按钮=${clicked} 结果=${r}`));
    }
    {
        const p = Q.ui.confirm('测试确认');
        const clicked = await clickFoot('取消');
        const r = await p;
        check('confirm 点「取消」返回 false', () => expect(clicked && r === false, `找到按钮=${clicked} 结果=${r}`));
    }
    {
        const p = Q.ui.prompt('输入名称', { value: '初始值' });
        const input = lastMask().querySelector('input[type=text]');
        check('prompt 渲染输入框且带默认值', () => !!input && input.value === '初始值');
        input.value = '新名称.mkv';
        const clicked = await clickFoot('确定');
        const r = await p;
        check('prompt 点「确定」返回输入值（回归）', () => expect(clicked && r === '新名称.mkv', `找到按钮=${clicked} 结果=${r}`));
    }
    {
        const p = Q.ui.prompt('输入名称');
        const clicked = await clickFoot('取消');
        const r = await p;
        check('prompt 点「取消」返回 null', () => expect(clicked && r === null, `找到按钮=${clicked} 结果=${r}`));
    }

    /* ---------------- 可靠性：同名冲突策略 ---------------- */

    const clashItems = [
        { fid: 'x1', name: 'S01E01.mkv', dir: false, size: 10 },
        { fid: 'x2', name: '新文件A.mkv', dir: false, size: 20 },
        { fid: 'x3', name: '新文件B.mkv', dir: false, size: 30 },
    ];
    {
        const chk = await Q.conflict.check('d_1', clashItems);
        check('同名检测命中目标目录已有项', () => chk.hits.length === 1 && chk.hits[0].name === 'S01E01.mkv');
        const clean = await Q.conflict.resolve('d_1', [{ fid: 'y1', name: '无冲突.mkv', dir: false, size: 1 }], { policy: 'skip' });
        check('无同名冲突时直接放行全部', () => clean.action === 'proceed' && clean.toMove.length === 1 && clean.skipped.length === 0);
    }
    {
        const plan = await Q.conflict.resolve('d_1', clashItems, { policy: 'skip' });
        check('skip：跳过命中项，其余继续', () => plan.action === 'proceed' && plan.toMove.length === 2 && plan.skipped.length === 1);
    }
    {
        const plan = await Q.conflict.resolve('d_1', clashItems, { policy: 'rename' });
        check('rename：生成 _1 序号并保留原名', () => plan.needRename.length === 1 && plan.needRename[0].file_name === 'S01E01_1.mkv' && plan.needRename[0].old === 'S01E01.mkv');
        check('rename：不冲突项原样移动', () => plan.toMove.length === 2);
    }
    check('nextName 递增避让', () => Q.conflict.nextName('a.mkv', new Set(['a.mkv', 'a_1.mkv'])) === 'a_2.mkv');
    check('nextName 无冲突时保持原名', () => Q.conflict.nextName('b.mkv', new Set()) === 'b.mkv');

    /* ---------------- 可靠性：容量预检 ---------------- */

    {
        const s = await Q.capacityGuard.summary();
        check('容量汇总：剩余 = 总量 - 已用', () => !!s && s.total === 6 * 1024 ** 4 && s.remain === 5 * 1024 ** 4);
        const remain = await Q.capacityGuard.remain();
        check('remain() 返回剩余字节', () => remain === 5 * 1024 ** 4);
        await checkAsync('空间充足时 ensure 直接放行（不弹窗）', async () => {
            const before = shadow().querySelectorAll('.qem-mask').length;
            const r = await Q.capacityGuard.ensure(1024, '测试');
            return r === true && shadow().querySelectorAll('.qem-mask').length === before;
        });
    }
    {
        const p = Q.capacityGuard.ensure(99 * 1024 ** 4, '超大转存');
        const clicked = await clickFoot('仍要继续');
        const r = await p;
        await checkAsync('空间不足时弹确认，选继续则放行', async () => expect(clicked && r === true, `找到按钮=${clicked}(${footLabels()}) 结果=${r}`));
    }
    {
        const p = Q.capacityGuard.ensure(99 * 1024 ** 4, '超大转存');
        const clicked = await clickFoot('取消');
        const r = await p;
        await checkAsync('空间不足时选取消则中止', async () => expect(clicked && r === false, `找到按钮=${clicked}(${footLabels()}) 结果=${r}`));
    }

    /* ---------------- 可靠性：操作历史与撤销 ---------------- */

    {
        Q.opLog.clear();
        let renameBody = null;
        fetchHolder.fn = (u, i) => { if (String(u).includes('/file/rename')) renameBody = JSON.parse(i.body); return stubFetch(u, i); };

        Q.opLog.push({ type: 'rename', entries: [{ fid: 'f_a', name: '旧名.mkv', before: '旧名.mkv', after: '新名.mkv' }] });
        check('opLog 记录并返回可撤销项', () => Q.opLog.latestUndoable() && Q.opLog.latestUndoable().count === 1);

        const p = Q.opLog.undo();
        const clicked = await clickFoot('撤销');
        const done = await p;
        check('撤销重命名：调用 rename 并回写原名', () => expect(done === true && clicked && renameBody && renameBody.file_name === '旧名.mkv', `done=${done} 按钮=${clicked} body=${JSON.stringify(renameBody)}`));
        check('撤销后标记为已撤销', () => Q.opLog.list()[0].undone === true);
        check('已撤销项不再出现在可撤销列表', () => Q.opLog.latestUndoable() === null);
        fetchHolder.fn = stubFetch;
    }
    {
        // 删除 → 记录回收站 fid → 撤销走 recycleRestore
        Q.opLog.clear();
        Q.sel.set(['f_a', 'f_b']);
        const p = Q.workspace.deleteSelection();
        const clicked = await clickFoot('移入回收站');
        await p;
        const rec = Q.opLog.latestUndoable();
        check('删除前弹出确认', () => clicked === true);
        check('删除后记录到回收站 fid（按名称+体积匹配）', () => !!rec && rec.type === 'delete' && rec.entries.filter((e) => e.recycleFid).length === 2);
        check('删除记录标记可撤销', () => rec.undoable === true);

        const before = calls.length;
        const p2 = Q.opLog.undo(rec.id);
        const clicked2 = await clickFoot('撤销');
        const ok = await p2;
        const restoreCalls = calls.slice(before).filter((c) => c.url.includes('/file/recycle/restore'));
        check('撤销删除：调用回收站还原接口', () => expect(ok === true && clicked2 && restoreCalls.length === 1 && JSON.parse(restoreCalls[0].body).filelist.length === 2, `ok=${ok} 按钮=${clicked2} 还原请求=${restoreCalls.length}`));
    }
    {
        // 不可撤销的操作应被拒绝
        Q.opLog.clear();
        Q.opLog.push({ type: 'save', entries: [{ fid: 's1', name: 'x' }], createdFids: [], undoable: false, note: '未取回文件标识' });
        const ok = await Q.opLog.undo();
        check('不可撤销的操作被拒绝执行', () => ok === false);
        Q.opLog.clear();
    }

    /* ---------------- 可靠性：熔断与缓存列表保护 ---------------- */

    {
        Q.config.set('breaker.threshold', 3);
        Q.config.set('breaker.cooldown', 30000);
        Q.breaker.reset();
        Q.breaker.recordFail('network');
        Q.breaker.recordFail('network');
        check('未达阈值时不熔断', () => Q.breaker.isOpen() === false);
        Q.breaker.recordFail('network');
        check('达到阈值后熔断开启', () => Q.breaker.isOpen() === true);
        let blocked = null;
        try { await Q.api.raw('list', { pdir_fid: '0' }); } catch (e) { blocked = e; }
        check('熔断期间请求被快速拒绝', () => !!blocked && /暂停请求/.test(blocked.message));
        let passed = false;
        try { await Q.api.raw('capacity', {}, { bypassBreaker: true }); passed = true; } catch (e) { passed = false; }
        check('bypassBreaker 可绕过熔断', () => passed === true);
        Q.breaker.reset();
        check('reset 后恢复正常', () => Q.breaker.isOpen() === false);
        Q.config.set('breaker.threshold', 6);
    }
    {
        // 先成功一次建立缓存，再切断网络，验证列表降级为缓存
        Q.breaker.reset();
        Q.config.set('breaker.threshold', 50);
        await Q.workspace.reload('0');
        const cachedCount = Q.state.items.length;
        const cachedRaw = window.localStorage.getItem('qem_cache_idx_0');
        fetchHolder.fn = () => Promise.reject(new TypeError('Failed to fetch'));
        Q.breaker.reset();
        await Q.workspace.reload('0');
        const afterFail = Q.state.items.length;
        const stale = Q.state.stale;
        fetchHolder.fn = stubFetch;
        Q.breaker.reset();
        Q.config.set('breaker.threshold', 6);
        await Q.workspace.reload('0');
        check('目录索引已写入本地缓存', () => expect(!!cachedRaw, `cachedRaw=${cachedRaw === null ? 'null' : 'ok'}`));
        check('接口失败时降级为缓存列表而非清空', () => expect(afterFail === cachedCount && afterFail > 0 && !!stale,
            `缓存前=${cachedCount} 失败后=${afterFail} stale=${!!stale}`));
        check('恢复后清除缓存降级标记', () => expect(Q.state.stale === null, `stale=${JSON.stringify(Q.state.stale)}`));
    }

    /* ---------------- 防丢失：目录快照与差异对比 ---------------- */

    const mksnap = (items, rootFid = '0') => ({
        v: 1, id: Q.util.uuid(), label: 'snap', at: Date.now(),
        root: { fid: rootFid, name: '我的网盘' }, deep: false,
        count: items.length, size: items.reduce((s, i) => s + (i.size || 0), 0),
        items: Q.snapshot.pack(items),
    });

    check('快照压缩打包/解包无损', () => {
        const src = [{ path: 'a/b.mkv', size: 123, updated_at: 456, dir: false, fid: 'f1' }];
        const back = Q.snapshot.unpack(Q.snapshot.pack(src));
        return back.length === 1 && back[0].path === 'a/b.mkv' && back[0].size === 123 && back[0].updated_at === 456 && back[0].name === 'b.mkv';
    });
    check('识别位置变化（同名称同体积跨路径）', () => {
        const A = mksnap([{ path: 'r/a.mkv', size: 100, updated_at: 1, dir: false }, { path: 'r/b.mkv', size: 200, updated_at: 1, dir: false }]);
        const B = mksnap([{ path: 'r/sub/a.mkv', size: 100, updated_at: 1, dir: false }, { path: 'r/b.mkv', size: 200, updated_at: 1, dir: false }]);
        const d = Q.snapshot.compare(A, B);
        return expect(d.moved.length === 1 && d.added.length === 0 && d.removed.length === 0,
            `moved=${d.moved.length} added=${d.added.length} removed=${d.removed.length}`);
    });
    check('识别新增与缺失', () => {
        const A = mksnap([{ path: 'r/a.mkv', size: 1, updated_at: 1, dir: false }]);
        const B = mksnap([{ path: 'r/c.mkv', size: 2, updated_at: 1, dir: false }]);
        const d = Q.snapshot.compare(A, B);
        return expect(d.added.length === 1 && d.removed.length === 1 && d.moved.length === 0,
            `added=${d.added.length} removed=${d.removed.length} moved=${d.moved.length}`);
    });
    check('识别内容变化（体积/时间）并统计增量', () => {
        const A = mksnap([{ path: 'r/a.mkv', size: 100, updated_at: 1, dir: false }]);
        const B = mksnap([{ path: 'r/a.mkv', size: 250, updated_at: 9, dir: false }]);
        const d = Q.snapshot.compare(A, B);
        return expect(d.changed.length === 1 && d.stats.changedDelta === 150,
            `changed=${d.changed.length} delta=${d.stats.changedDelta}`);
    });
    check('同体积同时间不误报变化', () => {
        const A = mksnap([{ path: 'r/a.mkv', size: 100, updated_at: 5, dir: false }]);
        const B = mksnap([{ path: 'r/a.mkv', size: 100, updated_at: 5, dir: false }]);
        const d = Q.snapshot.compare(A, B);
        return d.stats.total === 0;
    });
    check('快照数量上限裁剪', () => {
        const arr = Array.from({ length: 12 }, (_, i) => mksnap([], '0'));
        arr.forEach((s, i) => { s.id = 's' + i; });
        Q.snapshot.persist(arr);
        const n = Q.snapshot.list().length;
        Q.snapshot.clear();
        return expect(n === Q.snapshot.MAX, `实际保留 ${n}，上限 ${Q.snapshot.MAX}`);
    });

    {
        // 端到端：采集 → 改动网盘 → 再采集 → 比对
        Q.snapshot.clear();
        Q.state.cwd = '0';
        Q.state.path = [{ fid: '0', name: '我的网盘' }];
        await Q.workspace.reload('0');
        const s1 = await Q.snapshot.capture({ label: '基线', scope: 'current' });
        check('采集快照并入库', () => expect(!!s1 && s1.count === 8 && Q.snapshot.list().length === 1, `count=${s1 && s1.count} 库=${Q.snapshot.list().length}`));

        const orig = FILES['0'];
        FILES['0'] = orig
            .filter((f) => f.fid !== 'f_c')
            .map((f) => (f.fid === 'f_e' ? { ...f, size: 123 } : f))
            .concat([{ fid: 'f_new', file_name: '新出现的.mkv', pdir_fid: '0', dir: false, size: 777, updated_at: Date.now(), created_at: Date.now() }]);
        await Q.workspace.reload('0');
        const s2 = await Q.snapshot.capture({ label: '改动后', scope: 'current' });
        const d = Q.snapshot.compare(s1, s2);
        check('端到端：检测到新增文件', () => expect(d.added.length === 1 && d.added[0].name === '新出现的.mkv', `added=${d.added.length}`));
        check('端到端：检测到缺失文件', () => expect(d.removed.length === 1 && d.removed[0].name.includes('合集'), `removed=${JSON.stringify(d.removed.map((r) => r.name))}`));
        check('端到端：检测到体积变化', () => expect(d.changed.some((c) => c.name === '空文件.txt' && c.newSize === 123), `changed=${JSON.stringify(d.changed.map((c) => c.name))}`));

        FILES['0'] = orig;
        await Q.workspace.reload('0');
        Q.snapshot.clear();
    }

    /* ---------------- 防丢失：回收站临期预警 ---------------- */

    {
        const now = Date.now();
        const day = 86400000;
        check('剩余天数按保留期估算（30 天制）', () => {
            const r = Q.trash.remainDays({ time: now - 28 * day });
            return expect(r === 2, `得到 ${r}`);
        });
        check('优先采用官方 remain_day', () => Q.trash.remainDays({ time: now, remainDay: 1 }) === 1);
        check('优先采用官方 expired_at', () => {
            const r = Q.trash.remainDays({ time: now, expiredAt: now + 2 * day });
            return expect(r === 2, `得到 ${r}`);
        });
        check('无时间信息时返回 null', () => Q.trash.remainDays({}) === null);

        recycleFixture = [
            { fid: 't1', file_name: '快过期.mkv', size: 10, dir: false, updated_at: now - 28 * day },
            { fid: 't2', file_name: '还早.mkv', size: 10, dir: false, updated_at: now - 1 * day },
            { fid: 't3', file_name: '官方给值.mkv', size: 10, dir: false, updated_at: now, remain_day: 1 },
            { fid: 't4', file_name: '有过期时间.mkv', size: 10, dir: false, updated_at: now, expired_at: now + 2 * day },
        ];
        const soon = await Q.trash.expiring(3);
        check('临期筛选（3 天内）命中 3 项', () => expect(soon.length === 3, `命中 ${soon.length}`));
        check('临期筛选排除未到期项', () => !soon.some((x) => x.name === '还早.mkv'));
        const all = await Q.trash.expiring(99);
        check('放宽阈值后全部命中', () => expect(all.length === 4, `命中 ${all.length}`));
        recycleFixture = null;
    }

    /* ---------------- 配置版本历史与回滚 ---------------- */

    {
        Q.config.set('cfgHistory.auto', false);   // 先关自动快照，保证下面计数确定
        Q.cfgHistory.persist([]);

        const flat = Q.cfgHistory.flatten({ a: 1, b: { c: 2, d: { e: 3 } }, arr: [1, 2] });
        check('配置展平：标量 + 两层嵌套 + 数组整体', () => expect(
            flat.a === 1 && flat['b.c'] === 2 && flat['b.d.e'] === 3 && flat.arr === '[1,2]',
            JSON.stringify(flat)));

        const d1 = Q.cfgHistory.diff({ x: 1, y: 2 }, { x: 1, y: 3, z: 4 });
        check('配置差异：识别「修改」与「新增」', () => expect(
            d1.length === 2 && d1.some((r) => r.path === 'y' && r.before === 2 && r.after === 3) && d1.some((r) => r.path === 'z'),
            JSON.stringify(d1)));
        const d2 = Q.cfgHistory.diff({ x: 1 }, {});
        check('配置差异：识别「删除」', () => expect(d2.length === 1 && d2[0].path === 'x' && d2[0].after === undefined, JSON.stringify(d2)));
        check('配置无差异时返回空数组', () => Q.cfgHistory.diff({ a: 1, b: { c: 'x' } }, { a: 1, b: { c: 'x' } }).length === 0);

        const r1 = Q.cfgHistory.push('manual', '第一版');
        check('存档一版', () => expect(!!r1 && Q.cfgHistory.list().length === 1 && Q.cfgHistory.list()[0].note === '第一版',
            `list=${Q.cfgHistory.list().length}`));
        const r2 = Q.cfgHistory.push('manual', '重复内容');
        check('内容相同不重复存档', () => expect(r2 === null && Q.cfgHistory.list().length === 1, `r2=${r2 === null ? 'null' : 'rec'}`));

        Q.config.set('minInterval', 777);
        const r3 = Q.cfgHistory.push('manual', '改了间隔');
        check('变更后存档并记录差异处数', () => expect(!!r3 && r3.changes >= 1, `changes=${r3 && r3.changes}`));

        const preHash = Q.cfgHistory.hashOf(Q.config.data);
        const restorePromise = Q.cfgHistory.restore(r1.id);
        const clickedRestore = await clickFoot('恢复');
        const restored = await restorePromise;
        check('回滚：恢复旧配置值', () => expect(restored === true && clickedRestore && Q.config.get('minInterval', 0) !== 777,
            `restored=${restored} 点击=${clickedRestore} minInterval=${Q.config.get('minInterval', 0)}`));
        check('回滚：恢复前状态仍可回退（已留档）', () => expect(
            Q.cfgHistory.list().some((r) => r.hash === preHash),
            `来源=${Q.cfgHistory.list().map((r) => r.reason).join(',')}`));

        // 场景二：恢复前状态尚未被记录时，应自动补一版备份
        Q.config.set('minInterval', 555);
        const preHash2 = Q.cfgHistory.hashOf(Q.config.data);
        const wasRecorded = Q.cfgHistory.list().some((r) => r.hash === preHash2);
        const p2 = Q.cfgHistory.restore(r1.id);
        const clicked2 = await clickFoot('恢复');
        const ok2 = await p2;
        check('回滚：未留档的状态会补一版备份', () => expect(
            clicked2 && ok2 && Q.cfgHistory.list().some((r) => r.reason === 'backup' && r.hash === preHash2),
            `已被记录=${wasRecorded} rebuilt=${Q.cfgHistory.list().some((r) => r.reason === 'backup')}`));

        for (let i = 0; i < 25; i++) {
            Q.config.set('minInterval', 100 + i);
            Q.cfgHistory.push('manual', 'v' + i);
        }
        check('配置历史按上限裁剪', () => expect(Q.cfgHistory.list().length === Q.cfgHistory.MAX,
            `实际 ${Q.cfgHistory.list().length}，上限 ${Q.cfgHistory.MAX}`));

        Q.cfgHistory.persist([]);
        Q.config.set('minInterval', 120);
    }
    {
        // 自动快照：节流 + 去重 + 开关
        Q.cfgHistory.persist([]);
        Q.config.set('cfgHistory.auto', true);
        Q.cfgHistory.lastAutoAt = 0;
        Q.cfgHistory.autoSnapshot();
        check('自动快照：开启后记录一版', () => expect(
            Q.cfgHistory.list().length === 1 && Q.cfgHistory.list()[0].reason === 'auto',
            `list=${Q.cfgHistory.list().length}`));

        Q.cfgHistory.autoSnapshot();
        check('自动快照：间隔内不重复记录', () => Q.cfgHistory.list().length === 1);

        Q.cfgHistory.lastAutoAt = 0;
        Q.cfgHistory.autoSnapshot();
        check('自动快照：内容未变化不记录', () => Q.cfgHistory.list().length === 1);

        Q.cfgHistory.lastAutoAt = Date.now();
        Q.config.set('minInterval', 300);
        check('自动快照：节流窗口内即使内容变化也不记录', () => expect(Q.cfgHistory.list().length === 1,
            `list=${Q.cfgHistory.list().length}`));

        Q.cfgHistory.lastAutoAt = 0;
        Q.config.set('minInterval', 310);
        check('自动快照：由配置变更回调触发', () => expect(Q.cfgHistory.list().length === 2,
            `list=${Q.cfgHistory.list().length}`));

        Q.config.set('cfgHistory.auto', false);
        Q.cfgHistory.lastAutoAt = 0;
        const n0 = Q.cfgHistory.list().length;
        Q.config.set('minInterval', 320);
        check('自动快照：关闭后不再记录', () => expect(Q.cfgHistory.list().length === n0, `list=${Q.cfgHistory.list().length}`));

        Q.cfgHistory.persist([]);
        Q.config.set('minInterval', 120);
    }

    /* ---------------- 统一删除入口 ---------------- */

    {
        Q.opLog.clear();
        deleted.length = 0;
        const n = await Q.deleteWithUndo([
            { fid: 'f_a', name: '电影A.2024.1080p.mkv', size: 2147483648, pdir_fid: '0' },
            { fid: 'f_b', name: '电影A·2024·1080p.mkv', size: 2147483648, pdir_fid: '0' },
        ], { label: '测试删除' });
        check('统一删除入口返回删除数量', () => expect(n === 2, `n=${n}`));
        const rec = Q.opLog.latestUndoable();
        check('统一删除入口登记回收站 fid（可撤销）', () => expect(
            !!rec && rec.type === 'delete' && rec.label === '测试删除' && rec.entries.filter((e) => e.recycleFid).length === 2,
            `rec=${rec && rec.type} 已登记=${rec && rec.entries.filter((e) => e.recycleFid).length}`));

        const before = calls.length;
        const n2 = await Q.deleteWithUndo([], {});
        check('空列表直接返回 0 且不发请求', () => expect(n2 === 0 && calls.length === before, `n2=${n2} 新请求=${calls.length - before}`));

        Q.opLog.clear();
        deleted.length = 0;
    }

    /* ---------------- 空间占用聚合 ---------------- */

    {
        const files = [
            { path: '根/A/x.mkv', size: 400, ext: 'mkv', category: 'video', dir: false },
            { path: '根/A/y.mp4', size: 100, ext: 'mp4', category: 'video', dir: false },
            { path: '根/B/z.jpg', size: 50, ext: 'jpg', category: 'image', dir: false },
            { path: '根/loose.txt', size: 10, ext: 'txt', category: 'doc', dir: false },
            { path: '根/noext', size: 5, ext: '', category: 'other', dir: false },
        ];
        const byFiles = Q.spaceReport.aggregate(files, 'files', 3);
        check('聚合-单文件：按体积降序且受 TopN 限制', () => expect(
            byFiles.length === 3 && byFiles[0].size === 400 && byFiles[1].size === 100,
            byFiles.map((r) => r.size).join(',')));

        const byExt = Q.spaceReport.aggregate(files, 'ext', 10);
        check('聚合-扩展名：分组累加体积', () => expect(
            byExt.find((r) => r.key === '.mkv').size === 400 && byExt.find((r) => r.key === '(无扩展名)').count === 1,
            JSON.stringify(byExt)));
        check('聚合-扩展名：按体积降序', () => expect(byExt[0].key === '.mkv', JSON.stringify(byExt.map((r) => r.key))));

        const byCat = Q.spaceReport.aggregate(files, 'category', 10);
        check('聚合-类型：视频合计 500 / 2 个', () => expect(
            byCat.find((r) => r.key === '视频').size === 500 && byCat.find((r) => r.key === '视频').count === 2,
            JSON.stringify(byCat)));

        const byDir = Q.spaceReport.aggregate(files, 'topdir', 10);
        check('聚合-一级子目录：A 合计 500', () => expect(
            byDir.find((r) => r.key === 'A').size === 500, JSON.stringify(byDir)));
        check('聚合-一级子目录：根目录散置文件单列', () => expect(
            !!byDir.find((r) => r.key === '(根目录下散置文件)'), JSON.stringify(byDir.map((r) => r.key))));

        check('聚合标签文案', () => Q.spaceReport.groupLabel('files', 3) === '最大的 3 个文件');
    }

    /* ---------------- 视图偏好（按目录独立） ---------------- */

    {
        check('密度循环：紧凑→标准→宽松→紧凑', () => {
            const a = Q.viewPref.nextDensity('compact');
            const b = Q.viewPref.nextDensity('normal');
            const c = Q.viewPref.nextDensity('loose');
            return expect(a === 'normal' && b === 'loose' && c === 'compact', `${a},${b},${c}`);
        });
        check('密度循环：未知值回落到第一档', () => Q.viewPref.nextDensity('怪值') === 'compact');

        Q.config.set('view', { density: 'normal', thumb: false, perDir: true });
        Q.config.set('viewPref', {});
        check('按目录独立：未设置过的目录用默认值', () => {
            const v = Q.viewPref.get('pdir_x');
            return expect(v.density === 'normal' && v.thumb === false, JSON.stringify(v));
        });
        Q.viewPref.set('pdir_x', { density: 'compact', thumb: true });
        check('按目录独立：写入后只影响该目录', () => {
            const x = Q.viewPref.get('pdir_x');
            const y = Q.viewPref.get('pdir_y');
            return expect(x.density === 'compact' && x.thumb === true && y.density === 'normal' && y.thumb === false,
                `x=${JSON.stringify(x)} y=${JSON.stringify(y)}`);
        });
        check('按目录独立：局部更新不丢其他字段', () => {
            Q.viewPref.set('pdir_x', { density: 'loose' });
            const x = Q.viewPref.get('pdir_x');
            return expect(x.density === 'loose' && x.thumb === true, JSON.stringify(x));
        });

        Q.config.set('view.perDir', false);
        check('关闭目录独立后统一用全局默认', () => {
            const x = Q.viewPref.get('pdir_x');
            return expect(x.density === 'normal' && x.thumb === false, JSON.stringify(x));
        });
        Q.viewPref.set('pdir_z', { density: 'compact' });
        check('关闭目录独立后写入的是全局默认', () => {
            const g = Q.config.get('view', {});
            return expect(g.density === 'compact' && Q.viewPref.get('pdir_z').density === 'compact', JSON.stringify(g));
        });
        Q.viewPref.clearAll();
        check('清理目录级偏好', () => expect(
            Object.keys(Q.config.get('viewPref', {})).length === 0, JSON.stringify(Q.config.get('viewPref', {}))));

        Q.config.set('view', { density: 'normal', thumb: true, perDir: true });
        check('缩略图：仅图片/视频且带封面时启用', () => {
            const pref = Q.viewPref.get('pdir_t');
            return expect(
                Q.viewPref.shouldThumb({ dir: false, category: 'image', thumbnail: 'http://x/1.jpg' }, pref) === true
                && Q.viewPref.shouldThumb({ dir: true, category: 'folder', thumbnail: 'http://x/2.jpg' }, pref) === false
                && Q.viewPref.shouldThumb({ dir: false, category: 'doc', thumbnail: 'http://x/3.pdf' }, pref) === false
                && Q.viewPref.shouldThumb({ dir: false, category: 'image', thumbnail: '' }, pref) === false,
                '四类边界');
        });
        check('缩略图：开关关闭时一律不启用', () => {
            const pref = { density: 'normal', thumb: false };
            return Q.viewPref.shouldThumb({ dir: false, category: 'image', thumbnail: 'http://x/1.jpg' }, pref) === false;
        });
        Q.config.set('view', { density: 'normal', thumb: false, perDir: true });
        Q.config.set('viewPref', {});
    }

    /* ---------------- 跨账号迁移校验 ---------------- */

    {
        check('清单校验：识别非本工具文件', () => {
            const codes = [
                Q.crossCheck.validate(null) === 'not-object',
                Q.crossCheck.validate({ foo: 1 }) === 'wrong-type',
                Q.crossCheck.validate({ __type: 'qem-inventory' }) === 'no-items',
                Q.crossCheck.validate({ __type: 'qem-inventory', items: [] }) === 'no-root',
            ];
            return expect(codes.every(Boolean), JSON.stringify(codes));
        });
        check('清单校验：合法清单通过', () => {
            const inv = { __type: 'qem-inventory', v: 1, root: { name: '我的网盘' }, items: [] };
            return expect(Q.crossCheck.validate(inv) === '', Q.crossCheck.validate(inv));
        });
        check('校验错误码都有对应提示文案', () => {
            const codes = ['not-object', 'wrong-type', 'no-items', 'no-root', 'parse', 'empty'];
            const missing = codes.filter((c) => {
                const m = Q.crossCheck.validateMessage(c);
                return !m || m.startsWith('校验失败');
            });
            return expect(missing.length === 0, `缺失文案：${missing.join(',')}`);
        });

        // 端到端：另一账号清单 vs 本账号当前内容
        const baselineItems = [
            { path: '我的网盘/A/x.mkv', size: 100, updated_at: 1, dir: false, fid: 'a1' },
            { path: '我的网盘/A/y.mkv', size: 200, updated_at: 1, dir: false, fid: 'a2' },
            { path: '我的网盘/B/z.jpg', size: 300, updated_at: 1, dir: false, fid: 'a3' },
        ];
        const currentItems = [
            { path: '我的网盘/A/x.mkv', size: 100, updated_at: 1, dir: false, fid: 'b1' },
            { path: '我的网盘/B/z.jpg', size: 999, updated_at: 1, dir: false, fid: 'b3' },   // 体积不一致
        ];
        const invRec = Q.crossCheck.inventoryOf(baselineItems);
        // 注意：inventoryOf 会读取 state.path 作为根名，此处只验证结构
        check('清单结构包含标识/根名/条目/体积统计', () => expect(
            invRec.__type === 'qem-inventory' && typeof invRec.root.name === 'string'
            && Array.isArray(invRec.items) && invRec.items.length === 3 && invRec.size === 600,
            JSON.stringify({ type: invRec.__type, n: invRec.items.length, size: invRec.size })));
        const mkSnap = (items, label) => ({
            id: label, label, at: Date.now(), root: { fid: '', name: '我的网盘' },
            deep: true, count: items.length, size: items.reduce((s2, i) => s2 + i.size, 0), items: Q.snapshot.pack(items),
        });
        const diff = Q.snapshot.compare(mkSnap(baselineItems, '来源'), mkSnap(currentItems, '本账号'));
        check('跨账号比对：识别本账号缺失', () => expect(
            diff.removed.length === 1 && diff.removed[0].path === '我的网盘/A/y.mkv',
            JSON.stringify(diff.removed.map((r) => r.path))));
        check('跨账号比对：识别内容不一致', () => expect(
            diff.changed.length === 1 && diff.changed[0].oldSize === 300 && diff.changed[0].newSize === 999,
            JSON.stringify(diff.changed)));
        check('跨账号比对：一致的文件不误报', () => expect(
            diff.added.length === 0 && diff.moved.length === 0,
            `added=${diff.added.length} moved=${diff.moved.length}`));
    }

    /* ---------------- UI 设计系统（结构 + 样式表完整性） ---------------- */

    {
        // 从脚本源码抽取真实 UI_CSS，防止「JS 里加了类名但样式表漏写」这类静默失效
        const srcText = fs.readFileSync(path.join(__dirname, '..', 'Quark_Enhancement_Master.user.js'), 'utf8');
        const cssStart = srcText.indexOf('const UI_CSS = `');
        const uiCss = cssStart < 0 ? '' : srcText.slice(cssStart + 16, srcText.indexOf('`;', cssStart));

        const needClasses = [
            'qem-scope', 'qem-dark', 'qem-fab', 'qem-mask', 'qem-panel', 'qem-head', 'qem-body', 'qem-foot',
            'qem-tabs', 'qem-tab', 'qem-table', 'qem-tag', 'qem-bar', 'qem-toast', 'qem-toasts', 'qem-seg',
            'qem-empty', 'qem-drop', 'qem-scroll', 'qem-mono', 'qem-rank', 'qem-thumb',
            'qem-crumb', 'qem-toolbar', 'qem-sep', 'qem-content',
            'd-compact', 'd-normal', 'd-loose',
            'qem-lg', 'qem-md', 'qem-sm',
        ];
        const missing = needClasses.filter((c) => !uiCss.includes('.' + c));
        check('样式表覆盖全部关键类名（防漏写样式）', () => expect(
            missing.length === 0, `缺失：${missing.join(', ')}`));

        const aliasVars = ['--qem-bg-soft', '--qem-bg-hover', '--qem-text-soft'];
        const missAlias = aliasVars.filter((v) => !uiCss.includes(v + ':'));
        check('旧 CSS 变量别名保留（兼容 JS 内联引用）', () => expect(
            missAlias.length === 0, `缺失：${missAlias.join(', ')}`));

        const themeVars = ['--bg-0', '--bg-1', '--bd', '--fg', '--pri', '--err'];
        const missVar = themeVars.filter((v) => !uiCss.includes(v + ':'));
        check('设计令牌齐备', () => expect(missVar.length === 0, `缺失：${missVar.join(', ')}`));

        check('样式表含响应式断点（窄屏 + 触控）', () => expect(
            uiCss.includes('@media (max-width: 720px)') && uiCss.includes('@media (hover: none) and (pointer: coarse)'),
            '未找到完整断点'));
        check('主色对齐上游（蓝系 #0067c0 / #4cc2ff）', () => expect(
            uiCss.includes('#0067c0') && uiCss.includes('#4cc2ff'), '未找到上游主色'));
    }

    {
        // 前面的用例可能关掉过所有面板，这里先确保工作台处于打开状态
        await Q.workspace.open();
        const root = window.document.getElementById('qem-root').shadowRoot;
        check('工作台工具栏为卡片容器并含分组分隔线', () => {
            const tb = root.querySelector('.qem-toolbar');
            const seps = tb ? tb.querySelectorAll('.qem-sep').length : 0;
            return expect(!!tb && seps === 5, `工具栏=${!!tb} 分隔线=${seps}（应 6 组 5 条）`);
        });
        check('列表区为带边框的内容卡', () => expect(
            !!root.querySelector('.qem-content'), '未找到 .qem-content'));
        check('面包屑为独立条带', () => expect(
            !!root.querySelector('.qem-crumb'), '未找到 .qem-crumb'));
        check('表格密度遵循目录级视图偏好', () => {
            Q.config.set('view', { density: 'compact', thumb: false, perDir: true });
            Q.workspace.render();
            const t1 = root.querySelector('.qem-content .qem-table');
            const cls1 = t1 ? t1.className : '未找到表格';
            const compactOk = cls1.includes('d-compact');

            Q.config.set('view', { density: 'normal', thumb: false, perDir: true });
            Q.workspace.render();
            const t2 = root.querySelector('.qem-content .qem-table');
            const normalOk = !!t2 && !t2.className.includes('d-normal');   // normal 为默认，不加类名
            return expect(compactOk && normalOk,
                `紧凑时class=${cls1} 标准=${normalOk}`);
        });
        check('开启缩略图后表格渲染缩略图槽位', () => {
            // 夹具里没有图片文件，这里给视频项挂上封面以覆盖该分支
            const keep = Q.state.items;
            Q.state.items = keep.map((i) => (i.category === 'video' ? { ...i, thumbnail: THUMB_DATA } : i));
            Q.config.set('view', { density: 'normal', thumb: true, perDir: true });
            Q.workspace.render();
            const img = root.querySelector('.qem-content .qem-thumb');
            Q.state.items = keep;
            Q.config.set('view', { density: 'normal', thumb: false, perDir: true });
            Q.workspace.render();
            return expect(!!img, '未渲染 .qem-thumb');
        });
    }

    /* ---------------- 缺陷修复回归 ---------------- */

    {
        // ⑤ Shadow DOM 内的 isConnected 判断：此前用 documentElement.contains() 恒为 false，
        //    连带导致「面板已打开」守卫失效（重复叠面板 / 悬浮球重复创建 / 快捷键整体失效）
        await Q.workspace.open();
        await Q.workspace.open();
        await Q.workspace.open();
        const root3 = window.document.getElementById('qem-root').shadowRoot;
        check('重复打开工作台不叠加面板', () => {
            const contents = root3.querySelectorAll('.qem-content').length;
            return expect(contents === 1, `内容区数量=${contents}（应 1）`);
        });
        check('重复挂载悬浮球不重复创建', () => {
            Q.fab.mount();
            Q.fab.mount();
            const n = root3.querySelectorAll('.qem-fab').length;
            return expect(n === 1, `悬浮球数量=${n}（应 1）`);
        });
        check('面板内快捷键生效（全选 / 取消选择）', () => {
            Q.sel.clear();
            window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
            const afterAll = Q.sel.count();
            window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            const afterEsc = Q.sel.count();
            return expect(afterAll === Q.state.items.length && afterEsc === 0,
                `全选=${afterAll} 共=${Q.state.items.length} 取消后=${afterEsc}`);
        });
        check('快捷键：输入框聚焦时不应触发（不干扰打字）', () => {
            Q.sel.clear();
            const input = window.document.createElement('input');
            root3.appendChild(input);
            input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
            const typed = Q.sel.count();
            input.remove();
            return expect(typed === 0, `输入框内全选数=${typed}（应 0）`);
        });
    }

    {
        // ① 节流关闭时应真正全速：以「开/关耗时对比」判定，避免依赖绝对时间
        const measure = async () => {
            const t0 = Date.now();
            for (let i = 0; i < 3; i++) await Q.api.raw('capacity', {});
            return Date.now() - t0;
        };
        Q.config.set('turbo', true);
        Q.config.set('minInterval', 350);
        const withTurbo = await measure();
        Q.config.set('turbo', false);
        const withoutTurbo = await measure();
        Q.config.set('turbo', true);
        Q.config.set('minInterval', 120);
        check('关闭节流后不再施加最小间隔（耗时显著下降）', () => expect(
            withoutTurbo < withTurbo, `开=${withTurbo}ms 关=${withoutTurbo}ms`));
    }
    {
        // ② 递归扫描防环：目录自我引用（异常数据）不应重复展开
        FILES['d_cyc'] = [
            { fid: 'd_cyc', file_name: '自引用', pdir_fid: 'd_cyc', dir: true, size: 0, updated_at: 1, created_at: 1 },
            { fid: 'f_in', file_name: '内部.txt', pdir_fid: 'd_cyc', dir: false, size: 5, updated_at: 1, created_at: 1 },
        ];
        const walked = await Q.scanner.walk('d_cyc', {});
        delete FILES['d_cyc'];
        check('递归扫描遇到自引用目录能终止且不重复展开', () => expect(
            walked.length === 2 && walked.filter((w) => w.name === '内部.txt').length === 1,
            `条目=${walked.length} 明细=${walked.map((w) => w.name).join(',')}`));
    }
    {
        // ③ 基于缓存降级列表删除前必须提示，选择取消则不执行
        await Q.workspace.reload('0');
        const keepStale = Q.state.stale;
        Q.state.stale = { at: Date.now() - 60000, reason: '模拟接口异常' };
        deleted.length = 0;
        const before = calls.filter((c) => c.url.includes('/file/delete')).length;
        const p = Q.deleteWithUndo([{ fid: 'f_a', name: '电影A.2024.1080p.mkv', size: 1, pdir_fid: '0' }], { label: '缓存数据删除' });
        const clicked = await clickFoot('取消');
        const n = await p;
        const after = calls.filter((c) => c.url.includes('/file/delete')).length;
        check('缓存降级列表：删除前弹出风险提示', () => expect(clicked === true, `弹窗按钮=${footLabels()}`));
        check('缓存降级列表：选择取消则不执行删除', () => expect(
            n === 0 && after === before, `返回=${n} 新增删除请求=${after - before}`));
        Q.state.stale = keepStale;
    }
    {
        // ④ 回收站超过 200 条时应提示截断，而非静默漏项
        const mk = (n) => Array.from({ length: n }, (_, i) => ({
            fid: 'r' + i, file_name: `过期文件${i}.mkv`, size: 10, dir: false, updated_at: Date.now() - i * 1000,
        }));
        recycleFixture = mk(201);
        Q.trash.open();
        await tick(300);
        check('回收站超 200 条时标记截断', () => expect(Q.trash._truncated === true, `_truncated=${Q.trash._truncated}`));
        Q.ui.panels.slice().forEach((x) => { try { x.close(); } catch (e) { /* 忽略 */ } });
        recycleFixture = mk(5);
        Q.trash.open();
        await tick(300);
        check('回收站未超限时不标记截断', () => expect(Q.trash._truncated === false, `_truncated=${Q.trash._truncated}`));
        Q.ui.panels.slice().forEach((x) => { try { x.close(); } catch (e) { /* 忽略 */ } });
        recycleFixture = null;
    }

    /* ---------------- 搜索与筛选（v0.1.7） ---------------- */

    {
        const p1 = Q.finder.parse('电影 mkv');
        check('筛选解析：空格分词为 AND', () => expect(
            p1.keywords.length === 2 && p1.keywords.join(',') === '电影,mkv', `keywords=${p1.keywords}`));

        const p2 = Q.finder.parse('-教程 合集');
        check('筛选解析：-前缀为排除', () => expect(
            p2.excludes[0] === '教程' && p2.keywords[0] === '合集', `keywords=${p2.keywords} excludes=${p2.excludes}`));

        const p3 = Q.finder.parse('ext:mkv,MP4 type:视频 size:>1gb');
        check('筛选解析：ext / type / size 条件', () => expect(
            p3.exts.join(',') === 'mkv,mp4' && p3.types[0] === 'video'
            && p3.sizes[0].op === '>' && p3.sizes[0].bytes === 1024 ** 3,
            JSON.stringify({ ext: p3.exts, type: p3.types, size: p3.sizes })));

        const p4 = Q.finder.parse('"合集 教程"');
        check('筛选解析：引号内空格不分词', () => expect(
            p4.keywords.length === 1 && p4.keywords[0] === '合集 教程', `keywords=${p4.keywords}`));

        const p5 = Q.finder.parse('/^S\\d+E\\d+/');
        check('筛选解析：正则条件（默认忽略大小写）', () => expect(
            p5.regexes.length === 1 && p5.regexes[0].test('S01E01.mkv') && p5.regexes[0].test('s02e03.avi'),
            `notes=${p5.notes}`));

        const p6 = Q.finder.parse('/([');
        check('筛选解析：非法正则降级为关键词且不抛错', () => expect(
            p6.regexes.length === 0 && p6.keywords.length === 1 && p6.notes.length === 1, JSON.stringify(p6)));

        const p7 = Q.finder.parse('size:abc');
        check('筛选解析：非法体积条件记入 notes', () => expect(
            p7.sizes.length === 0 && p7.notes.length === 1, JSON.stringify(p7)));

        const p8 = Q.finder.parse('S01E01');
        check('筛选解析：匹配用小写副本，原词保留大小写（服务端搜索需原样）', () => expect(
            p8.keywords[0] === 's01e01' && p8.words[0] === 'S01E01',
            `keywords=${p8.keywords} words=${p8.words}`));

        const p9 = Q.finder.parse('*.MKV');
        check('筛选解析：glob 写法 *.MKV 等同 ext:mkv', () => expect(
            p9.exts.length === 1 && p9.exts[0] === 'mkv' && p9.keywords.length === 0,
            JSON.stringify({ ext: p9.exts, kw: p9.keywords })));
    }

    {
        const items = Q.state.items;   // 当前目录 8 项
        const r1 = Q.finder.filter(items, '合集');
        check('筛选：关键词命中 3 项（含磁力合集.txt）', () => expect(
            r1.active && r1.items.length === 3, `命中=${r1.items.map((i) => i.name)}`));

        const r2 = Q.finder.filter(items, 'mp4');
        check('筛选：按关键词命中 mp4 两项', () => expect(r2.items.length === 2, `命中=${r2.items.length}`));

        const r3 = Q.finder.filter(items, 'type:folder');
        check('筛选：type:folder 只命中文件夹', () => expect(
            r3.items.length === 2 && r3.items.every((i) => i.dir), `命中=${r3.items.length}`));

        const r4 = Q.finder.filter(items, 'ext:mkv size:>1gb');
        check('筛选：ext 与 size 组合为 AND', () => expect(
            r4.items.length > 0 && r4.items.every((i) => i.ext === 'mkv' && i.size > 1024 ** 3),
            `命中=${r4.items.length}`));

        const r5 = Q.finder.filter(items, '');
        check('筛选：空串不过滤（active=false）', () => expect(
            r5.active === false && r5.items.length === items.length));

        const r6 = Q.finder.filter(items, '不存在的名字zzz');
        check('筛选：无命中返回空数组', () => expect(r6.active === true && r6.items.length === 0));
    }

    {
        const html = Q.finder.highlight('电影A.2024.mkv', Q.finder.parse('2024'));
        check('高亮：命中片段包裹 mark', () => expect(
            html.includes('<mark class="qem-hl">2024</mark>'), html));

        const evil = Q.finder.highlight('<img src=x onerror=alert(1)>电影', Q.finder.parse('电影'));
        check('高亮：用户内容已转义（防 XSS）', () => expect(
            !evil.includes('<img') && evil.includes('&lt;img'), evil));

        const dup = Q.finder.highlight('aaaa', Q.finder.parse('aa aa'));
        check('高亮：重叠区间合并，不重复包裹', () => expect(
            (dup.match(/<mark/g) || []).length === 1, dup));
    }

    {
        await Q.workspace.open();
        await tick(80);
        const sInput = shadow().querySelector('.qem-search input');
        check('工作台搜索条已渲染', () => expect(!!sInput, '未找到 .qem-search input'));
        check('筛选框带语法提示', () => expect(
            !!sInput && /ext:/.test(sInput.placeholder) && /排除/.test(sInput.placeholder), sInput && sInput.placeholder));

        // 输入筛选（去抖 120ms）
        sInput.value = 'mkv';
        sInput.dispatchEvent(new window.Event('input'));
        await tick(220);

        check('筛选后表格只显示命中行', () => expect(
            Q.state.table.el.querySelectorAll('tbody tr').length === 2,
            `行数=${Q.state.table.el.querySelectorAll('tbody tr').length}`));

        const stat = shadow().querySelector('.qem-search .stat');
        check('筛选计数显示「命中 / 总数」', () => expect(
            !!stat && stat.textContent.includes('2 / 8'), stat && stat.textContent));

        check('名称列渲染命中高亮', () => expect(
            !!Q.state.table.el.querySelector('mark.qem-hl'), '未找到 mark.qem-hl'));

        // 关键安全点：被筛掉（不可见）的项必须移出选中集，否则批量删除会误伤
        Q.sel.set(['f_a', 'f_c']);
        Q.workspace.render();
        check('筛选时隐藏项自动移出选中集', () => expect(
            Q.sel.count() === 1 && Q.sel.has('f_a'), `选中=${Q.sel.get()}`));

        // 键盘导航
        Q.sel.clear();
        Q.workspace.render();
        Q.workspace.moveCursor(1);
        check('↓ 首次按下把游标落在首行并选中', () => expect(
            Q.state.cursor === 0 && Q.sel.count() === 1, `cursor=${Q.state.cursor} sel=${Q.sel.count()}`));
        check('游标行带 cur 样式', () => expect(
            !!Q.state.table.el.querySelector('tbody tr.cur'), '未找到 .cur 行'));

        Q.workspace.moveCursor(1, { extend: true });
        check('Shift+↓ 按锚点连选两行', () => expect(
            Q.sel.count() === 2, `sel=${Q.sel.count()}`));

        Q.workspace.moveCursor(99);
        check('↓ 不越过末行', () => expect(
            Q.state.cursor === Q.workspace.visible().length - 1, `cursor=${Q.state.cursor}`));

        Q.workspace.moveCursor(0, { absolute: 'home' });
        check('Home 回到首行', () => expect(Q.state.cursor === 0, `cursor=${Q.state.cursor}`));

        // 全选 / 反选只作用于可见项（筛选期间不应选中隐藏文件）
        Q.sel.clear();
        window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
        check('筛选期间 Ctrl+A 只选可见项', () => expect(
            Q.sel.count() === 2, `选中=${Q.sel.count()}（应 2）`));

        // Esc 先清筛选、再清选中
        window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await tick(60);
        check('Esc 优先清除筛选', () => expect(
            Q.state.query === '' && sInput.value === '', `query=${Q.state.query} input=${sInput.value}`));

        // Enter 打开：目录应走 enter()
        const shown = Q.workspace.visible();
        const dirIdx = shown.findIndex((i) => i.dir);
        const origEnter = Q.workspace.enter;
        let enteredFid = null;
        Q.workspace.enter = async (it) => { enteredFid = it.fid; };
        Q.workspace.moveCursor(0, { absolute: dirIdx });
        Q.workspace.openItem();
        Q.workspace.enter = origEnter;
        check('Enter 对目录调用 enter()', () => expect(
            enteredFid === shown[dirIdx].fid, `entered=${enteredFid} 期望=${shown[dirIdx].fid}`));

        // Ctrl+F 聚焦筛选框
        window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
        check('Ctrl+F 聚焦筛选框', () => expect(
            shadow().activeElement === sInput, `active=${shadow().activeElement && shadow().activeElement.tagName}`));

        // 重新打开应清空上次筛选
        sInput.value = 'mkv';
        sInput.dispatchEvent(new window.Event('input'));
        await tick(200);
        Q.state.ui.close();
        await tick(30);
        await Q.workspace.open();
        await tick(80);
        const sInput2 = shadow().querySelector('.qem-search input');
        check('重新打开工作台会清空上次筛选', () => expect(
            Q.state.query === '' && sInput2 && sInput2.value === ''
            && Q.state.table.el.querySelectorAll('tbody tr').length === 8,
            `query=${Q.state.query} 行数=${Q.state.table && Q.state.table.el.querySelectorAll('tbody tr').length}`));
    }

    {
        const r = await Q.api.searchAll('S01E01');
        check('全盘搜索：跨目录命中同名文件', () => expect(
            r.items.length === 2 && r.items.every((i) => i.name === 'S01E01.mkv'), `命中=${r.items.length}`));
        check('全盘搜索：按 fid 去重', () => expect(
            new Set(r.items.map((i) => i.fid)).size === r.items.length));

        const empty = await Q.api.searchAll('   ');
        check('全盘搜索：空关键词不发请求', () => expect(
            empty.items.length === 0 && empty.total === 0));
    }

    {
        // 路径反查依赖本地索引：先刷新根目录建立缓存
        await Q.workspace.reload('0');
        const p = Q.finder.resolvePath('d_1');
        check('路径反查：索引齐全时完整解析', () => expect(
            p.complete && p.path.map((s) => s.name).join('/') === '我的网盘/影视', JSON.stringify(p)));

        check('路径文案可直接用于表格列', () => expect(
            Q.finder.pathLabel('d_1') === '我的网盘 / 影视', Q.finder.pathLabel('d_1')));

        const unknown = Q.finder.resolvePath('d_unknown');
        check('路径反查：未索引目录标记为不完整', () => expect(
            unknown.complete === false && unknown.path.length === 2, JSON.stringify(unknown)));
    }

    {
        // 全盘搜索面板端到端：结果行 + 定位按钮 + 关闭
        Q.finder.openGlobal('S01E01');
        let rowCount = 0;
        for (let i = 0; i < 30 && rowCount !== 2; i++) {
            await tick(60);
            const m = lastMask();
            rowCount = m ? m.querySelectorAll('.qem-table tbody tr').length : 0;
        }
        const mask = lastMask();
        check('全盘搜索面板：渲染结果行', () => expect(rowCount === 2, `行数=${rowCount}（应 2）`));
        check('全盘搜索面板：每行提供「定位」', () => expect(
            !!mask && Array.from(mask.querySelectorAll('tbody button')).filter((b) => b.textContent === '定位').length === 2,
            '未找到定位按钮'));
        check('全盘搜索面板：提供批量操作入口', () => {
            const labels = mask ? Array.from(mask.querySelectorAll('button')).map((b) => b.textContent).join('|') : '';
            return expect(/下载选中/.test(labels) && /删除（可撤销）/.test(labels), labels);
        });
        Q.ui.panels.slice().forEach((x) => { try { x.close(); } catch (e) { /* 忽略 */ } });
        await tick(40);
    }

    {
        // 结构化条件（ext:/type:/size:）只对本地筛选有效，原样送服务端必然搜不到
        calls.length = 0;
        Q.finder.openGlobal('ext:mkv S01E01');
        let marks = 0;
        for (let i = 0; i < 30 && marks < 2; i++) {
            await tick(60);
            const m = lastMask();
            marks = m ? m.querySelectorAll('mark.qem-hl').length : 0;
        }
        const url = decodeURIComponent((calls.find((c) => c.url.includes('/file/search')) || {}).url || '');
        check('全盘搜索：本地语法不送服务端', () => expect(
            url.includes('q=S01E01') && !url.includes('ext:'), url || '（未发出搜索请求）'));
        check('全盘搜索：结果按关键词高亮', () => expect(marks >= 2, `mark=${marks}`));
        Q.ui.panels.slice().forEach((x) => { try { x.close(); } catch (e) { /* 忽略 */ } });
        await tick(40);
    }

    {
        // 只有结构化条件时不应发请求（会白搜一次）
        calls.length = 0;
        Q.finder.openGlobal('ext:mkv');
        await tick(200);
        check('全盘搜索：无关键词时不发请求', () => expect(
            calls.filter((c) => c.url.includes('/file/search')).length === 0,
            `搜索请求数=${calls.filter((c) => c.url.includes('/file/search')).length}`));
        Q.ui.panels.slice().forEach((x) => { try { x.close(); } catch (e) { /* 忽略 */ } });
        await tick(40);
    }

    /* ---------------- 失败账本与部分失败删除（v0.1.8） ---------------- */

    {
        // ① 分片删除：中间分片失败不得丢掉前面已成功的部分
        deleted.length = 0;
        deleteFailsOn = ['f_b'];
        const r = await Q.api.removeChunkedSafe(['f_a', 'f_b', 'f_c'], 1);
        deleteFailsOn = [];
        check('分片删除：成功项与失败项分别返回', () => expect(
            r.ok.length === 2 && r.ok.includes('f_a') && r.ok.includes('f_c')
            && r.fails.length === 1 && r.fails[0].fid === 'f_b',
            JSON.stringify(r)));
        check('分片删除：成功项确实已删、失败项未删', () => expect(
            deleted.includes('f_a') && deleted.includes('f_c') && !deleted.includes('f_b'),
            deleted.join(',')));
    }

    {
        // ② 关键回归：部分失败时，已成功的文件必须进入撤销栈
        //    （修复前 removeChunked 一旦抛错，整批都不记账 → 文件删了却撤不回）
        //    用 101 项制造两片：第 1 片 100 项成功，第 2 片 1 项失败
        await Q.workspace.reload('0');
        Q.breaker.reset();
        Q.failLog.clear();
        deleted.length = 0;
        const many = Array.from({ length: 101 }, (_, i) => ({ fid: 't' + i, name: 't' + i, size: 0, pdir_fid: '0' }));
        deleteFailsOn = ['t100'];
        const n = await Q.deleteWithUndo(many, { label: '部分失败删除', skipStaleCheck: true });
        deleteFailsOn = [];

        check('部分失败删除：返回成功数而非总数', () => expect(n === 100, `n=${n}（应 100）`));

        const rec = Q.opLog.list()[0];
        check('部分失败删除：成功项写入撤销栈（最新一条）', () => expect(
            !!rec && rec.type === 'delete' && rec.entries.length === 100, JSON.stringify(rec && rec.entries.length)));
        check('部分失败删除：成功项带回收站 fid（可撤销）', () => expect(
            !!rec && rec.entries.every((e) => e.recycleFid), `可撤销=${rec && rec.entries.filter((e) => e.recycleFid).length}`));
        check('部分失败删除：撤销备注说明有失败项', () => expect(
            !!rec && /1 项删除失败/.test(rec.note || ''), rec && rec.note));

        const fb = Q.failLog.list()[0];
        check('部分失败删除：失败项进入失败账本', () => expect(
            !!fb && fb.action === 'delete' && fb.items.length === 1 && fb.items[0].fid === 't100',
            JSON.stringify(fb && fb.items)));
        check('部分失败删除：失败原因被记录', () => expect(
            !!fb && /服务端繁忙|23009/.test(fb.items[0].error || ''), fb && fb.items[0].error));
    }

    {
        // ③ 重命名失败 → 落账 → 重试（仍失败保留 / 成功后移除）
        Q.failLog.clear();
        renameFailsOn = ['f_a'];
        const rn = await Q.api.renameMany([{ fid: 'f_a', file_name: '新A.mkv' }, { fid: 'f_c', file_name: '新C.mp4' }]);
        const fails = rn.fails;
        check('renameMany：返回失败明细与原因', () => expect(
            fails.length === 1 && fails[0].fid === 'f_a' && !!fails[0].error, JSON.stringify(fails)));
        check('renameMany：返回结构含进度与停止标记', () => expect(
            rn.done === 2 && rn.total === 2 && rn.stopped === false,
            JSON.stringify({ done: rn.done, total: rn.total, stopped: rn.stopped })));

        const b = Q.failLog.push({
            action: 'rename',
            label: '批量重命名',
            items: fails.map((f) => ({ fid: f.fid, name: '旧名', file_name: f.file_name, error: f.error })),
        });
        check('failLog：rename 批次可重试', () => expect(
            !!b && b.retryable === true && Q.failLog.itemCount() === 1, JSON.stringify(b && b.retryable)));

        await Q.failLog.retry(b.id);
        const after = Q.failLog.get(b.id);
        check('重试仍失败：批次保留并更新说明', () => expect(
            !!after && after.items.length === 1 && /仍剩 1 项失败/.test(after.note || ''),
            JSON.stringify(after && after.note)));

        renameFailsOn = [];
        await Q.failLog.retry(b.id);
        check('重试成功：批次自动移除', () => expect(
            Q.failLog.get(b.id) === null && Q.failLog.itemCount() === 0,
            `剩余批次=${Q.failLog.batchCount()}`));
    }

    {
        // ④ 重试删除批次：走统一删除入口，成功后批次自动移除
        Q.breaker.reset();
        Q.failLog.clear();
        Q.failLog.push({
            action: 'delete', label: '搜索结果删除',
            items: [{ fid: 'f_a', name: FLAT.f_a.file_name, size: FLAT.f_a.size, pdir: '0', error: '模拟失败' }],
        });
        const db = Q.failLog.list()[0];
        const n2 = await Q.failLog.retry(db.id);
        check('重试删除：调用统一删除入口并成功', () => expect(n2 === 1, `n=${n2}`));
        check('重试删除：成功后批次移除', () => expect(Q.failLog.get(db.id) === null, `剩余批次=${Q.failLog.batchCount()}`));
    }

    {
        // ⑤ 账本自身：可重试判定、单批截断、批次上限、持久化、清空
        Q.failLog.clear();
        const m = Q.failLog.push({ action: 'manual', label: '撤销「批量删除」', items: [{ fid: 'f_a', name: 'x', error: 'e' }] });
        check('failLog：manual 批次标记为不可重试', () => expect(m.retryable === false));
        await Q.failLog.retry(m.id);   // 只提示，不应抛错
        check('failLog：不可重试批次调用重试不报错且保留', () => expect(!!Q.failLog.get(m.id)));

        const oldMaxItems = Q.failLog.MAX_ITEMS;
        Q.failLog.MAX_ITEMS = 5;
        const big = Q.failLog.push({
            action: 'delete',
            items: Array.from({ length: 8 }, (_, i) => ({ fid: 'z' + i, name: 'n' + i, error: 'e' })),
        });
        Q.failLog.MAX_ITEMS = oldMaxItems;
        check('failLog：单批超限截断并注明', () => expect(
            big.items.length === 5 && /另有 3 项未记录/.test(big.note || ''),
            `items=${big.items.length} note=${big.note}`));

        const oldMaxBatch = Q.failLog.MAX_BATCH;
        Q.failLog.MAX_BATCH = 3;
        for (let i = 0; i < 6; i++) Q.failLog.push({ action: 'manual', items: [{ fid: 'q' + i, error: 'e' }] });
        Q.failLog.MAX_BATCH = oldMaxBatch;
        check('failLog：批次数按上限裁剪', () => expect(
            Q.failLog.batchCount() === 3, `批次=${Q.failLog.batchCount()}`));
        check('failLog：记录已落盘 localStorage', () => expect(
            !!window.localStorage.getItem('qem_fail_log_v1'), '未写入存储'));

        Q.failLog.clear();
        check('failLog：清空后计数归零', () => expect(
            Q.failLog.itemCount() === 0 && Q.failLog.batchCount() === 0));
    }

    {
        // ⑤ 面板：批次列表 → 明细 → 关闭
        Q.failLog.clear();
        Q.failLog.push({
            action: 'rename', label: '批量重命名',
            items: [{ fid: 'f_a', name: '旧A.mkv', file_name: '新A.mkv', error: '同名冲突' }],
        });
        Q.failLog.open();
        await tick(80);
        const mask = lastMask();
        const rows = mask ? mask.querySelectorAll('.qem-table tbody tr').length : 0;
        check('失败记录面板：渲染批次行', () => expect(rows === 1, `行数=${rows}`));

        const detailBtn = mask ? Array.from(mask.querySelectorAll('tbody button')).find((b) => b.textContent === '明细') : null;
        const retryBtn = mask ? Array.from(mask.querySelectorAll('tbody button')).find((b) => b.textContent === '重试') : null;
        check('失败记录面板：提供明细与重试入口', () => expect(!!detailBtn && !!retryBtn, `明细=${!!detailBtn} 重试=${!!retryBtn}`));

        if (detailBtn) detailBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick(80);
        const m2 = lastMask();
        const irows = m2 ? m2.querySelectorAll('.qem-table tbody tr').length : 0;
        check('失败明细面板：列出失败项与原因', () => expect(
            irows === 1 && /同名冲突/.test(m2.textContent), `行数=${irows}`));

        Q.ui.panels.slice().forEach((x) => { try { x.close(); } catch (e) { /* 忽略 */ } });
        await tick(40);
    }

    {
        // ⑥ 工作台底部失败指示：有失败才出现
        await Q.workspace.open();
        Q.failLog.clear();
        Q.failLog.push({ action: 'manual', items: [{ fid: 'f_a', name: 'x', error: 'e' }] });
        Q.workspace.render();
        const root = shadow();
        const btn = Array.from(root.querySelectorAll('.qem-foot button')).find((b) => /项失败/.test(b.textContent));
        check('工作台底部：有失败时显示入口与数量', () => expect(
            !!btn && /1 项失败/.test(btn.textContent) && btn.style.display !== 'none',
            btn ? btn.textContent : '未找到'));

        Q.failLog.clear();
        Q.workspace.render();
        const btn2 = Array.from(root.querySelectorAll('.qem-foot button')).find((b) => /项失败/.test(b.textContent));
        check('工作台底部：无失败时隐藏入口', () => expect(
            !btn2 || btn2.style.display === 'none', btn2 ? btn2.style.display : '未渲染'));
    }

    /* ---------------- 常用目录与导航历史（v0.1.9） ---------------- */

    {
        // ① 书签存储：去重 / 顺序 / 改名与失效标记 / 上限
        window.localStorage.removeItem('qem_bookmarks_v1');
        const r1 = Q.navBook.add({ fid: '0', name: '我的网盘' });
        const r2 = Q.navBook.add({ fid: '0', name: '根目录改名' });
        check('书签：同 fid 去重，只更新名称', () => expect(
            r1.added && !r2.added && r2.reason === 'exists'
            && Q.navBook.list().length === 1 && Q.navBook.list()[0].name === '根目录改名',
            JSON.stringify(Q.navBook.list())));

        Q.navBook.add({ fid: 'd_1', name: '影视' });
        const b0 = Q.navBook.list()[0];
        check('书签：可调整顺序', () => {
            Q.navBook.move(b0.id, 1);
            const arr = Q.navBook.list();
            return expect(arr[1].fid === '0' && arr[0].fid === 'd_1', arr.map((x) => x.fid).join(','));
        });

        check('书签：可改名并标记失效', () => {
            const b = Q.navBook.list().find((x) => x.fid === 'd_1');
            Q.navBook.rename(b.id, '影视素材');
            Q.navBook.markBad(b.id, true);
            const nb = Q.navBook.list().find((x) => x.fid === 'd_1');
            Q.navBook.markBad(b.id, false);
            return expect(nb.name === '影视素材' && nb.bad === true && nb.badAt);
        });

        const oldMax = Q.navBook.MAX_BOOK;
        Q.navBook.MAX_BOOK = 2;
        const r3 = Q.navBook.add({ fid: 'd_2', name: '另一个' });
        Q.navBook.MAX_BOOK = oldMax;
        check('书签：达到上限时拒绝并给出原因', () => expect(!r3.added && r3.reason === 'limit'));

        check('书签：toggle 已存在即取消', () => {
            Q.navBook.removeByFid('d_1');
            const a = Q.navBook.toggle({ fid: 'd_1', name: '影视' });
            const b = Q.navBook.toggle({ fid: 'd_1', name: '影视' });
            return expect(a.added && !b.added && b.reason === 'removed' && !Q.navBook.has('d_1'));
        });
    }

    {
        // ② 最近访问：去重前移 / 根目录不记 / 上限 / 清空
        window.localStorage.removeItem('qem_recent_dirs_v1');
        Q.navBook.touch({ fid: 'd_1', name: '影视' });
        Q.navBook.touch({ fid: 'd_2', name: '影视2' });
        Q.navBook.touch({ fid: 'd_1', name: '影视' });
        check('最近访问：同 fid 前移去重', () => expect(
            Q.navBook.recent().length === 2 && Q.navBook.recent()[0].fid === 'd_1',
            JSON.stringify(Q.navBook.recent().map((r) => r.fid))));

        Q.navBook.touch({ fid: '0', name: '我的网盘' });
        check('最近访问：根目录不入记录', () => expect(Q.navBook.recent().length === 2));

        const oldMax2 = Q.navBook.MAX_RECENT;
        Q.navBook.MAX_RECENT = 2;
        for (let i = 0; i < 4; i++) Q.navBook.touch({ fid: 'x' + i, name: 'x' + i });
        Q.navBook.MAX_RECENT = oldMax2;
        check('最近访问：按上限裁剪（保留最新）', () => expect(
            Q.navBook.recent().length === 2 && Q.navBook.recent()[0].fid === 'x3',
            JSON.stringify(Q.navBook.recent().map((r) => r.fid))));

        Q.navBook.clearRecent();
        check('最近访问：可清空', () => expect(Q.navBook.recent().length === 0));
    }

    {
        // ③ 历史栈语义：同目录不入栈、peek 不移动、跳转后截断前方
        Q.navTrail.reset();
        const P = (fid, name) => [{ fid: '0', name: '我的网盘' }, { fid, name }];
        Q.navTrail.push({ cwd: '0', path: [{ fid: '0', name: '我的网盘' }] });
        Q.navTrail.push({ cwd: 'd_1', path: P('d_1', '影视') });
        Q.navTrail.push({ cwd: 'd_1', path: P('d_1', '影视') });
        check('历史栈：同目录不重复入栈', () => expect(Q.navTrail.stack.length === 2, `长度=${Q.navTrail.stack.length}`));
        check('历史栈：可后退不可前进', () => expect(Q.navTrail.canBack() && !Q.navTrail.canForward()));

        const pk = Q.navTrail.peek(-1);
        check('历史栈：peek 只查看不移动索引', () => expect(
            !!pk && pk.entry.cwd === '0' && Q.navTrail.idx === 1));

        Q.navTrail.commit(pk.index);
        check('历史栈：commit 后可前进', () => expect(
            Q.navTrail.idx === 0 && Q.navTrail.canForward() && !Q.navTrail.canBack()));

        Q.navTrail.push({ cwd: 'd_2', path: P('d_2', '影视2') });
        check('历史栈：后退后新导航截断前方记录', () => expect(
            Q.navTrail.stack.length === 2 && Q.navTrail.stack[1].cwd === 'd_2',
            Q.navTrail.stack.map((x) => x.cwd).join(',')));
        Q.navTrail.reset();
    }

    {
        // ④ navigate / enter / goUp / back / forward 端到端
        await Q.workspace.open();
        await Q.workspace.navTo(0);
        Q.navTrail.reset();
        await Q.workspace.navTo(0);   // 以根目录作为历史基线

        await Q.workspace.enter({ fid: 'd_1', name: '影视' });
        check('进入目录：cwd 与面包屑一致', () => expect(
            Q.state.cwd === 'd_1' && Q.state.path.length === 2 && Q.state.path[1].fid === 'd_1',
            `cwd=${Q.state.cwd} 层级=${Q.state.path.length}`));
        check('进入目录：自动记入最近访问', () => expect(
            Q.navBook.recent()[0] && Q.navBook.recent()[0].fid === 'd_1'));

        await Q.workspace.back();
        check('后退：回到上一个目录', () => expect(
            Q.state.cwd === '0' && Q.state.path.length === 1, `cwd=${Q.state.cwd}`));
        check('后退：索引停在历史位置（可再前进）', () => expect(Q.navTrail.canForward()));

        await Q.workspace.forward();
        check('前进：回到子目录', () => expect(
            Q.state.cwd === 'd_1' && Q.state.path.length === 2, `cwd=${Q.state.cwd}`));

        await Q.workspace.goUp();
        check('上一级：回到父目录', () => expect(Q.state.cwd === '0', `cwd=${Q.state.cwd}`));
    }

    {
        // ⑤ 书签跳转：成功时还原完整面包屑；目标不可用时回滚并标记失效
        await Q.workspace.navTo(0);
        Q.navBook.add({ fid: 'd_1', name: '影视' });
        const okBook = Q.navBook.list().find((b) => b.fid === 'd_1');
        const okJump = await Q.navBook.jump(okBook);
        check('书签跳转：成功并还原完整面包屑', () => expect(
            okJump === true && Q.state.cwd === 'd_1'
            && Q.state.path.map((x) => x.name).join('/') === '我的网盘/影视',
            `ok=${okJump} path=${Q.state.path.map((x) => x.name).join('/')}`));

        await Q.workspace.navTo(0);
        Q.navBook.add({ fid: 'd_gone', name: '已删除的目录' });
        const badBook = Q.navBook.list().find((b) => b.fid === 'd_gone');
        listFailsOn = ['d_gone'];
        const badJump = await Q.navBook.jump(badBook);
        listFailsOn = [];
        check('书签跳转失败：返回 false 并标记失效', () => expect(
            badJump === false && Q.navBook.list().find((b) => b.fid === 'd_gone').bad === true));
        check('书签跳转失败：目录与面包屑回滚', () => expect(
            Q.state.cwd === '0' && Q.state.path.length === 1,
            `cwd=${Q.state.cwd} 层级=${Q.state.path.length}`));
        Q.navBook.removeByFid('d_gone');
    }

    {
        // ⑥ 界面与快捷键：书签条高亮、点击跳转、Ctrl+D、Alt+←、Backspace
        await Q.workspace.navTo(0);
        await Q.workspace.enter({ fid: 'd_1', name: '影视' });
        Q.navBook.add({ fid: 'd_1', name: '影视' });
        Q.workspace.render();

        const root = shadow();
        const on = root.querySelector('.qem-books button.on');
        check('书签条：渲染并以高亮标识当前目录', () => expect(
            !!on && on.textContent === '影视',
            `高亮=${on && on.textContent} 按钮数=${root.querySelectorAll('.qem-books button').length}`));

        await Q.workspace.navTo(0);
        Q.workspace.render();
        const chip = Array.from(shadow().querySelectorAll('.qem-books button')).find((b) => b.textContent === '影视');
        check('书签条：提供书签按钮', () => expect(!!chip, '未找到书签按钮'));
        if (chip) chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick(220);
        check('书签条：点击跳转到该书签目录', () => expect(Q.state.cwd === 'd_1', `cwd=${Q.state.cwd}`));

        window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
        check('Ctrl+D：取消收藏当前目录', () => expect(!Q.navBook.has('d_1')));
        window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
        check('Ctrl+D：再次按下重新收藏', () => expect(Q.navBook.has('d_1')));

        window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
        await tick(220);
        check('Alt+←：后退到上一个目录', () => expect(Q.state.cwd === '0', `cwd=${Q.state.cwd}`));

        await Q.workspace.enter({ fid: 'd_1', name: '影视' });
        window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
        await tick(220);
        check('Backspace：返回上一级', () => expect(Q.state.cwd === '0', `cwd=${Q.state.cwd}`));
    }

    {
        // ⑦ 边界：工作台未打开时（从菜单/面板跳转）应自动打开，否则导航了却看不到界面
        Q.navBook.add({ fid: 'd_1', name: '影视' });
        const bk = Q.navBook.list().find((x) => x.fid === 'd_1');
        Q.ui.panels.slice().forEach((x) => { try { x.close(); } catch (e) { /* 忽略 */ } });
        await tick(60);
        const wasClosed = !(Q.state.ui && Q.state.ui.el && Q.state.ui.el.isConnected);
        const jumped = await Q.navBook.jump(bk);
        check('菜单跳转：工作台未打开时自动打开并导航', () => expect(
            wasClosed && jumped === true
            && !!(Q.state.ui && Q.state.ui.el && Q.state.ui.el.isConnected)
            && Q.state.cwd === 'd_1',
            `关闭前=${wasClosed} 跳转=${jumped} cwd=${Q.state.cwd}`));
    }

    /* ---------------- 长任务可取消（v0.2.0） ---------------- */

    {
        // ① 进度面板：只有 cancellable 才给取消按钮，且点击必须真的置位停止信号
        const p1 = Q.ui.progress('测试进度');
        const mask1 = lastMask();
        const hasBtn1 = mask1 ? Array.from(mask1.querySelectorAll('.qem-foot button')).some((b) => b.textContent.includes('取消')) : false;
        check('进度面板：默认不提供取消按钮', () => expect(
            !hasBtn1 && p1.cancelled === false && p1.shouldStop() === false,
            `有按钮=${hasBtn1} cancelled=${p1.cancelled}`));
        p1.close();
        await tick(30);

        const p2 = Q.ui.progress('测试进度', { cancellable: true });
        const mask2 = lastMask();
        const cBtn = mask2 ? Array.from(mask2.querySelectorAll('.qem-foot button')).find((b) => b.textContent.includes('取消')) : null;
        check('进度面板：cancellable 时提供取消按钮', () => expect(!!cBtn, '未找到取消按钮'));
        if (cBtn) cBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        check('进度面板：点击取消后停止信号为真', () => expect(
            p2.cancelled === true && p2.shouldStop() === true));
        check('进度面板：取消按钮点一次即禁用（防重复点）', () => expect(
            !!cBtn && cBtn.disabled === true));
        p2.close();
        await tick(30);
    }

    {
        // ② renameMany：中途停止，未处理的项不计入失败
        Q.breaker.reset();
        renameFailsOn = [];
        const pairs = Array.from({ length: 6 }, (_, i) => ({ fid: 'f_' + i, file_name: 'n' + i + '.mkv' }));
        let cb = 0;
        const r = await Q.api.renameMany(pairs, () => { cb++; }, { shouldStop: () => cb >= 2, gap: 5 });
        check('renameMany 取消：按进度停止且不误记失败', () => expect(
            r.stopped === true && r.done === 2 && r.total === 6 && r.fails.length === 0,
            JSON.stringify({ done: r.done, total: r.total, stopped: r.stopped, fails: r.fails.length })));
    }

    {
        // ③ removeChunkedSafe：在分片之间停止，已完成的分片照常返回
        Q.breaker.reset();
        deleted.length = 0;
        deleteFailsOn = [];
        const fids = Array.from({ length: 5 }, (_, i) => 'c' + i);
        let n = 0;
        const res = await Q.api.removeChunkedSafe(fids, 1, () => { n++; }, { shouldStop: () => n >= 2 });
        check('分片删除取消：保留已完成分片、剩余不处理', () => expect(
            res.stopped === true && res.ok.length === 2 && res.total === 5 && res.fails.length === 0,
            JSON.stringify({ ok: res.ok.length, total: res.total, stopped: res.stopped })));
        check('分片删除取消：已完成项确实已删除', () => expect(
            deleted.filter((f) => f.startsWith('c')).length === 2, deleted.join(',')));
    }

    {
        // ④ deleteWithUndo：取消后成功项仍进撤销栈，且不把未执行项记成失败
        await Q.workspace.reload('0');
        Q.failLog.clear();
        deleted.length = 0;
        const items = Array.from({ length: 101 }, (_, i) => ({ fid: 'u' + i, name: 'u' + i, size: 0, pdir_fid: '0' }));
        let c = 0;
        const n = await Q.deleteWithUndo(items, {
            label: '取消删除测试',
            skipStaleCheck: true,
            onProgress: () => { c++; },
            shouldStop: () => c >= 1,
        });
        check('删除取消：返回已成功数而非总数', () => expect(n === 100, `n=${n}（应 100）`));

        const rec = Q.opLog.list()[0];
        check('删除取消：成功项进入撤销栈', () => expect(
            !!rec && rec.type === 'delete' && rec.entries.length === 100,
            `条目=${rec && rec.entries.length}`));
        check('删除取消：撤销备注注明已取消与未执行数', () => expect(
            !!rec && /已取消/.test(rec.note || '') && /未执行/.test(rec.note || ''),
            rec && rec.note));
        check('删除取消：未执行项不记入失败账本', () => expect(
            Q.failLog.itemCount() === 0, `失败项=${Q.failLog.itemCount()}`));
    }

    {
        // ⑤ 全部取消（一片都没成功）时应返回 0，不产生虚假的撤销记录
        Q.breaker.reset();
        deleted.length = 0;
        const items = Array.from({ length: 3 }, (_, i) => ({ fid: 'v' + i, name: 'v' + i, size: 0, pdir_fid: '0' }));
        const beforeCount = Q.opLog.list().length;
        const n = await Q.deleteWithUndo(items, {
            label: '全取消测试', skipStaleCheck: true, shouldStop: () => true,
        });
        check('删除取消：一开始就取消则不执行并返回 0', () => expect(
            n === 0 && deleted.length === 0, `n=${n} 已删=${deleted.length}`));
        check('删除取消：无成功项时不写入撤销栈', () => expect(
            Q.opLog.list().length === beforeCount, `记录数 ${beforeCount} → ${Q.opLog.list().length}`));
    }

    {
        // ⑥ 撤销取消：如实留痕为「部分撤销」，并停止再撤入口（避免二次施加）
        Q.breaker.reset();
        Q.opLog.push({
            type: 'delete', label: '可取消撤销测试',
            entries: Array.from({ length: 201 }, (_, i) => ({ fid: 'w' + i, name: 'w' + i, recycleFid: 'rc' + i })),
        });
        const rec = Q.opLog.list()[0];
        const p = Q.opLog.undo(rec.id);
        await clickFoot('撤销');   // 确认弹窗
        await clickFoot('取消');   // 进度面板上的取消
        const done = await p;
        const after = Q.opLog.list().find((r) => r.id === rec.id);
        check('撤销取消：返回成功并记录为部分撤销', () => expect(
            done === true && !!after && after.undone === true && /部分撤销/.test(after.note || ''),
            `done=${done} undone=${after && after.undone} 备注=${after && after.note}`));
    }

    {
        // ⑦ 撤销取消时，「取消前已经发生的失败」不能跟着被丢掉
        //    拉大请求间隔，让取消确定落在第 1 组失败之后、第 2 组之前
        Q.config.set('minInterval', 200);
        Q.breaker.reset();
        Q.failLog.clear();
        moveFailsOn = ['pdir_bad'];
        Q.opLog.push({
            type: 'move', label: '可取消撤销（移动）',
            entries: [
                { fid: 'm1', name: 'm1', pdir: 'pdir_bad' },
                { fid: 'm2', name: 'm2', pdir: 'pdir_ok1' },
                { fid: 'm3', name: 'm3', pdir: 'pdir_ok2' },
            ],
        });
        const rec2 = Q.opLog.list()[0];
        const p2 = Q.opLog.undo(rec2.id);
        await clickFoot('撤销');
        await tick(50);
        await clickFoot('取消');
        const done2 = await p2;
        moveFailsOn = [];
        Q.config.set('minInterval', 120);

        const after2 = Q.opLog.list().find((r) => r.id === rec2.id);
        const fb2 = Q.failLog.list()[0];
        check('撤销取消：取消前的失败仍写入失败账本', () => expect(
            done2 === true && /部分撤销/.test(after2.note || '') && !!fb2 && fb2.items.length === 1,
            `备注=${after2 && after2.note} 失败项=${fb2 ? fb2.items.length : 0}`));
    }

    /* ---------------- 结果 ---------------- */
    console.log(results.join('\n'));
    console.log('─'.repeat(56));
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    process.exit(fail ? 1 : 0);
})();
