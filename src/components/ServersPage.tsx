import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Search,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Zap,
  Star,
  Plus,
  ClipboardPaste,
  Trash2,
  Check,
} from "lucide-react";
import { SubscriptionGroup, ServerNode, parseProxyUri } from "../utils/parser";

interface ServersPageProps {
  groups: SubscriptionGroup[];
  setGroups: React.Dispatch<React.SetStateAction<SubscriptionGroup[]>>;
  selectedServerId: string;
  userAgent?: string;
  sendHwid?: boolean;
  pingTimeoutMs?: number;
  pingMethod?: "tcp" | "http_head" | "http_get" | "icmp";
  onNotify?: (
    kind: "watchdog" | "sub" | "expire" | "killswitch" | "connect",
    title: string,
    body: string
  ) => void;
  onSelectServer: (server: ServerNode) => void;
}

export function ServersPage({
  groups,
  setGroups,
  selectedServerId,
  userAgent,
  sendHwid,
  pingTimeoutMs,
  pingMethod,
  onNotify,
  onSelectServer,
}: ServersPageProps) {
  const [search, setSearch] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showAddBox, setShowAddBox] = useState(false);
  const [uriInput, setUriInput] = useState("");
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [subNameInput, setSubNameInput] = useState("");
  const [subIntervalInput, setSubIntervalInput] = useState(6);

  const totalServers = groups.reduce((acc, g) => acc + g.servers.length, 0);

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const collapseAll = () => {
    const anyExpanded = groups.some((g) => !collapsed[g.id]);
    const next: Record<string, boolean> = {};
    groups.forEach((g) => {
      next[g.id] = anyExpanded;
    });
    setCollapsed(next);
  };

  const handleAutoBest = async () => {
    const updatedGroups = await Promise.all(
      groups.map(async (g) => {
        const servers = await Promise.all(
          g.servers.map(async (s) => {
            try {
              const ms =
                pingMethod === "icmp"
                  ? await invoke<number>("ping_icmp", {
                      address: s.address,
                      timeoutMs: pingTimeoutMs || 2000,
                    })
                  : await invoke<number>("ping_server", {
                      address: s.address,
                      port: s.port,
                      timeoutMs: pingTimeoutMs || 2000,
                    });
              return { ...s, ping: ms };
            } catch {
              return { ...s, ping: undefined };
            }
          })
        );
        return { ...g, servers };
      })
    );
    setGroups(updatedGroups);
    const all = updatedGroups.flatMap((g) => g.servers).filter((s) => s.ping !== undefined);
    if (all.length > 0) {
      all.sort((a, b) => (a.ping ?? 9999) - (b.ping ?? 9999));
      onSelectServer(all[0]);
    }
  };

  const parseUserInfo = (userinfo?: string | null) => {
    if (!userinfo) return {};
    const map: Record<string, number> = {};
    userinfo.split(";").forEach((part) => {
      const [k, v] = part.trim().split("=");
      if (k && v) map[k.trim()] = Number(v.trim());
    });
    const used = (map.upload || 0) + (map.download || 0);
    const total = map.total || 0;
    const fmt = (b: number) =>
      b >= 1024 ** 3
        ? `${(b / 1024 ** 3).toFixed(1)} GB`
        : `${(b / 1024 ** 2).toFixed(0)} MB`;
    return {
      trafficUsed: used > 0 ? fmt(used) : undefined,
      trafficTotal: total > 0 ? fmt(total) : "∞",
    };
  };
  const handleRefreshGroup = async (group: SubscriptionGroup) => {
    if (!group.url) return;
    try {
      const res = await invoke<{ body: string; userinfo?: string | null }>(
        "fetch_subscription",
        { url: group.url, userAgent: userAgent || null, sendHwid: !!sendHwid }
      );
      let decoded = res.body.trim();
      if (!decoded.includes("://")) {
        try {
          decoded = atob(decoded);
        } catch {
          // keep as-is
        }
      }
      const parsed = decoded
        .split(/\r?\n/)
        .map((l) => parseProxyUri(l.trim()))
        .filter((n): n is ServerNode => n !== null);
      if (parsed.length > 0) {
        const info = parseUserInfo(res.userinfo);
        setGroups((prev) =>
          prev.map((g) =>
            g.id === group.id
              ? { ...g, updatedAt: "только что", ...info, servers: parsed }
              : g
          )
        );
        onNotify?.("sub", "Подписка обновлена", `${group.name}: ${parsed.length} серверов`);
      }
    } catch {
      onNotify?.("sub", "Ошибка обновления подписки", group.name);
    }
  };

  const handlePingAll = async () => {
    const updatedGroups = await Promise.all(
      groups.map(async (g) => {
        const servers = await Promise.all(
          g.servers.map(async (s) => {
            try {
              const ms =
                pingMethod === "icmp"
                  ? await invoke<number>("ping_icmp", {
                      address: s.address,
                      timeoutMs: pingTimeoutMs || 2000,
                    })
                  : await invoke<number>("ping_server", {
                      address: s.address,
                      port: s.port,
                      timeoutMs: pingTimeoutMs || 2000,
                    });
              return { ...s, ping: ms };
            } catch {
              return { ...s, ping: undefined };
            }
          })
        );
        return { ...g, servers };
      })
    );
    setGroups(updatedGroups);
  };

  const toggleFavorite = (groupId: string, serverId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              servers: g.servers.map((s) =>
                s.id === serverId ? { ...s, favorite: !s.favorite } : s
              ),
            }
      )
    );
  };

  const deleteServer = (groupId: string, serverId: string) => {
    const next = groups.map((g) =>
      g.id !== groupId
        ? g
        : { ...g, servers: g.servers.filter((s) => s.id !== serverId) }
    );
    setGroups(next);
    if (serverId === selectedServerId) {
      const fallback = next.flatMap((g) => g.servers)[0] || {
        id: "",
        name: "Сервер не выбран",
        protocol: "VLESS" as const,
        address: "",
        port: 443,
        rawUri: "",
      };
      onSelectServer(fallback);
    }
  };

  const handleAddUri = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("{")) {
      try {
        JSON.parse(trimmed);
        const node: ServerNode = {
          id: crypto.randomUUID(),
          name: "Custom JSON Config",
          protocol: "VLESS",
          security: "JSON",
          address: "custom",
          port: 443,
          rawUri: `raw-json://${trimmed}`,
        };
        setGroups((prev) => [
          {
            id: crypto.randomUUID(),
            name: "Свой JSON",
            updatedAt: "только что",
            servers: [node],
          },
          ...prev,
        ]);
        setUriInput("");
        setShowAddBox(false);
        return;
      } catch {
        // invalid JSON
      }
    }

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      try {
        const res = await invoke<{ body: string; userinfo?: string | null }>(
          "fetch_subscription",
          { url: trimmed, userAgent: userAgent || null, sendHwid: !!sendHwid }
        );
        let decoded = res.body.trim();
        if (!decoded.includes("://")) {
          try {
            decoded = atob(decoded);
          } catch {
            // keep as-is if not base64
          }
        }
        const parsed = decoded
          .split(/\r?\n/)
          .map((l) => parseProxyUri(l.trim()))
          .filter((n): n is ServerNode => n !== null);

        if (parsed.length > 0) {
          const subName = new URL(trimmed).hostname;
          const info = parseUserInfo(res.userinfo);
          setGroups((prev) => [
            {
              id: crypto.randomUUID(),
              name: subName,
              url: trimmed,
              updatedAt: "только что",
              intervalHours: 6,
              ...info,
              servers: parsed,
            },
            ...prev,
          ]);
        }
      } catch (err) {
        console.error(err);
      }
      setUriInput("");
      setShowAddBox(false);
      return;
    }

    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed: ServerNode[] = [];
    for (const line of lines) {
      const node = parseProxyUri(line);
      if (node) parsed.push(node);
    }
    if (parsed.length === 0) return;

    setGroups((prev) => {
      const manualIdx = prev.findIndex((g) => g.id === "manual");
      if (manualIdx !== -1) {
        const updated = [...prev];
        updated[manualIdx] = {
          ...updated[manualIdx],
          servers: [...parsed, ...updated[manualIdx].servers],
        };
        return updated;
      }
      return [
        {
          id: "manual",
          name: "Мои серверы",
          updatedAt: "только что",
          servers: parsed,
        },
        ...prev,
      ];
    });
    setUriInput("");
    setShowAddBox(false);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await invoke<string>("read_clipboard");
      if (text) {
        await handleAddUri(text);
      } else {
        setShowAddBox(true);
      }
    } catch {
      setShowAddBox(true);
    }
  };

  return (
    <div className="page-container">
      <div className="servers-header">
        <div>
          <h2 className="page-title">Серверы</h2>
          <div className="servers-subtitle">
            {totalServers} серверов · {groups.length} групп
          </div>
        </div>

        <div className="servers-actions">
          <button
            className="icon-btn"
            onClick={collapseAll}
            title="Свернуть / развернуть все"
          >
            <ChevronDown size={16} />
          </button>
          <button
            className="check-btn"
            onClick={handleAutoBest}
            title="Выбрать самый быстрый сервер"
          >
            Автовыбор
          </button>
          <button
            className="icon-btn"
            onClick={handlePingAll}
            title="Пинг всех серверов"
          >
            <Zap size={16} />
          </button>
          <button
            className={`icon-btn ${onlyFavorites ? "active" : ""}`}
            onClick={() => setOnlyFavorites(!onlyFavorites)}
            title="Только избранные"
          >
            <Star size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={handlePasteFromClipboard}
            title="Вставить из буфера"
          >
            <ClipboardPaste size={16} />
          </button>
          <button
            className="icon-btn accent"
            onClick={() => setShowAddBox(!showAddBox)}
            title="Добавить сервер или подписку"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {showAddBox && (
        <div className="add-box">
          <textarea
            className="add-textarea"
            rows={3}
            placeholder="Вставьте ссылки (vless://, vmess://, trojan://, hy2://)..."
            value={uriInput}
            onChange={(e) => setUriInput(e.target.value)}
          />
          <div className="add-box-actions">
            <button className="check-btn" onClick={() => setShowAddBox(false)}>
              Отмена
            </button>
            <button
              className="primary-btn"
              onClick={() => handleAddUri(uriInput)}
            >
              Добавить
            </button>
          </div>
        </div>
      )}

      <div className="search-bar">
        <Search size={15} className="search-icon" />
        <input
          type="text"
          className="search-input"
          placeholder="Поиск серверов..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="groups-list">
        {groups.map((group) => {
          const filtered = group.servers.filter((s) => {
            const matchesSearch = s.name
              .toLowerCase()
              .includes(search.toLowerCase());
            const matchesFav = !onlyFavorites || s.favorite;
            return matchesSearch && matchesFav;
          });

          const isCollapsed = !!collapsed[group.id];

          return (
            <div key={group.id} className="group-card">
              <div
                className="group-header"
                onClick={() => toggleGroup(group.id)}
              >
                <div className="group-title-row">
                  {isCollapsed ? (
                    <ChevronRight size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                  <span className="group-name">{group.name}</span>
                  <span className="group-count">{filtered.length}</span>
                </div>
                <div className="group-meta">
                  <span>{group.updatedAt}</span>
                  {group.trafficUsed && (
                    <span>
                      {group.trafficUsed} / {group.trafficTotal || "∞"}
                    </span>
                  )}
                  <button
                    className="row-icon-btn"
                    title="Обновить подписку"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRefreshGroup(group);
                    }}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    className="row-icon-btn"
                    title="Настройки подписки"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSubId(group.id);
                      setSubNameInput(group.name);
                      setSubIntervalInput(group.intervalHours || 6);
                    }}
                  >
                    ⚙
                  </button>
                </div>
              </div>

              {!isCollapsed && (
                <div className="group-servers">
                  {filtered.map((server) => {
                    const isSelected = server.id === selectedServerId;
                    return (
                      <div
                        key={server.id}
                        className={`server-row ${isSelected ? "selected" : ""}`}
                        onClick={() => onSelectServer(server)}
                      >
                        <div className="server-row-left">
                          <div className="server-row-name">
                            {isSelected && (
                              <Check
                                size={14}
                                style={{ color: "var(--accent)" }}
                              />
                            )}
                            <span>{server.name}</span>
                          </div>
                          <div className="badges">
                            <span className="badge badge-vless">
                              {server.protocol}
                            </span>
                            {server.transport && (
                              <span
                                className="badge"
                                style={{
                                  background: "rgba(255,255,255,0.08)",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {server.transport}
                              </span>
                            )}
                            {server.security && (
                              <span className="badge badge-reality">
                                {server.security}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="server-row-right">
                          <span
                            className="server-ping"
                            style={{
                              color: !server.ping
                                ? "var(--text-muted)"
                                : server.ping < 80
                                ? "#34d399"
                                : server.ping < 150
                                ? "#fbbf24"
                                : "#f87171",
                            }}
                          >
                            {server.ping ? `${server.ping} ms` : "—"}
                          </span>
                          <button
                            className="row-icon-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(group.id, server.id);
                            }}
                          >
                            <Star
                              size={14}
                              fill={server.favorite ? "#eab308" : "none"}
                              color={server.favorite ? "#eab308" : "currentColor"}
                            />
                          </button>
                          <button
                            className="row-icon-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteServer(group.id, server.id);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editingSubId && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: 420,
              background: "var(--bg-card)",
              backdropFilter: "blur(24px)",
              border: "1px solid var(--glass-border)",
              borderRadius: 16,
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16 }}>Настройки подписки</div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                Отображаемое имя
              </div>
              <input
                type="text"
                className="search-input"
                style={{ paddingLeft: 12 }}
                value={subNameInput}
                onChange={(e) => setSubNameInput(e.target.value)}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                Интервал автообновления
              </div>
              <div className="core-selector" style={{ flexWrap: "wrap" }}>
                {[
                  { h: 0.5, label: "30 мин" },
                  { h: 1, label: "1 ч" },
                  { h: 2, label: "2 ч" },
                  { h: 6, label: "6 ч" },
                  { h: 12, label: "12 ч" },
                  { h: 24, label: "24 ч" },
                ].map((opt) => (
                  <button
                    key={opt.h}
                    className={`core-btn ${subIntervalInput === opt.h ? "active" : ""}`}
                    onClick={() => setSubIntervalInput(opt.h)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
              <button
                className="check-btn"
                style={{ color: "#f87171", borderColor: "rgba(248,113,113,0.35)" }}
                onClick={() => {
                  const next = groups.filter((g) => g.id !== editingSubId);
                  setGroups(next);
                  setEditingSubId(null);
                  const stillExists = next.some((g) =>
                    g.servers.some((s) => s.id === selectedServerId)
                  );
                  if (!stillExists) {
                    const fallback = next[0]?.servers[0] || {
                      id: "",
                      name: "Сервер не выбран",
                      protocol: "VLESS" as const,
                      address: "",
                      port: 443,
                      rawUri: "",
                    };
                    onSelectServer(fallback);
                  }
                }}
              >
                Удалить
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="check-btn" onClick={() => setEditingSubId(null)}>
                  Отмена
                </button>
                <button
                  className="primary-btn"
                  onClick={() => {
                    setGroups((prev) =>
                      prev.map((g) =>
                        g.id === editingSubId
                          ? { ...g, name: subNameInput.trim() || g.name, intervalHours: subIntervalInput }
                          : g
                      )
                    );
                    setEditingSubId(null);
                  }}
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
