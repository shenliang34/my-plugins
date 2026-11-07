/**
 * 每个飞书会话（chatId）维护一个独立的 Pi AgentSession。
 * 会话按 (chatId, 工作目录) 持久化到磁盘，重启后可恢复上下文。
 */
import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export interface ChatSessionState {
  session: AgentSession;
  cwd: string;
  busy: boolean;
  createdAt: number;
}

export class PiManager {
  private chats = new Map<string, ChatSessionState>();

  constructor(
    private readonly defaultCwd: string,
    private readonly sessionsDir: string,
  ) {}

  get size(): number {
    return this.chats.size;
  }

  get(chatId: string): ChatSessionState | undefined {
    return this.chats.get(chatId);
  }

  private sessionDirFor(chatId: string, cwd: string): string {
    const hash = createHash("sha1")
      .update(`${chatId}\u0000${cwd}`)
      .digest("hex")
      .slice(0, 24);
    return path.join(this.sessionsDir, hash);
  }

  /** 获取或创建会话；cwd 省略时用默认工作目录。 */
  async getOrCreate(chatId: string, cwd?: string): Promise<ChatSessionState> {
    const existing = this.chats.get(chatId);
    if (existing) return existing;

    const targetCwd = path.resolve(cwd ?? this.defaultCwd);
    const sessionManager = SessionManager.continueRecent(
      targetCwd,
      this.sessionDirFor(chatId, targetCwd),
    );
    const { session } = await createAgentSession({ cwd: targetCwd, sessionManager });

    const state: ChatSessionState = {
      session,
      cwd: targetCwd,
      busy: false,
      createdAt: Date.now(),
    };
    this.chats.set(chatId, state);
    return state;
  }

  /** 重置会话：丢弃当前上下文，从空会话重新开始。 */
  async reset(chatId: string): Promise<ChatSessionState> {
    const cwd = this.chats.get(chatId)?.cwd ?? this.defaultCwd;
    await this.disposeChat(chatId);

    const sessionManager = SessionManager.create(
      cwd,
      this.sessionDirFor(chatId, cwd),
    );
    const { session } = await createAgentSession({ cwd, sessionManager });

    const state: ChatSessionState = {
      session,
      cwd,
      busy: false,
      createdAt: Date.now(),
    };
    this.chats.set(chatId, state);
    return state;
  }

  /** 切换工作目录（每个目录有独立的会话上下文）。 */
  async switchCwd(chatId: string, cwd: string): Promise<ChatSessionState> {
    const resolved = path.resolve(cwd);
    if (!existsSync(resolved)) {
      throw new Error(`目录不存在：${resolved}`);
    }
    if (!statSync(resolved).isDirectory()) {
      throw new Error(`不是目录：${resolved}`);
    }

    await this.disposeChat(chatId);

    const sessionManager = SessionManager.continueRecent(
      resolved,
      this.sessionDirFor(chatId, resolved),
    );
    const { session } = await createAgentSession({ cwd: resolved, sessionManager });

    const state: ChatSessionState = {
      session,
      cwd: resolved,
      busy: false,
      createdAt: Date.now(),
    };
    this.chats.set(chatId, state);
    return state;
  }

  private async disposeChat(chatId: string): Promise<void> {
    const existing = this.chats.get(chatId);
    if (!existing) return;
    this.chats.delete(chatId);
    try {
      if (existing.session.isStreaming) {
        await existing.session.abort();
      }
    } catch {
      // ignore abort errors
    }
    try {
      existing.session.dispose();
    } catch {
      // ignore dispose errors
    }
  }

  disposeAll(): void {
    for (const chatId of [...this.chats.keys()]) {
      const existing = this.chats.get(chatId);
      if (!existing) continue;
      this.chats.delete(chatId);
      try {
        if (existing.session.isStreaming) {
          void existing.session.abort();
        }
      } catch {
        // ignore
      }
      try {
        existing.session.dispose();
      } catch {
        // ignore
      }
    }
    this.chats.clear();
  }
}
