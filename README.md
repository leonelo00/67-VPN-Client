# 67 VPN Client

Десктопный VPN-клиент для Windows с поддержкой **sing-box** и **Xray-core**.

## Стек
- **Frontend:** React, TypeScript, Vite
- **Backend:** Rust, Tauri v2
- **Ядра:** `sing-box` (TUN / Hysteria2 / VLESS), `Xray-core` (VLESS + XHTTP + Reality)

## Возможности
- **Режимы работы:** системный **TUN** (`wintun`) и **Системный прокси**
- **Автовыбор ядра:** автоматическое переключение между `sing-box` и `Xray-core` (включая TUN-мост для XHTTP)
- **Маршрутизация:** профили с порядком правил, массовый импорт доменов/IP, `Bypass LAN`, `Sniffing`, `FakeDNS`, `.srs` rule-set'ы
- **Per-App:** туннелирование или обход VPN для выбранных приложений
- **DPI и стабильность:** TLS-фрагментация, `noises`, `Mux`/`xUDP`, `Watchdog`, `Kill Switch`, `Job Object`
- **Пинг и статистика:** TCP, HTTP HEAD/GET, ICMP пинг; график скорости и логи ядер в реальном времени
- **Уведомления и обновления:** кастомные/системные уведомления и проверка обновлений через GitHub Releases

## Установка и сборка
1. Установите зависимости:
   ```bash
   npm install
   ```
2. Поместите `sing-box.exe`, `xray.exe` и `wintun.dll` в `src-tauri/binaries/`:
   - `sing-box.exe`: https://github.com/SagerNet/sing-box/releases
   - `xray.exe`: https://github.com/XTLS/Xray-core/releases
   - `wintun.dll`: https://www.wintun.net/
3. Соберите клиент:
   ```bash
   npm run tauri build -- --no-bundle
   ```
   Готовый файл: `src-tauri/target/release/67_VPN_Client.exe`.
