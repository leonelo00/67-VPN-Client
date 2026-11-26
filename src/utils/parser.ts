export interface ServerNode {
  id: string;
  name: string;
  protocol: "VLESS" | "VMESS" | "TROJAN" | "HY2" | "SS";
  transport?: string;
  security?: string;
  address: string;
  port: number;
  ping?: number;
  favorite?: boolean;
  rawUri: string;
}

export interface SubscriptionGroup {
  id: string;
  name: string;
  url?: string;
  updatedAt: string;
  intervalHours?: number;
  trafficUsed?: string;
  trafficTotal?: string;
  servers: ServerNode[];
}

export function parseProxyUri(uri: string): ServerNode | null {
  const trimmed = uri.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith("vless://")) {
      const url = new URL(trimmed);
      const name = decodeURIComponent(url.hash.replace(/^#/, "")) || url.hostname;
      const security = url.searchParams.get("security")?.toUpperCase() || undefined;
      const rawType = url.searchParams.get("type")?.toUpperCase();
      const transport = rawType && rawType !== "TCP" ? rawType : undefined;
      return {
        id: crypto.randomUUID(),
        name,
        protocol: "VLESS",
        transport,
        security: security === "NONE" ? undefined : security,
        address: url.hostname,
        port: Number(url.port) || 443,
        rawUri: trimmed,
      };
    }

    if (trimmed.startsWith("trojan://")) {
      const url = new URL(trimmed);
      const name = decodeURIComponent(url.hash.replace(/^#/, "")) || url.hostname;
      return {
        id: crypto.randomUUID(),
        name,
        protocol: "TROJAN",
        security: "TLS",
        address: url.hostname,
        port: Number(url.port) || 443,
        rawUri: trimmed,
      };
    }

    if (trimmed.startsWith("hy2://") || trimmed.startsWith("hysteria2://")) {
      const normalized = trimmed.replace(/^hysteria2:\/\//, "hy2://");
      const url = new URL(normalized);
      const name = decodeURIComponent(url.hash.replace(/^#/, "")) || url.hostname;
      return {
        id: crypto.randomUUID(),
        name,
        protocol: "HY2",
        security: "QUIC",
        address: url.hostname,
        port: Number(url.port) || 443,
        rawUri: trimmed,
      };
    }

    if (trimmed.startsWith("vmess://")) {
      const b64 = trimmed.slice("vmess://".length);
      const json = JSON.parse(atob(b64));
      return {
        id: crypto.randomUUID(),
        name: json.ps || json.add || "VMess Server",
        protocol: "VMESS",
        security: json.tls ? "TLS" : undefined,
        address: json.add || "",
        port: Number(json.port) || 443,
        rawUri: trimmed,
      };
    }

    if (trimmed.startsWith("ss://")) {
      const url = new URL(trimmed);
      const name = decodeURIComponent(url.hash.replace(/^#/, "")) || url.hostname || "Shadowsocks";
      return {
        id: crypto.randomUUID(),
        name,
        protocol: "SS",
        address: url.hostname || "shadowsocks",
        port: Number(url.port) || 443,
        rawUri: trimmed,
      };
    }
  } catch {
    return null;
  }

  return null;
}
