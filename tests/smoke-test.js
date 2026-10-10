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
        const list = FILES[fid] || [];
        return ok({ list }, { _total: list.length, _count: list.length, _page: 1 });
    }
    if (u.includes('/file/rename')) return ok({});
    if (u.includes('/file/delete')) {
        const body = JSON.parse((init && init.body) || '{}');
        deleted.push(...(body.filelist || []));
        return ok({});
    }
    if (u.includes('/file/move')) return ok({});
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

    /* ---------------- 结果 ---------------- */
    console.log(results.join('\n'));
    console.log('─'.repeat(56));
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    process.exit(fail ? 1 : 0);
})();
