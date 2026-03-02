#!/usr/bin/env bash
set -e
echo "🍓 WiSign Pi Player Setup"
echo "========================="

# Node.js
if ! command -v node &>/dev/null; then
  echo "→ Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
else
  echo "✓ Node.js $(node -v) already installed"
fi

# Chromium
if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null; then
  echo "→ Installing Chromium..."
  sudo apt install -y chromium-browser
else
  echo "✓ Chromium already installed"
fi

# Disable screen blanking
echo "→ Disabling screen blanking..."
sudo mkdir -p /etc/X11/xorg.conf.d
sudo tee /etc/X11/xorg.conf.d/10-blanking.conf > /dev/null << 'XEOF'
Section "ServerFlags"
  Option "BlankTime" "0"
  Option "StandbyTime" "0"
  Option "SuspendTime" "0"
  Option "OffTime" "0"
EndSection
XEOF

# Install npm deps
echo "→ Installing player dependencies..."
cd "$(dirname "$0")"
npm install --omit=dev

# Systemd service
echo "→ Installing systemd service..."
PLAYER_DIR="$(pwd)"
PLAYER_USER="${SUDO_USER:-pi}"

sudo tee /etc/systemd/system/wisign-player.service > /dev/null << SVCEOF
[Unit]
Description=WiSign Pi Player
After=network-online.target graphical.target
Wants=network-online.target

[Service]
Type=simple
User=${PLAYER_USER}
WorkingDirectory=${PLAYER_DIR}
# Wait for display to be ready
ExecStartPre=/bin/bash -c 'for i in \$(seq 1 30); do [ -S /tmp/.X11-unix/X0 ] || [ -n "\$WAYLAND_DISPLAY" ] && break || sleep 1; done; true'
ExecStart=/usr/bin/node ${PLAYER_DIR}/src/agent.js
Restart=always
RestartSec=5
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/${PLAYER_USER}/.Xauthority
# Wayland support
Environment=WAYLAND_DISPLAY=wayland-1
Environment=XDG_RUNTIME_DIR=/run/user/1000

# Override controller URL if mDNS doesn't work on your network:
# Environment=WISIGN_CONTROLLER=ws://192.168.1.100:3000/ws

[Install]
WantedBy=graphical.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable wisign-player.service

# Also add autostart entry as fallback for desktop session
AUTOSTART_DIR="/home/${PLAYER_USER}/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
tee "$AUTOSTART_DIR/wisign-player.desktop" > /dev/null << DEOF
[Desktop Entry]
Type=Application
Name=WiSign Player
Exec=/usr/bin/node ${PLAYER_DIR}/src/agent.js
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
DEOF

echo ""
echo "✅ WiSign Pi Player installed!"
echo ""
echo "Commands:"
echo "  sudo systemctl start wisign-player    # start now"
echo "  sudo systemctl status wisign-player   # check status"
echo "  journalctl -u wisign-player -f        # view logs"
echo ""
echo "Reboot to start automatically: sudo reboot"
