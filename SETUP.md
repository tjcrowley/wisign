# FTSign @ Frontier Tower — Setup Guide
## Hackathon #2, March 28 2026

---

## What We're Doing
Installing FTSign on a dedicated Tower machine and casting to Fire TV sticks via Silk Browser (SSDP/DIAL).

---

## Prerequisites (confirm on arrival)
- [ ] Dedicated machine is on the Tower WiFi/LAN
- [ ] You have SSH or physical access to the machine
- [ ] Fire TV sticks are plugged in, on the same network segment
- [ ] Silk Browser is installed on each Fire TV (comes pre-installed on most)

---

## Step 1 — Install FTSign on the Dedicated Machine

### If macOS:
```bash
# Install Node (if not present)
brew install node

# Clone FTSign
git clone https://github.com/tjcrowley/wisign.git ~/ftsign
cd ~/ftsign
npm install

# Run it
npm start
# → FTSign runs at http://localhost:3000
```

### If Linux (Ubuntu/Debian):
```bash
# Install Node 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Clone FTSign
git clone https://github.com/tjcrowley/wisign.git ~/ftsign
cd ~/ftsign
npm install

npm start
# → http://localhost:3000
```

### If Linux — run as a service (so it survives reboots):
```bash
sudo tee /etc/systemd/system/ftsign.service > /dev/null <<EOF
[Unit]
Description=FTSign Digital Signage Controller
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOME/ftsign
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ftsign
sudo systemctl start ftsign

# Check it's running:
sudo systemctl status ftsign
curl http://localhost:3000
```

---

## Step 2 — Open FTSign in a Browser
Navigate to `http://[machine-ip]:3000` from any device on the Tower network.
- Find machine IP: `ip addr` (Linux) or `ipconfig getifaddr en0` (Mac)
- Example: `http://192.168.1.50:3000`

---

## Step 3 — Prep the Fire TV Sticks

On **each Fire TV**, before trying to cast:

1. Boot to home screen
2. Open **Silk Browser** (search if not on home screen)
3. Navigate Silk to: `http://[machine-ip]:3000`
   - This confirms network connectivity AND pre-loads the page
4. Leave Silk open (minimize, don't close)

> **Note:** FTSign casts via DIAL protocol — it tells Silk Browser to open a URL.
> Silk must already be running (or at least installed) for DIAL to work.

---

## Step 4 — Cast from FTSign

1. In FTSign UI (`http://[machine-ip]:3000`), go to **Devices** or cast button
2. Fire TV sticks should appear via SSDP discovery (give it 10–15 sec to scan)
3. If a stick doesn't appear:
   - Confirm it's on the same subnet (not a guest VLAN)
   - Try clicking "Scan" or "Refresh" in FTSign
   - Manually enter the Fire TV's IP if there's an option
4. Select the stick → Cast → pick a playlist/channel

---

## Troubleshooting

### Fire TV not showing up in FTSign
- **Subnet issue** — most common cause. Fire TVs and the FTSign machine must be on the same network segment. If Tower has multiple VLANs, confirm both are on the same one.
- **SSDP blocked** — some managed switches block multicast. Try: `sudo nmap -sU -p 1900 [firetv-ip]` to test.
- **Silk not running** — DIAL requires an active DIAL server on the Fire TV. Silk Browser runs one. Open Silk on the Fire TV first.

### Cast works but screen goes black after a few minutes
- Fire TV sleep/screensaver kicking in. Disable via: Settings → Display → Screen Saver → set to "Never" or longest interval.

### FTSign can't find Fire TVs but you know their IPs
- Check if FTSign supports manual IP entry (`WISIGN_FIRE_APP_ID` env var in TOOLS.md suggests there may be config options)
- Alternatively: just point Silk Browser on the Fire TV directly to `http://[machine-ip]:3000` — it'll run as a web kiosk without casting

### Port 3000 not accessible from other machines
```bash
# On Linux, open firewall:
sudo ufw allow 3000/tcp
```

---

## Quick Reference

| Thing | Value |
|---|---|
| FTSign URL | `http://[machine-ip]:3000` |
| Cast protocol | SSDP/DIAL → Silk Browser |
| Fire TV sleep | Disable in Settings → Display |
| FTSign repo | https://github.com/tjcrowley/wisign |
| Service restart (Linux) | `sudo systemctl restart ftsign` |
| Service restart (Mac) | `launchctl kickstart -k gui/$(id -u)/com.ftsign.controller` |

---

## If Everything Breaks — Nuclear Option
Skip casting entirely. On each Fire TV:
1. Open Silk Browser
2. Navigate to `http://[machine-ip]:3000`
3. Done — it runs as a full-screen web kiosk

Not as elegant as casting but gets the TVs showing content immediately while you debug.
