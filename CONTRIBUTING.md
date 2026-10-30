# 参与开发

## 环境

- Node.js 18+
- 浏览器安装 Tampermonkey 或 Violentmonkey（仅手动安装时需要）

脚本是单文件产物：`Quark_Enhancement_Master.user.js`，直接修改该文件，没有构建步骤。

## 本地验证

```bash
npm install
npm run verify
```

`npm run verify` 依次执行：

- `npm run check` — `node --check` 语法检查
- `npm run lint` — ESLint
- `npm test` — jsdom 冒烟测试（300+ 条断言）

界面评审可以跑：

```bash
npm run preview
```

预览页不需要登录夸克网盘。

## PR 约定

- 一个 PR 只做一件事。
- 修 bug 时在 `tests/smoke-test.js` 补一条能复现的用例。
- 说明复现步骤、修复前后行为、验证命令。
- 保持单文件结构，不引入构建链或运行时依赖。
- 不提交 Cookie、账号信息、分享口令、真实文件列表等个人数据。
- 本项目是 [PikPak Enhancement Master](https://github.com/digbug82/PikPak_Enhancement_Master) 的衍生作品，贡献按 **AGPL-3.0-or-later** 授权；请保留上游署名与 `NOTICE.md`。
