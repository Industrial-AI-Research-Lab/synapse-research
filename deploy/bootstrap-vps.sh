#!/usr/bin/env bash

# Run once as root on an Ubuntu 24.04 VPS. It installs Docker Engine and
# creates the directory consumed by the GitHub Actions deployment workflow.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

GHCR_OWNER="${GHCR_OWNER:-industrial-ai-research-lab}"
APP_DIR="/opt/pav"

apt-get update
apt-get install -y ca-certificates curl gnupg ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

install -d -m 0700 "$APP_DIR"
if [ ! -f "$APP_DIR/.env" ]; then
  cat >"$APP_DIR/.env" <<EOF
GHCR_OWNER=$GHCR_OWNER
IMAGE_TAG=
CADDY_SITE_ADDRESS=:80
DOCUMENT_ACCESS_TOKEN=
DOCUMENT_ACCESS_CODE_COPY_ENABLED=false
EOF
  chmod 0600 "$APP_DIR/.env"
fi

echo "VPS is ready. Fill /opt/pav/.env, add the GitHub Actions deploy public key to /root/.ssh/authorized_keys, then configure GitHub repository secrets."
