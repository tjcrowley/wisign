#!/usr/bin/env bash
# FTSign (wisign) install script — Frontier Tower Hackathon #2
# Works on macOS and Ubuntu/Debian Linux
set -euo pipefail

REPO="https://github.com/tjcrowley/wisign.git"
INSTALL_DIR="$HOME/ftsign"

echo "======================================"
echo "  FTSign Install — Frontier Tower"
echo "======================================"

OS=$(uname -s)
echo "Detected OS: $OS"

# ── Install Node if missing ────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo ""
  echo "[1/3] Installing Node.js..."
  if [[ "$OS" == "Darwin" ]]; then
    if ! command -v brew &>/dev/null; then
      echo "Installing Homebrew first..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    brew install node
  elif [[ "$OS" == "Linux" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    echo "ERROR: Unsupported OS: $OS"; exit 1
  fi
else
  echo "[1/3] Node.js already installed: $(node -v)"
fi

# ── Clone repo ─────────────────────────────────────────────────────────────────
echo ""
echo "[2/3] Cloning wisign → $INSTALL_DIR..."
if [[ -d "$INSTALL_DIR" ]]; then
  echo "  Directory exists, pulling latest..."
  cd "$INSTALL_DIR" && git pull
else
  git clone "$REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
npm install

# ── Set up as a service ────────────────────────────────────────────────────────
echo ""
echo "[3/3] Setting up auto-start service..."

if [[ "$OS" == "Darwin" ]]; then
  PLIST="$HOME/Library/LaunchAgents/com.ftsign.controller.plist"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ftsign.controller</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>$INSTALL_DIR/app.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/ftsign/ftsign.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/ftsign/ftsign.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "  Service loaded (launchd)"

elif [[ "$OS" == "Linux" ]]; then
  NODE_BIN=$(which node)
  sudo tee /etc/systemd/system/ftsign.service > /dev/null <<SERVICE
[Unit]
Description=FTSign Digital Signage Controller
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/app.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE
  sudo systemctl daemon-reload
  sudo systemctl enable ftsign
  sudo systemctl start ftsign
  echo "  Service enabled (systemd)"
fi

# ── Done ───────────────────────────────────────────────────────────────────────
MACHINE_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "unknown")

echo ""
echo "======================================"
echo "  ✅ FTSign is running!"
echo ""
echo "  Open on this machine:  http://localhost:3000"
echo "  Open from any device:  http://$MACHINE_IP:3000"
echo ""
echo "  Fire TV setup:"
echo "  1. Open Silk Browser on each Fire TV"
echo "  2. Navigate to http://$MACHINE_IP:3000"
echo "  3. Or cast from the FTSign UI"
echo "======================================"
