# 67 VPN Client

Лёгкий десктопный VPN-клиент для Windows на базе **Tauri v2 (Rust)** + **React + TypeScript** с поддержкой двух ядер: **sing-box** и **Xray-core**.

## Возможности
- **Два ядра с автовыбором:** `sing-box` (TUN / Hysteria2 / VLESS) и `Xray-core` (VLESS + XHTTP + Reality) с автоматическим TUN-мостом.
- **Режимы работы:** системный **TUN** (`wintun`) и **Системный прокси**.
- **Маршрутизация:** профили маршрутизации, настраиваемый порядок правил (`block → proxy → direct` и др.), массовый импорт доменов и IP/CIDR, `Bypass LAN`, `Sniffing`, `FakeDNS`.
- **Per-App (туннелирование по приложениям):** режимы «В обход VPN» и «Только через прокси» с выбором из запущенных процессов, установленных программ или `.exe`.
- **Обход DPI и стабильность:** TLS-фрагментация, `noises`, `Mux` / `xUDP`, `Watchdog` (автопереподключение), `Kill Switch`, Windows Job Object (автозавершение ядер при снятии задачи).
- **Пинг:** `TCP-коннект`, `HTTP HEAD`, `HTTP GET` (через прокси) и `ICMP`.
- **Уведомления:** кастомные всплывающие окна в стиле 67 VPN или системные уведомления Windows.

## Подготовка бинарников
Перед сборкой или запуском в dev-режиме поместите в `src-tauri/binaries/`:
- `sing-box.exe`
- `xray.exe`
- `wintun.dll`

## Сборка
```bash
npm install
npm run tauri build -- --no-bundle
```
Готовый файл появится в `src-tauri/target/release/67_VPN_Client.exe`.
