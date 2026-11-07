/**
 * 一键创建飞书自建应用（扫码授权），自动预填消息权限与事件订阅。
 * 运行：npx tsx extensions/feishu-bot/register-app.ts
 * 结果：输出 App ID 与 App Secret，填入 ~/.pi/agent/feishu-bot.env 即可。
 */
import { registerApp } from "@larksuiteoapi/node-sdk";

try {
  const result = await registerApp({
    addons: {
      scopes: {
        tenant: ["im:message", "im:message:send_as_bot"],
      },
      events: {
        items: { tenant: ["im.message.receive_v1"] },
      },
    },
    createOnly: true,
    onQRCodeReady(info) {
      console.log("\n请用飞书扫描下方二维码（或打开链接）授权创建应用：\n");
      console.log(`   ${info.url}`);
      console.log(`\n（链接 ${info.expireIn} 秒内有效）\n`);
    },
    onStatusChange(info) {
      console.log("状态：", info.status);
    },
  });

  console.log("\n✅ 应用创建成功！\n");
  console.log("App ID:    ", result.client_id);
  console.log("App Secret:", result.client_secret);
  console.log(
    "\n请把以上两个值填入 ~/.pi/agent/feishu-bot.env 的 FEISHU_APP_ID 和 FEISHU_APP_SECRET。\n",
  );
  console.log(
    "⚠️ 创建后还需在开放平台「版本管理与发布」中发布应用，机器人才会生效。\n",
  );
} catch (e) {
  const err = e as { code?: string; description?: string; message?: string };
  console.error("创建失败：", err.code ?? err.message ?? "", err.description ?? "");
  process.exit(1);
}
