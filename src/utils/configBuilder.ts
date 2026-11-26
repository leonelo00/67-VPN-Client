import { ServerNode } from "./parser";
import { AppSettings } from "../components/SettingsPage";

export function buildCoreConfig(
  core: "sing-box" | "xray",
  server: ServerNode,
  mode: "tun" | "proxy",
  settings: AppSettings
): string {
  if (server.rawUri?.startsWith("raw-json://")) {
    return server.rawUri.slice("raw-json://".length);
  }
  if (!server.rawUri || !server.rawUri.includes("://")) {
    throw new Error(
      "Нельзя подключиться к демо-серверу. Добавьте реальный сервер или подписку."
    );
  }
  if (core === "sing-box") {
    return buildSingBoxConfig(server, mode, settings);
  }
  return buildXrayConfig(server, settings);
}

function pushParsedRuleGroup(
  routeRules: Record<string, unknown>[],
  ruleSets: Map<string, { tag: string; url: string }>,
  rules: string[],
  outboundTag: string
) {
  const ipCidrs: string[] = [];
  const domainSuffixes: string[] = [];
  const domainExact: string[] = [];
  const domainKeywords: string[] = [];
  const domainRegexes: string[] = [];
  const matchedRuleSets: string[] = [];
  let hasPrivate = false;

  for (const raw of rules) {
    const item = raw.trim();
    if (!item) continue;

    if (item === "geoip:private" || item === "geosite:private") {
      hasPrivate = true;
      continue;
    }
    if (item.startsWith("geosite:")) {
      const name = item.slice(8).trim().toLowerCase();
      if (name) {
        const tag = `geosite-${name}`;
        ruleSets.set(tag, {
          tag,
          url: `https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-${name}.srs`,
        });
        matchedRuleSets.push(tag);
      }
      continue;
    }
    if (item.startsWith("geoip:")) {
      const name = item.slice(6).trim().toLowerCase();
      if (name) {
        const tag = `geoip-${name}`;
        ruleSets.set(tag, {
          tag,
          url: `https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-${name}.srs`,
        });
        matchedRuleSets.push(tag);
      }
      continue;
    }
    if (item.startsWith("full:")) {
      const val = item.slice(5).trim();
      if (val) domainExact.push(val);
      continue;
    }
    if (item.startsWith("keyword:")) {
      const val = item.slice(8).trim();
      if (val) domainKeywords.push(val);
      continue;
    }
    if (item.startsWith("regexp:")) {
      const val = item.slice(7).trim();
      if (val) domainRegexes.push(val);
      continue;
    }
    if (item.startsWith("domain:")) {
      const val = item.slice(7).trim();
      if (val) domainSuffixes.push(val);
      continue;
    }
    // IPv4 or IPv6 CIDR / IP
    if (/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(item) || /^[0-9a-fA-F:]+(\/\d+)?$/.test(item) && item.includes(":")) {
      ipCidrs.push(item);
      continue;
    }
    domainSuffixes.push(item);
  }

  if (hasPrivate) routeRules.push({ ip_is_private: true, outbound: outboundTag });
  if (ipCidrs.length > 0) routeRules.push({ ip_cidr: ipCidrs, outbound: outboundTag });
  if (domainExact.length > 0) routeRules.push({ domain: domainExact, outbound: outboundTag });
  if (domainSuffixes.length > 0) routeRules.push({ domain_suffix: domainSuffixes, outbound: outboundTag });
  if (domainKeywords.length > 0) routeRules.push({ domain_keyword: domainKeywords, outbound: outboundTag });
  if (domainRegexes.length > 0) routeRules.push({ domain_regex: domainRegexes, outbound: outboundTag });
  if (matchedRuleSets.length > 0) routeRules.push({ rule_set: matchedRuleSets, outbound: outboundTag });
}

export function buildSingBoxTunBridgeConfig(
  settings: AppSettings,
  serverAddress: string
): string {
  const dnsRemoteIp =
    settings.dnsServer === "system"
      ? "1.1.1.1"
      : settings.dnsServer === "adguard"
      ? "94.140.14.14"
      : settings.dnsServer;

  const routeRules: Record<string, unknown>[] = [
    ...(settings.sniffing !== false ? [{ action: "sniff" }] : []),
    { process_name: ["xray.exe"], outbound: "direct" },
  ];
  const ruleSets = new Map<string, { tag: string; url: string }>();

  const activeProfile = settings.routingProfiles?.find(
    (p) => p.id === settings.activeProfileId
  );

  if (activeProfile) {
    if (activeProfile.bypassLan) {
      routeRules.push({ ip_is_private: true, outbound: "direct" });
    }
    const order = (activeProfile.ruleOrder || "block-proxy-direct").split("-") as (
      | "block"
      | "proxy"
      | "direct"
    )[];
    for (const kind of order) {
      if (kind === "direct") pushParsedRuleGroup(routeRules, ruleSets, activeProfile.directRules, "direct");
      if (kind === "proxy") pushParsedRuleGroup(routeRules, ruleSets, activeProfile.proxyRules, "proxy");
      if (kind === "block") pushParsedRuleGroup(routeRules, ruleSets, activeProfile.blockRules, "block");
    }
  } else if (settings.routingMode === "bypass_lan") {
    routeRules.push({ ip_is_private: true, outbound: "direct" });
  }

  if (settings.perAppEnabled) {
    const items = settings.perAppItems || [];
    const byName = items.filter((i) => i.matchBy === "name").map((i) => i.name);
    const byPath = items.filter((i) => i.matchBy === "path").map((i) => i.path);
    const outTag = settings.perAppMode === "bypass" ? "direct" : "proxy";
    if (byName.length > 0) routeRules.push({ process_name: byName, outbound: outTag });
    if (byPath.length > 0) routeRules.push({ process_path: byPath, outbound: outTag });
  }

  const finalOutbound =
    settings.perAppEnabled && settings.perAppMode === "proxy" ? "direct" : "proxy";

  const dnsLocal =
    settings.domesticDns && settings.domesticDns !== "system"
      ? { tag: "dns-local", type: "udp", server: settings.domesticDns }
      : { tag: "dns-local", type: "local" };

  const dnsStrategy =
    settings.ipv6Mode === "disable"
      ? "ipv4_only"
      : settings.ipv6Mode === "enable"
      ? "prefer_ipv6"
      : "prefer_ipv4";

  return JSON.stringify(
    {
      log: { level: settings.logLevel },
      experimental: {
        clash_api: {
          external_controller: "127.0.0.1:9090",
        },
      },
      dns: {
        servers: [
          { tag: "dns-remote", type: "udp", server: dnsRemoteIp, detour: "proxy" },
          dnsLocal,
          ...(settings.fakeDns
            ? [{ tag: "dns-fakeip", type: "fakeip", inet4_range: "198.18.0.0/15" }]
            : []),
        ],
        rules: [
          ...(serverAddress ? [{ domain: [serverAddress], server: "dns-local" }] : []),
          ...(settings.fakeDns ? [{ query_type: ["A", "AAAA"], server: "dns-fakeip" }] : []),
        ],
        strategy: dnsStrategy,
        final: "dns-remote",
      },
      inbounds: [
        {
          type: "tun",
          tag: "tun-in",
          interface_name: "67VPN",
          address: ["172.26.0.1/30"],
          mtu: Math.min(9000, Math.max(576, settings.tunMtu || 1500)),
          auto_route: true,
          strict_route: settings.strictRoute,
          stack: settings.tunStack,
          udp_timeout: "15s",
        },
      ],
      outbounds: [
        {
          type: "socks",
          tag: "proxy",
          server: "127.0.0.1",
          server_port: settings.localPort,
        },
        { type: "direct", tag: "direct" },
        { type: "block", tag: "block" },
      ],
      route: {
        auto_detect_interface: true,
        default_domain_resolver: "dns-local",
        ...(ruleSets.size > 0
          ? {
              rule_set: Array.from(ruleSets.values()).map((rs) => ({
                tag: rs.tag,
                type: "remote",
                format: "binary",
                url: rs.url,
                download_detour: "proxy",
              })),
            }
          : {}),
        rules: routeRules,
        final: finalOutbound,
      },
    },
    null,
    2
  );
}

function buildSingBoxConfig(
  server: ServerNode,
  mode: "tun" | "proxy",
  settings: AppSettings
): string {
  const listenAddr = settings.allowLan ? "0.0.0.0" : "127.0.0.1";
  const inbounds: Record<string, unknown>[] = [
    {
      type: "mixed",
      tag: "mixed-in",
      listen: listenAddr,
      listen_port: settings.localPort,
    },
  ];

  if (mode === "tun") {
    inbounds.unshift({
      type: "tun",
      tag: "tun-in",
      interface_name: "67VPN",
      address: ["172.26.0.1/30"],
      mtu: settings.tunMtu,
      auto_route: true,
      strict_route: settings.strictRoute,
      stack: settings.tunStack,
      udp_timeout: "15s",
    });
  }

  let outbound: Record<string, unknown> | null = null;

  try {
    if (server.rawUri.startsWith("vless://")) {
      const url = new URL(server.rawUri);
      const security = url.searchParams.get("security") || "none";
      const sni = url.searchParams.get("sni") || url.hostname;
      const fp = url.searchParams.get("fp") || "chrome";
      const pbk = url.searchParams.get("pbk") || "";
      const sid = url.searchParams.get("sid") || "";
      const flow = url.searchParams.get("flow") || "";
      const type = url.searchParams.get("type") || "tcp";

      outbound = {
        type: "vless",
        tag: "proxy",
        server: url.hostname,
        server_port: Number(url.port) || 443,
        uuid: decodeURIComponent(url.username),
        ...(flow ? { flow } : {}),
        ...(security !== "none"
          ? {
              tls: {
                enabled: true,
                server_name: sni,
                insecure: !!settings.allowInsecure,
                utls: { enabled: true, fingerprint: fp },
                ...(security === "reality"
                  ? {
                      reality: {
                        enabled: true,
                        public_key: pbk,
                        short_id: sid,
                      },
                    }
                  : {}),
              },
            }
          : {}),
        ...(type === "ws"
          ? {
              transport: {
                type: "ws",
                path: url.searchParams.get("path") || "/",
              },
            }
          : {}),
      };
    } else if (
      server.rawUri.startsWith("hy2://") ||
      server.rawUri.startsWith("hysteria2://")
    ) {
      const normalized = server.rawUri.replace(/^hysteria2:\/\//, "hy2://");
      const url = new URL(normalized);
      outbound = {
        type: "hysteria2",
        tag: "proxy",
        server: url.hostname,
        server_port: Number(url.port) || 443,
        password: decodeURIComponent(url.username),
        tls: {
          enabled: true,
          server_name: url.searchParams.get("sni") || url.hostname,
          insecure: url.searchParams.get("insecure") === "1",
        },
      };
    } else if (server.rawUri.startsWith("trojan://")) {
      const url = new URL(server.rawUri);
      outbound = {
        type: "trojan",
        tag: "proxy",
        server: url.hostname,
        server_port: Number(url.port) || 443,
        password: decodeURIComponent(url.username),
        tls: {
          enabled: true,
          server_name: url.searchParams.get("sni") || url.hostname,
        },
      };
    } else if (server.rawUri.startsWith("vmess://")) {
      const json = JSON.parse(atob(server.rawUri.slice("vmess://".length)));
      outbound = {
        type: "vmess",
        tag: "proxy",
        server: json.add,
        server_port: Number(json.port) || 443,
        uuid: json.id,
        alter_id: Number(json.aid) || 0,
        security: json.scy || "auto",
        ...(json.tls === "tls"
          ? {
              tls: {
                enabled: true,
                server_name: json.sni || json.host || json.add,
              },
            }
          : {}),
      };
    } else if (server.rawUri.startsWith("ss://")) {
      const url = new URL(server.rawUri);
      const userInfo = url.username.includes(":")
        ? decodeURIComponent(url.username)
        : atob(decodeURIComponent(url.username));
      const [method, password] = userInfo.split(":");
      outbound = {
        type: "shadowsocks",
        tag: "proxy",
        server: url.hostname,
        server_port: Number(url.port) || 443,
        method,
        password,
      };
    }
  } catch {
    // fallback to direct if demo node has empty rawUri
  }

  if (!outbound) {
    throw new Error(`Протокол ${server.protocol} пока не поддерживается в sing-box`);
  }

  const dnsRemoteIp =
    settings.dnsServer === "system"
      ? "1.1.1.1"
      : settings.dnsServer === "adguard"
      ? "94.140.14.14"
      : settings.dnsServer;

  const dnsServers: Record<string, unknown>[] = [
    { tag: "dns-remote", type: "udp", server: dnsRemoteIp, detour: "proxy" },
    { tag: "dns-local", type: "local" },
  ];

  const routeRules: Record<string, unknown>[] =
    settings.sniffing !== false ? [{ action: "sniff" }] : [];
  const ruleSets = new Map<string, { tag: string; url: string }>();
  const activeProfile = settings.routingProfiles?.find(
    (p) => p.id === settings.activeProfileId
  );

  if (activeProfile) {
    if (activeProfile.bypassLan) {
      routeRules.push({ ip_is_private: true, outbound: "direct" });
    }
    const order = (activeProfile.ruleOrder || "block-proxy-direct").split("-") as (
      | "block"
      | "proxy"
      | "direct"
    )[];
    for (const kind of order) {
      if (kind === "direct") pushParsedRuleGroup(routeRules, ruleSets, activeProfile.directRules, "direct");
      if (kind === "proxy") pushParsedRuleGroup(routeRules, ruleSets, activeProfile.proxyRules, "proxy");
      if (kind === "block") pushParsedRuleGroup(routeRules, ruleSets, activeProfile.blockRules, "block");
    }
  } else if (settings.routingMode === "bypass_lan") {
    routeRules.push({ ip_is_private: true, outbound: "direct" });
  }

  if (settings.perAppEnabled) {
    const items = settings.perAppItems || [];
    const byName = items.filter((i) => i.matchBy === "name").map((i) => i.name);
    const byPath = items.filter((i) => i.matchBy === "path").map((i) => i.path);
    const outTag = settings.perAppMode === "bypass" ? "direct" : "proxy";
    if (byName.length > 0) routeRules.push({ process_name: byName, outbound: outTag });
    if (byPath.length > 0) routeRules.push({ process_path: byPath, outbound: outTag });
  }

  const dnsRules: Record<string, unknown>[] = [];
  if (server.address) {
    dnsRules.push({ domain: [server.address], server: "dns-local" });
  }

  const finalOutbound =
    settings.perAppEnabled && settings.perAppMode === "proxy" ? "direct" : "proxy";

  return JSON.stringify(
    {
      log: { level: settings.logLevel },
      experimental: {
        clash_api: {
          external_controller: "127.0.0.1:9090",
        },
      },
      dns: {
        servers: dnsServers,
        rules: dnsRules,
        final: "dns-remote",
      },
      inbounds,
      outbounds: [outbound, { type: "direct", tag: "direct" }, { type: "block", tag: "block" }],
      route: {
        auto_detect_interface: true,
        default_domain_resolver: "dns-local",
        ...(ruleSets.size > 0
          ? {
              rule_set: Array.from(ruleSets.values()).map((rs) => ({
                tag: rs.tag,
                type: "remote",
                format: "binary",
                url: rs.url,
                download_detour: "proxy",
              })),
            }
          : {}),
        rules: routeRules,
        final: finalOutbound,
      },
    },
    null,
    2
  );
}

function buildXrayConfig(server: ServerNode, settings: AppSettings): string {
  const listenAddr = settings.allowLan ? "0.0.0.0" : "127.0.0.1";
  let outbound: Record<string, unknown> | null = null;

  try {
    if (server.rawUri.startsWith("vless://")) {
      const url = new URL(server.rawUri);
      const security = url.searchParams.get("security") || "none";
      const sni = url.searchParams.get("sni") || url.hostname;
      const fp = url.searchParams.get("fp") || "chrome";
      const pbk = url.searchParams.get("pbk") || "";
      const sid = url.searchParams.get("sid") || "";
      const flow = url.searchParams.get("flow") || "";
      const network = url.searchParams.get("type") || "tcp";

      outbound = {
        protocol: "vless",
        tag: "proxy",
        settings: {
          vnext: [
            {
              address: url.hostname,
              port: Number(url.port) || 443,
              users: [
                {
                  id: decodeURIComponent(url.username),
                  encryption: "none",
                  ...(flow ? { flow } : {}),
                },
              ],
            },
          ],
        },
        streamSettings: {
          network,
          security,
          ...(network === "xhttp"
            ? {
                xhttpSettings: {
                  path: url.searchParams.get("path") || "/",
                  ...(url.searchParams.get("host")
                    ? { host: url.searchParams.get("host") }
                    : {}),
                },
              }
            : {}),
          ...(security === "reality"
            ? {
                realitySettings: {
                  serverName: sni,
                  fingerprint: fp,
                  publicKey: pbk,
                  shortId: sid,
                },
              }
            : security === "tls"
            ? {
                tlsSettings: {
                  serverName: sni,
                  fingerprint: fp,
                  allowInsecure: !!settings.allowInsecure,
                },
              }
            : {}),
        },
      };
    } else if (server.rawUri.startsWith("trojan://")) {
      const url = new URL(server.rawUri);
      outbound = {
        protocol: "trojan",
        tag: "proxy",
        settings: {
          servers: [
            {
              address: url.hostname,
              port: Number(url.port) || 443,
              password: decodeURIComponent(url.username),
            },
          ],
        },
        streamSettings: {
          network: "tcp",
          security: "tls",
          tlsSettings: {
            serverName: url.searchParams.get("sni") || url.hostname,
          },
        },
      };
    } else if (server.rawUri.startsWith("vmess://")) {
      const json = JSON.parse(atob(server.rawUri.slice("vmess://".length)));
      outbound = {
        protocol: "vmess",
        tag: "proxy",
        settings: {
          vnext: [
            {
              address: json.add,
              port: Number(json.port) || 443,
              users: [{ id: json.id, alterId: Number(json.aid) || 0 }],
            },
          ],
        },
        streamSettings: {
          network: json.net || "tcp",
          security: json.tls === "tls" ? "tls" : "none",
        },
      };
    } else if (server.rawUri.startsWith("ss://")) {
      const url = new URL(server.rawUri);
      const userInfo = url.username.includes(":")
        ? decodeURIComponent(url.username)
        : atob(decodeURIComponent(url.username));
      const [method, password] = userInfo.split(":");
      outbound = {
        protocol: "shadowsocks",
        tag: "proxy",
        settings: {
          servers: [
            {
              address: url.hostname,
              port: Number(url.port) || 443,
              method,
              password,
            },
          ],
        },
      };
    }
  } catch {
    // fallback to freedom
  }

  if (!outbound) {
    throw new Error(`Протокол ${server.protocol} пока не поддерживается в Xray-core`);
  }

  const outbounds: Record<string, unknown>[] = [
    outbound,
    { protocol: "freedom", tag: "direct" },
  ];

  if (settings.mux) {
    outbound.mux = {
      enabled: true,
      concurrency: settings.muxConcurrency ?? 8,
      xudpConcurrency: settings.xudpConcurrency ?? -1,
      xudpProxyUDP443: settings.xudpProxyUDP443 || "reject",
    };
  }

  if (settings.tlsFragment || settings.noiseEnabled) {
    const stream = (outbound.streamSettings as Record<string, unknown>) || {};
    stream.sockopt = { dialerProxy: "fragment" };
    outbound.streamSettings = stream;
    outbounds.push({
      protocol: "freedom",
      tag: "fragment",
      settings: {
        ...(settings.tlsFragment
          ? {
              fragment: {
                packets: settings.tlsFragmentPackets || "tlshello",
                length: settings.tlsFragmentLength || "100-200",
                interval: settings.tlsFragmentInterval || "10-20",
              },
            }
          : {}),
        ...(settings.noiseEnabled
          ? {
              noises: [
                {
                  type: settings.noiseType || "rand",
                  packet: settings.noisePacket || "50-100",
                  delay: settings.noiseDelay || "10-16",
                },
              ],
            }
          : {}),
      },
    });
  }

  const routeRules: Record<string, unknown>[] =
    settings.sniffing !== false ? [{ action: "sniff" }] : [];
  const ruleSets = new Map<string, { tag: string; url: string }>();
  const activeProfile = settings.routingProfiles?.find(
    (p) => p.id === settings.activeProfileId
  );

  if (activeProfile) {
    if (activeProfile.bypassLan) {
      routeRules.push({ ip_is_private: true, outbound: "direct" });
    }
    const order = (activeProfile.ruleOrder || "block-proxy-direct").split("-") as (
      | "block"
      | "proxy"
      | "direct"
    )[];
    for (const kind of order) {
      if (kind === "direct") pushParsedRuleGroup(routeRules, ruleSets, activeProfile.directRules, "direct");
      if (kind === "proxy") pushParsedRuleGroup(routeRules, ruleSets, activeProfile.proxyRules, "proxy");
      if (kind === "block") pushParsedRuleGroup(routeRules, ruleSets, activeProfile.blockRules, "block");
    }
  } else if (settings.routingMode === "bypass_lan") {
    routeRules.push({ ip_is_private: true, outbound: "direct" });
  }

  if (settings.perAppEnabled) {
    const items = settings.perAppItems || [];
    const byName = items.filter((i) => i.matchBy === "name").map((i) => i.name);
    const byPath = items.filter((i) => i.matchBy === "path").map((i) => i.path);
    const outTag = settings.perAppMode === "bypass" ? "direct" : "proxy";
    if (byName.length > 0) routeRules.push({ process_name: byName, outbound: outTag });
    if (byPath.length > 0) routeRules.push({ process_path: byPath, outbound: outTag });
  }

  return JSON.stringify(
    {
      log: { loglevel: settings.logLevel === "warn" ? "warning" : settings.logLevel },
      dns: {
        servers: [
          settings.dnsServer === "system"
            ? "localhost"
            : settings.dnsServer === "adguard"
            ? "94.140.14.14"
            : settings.dnsServer,
        ],
      },
      inbounds: [
        {
          port: settings.localPort,
          listen: listenAddr,
          protocol: "socks",
          settings: { udp: true },
        },
        {
          port: settings.localPort + 1,
          listen: listenAddr,
          protocol: "http",
        },
      ],
      outbounds,
    },
    null,
    2
  );
}
