/**
 * ESLint 扁平配置（无外部预设依赖，仅需 eslint 本体）
 * 规则集聚焦「能抓到真实缺陷」的一类：未声明标识符、重复声明、不可达代码、
 * 危险的动态执行、以及未使用变量提示。
 */

/** 浏览器 + 用户脚本管理器注入的全局 */
const browserAndGM = {
    window: 'readonly', document: 'readonly', console: 'readonly',
    localStorage: 'readonly', sessionStorage: 'readonly', navigator: 'readonly', location: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
    queueMicrotask: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
    fetch: 'readonly', Blob: 'readonly', File: 'readonly', FileReader: 'readonly', FormData: 'readonly',
    URL: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
    MutationObserver: 'readonly', ResizeObserver: 'readonly', IntersectionObserver: 'readonly',
    AbortController: 'readonly', CustomEvent: 'readonly', Event: 'readonly', KeyboardEvent: 'readonly',
    Node: 'readonly', Element: 'readonly', HTMLElement: 'readonly', HTMLInputElement: 'readonly',
    getComputedStyle: 'readonly', isSecureContext: 'readonly', structuredClone: 'readonly',
    crypto: 'readonly', performance: 'readonly', matchMedia: 'readonly',
    globalThis: 'readonly', Intl: 'readonly', unsafeWindow: 'readonly',
    // —— 用户脚本管理器 API
    GM_setValue: 'readonly', GM_getValue: 'readonly', GM_deleteValue: 'readonly', GM_listValues: 'readonly',
    GM_setClipboard: 'readonly', GM_registerMenuCommand: 'readonly', GM_unregisterMenuCommand: 'readonly',
    GM_xmlhttpRequest: 'readonly', GM_info: 'readonly', GM_notification: 'readonly', GM_addStyle: 'readonly',
};

const coreRules = {
    // 抓真实缺陷：未声明标识符（打字错误、漏声明）
    'no-undef': 'error',
    'no-redeclare': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-duplicate-case': 'error',
    'no-unreachable': 'error',
    'no-cond-assign': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-constant-binary-expression': 'error',
    'no-self-assign': 'error',
    'no-self-compare': 'error',
    'no-unsafe-negation': 'error',
    'no-unsafe-optional-chaining': 'error',
    'no-fallthrough': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
    'no-obj-calls': 'error',
    'no-control-regex': 'error',
    'no-return-assign': 'error',
    'no-sequences': 'error',
    'no-async-promise-executor': 'error',
    // 安全
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    // 卫生
    'no-debugger': 'error',
    'no-alert': 'error',
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-useless-escape': 'warn',
    // 界面文案里有意使用全角空格做对齐（如 '　|　共 N 项'），仅禁止代码区的异常空白
    'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipComments: true, skipRegExps: true }],
};

export default [
    {
        ignores: ['node_modules/**', '*.zip'],
    },
    {
        // 用户脚本：单文件 IIFE，挂载浏览器与 GM 全局
        files: ['Quark_Enhancement_Master.user.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: browserAndGM,
        },
        rules: coreRules,
    },
    {
        // 测试与构建脚本：Node 环境
        files: ['tests/**/*.js', '*.config.mjs', 'scripts/**/*.mjs', 'scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                require: 'readonly', module: 'readonly', exports: 'readonly', process: 'readonly',
                __dirname: 'readonly', __filename: 'readonly', console: 'readonly', Buffer: 'readonly',
                setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly',
            },
        },
        rules: {
            ...coreRules,
            'no-new-func': 'off',   // 测试需要用它注入用户脚本
        },
    },
];
