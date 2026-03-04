# FTSign 📺

Local-network HTML digital signage. Control a fleet of TVs from a single admin UI.

## Architecture

```
Controller (Node.js)  ←→  Players (Electron / Pi / Android)
       ↕                          ↕
  Admin Web UI              Fullscreen WebView
       ↕
  Cast Devices (Chromecast / Cast-enabled TVs)
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the Controller

```bash
npm run dev:controller
# → http://localhost:3000
```

### 3. Start a Player (on any machine on the same network)

```bash
npm run dev:player
# Electron app opens, discovers the controller via mDNS, registers itself
```

### 4. Assign a sign

Open http://localhost:3000, go to **Assign**, pick a screen and sign → Push.

---

## Chromecast / Cast Support

FTSign discovers Cast-enabled devices (Chromecasts, Android TVs, smart TVs) on your LAN automatically.

### MVP (works now)
- The controller discovers Cast devices via mDNS (`_googlecast._tcp`)
- You can cast signs to any discovered device from the **Cast** tab in the admin UI
- Signs are loaded as URLs (controller serves the HTML)

### Custom Receiver (for full HTML support)

The Default Media Receiver has limited HTML support. For full arbitrary HTML:

1. Register a developer account at https://cast.google.com/publish ($5 one-time)
2. Register a **Custom Receiver** pointing to:
   ```
   http://<your-controller-ip>:3000/cast-receiver.html
   ```
3. Note your App ID and set it:
   ```bash
   export FTSIGN_CAST_APP_ID=<your-app-id>
   ```

### Apple TV

Apple TV doesn't support Cast. Options:
- **AirPlay mirroring** from a Mac/iOS device (not push-based)
- Build a tvOS app (future roadmap)

---

## Player Types

| Platform | How to run |
|---|---|
| Any Mac/PC | `npm run dev:player` |
| Raspberry Pi | Install Electron, same command |
| Android TV | Coming soon (WebView + WS client) |
| Chromecast | Built-in via Cast tab |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FTSIGN_PORT` | `3000` | Controller HTTP/WS port |
| `FTSIGN_DB` | `ftsign.db` | SQLite database path |
| `FTSIGN_CAST_APP_ID` | `CC1AD845` | Cast receiver App ID |
| `FTSIGN_CONTROLLER` | `ws://localhost:3000/ws` | Player fallback (if mDNS fails) |

---

## WebSocket Protocol

All messages are JSON with envelope:
```json
{ "type": "...", "device_id": "...", "timestamp": "...", "payload": {} }
```

Message types: `REGISTER`, `REGISTER_OK`, `LOAD_SIGN`, `ACK`, `ERROR`, `HEARTBEAT`, `PING`, `PONG`

---

## Roadmap

- [ ] Playlists + scheduling
- [ ] Asset upload (images/fonts)
- [ ] Android TV player app  
- [ ] Role-based auth (RBAC)
- [ ] Bundle packaging + offline cache
- [ ] Emergency broadcast
- [ ] tvOS / AirPlay integration
- [ ] Multi-controller scaling (Redis pubsub)
