import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sliders,
  Cpu,
  ShieldAlert,
  Network,
  Database,
  RefreshCw,
  Info,
  Download,
  Upload,
  Plus,
  Trash2,
  Copy,
  Edit3,
  Check,
  Search,
  X,
  Bell,
} from "lucide-react";

export type CoreEngine = "auto" | "sing-box" | "xray";

export interface RoutingProfile {
  id: string;
  name: string;
  globalProxy: boolean;
  remoteDnsProtocol: "doh" | "dot" | "tcp";
  remoteDnsUrl: string;
  domesticDnsProtocol: "doh" | "dot" | "tcp";
  domesticDnsUrl: string;
  fakeDns: boolean;
  domainStrategy: "AsIs" | "IPIfNonMatch" | "IPOnDemand";
  geoIpUrl: string;
  geoSiteUrl: string;
  bypassLan: boolean;
  ruleOrder?: "block-proxy-direct" | "block-direct-proxy" | "proxy-direct-block" | "direct-proxy-block";
  directRules: string[];
  proxyRules: string[];
  blockRules: string[];
}

export interface AppRuleItem {
  name: string;
  path: string;
  matchBy: "name" | "path";
}

export interface AppSettings {
  // 1. Основные
  autoStart: boolean;
  startMinimized: boolean;
  autoConnect: boolean;
  minimizeToTray: boolean;
  killChildrenOnExit: boolean;
  language: "ru" | "en";

  // 2. Ядро и сеть
  core: CoreEngine;
  localPort: number;
  allowLan: boolean;
  dnsServer: "system" | "1.1.1.1" | "8.8.8.8" | "adguard" | "custom";
  domesticDns: "system" | "77.88.8.8" | "1.1.1.1";
  customDns: string;
  fakeDns: boolean;
  ipv6Mode: "disable" | "prefer_ipv4" | "enable";
  pingMethod: "tcp" | "http_head" | "http_get" | "icmp";
  pingUrl: string;
  pingTimeoutMs: number;

  // 3. Обход DPI и стабильность
  watchdog: boolean;
  killSwitch: boolean;
  tlsFragment: boolean;
  tlsFragmentPackets: string;
  tlsFragmentLength: string;
  tlsFragmentInterval: string;
  noiseEnabled: boolean;
  noiseType: "rand" | "str" | "base64";
  noisePacket: string;
  noiseDelay: string;
  mux: boolean;
  muxConcurrency: number;
  xudpConcurrency: number;
  xudpProxyUDP443: "reject" | "allow" | "skip";
  allowInsecure: boolean;

  // 4. TUN-адаптер
  tunStack: "system" | "gvisor" | "mixed";
  tunMtu: number;
  strictRoute: boolean;
  sniffing: boolean;

  // 5. Подписки и логи
  subAutoUpdate: boolean;
  subUpdateHours: number;
  subUpdateOnStart: boolean;
  subPingAfterUpdate: boolean;
  subSendHwid: boolean;
  subUserAgent: string;
  logLevel: "debug" | "info" | "warn" | "error";
  logLimit: number;

  // 6. Маршрутизация и туннелирование
  routingMode: "global" | "bypass_lan" | "custom";
  bypassDomains: string;
  routingProfiles: RoutingProfile[];
  activeProfileId: string;
  perAppEnabled: boolean;
  perAppMode: "bypass" | "proxy";
  perAppList: string[];
  perAppItems: AppRuleItem[];

  // 7. Уведомления
  notificationsEnabled: boolean;
  notificationStyle: "custom" | "system";
  notifyWatchdog: boolean;
  notifySubUpdate: boolean;
  notifySubExpire: boolean;
  notifyKillSwitch: boolean;
  notifyConnect: boolean;
  githubRepo: string;
  includePrerelease: boolean;
}

export const defaultSettings: AppSettings = {
  autoStart: false,
  startMinimized: false,
  autoConnect: false,
  minimizeToTray: true,
  killChildrenOnExit: true,
  language: "ru",
  core: "auto",
  localPort: 10808,
  allowLan: false,
  dnsServer: "1.1.1.1",
  domesticDns: "system",
  customDns: "",
  fakeDns: true,
  ipv6Mode: "prefer_ipv4",
  pingMethod: "tcp",
  pingUrl: "https://www.gstatic.com/generate_204",
  pingTimeoutMs: 2000,
  watchdog: true,
  killSwitch: false,
  tlsFragment: false,
  tlsFragmentPackets: "tlshello",
  tlsFragmentLength: "100-200",
  tlsFragmentInterval: "10-20",
  noiseEnabled: false,
  noiseType: "rand",
  noisePacket: "50-100",
  noiseDelay: "10-16",
  mux: false,
  muxConcurrency: 8,
  xudpConcurrency: -1,
  xudpProxyUDP443: "reject",
  allowInsecure: false,
  tunStack: "system",
  tunMtu: 1500,
  strictRoute: true,
  sniffing: true,
  subAutoUpdate: true,
  subUpdateHours: 6,
  subUpdateOnStart: false,
  subPingAfterUpdate: false,
  subSendHwid: false,
  subUserAgent: "",
  logLevel: "info",
  logLimit: 2000,
  routingMode: "bypass_lan",
  bypassDomains: "",
  routingProfiles: [
    {
      id: "bypass-lan",
      name: "Обход LAN",
      globalProxy: true,
      remoteDnsProtocol: "doh",
      remoteDnsUrl: "https://8.8.8.8/dns-query",
      domesticDnsProtocol: "doh",
      domesticDnsUrl: "https://77.88.8.8/dns-query",
      fakeDns: false,
      domainStrategy: "IPIfNonMatch",
      geoIpUrl: "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat",
      geoSiteUrl: "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat",
      bypassLan: true,
      directRules: ["192.168.0.0/16", "10.0.0.0/8", "localhost"],
      proxyRules: [],
      blockRules: [],
    },
    {
      id: "global",
      name: "Global",
      globalProxy: true,
      remoteDnsProtocol: "doh",
      remoteDnsUrl: "https://8.8.8.8/dns-query",
      domesticDnsProtocol: "doh",
      domesticDnsUrl: "https://77.88.8.8/dns-query",
      fakeDns: false,
      domainStrategy: "IPIfNonMatch",
      geoIpUrl: "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat",
      geoSiteUrl: "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat",
      bypassLan: false,
      directRules: [],
      proxyRules: [],
      blockRules: [],
    },
  ],
  activeProfileId: "bypass-lan",
  perAppEnabled: false,
  perAppMode: "bypass",
  perAppList: [],
  perAppItems: [],
  notificationsEnabled: true,
  notificationStyle: "custom",
  notifyWatchdog: true,
  notifySubUpdate: true,
  notifySubExpire: true,
  notifyKillSwitch: true,
  notifyConnect: false,
  githubRepo: "leonelo00/67-VPN-Client",
  includePrerelease: false,
};

interface SettingsPageProps {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onResetStats: () => void;
  onExportBackup: () => string;
  onImportBackup: (json: string) => boolean;
}

type CategoryId =
  | "general"
  | "network"
  | "dpi"
  | "tun"
  | "routing"
  | "perApp"
  | "subs"
  | "notifications"
  | "backup"
  | "about";

export function SettingsPage({
  settings: savedSettings,
  onChange,
  onResetStats,
  onExportBackup,
  onImportBackup,
}: SettingsPageProps) {
  const [settings, setSettings] = useState<AppSettings>(() =>
    structuredClone(savedSettings)
  );
  const [diffOpen, setDiffOpen] = useState(false);

  useEffect(() => {
    setSettings(structuredClone(savedSettings));
  }, [savedSettings]);

  const changedKeys = (Object.keys(settings) as (keyof AppSettings)[]).filter(
    (k) => JSON.stringify(settings[k] ?? false) !== JSON.stringify(savedSettings[k] ?? false)
  );

  const [cat, setCat] = useState<CategoryId>("general");
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [ruleInput, setRuleInput] = useState<{
    directDomain: string;
    directIp: string;
    proxyDomain: string;
    proxyIp: string;
    blockDomain: string;
    blockIp: string;
  }>({
    directDomain: "",
    directIp: "",
    proxyDomain: "",
    proxyIp: "",
    blockDomain: "",
    blockIp: "",
  });
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [procModalOpen, setProcModalOpen] = useState(false);
  const [runningProcs, setRunningProcs] = useState<{ name: string; path: string }[]>([]);
  const [procSearch, setProcSearch] = useState("");
  const [selectedProcs, setSelectedProcs] = useState<Record<string, boolean>>({});
  const [updateStatus, setUpdateStatus] = useState<{
    checking: boolean;
    hasUpdate?: boolean;
    latest?: string;
    url?: string;
    changelog?: string;
    isPrerelease?: boolean;
    error?: string;
  }>({ checking: false });

  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  const categories: { id: CategoryId; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: "Общие", icon: <Sliders size={15} /> },
    { id: "network", label: "Ядро и сеть", icon: <Cpu size={15} /> },
    { id: "dpi", label: "DPI и стабильность", icon: <ShieldAlert size={15} /> },
    { id: "tun", label: "TUN-адаптер", icon: <Network size={15} /> },
    { id: "routing", label: "Маршрутизация", icon: <Sliders size={15} /> },
    { id: "perApp", label: "Туннелирование", icon: <Cpu size={15} /> },
    { id: "subs", label: "Подписки и логи", icon: <RefreshCw size={15} /> },
    { id: "notifications", label: "Уведомления", icon: <Bell size={15} /> },
    { id: "backup", label: "Резервная копия", icon: <Database size={15} /> },
    { id: "about", label: "О программе", icon: <Info size={15} /> },
  ];

  const Toggle = ({
    label,
    desc,
    checked,
    onToggle,
  }: {
    label: string;
    desc?: string;
    checked: boolean;
    onToggle: (v: boolean) => void;
  }) => (
    <div className="settings-card">
      <div>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{label}</div>
        {desc && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
            {desc}
          </div>
        )}
      </div>
      <button
        className={`core-btn ${checked ? "active" : ""}`}
        onClick={() => onToggle(!checked)}
        style={{ minWidth: 64 }}
      >
        {checked ? "Вкл" : "Выкл"}
      </button>
    </div>
  );

  return (
    <div className="page-container" style={{ maxWidth: 820 }}>
      <h2 className="page-title">Настройки</h2>

      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 190,
            flexShrink: 0,
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: 12,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            height: "fit-content",
          }}
        >
          {categories.map((c) => (
            <button
              key={c.id}
              className={`nav-item ${cat === c.id ? "active" : ""}`}
              onClick={() => setCat(c.id)}
              style={{ padding: "8px 10px", fontSize: 13 }}
            >
              {c.icon}
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", paddingBottom: 16 }}>
        {cat === "general" && (
          <>
            <Toggle
              label="Автозапуск с Windows"
              desc="Запускать 67 VPN при входе в систему"
              checked={settings.autoStart}
              onToggle={(v) => update("autoStart", v)}
            />
            <Toggle
              label="Запуск свёрнутым в трей"
              desc="Не показывать окно при автозапуске"
              checked={settings.startMinimized}
              onToggle={(v) => update("startMinimized", v)}
            />
            <Toggle
              label="Автоподключение при старте"
              desc="Сразу подключаться к последнему выбранному серверу"
              checked={settings.autoConnect}
              onToggle={(v) => update("autoConnect", v)}
            />
            <Toggle
              label="Сворачивать в трей при закрытии"
              desc="Кнопка закрытия прячет окно в трей вместо выхода"
              checked={settings.minimizeToTray}
              onToggle={(v) => update("minimizeToTray", v)}
            />
            <Toggle
              label="Завершать ядра при принудительном закрытии"
              desc="Автоматически останавливать sing-box и xray, если клиент снят через Диспетчер задач"
              checked={settings.killChildrenOnExit !== false}
              onToggle={(v) => update("killChildrenOnExit", v)}
            />
          </>
        )}

        {cat === "network" && (
          <>
            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>VPN-ядро (Core)</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Автовыбор или ручное переключение
                </div>
              </div>
              <div className="core-selector">
                {(["auto", "sing-box", "xray"] as CoreEngine[]).map((c) => (
                  <button
                    key={c}
                    className={`core-btn ${settings.core === c ? "active" : ""}`}
                    onClick={() => update("core", c)}
                  >
                    {c === "auto" ? "Авто" : c === "sing-box" ? "sing-box" : "Xray-core"}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Локальный порт прокси</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  SOCKS5 / HTTP порт (по умолчанию 10808)
                </div>
              </div>
              <input
                type="number"
                min={1}
                max={65535}
                className="search-input"
                style={{ width: 100, padding: "6px 10px", textAlign: "center" }}
                value={settings.localPort}
                onChange={(e) => update("localPort", Number(e.target.value) || 0)}
                onBlur={() =>
                  update("localPort", Math.min(65535, Math.max(1, settings.localPort || 10808)))
                }
              />
            </div>

            <Toggle
              label="Allow LAN"
              desc="Разрешить подключения из локальной сети (раздача VPN)"
              checked={settings.allowLan}
              onToggle={(v) => update("allowLan", v)}
            />

            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Remote DNS (VPN)</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Резолвер для трафика внутри туннеля
                </div>
              </div>
              <div className="core-selector">
                {(["system", "1.1.1.1", "8.8.8.8", "adguard"] as const).map((d) => (
                  <button
                    key={d}
                    className={`core-btn ${settings.dnsServer === d ? "active" : ""}`}
                    onClick={() => update("dnsServer", d)}
                  >
                    {d === "system" ? "Системный" : d}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Domestic DNS (Прямой)</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Резолвер для локальных и прямых запросов
                </div>
              </div>
              <div className="core-selector">
                {(["system", "77.88.8.8", "1.1.1.1"] as const).map((d) => (
                  <button
                    key={d}
                    className={`core-btn ${settings.domesticDns === d ? "active" : ""}`}
                    onClick={() => update("domesticDns", d)}
                  >
                    {d === "system" ? "Системный" : d}
                  </button>
                ))}
              </div>
            </div>

            <Toggle
              label="FakeDNS"
              desc="Ускоряет разрешение доменов и снижает задержки в TUN"
              checked={settings.fakeDns}
              onToggle={(v) => update("fakeDns", v)}
            />

            <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>Протокол пинга</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    TCP / ICMP — до сервера, HTTP — через прокси
                  </div>
                </div>
                <select
                  className="search-input"
                  style={{ width: 210, padding: "6px 10px" }}
                  value={settings.pingMethod || "tcp"}
                  onChange={(e) =>
                    update("pingMethod", e.target.value as AppSettings["pingMethod"])
                  }
                >
                  <option value="tcp">TCP-коннект</option>
                  <option value="http_head">HTTP HEAD (через прокси)</option>
                  <option value="http_get">HTTP GET (через прокси)</option>
                  <option value="icmp">ICMP ping</option>
                </select>
              </div>

              {(settings.pingMethod === "http_head" || settings.pingMethod === "http_get") && (
                <input
                  type="text"
                  className="search-input"
                  style={{ paddingLeft: 10 }}
                  placeholder="https://www.gstatic.com/generate_204"
                  value={settings.pingUrl || "https://www.gstatic.com/generate_204"}
                  onChange={(e) => update("pingUrl", e.target.value)}
                />
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Таймаут пинга</span>
                <div className="core-selector">
                  {[1000, 2000, 3000, 5000].map((ms) => (
                    <button
                      key={ms}
                      className={`core-btn ${(settings.pingTimeoutMs || 2000) === ms ? "active" : ""}`}
                      onClick={() => update("pingTimeoutMs", ms)}
                    >
                      {ms / 1000} с
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {cat === "dpi" && (
          <>
            <Toggle
              label="Watchdog (Автопереподключение)"
              desc="Перезапускать ядро при неожиданном обрыве"
              checked={settings.watchdog}
              onToggle={(v) => update("watchdog", v)}
            />
            <Toggle
              label="Kill Switch"
              desc="Блокировать трафик при падении VPN-туннеля"
              checked={settings.killSwitch}
              onToggle={(v) => update("killSwitch", v)}
            />
            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Сбросить Kill Switch</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Удалить правило фаервола 67VPN_KillSwitch, если интернет заблокирован
                </div>
              </div>
              <button
                className="check-btn"
                onClick={() => invoke("set_kill_switch", { enable: false }).catch(() => {})}
              >
                Сбросить
              </button>
            </div>
            <Toggle
              label="TLS-фрагментация"
              desc="Разбиение ClientHello пакетов для обхода DPI"
              checked={settings.tlsFragment}
              onToggle={(v) => update("tlsFragment", v)}
            />
            {settings.tlsFragment && (
              <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Fragment packets</span>
                  <input
                    type="text"
                    className="search-input"
                    style={{ width: 120, padding: "6px 10px", textAlign: "center" }}
                    value={settings.tlsFragmentPackets || "tlshello"}
                    onChange={(e) => update("tlsFragmentPackets", e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Fragment length / interval</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      className="search-input"
                      style={{ width: 95, padding: "6px 10px", textAlign: "center" }}
                      value={settings.tlsFragmentLength}
                      onChange={(e) => update("tlsFragmentLength", e.target.value)}
                      title="Длина фрагмента"
                    />
                    <input
                      type="text"
                      className="search-input"
                      style={{ width: 95, padding: "6px 10px", textAlign: "center" }}
                      value={settings.tlsFragmentInterval}
                      onChange={(e) => update("tlsFragmentInterval", e.target.value)}
                      title="Интервал (мс)"
                    />
                  </div>
                </div>
              </div>
            )}
            <Toggle
              label="Шум (noises)"
              desc="Случайный паддинг между фрагментами (Xray)"
              checked={!!settings.noiseEnabled}
              onToggle={(v) => update("noiseEnabled", v)}
            />
            {settings.noiseEnabled && (
              <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Тип</span>
                  <div className="core-selector">
                    {(["rand", "str", "base64"] as const).map((t) => (
                      <button
                        key={t}
                        className={`core-btn ${(settings.noiseType || "rand") === t ? "active" : ""}`}
                        onClick={() => update("noiseType", t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Packet / Delay</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      className="search-input"
                      style={{ width: 95, padding: "6px 10px", textAlign: "center" }}
                      value={settings.noisePacket || "50-100"}
                      onChange={(e) => update("noisePacket", e.target.value)}
                    />
                    <input
                      type="text"
                      className="search-input"
                      style={{ width: 95, padding: "6px 10px", textAlign: "center" }}
                      value={settings.noiseDelay || "10-16"}
                      onChange={(e) => update("noiseDelay", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
            <Toggle
              label="Mux (Мультиплексирование)"
              desc="Объединение потоков в одно соединение (Xray)"
              checked={settings.mux}
              onToggle={(v) => update("mux", v)}
            />
            {settings.mux && (
              <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Mux concurrency</span>
                  <input
                    type="number"
                    className="search-input"
                    style={{ width: 100, padding: "6px 10px", textAlign: "center" }}
                    value={settings.muxConcurrency ?? 8}
                    onChange={(e) => update("muxConcurrency", Number(e.target.value) || 8)}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>xUDP concurrency</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>-1 — выкл, 0+ — кол-во дорожек</div>
                  </div>
                  <input
                    type="number"
                    className="search-input"
                    style={{ width: 100, padding: "6px 10px", textAlign: "center" }}
                    value={settings.xudpConcurrency ?? -1}
                    onChange={(e) => update("xudpConcurrency", Number(e.target.value))}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>xUDP UDP/443</span>
                  <div className="core-selector">
                    {(["reject", "allow", "skip"] as const).map((m) => (
                      <button
                        key={m}
                        className={`core-btn ${(settings.xudpProxyUDP443 || "reject") === m ? "active" : ""}`}
                        onClick={() => update("xudpProxyUDP443", m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <Toggle
              label="Allow Insecure"
              desc="Разрешить самоподписанные TLS-сертификаты"
              checked={settings.allowInsecure}
              onToggle={(v) => update("allowInsecure", v)}
            />
          </>
        )}

        {cat === "tun" && (
          <>
            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Стек TUN-адаптера</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  System быстрее, gVisor стабильнее для сложных сетей
                </div>
              </div>
              <div className="core-selector">
                {(["system", "gvisor", "mixed"] as const).map((st) => (
                  <button
                    key={st}
                    className={`core-btn ${settings.tunStack === st ? "active" : ""}`}
                    onClick={() => update("tunStack", st)}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>MTU</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Максимальный размер пакета (по умолчанию 1500)
                </div>
              </div>
              <input
                type="number"
                min={576}
                max={9000}
                className="search-input"
                style={{ width: 100, padding: "6px 10px", textAlign: "center" }}
                value={settings.tunMtu}
                onChange={(e) => update("tunMtu", Number(e.target.value) || 0)}
                onBlur={() =>
                  update("tunMtu", Math.min(9000, Math.max(576, settings.tunMtu || 1500)))
                }
              />
            </div>

            <Toggle
              label="Strict Route"
              desc="Строгая маршрутизация для предотвращения утечек"
              checked={settings.strictRoute}
              onToggle={(v) => update("strictRoute", v)}
            />

            <Toggle
              label="Sniffing (определение доменов)"
              desc="Извлекать домен из трафика для работы доменных правил в TUN"
              checked={settings.sniffing !== false}
              onToggle={(v) => update("sniffing", v)}
            />
          </>
        )}

        {cat === "routing" && (() => {
          const profiles = settings.routingProfiles || defaultSettings.routingProfiles;
          const editing = profiles.find((p) => p.id === editingProfileId);

          if (editing) {
            const updateProfile = (patch: Partial<RoutingProfile>) => {
              update(
                "routingProfiles",
                profiles.map((p) => (p.id === editing.id ? { ...p, ...patch } : p))
              );
            };

            const renderRuleSection = (
              title: string,
              color: string,
              field: "directRules" | "proxyRules" | "blockRules",
              domainKey: "directDomain" | "proxyDomain" | "blockDomain",
              ipKey: "directIp" | "proxyIp" | "blockIp"
            ) => {
              const list = editing[field];
              const addBulk = (key: typeof domainKey | typeof ipKey) => {
                const items = ruleInput[key]
                  .split(/[\s,;]+/)
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0 && !list.includes(s));
                if (items.length === 0) return;
                const unique = Array.from(new Set(items));
                updateProfile({ [field]: [...list, ...unique] });
                setRuleInput({ ...ruleInput, [key]: "" });
              };
              return (
                <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5, color }}>{title}</span>
                    <span className="group-count">{list.length}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="text"
                      className="search-input"
                      style={{ paddingLeft: 10 }}
                      placeholder="Домены или IP/CIDR (через пробел или запятую: ru, 192.168.0.0/16)"
                      value={ruleInput[domainKey]}
                      onChange={(e) => setRuleInput({ ...ruleInput, [domainKey]: e.target.value })}
                    />
                    <button className="primary-btn" onClick={() => addBulk(domainKey)}>
                      <Plus size={14} />
                    </button>
                  </div>
                  {list.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {list.map((r) => (
                        <span
                          key={r}
                          className="core-btn active"
                          onClick={() => updateProfile({ [field]: list.filter((x) => x !== r) })}
                          title="Удалить правило"
                        >
                          {r} ×
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            };

            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button className="check-btn" onClick={() => setEditingProfileId(null)}>
                    ← Назад к профилям
                  </button>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{editing.name}</span>
                </div>

                <div className="settings-card">
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>Название профиля</div>
                  <input
                    type="text"
                    className="search-input"
                    style={{ width: 220, paddingLeft: 10 }}
                    value={editing.name}
                    onChange={(e) => updateProfile({ name: e.target.value })}
                  />
                </div>

                <Toggle
                  label="Global proxy"
                  desc="Направлять весь трафик через VPN по умолчанию"
                  checked={editing.globalProxy}
                  onToggle={(v) => updateProfile({ globalProxy: v })}
                />

                <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: "#60a5fa" }}>Remote DNS (proxy)</div>
                  <div className="core-selector">
                    {(["doh", "dot", "tcp"] as const).map((p) => (
                      <button
                        key={p}
                        className={`core-btn ${editing.remoteDnsProtocol === p ? "active" : ""}`}
                        onClick={() => updateProfile({ remoteDnsProtocol: p })}
                      >
                        {p.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    className="search-input"
                    style={{ paddingLeft: 10 }}
                    value={editing.remoteDnsUrl || ""}
                    onChange={(e) => updateProfile({ remoteDnsUrl: e.target.value })}
                  />

                  <div style={{ fontWeight: 600, fontSize: 13.5, color: "#22c55e", marginTop: 4 }}>Domestic DNS (direct)</div>
                  <div className="core-selector">
                    {(["doh", "dot", "tcp"] as const).map((p) => (
                      <button
                        key={p}
                        className={`core-btn ${editing.domesticDnsProtocol === p ? "active" : ""}`}
                        onClick={() => updateProfile({ domesticDnsProtocol: p })}
                      >
                        {p.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    className="search-input"
                    style={{ paddingLeft: 10 }}
                    value={editing.domesticDnsUrl || ""}
                    onChange={(e) => updateProfile({ domesticDnsUrl: e.target.value })}
                  />
                </div>

                <Toggle
                  label="FakeDNS"
                  desc="Синтетические IP для ускорения резолва доменов"
                  checked={!!editing.fakeDns}
                  onToggle={(v) => updateProfile({ fakeDns: v })}
                />

                <div className="settings-card">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>Порядок правил</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                      Приоритет срабатывания списков маршрутизации
                    </div>
                  </div>
                  <select
                    className="search-input"
                    style={{ width: 210, padding: "6px 10px" }}
                    value={editing.ruleOrder || "block-proxy-direct"}
                    onChange={(e) =>
                      updateProfile({
                        ruleOrder: e.target.value as RoutingProfile["ruleOrder"],
                      })
                    }
                  >
                    <option value="block-proxy-direct">block → proxy → direct</option>
                    <option value="block-direct-proxy">block → direct → proxy</option>
                    <option value="proxy-direct-block">proxy → direct → block</option>
                    <option value="direct-proxy-block">direct → proxy → block</option>
                  </select>
                </div>

                {renderRuleSection("Direct (в обход VPN)", "#22c55e", "directRules", "directDomain", "directIp")}
                <Toggle
                  label="Bypass LAN"
                  desc="Пропускать локальные/приватные IP-диапазоны напрямую"
                  checked={!!editing.bypassLan}
                  onToggle={(v) => updateProfile({ bypassLan: v })}
                />
                {renderRuleSection("Proxy (через VPN)", "#60a5fa", "proxyRules", "proxyDomain", "proxyIp")}
                {renderRuleSection("Block (блокировать)", "#f87171", "blockRules", "blockDomain", "blockIp")}

                <div className="settings-card">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>Domain strategy</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                      Стратегия разрешения доменных имён в IP
                    </div>
                  </div>
                  <div className="core-selector">
                    {(["AsIs", "IPIfNonMatch", "IPOnDemand"] as const).map((st) => (
                      <button
                        key={st}
                        className={`core-btn ${(editing.domainStrategy || "IPIfNonMatch") === st ? "active" : ""}`}
                        onClick={() => updateProfile({ domainStrategy: st })}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>Geo data (GeoIP / GeoSite URL)</div>
                  <input
                    type="text"
                    className="search-input"
                    style={{ paddingLeft: 10 }}
                    placeholder="GeoIP URL"
                    value={editing.geoIpUrl || ""}
                    onChange={(e) => updateProfile({ geoIpUrl: e.target.value })}
                  />
                  <input
                    type="text"
                    className="search-input"
                    style={{ paddingLeft: 10 }}
                    placeholder="GeoSite URL"
                    value={editing.geoSiteUrl || ""}
                    onChange={(e) => updateProfile({ geoSiteUrl: e.target.value })}
                  />
                </div>
              </>
            );
          }

          return (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  Профили маршрутизации
                </span>
                <button
                  className="primary-btn"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    update("routingProfiles", [
                      ...profiles,
                      {
                        id,
                        name: "Новый профиль",
                        globalProxy: true,
                        remoteDnsProtocol: "doh",
                        remoteDnsUrl: "https://8.8.8.8/dns-query",
                        domesticDnsProtocol: "doh",
                        domesticDnsUrl: "https://77.88.8.8/dns-query",
                        fakeDns: false,
                        domainStrategy: "IPIfNonMatch",
                        geoIpUrl: "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat",
                        geoSiteUrl: "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat",
                        bypassLan: true,
                        directRules: [],
                        proxyRules: [],
                        blockRules: [],
                      },
                    ]);
                    setEditingProfileId(id);
                  }}
                >
                  <Plus size={14} /> Новый профиль
                </button>
              </div>

              {profiles.map((prof) => {
                const isActive = prof.id === settings.activeProfileId;
                return (
                  <div
                    key={prof.id}
                    className="settings-card"
                    style={{
                      borderColor: isActive ? "var(--accent)" : undefined,
                      cursor: "pointer",
                    }}
                    onClick={() => update("activeProfileId", prof.id)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {isActive && <Check size={16} color="var(--accent)" />}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{prof.name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                          Direct: {prof.directRules.length} · Proxy: {prof.proxyRules.length} · Block: {prof.blockRules.length}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                      <button
                        className="row-icon-btn"
                        title="Изменить"
                        onClick={() => setEditingProfileId(prof.id)}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        className="row-icon-btn"
                        title="Дублировать"
                        onClick={() =>
                          update("routingProfiles", [
                            ...profiles,
                            { ...prof, id: crypto.randomUUID(), name: `${prof.name} (копия)` },
                          ])
                        }
                      >
                        <Copy size={15} />
                      </button>
                      {profiles.length > 1 && (
                        <button
                          className="row-icon-btn"
                          title="Удалить"
                          onClick={() => {
                            const nextProfiles = profiles.filter((p) => p.id !== prof.id);
                            onChange({
                              ...settings,
                              routingProfiles: nextProfiles,
                              activeProfileId:
                                settings.activeProfileId === prof.id
                                  ? nextProfiles[0]?.id || ""
                                  : settings.activeProfileId,
                            });
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          );
        })()}

        {cat === "perApp" && (() => {
          const items = settings.perAppItems || [];
          const addItems = (newItems: { name: string; path: string }[]) => {
            const next = [...items];
            for (const it of newItems) {
              if (!next.some((x) => x.path.toLowerCase() === it.path.toLowerCase())) {
                next.push({ ...it, matchBy: "name" });
              }
            }
            update("perAppItems", next);
          };

          return (
            <>
              <Toggle
                label="Включить Per-App Proxy"
                desc="Маршрутизация трафика по приложениям (режим TUN)"
                checked={settings.perAppEnabled}
                onToggle={(v) => update("perAppEnabled", v)}
              />

              <div className="settings-card">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>Режим списка</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    Действие для выбранных приложений
                  </div>
                </div>
                <div className="core-selector">
                  <button
                    className={`core-btn ${settings.perAppMode === "bypass" ? "active" : ""}`}
                    onClick={() => update("perAppMode", "bypass")}
                  >
                    В обход VPN
                  </button>
                  <button
                    className={`core-btn ${settings.perAppMode === "proxy" ? "active" : ""}`}
                    onClick={() => update("perAppMode", "proxy")}
                  >
                    Только через прокси
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" }}>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  Выбрано приложений: {items.length}
                </span>
                <button
                  className="primary-btn"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                  onClick={() => setShowAddMenu(!showAddMenu)}
                >
                  <Plus size={14} /> Добавить...
                </button>

                {showAddMenu && (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 36,
                      zIndex: 20,
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-color)",
                      borderRadius: 10,
                      padding: 6,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      minWidth: 200,
                      boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                    }}
                  >
                    <button
                      className="nav-item"
                      onClick={async () => {
                        setShowAddMenu(false);
                        setProcModalOpen(true);
                        setSelectedProcs({});
                        const list = await invoke<{ name: string; path: string }[]>(
                          "list_running_processes"
                        ).catch(() => []);
                        setRunningProcs(list);
                      }}
                    >
                      Запущенные процессы
                    </button>
                    <button
                      className="nav-item"
                      onClick={async () => {
                        setShowAddMenu(false);
                        setProcModalOpen(true);
                        setSelectedProcs({});
                        const list = await invoke<{ name: string; path: string }[]>(
                          "list_installed_apps"
                        ).catch(() => []);
                        setRunningProcs(list);
                      }}
                    >
                      Установленные приложения
                    </button>
                    <button
                      className="nav-item"
                      onClick={async () => {
                        setShowAddMenu(false);
                        const picked = await invoke<{ name: string; path: string } | null>(
                          "pick_exe_file"
                        ).catch(() => null);
                        if (picked) addItems([picked]);
                      }}
                    >
                      По пути (.exe)
                    </button>
                  </div>
                )}
              </div>

              {items.map((app) => (
                <div key={app.path} className="settings-card">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{app.name}</div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {app.path}
                    </div>
                    <button
                      className="core-btn"
                      style={{ marginTop: 6, fontSize: 11, padding: "3px 8px" }}
                      onClick={() =>
                        update(
                          "perAppItems",
                          items.map((x) =>
                            x.path === app.path
                              ? { ...x, matchBy: x.matchBy === "name" ? "path" : "name" }
                              : x
                          )
                        )
                      }
                    >
                      {app.matchBy === "name" ? "По имени файла" : "По полному пути"}
                    </button>
                  </div>
                  <button
                    className="row-icon-btn"
                    onClick={() =>
                      update(
                        "perAppItems",
                        items.filter((x) => x.path !== app.path)
                      )
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}

              {procModalOpen && (
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
                      width: 520,
                      maxHeight: "75vh",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-color)",
                      borderRadius: 12,
                      padding: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>Запущенные процессы</span>
                      <button className="row-icon-btn" onClick={() => setProcModalOpen(false)}>
                        <X size={18} />
                      </button>
                    </div>

                    <div className="search-bar">
                      <Search size={15} className="search-icon" />
                      <input
                        type="text"
                        className="search-input"
                        placeholder="Поиск по имени или пути..."
                        value={procSearch}
                        onChange={(e) => setProcSearch(e.target.value)}
                      />
                    </div>

                    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                      {runningProcs
                        .filter(
                          (p) =>
                            p.name.toLowerCase().includes(procSearch.toLowerCase()) ||
                            p.path.toLowerCase().includes(procSearch.toLowerCase())
                        )
                        .map((p) => (
                          <label
                            key={p.path}
                            className="server-row"
                            style={{ borderRadius: 8, border: "1px solid var(--border-color)" }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-muted)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  maxWidth: 400,
                                }}
                              >
                                {p.path}
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              checked={!!selectedProcs[p.path]}
                              onChange={(e) =>
                                setSelectedProcs({ ...selectedProcs, [p.path]: e.target.checked })
                              }
                            />
                          </label>
                        ))}
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button className="check-btn" onClick={() => setProcModalOpen(false)}>
                        Отмена
                      </button>
                      <button
                        className="primary-btn"
                        onClick={() => {
                          const chosen = runningProcs.filter((p) => selectedProcs[p.path]);
                          addItems(chosen);
                          setProcModalOpen(false);
                        }}
                      >
                        Добавить
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {cat === "subs" && (
          <>
            <Toggle
              label="Автообновление подписок"
              desc="Автоматически обновлять серверы по расписанию"
              checked={settings.subAutoUpdate !== false}
              onToggle={(v) => update("subAutoUpdate", v)}
            />
            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Интервал обновления</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Как часто обновлять подписки
                </div>
              </div>
              <div className="core-selector">
                {[1, 6, 12, 24].map((h) => (
                  <button
                    key={h}
                    className={`core-btn ${settings.subUpdateHours === h ? "active" : ""}`}
                    onClick={() => update("subUpdateHours", h)}
                  >
                    {h} ч
                  </button>
                ))}
              </div>
            </div>
            <Toggle
              label="Обновлять подписки при запуске"
              desc="Проверять обновления подписок при старте приложения"
              checked={!!settings.subUpdateOnStart}
              onToggle={(v) => update("subUpdateOnStart", v)}
            />
            <Toggle
              label="Пинговать серверы после обновления"
              desc="Автоматически замерять пинг после загрузки подписки"
              checked={!!settings.subPingAfterUpdate}
              onToggle={(v) => update("subPingAfterUpdate", v)}
            />
            <Toggle
              label="Отправлять ID устройства (x-hwid)"
              desc="Заголовок x-hwid — некоторые провайдеры требуют"
              checked={!!settings.subSendHwid}
              onToggle={(v) => update("subSendHwid", v)}
            />
            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Свой User-Agent</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Пусто — стандартный 67VPN/0.6.0
                </div>
              </div>
              <input
                type="text"
                className="search-input"
                style={{ width: 220, paddingLeft: 10 }}
                placeholder="67VPN/0.6.0"
                value={settings.subUserAgent || ""}
                onChange={(e) => update("subUserAgent", e.target.value)}
              />
            </div>

            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Уровень логов</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Детализация вывода в разделе «Логи туннеля»
                </div>
              </div>
              <div className="core-selector">
                {(["debug", "info", "warn", "error"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    className={`core-btn ${settings.logLevel === lvl ? "active" : ""}`}
                    onClick={() => update("logLevel", lvl)}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Лимит строк лога</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Сколько последних строк хранить в памяти
                </div>
              </div>
              <div className="core-selector">
                {[250, 500, 1000, 2000, 5000].map((lim) => (
                  <button
                    key={lim}
                    className={`core-btn ${(settings.logLimit || 2000) === lim ? "active" : ""}`}
                    onClick={() => {
                      update("logLimit", lim);
                      invoke("set_log_limit", { limit: lim }).catch(() => {});
                    }}
                  >
                    {lim}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {cat === "notifications" && (
          <>
            <Toggle
              label="Включить уведомления"
              desc="Показывать уведомления о важных событиях VPN"
              checked={settings.notificationsEnabled !== false}
              onToggle={(v) => update("notificationsEnabled", v)}
            />
            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Стиль уведомлений</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Кастомное окно 67 VPN или стандартные Windows
                </div>
              </div>
              <div className="core-selector">
                <button
                  className={`core-btn ${(settings.notificationStyle || "custom") === "custom" ? "active" : ""}`}
                  onClick={() => update("notificationStyle", "custom")}
                >
                  Кастомные
                </button>
                <button
                  className={`core-btn ${settings.notificationStyle === "system" ? "active" : ""}`}
                  onClick={() => update("notificationStyle", "system")}
                >
                  Системные
                </button>
              </div>
            </div>
            <Toggle
              label="Падение ядра и переподключение (Watchdog)"
              desc="Уведомлять при сбое ядра и автоперезапуске"
              checked={settings.notifyWatchdog !== false}
              onToggle={(v) => update("notifyWatchdog", v)}
            />
            <Toggle
              label="Обновление подписок"
              desc="Уведомлять об успешном обновлении или ошибке"
              checked={settings.notifySubUpdate !== false}
              onToggle={(v) => update("notifySubUpdate", v)}
            />
            <Toggle
              label="Истечение срока или трафика"
              desc="Предупреждать, когда подписка скоро закончится"
              checked={settings.notifySubExpire !== false}
              onToggle={(v) => update("notifySubExpire", v)}
            />
            <Toggle
              label="Срабатывание Kill Switch"
              desc="Уведомлять при блокировке трафика"
              checked={settings.notifyKillSwitch !== false}
              onToggle={(v) => update("notifyKillSwitch", v)}
            />
            <Toggle
              label="Подключение / отключение VPN"
              desc="Показывать уведомление при каждом переключении"
              checked={!!settings.notifyConnect}
              onToggle={(v) => update("notifyConnect", v)}
            />
          </>
        )}

        {cat === "backup" && (
          <>
            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Экспорт конфигурации</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Скачать все подписки, серверы и настройки в JSON-файл
                </div>
              </div>
              <button
                className="primary-btn"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
                onClick={() => {
                  const data = onExportBackup();
                  const blob = new Blob([data], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "67-vpn-backup.json";
                  a.click();
                  URL.revokeObjectURL(url);
                  setBackupMsg("Резервная копия сохранена");
                }}
              >
                <Download size={14} /> Экспорт
              </button>
            </div>

            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Импорт конфигурации</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Восстановить данные из JSON-файла
                </div>
              </div>
              <label
                className="check-btn"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <Upload size={14} /> Импорт
                <input
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    file.text().then((txt) => {
                      const ok = onImportBackup(txt);
                      setBackupMsg(
                        ok ? "Данные успешно восстановлены" : "Ошибка чтения файла"
                      );
                    });
                  }}
                />
              </label>
            </div>

            <div className="settings-card">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Сбросить статистику</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Обнулить счётчик общего трафика за всё время
                </div>
              </div>
              <button className="check-btn" onClick={onResetStats}>
                Сбросить
              </button>
            </div>

            {backupMsg && (
              <div style={{ fontSize: 12, color: "var(--accent)", paddingLeft: 4 }}>
                {backupMsg}
              </div>
            )}
          </>
        )}

        {cat === "about" && (
          <>
            <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Приложение</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>67 VPN v0.9.0</span>
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

            <Toggle
              label="Получать пре-релизы (Beta)"
              desc="Ранние тестовые сборки — могут работать нестабильно"
              checked={!!settings.includePrerelease}
              onToggle={(v) => update("includePrerelease", v)}
            />
            <div className="settings-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Текущая версия</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>v0.9.0</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Новая версия</span>
                <span style={{ fontWeight: 600, fontSize: 13, color: updateStatus.hasUpdate ? "var(--accent)" : "var(--text-primary)" }}>
                  {updateStatus.latest ? `v${updateStatus.latest}` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="check-btn"
                  style={{ flex: 1, justifyContent: "center" }}
                  disabled={updateStatus.checking}
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
                        currentVersion: "0.9.0",
                        includePrerelease: !!settings.includePrerelease,
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
                  style={{ flex: 1, opacity: updateStatus.hasUpdate && updateStatus.url ? 1 : 0.45 }}
                  disabled={!updateStatus.hasUpdate || !updateStatus.url}
                  onClick={async () => {
                    if (updateStatus.url) {
                      try {
                        await invoke("download_and_run_update", { url: updateStatus.url });
                      } catch {
                        import("@tauri-apps/plugin-opener").then((m) =>
                          m.openUrl(updateStatus.url!)
                        );
                      }
                    }
                  }}
                >
                  Обновить
                </button>
              </div>
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
                  whiteSpace: "pre-wrap",
                  minHeight: 80,
                  maxHeight: 160,
                  overflowY: "auto",
                }}
              >
                {updateStatus.changelog || "Changelog появится после проверки обновлений."}
              </div>
            </div>
          </>
        )}
      </div>
      </div>

      {changedKeys.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 16px",
            borderRadius: 14,
            background: "rgba(15, 23, 42, 0.94)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--glass-border-strong)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            zIndex: 65,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>Настройки изменены</span>
          <button className="check-btn" onClick={() => setDiffOpen(true)}>
            Подробнее
          </button>
          <button
            className="check-btn"
            onClick={() => {
              setSettings(structuredClone(savedSettings));
              setDiffOpen(false);
            }}
          >
            Отмена
          </button>
          <button
            className="primary-btn"
            onClick={() => {
              onChange(structuredClone(settings));
              setDiffOpen(false);
            }}
          >
            Применить
          </button>
        </div>
      )}

      {diffOpen && (
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
              width: 460,
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
            <div style={{ fontWeight: 700, fontSize: 16 }}>Изменённые настройки</div>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
              {changedKeys.map((k) => (
                <div
                  key={k}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid var(--border-color)",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--accent)" }}>{k}</div>
                  <div style={{ color: "var(--text-muted)", marginTop: 2, wordBreak: "break-all" }}>
                    {String(typeof savedSettings[k] === "object" ? "[объект]" : savedSettings[k])} →{" "}
                    {String(typeof settings[k] === "object" ? "[объект]" : settings[k])}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="check-btn" onClick={() => setDiffOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
