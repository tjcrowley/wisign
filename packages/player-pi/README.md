# WiSign Pi Player

Lightweight WiSign player for Raspberry Pi. Uses Chromium in kiosk mode controlled via the Chrome DevTools Protocol (CDP) — no Electron needed.

## Requirements

- Raspberry Pi 4 or 5 (3 works too, just slower)
- Raspberry Pi OS (Bookworm recommended, 64-bit)
- Desktop environment (the agent needs an X display to launch Chromium)
- Same network as the WiSign Controller

## Quick Setup

```bash
# On the Pi:
git clone https://github.com/tjcrowley/wisign
cd wisign/packages/player-pi
chmod +x setup.sh
sudo ./setup.sh
sudo systemctl start wisign-player
```

The agent will:
1. Launch Chromium in kiosk mode (fullscreen, no chrome)
2. Discover the WiSign controller via mDNS automatically
3. Register as a screen
4. Load signs when assigned from the admin UI

## Manual override (if mDNS doesn't work)

```bash
sudo systemctl edit wisign-player
```

Add:
```ini
[Service]
Environment=WISIGN_CONTROLLER=ws://192.168.1.100:3000/ws
```

Then: `sudo systemctl restart wisign-player`

## Dev mode (windowed, for testing on desktop)

```bash
WISIGN_DEV=1 npm start
```

## Logs

```bash
journalctl -u wisign-player -f
```

## How it works

```
systemd → agent.js → spawns Chromium (--kiosk --remote-debugging-port=9222)
                   → connects to WiSign controller via WebSocket
                   → on LOAD_SIGN: sends Page.navigate via CDP to Chromium
                   → sends HEARTBEAT every 10s
```

No Electron, no heavy runtime — just Node.js (~50MB) + Chromium (already on Pi OS).
