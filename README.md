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
│   └── deepseek-balance.ts
├── CHANGELOG.md
└── README.md
```

## 开发

1. 在 `extensions/` 下新增或修改 `.ts` 文件
2. 更新 `CHANGELOG.md` 与 `package.json` 的 `version`
3. `git commit` 并 push 到 `main`
4. 各电脑 pi 里 `/reload` 即可同步
