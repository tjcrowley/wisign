#!/usr/bin/env bash
# Pull latest code and restart the player service
set -e
cd "$(git rev-parse --show-toplevel)"
echo "→ Pulling latest..."
git pull
echo "→ Installing deps..."
npm install --prefix packages/player-pi --omit=dev 2>/dev/null
echo "→ Restarting service..."
sudo systemctl restart wisign-player
echo "→ Done. Logs:"
journalctl -u wisign-player -n 20 --no-pager
