// ==UserScript==
// @name               夸克增强大师
// @name:en            Quark Enhancement Master
// @namespace          https://github.com/3ALLBUY14/quark-enhancement-master
// @version            0.1.8
// @author             Quark port / 原版 PikPak Enhancement Master by digbug82
// @license            AGPL-3.0-or-later
// @description        夸克网盘增强：批量操作可撤销、同名冲突策略、容量预检、熔断与缓存列表保护、目录快照差异对比、回收站临期预警、配置版本历史与回滚、空间占用分析、跨账号迁移校验、目录级视图偏好、目录筛选与全盘搜索、键盘导航、失败明细与重试、批量重命名、文件/文件夹查重、资源清理、目录树导出、M3U 导出、TXT 磁链提取、文件透视筛选、排序增强、直链导出与 Aria2/IDM 集成、PotPlayer 直达、批量分享与分享解析转存、回收站管理、以图搜图、配置备份。
// @description:en     Quark Drive enhancement: batch rename, file/folder dedup, cleanup, directory-tree export, M3U export, magnet extraction, file insight/filter, sorting, direct-link export with Aria2/IDM, PotPlayer launcher, batch share & share-import, recycle bin, reverse image search, config backup.
// @homepage           https://github.com/3ALLBUY14/quark-enhancement-master
// @match              https://pan.quark.cn/*
// @match              https://drive-pc.quark.cn/*
// @icon               data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%230067c0'/%3E%3Cpath d='M18 40c2-9 7-14 14-14s12 5 14 14' stroke='%23fff' stroke-width='5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E
// @grant              GM_setValue
// @grant              GM_getValue
// @grant              GM_deleteValue
// @grant              GM_listValues
// @grant              GM_setClipboard
// @grant              GM_registerMenuCommand
// @grant              GM_xmlhttpRequest
// @grant              GM_info
// @grant              unsafeWindow
// @connect            127.0.0.1
// @connect            localhost
// @connect            pan.quark.cn
// @connect            drive-pc.quark.cn
// @connect            *
// @run-at             document-start
// ==/UserScript==

/*
 * ============================================================================
 * 夸克增强大师 (Quark Enhancement Master)
 * ============================================================================
 * 本项目是 PikPak Enhancement Master (v5.3.0, AGPL-3.0-or-later,
 * https://github.com/digbug82/PikPak_Enhancement_Master) 的夸克网盘移植版，
 * 保留其核心功能定位与交互逻辑（工作台面板 / 多选批量操作 / 快捷键驱动 /
 * 规则化批量重命名 / 查重清理 / 导出与外部工具联动），并针对夸克网盘的
 * 接口形态与页面结构重写全部实现。
 *
 * Copyright (C) 2026 <quark port authors>
 * Copyright (C) 2025-2026 digbug82 (original PikPak implementation)
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details: https://www.gnu.org/licenses/
 * ============================================================================
 */

(function () {
    'use strict';

    /* ======================================================================
     * 0. 常量
     * ==================================================================== */

    const VERSION = '0.1.8';
    const LS_CFG = 'qem_cfg_v1';
    const LS_CACHE_PREFIX = 'qem_cache_';
    const ROOT_FID = '0';
    const PAGE_SIZE = 200;
    const NS = 'qem';                       // 元素 id / 类名前缀
    const SCAN_CONCURRENCY = 4;

    const CATEGORY = {
        folder: { label: '文件夹', icon: '📁' },
        video: { label: '视频', icon: '🎬' },
        audio: { label: '音频', icon: '🎵' },
        image: { label: '图片', icon: '🖼️' },
        doc: { label: '文档', icon: '📄' },
        zip: { label: '压缩包', icon: '🗜️' },
        app: { label: '应用', icon: '📦' },
        other: { label: '其他', icon: '📎' },
    };

    const VIDEO_EXT = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'ts', 'm2ts', 'webm', 'rmvb', 'm4v', 'mpg', 'mpeg', 'iso'];
    const AUDIO_EXT = ['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'ape', 'wma', 'opus'];
    const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'tif', 'tiff', 'svg', 'avif'];
    const DOC_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'epub', 'mobi', 'azw3', 'csv', 'rtf', 'json', 'xml', 'srt', 'ass'];
    const ZIP_EXT = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst'];

    /* ======================================================================
     * 1. 工具库
     * ==================================================================== */

    const util = {
        /** 生成请求去抖时间戳（夸克接口要求 __t / __dt） */
        stamp() {
            return `${Date.now()}&__dt=${1000 + Math.floor(Math.random() * 9000)}`;
        },

        randHex(len) {
            let s = '';
            const abc = 'abcdef0123456789';
            for (let i = 0; i < len; i++) s += abc[Math.floor(Math.random() * 16)];
            return s;
        },

        /** 字节 → 可读体积 */
        humanSize(bytes, digits = 2) {
            const n = Number(bytes) || 0;
            if (n < 1024) return `${n} B`;
            const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
            let i = -1;
            let v = n;
            do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
            return `${v.toFixed(digits)} ${units[i]}`;
        },

        ts(ms) {
            if (!ms) return '-';
            const d = new Date(Number(ms));
            const p = (x) => String(x).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
        },

        /** 秒 → hh:mm:ss */
        duration(sec) {
            const s = Math.max(0, Math.floor(Number(sec) || 0));
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const ss = s % 60;
            const p = (x) => String(x).padStart(2, '0');
            return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
        },

        ext(name) {
            const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || ''));
            return m ? m[1].toLowerCase() : '';
        },

        baseName(name) {
            return String(name || '').replace(/\.[A-Za-z0-9]{1,10}$/, '');
        },

        categoryOf(item) {
            if (!item) return 'other';
            if (item.dir) return 'folder';
            const e = util.ext(item.file_name);
            if (VIDEO_EXT.includes(e)) return 'video';
            if (AUDIO_EXT.includes(e)) return 'audio';
            if (IMAGE_EXT.includes(e)) return 'image';
            if (DOC_EXT.includes(e)) return 'doc';
            if (ZIP_EXT.includes(e)) return 'zip';
            return 'other';
        },

        /** 中文友好的自然排序 */
        naturalCompare(a, b) {
            return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
        },

        escapeHtml(s) {
            return String(s ?? '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },

        /** 文件名非法字符清理（夸克禁止 \ / : * ? " < > | 及首尾空格点）；连续的非法字符合并为单个下划线 */
        sanitizeName(name) {
            return String(name ?? '')
                // eslint-disable-next-line no-control-regex -- 有意过滤文件名中的控制字符
                .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
                .replace(/^[\s.]+|[\s.]+$/g, '')
                .slice(0, 220);
        },

        /** 全角 → 半角 */
        toHalfWidth(s) {
            return String(s ?? '').replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
        },

        /** 半角 → 全角 */
        toFullWidth(s) {
            return String(s ?? '').replace(/[\u0021-\u007E]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, '\u3000');
        },

        /** 解析磁力链 / ed2k / http 直链 */
        extractLinks(text) {
            const src = String(text ?? '');
            const out = new Set();
            const re = /\b(?:magnet:\?xt=urn:btih:[A-Za-z0-9]{32,40}[^\s"'<>]*|ed2k:\/\/\|file\|[^\s"'<>]+|thunder:\/\/[A-Za-z0-9=+/]+|https?:\/\/[^\s"'<>]+?\.(?:torrent|mkv|mp4|zip|rar|7z|iso)(?:\?[^\s"'<>]*)?)/gi;
            let m;
            while ((m = re.exec(src)) !== null) out.add(m[0]);
            return Array.from(out);
        },

        /** 深拷贝 */
        clone(o) {
            try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; }
        },

        debounce(fn, wait = 300) {
            let t = null;
            return function (...args) {
                clearTimeout(t);
                t = setTimeout(() => fn.apply(this, args), wait);
            };
        },

        throttle(fn, wait = 200) {
            let last = 0;
            let timer = null;
            return function (...args) {
                const now = Date.now();
                const rest = wait - (now - last);
                if (rest <= 0) {
                    last = now;
                    fn.apply(this, args);
                } else if (!timer) {
                    timer = setTimeout(() => {
                        last = Date.now();
                        timer = null;
                        fn.apply(this, args);
                    }, rest);
                }
            };
        },

        sleep(ms) {
            return new Promise((r) => setTimeout(r, ms));
        },

        uuid() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0;
                const v = c === 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            });
        },

        /** 简易文本指纹（用于文件夹查重的名称归一化） */
        normalizeKey(s) {
            return String(s ?? '')
                .replace(/[[\]【】()（）{}<>《》._\s-]+/g, '')
                .replace(/第\s*\d+\s*[集话期]/g, '')
                .toLowerCase();
        },

        /** 下载文本为文件；无 Blob URL 能力时回退 data: URI */
        saveTextFile(filename, text, mime = 'text/plain;charset=utf-8') {
            const body = '\ufeff' + String(text ?? '');
            const a = document.createElement('a');
            a.download = filename;
            let objectUrl = '';
            try {
                if (typeof Blob === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                    objectUrl = URL.createObjectURL(new Blob([body], { type: mime }));
                    a.href = objectUrl;
                } else {
                    a.href = 'data:' + mime + ',' + encodeURIComponent(body);
                }
            } catch (e) {
                a.href = 'data:' + mime + ',' + encodeURIComponent(body);
            }
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (e) { /* 忽略 */ } }
                a.remove();
            }, 1500);
        },

        copy(text, tip = '已复制') {
            const s = String(text ?? '');
            try {
                if (typeof GM_setClipboard === 'function') {
                    GM_setClipboard(s, 'text');
                    ui.toast(tip);
                    return;
                }
            } catch (e) { /* 落到兜底 */ }
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(s).then(() => ui.toast(tip)).catch(() => util.fallbackCopy(s, tip));
            } else {
                util.fallbackCopy(s, tip);
            }
        },

        fallbackCopy(s, tip) {
            const ta = document.createElement('textarea');
            ta.value = s;
            ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); ui.toast(tip); } catch (e) { ui.toast('复制失败，请手动复制', 'error'); }
            ta.remove();
        },

        /** 并发池：把 N 个任务按 concurrency 限流执行 */
        async pool(items, worker, concurrency = SCAN_CONCURRENCY, onProgress = null) {
            const list = Array.from(items || []);
            const results = new Array(list.length);
            let cursor = 0;
            let done = 0;
            const runners = new Array(Math.min(concurrency, list.length || 1)).fill(0).map(async () => {
                for (;;) {
                    const idx = cursor++;
                    if (idx >= list.length) return;
                    try {
                        results[idx] = await worker(list[idx], idx);
                    } catch (e) {
                        results[idx] = { __error: String(e && e.message ? e.message : e) };
                    }
                    done++;
                    if (onProgress) onProgress(done, list.length);
                }
            });
            await Promise.all(runners);
            return results;
        },
    };

    /* ======================================================================
     * 2. 配置中心（GM 存储 + 配额守卫 + 导入导出）
     * ==================================================================== */

    const DEFAULT_CONFIG = {
        lang: 'zh',
        turbo: true,                 // 请求节流总开关
        minInterval: 120,            // 请求最小间隔 ms
        concurrency: 4,              // 并发上限
        theme: 'auto',               // auto | light | dark
        folderFirst: true,           // 文件夹置顶
        clickAction: 'preview',      // preview | download
        privacyMode: 'off',          // off | list | grid | both —— 列表页遮罩文件名
        sortPref: {},                // pdir_fid -> { key, order }
        view: { density: 'normal', thumb: false, perDir: true },   // 视图偏好默认值
        viewPref: {},                // pdir_fid -> { density, thumb }（按目录独立记忆）
        scrollPref: {},              // pdir_fid -> scrollTop
        dedup: { keep: 'new', ignoreExt: false, minSize: 0 },
        folderDedup: { threshold: 0.86, ignoreExt: true },
        scan: { exclude: '', maxDepth: 20 },
        renamePresets: [],
        // —— 可靠性策略
        conflict: { policy: 'ask' },     // ask | skip | rename | overwrite　同名文件处理策略
        undo: { max: 20 },               // 撤销栈保留条数
        breaker: { threshold: 6, cooldown: 30000 },   // 连续失败 N 次后熔断 T 毫秒
        capacityWarn: 0.95,              // 使用率超过该比例时预警
        trash: { retentionDays: 30, warnDays: 3, autoCheck: true },   // 回收站保留期与临期预警
        cfgHistory: { auto: true },      // 配置变更自动留痕（5 分钟节流）
        downloader: 'aria2',         // aria2 | idm | abdm | none
        aria2: { rpc: 'http://127.0.0.1:6800/jsonrpc', secret: '', dir: '', autoStart: true },
        player: 'script',            // script | potplayer | other
        potplayerPath: '',
        imgSearch: 'google',         // google | yandex | saucenao | tracemoe
        exportFormat: 'md',          // md | txt | json
        shortcuts: {
            panel: 'Alt+Q',
            settings: 'Alt+S',
            refresh: 'F5',
            rename: 'F2',
            newFolder: 'F8',
            del: 'Delete',
            copy: 'Ctrl+C',
            cut: 'Ctrl+X',
            paste: 'Ctrl+V',
            download: 'Alt+D',
            dedup: 'Alt+U',
            insight: 'Alt+I',
            selectAll: 'Ctrl+A',
            invert: 'Ctrl+I',
            escape: 'Escape',
            undo: 'Alt+Z',
            history: 'Alt+H',
        },
        fab: { pos: 'br', x: null, y: null, hidden: false },
    };

    const config = {
        data: util.clone(DEFAULT_CONFIG),
        listeners: new Set(),

        load() {
            let raw = null;
            try { raw = (typeof GM_getValue === 'function') ? GM_getValue(LS_CFG, null) : localStorage.getItem(LS_CFG); } catch (e) { raw = null; }
            if (!raw) return this;
            let parsed = null;
            try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { parsed = null; }
            if (parsed && typeof parsed === 'object') {
                this.data = this.merge(util.clone(DEFAULT_CONFIG), parsed);
            }
            return this;
        },

        /** 两层层级合并（对象合并，数组/标量直接覆盖） */
        merge(base, patch) {
            const out = base;
            Object.keys(patch || {}).forEach((k) => {
                const pv = patch[k];
                if (pv && typeof pv === 'object' && !Array.isArray(pv) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
                    out[k] = this.merge(out[k], pv);
                } else if (pv !== undefined) {
                    out[k] = pv;
                }
            });
            return out;
        },

        save() {
            const text = JSON.stringify(this.data);
            try {
                if (typeof GM_setValue === 'function') GM_setValue(LS_CFG, text);
                else localStorage.setItem(LS_CFG, text);
            } catch (e) {
                ui.toast('配置保存失败（存储配额可能已满）', 'error');
            }
            this.listeners.forEach((fn) => { try { fn(this.data); } catch (e) { /* 忽略单个监听错误 */ } });
        },

        onChange(fn) { this.listeners.add(fn); },

        get(path, fallback) {
            const parts = String(path).split('.');
            let cur = this.data;
            for (const p of parts) {
                if (cur === null || cur === undefined) return fallback;
                cur = cur[p];
            }
            return cur === undefined ? fallback : cur;
        },

        set(path, value) {
            const parts = String(path).split('.');
            let cur = this.data;
            for (let i = 0; i < parts.length - 1; i++) {
                if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
                cur = cur[parts[i]];
            }
            cur[parts[parts.length - 1]] = value;
            this.save();
        },

        export() {
            return JSON.stringify({ __type: 'qem-config', version: VERSION, exportedAt: Date.now(), data: this.data }, null, 2);
        },

        import(json) {
            let parsed = null;
            try { parsed = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return false; }
            const payload = parsed && parsed.data ? parsed.data : parsed;
            if (!payload || typeof payload !== 'object') return false;
            this.data = this.merge(util.clone(DEFAULT_CONFIG), payload);
            this.save();
            return true;
        },

        reset() {
            this.data = util.clone(DEFAULT_CONFIG);
            this.save();
        },

        /** 清理脚本在 GM 存储里残留的缓存键 */
        clearCaches() {
            let n = 0;
            try {
                if (typeof GM_listValues === 'function' && typeof GM_deleteValue === 'function') {
                    GM_listValues().filter((k) => String(k).startsWith(LS_CACHE_PREFIX)).forEach((k) => { GM_deleteValue(k); n++; });
                }
                Object.keys(localStorage).filter((k) => k.startsWith(LS_CACHE_PREFIX)).forEach((k) => { localStorage.removeItem(k); n++; });
            } catch (e) { /* 忽略 */ }
            ui.toast(`已清理 ${n} 项缓存`);
        },
    };

    /** 全盘索引缓存（跨会话，用于查重/透视免重复扫描） */
    const indexCache = {
        key(pdir) { return LS_CACHE_PREFIX + 'idx_' + pdir; },
        read(pdir) {
            try {
                const raw = localStorage.getItem(this.key(pdir));
                if (!raw) return null;
                const d = JSON.parse(raw);
                if (!d || !Array.isArray(d.items)) return null;
                return d;
            } catch (e) { return null; }
        },
        write(pdir, items) {
            try {
                localStorage.setItem(this.key(pdir), JSON.stringify({ at: Date.now(), items }));
            } catch (e) { /* 配额满则静默放弃缓存 */ }
        },
        dropAll() {
            try {
                Object.keys(localStorage).filter((k) => k.startsWith(LS_CACHE_PREFIX + 'idx_')).forEach((k) => localStorage.removeItem(k));
            } catch (e) { /* 忽略 */ }
        },
    };

    /* ======================================================================
     * 3. 文案（中文为主，结构上预留多语言位）
     * ==================================================================== */

    const T = {
        appTitle: '夸克增强大师',
        // 导航
        navFiles: '文件列表',
        navPanel: '工作台',
        navDedup: '查重',
        navClean: '清理',
        navExport: '导出',
        navShare: '分享',
        navTrash: '回收站',
        navImgSearch: '以图搜图',
        navSettings: '设置',
        // 通用
        ok: '确定',
        cancel: '取消',
        close: '关闭',
        refresh: '刷新',
        loading: '加载中...',
        working: '处理中...',
        selected: '已选 {n} 项',
        empty: '这里什么也没有',
        confirmTitle: '确认',
        promptTitle: '输入',
        success: '操作成功',
        failed: '操作失败',
        copyLink: '复制链接',
        preview: '预览',
        // 操作
        btnNewFolder: '新建文件夹',
        btnRename: '批量重命名',
        btnDownload: '下载',
        btnDelete: '删除',
        btnMove: '移动',
        btnCopy: '复制',
        btnPaste: '粘贴',
        btnDeselect: '取消选择',
        btnInvert: '反选',
        btnInsight: '文件透视',
        btnDedup: '文件查重',
        btnFolderDedup: '文件夹查重',
        btnClean: '资源清理',
        btnTree: '导出目录树',
        btnM3u: '导出 M3U',
        btnMagnet: '提取磁链',
        btnCsv: '导出清单 CSV',
        btnDirect: '导出直链',
        btnShare: '创建分享',
        btnShareParse: '解析分享',
        btnTrash: '回收站',
        btnProperty: '属性',
        btnImgSearch: '以图搜图',
        btnUndo: '撤销',
        btnHistory: '操作历史',
        btnSnapshot: '目录快照',
        btnSpace: '空间分析',
        btnCrossCheck: '跨账号校验',
        title_share_result: '分享成功',
        // 提示
        noSelection: '请先选择要操作的项目',
        notSupported: '该功能在当前页面不可用',
        quotaHint: '一次最多选择 {max} 项',
        todo: '该功能将在后续版本提供',
    };

    function t(key, vars) {
        let s = T[key] || key;
        if (vars) Object.keys(vars).forEach((k) => { s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k])); });
        return s;
    }

    /* ======================================================================
     * 4. UI 组件库（Shadow DOM 隔离，免疫夸克改版导致的样式冲突）
     * ==================================================================== */

    const UI_CSS = `
/* ======================================================================
 * UI 设计系统 v2 —— 贴近上游 PikPak Enhancement Master 的设计语言
 * （蓝系主色 #0067c0/#4cc2ff、软底色分层、多级阴影、清晰的区域边界）
 * 令牌命名对齐上游 --pk-*，并保留旧 --qem-* 别�名以兼容 JS 内联引用。
 * ==================================================================== */

:host { all: initial; }
* { box-sizing: border-box; }

.qem-scope {
  /* —— 基础令牌（浅色） —— */
  --bg-0: #ffffff;          /* 面板主面 */
  --bg-1: #f5f6f8;          /* 软底色条：页眉/页脚/工具栏/表头 */
  --bg-2: #eef0f3;          /* 悬停 */
  --bg-3: #e5e8ec;          /* 强悬停 */
  --bd:   #e5e5e5;          /* 细边框 */
  --bd-2: #d9dce1;          /* 强边框 */
  --fg:   #1a1a1a;          /* 正文 */
  --fg-2: #5f6670;          /* 次级文字 */
  --fg-3: #8a9199;          /* 弱化文字/图标 */
  --pri:  #0067c0;          /* 主色（同上游 --pk-pri） */
  --pri-fg: #ffffff;
  --pri-hov: #005fa8;
  --pri-soft: #e6f3ff;      /* 选中底 */
  --pri-bd: #cce8ff;        /* 选中框 */
  --ok:   #16a06b;
  --ok-soft: #e3f6ee;
  --warn: #d97706;
  --warn-soft: #fdf0dd;
  --err:  #d93025;
  --err-soft: #fbe7e4;
  --r-sm: 6px; --r-md: 8px; --r-lg: 12px; --r-xl: 14px;
  --sh-1: 0 1px 2px rgba(0,0,0,.05), 0 2px 8px rgba(0,0,0,.05);
  --sh-2: 0 8px 24px rgba(0,0,0,.12);
  --sh-3: 0 25px 50px rgba(0,0,0,.18);
  /* 兼容旧变量名（JS 内联样式仍在用） */
  --qem-bg: var(--bg-0); --qem-bg-soft: var(--bg-1); --qem-bg-hover: var(--bg-2);
  --qem-border: var(--bd); --qem-text: var(--fg); --qem-text-soft: var(--fg-2);
  --qem-accent: var(--pri); --qem-accent-soft: var(--pri-soft);
  --qem-danger: var(--err); --qem-warn: var(--warn); --qem-shadow: var(--sh-2); --qem-radius: var(--r-md);

  font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}

.qem-scope.qem-dark {
  --bg-0: #1f2123; --bg-1: #26282b; --bg-2: #2d2f33; --bg-3: #35383d;
  --bd: #333333; --bd-2: #404347;
  --fg: #f5f5f5; --fg-2: #a9b0b8; --fg-3: #7d848c;
  --pri: #4cc2ff; --pri-fg: #08243a; --pri-hov: #6fd0ff;
  --pri-soft: #2b3a4a; --pri-bd: #2f4a63;
  --ok: #2fbf8f; --ok-soft: rgba(47,191,143,.14);
  --warn: #e6a23c; --warn-soft: rgba(230,162,60,.16);
  --err: #f06b76; --err-soft: rgba(240,107,118,.15);
  --sh-1: 0 1px 2px rgba(0,0,0,.4);
  --sh-2: 0 8px 24px rgba(0,0,0,.42);
  --sh-3: 0 25px 50px rgba(0,0,0,.55);
}

/* —— 表单控件 —— */
.qem-scope button {
  font: inherit; color: var(--fg); background: var(--bg-0);
  border: 1px solid var(--bd-2); border-radius: var(--r-sm);
  padding: 5px 12px; cursor: pointer; user-select: none;
  transition: background .12s, border-color .12s, box-shadow .12s, color .12s;
}
.qem-scope button:hover { background: var(--bg-2); border-color: var(--bd-2); }
.qem-scope button:active { transform: translateY(0); }
.qem-scope button:disabled { opacity: .45; cursor: not-allowed; }
.qem-scope button:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--pri-soft); border-color: var(--pri); }
.qem-scope button.primary { background: var(--pri); border-color: var(--pri); color: var(--pri-fg); font-weight: 500; }
.qem-scope button.primary:hover { background: var(--pri-hov); border-color: var(--pri-hov); }
.qem-scope button.danger { color: var(--err); }
.qem-scope button.danger:hover { background: var(--err-soft); border-color: var(--err); color: var(--err); }
.qem-scope button.ghost { border-color: transparent; background: transparent; }

.qem-scope input[type=text], .qem-scope input[type=number], .qem-scope input[type=password], .qem-scope input[type=date],
.qem-scope select, .qem-scope textarea {
  font: inherit; color: var(--fg); background: var(--bg-0);
  border: 1px solid var(--bd-2); border-radius: var(--r-sm);
  padding: 6px 9px; width: 100%; outline: none;
  transition: border-color .12s, box-shadow .12s;
}
.qem-scope input:focus, .qem-scope select:focus, .qem-scope textarea:focus {
  border-color: var(--pri); box-shadow: 0 0 0 3px var(--pri-soft);
}
.qem-scope input::placeholder, .qem-scope textarea::placeholder { color: var(--fg-3); }
.qem-scope input[type=checkbox] { width: auto; accent-color: var(--pri); }
.qem-scope select { cursor: pointer; }
.qem-scope textarea { resize: vertical; line-height: 1.5; }
.qem-scope label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

/* —— 布局工具类 —— */
.qem-scope .row { display: flex; align-items: center; gap: 8px; }
.qem-scope .col { display: flex; flex-direction: column; gap: 10px; }
.qem-scope .muted { color: var(--fg-2); }
.qem-scope .grow { flex: 1; min-width: 0; }
.qem-scope .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* —— 悬浮球 —— */
.qem-fab {
  position: fixed; z-index: 2147483000; width: 48px; height: 48px;
  border-radius: 50%; border: none; cursor: pointer; user-select: none;
  background: linear-gradient(135deg, #0f83e6, #0067c0);
  color: #fff; font-size: 20px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 16px rgba(0,103,192,.38), inset 0 1px 0 rgba(255,255,255,.28);
  transition: transform .15s, box-shadow .15s;
}
.qem-fab:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,103,192,.45); }
.qem-fab:active { transform: none; }
.qem-dark .qem-fab { background: linear-gradient(135deg, #3aa5f2, #1f7fd0); box-shadow: 0 6px 16px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.16); }
.qem-fab.br { right: 22px; bottom: 96px; } .qem-fab.bl { left: 22px; bottom: 96px; }
.qem-fab.tr { right: 22px; top: 96px; }   .qem-fab.tl { left: 22px; top: 96px; }

/* —— 遮罩与面板 —— */
.qem-mask {
  position: fixed; inset: 0; z-index: 2147483001;
  background: rgba(15, 20, 28, .5); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}
.qem-panel {
  background: var(--bg-0); border: 1px solid var(--bd-2); border-radius: var(--r-xl);
  box-shadow: var(--sh-3); display: flex; flex-direction: column; overflow: hidden;
  animation: qem-pop .16s ease-out;
}
@keyframes qem-pop { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
.qem-panel.qem-lg { width: min(1180px, 94vw); height: min(760px, 92vh); }
.qem-panel.qem-md { width: min(720px, 94vw); max-height: 88vh; }
.qem-panel.qem-sm { width: min(460px, 92vw); }

/* —— 面板三区：页眉 / 内容 / 页脚（明确的区域边界） —— */
.qem-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; background: var(--bg-1); border-bottom: 1px solid var(--bd);
}
.qem-head .title { font-weight: 600; font-size: 15px; letter-spacing: .2px; color: var(--fg); }
.qem-head button.ghost {
  width: 28px; height: 28px; padding: 0; border-radius: var(--r-sm);
  color: var(--fg-3); font-size: 15px; line-height: 1;
}
.qem-head button.ghost:hover { background: var(--bg-2); color: var(--fg); }
.qem-body { flex: 1; overflow: auto; padding: 14px 16px; }
.qem-foot {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; background: var(--bg-1); border-top: 1px solid var(--bd);
}
.qem-foot .muted { font-size: 12.5px; }

/* —— 面包屑（独立条带，与工具栏分明） —— */
.qem-crumb {
  display: flex; align-items: center; gap: 2px; flex-wrap: wrap;
  padding: 6px 10px; background: var(--bg-1);
  border: 1px solid var(--bd); border-radius: var(--r-lg); font-size: 12.5px;
}
.qem-crumb button { border: none; background: transparent; padding: 3px 6px; border-radius: var(--r-sm); color: var(--pri); }
.qem-crumb button:hover { background: var(--pri-soft); }
.qem-crumb button:last-of-type { color: var(--fg); font-weight: 600; }
.qem-crumb span.sep { color: var(--fg-3); margin: 0 1px; }

/* —— 工具栏（软底色卡片，按钮为浮起芯片） —— */
.qem-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 8px 10px; background: var(--bg-1);
  border: 1px solid var(--bd); border-radius: var(--r-lg);
}
.qem-toolbar button {
  border-color: transparent; background: transparent;
  padding: 5px 10px; font-size: 12.5px;
}
.qem-toolbar button:hover { background: var(--bg-0); border-color: var(--bd-2); box-shadow: var(--sh-1); }
.qem-toolbar button.primary { background: var(--pri); color: var(--pri-fg); border-color: transparent; }
.qem-toolbar button.primary:hover { background: var(--pri-hov); }
.qem-toolbar button.danger { color: var(--err); }
.qem-toolbar button.danger:hover { background: var(--err-soft); border-color: var(--err); }
.qem-sep { width: 1px; height: 22px; background: var(--bd-2); margin: 0 2px; flex: 0 0 auto; }

/* —— 搜索条（当前目录筛选 + 全盘搜索入口） —— */
.qem-search {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 7px 10px; background: var(--bg-1);
  border: 1px solid var(--bd); border-radius: var(--r-lg);
  transition: border-color .12s, background .12s;
}
.qem-search.on { border-color: var(--pri-bd); background: var(--pri-soft); }
.qem-search .box { position: relative; flex: 1; min-width: 180px; display: flex; align-items: center; }
.qem-search .box input { padding-left: 28px; padding-right: 28px; }
.qem-search .box .ico { position: absolute; left: 9px; font-size: 12px; color: var(--fg-3); pointer-events: none; }
.qem-search .box .clr {
  position: absolute; right: 4px; width: 20px; height: 20px; padding: 0;
  border: none; background: transparent; color: var(--fg-3);
  font-size: 12px; line-height: 1; border-radius: 50%; display: none;
}
.qem-search .box .clr.on { display: block; }
.qem-search .box .clr:hover { background: var(--bg-3); color: var(--fg); }
.qem-search .stat { font-size: 12px; font-weight: 600; color: var(--pri); white-space: nowrap; }
.qem-search .hint { font-size: 11.5px; color: var(--fg-3); white-space: nowrap; }
.qem-search > button { font-size: 12.5px; padding: 4px 10px; }

/* 搜索命中高亮 */
.qem-table mark.qem-hl { background: #ffe9a8; color: inherit; padding: 0 1px; border-radius: 2px; }
.qem-dark .qem-table mark.qem-hl { background: rgba(255,205,80,.26); color: var(--fg); }
/* 键盘游标行 */
.qem-table tbody tr.cur { outline: 2px solid var(--pri); outline-offset: -2px; }

@media (max-width: 720px) {
  .qem-search .hint { display: none; }
  .qem-search .box { min-width: 120px; }
}

/* —— 内容区（带边框的内容卡，框出列表区域） —— */
.qem-content { border: 1px solid var(--bd); border-radius: var(--r-lg); background: var(--bg-0); overflow: hidden; }

/* —— タブ —— */
.qem-tabs { display: flex; gap: 2px; overflow-x: auto; padding: 0 10px; background: var(--bg-1); border-bottom: 1px solid var(--bd); }
.qem-tab {
  padding: 9px 14px; border: none; background: transparent; border-radius: 0;
  border-bottom: 2px solid transparent; color: var(--fg-2); white-space: nowrap; font-size: 13px;
}
.qem-tab:hover { color: var(--fg); background: var(--bg-2); }
.qem-tab.active { color: var(--pri); border-bottom-color: var(--pri); font-weight: 600; }

/* —— 表格 —— */
.qem-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.qem-table th {
  position: sticky; top: 0; z-index: 2; background: var(--bg-1);
  color: var(--fg-2); font-weight: 600; font-size: 12px;
  padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--bd-2); white-space: nowrap;
}
.qem-table td { padding: 8px 10px; border-bottom: 1px solid var(--bd); vertical-align: middle; }
.qem-table tbody tr { transition: background .12s; }
.qem-table tbody tr:hover { background: var(--bg-2); }
.qem-table tbody tr.sel { background: var(--pri-soft); box-shadow: inset 3px 0 0 var(--pri); }
.qem-table tbody tr:last-child td { border-bottom: none; }
.qem-table th[title] { cursor: pointer; user-select: none; }
.qem-table th[title]:hover { background: var(--bg-2); color: var(--fg); }
.qem-table td.num { text-align: right; font-variant-numeric: tabular-nums; color: var(--fg-2); }
.qem-table .name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.qem-table .name .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* —— 标签 —— */
.qem-tag {
  display: inline-flex; align-items: center; padding: 1px 8px;
  border-radius: 999px; background: var(--bg-2); color: var(--fg-2);
  font-size: 11.5px; font-weight: 500;
}
.qem-tag.ok { background: var(--ok-soft); color: var(--ok); }
.qem-tag.warn { background: var(--warn-soft); color: var(--warn); }
.qem-tag.err { background: var(--err-soft); color: var(--err); }

/* —— 进度条 —— */
.qem-bar { height: 8px; border-radius: 999px; background: var(--bg-2); overflow: hidden; }
.qem-bar > i { display: block; height: 100%; width: 0; border-radius: 999px; background: var(--pri); transition: width .2s; }

/* —— 提示条 —— */
.qem-toasts { position: fixed; z-index: 2147483600; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 10px; align-items: flex-end; }
.qem-toast {
  background: var(--bg-0); color: var(--fg); border: 1px solid var(--bd-2);
  border-left: 3px solid var(--pri); border-radius: var(--r-md);
  padding: 9px 14px; box-shadow: var(--sh-2); max-width: 400px;
  animation: qem-in .18s ease-out;
}
.qem-toast.error { border-left-color: var(--err); }
.qem-toast.warn { border-left-color: var(--warn); }
@keyframes qem-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* —— 分段器 —— */
.qem-seg { display: inline-flex; border: 1px solid var(--bd-2); border-radius: var(--r-sm); overflow: hidden; background: var(--bg-0); }
.qem-seg button { border: none; border-radius: 0; border-right: 1px solid var(--bd); }
.qem-seg button:last-child { border-right: none; }
.qem-seg button.active { background: var(--pri); color: var(--pri-fg); }

/* —— 空态 / 虚线卡 / 滚动 / 等宽 —— */
.qem-empty { padding: 44px 12px; text-align: center; color: var(--fg-2); }
.qem-drop { border: 1px dashed var(--bd-2); border-radius: var(--r-lg); padding: 12px; background: var(--bg-1); }
.qem-scroll { overflow: auto; }
.qem-mono { font-family: ui-monospace, Consolas, Menlo, monospace; font-size: 12px; }

/* —— 表格密度（视图偏好） —— */
.qem-table.d-compact td, .qem-table.d-compact th { padding: 2px 8px; }
.qem-table.d-normal td, .qem-table.d-normal th { padding: 6px 8px; }
.qem-table.d-loose td, .qem-table.d-loose th { padding: 11px 10px; }

/* —— 缩略图 —— */
.qem-thumb { width: 30px; height: 30px; border-radius: 5px; object-fit: cover; background: var(--bg-2); flex: 0 0 auto; }
.qem-table.d-compact .qem-thumb { width: 22px; height: 22px; }

/* —— 排行条 —— */
.qem-rank { display: flex; align-items: center; gap: 8px; }
.qem-rank .track { flex: 1; height: 8px; border-radius: 999px; background: var(--bg-2); overflow: hidden; min-width: 60px; }
.qem-rank .track > i { display: block; height: 100%; background: var(--pri); }
.qem-rank .val { min-width: 84px; text-align: right; font-variant-numeric: tabular-nums; color: var(--fg-2); }

/* —— 滚动条（细、悬停加深） —— */
.qem-scope ::-webkit-scrollbar { width: 10px; height: 10px; }
.qem-scope ::-webkit-scrollbar-track { background: transparent; }
.qem-scope ::-webkit-scrollbar-thumb { background: var(--bd-2); border-radius: 999px; border: 3px solid transparent; background-clip: padding-box; }
.qem-scope ::-webkit-scrollbar-thumb:hover { background: var(--fg-3); background-clip: padding-box; }

/* —— 响应式：小屏大面板全屏、小弹窗收敛 —— */
@media (max-width: 720px) {
  .qem-panel.qem-lg { width: 100vw !important; height: 100vh !important; border-radius: 0; border: none; }
  .qem-panel.qem-md, .qem-panel.qem-sm { width: 94vw; max-height: 88vh; }
  .qem-head { padding: 10px 12px; }
  .qem-body { padding: 10px 12px; }
  .qem-foot { padding: 8px 12px; }
  .qem-toolbar { gap: 5px; padding: 7px 8px; }
  .qem-crumb { padding: 5px 8px; }
}
/* —— 响应式：触控设备放大点击目标 —— */
@media (hover: none) and (pointer: coarse) {
  .qem-scope button { min-height: 38px; padding: 8px 12px; }
  .qem-toolbar button { min-height: 34px; }
  .qem-table td { padding: 10px; }
  .qem-table th[title] { min-height: 38px; }
  .qem-fab { width: 52px; height: 52px; }
  .qem-head button.ghost { width: 32px; height: 32px; }
}

`;

    const ui = {
        host: null,
        scope: null,
        toasts: null,
        panels: [],

        /** 懒创建 Shadow 宿主 */
        ensureHost() {
            if (this.host && this.host.isConnected) return;
            const host = document.createElement('div');
            host.id = NS + '-root';
            host.style.cssText = 'all:initial;position:static';
            const shadow = host.attachShadow({ mode: 'open' });
            const style = document.createElement('style');
            style.textContent = UI_CSS;
            const scope = document.createElement('div');
            scope.className = 'qem-scope';
            const toasts = document.createElement('div');
            toasts.className = 'qem-toasts';
            shadow.append(style, scope, toasts);
            (document.body || document.documentElement).appendChild(host);
            this.host = host;
            this.scope = scope;
            this.toasts = toasts;
            this.applyTheme();
        },

        applyTheme() {
            if (!this.scope) return;
            const mode = config.get('theme', 'auto');
            const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
            this.scope.classList.toggle('qem-dark', dark);
        },

        toast(msg, type = 'info', ms = 2600) {
            this.ensureHost();
            const el = document.createElement('div');
            el.className = 'qem-toast ' + (type === 'info' ? '' : type);
            el.textContent = String(msg);
            this.toasts.appendChild(el);
            setTimeout(() => {
                el.style.transition = 'opacity .25s';
                el.style.opacity = '0';
                setTimeout(() => el.remove(), 300);
            }, ms);
        },

        /**
         * 通用面板
         * @returns {{el:HTMLElement, body:HTMLElement, foot:HTMLElement, close:Function}}
         */
        panel({ title, size = 'md', buttons = [], onClose = null, closeOnMask = true }) {
            this.ensureHost();
            const mask = document.createElement('div');
            mask.className = 'qem-mask';
            const box = document.createElement('div');
            box.className = 'qem-panel qem-' + size;
            const head = document.createElement('div');
            head.className = 'qem-head';
            head.innerHTML = `<div class="title grow ellipsis">${util.escapeHtml(title || '')}</div>`;
            const closeBtn = document.createElement('button');
            closeBtn.className = 'ghost';
            closeBtn.textContent = '✕';
            closeBtn.title = t('close');
            head.appendChild(closeBtn);
            const body = document.createElement('div');
            body.className = 'qem-body';
            const foot = document.createElement('div');
            foot.className = 'qem-foot';

            const api = {
                el: mask, box, body, foot,
                close() {
                    mask.remove();
                    const i = ui.panels.indexOf(api);
                    if (i >= 0) ui.panels.splice(i, 1);
                    if (onClose) { try { onClose(); } catch (e) { /* 忽略 */ } }
                },
            };

            closeBtn.addEventListener('click', api.close);
            if (closeOnMask) mask.addEventListener('mousedown', (e) => { if (e.target === mask) api.close(); });

            (buttons || []).forEach((b) => {
                const btn = document.createElement('button');
                btn.textContent = b.label;
                if (b.primary) btn.className = 'primary';
                if (b.danger) btn.className = 'danger';
                btn.addEventListener('click', () => b.onClick(api));
                if (b.id) btn.dataset.role = b.id;
                foot.appendChild(btn);
            });
            if (!buttons || !buttons.length) foot.style.display = 'none';

            box.append(head, body, foot);
            mask.appendChild(box);
            this.scope.appendChild(mask);
            this.panels.push(api);
            return api;
        },

        /**
         * 生成一次性结算函数。
         * 必须用它包一层：close() 会同步触发 onClose，若不设哨兵，
         * onClose 里的「取消」结果会抢先决议，导致确定/输入永远拿不到值。
         */
        once(resolve) {
            let done = false;
            return (v) => { if (done) return; done = true; resolve(v); };
        },

        confirm(message, { title = t('confirmTitle'), okText = t('ok'), danger = false } = {}) {
            return new Promise((resolve) => {
                const done = this.once(resolve);
                const p = this.panel({
                    title, size: 'sm', closeOnMask: false,
                    buttons: [
                        { label: t('cancel'), onClick: (api) => { done(false); api.close(); } },
                        { label: okText, primary: !danger, danger, onClick: (api) => { done(true); api.close(); } },
                    ],
                    onClose: () => done(false),
                });
                const div = document.createElement('div');
                div.style.whiteSpace = 'pre-wrap';
                div.textContent = String(message);
                p.body.appendChild(div);
            });
        },

        prompt(message, { title = t('promptTitle'), value = '', placeholder = '', okText = t('ok') } = {}) {
            return new Promise((resolve) => {
                const done = this.once(resolve);
                let input = null;
                const p = this.panel({
                    title, size: 'sm', closeOnMask: false,
                    buttons: [
                        { label: t('cancel'), onClick: (api) => { done(null); api.close(); } },
                        { label: okText, primary: true, onClick: (api) => { done(input ? input.value : null); api.close(); } },
                    ],
                    onClose: () => done(null),
                });
                const wrap = document.createElement('div');
                wrap.className = 'col';
                const label = document.createElement('div');
                label.textContent = String(message);
                input = document.createElement('input');
                input.type = 'text';
                input.value = value;
                input.placeholder = placeholder;
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.stopPropagation(); done(input.value); p.close(); }
                    if (e.key === 'Escape') { e.stopPropagation(); done(null); p.close(); }
                });
                wrap.append(label, input);
                p.body.appendChild(wrap);
                setTimeout(() => { input.focus(); input.select(); }, 30);
            });
        },

        /** 带实时进度的长任务弹窗 */
        progress(title) {
            const p = this.panel({ title, size: 'sm', closeOnMask: false, buttons: [] });
            const wrap = document.createElement('div');
            wrap.className = 'col';
            const text = document.createElement('div');
            text.className = 'muted';
            text.textContent = t('working');
            const bar = document.createElement('div');
            bar.className = 'qem-bar';
            const fill = document.createElement('i');
            bar.appendChild(fill);
            wrap.append(text, bar);
            p.body.appendChild(wrap);
            let cancelled = false;
            return {
                el: p.el,
                set(ratio, msg) {
                    fill.style.width = Math.max(0, Math.min(1, ratio || 0)) * 100 + '%';
                    if (msg) text.textContent = msg;
                },
                text(msg) { text.textContent = msg; },
                get cancelled() { return cancelled; },
                cancelBtn() {
                    const btn = document.createElement('button');
                    btn.textContent = t('cancel');
                    btn.addEventListener('click', () => { cancelled = true; text.textContent = '正在停止...'; });
                    p.foot.style.display = '';
                    p.foot.appendChild(btn);
                },
                close() { p.close(); },
            };
        },

        /** 结果表格：columns = [{key,label,render?,align?,sortable?,width?}] */
        table(columns, rows, { selectable = false, onSelectionChange = null, maxHeight = '52vh', sortKey = '', sortOrder = 'asc', onSort = null, density = '' } = {}) {
            const wrap = document.createElement('div');
            wrap.className = 'qem-scroll';
            wrap.style.maxHeight = maxHeight;
            const table = document.createElement('table');
            table.className = 'qem-table' + (density && density !== 'normal' ? ' d-' + density : '');
            const thead = document.createElement('thead');
            const trh = document.createElement('tr');
            const selected = new Set();

            if (selectable) {
                const th = document.createElement('th');
                th.style.width = '30px';
                const cbAll = document.createElement('input');
                cbAll.type = 'checkbox';
                cbAll.addEventListener('change', () => {
                    selected.clear();
                    if (cbAll.checked) rows.forEach((r, i) => selected.add(i));
                    table.querySelectorAll('tbody input[type=checkbox]').forEach((cb) => { cb.checked = cbAll.checked; });
                    table.querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('sel', cbAll.checked));
                    if (onSelectionChange) onSelectionChange(Array.from(selected).map((i) => rows[i]));
                });
                th.appendChild(cbAll);
                trh.appendChild(th);
            }
            columns.forEach((c) => {
                const th = document.createElement('th');
                th.textContent = c.label;
                if (c.align === 'right') th.style.textAlign = 'right';
                if (c.width) th.style.width = c.width;
                if (onSort && c.key) {
                    th.style.cursor = 'pointer';
                    th.style.userSelect = 'none';
                    th.title = '点击切换排序';
                    if (c.key === sortKey) th.textContent = c.label + (sortOrder === 'asc' ? ' ▲' : ' ▼');
                    th.addEventListener('click', () => {
                        const next = (c.key === sortKey && sortOrder === 'asc') ? 'desc' : 'asc';
                        onSort(c.key, next);
                    });
                }
                trh.appendChild(th);
            });
            thead.appendChild(trh);
            const tbody = document.createElement('tbody');

            rows.forEach((row, idx) => {
                const tr = document.createElement('tr');
                if (selectable) {
                    const td = document.createElement('td');
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.addEventListener('change', (e) => {
                        e.stopPropagation();
                        if (cb.checked) selected.add(idx); else selected.delete(idx);
                        tr.classList.toggle('sel', cb.checked);
                        if (onSelectionChange) onSelectionChange(Array.from(selected).map((i) => rows[i]));
                    });
                    td.appendChild(cb);
                    tr.appendChild(td);
                }
                columns.forEach((c) => {
                    const td = document.createElement('td');
                    if (c.align === 'right') td.className = 'num';
                    if (c.render) {
                        const r = c.render(row[c.key], row, idx);
                        // 鸭子类型判断，避免依赖全局 Node 构造器（沙箱/隔离环境可能不可用）
                        if (r && typeof r === 'object' && typeof r.nodeType === 'number') td.appendChild(r);
                        else td.innerHTML = String(r ?? '');
                    } else {
                        td.textContent = String(row[c.key] ?? '');
                    }
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });

            table.append(thead, tbody);
            wrap.appendChild(table);
            return {
                el: wrap,
                selectedRows: () => Array.from(selected).map((i) => rows[i]),
                clearSelection: () => { selected.clear(); table.querySelectorAll('tbody input[type=checkbox]').forEach((cb) => { cb.checked = false; }); table.querySelectorAll('tbody tr').forEach((tr) => tr.classList.remove('sel')); },
            };
        },

        /** 表单构建器：fields = [{key,label,type,value,options,min,max,placeholder,hint}] */
        form(fields, onChange = null) {
            const box = document.createElement('div');
            box.className = 'col';
            const values = {};
            const inputs = {};
            fields.forEach((f) => {
                if (f.type === 'group') {
                    const g = document.createElement('div');
                    g.className = 'drop';
                    const gt = document.createElement('div');
                    gt.style.fontWeight = '600';
                    gt.style.marginBottom = '8px';
                    gt.textContent = f.label;
                    g.appendChild(gt);
                    const inner = this.form(f.fields || [], (k, v, all) => { if (onChange) onChange(k, v, all); });
                    g.appendChild(inner.el);
                    Object.assign(values, inner.values);
                    Object.assign(inputs, inner.inputs);
                    box.appendChild(g);
                    return;
                }
                const wrap = document.createElement('div');
                const row = document.createElement('div');
                row.className = 'row';
                const label = document.createElement('div');
                label.style.minWidth = '96px';
                label.style.color = 'var(--qem-text-soft)';
                label.textContent = f.label;
                row.appendChild(label);
                let input;
                if (f.type === 'select') {
                    input = document.createElement('select');
                    (f.options || []).forEach((o) => {
                        const op = document.createElement('option');
                        op.value = o.value === undefined ? o : o.value;
                        op.textContent = o.label === undefined ? String(o) : o.label;
                        input.appendChild(op);
                    });
                    input.value = f.value === undefined ? '' : f.value;
                } else if (f.type === 'checkbox') {
                    input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = !!f.value;
                    input.style.width = 'auto';
                } else if (f.type === 'textarea') {
                    input = document.createElement('textarea');
                    input.rows = f.rows || 4;
                    input.value = f.value === undefined ? '' : f.value;
                    input.placeholder = f.placeholder || '';
                } else {
                    input = document.createElement('input');
                    input.type = f.type || 'text';
                    if (f.min !== undefined) input.min = f.min;
                    if (f.max !== undefined) input.max = f.max;
                    input.value = f.value === undefined ? '' : f.value;
                    input.placeholder = f.placeholder || '';
                    if (f.type === 'checkbox') input.style.width = 'auto';
                }
                if (f.type === 'checkbox') input.style.flex = '0 0 auto';
                else input.classList.add('grow');
                const emit = () => {
                    values[f.key] = f.type === 'checkbox' ? input.checked : input.value;
                    if (onChange) onChange(f.key, values[f.key], values);
                };
                input.addEventListener('input', emit);
                input.addEventListener('change', emit);
                inputs[f.key] = input;
                values[f.key] = f.type === 'checkbox' ? input.checked : input.value;
                row.appendChild(input);
                wrap.appendChild(row);
                if (f.hint) {
                    const h = document.createElement('div');
                    h.className = 'muted';
                    h.style.margin = '3px 0 0 96px';
                    h.style.fontSize = '11.5px';
                    h.textContent = f.hint;
                    wrap.appendChild(h);
                }
                box.appendChild(wrap);
            });
            return { el: box, values, inputs, setValue(k, v) { if (inputs[k]) { inputs[k].value = v; values[k] = v; } } };
        },
    };

    /* ======================================================================
     * 5. 夸克接口适配层
     *    —— 与 PikPak 版最大的架构差异：
     *       1) 原版靠 localStorage 里的 Bearer token；夸克用 Cookie 会话
     *          （__pus / __puus），页面同源请求自动携带，无需解析 token。
     *       2) 原版是单一域名 api-drive.mypikpak.com + files:* 批量语义；
     *          夸克是 drive-pc.quark.cn/1/clouddrive/* 的 REST 语义，
     *          多文件操作靠 body 里的 filelist 数组。
     *       3) 所有路径/字段集中在下表，官方改版时只改这里，不动业务代码。
     * ==================================================================== */

    const API_BASE = 'https://drive-pc.quark.cn/1/clouddrive';
    const COMMON_Q = 'pr=ucpro&fr=pc&uc_param_str=';

    const EP = {
        list: {
            method: 'GET', path: '/file/sort',
            query: (p) => `${COMMON_Q}&pdir_fid=${encodeURIComponent(p.pdir_fid)}&_page=${p.page || 1}&_size=${p.size || PAGE_SIZE}` +
                `&_fetch_total=1&_fetch_sub_dirs=0&_sort=${encodeURIComponent(p.sort || 'file_type:asc,updated_at:desc')}`,
        },
        search: {
            method: 'GET', path: '/file/search',
            query: (p) => `${COMMON_Q}&q=${encodeURIComponent(p.q)}&_page=${p.page || 1}&_size=${p.size || PAGE_SIZE}` +
                `&_fetch_total=1&_sort=${encodeURIComponent(p.sort || 'file_type:desc,updated_at:desc')}&_is_hl=1`,
        },
        mkdir: {
            method: 'POST', path: '/file',
            query: () => COMMON_Q,
            body: (p) => ({ pdir_fid: p.pdir_fid, file_name: p.file_name, dir_path: '', dir_init_lock: false }),
        },
        rename: {
            method: 'POST', path: '/file/rename',
            query: () => COMMON_Q,
            body: (p) => ({ fid: p.fid, file_name: p.file_name }),
        },
        move: {
            method: 'POST', path: '/file/move',
            query: () => COMMON_Q,
            body: (p) => ({ filelist: p.filelist, to_pdir_fid: p.to_pdir_fid, exclude_fids: [] }),
        },
        remove: {
            method: 'POST', path: '/file/delete',
            query: () => COMMON_Q,
            body: (p) => ({ action_type: 2, exclude_fids: [], filelist: p.filelist }),
        },
        download: {
            method: 'POST', path: '/file/download',
            query: () => COMMON_Q,
            body: (p) => ({ fids: p.fids }),
        },
        capacity: { method: 'GET', path: '/member', query: () => COMMON_Q },
        task: {
            method: 'GET', path: '/task',
            query: (p) => `${COMMON_Q}&task_id=${encodeURIComponent(p.task_id)}&retry_index=${p.retry_index || 0}`,
        },
        // —— 分享
        shareCreate: { method: 'POST', path: '/share', query: () => COMMON_Q, body: (p) => ({ fid_list: p.fid_list, title: p.title || '', url_type: p.url_type, expired_type: p.expired_type }) },
        sharePassword: { method: 'POST', path: '/share/password', query: () => COMMON_Q, body: (p) => ({ share_id: p.share_id }) },
        shareMyList: { method: 'GET', path: '/share/mypage/detail', query: (p) => `${COMMON_Q}&_page=${p.page || 1}&_size=${p.size || 50}&_fetch_total=1&_sort=created_at:desc` },
        shareCancel: { method: 'POST', path: '/share/cancel', query: () => COMMON_Q, body: (p) => ({ share_id_list: p.share_id_list }) },
        shareToken: { method: 'POST', path: '/share/sharepage/token', query: () => COMMON_Q, body: (p) => ({ pwd_id: p.pwd_id, passcode: p.passcode || '' }) },
        shareDetail: {
            method: 'GET', path: '/share/sharepage/detail',
            query: (p) => `${COMMON_Q}&pwd_id=${encodeURIComponent(p.pwd_id)}&stoken=${encodeURIComponent(p.stoken)}&pdir_fid=${p.pdir_fid || '0'}` +
                `&_page=${p.page || 1}&_size=${p.size || PAGE_SIZE}&_fetch_total=1&_fetch_banner=0&_fetch_share=0&force=0`,
        },
        shareSave: {
            method: 'POST', path: '/share/sharepage/save', query: () => COMMON_Q,
            body: (p) => ({ fid_list: p.fid_list, fid_token_list: p.fid_token_list, to_pdir_fid: p.to_pdir_fid, pwd_id: p.pwd_id, stoken: p.stoken, pdir_fid: '0', scene: 'link' }),
        },
        // —— 回收站
        recycleList: { method: 'GET', path: '/file/recycle/list', query: (p) => `${COMMON_Q}&_page=${p.page || 1}&_size=${p.size || 100}&_fetch_total=1&_sort=${encodeURIComponent('updated_at:desc')}` },
        recycleRestore: { method: 'POST', path: '/file/recycle/restore', query: () => COMMON_Q, body: (p) => ({ filelist: p.filelist, exclude_fids: [] }) },
        recycleDelete: { method: 'POST', path: '/file/recycle/delete', query: () => COMMON_Q, body: (p) => ({ filelist: p.filelist, exclude_fids: [] }) },
        recycleClear: { method: 'POST', path: '/file/recycle/clear', query: () => COMMON_Q, body: () => ({}) },
    };

    /** 请求守卫：最小间隔 + 并发上限 + 失败重试 + 错误归类 */
    const guard = {
        queue: [],
        running: 0,
        lastAt: 0,

        async run(fn) {
            return new Promise((resolve, reject) => {
                this.queue.push({ fn, resolve, reject });
                this.pump();
            });
        },

        pump() {
            const turbo = config.get('turbo', true);
            const max = turbo ? Math.max(1, Number(config.get('concurrency', 4)) || 4) : 1;
            while (this.running < max && this.queue.length) {
                const job = this.queue.shift();
                this.running++;
                // 节流关闭时不再施加最小间隔，与设置页「关闭将全速请求」的说明保持一致
                const wait = turbo ? Math.max(0, (Number(config.get('minInterval', 120)) || 0) - (Date.now() - this.lastAt)) : 0;
                setTimeout(async () => {
                    this.lastAt = Date.now();
                    try { job.resolve(await job.fn()); } catch (e) { job.reject(e); } finally {
                        this.running--;
                        this.pump();
                    }
                }, wait);
            }
        },
    };

    class ApiError extends Error {
        constructor(message, code, endpoint) {
            super(message);
            this.name = 'ApiError';
            this.code = code;
            this.endpoint = endpoint;
            // 错误归类，供熔断与提示分流
            this.kind = code === 31001 ? 'auth'
                : code === 429 || code === 31023 ? 'throttle'
                    : code === -2 || code === -100 || code === 'network' ? 'network'
                        : 'business';
        }
    }

    /**
     * 熔断器：连续失败达阈值后暂停请求，避免官方接口异常时无限重试刷屏
     * （上游 issue #20 的现场就是 Retry 1/5…2/5 循环 + 列表全空）
     */
    const breaker = {
        fails: 0,
        openedAt: 0,
        lastKind: '',

        threshold() { return Math.max(2, Number(config.get('breaker.threshold', 6)) || 6); },
        cooldown() { return Math.max(3000, Number(config.get('breaker.cooldown', 30000)) || 30000); },

        isOpen() {
            if (!this.openedAt) return false;
            if (Date.now() - this.openedAt >= this.cooldown()) { this.reset(); return false; }
            return true;
        },

        remainMs() { return Math.max(0, this.cooldown() - (Date.now() - this.openedAt)); },

        recordFail(kind) {
            this.lastKind = kind || 'business';
            this.fails++;
            if (this.fails >= this.threshold() && !this.openedAt) {
                this.openedAt = Date.now();
                ui.toast(`接口连续失败 ${this.fails} 次，已暂停请求 ${Math.round(this.cooldown() / 1000)} 秒（疑似官方接口异常或网络异常）`, 'error', 6000);
            }
        },

        recordSuccess() {
            this.fails = 0;
            this.openedAt = 0;
        },

        reset() { this.fails = 0; this.openedAt = 0; this.lastKind = ''; },
    };

    /** 若 __pus/__puus 可读（非 httpOnly），补进查询串以兼容部分需要签名的接口 */
    function signExtra() {
        try {
            const raw = document.cookie || '';
            const pick = (k) => {
                const m = new RegExp('(?:^|;\\s*)' + k + '=([^;]+)').exec(raw);
                return m ? m[1] : '';
            };
            const pus = pick('__pus');
            const puus = pick('__puus');
            let s = '';
            if (pus) s += `&__pus=${encodeURIComponent(pus)}`;
            if (puus) s += `&__puus=${encodeURIComponent(puus)}`;
            return s;
        } catch (e) { return ''; }
    }

    const api = {
        authLost: false,
        onAuthLost: null,

        async raw(name, params = {}, { retry = 2, silent = false, bypassBreaker = false } = {}) {
            const ep = EP[name];
            if (!ep) throw new ApiError('未知接口: ' + name, -1, name);
            if (!bypassBreaker && breaker.isOpen()) {
                throw new ApiError(
                    `接口连续异常，已暂停请求 ${Math.ceil(breaker.remainMs() / 1000)} 秒（可在「设置 → 可靠性」中调整或立即恢复）`,
                    'network', name,
                );
            }
            let url = API_BASE + ep.path + '?' + (ep.query ? ep.query(params) : COMMON_Q) + signExtra();
            url += '&__t=' + util.stamp();
            const init = {
                method: ep.method,
                credentials: 'include',
                headers: { 'Accept': 'application/json' },
                cache: 'no-store',
            };
            if (ep.method === 'POST') {
                init.headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(ep.body ? ep.body(params) : {});
            }

            let lastErr = null;
            for (let attempt = 0; attempt <= retry; attempt++) {
                try {
                    const res = await guard.run(() => fetch(url, init));
                    if (res.status === 401 || res.status === 403) {
                        throw new ApiError('登录状态已失效，请刷新页面并重新登录夸克网盘', 31001, name);
                    }
                    const json = await res.json().catch(() => null);
                    if (!json) throw new ApiError('接口返回内容无法解析（HTTP ' + res.status + '）', -2, name);
                    if (json.status === 200 && (json.code === 0 || json.code === undefined)) {
                        breaker.recordSuccess();
                        return json;
                    }

                    const msg = json.message || json.msg || ('接口错误 code=' + json.code);
                    // 登录态失效：不计入熔断（属用户侧问题）
                    if (json.code === 31001 || /ptoken|未登录|登录/.test(String(msg))) {
                        if (!this.authLost) {
                            this.authLost = true;
                            ui.toast('夸克登录状态已失效，请刷新页面重新登录后使用', 'error', 5000);
                            if (this.onAuthLost) { try { this.onAuthLost(); } catch (e) { /* 忽略 */ } }
                        }
                        throw new ApiError(msg, json.code, name);
                    }
                    // 频控 / 服务端繁忙 → 退避重试
                    if ((json.code === 429 || json.code === 31023 || /频繁|限流|too many/i.test(String(msg))) && attempt < retry) {
                        await util.sleep(400 * Math.pow(2, attempt));
                        continue;
                    }
                    const bizErr = new ApiError(msg, json.code, name);
                    if (bizErr.kind === 'throttle') breaker.recordFail('throttle');
                    throw bizErr;
                } catch (e) {
                    lastErr = e;
                    if (e instanceof ApiError && e.code === 31001) throw e;
                    // 网络层异常（fetch 被拒/连接中断）单独归类并计入熔断
                    const isNetwork = !(e instanceof ApiError) && (e instanceof TypeError || /fetch|network|ERR_|abort/i.test(String(e && e.message)));
                    if (isNetwork) {
                        lastErr = new ApiError('网络异常：' + (e && e.message ? e.message : e), 'network', name);
                        breaker.recordFail('network');
                    } else if (e instanceof ApiError) {
                        breaker.recordFail(e.kind);
                        // 业务错误（参数/权限/同名等）与登录失效都是确定性失败，重试同样的请求
                        // 没有意义：既浪费配额，也会把熔断计数按重试次数放大
                        if (e.kind === 'business' || e.kind === 'auth') {
                            if (!silent) ui.toast('请求失败：' + e.message, 'error');
                            throw e;
                        }
                    }
                    if (attempt < retry) { await util.sleep(300 * (attempt + 1)); continue; }
                }
            }
            if (!silent) ui.toast('请求失败：' + (lastErr ? lastErr.message : '未知错误'), 'error');
            throw lastErr || new ApiError('请求失败', -3, name);
        },

        /* ---------- 文件列表 ---------- */
        async list(pdir = ROOT_FID, { page = 1, size = PAGE_SIZE, sort = 'file_type:asc,updated_at:desc', silent = false } = {}) {
            const r = await this.raw('list', { pdir_fid: pdir, page, size, sort }, { silent });
            const items = (r.data && r.data.list ? r.data.list : []).map(fileModel.normalize);
            const total = Number(r.metadata && (r.metadata._total || r.metadata._count)) || items.length;
            return { items, total, page };
        },

        /** 翻页取全量（夸克单页上限 200，超大目录会自动收敛） */
        async listAll(pdir = ROOT_FID, { max = 5000, sort = 'file_type:asc,updated_at:desc', onProgress = null } = {}) {
            const out = [];
            let page = 1;
            let total = Infinity;
            while (out.length < total && out.length < max) {
                const r = await this.list(pdir, { page, size: PAGE_SIZE, sort });
                total = r.total;
                if (!r.items.length) break;
                out.push(...r.items);
                if (onProgress) onProgress(out.length, total);
                if (r.items.length < PAGE_SIZE) break;
                page++;
            }
            return { items: out, total: Number.isFinite(total) ? total : out.length };
        },

        /** 全盘搜索（按文件名）：翻页取到 max 为止，按 fid 去重 */
        async searchAll(q, { max = 300, size = PAGE_SIZE, onProgress = null } = {}) {
            const kw = String(q || '').trim();
            if (!kw) return { items: [], total: 0 };
            const out = [];
            const seen = new Set();
            let page = 1;
            let total = Infinity;
            while (out.length < total && out.length < max) {
                const r = await this.raw('search', { q: kw, page, size });
                const list = (r.data && r.data.list) || [];
                total = Number(r.metadata && (r.metadata._total || r.metadata._count)) || list.length;
                if (!list.length) break;
                list.map(fileModel.normalize).forEach((it) => {
                    if (!it.fid || seen.has(it.fid)) return;
                    seen.add(it.fid);
                    out.push(it);
                });
                if (onProgress) onProgress(out.length, Math.min(total, max));
                if (list.length < size) break;
                page++;
            }
            return { items: out.slice(0, max), total: Number.isFinite(total) ? total : out.length };
        },

        /* ---------- 基础操作 ---------- */
        async mkdir(pdir, name) {
            const r = await this.raw('mkdir', { pdir_fid: pdir, file_name: util.sanitizeName(name) });
            return (r.data && r.data.fid) || null;
        },

        async rename(fid, name, { silent = false } = {}) {
            await this.raw('rename', { fid, file_name: util.sanitizeName(name) }, { silent });
            return true;
        },

        async move(fids, toPdir) {
            const list = [].concat(fids).filter(Boolean);
            if (!list.length) throw new ApiError('没有需要移动的项目', -1, 'move');
            await this.raw('move', { filelist: list, to_pdir_fid: toPdir });
            return true;
        },

        async remove(fids, { silent = false } = {}) {
            const list = [].concat(fids).filter(Boolean);
            if (!list.length) throw new ApiError('没有需要删除的项目', -1, 'remove');
            await this.raw('remove', { filelist: list }, { silent });
            return true;
        },

        /** 分片调用批量接口，规避单次上限 */
        async removeChunked(fids, chunk = 100, onProgress = null) {
            const list = [].concat(fids).filter(Boolean);
            let done = 0;
            for (let i = 0; i < list.length; i += chunk) {
                await this.remove(list.slice(i, i + chunk), { silent: true });
                done = Math.min(list.length, i + chunk);
                if (onProgress) onProgress(done, list.length);
            }
            return list.length;
        },

        /**
         * 分片删除但**不因某一片失败而丢弃前面已成功的部分**。
         * 返回 { ok: [fid], fails: [{ fid, error }] }，由调用方分别记账
         * （成功 → 撤销栈，失败 → 失败账本）。整片失败时按「片内全失败」处理：
         * 宁可少记可撤销项，也不虚报成功。
         */
        async removeChunkedSafe(fids, chunk = 100, onProgress = null) {
            const list = [].concat(fids).filter(Boolean);
            const ok = [];
            const fails = [];
            let done = 0;
            for (let i = 0; i < list.length; i += chunk) {
                const part = list.slice(i, i + chunk);
                try {
                    await this.remove(part, { silent: true });
                    ok.push(...part);
                } catch (e) {
                    part.forEach((fid) => fails.push({ fid, error: e.message }));
                }
                done = Math.min(list.length, i + chunk);
                if (onProgress) onProgress(done, list.length);
            }
            return { ok, fails };
        },

        async renameMany(pairs, onProgress = null) {
            let done = 0;
            const fails = [];
            for (const p of pairs) {
                try { await this.rename(p.fid, p.file_name, { silent: true }); } catch (e) { fails.push({ ...p, error: e.message }); }
                done++;
                if (onProgress) onProgress(done, pairs.length);
                await util.sleep(40);
            }
            return fails;
        },

        async downloadUrls(fids) {
            const list = [].concat(fids).filter(Boolean);
            if (!list.length) return [];
            const r = await this.raw('download', { fids: list });
            return (Array.isArray(r.data) ? r.data : []).map((x) => ({ fid: x.fid, url: x.download_url, md5: x.md5 || '' }));
        },

        async capacity() {
            const r = await this.raw('capacity', {});
            const d = r.data || {};
            return { total: Number(d.total_capacity || d.capacity || 0), used: Number(d.use_capacity || d.used || 0), vip: d.member_type || '' };
        },

        /** 回收站条目（用于把刚删除的项目映射为可还原的回收站 fid） */
        async recycleList(size = 200) {
            const r = await this.raw('recycleList', { page: 1, size }, { retry: 0, silent: true });
            return ((r.data && r.data.list) || []).map((x) => ({
                fid: String(x.fid || ''),
                name: x.file_name || x.name || '',
                size: Number(x.size || 0),
                dir: !!(x.dir || x.file_type === 0),
                time: x.updated_at || x.deleted_at || x.created_at || 0,
            }));
        },

        /* ---------- 任务轮询（分享/转存都是异步任务） ---------- */
        async waitTask(taskId, { timeout = 60000, interval = 900 } = {}) {
            const start = Date.now();
            let idx = 0;
            for (;;) {
                const r = await this.raw('task', { task_id: taskId, retry_index: idx++ }, { silent: true });
                const d = r.data || {};
                if (Number(d.status) === 2) return d;
                if (Number(d.status) === 3) throw new ApiError(d.message || '任务执行失败', -1, 'task');
                if (Date.now() - start > timeout) throw new ApiError('任务超时未完成', -1, 'task');
                await util.sleep(interval);
            }
        },
    };

    /* ======================================================================
     * 6. 文件模型与树扫描
     * ==================================================================== */

    const fileModel = {
        /** 把夸克返回的原始 entry 归一化成统一结构 */
        normalize(raw) {
            const it = raw || {};
            const dir = !!(it.dir || it.file_type === 0);
            const name = it.file_name || it.filename || '';
            return {
                fid: String(it.fid || ''),
                name,
                pdir_fid: String(it.pdir_fid || ROOT_FID),
                size: Number(it.size || 0),
                dir,
                category: dir ? 'folder' : (it.obj_category ? objCat(it.obj_category) : util.categoryOf({ dir, file_name: name })),
                obj_category: it.obj_category || '',
                ext: util.ext(name),
                created_at: Number(it.created_at || it.l_created_at || 0),
                updated_at: Number(it.updated_at || it.l_updated_at || 0),
                md5: it.md5 || '',
                sha1: it.sha1 || '',
                include_items: Number(it.include_items || 0),
                thumbnail: it.thumbnail || it.big_thumbnail || '',
                share_fid_token: it.share_fid_token || it.fid_token || '',
                status: Number(it.status || 0),
                source: it.source || '',
                raw: it,
            };
        },

        /** 排序：返回新数组 */
        sort(items, key, order = 'asc') {
            const dir = order === 'desc' ? -1 : 1;
            const arr = Array.from(items || []);
            const folderFirst = config.get('folderFirst', true);
            const cmp = (a, b) => {
                if (folderFirst && a.dir !== b.dir) return a.dir ? -1 : 1;
                let r = 0;
                switch (key) {
                    case 'size': r = a.size - b.size; break;
                    case 'created_at': r = a.created_at - b.created_at; break;
                    case 'category': r = util.naturalCompare(a.category, b.category); break;
                    case 'ext': r = util.naturalCompare(a.ext, b.ext); break;
                    case 'updated_at':
                    default: r = a.updated_at - b.updated_at; break;
                    case 'name': r = util.naturalCompare(a.name, b.name); break;
                }
                if (r === 0) r = util.naturalCompare(a.name, b.name);
                return r * dir;
            };
            return arr.sort(cmp);
        },
    };

    function objCat(objCategory) {
        const s = String(objCategory);
        if (/视频|video/i.test(s)) return 'video';
        if (/音频|音乐|audio/i.test(s)) return 'audio';
        if (/图片|image|photo/i.test(s)) return 'image';
        if (/文档|doc|word|excel|pdf|ppt/i.test(s)) return 'doc';
        if (/压缩|zip|rar/i.test(s)) return 'zip';
        if (/应用|apk|app/i.test(s)) return 'app';
        return 'other';
    }

    const scanner = {
        /** 递归扫描子树：返回 [{...item, path, depth, parentPath}] */
        async walk(rootFid = ROOT_FID, { rootPath = '', maxDepth = 20, excludeRe = null, onProgress = null, useCache = false } = {}) {
            const out = [];
            let visited = 0;
            const seen = new Set([String(rootFid)]);   // 防环：异常数据下同一目录不会被展开两次
            const stack = [{ fid: rootFid, path: rootPath, depth: 0 }];
            while (stack.length) {
                const node = stack.pop();
                if (node.depth > maxDepth) continue;
                let items = null;
                const cached = useCache ? indexCache.read(node.fid) : null;
                if (cached) items = cached.items;
                else {
                    const r = await api.listAll(node.fid, { max: 5000 });
                    items = r.items;
                    indexCache.write(node.fid, items);
                }
                visited += items.length;
                if (onProgress) onProgress(visited, node.path || '根目录');
                for (const it of items) {
                    if (excludeRe && excludeRe.test(it.name)) continue;
                    const child = { ...it, path: node.path ? node.path + '/' + it.name : it.name, depth: node.depth };
                    out.push(child);
                    if (it.dir && !seen.has(it.fid)) {
                        seen.add(it.fid);
                        stack.push({ fid: it.fid, path: child.path, depth: node.depth + 1 });
                    }
                }
            }
            return out;
        },

        /** 汇总统计 */
        summarize(items) {
            const s = { count: items.length, files: 0, folders: 0, size: 0, byCategory: {}, byExt: {} };
            items.forEach((it) => {
                if (it.dir) s.folders++; else { s.files++; s.size += it.size; }
                s.byCategory[it.category] = (s.byCategory[it.category] || 0) + 1;
                if (!it.dir) {
                    const e = it.ext || '(无)';
                    s.byExt[e] = s.byExt[e] || { count: 0, size: 0 };
                    s.byExt[e].count++;
                    s.byExt[e].size += it.size;
                }
            });
            return s;
        },
    };

    /* ======================================================================
     * 6.5 操作历史与撤销
     *     上游（PikPak 增强大师）累计 772 次提交都没有提供批量操作撤销，
     *     这是唯一会造成用户数据损失的一类缺口，故本版作为一等公民实现。
     * ==================================================================== */

    const OP_KEY = 'qem_ophistory_v1';

    const opLog = {
        /** 支持撤销的操作类型 → 中文名 */
        TYPES: {
            rename: '批量重命名',
            move: '批量移动',
            delete: '批量删除',
            save: '分享转存',
            mkdir: '新建文件夹',
        },

        list() {
            try {
                const raw = localStorage.getItem(OP_KEY);
                const arr = raw ? JSON.parse(raw) : [];
                return Array.isArray(arr) ? arr : [];
            } catch (e) { return []; }
        },

        persist(arr) {
            const max = Math.max(1, Number(config.get('undo.max', 20)) || 20);
            const trimmed = arr.slice(0, max);
            try { localStorage.setItem(OP_KEY, JSON.stringify(trimmed)); } catch (e) { /* 配额满则丢弃历史 */ }
            return trimmed;
        },

        /**
         * 记录一次操作
         * @param {{type:string,label?:string,entries:Array,undoable?:boolean,note?:string,createdFids?:string[]}} op
         */
        push(op) {
            const entries = (op.entries || []).map((e) => ({
                fid: e.fid, name: e.name || '',
                size: e.size,
                before: e.before, after: e.after,
                pdir: e.pdir, toPdir: e.toPdir,
                recycleFid: e.recycleFid,
            }));
            const rec = {
                id: util.uuid(),
                type: op.type,
                label: op.label || this.TYPES[op.type] || op.type,
                at: Date.now(),
                count: entries.length,
                entries,
                createdFids: op.createdFids || [],
                undoable: op.undoable !== false && entries.length > 0,
                undone: false,
                note: op.note || '',
            };
            const arr = this.list();
            arr.unshift(rec);
            this.persist(arr);
            return rec;
        },

        /** 最近一条可撤销记录 */
        latestUndoable() {
            return this.list().find((r) => r.undoable && !r.undone) || null;
        },

        markUndone(id) {
            const arr = this.list();
            const r = arr.find((x) => x.id === id);
            if (r) { r.undone = true; r.undoneAt = Date.now(); this.persist(arr); }
        },

        remove(id) {
            this.persist(this.list().filter((r) => r.id !== id));
        },

        clear() {
            try { localStorage.removeItem(OP_KEY); } catch (e) { /* 忽略 */ }
        },

        /**
         * 删除操作后，把刚删除的条目映射为回收站里的 fid。
         * 夸克回收站条目 fid 与源文件 fid 不一定相同，按名称+大小匹配。
         */
        async resolveRecycleFids(entries) {
            const list = await api.recycleList(200);
            const used = new Set();
            const pairs = [];
            entries.forEach((e) => {
                const hit = list.find((r) => !used.has(r.fid) && r.name === e.name && (!e.size || !r.size || r.size === e.size));
                if (hit) { used.add(hit.fid); pairs.push({ fid: e.fid, recycleFid: hit.fid, name: e.name }); }
            });
            return pairs;
        },

        /** 撤销指定记录（默认最近一条） */
        async undo(id = null) {
            const arr = this.list();
            const rec = id ? arr.find((r) => r.id === id) : this.latestUndoable();
            if (!rec) { ui.toast('没有可撤销的操作', 'warn'); return false; }
            if (rec.undone) { ui.toast('该操作已撤销过', 'warn'); return false; }
            if (!rec.undoable) { ui.toast('该操作不支持撤销' + (rec.note ? '：' + rec.note : ''), 'warn', 4000); return false; }

            const ok = await ui.confirm(
                `撤销「${rec.label}」？\n时间：${util.ts(rec.at)}\n涉及 ${rec.count} 个项目\n\n撤销会直接把网盘恢复到操作前的状态。`,
                { okText: '撤销', danger: true },
            );
            if (!ok) return false;

            const pr = ui.progress('正在撤销');
            try {
                let fails = [];
                if (rec.type === 'rename') {
                    fails = await api.renameMany(
                        rec.entries.filter((e) => e.before).map((e) => ({ fid: e.fid, file_name: e.before })),
                        (d, tt) => pr.set(d / tt, `已恢复 ${d} / ${tt}`),
                    );
                } else if (rec.type === 'move') {
                    // 按原父目录分组回移
                    const groups = new Map();
                    rec.entries.forEach((e) => {
                        if (!e.pdir) return;
                        if (!groups.has(e.pdir)) groups.set(e.pdir, []);
                        groups.get(e.pdir).push(e.fid);
                    });
                    let done = 0;
                    const total = rec.entries.length;
                    for (const [pdir, fids] of groups) {
                        try { await api.move(fids, pdir); } catch (err) { fails.push({ fid: fids.join(','), error: err.message }); }
                        done += fids.length;
                        pr.set(done / total, `已回移 ${done} / ${total}`);
                    }
                } else if (rec.type === 'delete') {
                    const pairs = (rec.entries || []).filter((e) => e.recycleFid);
                    if (!pairs.length) throw new Error('未记录到回收站条目，无法自动还原，请到「回收站」手动还原');
                    let done = 0;
                    for (let i = 0; i < pairs.length; i += 100) {
                        const chunk = pairs.slice(i, i + 100);
                        await api.raw('recycleRestore', { filelist: chunk.map((x) => x.recycleFid) });
                        done += chunk.length;
                        pr.set(done / pairs.length, `已还原 ${done} / ${pairs.length}`);
                    }
                } else if (rec.type === 'save') {
                    const fids = (rec.createdFids || []).filter(Boolean);
                    if (!fids.length) throw new Error('未记录到转存生成的文件，无法自动撤销，请手动删除');
                    await api.removeChunked(fids, 100, (d, tt) => pr.set(d / tt, `已删除 ${d} / ${tt}`));
                } else {
                    throw new Error('该操作类型不支持撤销');
                }

                pr.close();
                this.markUndone(rec.id);
                if (fails.length) {
                    failLog.push({
                        action: 'manual',
                        retryable: false,
                        label: `撤销「${rec.label}」`,
                        items: fails.map((f) => ({
                            fid: String(f.fid || '').split(',')[0],
                            name: f.file_name || '',
                            error: f.error || '未知错误',
                        })),
                        note: '撤销过程中的失败需手动处理（文件可能已被其他操作改动）',
                    });
                    ui.toast(`撤销完成，但 ${fails.length} 项失败（可能已被其他操作改动，详见失败记录）`, 'warn', 6000);
                } else {
                    ui.toast(`已撤销「${rec.label}」`);
                }
                if (state.ui) await workspace.reload();
                return true;
            } catch (e) {
                pr.close();
                ui.toast('撤销失败：' + e.message, 'error', 6000);
                this.persist(this.list().map((r) => (r.id === rec.id ? { ...r, note: '上次撤销失败：' + e.message } : r)));
                return false;
            }
        },

        /** 历史面板（兼作操作审计日志） */
        open() {
            const p = ui.panel({
                title: '操作历史 / 撤销',
                size: 'md',
                buttons: [
                    { label: '导出日志', onClick: () => {
                        const arr = this.list();
                        if (!arr.length) return ui.toast('暂无记录', 'warn');
                        const lines = ['时间\t类型\t条目数\t状态\t明细'];
                        arr.forEach((r) => lines.push(`${util.ts(r.at)}\t${r.label}\t${r.count}\t${r.undone ? '已撤销' : (r.undoable ? '可撤销' : '不可撤销')}\t${r.note || (r.entries.slice(0, 3).map((e) => e.name || e.fid).join(' / '))}`));
                        util.saveTextFile(`qem_操作日志_${Date.now()}.txt`, lines.join('\n'));
                    } },
                    { label: '清空历史', danger: true, onClick: async (a) => {
                        const ok = await ui.confirm('清空全部操作历史？清空后无法再撤销这些操作。', { danger: true, okText: '清空' });
                        if (!ok) return;
                        opLog.clear(); ui.toast('已清空'); a.close(); opLog.open();
                    } },
                    { label: t('close'), onClick: (a) => a.close() },
                ],
            });
            const arr = this.list();
            if (!arr.length) {
                p.body.innerHTML = '<div class="qem-empty">暂无操作记录</div>';
                return;
            }
            const tb = ui.table([
                { key: 'at', label: '时间', render: (v) => util.escapeHtml(util.ts(v)) },
                { key: 'label', label: '操作' },
                { key: 'count', label: '条目', align: 'right' },
                { key: 'status', label: '状态', render: (v, row) => row.undone
                    ? '<span class="qem-tag">已撤销</span>'
                    : (row.undoable ? '<span class="qem-tag ok">可撤销</span>' : `<span class="qem-tag warn">不可撤销</span>`) },
                { key: 'name', label: '涉及内容', render: (v, row) => util.escapeHtml(row.entries.slice(0, 3).map((e) => e.name || e.fid).join('、') || row.note || '-') },
                { key: 'act', label: '操作', render: (v, row) => {
                    const box = document.createElement('div');
                    box.className = 'row';
                    const b = document.createElement('button');
                    b.textContent = '撤销';
                    b.disabled = !row.undoable || row.undone;
                    b.addEventListener('click', async () => {
                        const done = await opLog.undo(row.id);
                        if (done) { p.close(); opLog.open(); }
                    });
                    const detail = document.createElement('button');
                    detail.textContent = '明细';
                    detail.addEventListener('click', () => {
                        const dp = ui.panel({ title: row.label + ' 明细', size: 'md', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
                        dp.body.appendChild(ui.table([
                            { key: 'name', label: '名称', render: (v, r2) => util.escapeHtml(v || r2.fid) },
                            { key: 'before', label: '操作前', render: (v, r2) => util.escapeHtml(v || r2.pdir || '-') },
                            { key: 'after', label: '操作后', render: (v, r2) => util.escapeHtml(v || r2.toPdir || '-') },
                        ], row.entries, { maxHeight: '56vh' }).el);
                    });
                    box.append(b, detail);
                    return box;
                } },
            ], arr.map((r) => ({ ...r, count: r.count, name: '' })), { maxHeight: '60vh' });
            p.body.appendChild(tb.el);
            const tip = document.createElement('div');
            tip.className = 'muted';
            tip.style.marginTop = '8px';
            tip.textContent = `共 ${arr.length} 条记录，保留最近 ${config.get('undo.max', 20)} 条。删除类操作依赖回收站还原，若回收站已清空则无法撤销。`;
            p.body.appendChild(tip);
        },
    };

    /* ======================================================================
     * 6.6 同名冲突策略
     *     README 与 FAQ 都未定义「目标目录已有同名文件」时的语义，
     *     这是批量操作里最容易造成误覆盖的场景，故显式化。
     * ==================================================================== */

    const conflict = {
        POLICIES: [
            { value: 'ask', label: '每次询问' },
            { value: 'skip', label: '跳过同名项' },
            { value: 'rename', label: '自动重命名（加序号）' },
            { value: 'overwrite', label: '覆盖（删除目标同名项）' },
        ],

        /** 在目标目录中查重名 */
        async check(targetPdir, items) {
            const names = items.filter((i) => !i.dir).map((i) => i.name.toLowerCase());
            const dirNames = items.filter((i) => i.dir).map((i) => i.name.toLowerCase());
            if (!names.length && !dirNames.length) return { hits: [], targetItems: [] };
            let targetItems = [];
            try { targetItems = (await api.listAll(targetPdir, { max: 4000 })).items; }
            catch (e) { return { hits: [], targetItems: [], error: e.message }; }
            const want = new Set(names.concat(dirNames));
            const hits = targetItems.filter((t) => want.has(t.name.toLowerCase()));
            return { hits, targetItems };
        },

        /** 生成不冲突的新名称：name_1.ext / name_2.ext … */
        nextName(name, takenSet) {
            const ext = util.ext(name);
            const base = ext ? util.baseName(name) : name;
            let i = 1;
            let candidate = name;
            while (takenSet.has(candidate.toLowerCase())) {
                candidate = `${base}_${i}${ext ? '.' + ext : ''}`;
                i++;
                if (i > 9999) break;
            }
            return candidate;
        },

        /**
         * 处理与目标目录的同名冲突
         * @returns {{action:'proceed'|'abort', toMove:Array<{fid,item}>, needRename:Array<{fid,file_name}>, skipped:Array}}
         */
        async resolve(targetPdir, items, { policy = null, label = '移动' } = {}) {
            const p = policy || config.get('conflict.policy', 'ask');
            const { hits } = await this.check(targetPdir, items);
            if (!hits.length) return { action: 'proceed', toMove: items.map((i) => ({ fid: i.fid, item: i })), needRename: [], skipped: [] };

            const hitNames = new Set(hits.map((h) => h.name.toLowerCase()));
            const conflictItems = items.filter((i) => hitNames.has(i.name.toLowerCase()));
            const cleanItems = items.filter((i) => !hitNames.has(i.name.toLowerCase()));

            let mode = p;
            if (mode === 'ask') {
                const sel = await conflict.askPolicy(conflictItems, hits, label);
                if (!sel) return { action: 'abort', toMove: [], needRename: [], skipped: [] };
                mode = sel;
            }

            if (mode === 'skip') {
                return { action: 'proceed', toMove: cleanItems.map((i) => ({ fid: i.fid, item: i })), needRename: [], skipped: conflictItems };
            }

            if (mode === 'overwrite') {
                const ok = await ui.confirm(
                    `覆盖模式：将先把目标目录中的 ${hits.length} 个同名项目移入回收站，再${label}。\n\n被移入回收站的项目可手动还原，但不会自动恢复。是否继续？`,
                    { danger: true, okText: '覆盖' },
                );
                if (!ok) return { action: 'abort', toMove: [], needRename: [], skipped: [] };
                try { await api.removeChunked(hits.map((h) => h.fid), 100); }
                catch (e) {
                    failLog.push({
                        action: 'delete',
                        label: `覆盖前删除同名项（${label}）`,
                        items: hits.map((h) => ({ fid: h.fid, name: h.name, error: e.message })),
                        note: '整批未执行，目标目录保持不变',
                    });
                    ui.toast('删除同名项失败，已中止：' + e.message, 'error', 5000);
                    return { action: 'abort', toMove: [], needRename: [], skipped: [] };
                }
                return { action: 'proceed', toMove: items.map((i) => ({ fid: i.fid, item: i })), needRename: [], skipped: [] };
            }

            // rename
            const taken = new Set(hits.map((h) => h.name.toLowerCase()));
            cleanItems.forEach((i) => taken.add(i.name.toLowerCase()));
            const needRename = conflictItems.map((i) => {
                const nn = conflict.nextName(i.name, taken);
                taken.add(nn.toLowerCase());
                return { fid: i.fid, file_name: nn, old: i.name };
            });
            return { action: 'proceed', toMove: cleanItems.map((i) => ({ fid: i.fid, item: i })), needRename, skipped: [] };
        },

        askPolicy(conflictItems, hits, label) {
            return new Promise((resolve) => {
                const done = ui.once(resolve);
                const form = ui.form([
                    { key: 'remember', label: '记住我的选择', type: 'checkbox', value: false, hint: '勾选后写入设置，后续不再询问' },
                ]);
                const pick = (mode) => { if (form.values.remember) config.set('conflict.policy', mode); return mode; };
                const p = ui.panel({
                    title: '目标目录存在同名项目', size: 'sm', closeOnMask: false,
                    buttons: [
                        { label: '取消操作', onClick: (a) => { done(null); a.close(); } },
                        { label: '跳过命中项', onClick: (a) => { done(pick('skip')); a.close(); } },
                        { label: '自动重命名', onClick: (a) => { done(pick('rename')); a.close(); } },
                        { label: '覆盖', danger: true, onClick: (a) => { done(pick('overwrite')); a.close(); } },
                    ],
                    onClose: () => done(null),
                });
                const box = document.createElement('div');
                box.className = 'col';
                const head = document.createElement('div');
                head.textContent = `本次${label}的 ${conflictItems.length} 个项目，在目标目录中已存在同名项（共命中 ${hits.length} 项）：`;
                const ul = document.createElement('div');
                ul.className = 'drop';
                ul.style.maxHeight = '180px';
                ul.style.overflow = 'auto';
                ul.style.whiteSpace = 'pre-wrap';
                ul.textContent = conflictItems.slice(0, 30).map((i) => i.name).join('\n') + (conflictItems.length > 30 ? `\n… 另有 ${conflictItems.length - 30} 项` : '');
                const note = document.createElement('div');
                note.className = 'muted';
                note.textContent = '「覆盖」会先把目标目录中的同名项移入回收站（不自动还原）；「自动重命名」会给新项目加 _1/_2 序号。';
                box.append(head, ul, form.el, note);
                p.body.appendChild(box);
            });
        },
    };

    /* ======================================================================
     * 6.7 容量预检
     *     上游 FAQ 印证：官方对空间不足采用「静默拦截」，粘贴后文件不出现，
     *     用户会误判为脚本故障。本模块在消耗空间的操作前先做明确提示。
     * ==================================================================== */

    const capacityGuard = {
        cache: { at: 0, data: null },
        TTL: 60000,

        async get(force = false) {
            if (!force && this.cache.data && Date.now() - this.cache.at < this.TTL) return this.cache.data;
            const d = await api.capacity();
            this.cache = { at: Date.now(), data: d };
            return d;
        },

        invalidate() { this.cache = { at: 0, data: null }; },

        async remain() {
            try {
                const c = await this.get();
                return Math.max(0, c.total - c.used);
            } catch (e) { return null; }
        },

        /**
         * 校验可用空间是否满足需求
         * @returns {Promise<boolean>} 是否继续
         */
        async ensure(bytes, label = '本次操作') {
            if (!bytes || bytes <= 0) return true;
            let c = null;
            try { c = await this.get(true); } catch (e) { return true; }   // 取不到容量就不阻塞操作
            if (!c || !c.total) return true;
            const remain = Math.max(0, c.total - c.used);
            if (bytes <= remain) return true;
            const ok = await ui.confirm(
                `可用空间可能不足：\n\n${label}预计需要 ${util.humanSize(bytes)}\n当前剩余 ${util.humanSize(remain)}（已用 ${(c.used / c.total * 100).toFixed(1)}%）\n\n` +
                '夸克在空间不足时通常不会明确报错，而是直接中止且不提示，容易造成「文件没出现」的困惑。\n\n仍要继续吗？',
                { danger: true, okText: '仍要继续' },
            );
            return ok;
        },

        /** 用量概览（工作台底部 / 设置页用） */
        async summary() {
            try {
                const c = await this.get();
                const pct = c.total ? c.used / c.total : 0;
                return { ...c, remain: Math.max(0, c.total - c.used), pct };
            } catch (e) { return null; }
        },
    };

    /* ======================================================================
     * 6.8 目录快照与差异对比
     *     撤销只能回滚「本脚本发起的操作」，管不了外部误删、客户端改动、
     *     或官方静默覆盖。快照 diff 用来事后发现这些问题。
     * ==================================================================== */

    const snapKey = 'qem_snapshots_v1';

    const snapshot = {
        MAX: 10,
        LIMIT_ITEMS: 20000,
        LIMIT_BYTES: 2 * 1024 * 1024,

        list() {
            try {
                const raw = localStorage.getItem(snapKey);
                const arr = raw ? JSON.parse(raw) : [];
                return Array.isArray(arr) ? arr : [];
            } catch (e) { return []; }
        },

        persist(arr) {
            const trimmed = arr.slice(0, this.MAX);
            try {
                localStorage.setItem(snapKey, JSON.stringify(trimmed));
                return true;
            } catch (e) {
                ui.toast('快照保存失败：本地存储空间不足，请先删除旧快照', 'error', 5000);
                return false;
            }
        },

        remove(id) { this.persist(this.list().filter((s) => s.id !== id)); },
        clear() { try { localStorage.removeItem(snapKey); } catch (e) { /* 忽略 */ } },
        get(id) { return this.list().find((s) => s.id === id) || null; },

        /** 压缩存储：数组比对象省约一半空间 */
        pack(items) {
            return items.map((i) => [i.path || i.name, i.size || 0, i.updated_at || 0, i.dir ? 1 : 0, i.fid || '']);
        },

        unpack(rows) {
            return (rows || []).map((r) => ({
                path: r[0],
                name: String(r[0]).split('/').pop(),
                size: r[1] || 0,
                updated_at: r[2] || 0,
                dir: !!r[3],
                fid: r[4] || '',
            }));
        },

        estimateBytes(items) {
            try { return JSON.stringify(this.pack(items)).length; } catch (e) { return 0; }
        },

        /**
         * 采集快照
         * @param {{label:string, scope:'current'|'deep'}} opts
         */
        async capture({ label, scope = 'deep' } = {}) {
            const prefix = state.path.map((s) => s.name).join('/');
            let items;
            const pr = ui.progress('采集快照');
            try {
                if (scope === 'deep') {
                    items = await scanner.walk(state.cwd, {
                        rootPath: prefix,
                        maxDepth: config.get('scan.maxDepth', 20),
                        onProgress: (n, p2) => pr.set(0.5, `已采集 ${n} 项 · ${p2}`),
                    });
                } else {
                    items = state.items.map((i) => ({ ...i, path: `${prefix}/${i.name}` }));
                }
            } finally { pr.close(); }

            if (items.length > this.LIMIT_ITEMS) {
                ui.toast(`项目过多（${items.length}），已截断至 ${this.LIMIT_ITEMS} 项`, 'warn', 5000);
                items = items.slice(0, this.LIMIT_ITEMS);
            }
            const bytes = this.estimateBytes(items);
            if (bytes > this.LIMIT_BYTES) {
                ui.toast(`快照体积过大（${util.humanSize(bytes)}），已取消保存。建议改用「仅当前目录」范围`, 'error', 6000);
                return null;
            }

            const sum = scanner.summarize(items);
            const rec = {
                v: 1,
                id: util.uuid(),
                label: label || `${prefix} ${util.ts(Date.now())}`,
                at: Date.now(),
                root: { fid: state.cwd, name: prefix },
                deep: scope === 'deep',
                count: items.length,
                size: sum.size,
                items: this.pack(items),
            };
            const arr = this.list();
            arr.unshift(rec);
            if (!this.persist(arr)) return null;
            return rec;
        },

        /** 两份快照做差异对比 */
        compare(snapOld, snapNew) {
            const A = new Map(this.unpack(snapOld.items).map((i) => [i.path, i]));
            const B = new Map(this.unpack(snapNew.items).map((i) => [i.path, i]));
            const added = [];
            const removed = [];
            const changed = [];

            B.forEach((v, k) => { if (!A.has(k)) added.push(v); });
            A.forEach((v, k) => {
                if (!B.has(k)) { removed.push(v); return; }
                const w = B.get(k);
                if (v.dir || w.dir) return;
                const sizeDiff = v.size !== w.size;
                const timeDiff = !!v.updated_at && !!w.updated_at && v.updated_at !== w.updated_at;
                if (sizeDiff || timeDiff) {
                    changed.push({
                        path: w.path, name: w.name,
                        oldSize: v.size, newSize: w.size,
                        oldTime: v.updated_at, newTime: w.updated_at,
                        sizeDiff, timeDiff,
                    });
                }
            });

            // 移动识别：同名称同体积、仅在路径间平移
            const moved = [];
            const addPool = added.slice();
            for (let i = removed.length - 1; i >= 0; i--) {
                const r = removed[i];
                if (r.dir) continue;
                const j = addPool.findIndex((a) => !a.dir && a.name === r.name && a.size === r.size);
                if (j >= 0) {
                    moved.push({ name: r.name, from: r.path, to: addPool[j].path, size: r.size });
                    addPool.splice(j, 1);
                    removed.splice(i, 1);
                }
            }

            const addedSize = addPool.reduce((s, x) => s + (x.dir ? 0 : x.size), 0);
            const removedSize = removed.reduce((s, x) => s + (x.dir ? 0 : x.size), 0);
            let changedDelta = 0;
            changed.forEach((c) => { changedDelta += (c.newSize - c.oldSize); });

            return {
                added: addPool, removed, changed, moved,
                stats: {
                    addedSize, removedSize, changedDelta,
                    total: addPool.length + removed.length + changed.length + moved.length,
                },
                sameRoot: snapOld.root.fid === snapNew.root.fid,
            };
        },

        /** 与「当前目录实时状态」对比：临时采集一份，不写入快照库 */
        async compareWithCurrent(oldSnap, onDone) {
            if (oldSnap.root.fid !== state.cwd) {
                const go = await ui.confirm(
                    `该快照采集自「${oldSnap.root.name}」，与当前目录不一致。\n\n请先在工作台进入对应目录再对比。是否仍要继续（结果可能无意义）？`,
                    { okText: '仍要继续' },
                );
                if (!go) return;
            }
            const now = await this.capture({ label: `当前状态 ${util.ts(Date.now())}`, scope: oldSnap.deep ? 'deep' : 'current' });
            if (!now) return;
            // 临时快照仅用于本次对比，不留在快照库里
            this.persist(this.list().filter((x) => x.id !== now.id));
            if (onDone) onDone();
            this.showDiff(oldSnap, now, this.compare(oldSnap, now));
        },

        /** 快照管理面板 */
        open() {
            const p = ui.panel({
                title: '目录快照与差异对比',
                size: 'lg',
                buttons: [
                    { label: '新建快照', primary: true, onClick: () => this.createFlow(() => { p.close(); this.open(); }) },
                    { label: t('close'), onClick: (a) => a.close() },
                ],
            });
            const info = document.createElement('div');
            info.className = 'muted';
            const box = document.createElement('div');
            box.style.marginTop = '10px';
            p.body.append(info, box);

            const arr = this.list();
            if (!arr.length) {
                info.textContent = '还没有快照。快照用于事后比对目录变化（发现误删、被替换、被移动的文件）。';
                box.innerHTML = '<div class="qem-empty">点击「新建快照」开始，建议先对重要目录建一份基线</div>';
                return;
            }
            info.innerHTML = `共 <b>${arr.length}</b> 份快照（最多保留 ${this.MAX} 份）。勾选两份可做差异对比，或勾选一份与当前目录实时状态对比。`;

            const rows = arr.map((s) => ({
                ...s,
                timeText: util.ts(s.at),
                sizeText: util.humanSize(s.size),
                scopeText: s.deep ? '递归' : '仅当前层',
            }));

            // 记住当前勾选，供底部「对比所选两份」使用
            let picked = [];
            const tb = ui.table([
                { key: 'label', label: '标签', render: (v, r) => `${util.escapeHtml(v)}<div class="muted">${util.escapeHtml(r.root.name)} · ${r.scopeText}</div>` },
                { key: 'count', label: '项目数', align: 'right' },
                { key: 'sizeText', label: '合计体积', align: 'right' },
                { key: 'timeText', label: '采集时间' },
                { key: 'act', label: '操作', render: (v, r) => {
                    const box2 = document.createElement('div');
                    box2.className = 'row';
                    const cmp = document.createElement('button');
                    cmp.textContent = '与当前对比';
                    cmp.addEventListener('click', () => snapshot.compareWithCurrent(r, () => { p.close(); }));
                    const del = document.createElement('button');
                    del.className = 'danger';
                    del.textContent = '删除';
                    del.addEventListener('click', async () => {
                        const ok = await ui.confirm(`删除快照「${r.label}」？`, { danger: true, okText: '删除' });
                        if (!ok) return;
                        snapshot.remove(r.id);
                        p.close(); snapshot.open();
                    });
                    box2.append(cmp, del);
                    return box2;
                } },
            ], rows, {
                maxHeight: '50vh', selectable: true,
                onSelectionChange: (sel2) => { picked = sel2; },
            });
            box.appendChild(tb.el);

            const acts = document.createElement('div');
            acts.className = 'row';
            acts.style.marginTop = '10px';
            acts.style.flexWrap = 'wrap';
            const cmpBtn = document.createElement('button');
            cmpBtn.className = 'primary';
            cmpBtn.textContent = '对比所选两份快照';
            cmpBtn.addEventListener('click', () => {
                if (picked.length !== 2) return ui.toast('请勾选恰好两份快照', 'warn');
                const [a, b] = picked.slice().sort((x, y) => x.at - y.at);
                const diff = this.compare(a, b);
                p.close();
                this.showDiff(a, b, diff);
            });
            const clearBtn = document.createElement('button');
            clearBtn.className = 'danger';
            clearBtn.textContent = '清空全部快照';
            clearBtn.addEventListener('click', async () => {
                const ok = await ui.confirm(`清空全部 ${arr.length} 份快照？`, { danger: true, okText: '清空' });
                if (!ok) return;
                this.clear(); p.close(); this.open();
            });
            acts.append(cmpBtn, clearBtn);
            box.appendChild(acts);
        },

        createFlow(onDone) {
            const p = ui.panel({
                title: '新建快照', size: 'sm', closeOnMask: false,
                buttons: [
                    { label: t('cancel'), onClick: (a) => a.close() },
                    {
                        label: '开始采集', primary: true,
                        onClick: async (a) => {
                            const v = form.values;
                            a.close();
                            const rec = await snapshot.capture({ label: v.label || '', scope: v.scope });
                            if (rec) {
                                ui.toast(`快照已保存：${rec.count} 项，${util.humanSize(rec.size)}`);
                                if (onDone) onDone();
                            }
                        },
                    },
                ],
            });
            const form = ui.form([
                { key: 'label', label: '标签', value: `${state.path[state.path.length - 1].name} ${util.ts(Date.now())}`, hint: '便于日后辨认' },
                { key: 'scope', label: '范围', type: 'select', value: 'deep', options: [
                    { value: 'deep', label: '当前目录及子目录（推荐，可发现全树变化）' },
                    { value: 'current', label: '仅当前目录' },
                ] },
            ]);
            const note = document.createElement('div');
            note.className = 'muted';
            note.style.marginTop = '8px';
            note.textContent = `快照保存在本地浏览器，最多保留 ${this.MAX} 份。递归采集会遍历整棵子树，目录很大时耗时较久。`;
            p.body.append(form.el, note);
        },

        /** 差异结果面板；opts 可覆盖标题、四类标签（跨账号口径）与结论文案 */
        showDiff(oldSnap, newSnap, diff, opts = {}) {
            const p = ui.panel({
                title: opts.title || '目录差异对比',
                size: 'lg',
                buttons: [{ label: t('close'), onClick: (a) => a.close() }],
            });
            const head = document.createElement('div');
            head.className = 'col';
            const warn = diff.sameRoot ? '' : '<div class="qem-tag warn">两份快照来自不同目录，对比结果仅供参考</div>';
            head.innerHTML = `
<div class="row" style="flex-wrap:wrap;gap:14px">
  <div>基准：<b>${util.escapeHtml(oldSnap.label)}</b> <span class="muted">${util.ts(oldSnap.at)}</span></div>
  <div>对比：<b>${util.escapeHtml(newSnap.label)}</b> <span class="muted">${util.ts(newSnap.at)}</span></div>
</div>
${warn}
<div class="row" style="flex-wrap:wrap;gap:10px;margin-top:6px">
  <span class="qem-tag ok">新增 ${diff.added.length}</span>
  <span class="qem-tag err">缺失 ${diff.removed.length}</span>
  <span class="qem-tag warn">内容变化 ${diff.changed.length}</span>
  <span class="qem-tag">位置变化 ${diff.moved.length}</span>
</div>
<div class="muted">体积：新增 ${util.humanSize(diff.stats.addedSize)}　缺失 ${util.humanSize(diff.stats.removedSize)}　变化 ${diff.stats.changedDelta >= 0 ? '+' : ''}${util.humanSize(Math.abs(diff.stats.changedDelta))}</div>
`;
            p.body.appendChild(head);

            const tabs = document.createElement('div');
            tabs.className = 'qem-tabs';
            tabs.style.margin = '10px 0';
            const body = document.createElement('div');
            p.body.append(tabs, body);

            const VIEWS = [
                { key: 'removed', label: `缺失 (${diff.removed.length})` },
                { key: 'added', label: `新增 (${diff.added.length})` },
                { key: 'changed', label: `内容变化 (${diff.changed.length})` },
                { key: 'moved', label: `位置变化 (${diff.moved.length})` },
            ];
            if (opts.labels) {
                VIEWS.forEach((v) => { if (opts.labels[v.key]) v.label = opts.labels[v.key]; });
            }
            if (opts.note) {
                const note = document.createElement('div');
                note.className = 'drop';
                note.style.marginTop = '10px';
                note.textContent = opts.note;
                p.body.appendChild(note);
            }

            const renderView = (key) => {
                tabs.innerHTML = '';
                VIEWS.forEach((v) => {
                    const b = document.createElement('button');
                    b.className = 'qem-tab' + (v.key === key ? ' active' : '');
                    b.textContent = v.label;
                    b.addEventListener('click', () => renderView(v.key));
                    tabs.appendChild(b);
                });
                body.innerHTML = '';
                const rows = diff[key];
                if (!rows.length) { body.innerHTML = '<div class="qem-empty">这一类没有差异</div>'; return; }
                let tb = null;
                if (key === 'moved') {
                    tb = ui.table([
                        { key: 'name', label: '名称' },
                        { key: 'from', label: '原路径' },
                        { key: 'to', label: '新路径' },
                        { key: 'size', label: '大小', align: 'right', render: (v) => util.humanSize(v) },
                    ], rows, { maxHeight: '44vh' });
                } else if (key === 'changed') {
                    tb = ui.table([
                        { key: 'path', label: '路径' },
                        { key: 'oldSize', label: '原大小', align: 'right', render: (v) => util.humanSize(v) },
                        { key: 'newSize', label: '现大小', align: 'right', render: (v) => util.humanSize(v) },
                        { key: 'delta', label: '变化', align: 'right', render: (v, r2) => { const d = r2.newSize - r2.oldSize; return `${d >= 0 ? '+' : '-'}${util.humanSize(Math.abs(d))}`; } },
                        { key: 'oldTime', label: '原时间', render: (v) => util.escapeHtml(util.ts(v)) },
                        { key: 'newTime', label: '现时间', render: (v) => util.escapeHtml(util.ts(v)) },
                    ], rows, { maxHeight: '44vh' });
                } else {
                    tb = ui.table([
                        { key: 'path', label: '路径' },
                        { key: 'size', label: '大小', align: 'right', render: (v, r2) => r2.dir ? '文件夹' : util.humanSize(v) },
                        { key: 'updated_at', label: '修改时间', render: (v) => util.escapeHtml(util.ts(v)) },
                    ], rows, { maxHeight: '44vh' });
                }
                body.appendChild(tb.el);
            };

            const acts = document.createElement('div');
            acts.className = 'row';
            acts.style.marginTop = '10px';
            acts.style.flexWrap = 'wrap';
            const mk = (label, fn, cls) => {
                const b = document.createElement('button');
                b.textContent = label;
                if (cls) b.className = cls;
                b.addEventListener('click', fn);
                acts.appendChild(b);
            };
            mk('导出差异报告', () => {
                const lines = [
                    `目录差异报告`,
                    `基准：${oldSnap.label}（${util.ts(oldSnap.at)}）`,
                    `对比：${newSnap.label}（${util.ts(newSnap.at)}）`,
                    `新增 ${diff.added.length} / 缺失 ${diff.removed.length} / 内容变化 ${diff.changed.length} / 位置变化 ${diff.moved.length}`,
                    '',
                    '【缺失】',
                    ...diff.removed.map((r) => `${r.path}\t${util.humanSize(r.size)}\t${util.ts(r.updated_at)}`),
                    '',
                    '【新增】',
                    ...diff.added.map((r) => `${r.path}\t${util.humanSize(r.size)}\t${util.ts(r.updated_at)}`),
                    '',
                    '【内容变化】',
                    ...diff.changed.map((r) => `${r.path}\t${util.humanSize(r.oldSize)} → ${util.humanSize(r.newSize)}`),
                    '',
                    '【位置变化】',
                    ...diff.moved.map((r) => `${r.from} → ${r.to}`),
                ];
                util.saveTextFile(`qem_差异报告_${Date.now()}.txt`, lines.join('\n'));
            });
            mk('复制缺失清单', () => {
                if (!diff.removed.length) return ui.toast('没有缺失项', 'warn');
                util.copy(diff.removed.map((r) => r.path).join('\n'), `已复制 ${diff.removed.length} 条`);
            });
            mk('复制变化清单', () => {
                if (!diff.changed.length) return ui.toast('没有内容变化项', 'warn');
                util.copy(diff.changed.map((r) => `${r.path}\t${util.humanSize(r.oldSize)} → ${util.humanSize(r.newSize)}`).join('\n'), `已复制 ${diff.changed.length} 条`);
            });
            p.body.appendChild(acts);

            renderView(diff.removed.length ? 'removed' : (diff.added.length ? 'added' : 'changed'));
        },
    };



    /* ======================================================================
     * 6.9 统一删除入口
     *     删除在 5 处被调用（工作台/清理/查重/透视/空间分析），此前各写一遍
     *     「分片删除 + 登记回收站 fid + 记入撤销栈」，收敛为一个入口避免漏记。
     * ==================================================================== */

    /**
     * @param {Array} items 待删除项（需含 fid / name / size / pdir_fid）
     * @returns {Promise<number>} 实际提交删除的数量
     */
    /** 删除结果提示：全部失败时给出可操作指引，而不是「已删除 0 项」 */
    function toastDeleted(n, okText) {
        if (!n) return ui.toast('删除未成功，详情见「失败记录」', 'error', 5000);
        return ui.toast(okText);
    }

    async function deleteWithUndo(items, { label = '批量删除', onProgress = null, skipStaleCheck = false } = {}) {
        const list = (items || []).filter((i) => i && i.fid);
        if (!list.length) return 0;

        // 缓存降级数据可能已过期，基于它删除存在误删风险，先明确提示
        if (!skipStaleCheck && state.stale) {
            const go = await ui.confirm(
                `当前目录列表是缓存降级数据（${util.ts(state.stale.at)} 采集，原因：${state.stale.reason}），` +
                '可能与网盘真实内容不一致。\n\n基于这份旧列表删除存在误删风险，建议先刷新目录。是否仍要继续？',
                { danger: true, okText: '仍要继续' },
            );
            if (!go) return 0;
        }

        const res = await api.removeChunkedSafe(list.map((i) => i.fid), 100, onProgress);
        const okSet = new Set(res.ok);
        const done = list.filter((i) => okSet.has(i.fid));

        // 关键：某一片失败时，前面已删成功的文件必须照常进撤销栈，否则「删了却撤不回」
        if (res.fails.length) {
            const failMap = new Map(res.fails.map((x) => [x.fid, x.error]));
            failLog.push({
                action: 'delete',
                label,
                items: list.filter((i) => failMap.has(i.fid)).map((i) => ({
                    fid: i.fid, name: i.name, size: i.size, pdir: i.pdir_fid,
                    error: failMap.get(i.fid),
                })),
                note: `${done.length}/${list.length} 项已成功删除`,
            });
        }
        if (!done.length) return 0;

        let entries = done.map((i) => ({ fid: i.fid, name: i.name, size: i.size, pdir: i.pdir_fid }));
        let undoable = true;
        let note = '';
        try {
            const pairs = await opLog.resolveRecycleFids(entries);
            const map = new Map(pairs.map((x) => [x.fid, x.recycleFid]));
            entries = entries.map((e) => ({ ...e, recycleFid: map.get(e.fid) }));
            if (map.size < entries.length) {
                undoable = map.size > 0;
                note = `仅 ${map.size}/${entries.length} 项匹配到回收站条目（可能已超出保留期）`;
            }
        } catch (e) {
            undoable = false;
            note = '未能读取回收站，无法自动撤销，请到「回收站」手动还原';
        }
        if (res.fails.length) {
            note = (note ? note + '；' : '') + `${res.fails.length} 项删除失败，已记入「失败记录」`;
        }
        opLog.push({ type: 'delete', label, entries, undoable, note });
        capacityGuard.invalidate();
        return done.length;
    }

    /* ======================================================================
     * 6.10 配置版本历史与回滚
     *      配置是唯一「误操作后无法自我恢复」的数据：改错一个开关、被导入
     *      覆盖、误点重置，都没有退路。此处按版本留痕，并可一键回滚。
     *      （云端配置同步需要上传管线，本版暂无，故做本地版本历史。）
     * ==================================================================== */

    const cfgKey = 'qem_cfg_history_v1';

    const cfgHistory = {
        MAX: 20,
        AUTO_INTERVAL: 5 * 60 * 1000,   // 自动快照最短间隔
        lastAutoAt: 0,
        _suppress: false,               // 回滚过程中抑制自动快照，避免自激

        list() {
            try {
                const raw = localStorage.getItem(cfgKey);
                const arr = raw ? JSON.parse(raw) : [];
                return Array.isArray(arr) ? arr : [];
            } catch (e) { return []; }
        },

        persist(arr) {
            const trimmed = arr.slice(0, this.MAX);
            try { localStorage.setItem(cfgKey, JSON.stringify(trimmed)); return true; }
            catch (e) { ui.toast('配置历史保存失败：本地存储不足，请清理历史', 'error', 5000); return false; }
        },

        hashOf(data) { return fnv(JSON.stringify(data)); },

        /** 展平为 'a.b.c' → 标量；数组与超大对象按整体比较 */
        flatten(obj, prefix = '', out = {}, depth = 0) {
            Object.keys(obj || {}).sort().forEach((k) => {
                const v = obj[k];
                const path = prefix ? `${prefix}.${k}` : k;
                if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) {
                    if (Object.keys(v).length > 24) out[path] = JSON.stringify(v);
                    else this.flatten(v, path, out, depth + 1);
                } else {
                    out[path] = v && typeof v === 'object' ? JSON.stringify(v) : v;
                }
            });
            return out;
        },

        /** 键级差异 */
        diff(oldData, newData) {
            const A = this.flatten(oldData || {});
            const B = this.flatten(newData || {});
            const keys = Array.from(new Set(Object.keys(A).concat(Object.keys(B)))).sort();
            const out = [];
            keys.forEach((k) => {
                const sa = A[k] === undefined ? '∅' : JSON.stringify(A[k]);
                const sb = B[k] === undefined ? '∅' : JSON.stringify(B[k]);
                if (sa !== sb) out.push({ path: k, before: A[k], after: B[k] });
            });
            return out;
        },

        /** 记录一版；内容与最新版相同则跳过 */
        push(reason = 'auto', note = '') {
            const data = util.clone(config.data);
            const hash = this.hashOf(data);
            const arr = this.list();
            if (arr.length && arr[0].hash === hash) return null;
            const rec = {
                id: util.uuid(), at: Date.now(), reason, note,
                hash, data, scriptVersion: VERSION,
                changes: arr.length ? this.diff(arr[0].data, data).length : 0,
            };
            arr.unshift(rec);
            return this.persist(arr) ? rec : null;
        },

        /** 由 config 变更回调触发（带节流） */
        autoSnapshot() {
            if (this._suppress) return;
            if (!config.get('cfgHistory.auto', true)) return;
            const now = Date.now();
            if (now - this.lastAutoAt < this.AUTO_INTERVAL) return;
            const arr = this.list();
            if (arr.length && arr[0].hash === this.hashOf(config.data)) return;
            this.lastAutoAt = now;
            this.push('auto', '自动快照');
        },

        async saveCurrent() {
            const note = await ui.prompt('为该版本添加备注（可留空）：', { value: '', placeholder: '例如：调好下载器参数' });
            if (note === null) return;
            const rec = this.push('manual', note || '手动存档');
            ui.toast(rec ? '已保存当前配置为一版' : '配置与最新版相同，未重复保存');
        },

        async restore(id) {
            const rec = this.list().find((r) => r.id === id);
            if (!rec) return false;
            const diff = this.diff(rec.data, config.data);
            const ok = await ui.confirm(
                `恢复到该版本？\n\n时间：${util.ts(rec.at)}\n来源：${this.reasonLabel(rec.reason)}\n备注：${rec.note || '(无)'}\n` +
                `将覆盖当前 ${diff.length} 处配置差异。\n\n恢复前会确保当前配置已被留档（若已有相同记录则不重复留档），可再回退。`,
                { okText: '恢复' },
            );
            if (!ok) return false;

            this.push('backup', '恢复前自动备份');
            this._suppress = true;
            try {
                config.data = config.merge(util.clone(DEFAULT_CONFIG), util.clone(rec.data));
                config.save();
                ui.applyTheme();
            } finally { this._suppress = false; }
            ui.toast('配置已恢复到该版本');
            return true;
        },

        reasonLabel(r) {
            return { auto: '自动快照', manual: '手动存档', backup: '恢复前备份' }[r] || r;
        },

        open() {
            const p = ui.panel({
                title: '配置版本历史',
                size: 'lg',
                buttons: [
                    { label: '保存当前为版本', primary: true, onClick: async () => { await this.saveCurrent(); p.close(); this.open(); } },
                    { label: t('close'), onClick: (a) => a.close() },
                ],
            });
            const info = document.createElement('div');
            info.className = 'muted';
            const box = document.createElement('div');
            box.style.marginTop = '10px';
            p.body.append(info, box);

            const arr = this.list();
            if (!arr.length) {
                info.textContent = '还没有配置版本记录。开启自动快照后配置变化会自动留痕；也可随时手动存档。';
                box.innerHTML = '<div class="qem-empty">点击「保存当前为版本」建立第一个版本</div>';
                return;
            }
            const nowDiff = this.diff(arr[0].data, config.data).length;
            info.innerHTML = `共 <b>${arr.length}</b> 版（最多保留 ${this.MAX} 版）。` +
                (nowDiff ? `最新记录与当前配置有 <b>${nowDiff}</b> 处差异。` : '当前配置与最新记录一致。') +
                `　自动快照：${config.get('cfgHistory.auto', true) ? '已开启' : '已关闭'}`;

            const rows = arr.map((r) => ({ ...r, timeText: util.ts(r.at), reasonText: this.reasonLabel(r.reason) }));
            const tb = ui.table([
                { key: 'timeText', label: '时间' },
                { key: 'reasonText', label: '来源', render: (v) => `<span class="qem-tag">${util.escapeHtml(v)}</span>` },
                { key: 'note', label: '备注', render: (v) => util.escapeHtml(v || '-') },
                { key: 'changes', label: '相比上一版', align: 'right', render: (v) => v ? `${v} 处` : '-' },
                { key: 'act', label: '操作', render: (v, r) => {
                    const bar = document.createElement('div');
                    bar.className = 'row';
                    const mk = (label, fn, cls) => {
                        const b = document.createElement('button');
                        b.textContent = label;
                        if (cls) b.className = cls;
                        b.addEventListener('click', fn);
                        bar.appendChild(b);
                    };
                    mk('对比当前', () => { p.close(); cfgHistory.showDiff(r, config.data, '当前配置'); });
                    mk('恢复', async () => {
                        const done = await cfgHistory.restore(r.id);
                        if (done) { p.close(); cfgHistory.open(); }
                    }, 'primary');
                    mk('导出', () => {
                        util.saveTextFile(`qem_config_v${new Date(r.at).toISOString().slice(0, 10)}_${r.id.slice(0, 6)}.json`,
                            JSON.stringify({ __type: 'qem-config', version: r.scriptVersion, exportedAt: r.at, data: r.data }, null, 2),
                            'application/json');
                    });
                    mk('删除', async () => {
                        const ok = await ui.confirm('删除该版本记录？不影响当前配置。', { danger: true, okText: '删除' });
                        if (!ok) return;
                        cfgHistory.persist(cfgHistory.list().filter((x) => x.id !== r.id));
                        p.close(); cfgHistory.open();
                    }, 'danger');
                    return bar;
                } },
            ], rows, { maxHeight: '52vh' });
            box.appendChild(tb.el);

            const acts = document.createElement('div');
            acts.className = 'row';
            acts.style.marginTop = '10px';
            acts.style.flexWrap = 'wrap';
            const auto = document.createElement('button');
            auto.textContent = config.get('cfgHistory.auto', true) ? '关闭自动快照' : '开启自动快照';
            auto.addEventListener('click', () => { config.set('cfgHistory.auto', !config.get('cfgHistory.auto', true)); p.close(); cfgHistory.open(); });
            const clr = document.createElement('button');
            clr.className = 'danger';
            clr.textContent = '清空全部版本';
            clr.addEventListener('click', async () => {
                const ok = await ui.confirm(`清空全部 ${arr.length} 版配置记录？不影响当前配置。`, { danger: true, okText: '清空' });
                if (!ok) return;
                try { localStorage.removeItem(cfgKey); } catch (e) { /* 忽略 */ }
                p.close(); cfgHistory.open();
            });
            acts.append(auto, clr);
            box.appendChild(acts);
        },

        /** 键级差异面板 */
        showDiff(fromRec, nowData, nowLabel) {
            const diff = this.diff(fromRec.data, nowData);
            const p = ui.panel({ title: '配置差异', size: 'md', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
            const head = document.createElement('div');
            head.className = 'col';
            head.innerHTML = `<div class="muted">${util.escapeHtml(util.ts(fromRec.at))}（${util.escapeHtml(this.reasonLabel(fromRec.reason))}） →　${util.escapeHtml(nowLabel)}</div>` +
                `<div>共 <b>${diff.length}</b> 处差异</div>`;
            p.body.appendChild(head);
            if (!diff.length) {
                const d = document.createElement('div');
                d.className = 'qem-empty';
                d.textContent = '两边配置完全一致';
                p.body.appendChild(d);
                return;
            }
            const fmt = (v) => {
                if (v === undefined) return '<span class="muted">（无）</span>';
                const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
                return util.escapeHtml(s.length > 90 ? s.slice(0, 90) + '…' : s);
            };
            p.body.appendChild(ui.table([
                { key: 'path', label: '配置项', render: (v) => `<span class="qem-mono">${util.escapeHtml(v)}</span>` },
                { key: 'before', label: '原值', render: (v) => fmt(v) },
                { key: 'after', label: '现值', render: (v) => fmt(v) },
            ], diff, { maxHeight: '54vh' }).el);
        },
    };

    // 配置每次落盘后触发一次自动快照（cfgHistory 内部有节流与去重）
    config.onChange(() => cfgHistory.autoSnapshot());

    /* ======================================================================
     * 6.11 空间占用分析
     * ==================================================================== */

    const spaceReport = {
        /** 按维度聚合（纯函数，便于单测）：files / ext / category / topdir */
        aggregate(files, group, topN = 30) {
            if (group === 'files') {
                return files.slice().sort((a, b) => b.size - a.size).slice(0, topN)
                    .map((f) => ({ key: f.path || f.name, size: f.size, count: 1, extra: f }));
            }
            const map = new Map();
            files.forEach((f) => {
                let k;
                if (group === 'ext') k = f.ext ? '.' + f.ext : '(无扩展名)';
                else if (group === 'category') k = (CATEGORY[f.category] || CATEGORY.other).label;
                else {
                    const rel = String(f.path || f.name).split('/').slice(1);   // 去掉根目录名
                    k = rel.length > 1 ? rel[0] : '(根目录下散置文件)';
                }
                if (!map.has(k)) map.set(k, { key: k, size: 0, count: 0 });
                const rec = map.get(k);
                rec.size += f.size;
                rec.count++;
            });
            return Array.from(map.values()).sort((a, b) => b.size - a.size).slice(0, topN);
        },

        groupLabel(group, n) {
            if (group === 'files') return `最大的 ${n} 个文件`;
            if (group === 'ext') return '按扩展名聚合';
            if (group === 'category') return '按文件类型聚合';
            return '按一级子目录聚合';
        },

        open() {
            const p = ui.panel({ title: '空间占用分析', size: 'lg', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
            const capBox = document.createElement('div');
            capBox.className = 'drop';
            capBox.innerHTML = '<div class="muted">正在读取容量...</div>';
            const info = document.createElement('div');
            info.className = 'muted';
            info.style.margin = '8px 0';
            const listBox = document.createElement('div');
            p.body.append(capBox);

            const form = ui.form([
                { key: 'scope', label: '范围', type: 'select', value: 'deep', options: [
                    { value: 'deep', label: '当前目录及子目录（推荐）' },
                    { value: 'current', label: '仅当前目录' },
                ] },
                { key: 'group', label: '聚合维度', type: 'select', value: 'files', options: [
                    { value: 'files', label: '单个文件 Top N' },
                    { value: 'ext', label: '按扩展名' },
                    { value: 'category', label: '按文件类型' },
                    { value: 'topdir', label: '按一级子目录' },
                ] },
                { key: 'topN', label: 'Top N', type: 'select', value: '30', options: ['10', '20', '30', '50', '100'] },
                { key: 'minSize', label: '忽略小于', value: '0', placeholder: '如 10MB，过滤碎片文件' },
            ], () => run());
            p.body.append(form.el, info, listBox);

            async function run() {
                const v = form.values;
                info.textContent = t('working');
                listBox.innerHTML = '';
                let pool;
                try {
                    if (v.scope === 'deep') {
                        const pr = ui.progress('扫描体积');
                        try {
                            pool = await scanner.walk(state.cwd, { onProgress: (n, path) => pr.set(0.5, `已扫描 ${n} 项 · ${path}`) });
                        } finally { pr.close(); }
                    } else {
                        pool = state.items.map((i) => ({ ...i, path: i.name }));
                    }
                } catch (e) { info.textContent = '扫描失败：' + e.message; return; }

                const min = parseSize(v.minSize);
                const files = pool.filter((i) => !i.dir && i.size >= min);
                const sum = scanner.summarize(pool);
                const topN = Number(v.topN) || 30;

                const rows = spaceReport.aggregate(files, v.group, topN);
                const label = spaceReport.groupLabel(v.group, rows.length);

                if (!rows.length) { info.textContent = '没有符合条件的文件'; return; }
                const shown = rows.reduce((s, r) => s + r.size, 0);
                const max = rows[0].size || 1;
                info.innerHTML = `${label}　共 ${rows.length} 项，合计 <b>${util.humanSize(shown)}</b>` +
                    `　|　本范围文件总量 <b>${util.humanSize(sum.size)}</b>（${sum.files} 个文件 / ${sum.folders} 个文件夹）` +
                    (sum.size ? `，占比 ${(shown / sum.size * 100).toFixed(1)}%` : '');

                const tb = ui.table([
                    { key: 'key', label: v.group === 'files' ? '文件' : '分类', render: (val, row) => {
                        const box = document.createElement('div');
                        box.className = 'qem-rank';
                        const name = document.createElement('span');
                        name.className = 'grow ellipsis';
                        name.textContent = val;
                        name.title = val;
                        const track = document.createElement('span');
                        track.className = 'track';
                        const bar = document.createElement('i');
                        bar.style.width = Math.max(1, row.size / max * 100) + '%';
                        track.appendChild(bar);
                        const num = document.createElement('span');
                        num.className = 'val';
                        num.textContent = util.humanSize(row.size);
                        box.append(name, track, num);
                        return box;
                    } },
                    { key: 'count', label: v.group === 'files' ? '大小' : '文件数', align: 'right', render: (val, row) => v.group === 'files' ? util.humanSize(row.size) : `${row.count} 个` },
                    { key: 'act', label: '操作', render: (val, row) => {
                        const bar = document.createElement('div');
                        bar.className = 'row';
                        const b = document.createElement('button');
                        b.textContent = '复制路径';
                        b.addEventListener('click', () => util.copy(row.key, '已复制'));
                        bar.appendChild(b);
                        if (v.group === 'files' && row.extra) {
                            const d = document.createElement('button');
                            d.className = 'danger';
                            d.textContent = '删除';
                            d.addEventListener('click', async () => {
                                const ok = await ui.confirm(`将「${row.key}」移入回收站（${util.humanSize(row.size)}）？\n删除后可通过「撤销」还原。`, { danger: true, okText: '移入回收站' });
                                if (!ok) return;
                                const pr = ui.progress('删除中');
                                try {
                                    await deleteWithUndo([row.extra], { label: '空间分析删除', onProgress: (d2, t2) => pr.set(d2 / t2, `已删除 ${d2}/${t2}`) });
                                    pr.close();
                                    ui.toast('已移入回收站，可通过 Alt+Z 撤销');
                                    p.close(); spaceReport.open();
                                    if (state.ui) await workspace.reload();
                                } catch (e) { pr.close(); ui.toast('删除失败：' + e.message, 'error'); }
                            });
                            bar.appendChild(d);
                        }
                        return bar;
                    } },
                ], rows, { maxHeight: '44vh' });
                listBox.innerHTML = '';
                listBox.appendChild(tb.el);

                const acts = document.createElement('div');
                acts.className = 'row';
                acts.style.marginTop = '10px';
                acts.style.flexWrap = 'wrap';
                const mk = (l2, fn, cls) => {
                    const b = document.createElement('button');
                    b.textContent = l2;
                    if (cls) b.className = cls;
                    b.addEventListener('click', fn);
                    acts.appendChild(b);
                };
                mk('导出 CSV', () => exporter.saveCsv('空间占用', rows.map((r) => ({
                    name: r.key, path: r.key, size: r.size, ext: '', dir: false, updated_at: 0, fid: r.extra ? r.extra.fid : '',
                }))));
                mk('复制清单', () => util.copy(rows.map((r) => `${util.humanSize(r.size)}\t${r.key}`).join('\n'), `已复制 ${rows.length} 条`));
                if (v.group === 'files') {
                    mk(`删除最大的 ${Math.min(10, rows.length)} 个文件`, async () => {
                        const targets = rows.slice(0, 10).map((r) => r.extra).filter(Boolean);
                        if (!targets.length) return;
                        const total = targets.reduce((s, x) => s + x.size, 0);
                        const ok = await ui.confirm(`将最大的 ${targets.length} 个文件移入回收站，合计 ${util.humanSize(total)}。\n删除后可通过「撤销」还原。是否继续？`, { danger: true, okText: '移入回收站' });
                        if (!ok) return;
                        const pr = ui.progress('删除中');
                        try {
                            const n = await deleteWithUndo(targets, { label: '空间分析批量删除', onProgress: (d2, t2) => pr.set(d2 / t2, `已删除 ${d2}/${t2}`) });
                            pr.close();
                            toastDeleted(n, `已移入回收站 ${n} 项，可通过 Alt+Z 撤销`);
                            p.close(); spaceReport.open();
                            if (state.ui) await workspace.reload();
                        } catch (e) { pr.close(); ui.toast('删除失败：' + e.message, 'error'); }
                    }, 'danger');
                }
                p.body.appendChild(acts);
            }

            capacityGuard.summary().then((s) => {
                if (!s) { capBox.innerHTML = '<div class="muted">容量读取失败（未登录或接口异常）</div>'; return; }
                const pct = (s.pct * 100).toFixed(1);
                capBox.innerHTML = `<div>网盘容量：已用 <b>${util.humanSize(s.used)}</b> / ${util.humanSize(s.total)}（${pct}%）　剩余 <b>${util.humanSize(s.remain)}</b></div>` +
                    (s.pct >= Number(config.get('capacityWarn', 0.95))
                        ? '<div class="qem-tag err" style="margin-top:6px">已超过容量预警阈值，建议先清理大文件</div>' : '');
            });

            run();
        },
    };

    /* ======================================================================
     * 6.11 视图偏好（按目录独立记忆）
     *      上游的「视图偏好」是列表/网格切换；本版工作台是管理型列表，
     *      故落地为「行密度 + 缩略图开关」，两者都可按目录独立记忆，
     *      并顺带启用数据模型里一直在拉取却未使用的 thumbnail 字段。
     * ==================================================================== */

    const viewPref = {
        DENSITIES: ['compact', 'normal', 'loose'],
        LABEL: { compact: '紧凑', normal: '标准', loose: '宽松' },

        defaults() {
            const v = config.get('view', {});
            return { density: v.density || 'normal', thumb: !!v.thumb };
        },

        /** 读取某目录的视图偏好；perDir 关闭时统一用全局默认 */
        get(pdir = state.cwd) {
            if (!config.get('view.perDir', true)) return this.defaults();
            const map = config.get('viewPref', {}) || {};
            const rec = map[pdir];
            return rec ? { ...this.defaults(), ...rec } : this.defaults();
        },

        set(pdir, patch) {
            if (!config.get('view.perDir', true)) {
                const v = { ...config.get('view', {}) };
                Object.keys(patch || {}).forEach((k) => { v[k] = patch[k]; });
                config.set('view', v);
                return;
            }
            const map = { ...(config.get('viewPref', {}) || {}) };
            map[pdir] = { ...this.get(pdir), ...patch };
            config.set('viewPref', map);
        },

        /** 密度循环：紧凑 → 标准 → 宽松 → 紧凑 */
        nextDensity(cur) {
            const list = this.DENSITIES;
            const i = list.indexOf(cur);
            return list[(i + 1) % list.length];
        },

        /** 是否该目录项展示缩略图（仅图片/视频有封面） */
        shouldThumb(item, pref) {
            const p = pref || this.get();
            return !!(p.thumb && item && !item.dir && item.thumbnail && (item.category === 'image' || item.category === 'video'));
        },

        /** 供设置页清理所有目录级偏好 */
        clearAll() { config.set('viewPref', {}); },
    };

    /* ======================================================================
     * 6.12 跨账号迁移校验
     *      换号迁移后「文件到底全没全」此前无法验证。做法：账号 A 导出清单
     *      指纹文件 → 登录账号 B 导入比对，输出缺失 / 多出 / 内容不一致。
     *      复用 snapshot 的打包与比对，语义标签换成迁移口径。
     * ==================================================================== */

    const crossCheck = {
        TAG: 'qem-inventory',
        LIMIT_BYTES: 6 * 1024 * 1024,
        LIMIT_ITEMS: 20000,

        /** 采集清单（不写入快照库，仅内存 + 可下载） */
        async build(scope = 'deep') {
            const prefix = state.path.map((s) => s.name).join('/');
            if (scope === 'current') {
                return { items: state.items.map((i) => ({ ...i, path: `${prefix}/${i.name}` })), prefix };
            }
            const pr = ui.progress('采集账号清单');
            try {
                const items = await scanner.walk(state.cwd, {
                    rootPath: prefix,
                    onProgress: (n, p) => pr.set(0.5, `已采集 ${n} 项 · ${p}`),
                });
                return { items, prefix };
            } finally { pr.close(); }
        },

        /** 打包成可下载的清单结构 */
        inventoryOf(items) {
            const sum = scanner.summarize(items);
            return {
                __type: this.TAG,
                v: 1,
                at: Date.now(),
                scriptVersion: VERSION,
                root: { name: state.path.map((s) => s.name).join('/') },
                deep: true,
                count: items.length,
                size: sum.size,
                items: snapshot.pack(items),
            };
        },

        /** 校验导入内容是否本工具生成的清单，返回错误码（空串=通过） */
        validate(obj) {
            if (!obj || typeof obj !== 'object') return 'not-object';
            if (obj.__type !== this.TAG) return 'wrong-type';
            if (!Array.isArray(obj.items)) return 'no-items';
            if (!obj.root || typeof obj.root.name !== 'string') return 'no-root';
            return '';
        },

        validateMessage(code) {
            return {
                'not-object': '文件内容不是有效的 JSON 对象',
                'wrong-type': '这不是本工具导出的账号清单（缺少标识字段）',
                'no-items': '清单缺少项目列表',
                'no-root': '清单缺少根目录信息',
                parse: '文件解析失败，可能不是 JSON 文件',
                empty: '清单为空',
            }[code] || ('校验失败：' + code);
        },

        /** 导出当前账号清单为文件 */
        async exportFlow() {
            const p = ui.panel({
                title: '导出账号清单', size: 'sm', closeOnMask: false,
                buttons: [
                    { label: t('cancel'), onClick: (a) => a.close() },
                    {
                        label: '开始导出', primary: true,
                        onClick: async (a) => {
                            const scope = form.values.scope;
                            a.close();
                            if (state.stale && scope === 'current') {
                                const go = await ui.confirm('当前列表是缓存降级数据（可能已过期），导出的清单会不准确。\n建议先刷新目录再导出。是否仍要继续？', { okText: '仍要继续' });
                                if (!go) return;
                            }
                            let built;
                            try { built = await crossCheck.build(scope); }
                            catch (e) { ui.toast('采集失败：' + e.message, 'error'); return; }
                            const items = built.items;
                            if (!items.length) return ui.toast('该范围没有可导出的项目', 'warn');
                            if (items.length > crossCheck.LIMIT_ITEMS) return ui.toast(`项目过多（${items.length}），请缩小范围后重试`, 'error', 5000);

                            const inv = crossCheck.inventoryOf(items);
                            const text = JSON.stringify(inv);
                            if (text.length > crossCheck.LIMIT_BYTES) {
                                return ui.toast(`清单过大（${util.humanSize(text.length)}），建议改用「仅当前目录」或分目录导出`, 'error', 6000);
                            }
                            util.saveTextFile(`账号清单_${inv.root.name.replace(/\//g, '_')}_${new Date().toISOString().slice(0, 10)}.json`, text, 'application/json');
                            ui.toast(`已导出 ${inv.count} 项清单（${util.humanSize(text.length)}），可带到另一个账号导入比对`);
                        },
                    },
                ],
            });
            const form = ui.form([
                { key: 'scope', label: '导出范围', type: 'select', value: 'deep', options: [
                    { value: 'deep', label: '当前目录及子目录（推荐，覆盖完整）' },
                    { value: 'current', label: '仅当前目录' },
                ] },
            ]);
            const note = document.createElement('div');
            note.className = 'muted';
            note.style.marginTop = '8px';
            note.textContent = '清单只包含文件路径、体积与修改时间，不含文件内容、账号与凭证，可安全用于跨账号比对。';
            p.body.append(form.el, note);
        },

        /** 导入清单并与当前账号实际内容比对 */
        async compareFlow() {
            const p = ui.panel({
                title: '跨账号迁移校验', size: 'sm', closeOnMask: false,
                buttons: [
                    { label: t('cancel'), onClick: (a) => a.close() },
                    {
                        label: '选择清单文件并比对', primary: true,
                        onClick: async (a) => {
                            const scope = form.values.scope;
                            const file = await crossCheck.pickFile();
                            if (!file) return;
                            a.close();
                            await crossCheck.run(file, scope);
                        },
                    },
                ],
            });
            const form = ui.form([
                { key: 'scope', label: '比对范围', type: 'select', value: 'deep', options: [
                    { value: 'deep', label: '当前目录及子目录（需与导出时一致）' },
                    { value: 'current', label: '仅当前目录' },
                ] },
            ]);
            const note = document.createElement('div');
            note.className = 'muted';
            note.style.marginTop = '8px';
            note.textContent = '请在「要核对的那个账号」里打开本面板，先进入与导出时相同的目录，再选择清单文件。';
            p.body.append(form.el, note);
        },

        pickFile() {
            return new Promise((resolve) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.addEventListener('change', () => {
                    const f = input.files && input.files[0];
                    if (!f) return resolve(null);
                    const fr = new FileReader();
                    fr.onload = () => resolve({ name: f.name, text: String(fr.result) });
                    fr.onerror = () => resolve(null);
                    fr.readAsText(f);
                });
                input.click();
            });
        },

        async run(file, scope) {
            let inv = null;
            try { inv = JSON.parse(file.text); }
            catch (e) { return ui.toast(this.validateMessage('parse'), 'error', 5000); }

            const err = this.validate(inv);
            if (err) return ui.toast(this.validateMessage(err), 'error', 5000);
            if (!inv.items.length) return ui.toast(this.validateMessage('empty'), 'warn');

            let built;
            try { built = await this.build(scope); }
            catch (e) { return ui.toast('采集当前账号内容失败：' + e.message, 'error'); }

            const rootName = state.path.map((s) => s.name).join('/');
            const baseline = {
                id: 'imported', label: `${file.name}（另一账号，${util.ts(inv.at)}）`,
                at: inv.at, root: { fid: '', name: inv.root.name }, deep: true,
                count: inv.count, size: inv.size, items: inv.items,
            };
            const current = {
                id: 'current', label: `本账号当前状态 ${util.ts(Date.now())}`,
                at: Date.now(), root: { fid: state.cwd, name: rootName }, deep: true,
                count: built.items.length, size: built.items.reduce((s, i) => s + (i.dir ? 0 : i.size), 0),
                items: snapshot.pack(built.items),
            };

            const diff = snapshot.compare(baseline, current);
            // 迁移口径：基准=来源账号，对比=本账号
            snapshot.showDiff(baseline, current, diff, {
                title: '跨账号迁移校验结果',
                labels: {
                    removed: `本账号缺失 (${diff.removed.length})`,
                    added: `本账号多出 (${diff.added.length})`,
                    changed: `内容不一致 (${diff.changed.length})`,
                    moved: `位置变化 (${diff.moved.length})`,
                },
                note: diff.removed.length
                    ? `有 ${diff.removed.length} 个文件在来源账号存在、本账号没有 —— 迁移可能未完成，建议重新迁移这些文件。`
                    : '来源账号的文件在本账号中均能找到，迁移完整。',
            });
        },
    };

    /* ======================================================================
     * 6.13 搜索与筛选
     *      工作台早就有 20+ 个操作入口，却一直没有「找文件」的能力：
     *      ① 当前目录即时过滤（纯本地，输入即筛，不产生任何请求）
     *      ② 全盘搜索（走 /file/search，EP 表里早已定义但从未接线）
     *      parse() 为纯函数且永不抛错，便于单测；match() 不依赖 UI。
     * ==================================================================== */

    const finder = {
        /** size: 条件的比较符 */
        OPS: {
            '>': (a, b) => a > b, '>=': (a, b) => a >= b,
            '<': (a, b) => a < b, '<=': (a, b) => a <= b, '=': (a, b) => a === b,
        },

        /** 类型别名 → 归一化 category */
        TYPE_ALIAS: {
            '文件夹': 'folder', folder: 'folder', dir: 'folder', '目录': 'folder',
            '视频': 'video', video: 'video',
            '音频': 'audio', audio: 'audio', music: 'audio', '音乐': 'audio',
            '图片': 'image', image: 'image', photo: 'image', '照片': 'image',
            '文档': 'doc', doc: 'doc',
            '压缩': 'zip', '压缩包': 'zip', zip: 'zip',
            '应用': 'app', app: 'app',
        },

        /**
         * 解析查询串：
         *   空格分词（全部满足）｜"词组"（含空格）｜-词（排除）
         *   ext:mkv,mp4｜*.mkv｜type:视频｜size:>1gb｜/正则/flags
         * 非法条件不抛错，降级为普通关键词并记入 notes（供界面提示）。
         */
        parse(q) {
            const parsed = {
                raw: String(q || '').trim(),
                keywords: [], words: [], excludes: [], exts: [], types: [], sizes: [], regexes: [], notes: [],
            };
            if (!parsed.raw) return parsed;

            // 全角引号归一，便于中文输入法直接使用
            const raw = parsed.raw.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
            const tokens = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
            const unquote = (s) => s.replace(/^["']|["']$/g, '');

            tokens.forEach((tokRaw) => {
                let tok = tokRaw;
                let negate = false;
                if (tok.length > 1 && tok[0] === '-') { negate = true; tok = tok.slice(1); }
                const low = tok.toLowerCase();

                if (low.startsWith('ext:')) {
                    const list = unquote(tok.slice(4)).split(/[,|;]/)
                        .map((x) => x.trim().toLowerCase().replace(/^\*?\.?/, '')).filter(Boolean);
                    if (list.length) parsed.exts.push(...list);
                    else parsed.notes.push('扩展名条件为空');
                    return;
                }
                // 兼容 glob 写法：*.mkv 等同 ext:mkv
                const glob = /^\*\.([a-z0-9]+)$/i.exec(tok);
                if (glob) { parsed.exts.push(glob[1].toLowerCase()); return; }
                if (low.startsWith('type:')) {
                    const list = unquote(tok.slice(5)).split(/[,|;]/).map((x) => x.trim()).filter(Boolean);
                    const mapped = list.map((x) => this.TYPE_ALIAS[x.toLowerCase()] || this.TYPE_ALIAS[x]).filter(Boolean);
                    if (mapped.length) parsed.types.push(...mapped);
                    else parsed.notes.push(`未知类型「${list.join(',')}」`);
                    return;
                }
                if (low.startsWith('size:')) {
                    const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(tok.slice(5));
                    const bytes = m ? parseSize(m[2]) : 0;
                    if (!m || !bytes) { parsed.notes.push('体积条件无法识别'); return; }
                    parsed.sizes.push({ op: m[1] || '>=', bytes, negate });
                    return;
                }
                if (tok.length > 2 && tok[0] === '/') {
                    const m = /^\/(.+)\/([a-z]*)$/i.exec(tok);
                    if (m) {
                        try {
                            const flags = m[2].replace(/g/g, '');
                            parsed.regexes.push(new RegExp(m[1], flags.includes('i') ? flags : flags + 'i'));
                            return;
                        } catch (e) { parsed.notes.push('正则表达式无效，已按关键词处理'); }
                    } else {
                        // 看起来想写正则但不完整：必须提示，否则用户只会觉得「搜不到」
                        parsed.notes.push('正则格式不完整（缺少结尾 /），已按关键词处理');
                    }
                }
                const word = unquote(tok);
                if (!word) return;
                if (negate) parsed.excludes.push(word.toLowerCase());
                else { parsed.keywords.push(word.toLowerCase()); parsed.words.push(word); }
            });

            return parsed;
        },

        /** 是否含有任何有效条件 */
        isActive(parsed) {
            return !!parsed && (parsed.keywords.length > 0 || parsed.excludes.length > 0 || parsed.exts.length > 0
                || parsed.types.length > 0 || parsed.sizes.length > 0 || parsed.regexes.length > 0);
        },

        /** 单条是否命中所解析的条件 */
        match(item, parsed) {
            if (!item) return false;
            const name = String(item.name || '').toLowerCase();
            if (parsed.keywords.some((k) => !name.includes(k))) return false;
            if (parsed.excludes.some((k) => name.includes(k))) return false;
            if (parsed.exts.length) {
                const ext = String(item.ext || '').toLowerCase();
                if (!ext || !parsed.exts.includes(ext)) return false;
            }
            if (parsed.types.length && !parsed.types.includes(item.category)) return false;
            if (parsed.sizes.length) {
                const okSize = parsed.sizes.every((s) => {
                    const hit = (this.OPS[s.op] || this.OPS['>='])(Number(item.size || 0), s.bytes);
                    return s.negate ? !hit : hit;
                });
                if (!okSize) return false;
            }
            if (parsed.regexes.length
                && !parsed.regexes.every((re) => { re.lastIndex = 0; return re.test(String(item.name || '')); })) return false;
            return true;
        },

        /** 批量过滤；无有效条件时原样返回（active=false） */
        filter(items, q) {
            const list = Array.from(items || []);
            const parsed = this.parse(q);
            if (!this.isActive(parsed)) return { items: list, parsed, active: false };
            return { items: list.filter((it) => this.match(it, parsed)), parsed, active: true };
        },

        /** 命中片段高亮：先分段再分别转义，避免把用户输入当 HTML 插入 */
        highlight(name, parsed) {
            const text = String(name || '');
            const terms = (parsed && parsed.keywords) || [];
            if (!terms.length) return util.escapeHtml(text);

            const lower = text.toLowerCase();
            const ranges = [];
            terms.forEach((kw) => {
                if (!kw) return;
                let from = 0;
                while (from <= lower.length) {
                    const at = lower.indexOf(kw, from);
                    if (at < 0) break;
                    ranges.push([at, at + kw.length]);
                    from = at + kw.length;
                }
            });
            if (!ranges.length) return util.escapeHtml(text);

            ranges.sort((a, b) => a[0] - b[0]);
            const merged = [];
            ranges.forEach((r) => {
                const last = merged[merged.length - 1];
                if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
                else merged.push([r[0], r[1]]);
            });

            let out = '';
            let at = 0;
            merged.forEach(([s, e]) => {
                out += util.escapeHtml(text.slice(at, s))
                    + '<mark class="qem-hl">' + util.escapeHtml(text.slice(s, e)) + '</mark>';
                at = e;
            });
            return out + util.escapeHtml(text.slice(at));
        },

        /** 条件摘要（界面提示用） */
        describe(parsed) {
            if (!parsed) return '';
            const bits = [];
            if (parsed.keywords.length) bits.push(`关键词 ${(parsed.words.length ? parsed.words : parsed.keywords).join(' + ')}`);
            if (parsed.excludes.length) bits.push(`排除 ${parsed.excludes.join(' / ')}`);
            if (parsed.exts.length) bits.push(`扩展名 ${parsed.exts.join('/')}`);
            if (parsed.types.length) bits.push(`类型 ${parsed.types.join('/')}`);
            if (parsed.sizes.length) bits.push(parsed.sizes.map((s) => `体积${s.negate ? '非' : ''} ${s.op}${util.humanSize(s.bytes)}`).join(' '));
            if (parsed.regexes.length) bits.push(`${parsed.regexes.length} 个正则`);
            if (parsed.notes.length) bits.push(`⚠ ${parsed.notes.join('；')}`);
            return bits.join('　·　');
        },

        /** fid → 条目 的索引快照（一次全扫，供 pathLabel 逐行调用；TTL 20 秒） */
        _idx: { at: 0, map: new Map() },

        invalidateIndex() { this._idx.at = 0; },

        _index() {
            if (this._idx.at && Date.now() - this._idx.at < 20000) return this._idx.map;
            const byFid = new Map();
            try {
                const prefix = LS_CACHE_PREFIX + 'idx_';
                const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
                keys.forEach((k) => {
                    const raw = localStorage.getItem(k);
                    if (!raw) return;
                    const d = JSON.parse(raw);
                    (d && d.items ? d.items : []).forEach((it) => {
                        if (it && it.fid) byFid.set(String(it.fid), it);
                    });
                });
            } catch (e) { /* 索引不可读则退化为直达 */ }
            this._idx = { at: Date.now(), map: byFid };
            return byFid;
        },

        /**
         * 用本地索引缓存反查某一目录的完整路径。
         * 索引不全时返回不完整结果（只到能解析的最深层），调用方需提示用户。
         */
        resolvePath(pdirFid) {
            const rootPath = [{ fid: ROOT_FID, name: '我的网盘' }];
            const target = String(pdirFid || ROOT_FID);
            if (target === ROOT_FID) return { path: rootPath, complete: true };

            const byFid = this._index();

            const chain = [];
            const seen = new Set();
            let cur = target;
            while (cur && cur !== ROOT_FID && !seen.has(cur)) {
                seen.add(cur);
                const node = byFid.get(cur);
                if (!node) return { path: rootPath.concat([{ fid: target, name: '（未解析位置）' }]), complete: false };
                chain.unshift({ fid: cur, name: node.name });
                cur = String(node.pdir_fid || ROOT_FID);
            }
            return { path: rootPath.concat(chain), complete: true };
        },

        /** 路径文案（表格列用） */
        pathLabel(pdirFid) {
            if (String(pdirFid || ROOT_FID) === ROOT_FID) return '我的网盘';
            const r = this.resolvePath(pdirFid);
            return r.complete ? r.path.map((s) => s.name).join(' / ') : '（未解析，可点「定位」）';
        },

        /** 从搜索结果跳到其所在目录并选中该项 */
        async locate(item) {
            const res = this.resolvePath(item.pdir_fid);
            if (!res.complete) ui.toast('本地索引未覆盖该路径，已直接跳到所在目录（面包屑可能不完整）', 'warn', 4500);
            state.path = res.path;
            state.cursor = -1;
            state.anchor = null;
            if (workspace.setQuery) workspace.setQuery('');
            state.query = '';
            await workspace.reload(item.pdir_fid);
            sel.set([item.fid]);
            if (workspace.render) workspace.render();
        },

        /** 全盘搜索面板：结果可定位、下载、移动、删除（删除走回收站且可撤销） */
        async openGlobal(initial = '') {
            const p = ui.panel({
                title: '全盘搜索', size: 'lg',
                buttons: [{ label: t('close'), onClick: (a) => a.close() }],
            });

            const bar = document.createElement('div');
            bar.className = 'qem-search';
            const box = document.createElement('div');
            box.className = 'box';
            const ico = document.createElement('span');
            ico.className = 'ico';
            ico.textContent = '🔎';
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = '按文件名全盘搜索（支持 ext: / type: / size: 与 -排除）';
            input.value = initial;
            box.append(ico, input);
            const goBtn = document.createElement('button');
            goBtn.className = 'primary';
            goBtn.textContent = '搜索';
            bar.append(box, goBtn);

            const stat = document.createElement('div');
            stat.className = 'muted';
            const listBox = document.createElement('div');
            listBox.className = 'qem-content';
            listBox.style.marginTop = '10px';
            const acts = document.createElement('div');
            acts.className = 'row';
            acts.style.marginTop = '10px';
            acts.style.flexWrap = 'wrap';
            p.body.append(bar, stat, listBox, acts);

            let rows = [];
            let picked = [];
            let running = false;
            const target = () => (picked.length ? picked : rows);

            const run = async () => {
                const q = input.value.trim();
                if (!q) return ui.toast('请输入搜索关键词', 'warn');
                // 服务端只认文件名关键词；ext:/type:/size:/排除 属本地筛选语法，原样送出必然搜不到
                const kw = finder.parse(q).words.join(' ');
                if (!kw) {
                    return ui.toast('全盘搜索需要至少一个文件名关键词（ext: / type: / size: 仅用于本地筛选）', 'warn', 5000);
                }
                if (running) return;
                running = true;
                goBtn.disabled = true;
                stat.textContent = t('working');
                listBox.innerHTML = '';
                rows = [];
                picked = [];
                acts.innerHTML = '';
                try {
                    const r = await api.searchAll(kw, { max: 300, onProgress: (n, tt) => { stat.textContent = `已获取 ${n} / ${tt}`; } });
                    rows = r.items;
                    let desc = finder.describe(finder.parse(q));
                    if (kw !== q) desc = '';   // 服务端按关键词搜，结构化条件不再成立
                    stat.textContent = `找到 ${rows.length} 项`
                        + (r.total > rows.length ? `（共 ${r.total}，已截断）` : '')
                        + (desc ? '　·　' + desc : '');
                } catch (e) {
                    stat.textContent = '';
                    const err = document.createElement('div');
                    err.className = 'qem-empty';
                    err.textContent = `搜索失败：${e.message}`;
                    listBox.appendChild(err);
                    return;
                } finally {
                    running = false;
                    goBtn.disabled = false;
                }

                if (!rows.length) {
                    const empty = document.createElement('div');
                    empty.className = 'qem-empty';
                    empty.textContent = '没有找到匹配的文件';
                    listBox.appendChild(empty);
                    return;
                }

                const hlParsed = finder.parse(kw);   // 每行都 parse 一次没必要，这里只算一遍
                const tb = ui.table([
                    { key: 'name', label: '名称', render: (v, row) => {
                        const b = document.createElement('div');
                        b.className = 'name';
                        const ic = document.createElement('span');
                        ic.textContent = (CATEGORY[row.category] || CATEGORY.other).icon;
                        const tx = document.createElement('span');
                        tx.className = 'txt';
                        tx.title = v;
                        tx.innerHTML = finder.highlight(v, hlParsed);
                        b.append(ic, tx);
                        return b;
                    } },
                    { key: 'pdir_fid', label: '所在目录', render: (v) => util.escapeHtml(finder.pathLabel(v)) },
                    { key: 'size', label: '大小', align: 'right', render: (v, row) => row.dir ? '-' : util.humanSize(v) },
                    { key: 'updated_at', label: '修改时间', render: (v) => util.escapeHtml(util.ts(v)) },
                    { key: 'act', label: '操作', render: (v, row) => {
                        const b = document.createElement('button');
                        b.textContent = '定位';
                        b.title = '打开其所在目录并选中';
                        b.addEventListener('click', async () => {
                            p.close();
                            await finder.locate(row);
                        });
                        return b;
                    } },
                ], rows, { selectable: true, maxHeight: '46vh', onSelectionChange: (rs) => { picked = rs; } });
                listBox.appendChild(tb.el);

                const mkAct = (label, cls, fn) => {
                    const b = document.createElement('button');
                    b.textContent = label;
                    if (cls) b.className = cls;
                    b.addEventListener('click', fn);
                    acts.appendChild(b);
                    return b;
                };
                mkAct('下载选中', '', () => {
                    const list = target().filter((x) => !x.dir);
                    if (!list.length) return ui.toast('没有可下载的文件（文件夹需先定位后处理）', 'warn');
                    downloader.downloadSelection(list);
                });
                mkAct('移动到...', '', async () => {
                    const list = target();
                    if (!list.length) return ui.toast(t('noSelection'), 'warn');
                    const to = await picker.chooseFolder('移动到哪个文件夹');
                    if (to === null) return;
                    try {
                        const plan = await conflict.resolve(to, list, { label: '移动（搜索结果）' });
                        if (plan.action === 'abort') return;
                        if (plan.needRename.length) {
                            await api.renameMany(plan.needRename.map((r) => ({ fid: r.fid, file_name: r.file_name })));
                        }
                        const fids = plan.toMove.map((x) => x.fid);
                        if (!fids.length) return ui.toast('全部项目因同名被跳过', 'warn');
                        await api.move(fids, to);
                        opLog.push({
                            type: 'move',
                            label: '搜索结果移动',
                            entries: plan.toMove.map((x) => ({ fid: x.fid, name: (x.item || {}).name || '', pdir: (x.item || {}).pdir_fid, toPdir: to })),
                            note: plan.skipped.length ? `跳过 ${plan.skipped.length} 个同名项` : '',
                        });
                        ui.toast(`已移动 ${fids.length} 项`);
                        p.close();
                    } catch (e) { ui.toast('移动失败：' + e.message, 'error'); }
                });
                mkAct('删除（可撤销）', 'danger', async () => {
                    const list = target();
                    if (!list.length) return ui.toast(t('noSelection'), 'warn');
                    const ok = await ui.confirm(`将把 ${list.length} 个项目移入回收站，可稍后撤销。是否继续？`, { danger: true, okText: '移入回收站' });
                    if (!ok) return;
                    const pr = ui.progress('删除中');
                    try {
                        const n = await deleteWithUndo(list, { label: '搜索结果删除', onProgress: (d, tt) => pr.set(d / tt, `已删除 ${d} / ${tt}`) });
                        pr.close();
                        toastDeleted(n, `已移入回收站 ${n} 项，可通过 Alt+Z 撤销`);
                        p.close();
                    } catch (e) { pr.close(); ui.toast('删除失败：' + e.message, 'error'); }
                });
                mkAct('复制名称清单', '', () => {
                    const list = target();
                    util.copy(list.map((x) => x.name).join('\n'), `已复制 ${list.length} 条`);
                });
            };

            goBtn.addEventListener('click', run);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); run(); }
            });
            if (initial) run();
            else setTimeout(() => input.focus(), 30);
        },
    };

    /* ======================================================================
     * 6.14 失败账本（批量操作的失败明细与重试）
     *      批量操作此前只弹一个「失败 N 项」的 toast：N=12 时用户既不知道
     *      是哪 12 个、也不知道为什么失败，等于无从补救。这里把失败项落账，
     *      可看明细、可一键重试、可导出清单。与 opLog（成功侧）互补。
     *      约定：成功项一律进 opLog（可撤销），失败项一律进 failLog（可重试）。
     * ==================================================================== */

    const FAIL_ACTION_LABEL = { rename: '重命名', move: '移动', delete: '删除', manual: '需手动处理' };

    const failLog = {
        KEY: 'qem_fail_log_v1',
        MAX_BATCH: 30,        // 最多保留多少个批次
        MAX_ITEMS: 1000,      // 单批最多记多少条（防止超大失败撑爆存储）
        RETRYABLE: ['rename', 'move', 'delete'],

        list() {
            try {
                const raw = localStorage.getItem(this.KEY);
                const arr = raw ? JSON.parse(raw) : [];
                return Array.isArray(arr) ? arr : [];
            } catch (e) { return []; }
        },

        persist(arr) {
            try {
                localStorage.setItem(this.KEY, JSON.stringify((arr || []).slice(0, this.MAX_BATCH)));
            } catch (e) { /* 配额满则放弃持久化，不影响本次会话内的记录 */ }
        },

        get(id) { return this.list().find((b) => b.id === id) || null; },
        batchCount() { return this.list().length; },
        itemCount() { return this.list().reduce((s, b) => s + ((b.items && b.items.length) || 0), 0); },
        remove(id) { this.persist(this.list().filter((b) => b.id !== id)); },
        clear() { this.persist([]); },

        /**
         * 记录一批失败。
         * @param action    rename / move / delete / manual（决定能否重试）
         * @param items     [{ fid, name, error, file_name?, size?, pdir? }]
         * @param meta      重试所需上下文，如 { toPdir }
         */
        push({ action = 'manual', label = '', items = [], note = '', meta = {}, retryable = null } = {}) {
            const clean = (items || [])
                .filter((i) => i && (i.fid || i.name))
                .map((i) => ({
                    fid: i.fid || '',
                    name: i.name || i.file_name || '',
                    error: i.error || '未知错误',
                    file_name: i.file_name || '',
                    size: Number(i.size || 0),
                    pdir: i.pdir || '',
                }));
            if (!clean.length) return null;

            const capped = clean.slice(0, this.MAX_ITEMS);
            const tail = clean.length > capped.length ? `另有 ${clean.length - capped.length} 项未记录（超出单批上限）` : '';
            const batch = {
                id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                at: Date.now(),
                action,
                label,
                items: capped,
                note: [note, tail].filter(Boolean).join('　'),
                retryable: retryable === null ? this.RETRYABLE.includes(action) : !!retryable,
                meta,
            };
            const arr = this.list();
            arr.unshift(batch);
            this.persist(arr);
            if (workspace.syncFoot) workspace.syncFoot();   // 立即刷新底部失败指示
            return batch;
        },

        /** 重试一个批次：按 action 分派，成功后自动收敛该批次 */
        async retry(id) {
            const b = this.get(id);
            if (!b) return ui.toast('该批次已不存在', 'warn');
            if (!b.retryable) return ui.toast('该批次不支持自动重试，请按明细手动处理', 'warn', 4500);

            if (b.action === 'delete') {
                // 复用统一删除入口：成功的进撤销栈，仍失败的部分会被自动重新记账
                const n = await deleteWithUndo(
                    b.items.map((i) => ({ fid: i.fid, name: i.name, size: i.size, pdir_fid: i.pdir })),
                    { label: '重试删除', skipStaleCheck: true },
                );
                if (n) this.remove(id);
                if (workspace.render) workspace.render();
                return n;
            }

            const pr = ui.progress('重试中');
            try {
                if (b.action === 'rename') {
                    const pairs = b.items.filter((i) => i.file_name).map((i) => ({ fid: i.fid, file_name: i.file_name }));
                    if (!pairs.length) { pr.close(); return ui.toast('该批次缺少重命名参数，无法自动重试', 'warn'); }
                    const fails = await api.renameMany(pairs, (d, tt) => pr.set(d / tt, `已重试 ${d} / ${tt}`));
                    pr.close();
                    const failMap = new Map(fails.map((f) => [f.fid, f.error]));
                    this._settle(b, b.items.filter((i) => failMap.has(i.fid)).map((i) => ({ ...i, error: failMap.get(i.fid) })));
                } else if (b.action === 'move') {
                    const to = b.meta && b.meta.toPdir;
                    if (!to) { pr.close(); return ui.toast('该批次缺少目标目录，无法自动重试', 'warn'); }
                    const fids = b.items.map((i) => i.fid).filter(Boolean);
                    try {
                        await api.move(fids, to);
                        pr.close();
                        this._settle(b, []);
                    } catch (e) {
                        pr.close();
                        this._settle(b, b.items.map((i) => ({ ...i, error: e.message })));
                    }
                } else {
                    pr.close();
                    ui.toast('该批次不支持自动重试', 'warn');
                }
            } catch (e) {
                pr.close();
                ui.toast('重试失败：' + e.message, 'error');
            }
        },

        /** 重试后收敛：全成功则移除批次，仍有失败则更新为剩余项 */
        _settle(batch, rest) {
            if (!rest.length) {
                this.remove(batch.id);
                ui.toast('重试成功，该批次已从失败记录移除');
            } else {
                const arr = this.list();
                const idx = arr.findIndex((x) => x.id === batch.id);
                if (idx >= 0) {
                    arr[idx] = { ...arr[idx], at: Date.now(), items: rest.slice(0, this.MAX_ITEMS), note: `重试后仍剩 ${rest.length} 项失败` };
                    this.persist(arr);
                }
                ui.toast(`重试完成，仍剩 ${rest.length} 项失败`, 'warn', 4500);
            }
            if (workspace.syncFoot) workspace.syncFoot();
        },

        /** 批次列表面板 */
        open() {
            const p = ui.panel({ title: '失败记录', size: 'lg', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
            const tip = document.createElement('div');
            tip.className = 'muted';
            const listBox = document.createElement('div');
            listBox.className = 'qem-content';
            listBox.style.marginTop = '10px';
            const acts = document.createElement('div');
            acts.className = 'row';
            acts.style.marginTop = '10px';
            acts.style.flexWrap = 'wrap';
            p.body.append(tip, listBox, acts);

            const render = () => {
                const arr = this.list();
                tip.textContent = arr.length
                    ? `共 ${arr.length} 个批次、${this.itemCount()} 项失败。失败项不进「操作历史」，成功部分仍可正常撤销。`
                    : '没有失败记录。批量操作中若有项目失败，会记录在这里（含错误原因），可一键重试。';
                listBox.innerHTML = '';
                acts.innerHTML = '';
                if (!arr.length) {
                    const e = document.createElement('div');
                    e.className = 'qem-empty';
                    e.textContent = '暂无失败记录';
                    listBox.appendChild(e);
                    return;
                }

                const rows = arr.map((b) => ({
                    ...b,
                    timeText: util.ts(b.at),
                    actionText: FAIL_ACTION_LABEL[b.action] || b.action,
                    countText: b.items.length,
                    firstErr: (b.items[0] && b.items[0].error) || '',
                }));
                const tb = ui.table([
                    { key: 'timeText', label: '时间' },
                    { key: 'actionText', label: '操作' },
                    { key: 'countText', label: '失败项', align: 'right' },
                    { key: 'firstErr', label: '首个错误', render: (v) => `<span class="muted">${util.escapeHtml(v)}</span>` },
                    { key: 'act', label: '操作', render: (v, row) => {
                        const box = document.createElement('div');
                        box.className = 'row';
                        const detail = document.createElement('button');
                        detail.textContent = '明细';
                        detail.addEventListener('click', () => failLog.showBatch(row.id));
                        const retry = document.createElement('button');
                        retry.textContent = '重试';
                        retry.className = 'primary';
                        retry.disabled = !row.retryable;
                        retry.title = row.retryable ? '按同一参数重试仍失败的项' : '该批次不支持自动重试';
                        retry.addEventListener('click', async () => {
                            retry.disabled = true;
                            await failLog.retry(row.id);
                            render();
                            if (state.ui && state.ui.el && state.ui.el.isConnected) workspace.render();
                        });
                        const del = document.createElement('button');
                        del.className = 'danger';
                        del.textContent = '移除';
                        del.title = '仅移除这条记录，不影响网盘文件';
                        del.addEventListener('click', () => { failLog.remove(row.id); render(); });
                        box.append(detail, retry, del);
                        return box;
                    } },
                ], rows, { maxHeight: '48vh' });
                listBox.appendChild(tb.el);

                const mk = (label, cls, fn) => {
                    const b = document.createElement('button');
                    b.textContent = label;
                    if (cls) b.className = cls;
                    b.addEventListener('click', fn);
                    acts.appendChild(b);
                    return b;
                };
                mk('导出全部明细', '', () => this.exportAll());
                mk('清空记录', 'danger', async () => {
                    const ok = await ui.confirm('清空全部失败记录？仅清除记录，不影响网盘中的文件。', { danger: true, okText: '清空' });
                    if (!ok) return;
                    this.clear();
                    render();
                    if (workspace.syncFoot) workspace.syncFoot();
                });
            };

            render();
        },

        /** 单批明细面板 */
        showBatch(id) {
            const b = this.get(id);
            if (!b) return ui.toast('该批次已不存在', 'warn');
            const p = ui.panel({
                title: `失败明细 · ${FAIL_ACTION_LABEL[b.action] || b.action}`, size: 'lg',
                buttons: [{ label: t('close'), onClick: (a) => a.close() }],
            });
            const tip = document.createElement('div');
            tip.className = 'muted';
            tip.textContent = `${util.ts(b.at)}　·　${b.items.length} 项失败`
                + (b.note ? `　·　${b.note}` : '')
                + (b.retryable ? '' : '　·　该批次不支持自动重试，请手动处理');
            const listBox = document.createElement('div');
            listBox.className = 'qem-content';
            listBox.style.marginTop = '10px';
            const acts = document.createElement('div');
            acts.className = 'row';
            acts.style.marginTop = '10px';
            acts.style.flexWrap = 'wrap';

            let picked = [];
            const tb = ui.table([
                { key: 'name', label: '名称', render: (v, row) => util.escapeHtml(v || row.fid) },
                { key: 'error', label: '失败原因', render: (v) => `<span class="muted">${util.escapeHtml(v || '')}</span>` },
            ], b.items, { maxHeight: '46vh', selectable: true, onSelectionChange: (rs) => { picked = rs; } });
            listBox.appendChild(tb.el);

            const mk = (label, cls, fn, disabled = false) => {
                const btn = document.createElement('button');
                btn.textContent = label;
                if (cls) btn.className = cls;
                btn.disabled = disabled;
                btn.addEventListener('click', fn);
                acts.appendChild(btn);
                return btn;
            };
            mk('重试本批', 'primary', async () => {
                await failLog.retry(b.id);
                p.close();
                failLog.open();
            }, !b.retryable);
            mk('复制清单', '', () => {
                const list = picked.length ? picked : b.items;
                util.copy(list.map((i) => ((i.name || i.fid) + '\t' + (i.error || ''))).join('\n'), `已复制 ${list.length} 条`);
            });
            mk('导出明细', '', () => {
                const list = picked.length ? picked : b.items;
                const text = list.map((i) => `${i.name || i.fid}\t${i.error || ''}`).join('\n');
                util.saveTextFile(`失败明细_${new Date().toISOString().slice(0, 10)}.txt`, text, 'text/plain');
            });
            p.body.append(tip, listBox, acts);
        },

        /** 导出全部批次为纯文本（按批次分组，便于对照处理） */
        exportAll() {
            const arr = this.list();
            if (!arr.length) return ui.toast('没有可导出的记录', 'warn');
            const lines = [];
            arr.forEach((b) => {
                lines.push(`# ${util.ts(b.at)}　${FAIL_ACTION_LABEL[b.action] || b.action}　${b.items.length} 项失败${b.note ? '　' + b.note : ''}`);
                b.items.forEach((i) => lines.push(`  - ${i.name || i.fid}\t${i.error || ''}`));
                lines.push('');
            });
            util.saveTextFile(`失败记录_${new Date().toISOString().slice(0, 10)}.txt`, lines.join('\n'), 'text/plain');
        },
    };

    /* ======================================================================
     * 7. 运行态（当前目录 / 选中项 / 剪贴板）
     * ==================================================================== */

    const state = {
        cwd: ROOT_FID,
        path: [{ fid: ROOT_FID, name: '我的网盘' }],
        items: [],
        loading: false,
        selection: new Set(),
        clipboard: { mode: null, items: [] },
        stale: null,          // { at, reason } —— 目录列表降级为缓存时置位
        ui: null,             // 工作台面板引用
        table: null,
        query: '',            // 当前目录筛选串
        cursor: -1,           // 键盘游标行（可见列表索引）
        anchor: null,         // Shift 连选的锚点
    };

    const sel = {
        get() { return Array.from(state.selection); },
        items() { return state.items.filter((i) => state.selection.has(i.fid)); },
        count() { return state.selection.size; },
        has(fid) { return state.selection.has(fid); },
        toggle(fid) { if (state.selection.has(fid)) state.selection.delete(fid); else state.selection.add(fid); },
        set(fids) { state.selection = new Set(fids || []); },
        add(fids) { (fids || []).forEach((f) => state.selection.add(f)); },
        clear() { state.selection.clear(); },
        all() { state.selection = new Set(state.items.map((i) => i.fid)); },
        invert() {
            const next = new Set();
            state.items.forEach((i) => { if (!state.selection.has(i.fid)) next.add(i.fid); });
            state.selection = next;
        },
    };

    /* ======================================================================
     * 8. 工作台（自绘文件浏览器）
     *    交互逻辑对齐原版：面板常驻 → 多选 → 快捷键驱动批量操作
     * ==================================================================== */

    const workspace = {
        /** 由 render 阶段覆盖：刷新底部选中状态栏 */
        syncFoot: () => { },
        /** 由 open 阶段覆盖：写入 / 聚焦筛选框 */
        setQuery: null,
        focusSearch: null,

        async open() {
            if (state.ui && state.ui.el && state.ui.el.isConnected) return;
            const p = ui.panel({
                title: t('appTitle') + ' · ' + t('navPanel'),
                size: 'lg',
                buttons: [
                    { label: '⚙ ' + t('navSettings'), onClick: () => settings.open() },
                    { label: t('close'), onClick: (api) => api.close() },
                ],
                onClose: () => { state.ui = null; state.table = null; },
            });
            state.ui = p;
            // 每次打开都从干净状态开始，避免上次的筛选让人误以为文件没了
            state.query = '';
            state.cursor = -1;
            state.anchor = null;

            // 面包屑 + 搜索条 + 工具栏（三段式，区域边界清晰）
            const bar = document.createElement('div');
            bar.className = 'col';
            bar.style.marginBottom = '10px';
            const crumb = document.createElement('div');
            crumb.className = 'qem-crumb';

            // 搜索条：输入即筛（纯本地，不发请求）；回车走全盘搜索
            const searchBar = document.createElement('div');
            searchBar.className = 'qem-search';
            const sBox = document.createElement('div');
            sBox.className = 'box';
            const sIco = document.createElement('span');
            sIco.className = 'ico';
            sIco.textContent = '🔎';
            const sInput = document.createElement('input');
            sInput.type = 'text';
            sInput.placeholder = '筛选当前目录：空格=且　-排除　"词组"　ext:mkv　type:视频　size:>1gb　/正则/';
            sInput.value = state.query || '';
            sInput.title = 'Ctrl+F 聚焦本框；回车改为全盘搜索';
            const sClr = document.createElement('button');
            sClr.className = 'clr' + (state.query ? ' on' : '');
            sClr.textContent = '✕';
            sClr.title = '清除筛选（Esc）';
            sBox.append(sIco, sInput, sClr);
            const sStat = document.createElement('span');
            sStat.className = 'stat';
            const sHint = document.createElement('span');
            sHint.className = 'hint';
            sHint.textContent = '回车 = 全盘搜索';
            const sGlobal = document.createElement('button');
            sGlobal.textContent = '全盘搜索';
            sGlobal.title = '跨目录按文件名搜索（不限于当前目录）';
            searchBar.append(sBox, sStat, sHint, sGlobal);

            let sTimer = 0;
            workspace.setQuery = (v) => {
                sInput.value = v;
                state.query = v;
                sClr.classList.toggle('on', !!v);
            };
            workspace.focusSearch = () => { sInput.focus(); sInput.select(); };
            const applyQuery = (v) => {
                state.query = v;
                sClr.classList.toggle('on', !!v);
                state.cursor = -1;
                state.anchor = null;
                if (sTimer) clearTimeout(sTimer);
                sTimer = setTimeout(() => {
                    sTimer = 0;
                    if (state.ui && state.ui.el && state.ui.el.isConnected) workspace.render();
                }, 120);   // 输入去抖
            };
            sInput.addEventListener('input', () => applyQuery(sInput.value));
            sInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const q = sInput.value.trim();
                    if (q) finder.openGlobal(q);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    sInput.value = '';
                    applyQuery('');
                    sInput.blur();
                }
            });
            sClr.addEventListener('click', () => { sInput.value = ''; applyQuery(''); sInput.focus(); });
            sGlobal.addEventListener('click', () => {
                const q = (sInput.value || '').trim();
                if (!q) { sInput.focus(); return ui.toast('先在筛选框输入关键词', 'warn'); }
                // 结构化条件（ext: / type: / size: / -排除）只对本地筛选有效，传服务端只带关键词
                const kw = finder.parse(q).words.join(' ');
                if (!kw) return ui.toast('全盘搜索至少需要一个文件名关键词', 'warn', 4500);
                finder.openGlobal(kw);
            });

            const tools = document.createElement('div');
            tools.className = 'qem-toolbar';
            bar.append(crumb, searchBar, tools);
            p.body.appendChild(bar);

            const listBox = document.createElement('div');
            listBox.className = 'qem-content';
            p.body.appendChild(listBox);

            const footInfo = document.createElement('div');
            footInfo.className = 'muted';
            footInfo.style.marginRight = 'auto';
            p.foot.prepend(footInfo);

            // 失败记录入口：仅在存在失败时出现，避免常驻噪音
            const failBtn = document.createElement('button');
            failBtn.className = 'danger';
            failBtn.style.display = 'none';
            failBtn.title = '查看批量操作中失败的条目与原因，可一键重试';
            failBtn.addEventListener('click', () => failLog.open());
            p.foot.insertBefore(failBtn, footInfo.nextSibling);

            const render = () => {
                const vp = viewPref.get(state.cwd);
                // 面包屑
                crumb.innerHTML = '';
                state.path.forEach((seg, i) => {
                    if (i > 0) {
                        const s = document.createElement('span');
                        s.className = 'sep';
                        s.textContent = '›';
                        crumb.appendChild(s);
                    }
                    const b = document.createElement('button');
                    b.textContent = seg.name;
                    b.addEventListener('click', () => workspace.navTo(i));
                    crumb.appendChild(b);
                });
                // 工具按钮
                tools.innerHTML = '';
                const mk = (label, fn, cls, tip) => {
                    const b = document.createElement('button');
                    b.textContent = label;
                    if (cls) b.className = cls;
                    if (tip) b.title = tip;
                    b.addEventListener('click', fn);
                    tools.appendChild(b);
                    return b;
                };
                // 功能分组分隔线，让 20+ 个入口在视觉上分区
                const sep = () => {
                    if (!tools.lastElementChild) return;                       // 首个分组前不画
                    if (tools.lastElementChild.className === 'qem-sep') return;  // 避免连排
                    const d = document.createElement('span');
                    d.className = 'qem-sep';
                    tools.appendChild(d);
                };
                // ① 目录
                mk('⟳ ' + t('refresh'), () => workspace.reload());
                mk('📁 ' + t('btnNewFolder'), () => workspace.newFolder());
                sep();
                // ② 文件操作
                mk('✏️ ' + t('btnRename'), () => renameTool.open());
                mk('📥 ' + t('btnDownload'), () => downloader.downloadSelection());
                mk('🔗 ' + t('btnDirect'), () => downloader.exportDirectLinks());
                mk('✂️ ' + t('btnMove'), () => workspace.moveSelection());
                mk('🗑 ' + t('btnDelete'), () => workspace.deleteSelection(), 'danger');
                sep();
                // ③ 分析与清理
                mk('🔍 ' + t('btnInsight'), () => insight.open());
                mk('🧬 ' + t('btnDedup'), () => dedup.openFiles());
                mk('🔤 ' + t('btnFolderDedup'), () => dedup.openFolders());
                mk('🧹 ' + t('btnClean'), () => cleanup.open());
                sep();
                // ④ 导出与检索
                mk('🌲 ' + t('btnTree'), () => exporter.tree());
                mk('🎵 ' + t('btnM3u'), () => exporter.m3u());
                mk('📄 ' + t('btnMagnet'), () => exporter.magnet());
                mk('📊 ' + t('btnCsv'), () => exporter.csv());
                mk('🖼 ' + t('btnImgSearch'), () => imgSearch.open());
                sep();
                // ⑤ 分享与回收站
                mk('🔗 ' + t('btnShare'), () => shareTool.create());
                mk('🧩 ' + t('btnShareParse'), () => shareTool.parse());
                mk('♻️ ' + t('btnTrash'), () => trash.open());
                sep();
                // ⑥ 可恢复性与视图
                mk('↩ ' + t('btnUndo'), () => workspace.undoLatest());
                mk('🕘 ' + t('btnHistory'), () => opLog.open());
                mk('🧾 ' + t('btnSnapshot'), () => snapshot.open());
                mk('📊 ' + t('btnSpace'), () => spaceReport.open());
                mk('⇕ ' + viewPref.LABEL[vp.density], () => {
                    viewPref.set(state.cwd, { density: viewPref.nextDensity(vp.density) });
                    workspace.render();
                }, '', `行密度：${viewPref.LABEL[vp.density]}（按目录记忆，点击切换）`);
                mk((vp.thumb ? '🔲' : '⬜') + ' 缩略图', () => {
                    viewPref.set(state.cwd, { thumb: !vp.thumb });
                    workspace.render();
                }, '', `缩略图：${vp.thumb ? '已开启' : '已关闭'}（按目录记忆，点击切换）`);

                // 列表
                listBox.innerHTML = '';
                searchBar.classList.toggle('on', !!state.query);
                if (state.loading) {
                    sStat.textContent = '';
                    sHint.textContent = '回车 = 全盘搜索';
                    listBox.innerHTML = '<div class="qem-empty">' + t('loading') + '</div>';
                    return;
                }
                if (!state.items.length) {
                    sStat.textContent = '';
                    sHint.textContent = '回车 = 全盘搜索';
                    listBox.innerHTML = '<div class="qem-empty">' + t('empty') + '</div>';
                    return;
                }
                // 排序 → 筛选；筛选期间的选中集只允许包含可见项
                const filtered = finder.filter(workspace.sortedItems(), state.query);
                const shown = filtered.items;
                if (filtered.active && state.selection.size) {
                    const visibleFids = new Set(shown.map((i) => i.fid));
                    Array.from(state.selection).forEach((fid) => { if (!visibleFids.has(fid)) state.selection.delete(fid); });
                }
                if (filtered.active) {
                    sStat.textContent = `筛选 ${shown.length} / ${state.items.length}`;
                    sHint.textContent = finder.describe(filtered.parsed) || '回车 = 全盘搜索';
                    if (!shown.length) {
                        const eb = document.createElement('div');
                        eb.className = 'qem-empty';
                        const line = document.createElement('div');
                        line.textContent = `没有匹配「${state.query}」的项目`;
                        const clrBtn = document.createElement('button');
                        clrBtn.textContent = '清除筛选';
                        clrBtn.style.marginTop = '10px';
                        clrBtn.addEventListener('click', () => { sInput.value = ''; applyQuery(''); });
                        eb.append(line, clrBtn);
                        listBox.appendChild(eb);
                        workspace.syncFoot();
                        return;
                    }
                } else {
                    sStat.textContent = '';
                    sHint.textContent = '回车 = 全盘搜索';
                }
                const sPref = config.get('sortPref', {})[state.cwd] || { key: 'updated_at', order: 'desc' };
                // 图标元素（缩略图加载失败时回退到它）
                const iconOf = (row) => {
                    const ic = document.createElement('span');
                    ic.textContent = (CATEGORY[row.category] || CATEGORY.other).icon;
                    return ic;
                };
                state.table = ui.table([
                    { key: 'name', label: '名称', render: (v, row) => {
                        const box = document.createElement('div');
                        box.className = 'name';
                        if (viewPref.shouldThumb(row, vp)) {
                            const img = document.createElement('img');
                            img.className = 'qem-thumb';
                            img.loading = 'lazy';
                            img.alt = '';
                            img.src = row.thumbnail;
                            img.addEventListener('error', () => { img.replaceWith(iconOf(row)); }, { once: true });
                            box.appendChild(img);
                        } else {
                            box.appendChild(iconOf(row));
                        }
                        const tx = document.createElement('span');
                        tx.className = 'txt';
                        tx.title = v;
                        // 有筛选时高亮命中片段（highlight 内部逐段转义，可安全用作 HTML）
                        if (filtered.active) tx.innerHTML = finder.highlight(v, filtered.parsed);
                        else tx.textContent = v;
                        box.appendChild(tx);
                        return box;
                    } },
                    { key: 'size', label: '大小/数量', align: 'right', render: (v, row) => row.dir ? `${row.include_items || 0} 项` : util.humanSize(v) },
                    { key: 'category', label: '类型', render: (v, row) => `<span class="qem-tag">${util.escapeHtml((CATEGORY[v] || CATEGORY.other).label)}${row.ext ? ' · ' + util.escapeHtml(row.ext) : ''}</span>` },
                    { key: 'updated_at', label: '修改时间', render: (v) => util.escapeHtml(util.ts(v)) },
                ], shown, {
                    selectable: true,
                    onSelectionChange: (rows) => { sel.set(rows.map((r) => r.fid)); workspace.syncFoot(); },
                    maxHeight: 'calc(92vh - 300px)',
                    density: vp.density,
                    sortKey: sPref.key,
                    sortOrder: sPref.order,
                    onSort: (key, order) => {
                        const pref = { ...config.get('sortPref', {}) };
                        pref[state.cwd] = { key, order };
                        config.set('sortPref', pref);
                        workspace.render();
                    },
                });
                listBox.appendChild(state.table.el);

                // 行交互：单击选中、双击进入/预览
                const trs = state.table.el.querySelectorAll('tbody tr');
                trs.forEach((tr, idx) => {
                    const item = shown[idx];
                    tr.classList.toggle('sel', sel.has(item.fid));
                    const cb = tr.querySelector('input[type=checkbox]');
                    if (cb) cb.checked = sel.has(item.fid);
                    const toggle = () => {
                        sel.toggle(item.fid);
                        const now = sel.has(item.fid);
                        tr.classList.toggle('sel', now);
                        if (cb) cb.checked = now;
                        workspace.syncFoot();
                    };
                    tr.addEventListener('click', (e) => {
                        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
                        toggle();
                    });
                    tr.addEventListener('dblclick', () => {
                        if (item.dir) workspace.enter(item);
                        else if (config.get('clickAction', 'preview') === 'preview') preview.open(item);
                        else downloader.downloadSelection([item]);
                    });
                });
                // 键盘游标行（↑↓ 导航时可见）
                if (state.cursor >= 0 && state.cursor < trs.length) trs[state.cursor].classList.add('cur');
                workspace.syncFoot();

            };

            const foot = () => {
                const undoRec = opLog.latestUndoable();
                const failCount = failLog.itemCount();
                failBtn.style.display = failCount ? '' : 'none';
                if (failCount) failBtn.textContent = `⚠ ${failCount} 项失败`;
                footInfo.textContent = t('selected', { n: sel.count() })
                    + '　|　共 ' + state.items.length + ' 项'
                    + (state.stale ? `　|　⚠️ 当前为缓存数据（${util.ts(state.stale.at)}）` : '')
                    + (undoRec ? `　|　可撤销：${undoRec.label}（${undoRec.count} 项）` : '');
            };
            workspace.syncFoot = foot;

            workspace.render = render;
            await workspace.reload();
            // 回收站临期静默检查（每次打开工作台一次）
            trash.autoCheck();
        },

        /** 当前排序偏好下的列表 */
        sortedItems() {
            const pref = config.get('sortPref', {})[state.cwd] || { key: 'updated_at', order: 'desc' };
            return fileModel.sort(state.items, pref.key, pref.order);
        },

        /** 当前筛选 + 排序后的可见项（批量操作与快捷键都以此为准） */
        visible() {
            return finder.filter(workspace.sortedItems(), state.query).items;
        },

        /** 键盘导航：移动游标；extend 时按锚点区间选中 */
        moveCursor(delta, { extend = false, absolute = null } = {}) {
            const shown = workspace.visible();
            if (!shown.length) return;
            const max = shown.length - 1;
            let next;
            if (absolute === 'home') next = 0;
            else if (absolute === 'end') next = max;
            else if (typeof absolute === 'number') next = absolute;
            else next = state.cursor < 0 ? (delta > 0 ? 0 : max) : state.cursor + delta;
            next = Math.max(0, Math.min(max, next));

            if (extend) {
                if (state.anchor === null || state.anchor === undefined) state.anchor = state.cursor < 0 ? next : state.cursor;
                const lo = Math.min(state.anchor, next);
                const hi = Math.max(state.anchor, next);
                state.selection = new Set(shown.slice(lo, hi + 1).map((i) => i.fid));
            } else {
                state.anchor = next;
                state.selection = new Set([shown[next].fid]);
            }
            state.cursor = next;
            workspace.render();

            const trs = state.table ? state.table.el.querySelectorAll('tbody tr') : [];
            const tr = trs[next];
            if (tr && typeof tr.scrollIntoView === 'function') {
                try { tr.scrollIntoView({ block: 'nearest' }); } catch (e) { /* jsdom 无布局，忽略 */ }
            }
        },

        /** 回车：目录进入 / 文件按配置预览或下载 */
        openItem(index = state.cursor) {
            const item = workspace.visible()[index];
            if (!item) return;
            if (item.dir) return workspace.enter(item);
            if (config.get('clickAction', 'preview') === 'preview') return preview.open(item);
            return downloader.downloadSelection([item]);
        },

        /** 清空筛选（Esc / 空态按钮 / 跳转定位时调用） */
        clearQuery() {
            if (workspace.setQuery) workspace.setQuery('');
            state.query = '';
            state.cursor = -1;
            state.anchor = null;
            if (workspace.render) workspace.render();
        },

        async reload(pdir = null) {
            if (pdir !== null) state.cwd = pdir;
            state.loading = true;
            state.stale = null;
            state.cursor = -1;
            state.anchor = null;
            sel.clear();
            if (workspace.render) workspace.render();
            try {
                const r = await api.listAll(state.cwd, { max: 4000, onProgress: (n, total) => {
                    if (workspace.render) workspace.render();
                } });
                state.items = r.items;
                // 成功后刷新本地索引，作为后续请求失败时的降级数据
                indexCache.write(state.cwd, r.items);
                finder.invalidateIndex();
            } catch (e) {
                // 缓存列表保护：接口异常时不让列表变空，避免用户误判为文件丢失
                const cached = indexCache.read(state.cwd);
                if (cached && cached.items.length) {
                    state.items = cached.items;
                    state.stale = { at: cached.at, reason: e.message };
                    ui.toast(`目录加载失败（${e.message}），已切换为本地缓存数据（${util.ts(cached.at)}）`, 'warn', 6000);
                } else {
                    ui.toast('目录加载失败：' + e.message, 'error', 6000);
                    state.items = [];
                }
            } finally {
                state.loading = false;
                if (workspace.render) workspace.render();
            }
        },

        async enter(item) {
            state.path.push({ fid: item.fid, name: item.name });
            await workspace.reload(item.fid);
        },

        async navTo(index) {
            const seg = state.path[index];
            if (!seg) return;
            state.path = state.path.slice(0, index + 1);
            await workspace.reload(seg.fid);
        },

        async goUp() {
            if (state.path.length > 1) await workspace.navTo(state.path.length - 2);
        },

        async newFolder() {
            const name = await ui.prompt('请输入新文件夹名称：', { value: '新建文件夹' });
            if (!name) return;
            try {
                await api.mkdir(state.cwd, name);
                ui.toast('文件夹已创建');
                await workspace.reload();
            } catch (e) { ui.toast('创建失败：' + e.message, 'error'); }
        },

        async deleteSelection() {
            const items = sel.items();
            if (!items.length) return ui.toast(t('noSelection'), 'warn');
            const ok = await ui.confirm(`将把 ${items.length} 个项目移入回收站，可稍后还原。是否继续？`, { danger: true, okText: '移入回收站' });
            if (!ok) return;
            const pr = ui.progress('删除中');
            try {
                const n = await deleteWithUndo(items, { label: '批量删除', onProgress: (d, tt) => pr.set(d / tt, `已删除 ${d} / ${tt}`) });
                pr.close();
                toastDeleted(n, `已移入回收站 ${n} 项，可通过 Alt+Z 撤销`);
                await workspace.reload();
            } catch (e) { pr.close(); ui.toast('删除失败：' + e.message, 'error'); }
        },

        async moveSelection() {
            const items = sel.items();
            if (!items.length) return ui.toast(t('noSelection'), 'warn');
            const target = await picker.chooseFolder('选择目标文件夹');
            if (target === null) return;
            if (target === state.cwd) return ui.toast('目标目录就是当前目录，无需移动', 'warn');
            try {
                // 同名冲突策略
                const plan = await conflict.resolve(target, items, { label: '移动' });
                if (plan.action === 'abort') return;
                let moved = 0;
                if (plan.needRename.length) {
                    await api.renameMany(plan.needRename.map((r) => ({ fid: r.fid, file_name: r.file_name })));
                }
                const fids = plan.toMove.map((x) => x.fid);
                if (fids.length) { await api.move(fids, target); moved = fids.length; }
                const skippedNames = plan.skipped.map((s) => s.name);
                opLog.push({
                    type: 'move',
                    entries: plan.toMove.map((x) => ({ fid: x.fid, name: x.item.name, pdir: x.item.pdir_fid, toPdir: target })),
                    undoable: moved > 0,
                    note: plan.skipped.length ? `已跳过 ${plan.skipped.length} 个同名项` : '',
                });
                if (!moved) {
                    ui.toast('全部项目因同名被跳过，未执行移动', 'warn', 4000);
                } else if (skippedNames.length) {
                    ui.toast(`已移动 ${moved} 项，跳过 ${skippedNames.length} 个同名项`, 'info', 4000);
                } else {
                    ui.toast(`已移动 ${moved} 项`);
                }
                await workspace.reload();
            } catch (e) { ui.toast('移动失败：' + e.message, 'error'); }
        },

        /** 撤销最近一次操作（工具栏 / 快捷键） */
        async undoLatest() {
            const rec = opLog.latestUndoable();
            if (!rec) return ui.toast('没有可撤销的操作', 'warn');
            await opLog.undo(rec.id);
        },
    };

    /* ======================================================================
     * 9. 目录选择器 / 属性 / 预览
     * ==================================================================== */

    const picker = {
        /** 弹出目录树选择器，返回 fid；取消返回 null。createNew=true 时支持新建 */
        chooseFolder(title = '选择文件夹', { createNew = false } = {}) {
            return new Promise((resolve) => {
                let cwd = ROOT_FID;
                const path = [{ fid: ROOT_FID, name: '我的网盘' }];
                let settled = false;
                const p = ui.panel({
                    title, size: 'md', closeOnMask: false,
                    buttons: [
                        { label: t('cancel'), onClick: (api) => { api.close(); } },
                        ...(createNew ? [{ label: '新建文件夹', onClick: async (api) => {
                            const name = await ui.prompt('新文件夹名称：', { value: '新建文件夹' });
                            if (!name) return;
                            try { await api.mkdir(cwd, name); list(); } catch (e) { ui.toast('创建失败：' + e.message, 'error'); }
                        } }] : []),
                        { label: '选定此文件夹', primary: true, onClick: (api) => { settled = true; api.close(); resolve(cwd); } },
                    ],
                    onClose: () => { if (!settled) resolve(null); },
                });
                const crumb = document.createElement('div');
                crumb.className = 'qem-crumb';
                crumb.style.marginBottom = '8px';
                const box = document.createElement('div');
                p.body.append(crumb, box);

                async function list() {
                    crumb.innerHTML = '';
                    path.forEach((seg, i) => {
                        if (i > 0) {
                            const s = document.createElement('span');
                            s.className = 'sep'; s.textContent = '›';
                            crumb.appendChild(s);
                        }
                        const b = document.createElement('button');
                        b.textContent = seg.name;
                        b.addEventListener('click', () => { path.length = i + 1; cwd = seg.fid; list(); });
                        crumb.appendChild(b);
                    });
                    box.innerHTML = '<div class="qem-empty">' + t('loading') + '</div>';
                    try {
                        const r = await api.listAll(cwd, { max: 2000 });
                        const dirs = r.items.filter((i) => i.dir);
                        box.innerHTML = '';
                        if (!dirs.length) { box.innerHTML = '<div class="qem-empty">没有子文件夹</div>'; return; }
                        dirs.forEach((d) => {
                            const row = document.createElement('div');
                            row.className = 'row';
                            row.style.padding = '6px 4px';
                            row.style.cursor = 'pointer';
                            row.innerHTML = `<span>📁</span><span class="grow ellipsis">${util.escapeHtml(d.name)}</span><span class="muted">${d.include_items || 0} 项</span>`;
                            row.addEventListener('click', () => { path.push({ fid: d.fid, name: d.name }); cwd = d.fid; list(); });
                            row.addEventListener('mouseenter', () => { row.style.background = 'var(--qem-bg-hover)'; });
                            row.addEventListener('mouseleave', () => { row.style.background = ''; });
                            box.appendChild(row);
                        });
                    } catch (e) {
                        box.innerHTML = '<div class="qem-empty">加载失败：' + util.escapeHtml(e.message) + '</div>';
                    }
                }
                list();
            });
        },
    };

    const preview = {
        async open(item) {
            const p = ui.panel({ title: item.name, size: 'md', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
            if (item.category === 'image') {
                const img = document.createElement('img');
                img.style.maxWidth = '100%';
                img.style.borderRadius = '8px';
                p.body.appendChild(img);
                try {
                    const [u] = await api.downloadUrls([item.fid]);
                    img.src = (u && u.url) || item.thumbnail || '';
                } catch (e) {
                    if (item.thumbnail) img.src = item.thumbnail;
                    else p.body.innerHTML = '<div class="qem-empty">无法获取预览地址</div>';
                }
            } else if (item.category === 'video' || item.category === 'audio') {
                const v = document.createElement(item.category === 'video' ? 'video' : 'audio');
                v.controls = true;
                v.style.width = '100%';
                p.body.appendChild(v);
                try {
                    const [u] = await api.downloadUrls([item.fid]);
                    if (u && u.url) v.src = u.url; else p.body.innerHTML = '<div class="qem-empty">无法获取播放地址</div>';
                } catch (e) { p.body.innerHTML = '<div class="qem-empty">无法获取播放地址</div>'; }
            } else if (item.ext === 'txt' || item.ext === 'md' || item.ext === 'srt' || item.ext === 'ass' || item.ext === 'json') {
                const pre = document.createElement('pre');
                pre.className = 'qem-mono';
                pre.style.whiteSpace = 'pre-wrap';
                pre.style.maxHeight = '60vh';
                pre.style.overflow = 'auto';
                pre.textContent = t('loading');
                p.body.appendChild(pre);
                try {
                    const [u] = await api.downloadUrls([item.fid]);
                    const res = await fetch(u.url);
                    const text = await res.text();
                    pre.textContent = text.slice(0, 400000);
                    if (text.length > 400000) ui.toast('文件过大，已截断显示', 'warn');
                    // 磁链快捷提取
                    const links = util.extractLinks(text);
                    if (links.length) {
                        const btn = document.createElement('button');
                        btn.textContent = `发现 ${links.length} 个链接，复制全部`;
                        btn.className = 'primary';
                        btn.style.marginTop = '8px';
                        btn.addEventListener('click', () => util.copy(links.join('\n'), `已复制 ${links.length} 个链接`));
                        p.body.appendChild(btn);
                    }
                } catch (e) { pre.textContent = '读取失败：' + e.message; }
            } else {
                p.body.innerHTML = '<div class="qem-empty">该类型暂不支持内置预览，可使用「下载」或「复制直链」。</div>';
            }
            const btnRow = document.createElement('div');
            btnRow.className = 'row';
            btnRow.style.marginTop = '10px';
            property.appendButtons(btnRow, item);
            p.body.appendChild(btnRow);
        },
    };

    const property = {
        open(item) {
            const p = ui.panel({ title: '文件属性', size: 'sm', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
            const rows = [
                ['文件名称', item.name],
                ['类型', (CATEGORY[item.category] || CATEGORY.other).label + (item.ext ? ` (.${item.ext})` : '')],
                ['大小', item.dir ? `${item.include_items || 0} 项` : util.humanSize(item.size)],
                ['创建时间', util.ts(item.created_at)],
                ['修改时间', util.ts(item.updated_at)],
                ['所在路径', state.path.map((s) => s.name).join(' / ')],
                ['FID', item.fid],
            ];
            const table = document.createElement('table');
            table.className = 'qem-table';
            rows.forEach(([k, v]) => {
                const tr = document.createElement('tr');
                const td1 = document.createElement('td');
                td1.style.width = '92px';
                td1.className = 'muted';
                td1.textContent = k;
                const td2 = document.createElement('td');
                td2.textContent = String(v);
                td2.style.wordBreak = 'break-all';
                tr.append(td1, td2);
                table.appendChild(tr);
            });
            const btnRow = document.createElement('div');
            btnRow.className = 'row';
            btnRow.style.marginTop = '10px';
            btnRow.style.flexWrap = 'wrap';
            property.appendButtons(btnRow, item);
            p.body.append(table, btnRow);
        },

        appendButtons(container, item) {
            const mk = (label, fn) => {
                const b = document.createElement('button');
                b.textContent = label;
                b.addEventListener('click', fn);
                container.appendChild(b);
            };
            mk('复制文件名', () => util.copy(item.name));
            mk('复制直链', async () => {
                try {
                    const [u] = await api.downloadUrls([item.fid]);
                    if (u && u.url) util.copy(u.url, '直链已复制'); else ui.toast('未获取到直链', 'error');
                } catch (e) { ui.toast('获取失败：' + e.message, 'error'); }
            });
            mk('重命名', async () => {
                const n = await ui.prompt('新名称：', { value: item.name });
                if (!n || n === item.name) return;
                try {
                    await api.rename(item.fid, n);
                    opLog.push({ type: 'rename', entries: [{ fid: item.fid, name: item.name, before: item.name, after: n }] });
                    ui.toast('已重命名');
                    await workspace.reload();
                } catch (e) { ui.toast('失败：' + e.message, 'error'); }
            });
            if (item.category === 'image' || item.category === 'video') {
                mk('以图搜图', () => imgSearch.open(item));
            }
            if (item.category === 'video' || item.category === 'audio') {
                mk('外部播放器', () => player.open(item));
            }
        },
    };

    /* ======================================================================
     * 10. 文件透视 / 筛选（客户端过滤 + 统计）
     * ==================================================================== */

    const insight = {
        filter: { kw: '', exclude: '', category: '', ext: '', minSize: '', maxSize: '', from: '', to: '', deep: false },

        open() {
            const p = ui.panel({
                title: t('btnInsight'), size: 'lg',
                buttons: [{ label: t('close'), onClick: (a) => a.close() }],
            });
            const f = ui.form([
                { key: 'kw', label: '名称包含', value: this.filter.kw, placeholder: '支持空格分隔多个关键词' },
                { key: 'exclude', label: '排除关键词', value: this.filter.exclude, placeholder: '命中任一即排除' },
                { key: 'category', label: '类型', type: 'select', value: this.filter.category, options: [{ value: '', label: '全部' }].concat(Object.keys(CATEGORY).map((k) => ({ value: k, label: CATEGORY[k].label }))) },
                { key: 'ext', label: '扩展名', value: this.filter.ext, placeholder: '如 mp4,mkv（逗号分隔）' },
                { key: 'minSize', label: '最小体积', value: this.filter.minSize, placeholder: '如 100MB / 1024' },
                { key: 'maxSize', label: '最大体积', value: this.filter.maxSize, placeholder: '留空不限' },
                { key: 'from', label: '起始日期', type: 'date', value: this.filter.from },
                { key: 'to', label: '结束日期', type: 'date', value: this.filter.to },
                { key: 'deep', label: '递归子目录', type: 'checkbox', value: this.filter.deep, hint: '开启后扫描整棵子树，数据量大时耗时较久' },
            ], () => run());

            const stat = document.createElement('div');
            stat.className = 'muted';
            const resultBox = document.createElement('div');
            resultBox.style.marginTop = '10px';
            p.body.append(f.el, stat, resultBox);

            let matched = [];

            async function buildPool() {
                if (!insight.filter.deep) return state.items;
                const pr = ui.progress('扫描子树');
                try {
                    const items = await scanner.walk(state.cwd, {
                        rootPath: state.path.map((s) => s.name).join('/'),
                        maxDepth: config.get('scan.maxDepth', 20),
                        onProgress: (n, path) => pr.set(0.5, `已扫描 ${n} 项 · ${path}`),
                    });
                    return items;
                } finally { pr.close(); }
            }

            let pool = null;
            async function run() {
                Object.assign(insight.filter, f.values);
                stat.textContent = t('working');
                // 目录或深度变了必须重扫，否则会拿上一个目录的数据出结果
                if (!pool || f.values.deep !== (insight._poolDeep || false) || insight._poolCwd !== state.cwd) {
                    pool = await buildPool();
                    insight._poolDeep = f.values.deep;
                    insight._poolCwd = state.cwd;
                }
                const kw = String(f.values.kw || '').trim().split(/\s+/).filter(Boolean);
                const ex = String(f.values.exclude || '').trim().split(/\s+/).filter(Boolean);
                const exts = String(f.values.ext || '').split(/[,，\s]+/).map((s) => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
                const min = parseSize(f.values.minSize);
                const max = parseSize(f.values.maxSize);
                const from = f.values.from ? new Date(f.values.from + 'T00:00:00').getTime() : 0;
                const to = f.values.to ? new Date(f.values.to + 'T23:59:59').getTime() : 0;

                matched = pool.filter((it) => {
                    const nm = it.name.toLowerCase();
                    if (kw.length && !kw.every((k) => nm.includes(k.toLowerCase()))) return false;
                    if (ex.length && ex.some((k) => nm.includes(k.toLowerCase()))) return false;
                    if (f.values.category && it.category !== f.values.category) return false;
                    if (exts.length && !exts.includes(it.ext)) return false;
                    if (!it.dir) {
                        if (min && it.size < min) return false;
                        if (max && it.size > max) return false;
                    }
                    const ts = it.updated_at || it.created_at;
                    if (from && ts < from) return false;
                    if (to && ts > to) return false;
                    return true;
                });

                const sum = scanner.summarize(matched);
                stat.innerHTML = `命中 <b>${sum.count}</b> 项（文件 ${sum.files} / 文件夹 ${sum.folders}），合计 <b>${util.humanSize(sum.size)}</b>`;
                resultBox.innerHTML = '';
                if (!matched.length) { resultBox.innerHTML = '<div class="qem-empty">没有符合条件的项目</div>'; return; }
                const tb = ui.table([
                    { key: 'name', label: '名称', render: (v, row) => util.escapeHtml(row.path || v) },
                    { key: 'size', label: '大小', align: 'right', render: (v, row) => row.dir ? `${row.include_items || 0} 项` : util.humanSize(v) },
                    { key: 'ext', label: '类型' },
                    { key: 'updated_at', label: '修改时间', render: (v) => util.escapeHtml(util.ts(v)) },
                ], matched, { maxHeight: '34vh' });
                resultBox.appendChild(tb.el);

                const acts = document.createElement('div');
                acts.className = 'row';
                acts.style.marginTop = '8px';
                acts.style.flexWrap = 'wrap';
                const mk = (label, fn, cls) => {
                    const b = document.createElement('button');
                    b.textContent = label;
                    if (cls) b.className = cls;
                    b.addEventListener('click', fn);
                    acts.appendChild(b);
                };
                mk('复制命中清单', () => util.copy(matched.map((m) => m.path || m.name).join('\n'), `已复制 ${matched.length} 条`));
                mk('导出 CSV', () => exporter.saveCsv('透视结果', matched));
                mk(`删除命中项（${matched.length}）`, async () => {
                    const ok = await ui.confirm(`将把命中的 ${matched.length} 个项目移入回收站，是否继续？`, { danger: true, okText: '移入回收站' });
                    if (!ok) return;
                    const pr = ui.progress('删除中');
                    try {
                        const n = await deleteWithUndo(matched, { label: '文件透视删除', onProgress: (d, tt) => pr.set(d / tt, `已删除 ${d}/${tt}`) });
                        pr.close(); toastDeleted(n, `已移入回收站 ${n} 项`);
                        pool = null; await run(); await workspace.reload();
                    } catch (e) { pr.close(); ui.toast('失败：' + e.message, 'error'); }
                }, 'danger');
                resultBox.appendChild(acts);
            }

            run();
        },
    };

    /** "100MB" / "1.5GB" / "1048576" → 字节数 */
    function parseSize(s) {
        const str = String(s ?? '').trim();
        if (!str) return 0;
        const m = /^([\d.]+)\s*([kKmMgGtT]?)[bB]?$/.exec(str);
        if (!m) return 0;
        const n = parseFloat(m[1]);
        if (!isFinite(n)) return 0;
        const unit = (m[2] || '').toUpperCase();
        const mul = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[unit] || 1;
        return Math.floor(n * mul);
    }

    /* ======================================================================
     * 11. 批量重命名（规则引擎 + 预览 + 冲突检测）
     * ==================================================================== */

    const renameRules = {
        defaults() {
            return {
                find: '', replace: '', useRegex: false, caseSensitive: false,
                prefix: '', suffix: '',
                seqEnable: false, seqStart: 1, seqStep: 1, seqPad: 2, seqPos: 'suffix', seqSep: '_',
                caseMode: 'keep',            // keep | lower | upper | title | camel
                widthMode: 'keep',           // keep | half | full
                extMode: 'keep',             // keep | lower | upper
                extReplace: '',
                trimSpace: true, stripSpecial: false, collapseSpace: true,
                sliceStart: '', sliceEnd: '',
                template: '',                // 启用模板则忽略以上部分规则
                useTemplate: false,
            };
        },

        /**
         * 对单个名称应用规则
         * @returns {string} 新文件名（含扩展名）
         */
        apply(name, index, rule) {
            const r = { ...renameRules.defaults(), ...(rule || {}) };
            if (r.useTemplate && r.template.trim()) {
                return renameRules.applyTemplate(name, index, r);
            }
            const ext = util.ext(name);
            let base = ext ? util.baseName(name) : String(name || '');

            // 1. 截取
            const s = r.sliceStart === '' ? 0 : Number(r.sliceStart);
            if (r.sliceStart !== '' || r.sliceEnd !== '') {
                const e = r.sliceEnd === '' ? undefined : Number(r.sliceEnd);
                base = base.slice(isFinite(s) ? s : 0, e);
            }
            // 2. 查找替换
            if (r.find) {
                if (r.useRegex) {
                    try { base = base.replace(new RegExp(r.find, r.caseSensitive ? 'g' : 'gi'), r.replace); } catch (e) { /* 正则非法则跳过 */ }
                } else {
                    base = base.split(r.find).join(r.replace);
                }
            }
            // 3. 清理
            if (r.collapseSpace) base = base.replace(/\s{2,}/g, ' ');
            if (r.trimSpace) base = base.replace(/^\s+|\s+$/g, '');
            if (r.stripSpecial) base = base.replace(/[^\p{L}\p{N}\s._\-()[\]()【】]/gu, '');
            // 4. 全角半角
            if (r.widthMode === 'half') base = util.toHalfWidth(base);
            else if (r.widthMode === 'full') base = util.toFullWidth(base);
            // 5. 大小写
            if (r.caseMode === 'lower') base = base.toLowerCase();
            else if (r.caseMode === 'upper') base = base.toUpperCase();
            else if (r.caseMode === 'title') base = base.replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
            else if (r.caseMode === 'camel') base = base.replace(/[\s_-]+(\p{L})/gu, (m, c) => c.toUpperCase());
            // 6. 序号
            if (r.seqEnable) {
                const n = String(r.seqStart + index * r.seqStep).padStart(Math.max(1, Number(r.seqPad) || 1), '0');
                if (r.seqPos === 'prefix') base = n + (r.seqSep || '') + base;
                else if (r.seqPos === 'both') base = n + (r.seqSep || '') + base + (r.seqSep || '') + n;
                else if (r.seqPos === 'replace') base = n;
                else base = base + (r.seqSep || '') + n;
            }
            // 7. 前后缀
            base = r.prefix + base + r.suffix;
            // 8. 扩展名
            let newExt = ext;
            if (r.extReplace) newExt = String(r.extReplace).replace(/^\./, '');
            else if (r.extMode === 'lower') newExt = ext.toLowerCase();
            else if (r.extMode === 'upper') newExt = ext.toUpperCase();
            return util.sanitizeName(newExt ? `${base}.${newExt}` : base) || name;
        },

        applyTemplate(name, index, r) {
            const ext = util.ext(name);
            const base = util.baseName(name);
            const now = new Date();
            const p = (x) => String(x).padStart(2, '0');
            const out = String(r.template)
                .replace(/\$\{name\}/g, base)
                .replace(/\$\{ext\}/g, ext)
                .replace(/\$\{n\}/g, String(r.seqStart + index * r.seqStep).padStart(Math.max(1, Number(r.seqPad) || 1), '0'))
                .replace(/\$\{date\}/g, `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`)
                .replace(/\$\{rand\}/g, util.randHex(6));
            return util.sanitizeName(out) || name;
        },
    };

    const renameTool = {
        open() {
            const items = sel.items();
            const source = items.length ? items : state.items;
            if (!source.length) return ui.toast(t('empty'), 'warn');

            const p = ui.panel({
                title: t('btnRename') + `（${source.length} 项）`,
                size: 'lg',
                buttons: [
                    { label: '重置规则', onClick: () => { renameRuleSnapshot = null; p.close(); renameTool.open(); } },
                    { label: '保存为预设', onClick: () => renameTool.savePreset() },
                    { label: '应用重命名', primary: true, onClick: () => apply() },
                    { label: t('close'), onClick: (a) => a.close() },
                ],
            });

            let rule = renameRules.defaults();
            renameRuleSnapshot = { ...rule };

            const wrap = document.createElement('div');
            wrap.className = 'col';
            const ruleBox = document.createElement('div');
            const previewBox = document.createElement('div');
            const summary = document.createElement('div');
            summary.className = 'muted';
            wrap.append(ruleBox, summary, previewBox);
            p.body.appendChild(wrap);

            const form = ui.form([
                { type: 'group', label: '① 模板模式（留空则用下方规则）', fields: [
                    { key: 'useTemplate', label: '启用模板', type: 'checkbox', value: false },
                    { key: 'template', label: '模板', placeholder: '${name}_${n}.${ext}　支持 ${name} ${ext} ${n} ${date} ${rand}' },
                ] },
                { type: 'group', label: '② 查找替换', fields: [
                    { key: 'find', label: '查找' },
                    { key: 'replace', label: '替换为' },
                    { key: 'useRegex', label: '正则', type: 'checkbox', value: false },
                    { key: 'caseSensitive', label: '区分大小写', type: 'checkbox', value: false },
                ] },
                { type: 'group', label: '③ 前后缀 / 序号', fields: [
                    { key: 'prefix', label: '前缀' },
                    { key: 'suffix', label: '后缀' },
                    { key: 'seqEnable', label: '启用序号', type: 'checkbox', value: false },
                    { key: 'seqStart', label: '起始', type: 'number', value: 1 },
                    { key: 'seqStep', label: '步长', type: 'number', value: 1 },
                    { key: 'seqPad', label: '位数', type: 'number', value: 2 },
                    { key: 'seqPos', label: '位置', type: 'select', value: 'suffix', options: [
                        { value: 'prefix', label: '前缀' }, { value: 'suffix', label: '后缀' },
                        { value: 'both', label: '前后都加' }, { value: 'replace', label: '替换整个名称' },
                    ] },
                    { key: 'seqSep', label: '分隔符', value: '_' },
                ] },
                { type: 'group', label: '④ 清理与格式', fields: [
                    { key: 'caseMode', label: '大小写', type: 'select', value: 'keep', options: [
                        { value: 'keep', label: '保持不变' }, { value: 'lower', label: '全小写' }, { value: 'upper', label: '全大写' },
                        { value: 'title', label: '首字母大写' }, { value: 'camel', label: '驼峰' },
                    ] },
                    { key: 'widthMode', label: '全半角', type: 'select', value: 'keep', options: [
                        { value: 'keep', label: '保持不变' }, { value: 'half', label: '全角转半角 Ａ→A' }, { value: 'full', label: '半角转全角 A→Ａ' },
                    ] },
                    { key: 'extMode', label: '扩展名', type: 'select', value: 'keep', options: [
                        { value: 'keep', label: '保持不变' }, { value: 'lower', label: '小写' }, { value: 'upper', label: '大写' },
                    ] },
                    { key: 'extReplace', label: '替换扩展名', placeholder: '如 mp4（留空不改）' },
                    { key: 'trimSpace', label: '去首尾空格', type: 'checkbox', value: true },
                    { key: 'collapseSpace', label: '合并连续空格', type: 'checkbox', value: true },
                    { key: 'stripSpecial', label: '去特殊符号', type: 'checkbox', value: false },
                    { key: 'sliceStart', label: '截取起', type: 'number', placeholder: '留空不限' },
                    { key: 'sliceEnd', label: '截取止', type: 'number', placeholder: '留空不限' },
                ] },
            ], () => { Object.assign(rule, form.values); renameRuleSnapshot = { ...rule }; refresh(); });

            ruleBox.appendChild(form.el);

            let plan = [];

            function buildPlan() {
                const names = source.map((it, idx) => ({ fid: it.fid, old: it.name, next: renameRules.apply(it.name, idx, rule), item: it }));
                const seen = new Map();
                names.forEach((r) => { const k = r.next.toLowerCase(); seen.set(k, (seen.get(k) || 0) + 1); });
                plan = names.map((r) => {
                    const conflicts = [];
                    if (!r.next || !r.next.trim()) conflicts.push('名称为空');
                    if (r.next === r.old) conflicts.push('无变化');
                    if (seen.get(r.next.toLowerCase()) > 1) conflicts.push('重名');
                    if (r.next.length > 220) conflicts.push('超长');
                    return { ...r, conflicts };
                });
                return plan;
            }

            function refresh() {
                const rows = buildPlan();
                const changed = rows.filter((r) => r.next !== r.old).length;
                const bad = rows.filter((r) => r.conflicts.some((c) => c === '重名' || c === '名称为空' || c === '超长')).length;
                summary.innerHTML = `共 ${rows.length} 项，将重命名 <b>${changed}</b> 项` + (bad ? `　<span class="qem-tag err">${bad} 项有冲突</span>` : '') + (bad ? '　（重名项会被自动加序号规避）' : '');
                previewBox.innerHTML = '';
                const tb = ui.table([
                    { key: 'old', label: '原名称', render: (v) => util.escapeHtml(v) },
                    { key: 'next', label: '新名称', render: (v, row) => `${util.escapeHtml(v)}${row.conflicts.length ? ` <span class="qem-tag ${row.conflicts.includes('重名') ? 'err' : 'warn'}">${row.conflicts.join('/')}</span>` : ''}` },
                ], rows.slice(0, 400), { maxHeight: '36vh' });
                previewBox.appendChild(tb.el);
                if (rows.length > 400) {
                    const tip = document.createElement('div');
                    tip.className = 'muted';
                    tip.textContent = `仅预览前 400 项，实际将处理全部 ${rows.length} 项`;
                    previewBox.appendChild(tip);
                }
            }

            async function apply() {
                const rows = buildPlan().filter((r) => r.next !== r.old);
                if (!rows.length) return ui.toast('没有需要重命名的项目', 'warn');
                // 重名自动加序号规避
                const used = new Set();
                rows.forEach((r) => {
                    let candidate = r.next;
                    let i = 1;
                    while (used.has(candidate.toLowerCase())) {
                        const ext = util.ext(candidate);
                        const base = ext ? util.baseName(candidate) : candidate;
                        candidate = `${base}_${i++}${ext ? '.' + ext : ''}`;
                    }
                    used.add(candidate.toLowerCase());
                    r.final = candidate;
                });
                const ok = await ui.confirm(`即将重命名 ${rows.length} 个项目，此操作会直接修改网盘文件名。是否继续？`);
                if (!ok) return;
                const pr = ui.progress('重命名中');
                pr.cancelBtn();
                try {
                    const fails = await api.renameMany(rows.map((r) => ({ fid: r.fid, file_name: r.final })), (d, tt) => pr.set(d / tt, `已处理 ${d} / ${tt}`));
                    const okRows = rows.filter((r) => !fails.some((f) => f.fid === r.fid));
                    if (okRows.length) {
                        opLog.push({
                            type: 'rename',
                            label: '批量重命名',
                            entries: okRows.map((r) => ({ fid: r.fid, name: r.next, before: r.old, after: r.final || r.next })),
                            note: fails.length ? `${fails.length} 项失败未记录` : '',
                        });
                    }
                    pr.close();
                    if (fails.length) {
                        failLog.push({
                            action: 'rename',
                            label: '批量重命名',
                            items: fails.map((f) => {
                                const row = rows.find((r) => r.fid === f.fid);
                                return { fid: f.fid, name: (row && row.old) || f.file_name || '', file_name: f.file_name, error: f.error };
                            }),
                            note: `${okRows.length}/${rows.length} 项已重命名`,
                        });
                    }
                    if (fails.length) {
                        ui.toast(`完成 ${rows.length - fails.length} 项，失败 ${fails.length} 项（可查看失败记录并重试）`, 'warn', 5000);
                    } else {
                        ui.toast(`已重命名 ${rows.length} 项`);
                    }
                    await workspace.reload();
                } catch (e) { pr.close(); ui.toast('重命名失败：' + e.message, 'error'); }
            }

            refresh();
        },

        async savePreset() {
            const name = await ui.prompt('预设名称：', { value: '预设' + (config.get('renamePresets', []).length + 1) });
            if (!name) return;
            const list = config.get('renamePresets', []).slice();
            list.push({ name, rule: renameRuleSnapshot || renameRules.defaults() });
            config.set('renamePresets', list);
            ui.toast('预设已保存');
        },
    };
    let renameRuleSnapshot = null;

    /* ======================================================================
     * 12. 查重（文件 / 文件夹）
     * ==================================================================== */

    /** 快速字符串哈希（FNV-1a），仅用于内容签名比较 */
    function fnv(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return h.toString(16);
    }

    const dedup = {
        /* ---------------- 文件查重 ---------------- */
        openFiles() {
            const p = ui.panel({
                title: t('btnDedup'), size: 'lg',
                buttons: [{ label: t('close'), onClick: (a) => a.close() }],
            });
            const cfgBox = document.createElement('div');
            const info = document.createElement('div');
            info.className = 'muted';
            const listBox = document.createElement('div');
            listBox.style.marginTop = '10px';
            p.body.append(cfgBox, info, listBox);

            const form = ui.form([
                { key: 'scope', label: '范围', type: 'select', value: 'current', options: [
                    { value: 'current', label: '当前目录' },
                    { value: 'selected', label: '仅选中项' },
                    { value: 'deep', label: '当前目录及子目录（慢）' },
                ] },
                { key: 'mode', label: '判重方式', type: 'select', value: 'size', options: [
                    { value: 'size', label: '同体积（快）' },
                    { value: 'fingerprint', label: '同体积 + 名称归一化（推荐）' },
                    { value: 'md5', label: '精确 MD5 比对（最准）' },
                ] },
                { key: 'minSize', label: '忽略小于', value: '0', placeholder: '如 10MB，避免误伤小文件' },
                { key: 'keep', label: '保留策略', type: 'select', value: config.get('dedup.keep', 'new'), options: [
                    { value: 'new', label: '保留最新的' }, { value: 'old', label: '保留最旧的' },
                    { value: 'large', label: '保留最大的' }, { value: 'small', label: '保留最小的' },
                    { value: 'short', label: '保留名称最短的' }, { value: 'long', label: '保留名称最长的' },
                ] },
            ]);

            const runBtn = document.createElement('button');
            runBtn.textContent = '开始扫描';
            runBtn.className = 'primary';
            cfgBox.append(form.el, runBtn);

            let groups = [];

            runBtn.addEventListener('click', async () => {
                const v = form.values;
                info.textContent = t('working');
                listBox.innerHTML = '';
                let pool = null;
                try {
                    if (v.scope === 'selected') pool = sel.items();
                    else if (v.scope === 'deep') {
                        const pr = ui.progress('扫描子树');
                        try {
                            pool = await scanner.walk(state.cwd, { onProgress: (n, path) => pr.set(0.5, `已扫描 ${n} 项 · ${path}`) });
                        } finally { pr.close(); }
                    } else pool = state.items.slice();
                } catch (e) { info.textContent = '扫描失败：' + e.message; return; }

                const minSize = parseSize(v.minSize);
                const files = pool.filter((it) => !it.dir && it.size >= minSize);
                const buckets = new Map();
                files.forEach((it) => {
                    let key;
                    if (v.mode === 'size') key = String(it.size);
                    else if (v.mode === 'fingerprint') key = it.size + '|' + util.normalizeKey(util.baseName(it.name));
                    else key = String(it.size);   // md5 模式先按体积粗筛，再精算
                    if (!buckets.has(key)) buckets.set(key, []);
                    buckets.get(key).push(it);
                });

                let candidates = Array.from(buckets.values()).filter((g) => g.length > 1);

                // 精确 MD5：对候选组取直链响应里的 md5 字段（无需下载文件）
                if (v.mode === 'md5' && candidates.length) {
                    const pr = ui.progress('精确比对');
                    try {
                        const flat = candidates.flat();
                        pr.set(0, `共 ${flat.length} 个候选，正在取指纹...`);
                        const infos = await api.downloadUrls(flat.map((x) => x.fid));
                        const md5Map = new Map(infos.map((x) => [x.fid, x.md5 || '']));
                        const refined = new Map();
                        flat.forEach((it) => {
                            const md5 = md5Map.get(it.fid);
                            if (!md5) return;                       // 服务端未返回 md5 的跳过
                            if (!refined.has(md5)) refined.set(md5, []);
                            refined.get(md5).push(it);
                        });
                        candidates = Array.from(refined.values()).filter((g) => g.length > 1);
                        pr.close();
                    } catch (e) { pr.close(); ui.toast('精确比对失败，已回退到体积+名称判重：' + e.message, 'warn', 4000); }
                }

                // 应用保留策略
                const keep = v.keep;
                groups = candidates.map((g) => {
                    const sorted = g.slice().sort((a, b) => {
                        switch (keep) {
                            case 'old': return (a.updated_at || a.created_at) - (b.updated_at || b.created_at);
                            case 'large': return b.size - a.size;
                            case 'small': return a.size - b.size;
                            case 'short': return a.name.length - b.name.length;
                            case 'long': return b.name.length - a.name.length;
                            case 'new':
                            default: return (b.updated_at || b.created_at) - (a.updated_at || a.created_at);
                        }
                    });
                    const keeper = sorted[0];
                    const dupes = sorted.slice(1);
                    return { keeper, dupes, wasted: dupes.reduce((s, x) => s + x.size, 0) };
                }).sort((a, b) => b.wasted - a.wasted);

                if (!groups.length) {
                    info.textContent = '未发现重复文件 🎉';
                    return;
                }

                const totalDupes = groups.reduce((s, g) => s + g.dupes.length, 0);
                const totalWasted = groups.reduce((s, g) => s + g.wasted, 0);
                info.innerHTML = `发现 <b>${groups.length}</b> 组重复，共 <b>${totalDupes}</b> 个冗余文件，可回收 <b>${util.humanSize(totalWasted)}</b>`;

                const rows = [];
                groups.forEach((g, gi) => {
                    g.dupes.forEach((d, di) => {
                        rows.push({
                            group: gi + 1, role: di === 0 ? '保留' : '冗余',
                            name: d.name, size: d.size, updated_at: d.updated_at, path: d.path || '',
                            _fid: d.fid, _keep: false,
                        });
                    });
                    rows.push({ group: gi + 1, role: '保留', name: g.keeper.name, size: g.keeper.size, updated_at: g.keeper.updated_at, path: g.keeper.path || '', _fid: g.keeper.fid, _keep: true });
                });
                rows.sort((a, b) => a.group - b.group || (a.role === '保留' ? -1 : 1));

                const tb = ui.table([
                    { key: 'group', label: '组', align: 'right', width: '48px' },
                    { key: 'role', label: '状态', render: (v) => v === '保留' ? '<span class="qem-tag ok">保留</span>' : '<span class="qem-tag err">冗余</span>' },
                    { key: 'name', label: '文件名', render: (v, row) => util.escapeHtml(row.path || v) },
                    { key: 'size', label: '大小', align: 'right', render: (v) => util.humanSize(v) },
                    { key: 'updated_at', label: '修改时间', render: (v) => util.escapeHtml(util.ts(v)) },
                ], rows, { maxHeight: '40vh', selectable: false });
                listBox.innerHTML = '';
                listBox.appendChild(tb.el);

                const acts = document.createElement('div');
                acts.className = 'row';
                acts.style.marginTop = '10px';
                const delBtn = document.createElement('button');
                delBtn.className = 'danger';
                delBtn.textContent = `删除全部冗余（${totalDupes} 项，回收 ${util.humanSize(totalWasted)}）`;
                delBtn.addEventListener('click', async () => {
                    const ok = await ui.confirm(`将把 ${totalDupes} 个冗余文件移入回收站，保留每组中的「保留」项。\n若判定有误，可在回收站还原。是否继续？`, { danger: true, okText: '移入回收站' });
                    if (!ok) return;
                    const pr = ui.progress('删除中');
                    try {
                        const dupes = groups.flatMap((g) => g.dupes);
                        const n = await deleteWithUndo(dupes, { label: '查重清理', onProgress: (d, tt) => pr.set(d / tt, `已删除 ${d}/${tt}`) });
                        pr.close(); toastDeleted(n, `已清理 ${n} 个冗余文件`);
                        await workspace.reload();
                    } catch (e) { pr.close(); ui.toast('删除失败：' + e.message, 'error'); }
                });
                const expBtn = document.createElement('button');
                expBtn.textContent = '导出查重报告 CSV';
                expBtn.addEventListener('click', () => exporter.saveCsv('查重报告', groups.flatMap((g) => [g.keeper, ...g.dupes].map((x) => ({ ...x, role: x === g.keeper ? '保留' : '冗余' })))));
                acts.append(delBtn, expBtn);
                listBox.appendChild(acts);
            });

            runBtn.click();
        },

        /* ---------------- 文件夹查重 ---------------- */
        openFolders() {
            const p = ui.panel({
                title: t('btnFolderDedup'), size: 'lg',
                buttons: [{ label: t('close'), onClick: (a) => a.close() }],
            });
            const cfg = document.createElement('div');
            const info = document.createElement('div');
            info.className = 'muted';
            const out = document.createElement('div');
            out.style.marginTop = '10px';
            p.body.append(cfg, info, out);

            const form = ui.form([
                { key: 'threshold', label: '相似阈值', type: 'number', value: config.get('folderDedup.threshold', 0.86), min: 0.5, max: 1, placeholder: '0.5 ~ 1' },
                { key: 'mode', label: '判定方式', type: 'select', value: 'both', options: [
                    { value: 'content', label: '子项内容签名（完全相同才判重）' },
                    { value: 'name', label: '文件夹名相似度' },
                    { value: 'both', label: '两者结合（推荐）' },
                ] },
            ]);
            const btn = document.createElement('button');
            btn.className = 'primary';
            btn.textContent = '开始分析';
            cfg.append(form.el, btn);

            btn.addEventListener('click', async () => {
                const folders = state.items.filter((i) => i.dir);
                if (!folders.length) { info.textContent = '当前目录没有子文件夹'; return; }
                info.textContent = t('working');
                out.innerHTML = '';
                const pr = ui.progress('分析文件夹');
                try {
                    const sigs = await util.pool(folders, async (f, i) => {
                        const r = await api.listAll(f.fid, { max: 3000 });
                        const sig = r.items.map((c) => `${c.dir ? 'D' : 'F'}:${c.name.toLowerCase()}|${c.size}`).sort().join(';');
                        pr.set((i + 1) / folders.length, `已分析 ${i + 1} / ${folders.length}`);
                        return { folder: f, sig, childCount: r.items.length, childSize: r.items.reduce((s, c) => s + (c.dir ? 0 : c.size), 0) };
                    }, 3);
                    pr.close();

                    const thr = Math.min(0.999, Math.max(0.5, Number(form.values.threshold) || 0.86));
                    const pairs = [];
                    const byContent = new Map();
                    sigs.forEach((s) => {
                        if (!s || s.__error || !s.sig) return;
                        const sigHash = fnv(s.sig);
                        if (!byContent.has(sigHash)) byContent.set(sigHash, []);
                        byContent.get(sigHash).push(s);
                    });
                    if (form.values.mode === 'content' || form.values.mode === 'both') {
                        byContent.forEach((list) => {
                            if (list.length < 2) return;
                            for (let i = 1; i < list.length; i++) pairs.push({ a: list[0], b: list[i], score: 1, reason: '子项内容完全一致' });
                        });
                    }
                    if (form.values.mode === 'name' || form.values.mode === 'both') {
                        const valid = sigs.filter((s) => s && !s.__error);
                        for (let i = 0; i < valid.length; i++) {
                            for (let j = i + 1; j < valid.length; j++) {
                                const score = nameSimilarity(valid[i].folder.name, valid[j].folder.name);
                                if (score >= thr) {
                                    if (pairs.some((x) => (x.a === valid[i] && x.b === valid[j]))) continue;
                                    pairs.push({ a: valid[i], b: valid[j], score, reason: '名称相似度 ' + score.toFixed(2) });
                                }
                            }
                        }
                    }
                    if (!pairs.length) { info.textContent = '未发现疑似重复的文件夹'; return; }
                    info.innerHTML = `发现 <b>${pairs.length}</b> 组疑似重复文件夹`;
                    const rows = pairs.map((pr2, idx) => ({
                        idx: idx + 1,
                        a: pr2.a.folder.name,
                        aInfo: `${pr2.a.childCount} 项 / ${util.humanSize(pr2.a.childSize)}`,
                        b: pr2.b.folder.name,
                        bInfo: `${pr2.b.childCount} 项 / ${util.humanSize(pr2.b.childSize)}`,
                        reason: pr2.reason,
                        _a: pr2.a.folder.fid, _b: pr2.b.folder.fid,
                    }));
                    const tb = ui.table([
                        { key: 'idx', label: '#', align: 'right', width: '40px' },
                        { key: 'a', label: '文件夹 A', render: (v, r) => `${util.escapeHtml(v)}<div class="muted">${util.escapeHtml(r.aInfo)}</div>` },
                        { key: 'b', label: '文件夹 B', render: (v, r) => `${util.escapeHtml(v)}<div class="muted">${util.escapeHtml(r.bInfo)}</div>` },
                        { key: 'reason', label: '判定依据' },
                        { key: 'actions', label: '操作', render: (v, r) => {
                            const box = document.createElement('div');
                            box.className = 'row';
                            const mk = (label, fid) => {
                                const b = document.createElement('button');
                                b.textContent = label;
                                b.title = '打开以人工确认';
                                b.addEventListener('click', async () => {
                                    const f = state.items.find((x) => x.fid === fid);
                                    if (f) { await workspace.enter(f); ui.toast('已进入该文件夹，请人工核对后再删除'); }
                                });
                                return b;
                            };
                            box.append(mk('打开 A', r._a), mk('打开 B', r._b));
                            return box;
                        } },
                    ], rows, { maxHeight: '46vh' });
                    out.innerHTML = '';
                    out.appendChild(tb.el);
                    const warn = document.createElement('div');
                    warn.className = 'muted';
                    warn.style.marginTop = '8px';
                    warn.textContent = '⚠️ 判定基于算法推测（子项签名 / 名称相似度），删除前请务必人工核对，以防误删。本工具不会自动删除文件夹。';
                    out.appendChild(warn);
                } catch (e) { pr.close(); info.textContent = '分析失败：' + e.message; }
            });
        },
    };

    /** 名称相似度：归一化后的二元组 Jaccard 系数 */
    function nameSimilarity(a, b) {
        const na = util.normalizeKey(a);
        const nb = util.normalizeKey(b);
        if (!na && !nb) return 1;
        if (!na || !nb) return 0;
        if (na === nb) return 1;
        const grams = (s) => {
            const set = new Set();
            for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
            if (!set.size) set.add(s);
            return set;
        };
        const ga = grams(na);
        const gb = grams(nb);
        let inter = 0;
        ga.forEach((g) => { if (gb.has(g)) inter++; });
        return inter / (ga.size + gb.size - inter);
    }

    /* ======================================================================
     * 13. 资源清理
     * ==================================================================== */

    const cleanup = {
        open() {
            const p = ui.panel({
                title: t('btnClean'), size: 'lg',
                buttons: [{ label: t('close'), onClick: (a) => a.close() }],
            });
            const cfg = document.createElement('div');
            const info = document.createElement('div');
            info.className = 'muted';
            const out = document.createElement('div');
            out.style.marginTop = '10px';
            p.body.append(cfg, info, out);

            const form = ui.form([
                { key: 'scope', label: '范围', type: 'select', value: 'deep', options: [
                    { value: 'current', label: '仅当前目录' },
                    { value: 'deep', label: '当前目录及子目录' },
                ] },
                { key: 'emptyFolder', label: '空文件夹', type: 'checkbox', value: true, hint: '无任何子项的文件夹' },
                { key: 'zeroFile', label: '0 字节文件', type: 'checkbox', value: true },
                { key: 'bigFile', label: '超大文件', type: 'checkbox', value: false },
                { key: 'bigThreshold', label: '超大阈值', value: '2GB', hint: '仅列出，不会自动删除' },
                { key: 'stale', label: '长期未修改', type: 'checkbox', value: false },
                { key: 'staleDays', label: '天数', type: 'number', value: 730 },
                { key: 'exts', label: '指定扩展名', type: 'checkbox', value: false },
                { key: 'extsList', label: '扩展名列表', value: 'torrent,tmp,log,bak', hint: '逗号分隔' },
            ]);
            const btn = document.createElement('button');
            btn.className = 'primary';
            btn.textContent = '扫描';
            cfg.append(form.el, btn);

            btn.addEventListener('click', async () => {
                info.textContent = t('working');
                out.innerHTML = '';
                let pool;
                const pr = ui.progress('扫描中');
                try {
                    if (form.values.scope === 'deep') {
                        pool = await scanner.walk(state.cwd, { onProgress: (n, path) => pr.set(0.5, `已扫描 ${n} 项 · ${path}`) });
                    } else pool = state.items.slice();
                } catch (e) { pr.close(); info.textContent = '扫描失败：' + e.message; return; }
                pr.close();

                const v = form.values;
                const results = [];
                if (v.emptyFolder) {
                    const dirs = pool.filter((i) => i.dir);
                    const pr2 = ui.progress('检查空文件夹');
                    const counts = await util.pool(dirs, async (d, i) => {
                        const r = await api.listAll(d.fid, { max: 20 });
                        pr2.set((i + 1) / Math.max(1, dirs.length), `已检查 ${i + 1}/${dirs.length}`);
                        return { fid: d.fid, name: d.name, empty: r.items.length === 0, path: d.path || d.name };
                    }, 4);
                    pr2.close();
                    counts.filter((c) => c && !c.__error && c.empty).forEach((c) => results.push({ type: '空文件夹', name: c.name, size: 0, path: c.path, fid: c.fid }));
                }
                if (v.zeroFile) pool.filter((i) => !i.dir && i.size === 0).forEach((i) => results.push({ type: '0 字节文件', name: i.name, size: 0, path: i.path || i.name, fid: i.fid }));
                if (v.bigFile) {
                    const thr = parseSize(v.bigThreshold);
                    pool.filter((i) => !i.dir && i.size >= thr).forEach((i) => results.push({ type: '超大文件', name: i.name, size: i.size, path: i.path || i.name, fid: i.fid }));
                }
                if (v.stale) {
                    const days = Number(v.staleDays) || 730;
                    const cutoff = Date.now() - days * 86400000;
                    pool.filter((i) => !i.dir && (i.updated_at || i.created_at) < cutoff).forEach((i) => results.push({ type: '长期未修改', name: i.name, size: i.size, path: i.path || i.name, fid: i.fid }));
                }
                if (v.exts) {
                    const exts = String(v.extsList || '').split(/[,，\s]+/).map((s) => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
                    pool.filter((i) => !i.dir && exts.includes(i.ext)).forEach((i) => results.push({ type: '指定类型', name: i.name, size: i.size, path: i.path || i.name, fid: i.fid }));
                }

                const totalSize = results.reduce((s, r) => s + r.size, 0);
                if (!results.length) { info.textContent = '没有发现需要清理的项目 🎉'; return; }
                info.innerHTML = `发现 <b>${results.length}</b> 项可清理内容，涉及体积 <b>${util.humanSize(totalSize)}</b>（仅列出，需你确认后才会处理）`;

                const tb = ui.table([
                    { key: 'type', label: '类别', render: (v) => `<span class="qem-tag">${util.escapeHtml(v)}</span>` },
                    { key: 'name', label: '名称', render: (v, r) => util.escapeHtml(r.path || v) },
                    { key: 'size', label: '大小', align: 'right', render: (v) => v ? util.humanSize(v) : '-' },
                ], results, { maxHeight: '40vh' });
                out.innerHTML = '';
                out.appendChild(tb.el);

                const acts = document.createElement('div');
                acts.className = 'row';
                acts.style.marginTop = '10px';
                const del = document.createElement('button');
                del.className = 'danger';
                del.textContent = `删除全部（${results.length} 项）`;
                del.addEventListener('click', async () => {
                    const ok = await ui.confirm(`将把 ${results.length} 个项目移入回收站，是否继续？`, { danger: true, okText: '移入回收站' });
                    if (!ok) return;
                    const pr3 = ui.progress('删除中');
                    try {
                        const n = await deleteWithUndo(results, { label: '资源清理', onProgress: (d, tt) => pr3.set(d / tt, `已删除 ${d}/${tt}`) });
                        pr3.close(); toastDeleted(n, `已清理 ${n} 项`);
                        indexCache.dropAll();
                        await workspace.reload();
                    } catch (e) { pr3.close(); ui.toast('失败：' + e.message, 'error'); }
                });
                acts.appendChild(del);
                out.appendChild(acts);
            });
        },
    };

    /* ======================================================================
     * 14. 导出（目录树 / M3U / 磁链 / CSV / 直链）
     * ==================================================================== */

    const exporter = {
        /** 统一取数：selected 优先，否则当前目录；deep 时递归 */
        async pool(scope) {
            if (scope === 'selected') return sel.items();
            if (scope === 'deep') {
                const pr = ui.progress('扫描子树');
                try {
                    return await scanner.walk(state.cwd, { onProgress: (n, path) => pr.set(0.5, `已扫描 ${n} 项 · ${path}`) });
                } finally { pr.close(); }
            }
            return state.items.slice();
        },

        async tree() {
            const p = ui.panel({ title: t('btnTree'), size: 'md', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
            const info = document.createElement('div');
            info.className = 'muted';
            const out = document.createElement('pre');
            out.className = 'qem-mono';
            out.style.cssText = 'max-height:46vh;overflow:auto;white-space:pre;background:var(--qem-bg-soft);padding:10px;border-radius:8px;margin-top:10px';
            p.body.append(info, out);

            const form = ui.form([
                { key: 'scope', label: '范围', type: 'select', value: 'deep', options: [
                    { value: 'deep', label: '当前目录及子目录（完整树）' },
                    { value: 'current', label: '仅当前目录' },
                    { value: 'selected', label: '仅选中项' },
                ] },
                { key: 'format', label: '格式', type: 'select', value: config.get('exportFormat', 'md'), options: [
                    { value: 'md', label: 'Markdown' }, { value: 'txt', label: '纯文本' }, { value: 'json', label: 'JSON' },
                ] },
                { key: 'withSize', label: '含体积统计', type: 'checkbox', value: true },
            ], () => run());
            p.body.insertBefore(form.el, info);

            let text = '';
            async function run() {
                info.textContent = t('working');
                let items;
                try { items = await exporter.pool(form.values.scope); }
                catch (e) { info.textContent = '扫描失败：' + e.message; return; }

                const sum = scanner.summarize(items);
                info.innerHTML = `共 <b>${sum.count}</b> 项（文件 ${sum.files} / 文件夹 ${sum.folders}），合计 <b>${util.humanSize(sum.size)}</b>`;

                if (form.values.format === 'json') {
                    text = JSON.stringify({
                        root: state.path.map((s) => s.name).join('/'),
                        exportedAt: new Date().toISOString(),
                        summary: sum,
                        items: items.map((i) => ({ path: i.path || i.name, name: i.name, dir: i.dir, size: i.size, ext: i.ext, updated_at: i.updated_at })),
                    }, null, 2);
                } else if (form.values.format === 'md') {
                    const lines = [];
                    lines.push(`# 目录树导出：${state.path.map((s) => s.name).join(' / ')}`, '');
                    lines.push(`> 导出时间：${util.ts(Date.now())}　共 ${sum.count} 项（文件 ${sum.files} / 文件夹 ${sum.folders}），合计 ${util.humanSize(sum.size)}`, '');
                    lines.push('| 层级 | 名称 | 类型 | 大小 | 修改时间 |', '| --- | --- | --- | --- | --- |');
                    items.forEach((i) => {
                        const depth = (i.path || '').split('/').length - 1;
                        lines.push(`| ${'　'.repeat(depth)}${depth > 0 ? '└ ' : ''} | ${String(i.name).replace(/\|/g, '\\|')} | ${(CATEGORY[i.category] || CATEGORY.other).label} | ${i.dir ? `${i.include_items || 0} 项` : util.humanSize(i.size)} | ${util.ts(i.updated_at)} |`);
                    });
                    text = lines.join('\n');
                } else {
                    const lines = [];
                    const build = (items2) => {
                        const byParent = new Map();
                        items2.forEach((i) => {
                            const pth = i.path || i.name;
                            const idx = pth.lastIndexOf('/');
                            const parent = idx >= 0 ? pth.slice(0, idx) : '';
                            if (!byParent.has(parent)) byParent.set(parent, []);
                            byParent.get(parent).push(i);
                        });
                        const walk = (parent, prefix) => {
                            const list = byParent.get(parent) || [];
                            list.forEach((it, idx2) => {
                                const last = idx2 === list.length - 1;
                                lines.push(prefix + (last ? '└─ ' : '├─ ') + it.name + (it.dir ? '/' : `  (${util.humanSize(it.size)})`));
                                if (it.dir) walk(it.path || it.name, prefix + (last ? '   ' : '│  '));
                            });
                        };
                        walk('', '');
                    };
                    build(items);
                    text = `目录树：${state.path.map((s) => s.name).join(' / ')}\n共 ${sum.count} 项，合计 ${util.humanSize(sum.size)}\n\n` + lines.join('\n');
                }
                out.textContent = text.slice(0, 300000) + (text.length > 300000 ? '\n\n...（内容过长，已截断预览，导出文件为完整内容）' : '');
            }

            const acts = document.createElement('div');
            acts.className = 'row';
            acts.style.marginTop = '10px';
            const dl = document.createElement('button');
            dl.className = 'primary';
            dl.textContent = '导出文件';
            dl.addEventListener('click', () => {
                const ext = form.values.format === 'json' ? 'json' : form.values.format === 'md' ? 'md' : 'txt';
                util.saveTextFile(`目录树_${state.path[state.path.length - 1].name}_${Date.now()}.${ext}`, text);
                ui.toast('已导出');
            });
            const cp = document.createElement('button');
            cp.textContent = '复制到剪贴板';
            cp.addEventListener('click', () => util.copy(text, '已复制目录树'));
            acts.append(dl, cp);
            p.body.appendChild(acts);

            run();
        },

        async m3u() {
            const p = ui.panel({ title: t('btnM3u'), size: 'md', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
            const info = document.createElement('div');
            info.className = 'muted';
            const out = document.createElement('pre');
            out.className = 'qem-mono';
            out.style.cssText = 'max-height:40vh;overflow:auto;white-space:pre-wrap;background:var(--qem-bg-soft);padding:10px;border-radius:8px;margin-top:10px';
            p.body.append(info, out);

            const form = ui.form([
                { key: 'scope', label: '范围', type: 'select', value: 'selected', options: [
                    { value: 'selected', label: '选中项（推荐）' },
                    { value: 'current', label: '当前目录全部视频' },
                    { value: 'deep', label: '当前目录及子目录' },
                ] },
                { key: 'withUrl', label: '写入直链', type: 'checkbox', value: false, hint: '开启后逐条取直链，视频多时较慢；直链有时效，适合立即播放' },
                { key: 'withPath', label: '标题含路径', type: 'checkbox', value: true },
            ], () => run());
            p.body.insertBefore(form.el, info);

            let text = '';
            async function run() {
                info.textContent = t('working');
                let items;
                try { items = await exporter.pool(form.values.scope); }
                catch (e) { info.textContent = '扫描失败：' + e.message; return; }
                const videos = items.filter((i) => !i.dir && i.category === 'video');
                if (!videos.length) { info.textContent = '没有找到视频文件'; out.textContent = ''; text = ''; return; }
                const lines = ['#EXTM3U'];
                let resolved = 0;
                if (form.values.withUrl) {
                    const pr = ui.progress('获取直链');
                    try {
                        for (let i = 0; i < videos.length; i += 50) {
                            const chunk = videos.slice(i, i + 50);
                            const infos = await api.downloadUrls(chunk.map((v) => v.fid));
                            const map = new Map(infos.map((x) => [x.fid, x.url]));
                            chunk.forEach((v) => { v._url = map.get(v.fid) || ''; if (v._url) resolved++; });
                            pr.set(Math.min(1, (i + 50) / videos.length), `已获取 ${Math.min(videos.length, i + 50)} / ${videos.length}`);
                        }
                    } finally { pr.close(); }
                }
                videos.forEach((v) => {
                    const title = form.values.withPath && v.path ? v.path : util.baseName(v.name);
                    lines.push(`#EXTINF:-1,${title}`);
                    lines.push(v._url || util.baseName(v.name));
                });
                text = lines.join('\n');
                info.innerHTML = `共 ${videos.length} 个视频${form.values.withUrl ? `，成功写入直链 ${resolved} 条` : ''}`;
                out.textContent = text.slice(0, 60000);
            }

            const acts = document.createElement('div');
            acts.className = 'row';
            acts.style.marginTop = '10px';
            const dl = document.createElement('button');
            dl.className = 'primary';
            dl.textContent = '导出 .m3u';
            dl.addEventListener('click', () => { if (!text) return ui.toast('没有可导出的内容', 'warn'); util.saveTextFile(`playlist_${Date.now()}.m3u`, text, 'audio/x-mpegurl'); ui.toast('已导出'); });
            const cp = document.createElement('button');
            cp.textContent = '复制内容';
            cp.addEventListener('click', () => util.copy(text, '已复制 M3U 内容'));
            acts.append(dl, cp);
            p.body.appendChild(acts);

            run();
        },

        async magnet() {
            const p = ui.panel({ title: t('btnMagnet'), size: 'md', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
            const info = document.createElement('div');
            info.className = 'muted';
            const listBox = document.createElement('div');
            listBox.style.marginTop = '10px';
            p.body.append(info, listBox);

            const btn = document.createElement('button');
            btn.className = 'primary';
            btn.textContent = '开始提取';
            p.body.insertBefore(btn, listBox);

            let all = [];
            btn.addEventListener('click', async () => {
                const scope = sel.items().length ? 'selected' : 'current';
                info.textContent = t('working');
                listBox.innerHTML = '';
                let items;
                try { items = await exporter.pool(scope); }
                catch (e) { info.textContent = '读取失败：' + e.message; return; }
                const txts = items.filter((i) => !i.dir && ['txt', 'md', 'srt', 'ass', 'json', 'html', 'htm'].includes(i.ext));
                if (!txts.length) { info.textContent = '没有找到可解析的文本文件（.txt/.md/.srt 等）'; return; }
                const pr = ui.progress('解析文本');
                all = [];
                let scanned = 0;
                try {
                    for (let i = 0; i < txts.length; i++) {
                        const it = txts[i];
                        try {
                            const [u] = await api.downloadUrls([it.fid]);
                            if (u && u.url) {
                                const res = await fetch(u.url);
                                const body = (await res.text()).slice(0, 2000000);
                                const links = util.extractLinks(body);
                                links.forEach((l) => all.push({ link: l, from: it.name }));
                            }
                        } catch (e) { /* 单个文件失败不影响整体 */ }
                        scanned++;
                        pr.set(scanned / txts.length, `已解析 ${scanned} / ${txts.length}`);
                    }
                } finally { pr.close(); }

                const uniq = new Map();
                all.forEach((x) => { if (!uniq.has(x.link)) uniq.set(x.link, x); });
                all = Array.from(uniq.values());
                if (!all.length) { info.textContent = '没有识别到可下载链接（magnet / ed2k / thunder / 直链）'; return; }
                info.innerHTML = `从 ${scanned} 个文本文件中提取到 <b>${all.length}</b> 个唯一链接`;
                const tb = ui.table([
                    { key: 'from', label: '来源文件', render: (v) => util.escapeHtml(v) },
                    { key: 'link', label: '链接', render: (v) => `<span class="qem-mono">${util.escapeHtml(String(v).slice(0, 120))}${String(v).length > 120 ? '…' : ''}</span>` },
                ], all, { maxHeight: '40vh' });
                listBox.appendChild(tb.el);
            });

            const acts = document.createElement('div');
            acts.className = 'row';
            acts.style.marginTop = '10px';
            const cp = document.createElement('button');
            cp.className = 'primary';
            cp.textContent = '复制全部链接';
            cp.addEventListener('click', () => { if (!all.length) return ui.toast('没有可复制的内容', 'warn'); util.copy(all.map((x) => x.link).join('\n'), `已复制 ${all.length} 条`); });
            const dl = document.createElement('button');
            dl.textContent = '导出 TXT';
            dl.addEventListener('click', () => { if (!all.length) return ui.toast('没有可导出的内容', 'warn'); util.saveTextFile(`magnet_${Date.now()}.txt`, all.map((x) => x.link).join('\n')); });
            acts.append(cp, dl);
            p.body.appendChild(acts);
        },

        async csv() {
            const items = sel.items().length ? sel.items() : state.items;
            if (!items.length) return ui.toast(t('empty'), 'warn');
            this.saveCsv('文件清单', items);
        },

        saveCsv(name, items) {
            const head = ['名称', '路径', '类型', '扩展名', '大小(字节)', '大小', '创建时间', '修改时间', 'FID', '角色'];
            const rows = items.map((i) => [
                i.name, i.path || '', (CATEGORY[i.category] || CATEGORY.other).label, i.ext,
                i.dir ? '' : i.size, i.dir ? `${i.include_items || 0} 项` : util.humanSize(i.size),
                i.created_at ? util.ts(i.created_at) : '', i.updated_at ? util.ts(i.updated_at) : '', i.fid, i.role || '',
            ]);
            const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
            util.saveTextFile(`${name}_${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
            ui.toast(`已导出 ${rows.length} 条记录`);
        },
    };

    /* ======================================================================
     * 15. 下载与外链（直链导出 / Aria2 / IDM / 外部播放器）
     * ==================================================================== */

    const downloader = {
        async resolve(items) {
            const list = (items || sel.items()).filter((i) => !i.dir);
            if (!list.length) { ui.toast('请选择文件（文件夹需要展开后选择）', 'warn'); return []; }
            const pr = ui.progress('获取下载地址');
            const out = [];
            try {
                for (let i = 0; i < list.length; i += 50) {
                    const chunk = list.slice(i, i + 50);
                    const infos = await api.downloadUrls(chunk.map((x) => x.fid));
                    const map = new Map(infos.map((x) => [x.fid, x]));
                    chunk.forEach((it) => {
                        const info = map.get(it.fid);
                        if (info && info.url) out.push({ item: it, url: info.url, md5: info.md5 });
                    });
                    pr.set(Math.min(1, (i + 50) / list.length), `已获取 ${Math.min(list.length, i + 50)} / ${list.length}`);
                }
            } finally { pr.close(); }
            if (!out.length) ui.toast('未获取到下载地址', 'error');
            return out;
        },

        async downloadSelection(items) {
            const resolved = await this.resolve(items);
            if (!resolved.length) return;
            const mode = config.get('downloader', 'aria2');
            if (mode === 'aria2') return this.sendToAria2(resolved);
            if (mode === 'idm') return this.exportIdm(resolved);
            // 直接交给浏览器
            const ok = await ui.confirm(`即将用浏览器打开 ${resolved.length} 个下载链接，可能触发多个下载任务。是否继续？`);
            if (!ok) return;
            resolved.forEach((r, i) => setTimeout(() => window.open(r.url, '_blank'), i * 400));
        },

        async exportDirectLinks() {
            const resolved = await this.resolve();
            if (!resolved.length) return;
            const text = resolved.map((r) => `${r.url}\t${r.item.name}`).join('\n');
            const p = ui.panel({
                title: '直链清单', size: 'md',
                buttons: [
                    { label: '复制', onClick: () => util.copy(resolved.map((r) => r.url).join('\n'), `已复制 ${resolved.length} 条直链`) },
                    { label: '导出 TXT', onClick: () => util.saveTextFile(`direct_links_${Date.now()}.txt`, resolved.map((r) => r.url).join('\n')) },
                    { label: '推送到 Aria2', primary: true, onClick: () => downloader.sendToAria2(resolved) },
                ],
            });
            const pre = document.createElement('pre');
            pre.className = 'qem-mono';
            pre.style.cssText = 'white-space:pre-wrap;max-height:56vh;overflow:auto';
            pre.textContent = text;
            const tip = document.createElement('div');
            tip.className = 'muted';
            tip.style.marginBottom = '8px';
            tip.textContent = '⚠️ 夸克直链带时效与鉴权，通常仅短期有效，请尽快使用。';
            p.body.append(tip, pre);
        },

        /** Aria2 JSON-RPC 推送（与网盘无关的通用集成，原版逻辑可直接复用） */
        async sendToAria2(resolved) {
            const rpc = config.get('aria2.rpc', 'http://127.0.0.1:6800/jsonrpc');
            const secret = config.get('aria2.secret', '');
            const dir = config.get('aria2.dir', '');
            if (!rpc) return ui.toast('请先在设置中填写 Aria2 RPC 地址', 'warn');
            const pr = ui.progress('推送到 Aria2');
            let ok = 0;
            const fails = [];
            try {
                for (let i = 0; i < resolved.length; i++) {
                    const r = resolved[i];
                    const params = [];
                    if (secret) params.push('token:' + secret);
                    params.push([r.url]);
                    params.push({ out: r.item.name, ...(dir ? { dir } : {}) });
                    try {
                        const res = await fetch(rpc, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ jsonrpc: '2.0', id: util.uuid(), method: 'aria2.addUri', params }),
                        });
                        const j = await res.json().catch(() => null);
                        if (j && j.result) ok++; else fails.push({ name: r.item.name, error: (j && j.error && j.error.message) || 'RPC 返回异常' });
                    } catch (e) {
                        fails.push({ name: r.item.name, error: '无法连接 Aria2（' + e.message + '）' });
                    }
                    pr.set((i + 1) / resolved.length, `已推送 ${i + 1} / ${resolved.length}`);
                }
            } finally { pr.close(); }
            if (ok) ui.toast(`已推送 ${ok} 个任务到 Aria2`);
            if (fails.length) {
                const p = ui.panel({ title: 'Aria2 推送失败清单', size: 'md', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
                p.body.appendChild(ui.table([
                    { key: 'name', label: '文件' },
                    { key: 'error', label: '原因' },
                ], fails, { maxHeight: '50vh' }).el);
            }
        },

        /** 导出 IDM 可用的 URL 清单 / BAT */
        async exportIdm(resolved) {
            const mode = await new Promise((resolve) => {
                const done = ui.once(resolve);
                const p = ui.panel({
                    title: '导出 IDM 清单', size: 'sm', closeOnMask: false,
                    buttons: [
                        { label: 'TXT 链接清单', primary: true, onClick: (a) => { done('txt'); a.close(); } },
                        { label: 'BAT 调用脚本', onClick: (a) => { done('bat'); a.close(); } },
                        { label: t('cancel'), onClick: (a) => { done(null); a.close(); } },
                    ],
                    onClose: () => done(null),
                });
                const d = document.createElement('div');
                d.textContent = `共 ${resolved.length} 条直链。TXT 可直接导入 IDM；BAT 需本机已安装 IDMan.exe。`;
                p.body.appendChild(d);
            });
            if (!mode) return;
            if (mode === 'txt') {
                util.saveTextFile(`idm_urls_${Date.now()}.txt`, resolved.map((r) => r.url).join('\n'));
                ui.toast('已导出 TXT');
            } else {
                const lines = ['@echo off', 'chcp 65001 >nul', `rem 由夸克增强大师生成 ${new Date().toLocaleString()}`];
                resolved.forEach((r) => lines.push(`"C:\\Program Files (x86)\\Internet Download Manager\\IDMan.exe" /d "${r.url}" /p "D:\\Downloads" /f "${r.item.name}" /n`));
                lines.push('echo 已提交下载任务', 'pause');
                util.saveTextFile(`idm_batch_${Date.now()}.bat`, lines.join('\r\n'));
                ui.toast('已导出 BAT（请按需修改路径）');
            }
        },
    };

    const player = {
        async open(item) {
            const target = item || sel.items().find((i) => !i.dir);
            if (!target) return ui.toast('请选择一个媒体文件', 'warn');
            const mode = config.get('player', 'script');
            if (mode === 'script') return window.open(target.fid ? `#/preview/${target.fid}` : '', '_self');
            const resolved = await downloader.resolve([target]);
            if (!resolved.length) return;
            const url = resolved[0].url;
            if (mode === 'potplayer') {
                const base = config.get('potplayerPath', '');
                const proto = base ? `${base}|${url}` : url;
                window.location.href = 'potplayer://' + encodeURIComponent(proto);
                setTimeout(async () => {
                    const ok = await ui.confirm('已尝试唤起 PotPlayer。如果没有任何反应，通常是系统未正确注册 potplayer:// 协议。\n\n是否复制播放链接改为手动打开？');
                    if (ok) util.copy(url, '播放链接已复制');
                }, 2500);
            } else {
                util.copy(url, '播放链接已复制');
                ui.toast('请粘贴到你的播放器中打开', 'info', 4000);
            }
        },
    };

    const imgSearch = {
        ENGINES: {
            google: { label: 'Google Lens', url: (u) => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(u)}` },
            yandex: { label: 'Yandex 图片', url: (u) => `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(u)}` },
            saucenao: { label: 'SauceNAO', url: (u) => `https://saucenao.com/search.php?url=${encodeURIComponent(u)}` },
            tracemoe: { label: 'trace.moe', url: (u) => `https://trace.moe/?url=${encodeURIComponent(u)}` },
        },

        async open(item) {
            const target = item || sel.items().find((i) => i.category === 'image' || i.category === 'video');
            if (!target) return ui.toast('请选择一张图片或视频', 'warn');
            const resolved = await downloader.resolve([target]);
            if (!resolved.length) return;
            const url = resolved[0].url;
            const engine = config.get('imgSearch', 'google');
            const e = this.ENGINES[engine] || this.ENGINES.google;
            window.open(e.url(url), '_blank');
            ui.toast(`已在 ${e.label} 中打开以图搜图`, 'info', 4000);
        },
    };

    /* ======================================================================
     * 16. 分享（批量建链 / 解析转存 / 我的分享）
     * ==================================================================== */

    const shareTool = {
        async create() {
            const items = sel.items();
            if (!items.length) return ui.toast(t('noSelection'), 'warn');
            const p = ui.panel({
                title: t('btnShare') + `（${items.length} 项）`, size: 'sm', closeOnMask: false,
                buttons: [
                    { label: t('cancel'), onClick: (a) => a.close() },
                    { label: '立即分享', primary: true, onClick: () => run() },
                ],
            });
            const form = ui.form([
                { key: 'title', label: '标题', value: '', placeholder: '留空使用夸克默认标题' },
                { key: 'url_type', label: '链接类型', type: 'select', value: '1', options: [
                    { value: '1', label: '公开（无提取码）' }, { value: '2', label: '私密（带提取码）' },
                ] },
                { key: 'expired_type', label: '有效期', type: 'select', value: '1', options: [
                    { value: '1', label: '永久有效' }, { value: '2', label: '1 天' },
                    { value: '3', label: '7 天' }, { value: '4', label: '30 天' },
                ] },
            ]);
            p.body.appendChild(form.el);

            async function run() {
                const pr = ui.progress('创建分享');
                try {
                    pr.text('正在提交分享任务...');
                    const r = await api.raw('shareCreate', {
                        fid_list: items.map((i) => i.fid),
                        title: form.values.title || '',
                        url_type: Number(form.values.url_type) || 1,
                        expired_type: Number(form.values.expired_type) || 1,
                    });
                    const taskId = r.data && (r.data.task_id || r.data.taskId);
                    if (!taskId) throw new Error('未返回分享任务标识');
                    const d = await api.waitTask(taskId, { timeout: 60000 });
                    const shareId = d.share_id || (d.data && d.data.share_id);
                    if (!shareId) throw new Error('未返回分享标识');
                    pr.text('正在获取分享链接...');
                    const pw = await api.raw('sharePassword', { share_id: shareId }, { retry: 3 });
                    const info = pw.data || {};
                    pr.close();
                    const url = info.share_url || '';
                    const passcode = info.passcode || '';
                    const out = ui.panel({
                        title: t('title_share_result') || '分享成功', size: 'sm',
                        buttons: [
                            { label: '复制链接', onClick: () => util.copy(passcode ? `${url} 提取码：${passcode}` : url, '已复制') },
                            { label: t('close'), onClick: (a) => a.close() },
                        ],
                    });
                    const body = document.createElement('div');
                    body.className = 'col';
                    const l1 = document.createElement('div');
                    l1.innerHTML = `<div class="muted">分享链接</div><div class="qem-mono" style="word-break:break-all">${util.escapeHtml(url)}</div>`;
                    body.appendChild(l1);
                    if (passcode) {
                        const l2 = document.createElement('div');
                        l2.innerHTML = `<div class="muted">提取码</div><div class="qem-mono">${util.escapeHtml(passcode)}</div>`;
                        body.appendChild(l2);
                    }
                    if (info.title) {
                        const l3 = document.createElement('div');
                        l3.className = 'muted';
                        l3.textContent = '分享标题：' + info.title;
                        body.appendChild(l3);
                    }
                    out.body.appendChild(body);
                } catch (e) { pr.close(); ui.toast('分享失败：' + e.message, 'error', 5000); }
            }
        },

        async parse() {
            const p = ui.panel({
                title: t('btnShareParse'), size: 'lg',
                buttons: [{ label: t('close'), onClick: (a) => a.close() }],
            });
            const info = document.createElement('div');
            info.className = 'muted';
            const listBox = document.createElement('div');
            listBox.style.marginTop = '10px';
            p.body.append(info, listBox);

            const form = ui.form([
                { key: 'link', label: '分享链接', placeholder: 'https://pan.quark.cn/s/xxxxxx 或仅粘贴提取码字符串', value: '' },
                { key: 'passcode', label: '提取码', placeholder: '链接自带则留空' },
            ]);
            const btn = document.createElement('button');
            btn.className = 'primary';
            btn.textContent = '解析';
            p.body.insertBefore(form.el, info);
            p.body.insertBefore(btn, info);

            const saved = { pwd_id: '', stoken: '', passcode: '', items: [], all: [] };

            function parseLink(text) {
                const s = String(text || '').trim();
                const m = /(?:pan\.quark\.cn|drive-pc\.quark\.cn)\/s\/([A-Za-z0-9_-]+)/.exec(s);
                let pwdId = m ? m[1] : '';
                let code = '';
                const cm = /(?:提取码|密码|code|pwd)[：:\s]*([A-Za-z0-9]{4,8})/.exec(s);
                if (cm) code = cm[1];
                if (!pwdId) {
                    const m2 = /^([A-Za-z0-9_-]{8,})$/.exec(s);
                    if (m2) pwdId = m2[1];
                }
                return { pwdId, code };
            }

            async function load(pdir = '0') {
                const detail = await api.raw('shareDetail', { pwd_id: saved.pwd_id, stoken: saved.stoken, pdir_fid: pdir, size: PAGE_SIZE });
                const list = (detail.data && detail.data.list ? detail.data.list : []).map(fileModel.normalize);
                const share = detail.data && detail.data.share ? detail.data.share : {};
                info.innerHTML = `分享标题：<b>${util.escapeHtml(share.title || '-')}</b>　文件总数：${util.escapeHtml(String(share.file_num || list.length))}`;
                listBox.innerHTML = '';
                if (!list.length) { listBox.innerHTML = '<div class="qem-empty">该分享为空</div>'; return; }
                const tb = ui.table([
                    { key: 'name', label: '名称', render: (v, row) => `${row.dir ? '📁' : (CATEGORY[row.category] || CATEGORY.other).icon} ${util.escapeHtml(v)}` },
                    { key: 'size', label: '大小', align: 'right', render: (v, row) => row.dir ? `${row.include_items || 0} 项` : util.humanSize(v) },
                    { key: 'updated_at', label: '修改时间', render: (v) => util.escapeHtml(util.ts(v)) },
                ], list, { maxHeight: '44vh', selectable: true, onSelectionChange: (rows) => { saved.items = rows; } });
                listBox.appendChild(tb.el);
                saved.all = list;

                const acts = document.createElement('div');
                acts.className = 'row';
                acts.style.marginTop = '10px';
                acts.style.flexWrap = 'wrap';
                const saveBtn = document.createElement('button');
                saveBtn.className = 'primary';
                saveBtn.textContent = '转存选中项';
                saveBtn.addEventListener('click', async () => {
                    const picked = saved.items.filter((x) => !x.dir);
                    const picks = picked.length ? picked : saved.all.filter((x) => !x.dir);
                    if (!picks.length) return ui.toast('没有可转存的文件', 'warn');
                    const target = await picker.chooseFolder('选择转存到哪个文件夹', { createNew: true });
                    if (target === null) return;

                    // ① 容量预检：转存会实际占用空间（夸克空间不足时静默中止）
                    const needBytes = picks.reduce((s, x) => s + (x.size || 0), 0);
                    const capOk = await capacityGuard.ensure(needBytes, `转存 ${picks.length} 个文件`);
                    if (!capOk) return;

                    // ② 同名冲突策略
                    let plan = null;
                    try { plan = await conflict.resolve(target, picks, { label: '转存' }); }
                    catch (e) { ui.toast('同名检测失败：' + e.message, 'error'); return; }
                    if (plan.action === 'abort') return;
                    const saveList = plan.toMove.map((x) => (x.item || x));
                    if (!saveList.length) return ui.toast('全部文件因同名被跳过', 'warn');

                    const pr = ui.progress('转存中');
                    try {
                        const r = await api.raw('shareSave', {
                            fid_list: saveList.map((x) => x.fid),
                            fid_token_list: saveList.map((x) => x.share_fid_token || (x.raw && x.raw.share_fid_token) || ''),
                            to_pdir_fid: target,
                            pwd_id: saved.pwd_id,
                            stoken: saved.stoken,
                        });
                        const taskId = r.data && r.data.task_id;
                        let createdFids = [];
                        if (taskId) {
                            const d = await api.waitTask(taskId, { timeout: 90000 });
                            createdFids = d.save_as_top_fids || d.save_as_fids || [];
                        }
                        opLog.push({
                            type: 'save',
                            label: '分享转存',
                            entries: saveList.map((x) => ({ fid: x.fid, name: x.name, toPdir: target })),
                            createdFids,
                            undoable: createdFids.length > 0,
                            note: createdFids.length ? '' : '未取回转存生成的文件标识，无法自动撤销，请手动删除',
                        });
                        capacityGuard.invalidate();
                        pr.close();
                        ui.toast(`已转存 ${saveList.length} 个文件` + (plan.skipped.length ? `，跳过 ${plan.skipped.length} 个同名项` : ''));
                        if (state.ui) await workspace.reload();
                    } catch (e) { pr.close(); ui.toast('转存失败：' + e.message, 'error', 5000); }
                });
                acts.insertBefore(saveBtn, acts.firstChild);

                const up = document.createElement('button');
                up.textContent = '↩ 返回上级目录';
                up.addEventListener('click', () => load('0'));
                acts.appendChild(up);
                listBox.appendChild(acts);
            }

            btn.addEventListener('click', async () => {
                const parsed = parseLink(form.values.link);
                let pwdId = parsed.pwdId;
                let code = form.values.passcode || parsed.code;
                if (!pwdId) return ui.toast('未能从链接中识别分享标识，请检查链接格式', 'warn');
                info.textContent = t('working');
                listBox.innerHTML = '';
                try {
                    const tk = await api.raw('shareToken', { pwd_id: pwdId, passcode: code });
                    const stoken = tk.data && tk.data.stoken;
                    if (!stoken) throw new Error(tk.message || '获取分享凭证失败（提取码可能不正确）');
                    saved.pwd_id = pwdId;
                    saved.stoken = stoken;
                    saved.passcode = code;
                    await load('0');
                } catch (e) { info.textContent = '解析失败：' + e.message; }
            });
        },

        async myList() {
            const p = ui.panel({ title: '我的分享', size: 'lg', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
            const listBox = document.createElement('div');
            p.body.appendChild(listBox);
            listBox.innerHTML = '<div class="qem-empty">' + t('loading') + '</div>';
            try {
                const r = await api.raw('shareMyList', { page: 1, size: 50 });
                const list = (r.data && (r.data.list || r.data.share_list)) || [];
                if (!list.length) { listBox.innerHTML = '<div class="qem-empty">还没有创建过分享</div>'; return; }
                const rows = list.map((x) => ({
                    title: x.title || x.share_name || '(无标题)',
                    url: x.share_url || '',
                    passcode: x.passcode || '',
                    time: x.created_at || x.share_time || 0,
                    view: x.view_count || x.visit_count || 0,
                    save: x.save_count || x.download_count || 0,
                    status: x.status === 1 ? '已失效' : '有效',
                    _id: x.share_id,
                }));
                listBox.innerHTML = '';
                const tb = ui.table([
                    { key: 'title', label: '标题' },
                    { key: 'url', label: '链接', render: (v, row) => v ? `<a href="${util.escapeHtml(v)}" target="_blank" rel="noreferrer" class="qem-mono">${util.escapeHtml(v.slice(0, 40))}…</a>` : '-' },
                    { key: 'passcode', label: '提取码' },
                    { key: 'view', label: '浏览', align: 'right' },
                    { key: 'save', label: '转存', align: 'right' },
                    { key: 'time', label: '分享时间', render: (v) => util.escapeHtml(util.ts(v)) },
                    { key: 'status', label: '状态', render: (v) => `<span class="qem-tag ${v === '有效' ? 'ok' : 'err'}">${util.escapeHtml(v)}</span>` },
                    { key: 'act', label: '操作', render: (v, row) => {
                        const box = document.createElement('div');
                        box.className = 'row';
                        const cp = document.createElement('button');
                        cp.textContent = '复制';
                        cp.addEventListener('click', () => util.copy(row.passcode ? `${row.url} 提取码：${row.passcode}` : row.url, '已复制'));
                        const del = document.createElement('button');
                        del.className = 'danger';
                        del.textContent = '取消分享';
                        del.addEventListener('click', async () => {
                            const ok = await ui.confirm(`确认取消分享「${row.title}」？取消后原链接将立即失效。`, { danger: true, okText: '取消分享' });
                            if (!ok) return;
                            try {
                                await api.raw('shareCancel', { share_id_list: [row._id] });
                                ui.toast('已取消分享');
                                p.close();
                                shareTool.myList();
                            } catch (e) { ui.toast('取消失败：' + e.message, 'error'); }
                        });
                        box.append(cp, del);
                        return box;
                    } },
                ], rows, { maxHeight: '60vh' });
                listBox.appendChild(tb.el);
            } catch (e) {
                listBox.innerHTML = '<div class="qem-empty">加载失败：' + util.escapeHtml(e.message) + '</div>';
            }
        },
    };

    /* ======================================================================
     * 17. 回收站
     * ==================================================================== */

    const trash = {
        /** 计算剩余保留天数；优先用接口给出的过期字段，其次按删除时间+保留期估算 */
        remainDays(item) {
            if (item.remainDay !== undefined && item.remainDay !== null && item.remainDay !== '') return Number(item.remainDay);
            if (item.expiredAt) return Math.ceil((item.expiredAt - Date.now()) / 86400000);
            if (!item.time) return null;
            const retention = Math.max(1, Number(config.get('trash.retentionDays', 30)) || 30);
            return Math.ceil(retention - (Date.now() - item.time) / 86400000);
        },

        async fetchList(size = 200) {
            const rr = await api.raw('recycleList', { page: 1, size });
            return ((rr.data && rr.data.list) || []).map((x) => ({
                name: x.file_name || x.name || '',
                size: Number(x.size || 0),
                dir: !!(x.dir || x.file_type === 0),
                time: x.updated_at || x.deleted_at || x.created_at || 0,
                fid: String(x.fid || ''),
                remainDay: x.remain_day !== undefined ? x.remain_day : (x.remaining_day !== undefined ? x.remaining_day : undefined),
                expiredAt: x.expired_at || x.expire_at || 0,
            }));
        },

        /** 临期项目（默认 3 天内过期） */
        async expiring(days = null) {
            const n = days === null ? (Number(config.get('trash.warnDays', 3)) || 3) : days;
            const list = await this.fetchList(200);
            return list.filter((it) => {
                const r = this.remainDays(it);
                return r !== null && r <= n;
            });
        },

        /** 工作台打开时静默检查一次 */
        async autoCheck() {
            if (!config.get('trash.autoCheck', true)) return;
            try {
                const soon = await this.expiring();
                if (!soon.length) return;
                const names = soon.slice(0, 3).map((x) => x.name).join('、');
                ui.toast(
                    `回收站有 ${soon.length} 项即将过期（${names}${soon.length > 3 ? ' 等' : ''}），过期后无法还原。可在「回收站」中处理。`,
                    'warn', 8000,
                );
            } catch (e) { /* 静默失败，不打扰用户 */ }
        },

        async open() {
            const p = ui.panel({ title: '回收站', size: 'lg', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
            const info = document.createElement('div');
            info.className = 'muted';
            info.textContent = t('loading');
            const listBox = document.createElement('div');
            listBox.style.marginTop = '10px';
            p.body.append(info, listBox);
            listBox.innerHTML = '<div class="qem-empty">' + t('loading') + '</div>';

            let rows = [];
            let picked = [];

            try {
                // 多取 1 条用于判断是否存在截断，避免静默漏项
                const fetched = await this.fetchList(201);
                const truncated = fetched.length > 200;
                rows = fetched.slice(0, 200);
                this._truncated = truncated;
            } catch (e) {
                info.textContent = '';
                listBox.innerHTML = `<div class="qem-empty">回收站加载失败：${util.escapeHtml(e.message)}<br><br>` +
                    '可能原因：未登录、接口路径调整（夸克网页端对该能力的支持并不稳定，部分账号/环境不可用）。<br>' +
                    '若持续失败，可在夸克 App 内管理回收站。</div>';
                return;
            }
            if (!rows.length) {
                info.innerHTML = `回收站是空的。夸克回收站默认保留 <b>${config.get('trash.retentionDays', 30)}</b> 天，过期自动永久删除。`;
                return;
            }

            const totalSize = rows.reduce((s, x) => s + x.size, 0);
            const withDays = rows.map((r2) => ({ ...r2, remain: this.remainDays(r2) }));
            const soon = withDays.filter((r2) => r2.remain !== null && r2.remain <= (Number(config.get('trash.warnDays', 3)) || 3));
            info.innerHTML = `共 <b>${rows.length}</b>${this._truncated ? '+' : ''} 项，合计 <b>${util.humanSize(totalSize)}</b>` +
                (this._truncated ? '（仅展示最近 200 条，更早的请在夸克 App 内查看）' : '') +
                `。回收站默认保留 ${config.get('trash.retentionDays', 30)} 天，过期自动永久删除。` +
                (soon.length ? `　<span class="qem-tag err">${soon.length} 项即将过期</span>` : '');

            listBox.innerHTML = '';
            const tb = ui.table([
                { key: 'name', label: '名称', render: (v, row) => `${row.dir ? '📁' : '📎'} ${util.escapeHtml(v)}` },
                { key: 'size', label: '大小', align: 'right', render: (v, row) => row.dir ? '-' : util.humanSize(v) },
                { key: 'time', label: '删除时间', render: (v) => util.escapeHtml(util.ts(v)) },
                { key: 'remain', label: '预计剩余', render: (v) => {
                    if (v === null || v === undefined || !isFinite(v)) return '<span class="muted">未知</span>';
                    const warnDays = Number(config.get('trash.warnDays', 3)) || 3;
                    const cls = v <= warnDays ? 'err' : (v <= warnDays * 2 ? 'warn' : '');
                    return `<span class="qem-tag ${cls}">${v <= 0 ? '今日过期' : v + ' 天'}</span>`;
                } },
            ], withDays, { maxHeight: '50vh', selectable: true, onSelectionChange: (r2) => { picked = r2; } });
            listBox.appendChild(tb.el);

            const acts = document.createElement('div');
            acts.className = 'row';
            acts.style.marginTop = '10px';
            acts.style.flexWrap = 'wrap';
            const restore = document.createElement('button');
            restore.className = 'primary';
            restore.textContent = '还原选中项';
            restore.addEventListener('click', async () => {
                const fids = (picked.length ? picked : withDays.filter((r2) => r2.remain !== null && r2.remain <= (Number(config.get('trash.warnDays', 3)) || 3))).map((x) => x.fid);
                if (!fids.length) return ui.toast('请先勾选要还原的项目（未勾选时默认还原临期项）', 'warn', 4000);
                try {
                    await api.raw('recycleRestore', { filelist: fids });
                    ui.toast(`已还原 ${fids.length} 项`);
                    capacityGuard.invalidate();
                    p.close(); trash.open();
                    if (state.ui) await workspace.reload();
                } catch (e) { ui.toast('还原失败：' + e.message, 'error'); }
            });
            const delForever = document.createElement('button');
            delForever.className = 'danger';
            delForever.textContent = '彻底删除选中项';
            delForever.addEventListener('click', async () => {
                const fids = (picked.length ? picked : withDays).map((x) => x.fid);
                if (!fids.length) return ui.toast(t('noSelection'), 'warn');
                const ok = await ui.confirm(`将永久删除 ${fids.length} 项，此操作不可撤销、无法还原。是否继续？`, { danger: true, okText: '永久删除' });
                if (!ok) return;
                try {
                    await api.raw('recycleDelete', { filelist: fids });
                    ui.toast(`已永久删除 ${fids.length} 项`);
                    p.close(); trash.open();
                } catch (e) { ui.toast('删除失败：' + e.message, 'error'); }
            });
            const clear = document.createElement('button');
            clear.className = 'danger';
            clear.textContent = '清空回收站';
            clear.addEventListener('click', async () => {
                const ok = await ui.confirm('将清空回收站全部内容，此操作不可撤销、无法还原。是否继续？', { danger: true, okText: '清空回收站' });
                if (!ok) return;
                try {
                    await api.raw('recycleClear', {});
                    ui.toast('回收站已清空');
                    capacityGuard.invalidate();
                    p.close(); trash.open();
                } catch (e) { ui.toast('清空失败：' + e.message, 'error'); }
            });
            acts.append(restore, delForever, clear);
            listBox.appendChild(acts);

            const tip = document.createElement('div');
            tip.className = 'muted';
            tip.style.marginTop = '8px';
            tip.textContent = '「预计剩余」按删除时间与设置的保留期估算，实际以夸克官方为准；若接口返回了官方过期时间则优先采用官方值。';
            listBox.appendChild(tip);
        },
    };

    /* ======================================================================
     * 18. 设置面板
     * ==================================================================== */

    const settings = {
        open(tab = 'general') {
            const p = ui.panel({
                title: t('navSettings'), size: 'md',
                buttons: [{ label: t('close'), onClick: (a) => a.close() }],
            });
            const tabs = document.createElement('div');
            tabs.className = 'qem-tabs';
            const body = document.createElement('div');
            body.className = 'col';
            p.body.style.padding = '0';
            p.body.append(tabs, body);
            body.style.padding = '12px 14px';

            const TAB_DEFS = [
                { key: 'general', label: '常规' },
                { key: 'reliability', label: '可靠性' },
                { key: 'dedup', label: '查重清理' },
                { key: 'download', label: '下载' },
                { key: 'play', label: '播放 / 搜图' },
                { key: 'keymap', label: '快捷键' },
                { key: 'data', label: '数据' },
                { key: 'about', label: '关于' },
            ];

            function renderTabs(active) {
                tabs.innerHTML = '';
                TAB_DEFS.forEach((d) => {
                    const b = document.createElement('button');
                    b.className = 'qem-tab' + (d.key === active ? ' active' : '');
                    b.textContent = d.label;
                    b.addEventListener('click', () => renderTabs(d.key));
                    tabs.appendChild(b);
                });
                renderBody(active);
            }

            function renderBody(active) {
                body.innerHTML = '';
                const c = config.data;

                if (active === 'general') {
                    const f = ui.form([
                        { key: 'theme', label: '外观', type: 'select', value: c.theme, options: [
                            { value: 'auto', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
                        ] },
                        { key: 'folderFirst', label: '文件夹置顶', type: 'checkbox', value: c.folderFirst },
                        { key: 'clickAction', label: '双击文件', type: 'select', value: c.clickAction, options: [
                            { value: 'preview', label: '内置预览' }, { value: 'download', label: '加入下载' },
                        ] },
                        { key: 'turbo', label: '请求节流', type: 'checkbox', value: c.turbo, hint: '开启后按并发+间隔限速，可显著降低被风控概率；关闭将全速请求' },
                        { key: 'concurrency', label: '并发数', type: 'number', value: c.concurrency, min: 1, max: 10 },
                        { key: 'minInterval', label: '最小间隔(ms)', type: 'number', value: c.minInterval, min: 0, max: 5000 },
                        { key: 'exportFormat', label: '目录树默认格式', type: 'select', value: c.exportFormat, options: [
                            { value: 'md', label: 'Markdown' }, { value: 'txt', label: '纯文本' }, { value: 'json', label: 'JSON' },
                        ] },
                        { key: 'density', label: '默认行密度', type: 'select', value: c.view.density,
                            options: viewPref.DENSITIES.map((d) => ({ value: d, label: viewPref.LABEL[d] })) },
                        { key: 'thumb', label: '默认显示缩略图', type: 'checkbox', value: c.view.thumb },
                        { key: 'perDir', label: '视图偏好按目录独立', type: 'checkbox', value: c.view.perDir,
                            hint: '开启后在工作台点密度/缩略图按钮只改变当前目录；关闭则所有目录统一用上面的默认值' },
                    ], () => {
                        const v = { ...f.values };
                        const view = { density: v.density, thumb: !!v.thumb, perDir: !!v.perDir };
                        delete v.density; delete v.thumb; delete v.perDir;
                        v.concurrency = Number(v.concurrency);
                        v.minInterval = Number(v.minInterval);
                        Object.assign(config.data, v);
                        config.data.view = view;
                        config.save();
                        ui.applyTheme();
                    });
                    body.appendChild(f.el);
                }

                if (active === 'reliability') {
                    const f = ui.form([
                        { key: 'policy', label: '同名文件', type: 'select', value: c.conflict.policy, options: conflict.POLICIES,
                            hint: '移动 / 粘贴 / 转存遇到目标目录已有同名项时的默认处理方式' },
                        { key: 'undoMax', label: '撤销栈条数', type: 'number', value: c.undo.max, min: 1, max: 200,
                            hint: '本地保留最近多少次可撤销操作' },
                        { key: 'threshold', label: '熔断阈值', type: 'number', value: c.breaker.threshold, min: 2, max: 50,
                            hint: '接口连续失败达到该次数后暂停请求' },
                        { key: 'cooldown', label: '熔断时长(ms)', type: 'number', value: c.breaker.cooldown, min: 3000, max: 300000 },
                        { key: 'capacityWarn', label: '容量预警阈值', type: 'number', value: c.capacityWarn, min: 0.5, max: 0.99,
                            hint: '使用率超过该比例时在工作台提示（0.95 = 95%）' },
                        { key: 'retentionDays', label: '回收站保留期', type: 'number', value: c.trash.retentionDays, min: 1, max: 365,
                            hint: '夸克回收站默认 30 天，用于估算「预计剩余天数」' },
                        { key: 'warnDays', label: '临期预警天数', type: 'number', value: c.trash.warnDays, min: 1, max: 30 },
                        { key: 'autoCheck', label: '打开工作台时检查临期', type: 'checkbox', value: c.trash.autoCheck },
                    ], () => {
                        config.data.conflict.policy = f.values.policy;
                        config.data.undo.max = Number(f.values.undoMax) || 20;
                        config.data.breaker.threshold = Number(f.values.threshold) || 6;
                        config.data.breaker.cooldown = Number(f.values.cooldown) || 30000;
                        config.data.capacityWarn = Number(f.values.capacityWarn) || 0.95;
                        config.data.trash.retentionDays = Number(f.values.retentionDays) || 30;
                        config.data.trash.warnDays = Number(f.values.warnDays) || 3;
                        config.data.trash.autoCheck = !!f.values.autoCheck;
                        config.save();
                    });
                    body.appendChild(f.el);

                    const cap = document.createElement('div');
                    cap.className = 'drop';
                    cap.style.marginTop = '10px';
                    cap.innerHTML = '<div class="muted">正在读取容量...</div>';
                    body.appendChild(cap);

                    const acts = document.createElement('div');
                    acts.className = 'row';
                    acts.style.marginTop = '10px';
                    acts.style.flexWrap = 'wrap';

                    const mk = (label, fn, cls) => {
                        const b = document.createElement('button');
                        b.textContent = label;
                        if (cls) b.className = cls;
                        b.addEventListener('click', fn);
                        acts.appendChild(b);
                        return b;
                    };
                    mk('立即解除熔断', (e) => {
                        breaker.reset();
                        e.target.textContent = '已解除';
                        setTimeout(() => { e.target.textContent = '立即解除熔断'; }, 1500);
                    });
                    mk('查看操作历史', () => opLog.open());
                    mk('目录快照', () => { p.close(); snapshot.open(); });
                    mk('检查回收站临期', async () => {
                        try {
                            const soon = await trash.expiring();
                            if (!soon.length) return ui.toast(`回收站没有 ${config.get('trash.warnDays', 3)} 天内过期的项目`, 'info', 4000);
                            ui.toast(`回收站有 ${soon.length} 项即将过期，已为你打开回收站`, 'warn', 5000);
                            p.close(); trash.open();
                        } catch (e) { ui.toast('检查失败：' + e.message, 'error'); }
                    });
                    mk('导出操作日志', () => {
                        const arr = opLog.list();
                        if (!arr.length) return ui.toast('暂无记录', 'warn');
                        util.saveTextFile(`qem_操作日志_${Date.now()}.json`, JSON.stringify(arr, null, 2), 'application/json');
                    });
                    mk('清空撤销栈', async () => {
                        const ok = await ui.confirm('清空操作历史？清空后这些操作将无法再撤销。', { danger: true, okText: '清空' });
                        if (!ok) return;
                        opLog.clear(); ui.toast('已清空'); settings.open('reliability');
                    }, 'danger');
                    body.appendChild(acts);

                    const stateLine = document.createElement('div');
                    stateLine.className = 'muted';
                    stateLine.style.marginTop = '8px';
                    stateLine.textContent = `当前熔断状态：${breaker.isOpen() ? `已熔断，剩余 ${Math.ceil(breaker.remainMs() / 1000)} 秒` : `正常（连续失败 ${breaker.fails}/${breaker.threshold()} 次）`}　|　撤销栈 ${opLog.list().length} 条`;
                    body.appendChild(stateLine);

                    capacityGuard.summary().then((s) => {
                        if (!s) { cap.innerHTML = '<div class="muted">容量读取失败（未登录或接口异常）</div>'; return; }
                        cap.innerHTML = `<div>已用 <b>${util.humanSize(s.used)}</b> / ${util.humanSize(s.total)}（${(s.pct * 100).toFixed(1)}%），剩余 <b>${util.humanSize(s.remain)}</b>${s.vip ? '　·　' + util.escapeHtml(String(s.vip)) : ''}</div>`;
                    });
                }

                if (active === 'dedup') {
                    const f = ui.form([
                        { key: 'keep', label: '保留策略', type: 'select', value: c.dedup.keep, options: [
                            { value: 'new', label: '保留最新的' }, { value: 'old', label: '保留最旧的' },
                            { value: 'large', label: '保留最大的' }, { value: 'small', label: '保留最小的' },
                            { value: 'short', label: '保留名称最短的' }, { value: 'long', label: '保留名称最长的' },
                        ] },
                        { key: 'minSize', label: '忽略小于', value: c.dedup.minSize, placeholder: '如 10MB' },
                        { key: 'threshold', label: '文件夹相似阈值', type: 'number', value: c.folderDedup.threshold, min: 0.5, max: 1 },
                        { key: 'exclude', label: '扫描排除关键词', value: c.scan.exclude, placeholder: '逗号分隔，命中名称的文件/文件夹不会被扫描' },
                        { key: 'maxDepth', label: '最大递归深度', type: 'number', value: c.scan.maxDepth, min: 1, max: 50 },
                    ], () => {
                        config.data.dedup.keep = f.values.keep;
                        config.data.dedup.minSize = f.values.minSize;
                        config.data.folderDedup.threshold = Number(f.values.threshold) || 0.86;
                        config.data.scan.exclude = f.values.exclude;
                        config.data.scan.maxDepth = Number(f.values.maxDepth) || 20;
                        config.save();
                    });
                    body.appendChild(f.el);
                    const note = document.createElement('div');
                    note.className = 'muted';
                    note.style.marginTop = '8px';
                    note.textContent = '提示：查重默认只读不删，删除动作一律走回收站，可随时还原。';
                    body.appendChild(note);
                }

                if (active === 'download') {
                    const f = ui.form([
                        { key: 'downloader', label: '下载方式', type: 'select', value: c.downloader, options: [
                            { value: 'aria2', label: 'Aria2 JSON-RPC 推送' },
                            { value: 'idm', label: '导出 IDM 清单' },
                            { value: 'none', label: '浏览器直接下载' },
                        ] },
                        { key: 'rpc', label: 'Aria2 RPC', value: c.aria2.rpc, placeholder: 'http://127.0.0.1:6800/jsonrpc' },
                        { key: 'secret', label: 'RPC 密钥', type: 'password', value: c.aria2.secret },
                        { key: 'dir', label: '下载目录', value: c.aria2.dir, placeholder: '留空用 Aria2 默认目录' },
                    ], () => {
                        config.data.downloader = f.values.downloader;
                        config.data.aria2.rpc = f.values.rpc;
                        config.data.aria2.secret = f.values.secret;
                        config.data.aria2.dir = f.values.dir;
                        config.save();
                    });
                    body.appendChild(f.el);
                    const test = document.createElement('button');
                    test.textContent = '测试 Aria2 连接';
                    test.style.marginTop = '10px';
                    test.addEventListener('click', async () => {
                        try {
                            const params = [];
                            if (config.get('aria2.secret', '')) params.push('token:' + config.get('aria2.secret', ''));
                            params.push('aria2.getVersion');
                            const res = await fetch(config.get('aria2.rpc', ''), {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ jsonrpc: '2.0', id: 'test', method: 'aria2.getVersion', params }),
                            });
                            const j = await res.json();
                            if (j && j.result) ui.toast(`连接成功：Aria2 ${j.result.version || ''}`, 'info', 3500);
                            else ui.toast('连接失败：' + ((j && j.error && j.error.message) || '未知错误'), 'error', 4000);
                        } catch (e) {
                            ui.toast('无法连接 Aria2：' + e.message + '（请确认已启动 Aria2 并开启 RPC）', 'error', 5000);
                        }
                    });
                    body.appendChild(test);
                    const note = document.createElement('div');
                    note.className = 'muted';
                    note.style.marginTop = '8px';
                    note.textContent = '说明：浏览器无法绕过跨域直接调用本地 RPC 时，请为 Aria2 开启 --rpc-allow-origin-all。';
                    body.appendChild(note);
                }

                if (active === 'play') {
                    const f = ui.form([
                        { key: 'player', label: '默认播放器', type: 'select', value: c.player, options: [
                            { value: 'script', label: '夸克内置播放器' },
                            { value: 'potplayer', label: 'PotPlayer 协议直开' },
                            { value: 'other', label: '其他（复制直链）' },
                        ] },
                        { key: 'potplayerPath', label: 'PotPlayer 路径', value: c.potplayerPath, placeholder: '如 C:\\PotPlayer\\PotPlayerMini64.exe（留空用默认注册项）', hint: '填写后以 exe路径|播放地址 形式唤起，可绕过部分注册表异常' },
                        { key: 'imgSearch', label: '以图搜图引擎', type: 'select', value: c.imgSearch, options: [
                            { value: 'google', label: 'Google Lens（综合）' },
                            { value: 'yandex', label: 'Yandex（综合）' },
                            { value: 'saucenao', label: 'SauceNAO（Pixiv/插画）' },
                            { value: 'tracemoe', label: 'trace.moe（动漫截图）' },
                        ] },
                    ], () => {
                        config.data.player = f.values.player;
                        config.data.potplayerPath = f.values.potplayerPath;
                        config.data.imgSearch = f.values.imgSearch;
                        config.save();
                    });
                    body.appendChild(f.el);
                }

                if (active === 'keymap') {
                    const sc = config.get('shortcuts', {});
                    const fields = Object.keys(sc).map((k) => ({ key: k, label: k, value: sc[k] }));
                    const f = ui.form(fields, () => {
                        config.data.shortcuts = { ...sc, ...f.values };
                        config.save();
                    });
                    body.appendChild(f.el);
                    const note = document.createElement('div');
                    note.className = 'muted';
                    note.style.marginTop = '8px';
                    note.textContent = '格式示例：Alt+Q、Ctrl+Shift+K、F2、Delete。快捷键在输入框聚焦时自动失效，不会干扰正常输入。';
                    body.appendChild(note);
                }

                if (active === 'data') {
                    const acts = document.createElement('div');
                    acts.className = 'row';
                    acts.style.flexWrap = 'wrap';
                    const mk = (label, fn, cls) => {
                        const b = document.createElement('button');
                        b.textContent = label;
                        if (cls) b.className = cls;
                        b.addEventListener('click', fn);
                        acts.appendChild(b);
                    };
                    mk('导出配置', () => { util.saveTextFile(`qem_config_${Date.now()}.json`, config.export(), 'application/json'); });
                    mk('配置版本历史', () => { p.close(); cfgHistory.open(); });
                    mk('空间占用分析', () => { p.close(); spaceReport.open(); });
                    mk('失败记录（查看 / 重试）', () => { p.close(); failLog.open(); });
                    mk('跨账号迁移校验', () => { p.close(); crossCheck.exportFlow(); });
                    mk('清理目录级视图偏好', () => { viewPref.clearAll(); ui.toast('已清理'); });
                    mk('导入配置', () => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.json,application/json';
                        input.addEventListener('change', () => {
                            const file = input.files && input.files[0];
                            if (!file) return;
                            const fr = new FileReader();
                            fr.onload = () => {
                                if (config.import(String(fr.result))) { ui.toast('配置已导入'); settings.open('data'); ui.applyTheme(); }
                                else ui.toast('配置文件格式不正确', 'error');
                            };
                            fr.readAsText(file);
                        });
                        input.click();
                    });
                    mk('导出当前目录清单 CSV', () => exporter.csv());
                    mk('清理缓存', () => config.clearCaches());
                    mk('重置全部设置', async () => {
                        const ok = await ui.confirm('将恢复所有设置到默认值，是否继续？', { danger: true, okText: '重置' });
                        if (!ok) return;
                        config.reset(); ui.applyTheme(); ui.toast('已重置'); settings.open('data');
                    }, 'danger');
                    body.appendChild(acts);

                    const info = document.createElement('div');
                    info.className = 'muted';
                    info.style.marginTop = '12px';
                    info.textContent = '配置文件为纯 JSON，可跨设备导入；配置每次改动会自动留痕（5 分钟节流，最多 20 版），可随时回滚。查重/目录树的全盘索引缓存为临时数据，可随时清理。';
                    body.appendChild(info);
                }

                if (active === 'about') {
                    const box = document.createElement('div');
                    box.className = 'col';
                    box.innerHTML = `
<div><b>夸克增强大师</b> v${VERSION}</div>
<div class="muted">夸克网盘增强用户脚本，移植自 PikPak Enhancement Master v5.3.0（作者 digbug82），保留其核心功能定位与交互范式，全部实现按夸克网盘接口重写。</div>
<div class="muted">许可：AGPL-3.0-or-later（与原项目一致，衍生作品需同样开源）。</div>
<div style="margin-top:6px"><b>接口校准</b></div>
<div class="muted">当前使用的接口基址：<span class="qem-mono">${util.escapeHtml(API_BASE)}</span></div>
<div class="muted">若夸克改版导致某项功能失效，可在脚本头部 <span class="qem-mono">EP</span> 表中调整对应路径与字段，无需改动业务逻辑。</div>
<div style="margin-top:6px"><b>安全说明</b></div>
<div class="muted">脚本不读取、不上传你的账号凭证；所有请求由夸克页面同源发起，凭据即浏览器自身的登录态。所有删除动作仅移入回收站。</div>
`;
                    body.appendChild(box);
                    const diag = document.createElement('button');
                    diag.textContent = '运行自检';
                    diag.style.marginTop = '10px';
                    diag.addEventListener('click', async () => {
                        const pr = ui.progress('自检中');
                        const results = [];
                        const check = async (label, fn) => {
                            try { const r = await fn(); results.push({ label, ok: true, msg: typeof r === 'string' ? r : '正常' }); }
                            catch (e) { results.push({ label, ok: false, msg: e.message }); }
                        };
                        await check('登录态（读取容量）', async () => { const c = await api.capacity(); return `容量 ${util.humanSize(c.total)}`; });
                        await check('目录列表', async () => { const r = await api.list(ROOT_FID, { size: 1 }); return `可见 ${r.total} 项`; });
                        await check('回收站', async () => { await api.raw('recycleList', { page: 1, size: 1 }, { retry: 0 }); return '可用'; });
                        await check('直链接口', async () => { const r = await api.list(ROOT_FID, { size: 20 }); const f = r.items.find((x) => !x.dir); if (!f) return '当前目录无文件，跳过'; await api.downloadUrls([f.fid]); return '可用'; });
                        pr.close();
                        const rp = ui.panel({ title: '自检结果', size: 'sm', buttons: [{ label: t('close'), onClick: (a) => a.close() }] });
                        rp.body.appendChild(ui.table([
                            { key: 'label', label: '检查项' },
                            { key: 'msg', label: '结果', render: (v, row) => `<span class="qem-tag ${row.ok ? 'ok' : 'err'}">${row.ok ? '通过' : '失败'}</span> ${util.escapeHtml(v)}` },
                        ], results, { maxHeight: '50vh' }).el);
                    });
                    body.appendChild(diag);
                }
            }

            renderTabs(tab);
        },
    };

    /* ======================================================================
     * 19. 快捷键
     * ==================================================================== */

    const shortcutMgr = {
        normalize(e) {
            const parts = [];
            if (e.ctrlKey) parts.push('Ctrl');
            if (e.altKey) parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');
            let key = e.key;
            if (key === ' ') key = 'Space';
            if (key && key.length === 1) key = key.toUpperCase();
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return '';
            parts.push(key);
            return parts.join('+');
        },

        bind() {
            document.addEventListener('keydown', (e) => {
                const sc = config.get('shortcuts', {});
                const combo = this.normalize(e);
                if (!combo) return;

                // 面板开关键全局生效
                if (combo === sc.panel) {
                    e.preventDefault();
                    if (state.ui && state.ui.el && state.ui.el.isConnected) state.ui.close();
                    else workspace.open();
                    return;
                }
                if (combo === sc.settings) { e.preventDefault(); settings.open(); return; }

                // 其余快捷键：面板打开时生效；且不在输入框内
                const tag = (e.target && e.target.tagName) || '';
                const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
                if (typing) return;
                const panelOpen = !!(state.ui && state.ui.el && state.ui.el.isConnected);
                if (!panelOpen) return;

                // Ctrl+F：聚焦筛选框（固定行为，不占用自定义快捷键位）
                if (combo === 'Ctrl+F') { e.preventDefault(); if (workspace.focusSearch) workspace.focusSearch(); return; }

                // 方向键导航：↑↓ 移动游标，Shift 连选，Home/End 首尾，Enter 打开
                if (!e.ctrlKey && !e.altKey) {
                    const nav = {
                        ArrowDown: () => workspace.moveCursor(1, { extend: e.shiftKey }),
                        ArrowUp: () => workspace.moveCursor(-1, { extend: e.shiftKey }),
                        Home: () => workspace.moveCursor(0, { absolute: 'home', extend: e.shiftKey }),
                        End: () => workspace.moveCursor(0, { absolute: 'end', extend: e.shiftKey }),
                        Enter: () => workspace.openItem(),
                    };
                    if (nav[e.key]) { e.preventDefault(); nav[e.key](); return; }
                }

                const actions = {
                    [sc.refresh]: () => workspace.reload(),
                    [sc.rename]: () => renameTool.open(),
                    [sc.newFolder]: () => workspace.newFolder(),
                    [sc.del]: () => workspace.deleteSelection(),
                    [sc.download]: () => downloader.downloadSelection(),
                    [sc.dedup]: () => dedup.openFiles(),
                    [sc.insight]: () => insight.open(),
                    [sc.selectAll]: () => { state.selection = new Set(workspace.visible().map((i) => i.fid)); workspace.render(); },
                    [sc.invert]: () => {
                        const next = new Set();
                        workspace.visible().forEach((i) => { if (!state.selection.has(i.fid)) next.add(i.fid); });
                        state.selection = next;
                        workspace.render();
                    },
                    [sc.escape]: () => {
                        // 有筛选先清筛选（否则用户看不清为什么全选只选到几项）
                        if (state.query) { workspace.clearQuery(); return; }
                        sel.clear();
                        workspace.render();
                    },
                    [sc.copy]: () => { state.clipboard = { mode: 'copy', items: sel.items() }; ui.toast(`已复制 ${sel.count()} 项到剪贴板`); },
                    [sc.cut]: () => { state.clipboard = { mode: 'cut', items: sel.items() }; ui.toast(`已剪切 ${sel.count()} 项`); },
                    [sc.paste]: async () => {
                        const cb = state.clipboard;
                        if (!cb.items.length) return ui.toast('剪贴板为空', 'warn');
                        const target = await picker.chooseFolder('粘贴到哪个文件夹');
                        if (target === null) return;
                        if (target === state.cwd) return ui.toast('目标目录就是当前目录，无需粘贴', 'warn');
                        try {
                            const plan = await conflict.resolve(target, cb.items, { label: '粘贴' });
                            if (plan.action === 'abort') return;
                            if (plan.needRename.length) {
                                await api.renameMany(plan.needRename.map((r) => ({ fid: r.fid, file_name: r.file_name })));
                            }
                            const fids = plan.toMove.map((x) => x.fid);
                            if (!fids.length) return ui.toast('全部项目因同名被跳过', 'warn');
                            await api.move(fids, target);
                            opLog.push({
                                type: 'move',
                                label: '粘贴（移动）',
                                entries: plan.toMove.map((x) => ({ fid: x.fid, name: (x.item || {}).name || '', pdir: (x.item || {}).pdir_fid, toPdir: target })),
                                note: plan.skipped.length ? `跳过 ${plan.skipped.length} 个同名项` : '',
                            });
                            ui.toast(`已粘贴 ${fids.length} 项` + (plan.skipped.length ? `，跳过 ${plan.skipped.length} 个同名项` : ''));
                            if (cb.mode === 'cut') state.clipboard = { mode: null, items: [] };
                            await workspace.reload();
                        } catch (err) { ui.toast('粘贴失败：' + err.message, 'error'); }
                    },
                    [sc.undo]: () => workspace.undoLatest(),
                    [sc.history]: () => opLog.open(),
                };
                const fn = actions[combo];
                if (fn) { e.preventDefault(); fn(); }
            }, true);
        },
    };

    /* ======================================================================
     * 20. 悬浮球与启动
     * ==================================================================== */

    const fab = {
        el: null,

        mount() {
            if (this.el && this.el.isConnected) return;
            const btn = document.createElement('button');
            btn.className = 'qem-fab ' + (config.get('fab.pos', 'br') || 'br');
            btn.textContent = '☁';
            btn.title = `${t('appTitle')}　${config.get('shortcuts.panel', 'Alt+Q')} 打开工作台`;
            btn.addEventListener('click', () => workspace.open());
            // 拖拽定位
            let dragging = false;
            let moved = false;
            let sx = 0; let sy = 0;
            btn.addEventListener('mousedown', (e) => {
                dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 5) return;
                moved = true;
                btn.className = 'qem-fab';
                btn.style.left = (e.clientX - 23) + 'px';
                btn.style.top = (e.clientY - 23) + 'px';
                btn.style.right = 'auto';
                btn.style.bottom = 'auto';
            });
            document.addEventListener('mouseup', () => {
                if (!dragging) return;
                dragging = false;
                if (moved) {
                    const r = btn.getBoundingClientRect();
                    config.data.fab = { pos: 'custom', x: r.left, y: r.top, hidden: false };
                    config.save();
                }
            });
            ui.scope.appendChild(btn);
            this.el = btn;
            this.apply();
        },

        apply() {
            if (!this.el) return;
            const f = config.get('fab', {});
            if (f.pos === 'custom' && f.x != null) {
                this.el.style.left = f.x + 'px';
                this.el.style.top = f.y + 'px';
                this.el.style.right = 'auto';
                this.el.style.bottom = 'auto';
            } else {
                this.el.className = 'qem-fab ' + (f.pos || 'br');
            }
            this.el.style.display = f.hidden ? 'none' : '';
        },
    };

    function bindMenu() {
        try {
            if (typeof GM_registerMenuCommand !== 'function') return;
            GM_registerMenuCommand('打开工作台', () => workspace.open());
            GM_registerMenuCommand('批量重命名', () => renameTool.open());
            GM_registerMenuCommand('文件查重', () => dedup.openFiles());
            GM_registerMenuCommand('资源清理', () => cleanup.open());
            GM_registerMenuCommand('目录树导出', () => exporter.tree());
            GM_registerMenuCommand('解析分享链接', () => shareTool.parse());
            GM_registerMenuCommand('我的分享', () => shareTool.myList());
            GM_registerMenuCommand('全盘搜索', () => finder.openGlobal());
            GM_registerMenuCommand('失败记录', () => failLog.open());
            GM_registerMenuCommand('空间占用分析', () => spaceReport.open());
            GM_registerMenuCommand('跨账号校验：导出账号清单', () => crossCheck.exportFlow());
            GM_registerMenuCommand('跨账号校验：导入并比对', () => crossCheck.compareFlow());
            GM_registerMenuCommand('配置版本历史', () => cfgHistory.open());
            GM_registerMenuCommand('回收站', () => trash.open());
            GM_registerMenuCommand('设置', () => settings.open());
        } catch (e) { /* 部分管理器不支持，忽略 */ }
    }

    function bootstrap() {
        config.load();
        ui.ensureHost();
        bindMenu();
        shortcutMgr.bind();

        // 页面导航时同步工作台目录（若面板已打开）
        window.addEventListener('hashchange', () => {
            if (!state.ui || !state.ui.el || !state.ui.el.isConnected) return;
            const m = /#\/list\/[^/]*\/([0-9a-fA-F]{16,})/.exec(location.hash);
            if (m && m[1] && m[1] !== state.cwd) {
                state.path.push({ fid: m[1], name: '已同步目录' });
                workspace.reload(m[1]);
            }
        });

        // 主题跟随系统变化
        if (window.matchMedia) {
            try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => ui.applyTheme()); } catch (e) { /* 旧内核忽略 */ }
        }

        window.addEventListener('load', () => {
            fab.mount();
            if (!config.get('fab.hidden', false)) {
                setTimeout(() => ui.toast('夸克增强大师已就绪，点击右下角悬浮球或按 ' + config.get('shortcuts.panel', 'Alt+Q') + ' 打开工作台', 'info', 5000), 800);
            }
        }, { once: true });
        if (document.readyState === 'complete') {
            fab.mount();
        }

        // 暴露调试入口（不污染业务逻辑）
        try {
            const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            w.__QEM__ = {
                version: VERSION,
                config, api, guard, breaker, EP, util, fileModel, scanner, indexCache, ui,
                renameRules, parseSize, nameSimilarity,
                opLog, conflict, capacityGuard, snapshot, cfgHistory, spaceReport, deleteWithUndo, crossCheck, viewPref,
                workspace, finder, failLog, dedup, cleanup, exporter, shareTool, trash, settings,
                downloader, player, imgSearch, insight, preview, property, picker, state, sel,
                fab, shortcutMgr,
            };
        } catch (e) { /* 忽略 */ }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }

})();
