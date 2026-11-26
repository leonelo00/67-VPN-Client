import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Shield,
  Server,
  BarChart3,
  Terminal,
  Settings,
  Globe,
  Wifi,
  ArrowUp,
  ArrowDown,
  Clock,
  Activity,
  Minus,
  Square,
  X,
} from "lucide-react";
import { ServersPage } from "./components/ServersPage";
import { LogsPage } from "./components/LogsPage";
import { StatsPage, SpeedPoint } from "./components/StatsPage";
import {
  SettingsPage,
  AppSettings,
  defaultSettings,
} from "./components/SettingsPage";
import { SubscriptionGroup, ServerNode } from "./utils/parser";
import { buildCoreConfig, buildSingBoxTunBridgeConfig } from "./utils/configBuilder";
import logoImg from "./assets/logo.jpg";
import "./App.css";

type TabId = "home" | "servers" | "stats" | "logs" | "settings";
type ProxyMode = "tun" | "proxy";

export function App() {
  const isNotifyWindow =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("notify") === "1";

  if (isNotifyWindow) {
    return <NotifyPopup />;
  }

  return <MainApp />;
}

function NotifyPopup() {
  const params = new URLSearchParams(window.location.search);
  const [data, setData] = useState<{ title: string; body: string }>({
    title: params.get("title") || "67 VPN",
    body: params.get("body") || "",
  });

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    let timer: ReturnType<typeof setTimeout>;
    const hideLater = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        getCurrentWindow().hide().catch(() => {});
      }, 3600);
    };
    hideLater();
    const unlisten = listen<{ title: string; body: string }>("notify-data", (e) => {
      setData(e.payload);
      hideLater();
    });
    return () => {
      clearTimeout(timer);
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        padding: 12,
        background: "rgba(12, 16, 26, 0.92)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(52, 211, 153, 0.35)",
        borderRadius: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
        color: "#f8fafc",
        boxSizing: "border-box",
        cursor: "pointer",
      }}
      onClick={() => getCurrentWindow().hide().catch(() => {})}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: "rgba(52, 211, 153, 0.14)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Shield size={20} color="#34d399" />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {data.title}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {data.body}
        </div>
      </div>
    </div>
  );
}

function MainApp() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<ProxyMode>("tun");
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const core = settings.core;
  const [seconds, setSeconds] = useState(0);
  const [speedUp, setSpeedUp] = useState(0);
  const [speedDown, setSpeedDown] = useState(0);
  const [maxUp, setMaxUp] = useState(0);
  const [maxDown, setMaxDown] = useState(0);
  const [sessionBytes, setSessionBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [speedHistory, setSpeedHistory] = useState<SpeedPoint[]>([]);
  const [groups, setGroups] = useState<SubscriptionGroup[]>([
    {
      id: "demo-sub",
      name: "Demo Подписка",
      updatedAt: "только что",
      trafficUsed: "4.8 TB",
      trafficTotal: "∞",
      servers: [
        {
          id: "demo-1",
          name: "🇫🇮 Finland #1",
          protocol: "VLESS",
          security: "REALITY",
          address: "fi.example.com",
          port: 443,
          ping: 31,
          rawUri: "",
        },
        {
          id: "demo-2",
          name: "🇩🇪 Germany #2",
          protocol: "HY2",
          security: "QUIC",
          address: "de.example.com",
          port: 443,
          ping: 44,
          rawUri: "",
        },
      ],
    },
  ]);
  const [selectedServer, setSelectedServer] = useState<ServerNode>(
    groups[0]?.servers[0] || {
      id: "",
      name: "Сервер не выбран",
      protocol: "VLESS",
      address: "",
      port: 443,
      rawUri: "",
    }
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [updateModal, setUpdateModal] = useState<{
    version: string;
    url: string;
    changelog: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [serverDropdownOpen, setServerDropdownOpen] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };
  const notifyUser = (
    kind: "watchdog" | "sub" | "expire" | "killswitch" | "connect",
    title: string,
    body: string
  ) => {
    if (settings.notificationsEnabled === false) return;
    if (kind === "watchdog" && settings.notifyWatchdog === false) return;
    if (kind === "sub" && settings.notifySubUpdate === false) return;
    if (kind === "expire" && settings.notifySubExpire === false) return;
    if (kind === "killswitch" && settings.notifyKillSwitch === false) return;
    if (kind === "connect" && !settings.notifyConnect) return;
    invoke("send_notification", {
      title,
      body,
      style: settings.notificationStyle || "custom",
    }).catch(() => {});
  };
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    invoke<string>("load_state")
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.groups) && parsed.groups.length > 0) {
            setGroups(parsed.groups);
          }
          if (parsed.selectedServer) setSelectedServer(parsed.selectedServer);
          if (parsed.mode) setMode(parsed.mode);
          if (parsed.settings) {
            const merged = { ...defaultSettings, ...parsed.settings };
            setSettings(structuredClone(merged));
            invoke("set_log_limit", { limit: merged.logLimit || 2000 }).catch(() => {});
            invoke("set_minimize_to_tray", { enable: merged.minimizeToTray !== false }).catch(() => {});
            if (merged.startMinimized) {
              getCurrentWindow().hide().catch(() => {});
            }
          }
          if (typeof parsed.totalBytes === "number") setTotalBytes(parsed.totalBytes);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const payload = JSON.stringify({ groups, selectedServer, mode, settings, totalBytes });
    invoke("save_state", { data: payload }).catch(() => {});
  }, [groups, selectedServer, mode, settings, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const allServers = groups.flatMap((g) =>
      g.servers.map((s) => ({ id: s.id, name: s.name }))
    );
    invoke("update_tray_menu", {
      connected,
      servers: allServers,
      selectedId: selectedServer.id,
    }).catch(() => {});
  }, [groups, selectedServer, connected, loaded]);

  const trayHandlerRef = useRef<(action: string) => void>(() => {});
  trayHandlerRef.current = (action: string) => {
    if (action === "toggle_connect") {
      handleToggleConnect();
    } else if (action === "reconnect") {
      if (connected) {
        disconnectServer().then(() => connectServer());
      }
    } else if (action.startsWith("srv:")) {
      const srvId = action.slice(4);
      const found = groups
        .flatMap((g) => g.servers)
        .find((s) => s.id === srvId);
      if (found) setSelectedServer(found);
    }
  };

  const startupDoneRef = useRef(false);
  useEffect(() => {
    if (!loaded || startupDoneRef.current) return;
    startupDoneRef.current = true;
    if (settings.autoConnect && selectedServer.rawUri) {
      connectServer();
    }
    invoke<{
      has_update: boolean;
      latest_version: string;
      url: string;
      changelog: string;
    }>("check_github_update", {
      repo: "leonelo00/67-VPN-Client",
      currentVersion: "0.9.0",
    })
      .then((res) => {
        if (res.has_update) {
          setUpdateModal({
            version: res.latest_version,
            url: res.url,
            changelog: res.changelog,
          });
        }
      })
      .catch(() => {});
    if (settings.subUpdateOnStart) {
      const withUrl = groups.filter((g) => g.url);
      if (withUrl.length > 0) {
        Promise.all(
          withUrl.map(async (g) => {
            try {
              const res = await invoke<{ body: string; userinfo?: string | null }>(
                "fetch_subscription",
                {
                  url: g.url,
                  userAgent: settings.subUserAgent || null,
                  sendHwid: !!settings.subSendHwid,
                }
              );
              let decoded = res.body.trim();
              if (!decoded.includes("://")) {
                try {
                  decoded = atob(decoded);
                } catch {}
              }
              const { parseProxyUri } = await import("./utils/parser");
              const parsed = decoded
                .split(/\r?\n/)
                .map((l) => parseProxyUri(l.trim()))
                .filter((n): n is ServerNode => n !== null);
              if (parsed.length > 0) {
                return { ...g, updatedAt: "только что", servers: parsed };
              }
            } catch {}
            return g;
          })
        ).then((updated) => {
          setGroups((prev) =>
            prev.map((g) => updated.find((u) => u.id === g.id) || g)
          );
          notifyUser("sub", "Подписки обновлены", `Обновлено групп: ${withUrl.length}`);
        });
      }
    }
  }, [loaded]);

  useEffect(() => {
    if (!loaded || settings.subAutoUpdate === false) return;
    const ms = Math.max(1, settings.subUpdateHours || 6) * 3600 * 1000;
    const id = setInterval(async () => {
      const withUrl = groups.filter((g) => g.url);
      for (const g of withUrl) {
        try {
          const res = await invoke<{ body: string }>("fetch_subscription", {
            url: g.url,
            userAgent: settings.subUserAgent || null,
            sendHwid: !!settings.subSendHwid,
          });
          let decoded = res.body.trim();
          if (!decoded.includes("://")) {
            try {
              decoded = atob(decoded);
            } catch {}
          }
          const { parseProxyUri } = await import("./utils/parser");
          const parsed = decoded
            .split(/\r?\n/)
            .map((l) => parseProxyUri(l.trim()))
            .filter((n): n is ServerNode => n !== null);
          if (parsed.length > 0) {
            setGroups((prev) =>
              prev.map((x) =>
                x.id === g.id ? { ...x, updatedAt: "только что", servers: parsed } : x
              )
            );
          }
        } catch {}
      }
    }, ms);
    return () => clearInterval(id);
  }, [loaded, settings.subAutoUpdate, settings.subUpdateHours]);

  useEffect(() => {
    const unlisten = listen<string>("tray-action", (event) => {
      trayHandlerRef.current(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "logs") return;
    const fetchLogs = () => {
      invoke<string[]>("get_logs")
        .then(setLogs)
        .catch(() => {});
    };
    fetchLogs();
    const id = setInterval(fetchLogs, 1000);
    return () => clearInterval(id);
  }, [activeTab]);

  const connectServer = async () => {
    setConnectError(null);
    const isXhttp = selectedServer.transport === "XHTTP";
    const chosenCore =
      core === "auto"
        ? isXhttp
          ? "xray"
          : mode === "tun" || selectedServer.protocol === "HY2"
          ? "sing-box"
          : "xray"
        : core;

    if (chosenCore === "sing-box" && isXhttp) {
      setConnectError(
        "sing-box не поддерживает транспорт XHTTP. Выберите режим «Прокси» (Xray-core)."
      );
      return;
    }

    try {
      const configJson = buildCoreConfig(
        chosenCore,
        selectedServer,
        mode,
        settings
      );
      const useTunBridge = chosenCore === "xray" && mode === "tun";
      await invoke("connect_vpn", {
        core: chosenCore,
        configJson,
        auxCore: useTunBridge ? "sing-box" : null,
        auxConfigJson: useTunBridge
          ? buildSingBoxTunBridgeConfig(settings, selectedServer.address)
          : null,
        killOnExit: settings.killChildrenOnExit !== false,
      });
      if (mode === "proxy") {
        const httpPort =
          chosenCore === "xray" ? settings.localPort + 1 : settings.localPort;
        await invoke("set_system_proxy", {
          enable: true,
          port: httpPort,
        }).catch(() => {});
      }
      if (settings.killSwitch) {
        await invoke("set_kill_switch", { enable: true }).catch(() => {});
        notifyUser("killswitch", "Kill Switch активен", "Трафик вне VPN заблокирован");
      }
      setConnected(true);
      showToast(`Подключено (${chosenCore})`);
      notifyUser("connect", "67 VPN подключён", `${selectedServer.name} (${chosenCore})`);
    } catch (err) {
      const msg = String(err);
      if (
        mode === "tun" &&
        (msg.includes("Access is denied") || msg.includes("Отказано в доступе"))
      ) {
        setAdminModalOpen(true);
      } else {
        setConnectError(msg);
      }
      setConnected(false);
    }
  };

  const disconnectServer = async () => {
    setConnectError(null);
    await invoke("set_system_proxy", {
      enable: false,
      port: settings.localPort,
    }).catch(() => {});
    await invoke("disconnect_vpn").catch(() => {});
    if (settings.killSwitch) {
      await invoke("set_kill_switch", { enable: false }).catch(() => {});
    }
    setConnected(false);
    showToast("VPN отключён");
    notifyUser("connect", "67 VPN отключён", "Соединение остановлено");
  };

  const handleToggleConnect = async () => {
    if (connected) {
      await disconnectServer();
    } else {
      await connectServer();
    }
  };

  const handleCheckConnection = async () => {
    try {
      const method = settings.pingMethod || "tcp";
      const timeoutMs = settings.pingTimeoutMs || 2000;
      const ms =
        (method === "http_head" || method === "http_get") && connected
          ? await invoke<number>("ping_url", {
              url: settings.pingUrl || "https://www.gstatic.com/generate_204",
              proxyPort: settings.localPort,
              timeoutMs,
              headOnly: method === "http_head",
            })
          : method === "icmp"
          ? await invoke<number>("ping_icmp", {
              address: selectedServer.address,
              timeoutMs,
            })
          : await invoke<number>("ping_server", {
              address: selectedServer.address,
              port: selectedServer.port,
              timeoutMs,
            });
      setSelectedServer((prev) => ({ ...prev, ping: ms }));
      setConnectError(null);
    } catch (err) {
      setConnectError(`Пинг не прошёл: ${err}`);
    }
  };

  const watchdogActionsRef = useRef({ disconnectServer, connectServer, notifyUser });
  watchdogActionsRef.current = { disconnectServer, connectServer, notifyUser };

  useEffect(() => {
    if (!connected || !settings.watchdog) return;
    const id = setInterval(async () => {
      const running = await invoke<boolean>("is_core_running").catch(() => true);
      if (!running) {
        showToast("Ядро упало — переподключение...");
        watchdogActionsRef.current.notifyUser(
          "watchdog",
          "Watchdog: сбой ядра",
          "Выполняется автопереподключение..."
        );
        await watchdogActionsRef.current.disconnectServer();
        await watchdogActionsRef.current.connectServer();
      }
    }, 3000);
    return () => clearInterval(id);
  }, [connected, settings.watchdog]);

  useEffect(() => {
    if (!connected) {
      setSeconds(0);
      setSpeedUp(0);
      setSpeedDown(0);
      setMaxUp(0);
      setMaxDown(0);
      setSessionBytes(0);
      setSpeedHistory([]);
      return;
    }
    const timer = setInterval(() => {
      setSeconds((s) => s + 1);
      invoke<{ up: number; down: number }>("get_traffic_stats")
        .then((stats) => {
          setSpeedUp(stats.up);
          setSpeedDown(stats.down);
          setMaxUp((prev) => Math.max(prev, stats.up));
          setMaxDown((prev) => Math.max(prev, stats.down));
          setSessionBytes((prev) => prev + stats.up + stats.down);
          setTotalBytes((prev) => prev + stats.up + stats.down);
          setSpeedHistory((prev) => [...prev.slice(-59), stats]);
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [connected]);

  const formatSpeed = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B/s`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB/s`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatTime = (totalSec: number) => {
    const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const navItems: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "home", label: "Главная", icon: <Shield size={17} /> },
    { id: "servers", label: "Серверы", icon: <Server size={17} /> },
    { id: "stats", label: "Статистика", icon: <BarChart3 size={17} /> },
    { id: "logs", label: "Логи туннеля", icon: <Terminal size={17} /> },
    { id: "settings", label: "Настройки", icon: <Settings size={17} /> },
  ];

  const pingColor = (ms?: number) => {
    if (!ms) return "var(--text-muted)";
    if (ms < 80) return "#34d399";
    if (ms < 150) return "#fbbf24";
    return "#f87171";
  };

  const appWindow = getCurrentWindow();

  return (
    <div className="app-shell">
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-title" data-tauri-drag-region>
          67 VPN
        </span>
        <div className="titlebar-controls">
          <button
            className="titlebar-btn"
            onClick={() => appWindow.minimize()}
            title="Свернуть"
          >
            <Minus size={13} />
          </button>
          <button
            className="titlebar-btn"
            onClick={() => appWindow.toggleMaximize()}
            title="Развернуть"
          >
            <Square size={11} />
          </button>
          <button
            className="titlebar-btn close"
            onClick={() => appWindow.close()}
            title="Закрыть"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="app-body">
        <aside className="sidebar">
        <div className="brand">
          <img
            src={logoImg}
            alt="67 VPN"
            style={{ width: 34, height: 34, borderRadius: 10, objectFit: "cover" }}
          />
          <span className="brand-name">67 VPN</span>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeTab === item.id ? "active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span>v0.9.0</span>
          <span>{core === "auto" ? "Auto Core" : core}</span>
        </div>
      </aside>

      <main className="main-content">
        {activeTab === "home" && (
          <div className="home-container">
            <div className="mode-toggle">
              <button
                className={`mode-btn ${mode === "tun" ? "active" : ""}`}
                onClick={() => setMode("tun")}
              >
                <Shield size={14} />
                TUN
              </button>
              <button
                className={`mode-btn ${mode === "proxy" ? "active" : ""}`}
                onClick={() => setMode("proxy")}
              >
                <Globe size={14} />
                Прокси
              </button>
            </div>

            <div className="connect-wrapper">
              <button
                className={`connect-btn ${connected ? "connected" : ""}`}
                onClick={handleToggleConnect}
                title={connected ? "Отключиться" : "Подключиться"}
              >
                <Shield size={52} />
              </button>

              <div className={`status-text ${connected ? "connected" : ""}`}>
                {connected ? "Подключено" : "Отключено"}
              </div>

              <div className="session-meta">
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Clock size={13} />
                  {formatTime(seconds)}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Activity size={13} />
                  {formatBytes(sessionBytes)}
                </span>
              </div>

              <button className="check-btn" onClick={handleCheckConnection}>
                <Wifi size={13} />
                Проверить соединение
              </button>

              {connectError && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#f87171",
                    textAlign: "center",
                    maxWidth: 340,
                  }}
                >
                  {connectError}
                </div>
              )}
            </div>

            <div style={{ width: "100%", position: "relative" }}>
              <div
                className="server-card"
                onClick={() => setServerDropdownOpen(!serverDropdownOpen)}
              >
                <div className="server-info">
                  <div>
                    <div className="server-name">{selectedServer.name}</div>
                    {selectedServer.id && (
                      <div className="badges">
                        <span className="badge badge-vless">
                          {selectedServer.protocol}
                        </span>
                        {selectedServer.transport && (
                          <span
                            className="badge"
                            style={{
                              background: "rgba(255,255,255,0.08)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {selectedServer.transport}
                          </span>
                        )}
                        {selectedServer.security && (
                          <span className="badge badge-reality">
                            {selectedServer.security}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="server-ping" style={{ color: pingColor(selectedServer.ping) }}>
                  {selectedServer.ping ? `${selectedServer.ping} ms` : "—"}
                </div>
              </div>

              {serverDropdownOpen && (
                <div
                  className="group-card"
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 8px)",
                    left: 0,
                    right: 0,
                    maxHeight: 220,
                    overflowY: "auto",
                    zIndex: 30,
                    background: "rgba(12, 16, 26, 0.96)",
                    backdropFilter: "blur(28px)",
                    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.65)",
                  }}
                >
                  {(
                    groups.find((g) =>
                      g.servers.some((s) => s.id === selectedServer.id)
                    )?.servers ||
                    groups[0]?.servers ||
                    []
                  ).map((srv) => (
                    <div
                      key={srv.id}
                      className={`server-row ${srv.id === selectedServer.id ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedServer(srv);
                        setServerDropdownOpen(false);
                      }}
                    >
                      <div className="server-row-left">
                        <div className="server-row-name">{srv.name}</div>
                        <div className="badges">
                          <span className="badge badge-vless">{srv.protocol}</span>
                          {srv.transport && (
                            <span
                              className="badge"
                              style={{
                                background: "rgba(255,255,255,0.08)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {srv.transport}
                            </span>
                          )}
                          {srv.security && (
                            <span className="badge badge-reality">{srv.security}</span>
                          )}
                        </div>
                      </div>
                      <span className="server-ping" style={{ color: pingColor(srv.ping) }}>
                        {srv.ping ? `${srv.ping} ms` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="speed-grid">
              <div className="speed-card">
                <span className="speed-label">
                  <ArrowUp size={13} /> Upload
                </span>
                <span className="speed-value">{formatSpeed(speedUp)}</span>
              </div>
              <div className="speed-card">
                <span className="speed-label">
                  <ArrowDown size={13} /> Download
                </span>
                <span className="speed-value">{formatSpeed(speedDown)}</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <SettingsPage
            settings={settings}
            onChange={(next) => {
              if (next.autoStart !== settings.autoStart) {
                invoke("set_autostart", { enable: next.autoStart }).catch(() => {});
              }
              if (next.minimizeToTray !== settings.minimizeToTray) {
                invoke("set_minimize_to_tray", { enable: next.minimizeToTray }).catch(() => {});
              }
              setSettings(next);
            }}
            onResetStats={() => setTotalBytes(0)}
            onExportBackup={() =>
              JSON.stringify({ groups, selectedServer, mode, settings, totalBytes }, null, 2)
            }
            onImportBackup={(json) => {
              try {
                const parsed = JSON.parse(json);
                if (Array.isArray(parsed.groups)) setGroups(parsed.groups);
                if (parsed.selectedServer) setSelectedServer(parsed.selectedServer);
                if (parsed.mode) setMode(parsed.mode);
                if (parsed.settings) {
            const merged = { ...defaultSettings, ...parsed.settings };
            setSettings(structuredClone(merged));
            invoke("set_log_limit", { limit: merged.logLimit || 2000 }).catch(() => {});
            invoke("set_minimize_to_tray", { enable: merged.minimizeToTray !== false }).catch(() => {});
            if (merged.startMinimized) {
              getCurrentWindow().hide().catch(() => {});
            }
          }
                if (typeof parsed.totalBytes === "number") setTotalBytes(parsed.totalBytes);
                return true;
              } catch {
                return false;
              }
            }}
          />
        )}

        {activeTab === "servers" && (
          <ServersPage
            groups={groups}
            setGroups={setGroups}
            selectedServerId={selectedServer.id}
            userAgent={settings.subUserAgent}
            sendHwid={settings.subSendHwid}
            pingTimeoutMs={settings.pingTimeoutMs}
            pingMethod={settings.pingMethod}
            onNotify={notifyUser}
            onSelectServer={(s) => {
              setSelectedServer(s);
              setActiveTab("home");
            }}
          />
        )}

        {activeTab === "logs" && (
          <LogsPage
            logs={logs}
            onClear={() => {
              invoke("clear_logs").catch(() => {});
              setLogs([]);
            }}
          />
        )}

        {activeTab === "stats" && (
          <StatsPage
            connected={connected}
            core={core}
            seconds={seconds}
            speedUp={speedUp}
            speedDown={speedDown}
            maxUp={maxUp}
            maxDown={maxDown}
            sessionBytes={sessionBytes}
            totalBytes={totalBytes}
            history={speedHistory}
            formatTime={formatTime}
            formatSpeed={formatSpeed}
            formatBytes={formatBytes}
          />
        )}

        {activeTab !== "home" &&
          activeTab !== "settings" &&
          activeTab !== "servers" &&
          activeTab !== "logs" &&
          activeTab !== "stats" && (
          <div className="page-container">
            <h2 className="page-title">
              {navItems.find((i) => i.id === activeTab)?.label}
            </h2>
            <div className="settings-card">
              <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                Раздел в разработке — обсудим его следующим шагом.
              </span>
            </div>
          </div>
        )}
      </main>
      </div>

      {adminModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 70,
          }}
        >
          <div
            style={{
              width: 390,
              background: "rgba(15, 23, 42, 0.96)",
              backdropFilter: "blur(24px)",
              border: "1px solid var(--glass-border-strong)",
              borderRadius: 16,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              Требуются права администратора
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              Для работы режима TUN необходимо запустить 67 VPN с правами администратора.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button className="check-btn" onClick={() => setAdminModalOpen(false)}>
                Отмена
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  invoke("restart_as_admin").catch(() => {});
                }}
              >
                Перезапустить от админа
              </button>
            </div>
          </div>
        </div>
      )}

      {updateModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 75,
          }}
        >
          <div
            style={{
              width: 440,
              maxHeight: "75vh",
              background: "rgba(15, 23, 42, 0.96)",
              backdropFilter: "blur(24px)",
              border: "1px solid var(--glass-border-strong)",
              borderRadius: 16,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              Доступно обновление v{updateModal.version}
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 10,
                borderRadius: 8,
                background: "rgba(0,0,0,0.28)",
                border: "1px solid var(--border-color)",
                fontSize: 12.5,
                color: "var(--text-secondary)",
                whiteSpace: "pre-wrap",
                maxHeight: 200,
              }}
            >
              {updateModal.changelog}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="check-btn" onClick={() => setUpdateModal(null)}>
                Позже
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  import("@tauri-apps/plugin-opener").then((m) =>
                    m.openUrl(updateModal.url)
                  );
                  setUpdateModal(null);
                }}
              >
                Скачать
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            padding: "10px 16px",
            borderRadius: 12,
            background: "rgba(15, 23, 42, 0.78)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--glass-border-strong)",
            boxShadow: "var(--glass-highlight), 0 12px 30px rgba(0,0,0,0.45)",
            color: "var(--text-primary)",
            fontSize: 13,
            fontWeight: 500,
            zIndex: 60,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
