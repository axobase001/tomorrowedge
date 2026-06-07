import { useCallback, useEffect, useState } from "react";
import type { CockpitApiOptions, SecretEntry } from "../api.js";
import { deleteSecret, listSecrets, saveSecret } from "../api.js";

type SecretPanelProps = {
  apiOptions: CockpitApiOptions;
  onClose: () => void;
};

type ProviderState = SecretEntry & {
  editing: boolean;
  pendingKey: string;
  saving: boolean;
  deleting: boolean;
};

const PROVIDER_ICON: Record<string, string> = {
  deepseek: "🧠", openai: "🤖", anthropic: "🎭",
  openrouter: "🔀", gemini: "💎", kimi: "🌙", mimo: "🦊",
};

const PROVIDER_DOT_COLORS: Record<string, string> = {
  deepseek: "#4f46e5", openai: "#10a37f", anthropic: "#d97706",
  openrouter: "#6366f1", gemini: "#4285f4", kimi: "#8b5cf6", mimo: "#f97316",
};

export function SecretPanel({ apiOptions, onClose }: SecretPanelProps) {
  const [providers, setProviders] = useState<ProviderState[]>([]);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);

  const load = useCallback(async () => {
    try {
      const entries = await listSecrets(apiOptions);
      setProviders(entries.map((e) => ({ ...e, editing: false, pendingKey: "", saving: false, deleting: false })));
    } catch {
      setMessage({ text: "加载 API Key 列表失败。", type: "error" });
    }
  }, [apiOptions]);

  useEffect(() => { void load(); }, [load]);

  const showMsg = (text: string, type: "ok" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const set = (provider: string, patch: Partial<ProviderState>) =>
    setProviders((p) => p.map((i) => i.provider === provider ? { ...i, ...patch } : i));

  const handleSave = async (provider: string) => {
    const cur = providers.find((i) => i.provider === provider);
    if (!cur || !cur.pendingKey.trim()) return;
    set(provider, { saving: true });
    try {
      const result = await saveSecret(provider, cur.pendingKey.trim(), apiOptions);
      set(provider, { ...result, editing: false, pendingKey: "", saving: false });
      showMsg(`${provider} API Key 已保存。`, "ok");
    } catch {
      showMsg(`保存 ${provider} 失败。`, "error");
      set(provider, { saving: false });
    }
  };

  const handleDelete = async (provider: string) => {
    set(provider, { deleting: true });
    try {
      await deleteSecret(provider, apiOptions);
      set(provider, { configured: false, maskedKey: undefined, editing: false, deleting: false });
      showMsg(`${provider} API Key 已删除。`, "ok");
    } catch {
      showMsg(`删除 ${provider} 失败。`, "error");
      set(provider, { deleting: false });
    }
  };

  const configured = providers.filter((p) => p.configured).length;
  const total = providers.length;

  return (
    <div className="te-setup-backdrop" data-testid="secret-panel">
      <section className="te-secret-card">
        {/* ---- Header ---- */}
        <header className="te-secret-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="te-secret-icon">🔑</span>
            <div>
              <div className="te-secret-title">API Key 管理</div>
              <div className="te-secret-subtitle">{configured} / {total} 已配置</div>
            </div>
          </div>
          <button type="button" className="te-secret-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>

        {/* ---- Progress bar ---- */}
        <div className="te-secret-progress">
          <div
            className="te-secret-progress-bar"
            style={{ width: `${total ? (configured / total) * 100 : 0}%` }}
          />
        </div>

        {/* ---- Toast ---- */}
        {message && (
          <div className={`te-secret-toast ${message.type === "ok" ? "te-secret-toast-ok" : "te-secret-toast-err"}`}>
            {message.type === "ok" ? "✅ " : "⚠️ "}{message.text}
          </div>
        )}

        {/* ---- Provider list ---- */}
        <div className="te-secret-body">
          {providers.map((p) => {
            const dotColor = PROVIDER_DOT_COLORS[p.provider] ?? "#94a3b8";
            return (
              <div key={p.provider} className={`te-secret-row${p.configured ? "" : " unconfigured"}`}>
                {/* Provider name + status */}
                <div className="te-secret-row-top">
                  <div className="te-secret-provider">
                    <span
                      className={`te-secret-dot${p.configured ? " active" : ""}`}
                      style={{ background: p.configured ? dotColor : undefined }}
                    />
                    <div>
                      <span className="te-secret-name">
                        {(PROVIDER_ICON[p.provider] ?? "🔌")} {p.provider}
                      </span>
                      {p.configured && p.maskedKey && (
                        <div className="te-secret-key">{p.maskedKey}</div>
                      )}
                    </div>
                  </div>
                  <span className={`te-secret-status ${p.configured ? "ok" : "no"}`}>
                    {p.configured ? "● 已连接" : "○ 未配置"}
                  </span>
                </div>

                {/* Edit area */}
                {p.editing ? (
                  <div className="te-secret-edit">
                    <div className="te-secret-edit-row">
                      <input
                        type="password"
                        className="te-secret-input"
                        placeholder={`输入 ${p.provider} API Key…`}
                        value={p.pendingKey}
                        autoFocus
                        onChange={(e) => set(p.provider, { pendingKey: e.target.value })}
                      />
                      <button
                        type="button"
                        className="te-btn-save"
                        disabled={!p.pendingKey.trim() || p.saving}
                        onClick={() => handleSave(p.provider)}
                      >
                        {p.saving ? "…" : "保存"}
                      </button>
                      <button type="button" className="te-btn-cancel" onClick={() => set(p.provider, { editing: false, pendingKey: "" })}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Actions */
                  <div className="te-secret-actions">
                    {p.configured ? (
                      <>
                        <button type="button" className="te-btn-sm" onClick={() => set(p.provider, { editing: true, pendingKey: "" })}>
                          编辑
                        </button>
                        <button
                          type="button"
                          className="te-btn-sm danger"
                          disabled={p.deleting}
                          onClick={() => handleDelete(p.provider)}
                        >
                          {p.deleting ? "删除中…" : "删除"}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="te-btn-add" onClick={() => set(p.provider, { editing: true, pendingKey: "" })}>
                        + 添加 API Key
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ---- Footer ---- */}
        <div className="te-secret-footer">
          🔐 Keys 通过 AES-256 加密存储在 <span>~/.tomorrowedge/secrets.enc</span>
        </div>
      </section>
    </div>
  );
}
