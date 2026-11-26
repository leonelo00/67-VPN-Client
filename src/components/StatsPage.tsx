import { Activity, ArrowDown, ArrowUp, Clock, Cpu } from "lucide-react";

export interface SpeedPoint {
  up: number;
  down: number;
}

interface StatsPageProps {
  connected: boolean;
  core: string;
  seconds: number;
  speedUp: number;
  speedDown: number;
  maxUp: number;
  maxDown: number;
  sessionBytes: number;
  totalBytes: number;
  history: SpeedPoint[];
  formatTime: (sec: number) => string;
  formatSpeed: (bytes: number) => string;
  formatBytes: (bytes: number) => string;
}

export function StatsPage({
  connected,
  core,
  seconds,
  speedUp,
  speedDown,
  maxUp,
  maxDown,
  sessionBytes,
  totalBytes,
  history,
  formatTime,
  formatSpeed,
  formatBytes,
}: StatsPageProps) {
  const avgDown = seconds > 0 ? Math.round(sessionBytes / seconds) : 0;
  const maxVal = Math.max(
    1024,
    ...history.map((p) => Math.max(p.up, p.down))
  );

  const buildPath = (key: "up" | "down") => {
    if (history.length < 2) return "";
    const width = 600;
    const height = 140;
    return history
      .map((pt, idx) => {
        const x = (idx / (history.length - 1)) * width;
        const y = height - (pt[key] / maxVal) * (height - 16) - 8;
        return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  return (
    <div className="page-container">
      <h2 className="page-title">Статистика</h2>

      <div className="speed-grid">
        <div className="speed-card">
          <span className="speed-label">
            <Clock size={13} /> Время сессии
          </span>
          <span className="speed-value">{formatTime(seconds)}</span>
        </div>

        <div className="speed-card">
          <span className="speed-label">
            <Activity size={13} /> Трафик за сессию
          </span>
          <span className="speed-value">{formatBytes(sessionBytes)}</span>
        </div>

        <div className="speed-card">
          <span className="speed-label">
            <ArrowDown size={13} /> Download (пик: {formatSpeed(maxDown)})
          </span>
          <span className="speed-value" style={{ color: "var(--accent)" }}>
            {formatSpeed(speedDown)}
          </span>
        </div>

        <div className="speed-card">
          <span className="speed-label">
            <ArrowUp size={13} /> Upload (пик: {formatSpeed(maxUp)})
          </span>
          <span className="speed-value" style={{ color: "#60a5fa" }}>
            {formatSpeed(speedUp)}
          </span>
        </div>

        <div className="speed-card">
          <span className="speed-label">
            <Activity size={13} /> Средняя скорость
          </span>
          <span className="speed-value">{formatSpeed(avgDown)}</span>
        </div>

        <div className="speed-card">
          <span className="speed-label">
            <Activity size={13} /> Всего за всё время
          </span>
          <span className="speed-value">{formatBytes(totalBytes)}</span>
        </div>
      </div>

      <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>
            График скорости (последние 60 сек)
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <Cpu size={13} />
            {connected ? `Активно (${core})` : "Отключено"}
          </span>
        </div>

        <svg
          viewBox="0 0 600 140"
          style={{
            width: "100%",
            height: 150,
            background: "var(--bg-primary)",
            borderRadius: 8,
            border: "1px solid var(--border-color)",
          }}
        >
          {history.length >= 2 && (
            <>
              <path
                d={buildPath("down")}
                fill="none"
                stroke="#22c55e"
                strokeWidth="2.2"
              />
              <path
                d={buildPath("up")}
                fill="none"
                stroke="#60a5fa"
                strokeWidth="2"
              />
            </>
          )}
        </svg>

        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 3, background: "#22c55e", display: "inline-block" }} />
            Download
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 3, background: "#60a5fa", display: "inline-block" }} />
            Upload
          </span>
        </div>
      </div>
    </div>
  );
}
