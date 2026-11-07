# my-plugins

个人插件库，集中存放各类扩展/插件。后续新插件直接往 `extensions/` 目录添加 `.ts` 文件即可。

## 在其它电脑上使用

### 首次安装

1. **安装 pi**（如已安装则跳过）

2. **登录对应服务**（以 DeepSeek 为例）
   - 启动 pi，输入 `/login deepseek`，粘贴 API Key
   - API Key 在 https://platform.deepseek.com 的 API Keys 页面获取
   - 凭据只存本机 `~/.pi/agent/auth.json`，不会随仓库同步

3. **安装本插件库**（在系统终端执行，不是 pi 内）
   ```bash
   pi install git:github.com/shenliang34/my-plugins@main
   ```

4. **加载**
   - pi 输入框输入 `/reload`

完成后即可使用各插件（如底部余额显示、`/balance` 命令等）。

### 更新同步

因为使用 `@main` 分支安装，pi 会在**每次启动或 `/reload` 时自动拉取最新代码**，无需手动操作。作者 push 新版本后，各电脑 `/reload` 一下即可同步。

### 卸载

某台电脑不再需要本库时，在系统终端执行：

```bash
pi remove git:github.com/shenliang34/my-plugins@main
```

然后在 pi 里 `/reload`。

## 插件列表

### feishu-bot

把飞书消息桥接到本机 Pi Agent：在飞书单聊/群聊里发消息，Pi 在你指定的目录里读文件、写代码、跑命令，并把结果流式回复到飞书。

- `/feishu start` 启动机器人（长连接 WebSocket，无需公网服务器/内网穿透）
- `/feishu stop` 停止、`/feishu status` 查看状态、`/feishu setup` 查看配置步骤
- 每个飞书会话一个独立 Pi 会话，按 (会话, 工作目录) 持久化，重启后可恢复上下文
- 流式回复、长文本自动分片、工具调用进度提示、群聊 @ 机器人、消息去重/排队

**配置凭据**（密钥不随仓库提交）：

1. 复制 `extensions/feishu-bot/.env.example` 为 `~/.pi/agent/feishu-bot.env`
2. 填写 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（飞书开放平台「开发者后台 → 凭证与基础信息」）
3. 可选：`FEISHU_ALLOWED_DM_USERS` / `FEISHU_ALLOWED_GROUPS` 白名单、`PI_DEFAULT_CWD` 默认工作目录
4. pi 里 `/reload`，然后 `/feishu start`

创建应用可手动完成（详见扩展目录 `README` 或飞书开放平台），或运行：

```bash
npx tsx extensions/feishu-bot/register-app.ts
```

扫描二维码授权后自动创建应用并预填权限与事件订阅。

在飞书里可用 `!help`、`!cd <目录>`、`!status`、`!reset`、`!stop` 等命令。

### deepseek-balance

DeepSeek 账户余额查询 + 本次会话花费显示。

- 底部状态栏（footer）在模型名下方右侧实时显示「本次会话花费 · 账户余额」
- 每次对话结束自动刷新余额（HTTP 查询，不消耗 token）
- 提供 `/balance` 命令手动查询余额详情

依赖凭据：需在 pi 中用 `/login deepseek` 配置 DeepSeek API Key。

## 目录结构

```
my-plugins/
├── package.json          # pi 包清单，自动发现 extensions/*.ts
├── extensions/           # 所有扩展
│   ├── deepseek-balance.ts
│   └── feishu-bot/
│       ├── index.ts      # /feishu start|stop|status|setup
│       ├── config.ts     # 凭据/配置加载
│       ├── pi-manager.ts # 每个飞书会话一个 Pi 会话
│       ├── register-app.ts # 一键创建飞书应用（可选）
│       └── .env.example
├── CHANGELOG.md
└── README.md
```

## 开发

1. 在 `extensions/` 下新增或修改 `.ts` 文件
2. 更新 `CHANGELOG.md` 与 `package.json` 的 `version`
3. `git commit` 并 push 到 `main`
4. 各电脑 pi 里 `/reload` 即可同步
