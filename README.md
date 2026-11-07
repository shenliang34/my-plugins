# pi-plugins

个人 pi coding agent 插件库，集中存放各类扩展。后续新插件直接往 `extensions/` 目录添加 `.ts` 文件即可。

## 安装

在目标电脑上执行（需已安装 pi 并登录对应服务）：

```bash
pi install git:github.com/shenliang34/pi-plugins@main
```

安装后输入 `/reload` 加载。

> 用 `@main` 分支安装，pi 会在每次启动或 `/reload` 时自动拉取该分支最新代码，实现多台电脑同步更新。

## 插件列表

### deepseek-balance

DeepSeek 账户余额查询 + 本次会话花费显示。

- 底部状态栏（footer）在模型名下方右侧实时显示「本次会话花费 · 账户余额」
- 每次对话结束自动刷新余额（HTTP 查询，不消耗 token）
- 提供 `/balance` 命令手动查询余额详情

依赖凭据：需在 pi 中用 `/login deepseek` 配置 DeepSeek API Key（存于本机 `~/.pi/agent/auth.json`，不会随仓库同步）。

## 目录结构

```
pi-plugins/
├── package.json          # pi 包清单，自动发现 extensions/*.ts
├── extensions/           # 所有扩展
│   └── deepseek-balance.ts
├── CHANGELOG.md
└── README.md
```

## 开发

1. 在 `extensions/` 下新增或修改 `.ts` 文件
2. 更新 `CHANGELOG.md` 与 `package.json` 的 `version`
3. `git commit` 并 push 到 `main`
4. 各电脑 `pi` 里 `/reload` 即可同步
