import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { APP_VERSION } from "../../version";
import { MarkdownText } from "../MarkdownText";

interface AboutSettingsProps {
  includePrerelease: boolean;
  onTogglePrerelease: (value: boolean) => void;
}

export function AboutSettings({
  includePrerelease,
  onTogglePrerelease,
}: AboutSettingsProps) {
  const [updateStatus, setUpdateStatus] = useState<{
    checking: boolean;
    hasUpdate?: boolean;
    latest?: string;
    url?: string;
    changelog?: string;
    isPrerelease?: boolean;
    error?: string;
  }>({ checking: false });
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);

  useEffect(() => {
    const unlisten = listen<{ percent: number }>("update-download-progress", (e) => {
      setDownloadPercent(e.payload.percent);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <>
      <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Приложение</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>67 VPN v{APP_VERSION}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Движок</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Rust + React (Tauri v2)</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>VPN-ядра</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>sing-box + Xray-core</span>
        </div>
      </div>

      <div className="settings-card">
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>Получать пре-релизы (Beta)</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>
            Ранние тестовые сборки — могут работать нестабильно
          </div>
        </div>
        <button
          className={`toggle-btn ${includePrerelease ? "active" : ""}`}
          onClick={() => onTogglePrerelease(!includePrerelease)}
        >
          {includePrerelease ? "Вкл" : "Выкл"}
        </button>
      </div>

      <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Текущая версия</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>v{APP_VERSION}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Новая версия</span>
          <span
            style={{
              fontWeight: 600,
              fontSize: 13,
              color: updateStatus.hasUpdate ? "var(--accent)" : "var(--text-primary)",
            }}
          >
            {updateStatus.latest ? `v${updateStatus.latest}` : "—"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="check-btn"
            style={{ flex: 1, justifyContent: "center" }}
            disabled={updateStatus.checking || downloadPercent !== null}
            onClick={async () => {
              setUpdateStatus({ checking: true });
              try {
                const res = await invoke<{
                  has_update: boolean;
                  latest_version: string;
                  url: string;
                  changelog: string;
                  is_prerelease: boolean;
                }>("check_github_update", {
                  repo: "leonelo00/67-VPN-Client",
                  currentVersion: APP_VERSION,
                  includePrerelease,
                });
                setUpdateStatus({
                  checking: false,
                  hasUpdate: res.has_update,
                  latest: res.latest_version,
                  url: res.url,
                  changelog: res.changelog,
                  isPrerelease: res.is_prerelease,
                });
              } catch (err) {
                setUpdateStatus({ checking: false, error: String(err) });
              }
            }}
          >
            {updateStatus.checking ? "Проверка..." : "Проверка обновлений"}
          </button>
          <button
            className="primary-btn"
            style={{
              flex: 1,
              opacity: updateStatus.hasUpdate && updateStatus.url && downloadPercent === null ? 1 : 0.45,
            }}
            disabled={!updateStatus.hasUpdate || !updateStatus.url || downloadPercent !== null}
            onClick={async () => {
              if (updateStatus.url) {
                setDownloadPercent(0);
                try {
                  await invoke("download_and_run_update", { url: updateStatus.url });
                } catch {
                  setDownloadPercent(null);
                  import("@tauri-apps/plugin-opener").then((m) => m.openUrl(updateStatus.url!));
                }
              }
            }}
          >
            {downloadPercent !== null ? `Скачивание ${downloadPercent}%...` : "Обновить"}
          </button>
        </div>
        {downloadPercent !== null && (
          <div
            style={{
              width: "100%",
              height: 6,
              borderRadius: 4,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${downloadPercent}%`,
                height: "100%",
                background: "var(--accent)",
                transition: "width 0.15s ease",
              }}
            />
          </div>
        )}
        {updateStatus.isPrerelease && (
          <div style={{ fontSize: 12, color: "#fbbf24" }}>
            Внимание: это пре-релиз (Beta), возможна нестабильная работа.
          </div>
        )}
        {updateStatus.error && (
          <div style={{ fontSize: 12, color: "#f87171" }}>{updateStatus.error}</div>
        )}
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            background: "rgba(0,0,0,0.28)",
            border: "1px solid var(--border-color)",
            fontSize: 12,
            color: "var(--text-secondary)",
            whiteSpace: "normal",
            minHeight: 80,
            maxHeight: 160,
            overflowY: "auto",
          }}
        >
          {updateStatus.changelog ? (
            <MarkdownText text={updateStatus.changelog} />
          ) : (
            "Changelog появится после проверки обновлений."
          )}
        </div>
      </div>
    </>
  );
}
