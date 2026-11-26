import { useState } from "react";
import { Search, Copy, Trash2, Check } from "lucide-react";

interface LogsPageProps {
  logs: string[];
  onClear: () => void;
}

type LogLevelFilter = "ALL" | "INFO" | "WARN" | "ERROR";

export function LogsPage({ logs, onClear }: LogsPageProps) {
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<LogLevelFilter>("ALL");
  const [copied, setCopied] = useState(false);

  const filtered = logs.filter((line) => {
    const upper = line.toUpperCase();
    const matchesLevel =
      level === "ALL" ||
      (level === "ERROR" && (upper.includes("ERROR") || upper.includes("FATAL"))) ||
      (level === "WARN" && upper.includes("WARN")) ||
      (level === "INFO" && upper.includes("INFO"));
    const matchesSearch = line.toLowerCase().includes(search.toLowerCase());
    return matchesLevel && matchesSearch;
  });

  const handleCopy = async () => {
    try {
      const cleanText = filtered
        .map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""))
        .join("\n");
      await navigator.clipboard.writeText(cleanText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="page-container">
      <div className="servers-header">
        <div>
          <h2 className="page-title">Логи туннеля</h2>
          <div className="servers-subtitle">
            Показано {filtered.length} из {logs.length} строк
          </div>
        </div>

        <div className="servers-actions">
          <button
            className="check-btn"
            onClick={handleCopy}
            title="Копировать логи"
          >
            {copied ? <Check size={14} color="var(--accent)" /> : <Copy size={14} />}
            {copied ? "Скопировано" : "Копировать"}
          </button>
          <button
            className="check-btn"
            onClick={onClear}
            title="Очистить логи"
          >
            <Trash2 size={14} />
            Очистить
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div className="search-bar" style={{ flex: 1 }}>
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Поиск по логам..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="core-selector">
          {(["ALL", "INFO", "WARN", "ERROR"] as LogLevelFilter[]).map((lvl) => (
            <button
              key={lvl}
              className={`core-btn ${level === lvl ? "active" : ""}`}
              onClick={() => setLevel(lvl)}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      <div
        className="settings-card"
        style={{
          flex: 1,
          alignItems: "flex-start",
          overflowY: "auto",
          fontFamily: "monospace",
          fontSize: 12,
          flexDirection: "column",
          gap: 4,
          userSelect: "text",
        }}
      >
        {filtered.length === 0 ? (
          <span style={{ color: "var(--text-muted)" }}>
            {logs.length === 0
              ? "Логов пока нет. Подключитесь к серверу на Главной."
              : "Ничего не найдено по текущему фильтру."}
          </span>
        ) : (
          filtered.map((line, idx) => {
            const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
            const upper = clean.toUpperCase();
            const color =
              upper.includes("ERROR") || upper.includes("FATAL")
                ? "#f87171"
                : upper.includes("WARN")
                ? "#fbbf24"
                : "var(--text-primary)";
            return (
              <div key={idx} style={{ color, wordBreak: "break-all" }}>
                {clean}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
