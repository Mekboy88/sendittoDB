#!/usr/bin/env bash
# Senditto server setup — run as root on the VPS (Ubuntu/Debian).
# Installs Node 22 + Caddy, deploys the Database Studio on itissendittodb.com
# and the Senditto Platform on senditto.dev, with HTTPS handled by Caddy.
#
#   curl -fsSL https://raw.githubusercontent.com/Mekboy88/sendittoDB/main/deploy/server-setup.sh | bash
#
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing base packages"
apt-get update -y
apt-get install -y git curl ca-certificates gnupg ufw

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 22 ]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "==> Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Fetching repositories"
mkdir -p /opt/senditto
cd /opt/senditto
if [ -d sendittoDB/.git ]; then git -C sendittoDB pull --ff-only; else
  git clone https://github.com/Mekboy88/sendittoDB.git
fi
if [ -d Senditto-Platform/.git ]; then git -C Senditto-Platform pull --ff-only; else
  git clone https://github.com/Mekboy88/Senditto-Platform.git
fi

echo "==> Building Database Studio (itissendittodb.com)"
cd /opt/senditto/sendittoDB
npm ci --no-audit --no-fund
npm run build

echo "==> Installing Studio API service"
mkdir -p /etc/senditto
if [ ! -f /etc/senditto/senditto.env ]; then
  # No operator config yet: disable demo data and generate a random owner password.
  GEN_PASS="$(openssl rand -base64 18 | tr -d '/+=')"
  cat > /etc/senditto/senditto.env <<ENV
SEED_DEMO=0
OWNER_EMAIL=owner@senditto.dev
OWNER_PASSWORD=${GEN_PASS}
ENV
  chmod 600 /etc/senditto/senditto.env
  echo "!! Generated owner login: owner@senditto.dev / ${GEN_PASS}"
  echo "!! Edit /etc/senditto/senditto.env to change it, then re-run this script."
fi

# Production mode (SEED_DEMO=0): wipe the seeded demo database so it reseeds
# with only the configured owner account.
if grep -q '^SEED_DEMO=0' /etc/senditto/senditto.env \
  && [ -f /opt/senditto/sendittoDB/server/data/db.json ] \
  && grep -q 'admin@senditto\.dev\|founder@acme\.dev\|cto@northwind\.io' /opt/senditto/sendittoDB/server/data/db.json; then
  echo "==> Removing demo database (will reseed with owner account only)"
  rm -f /opt/senditto/sendittoDB/server/data/db.json
fi

cat > /etc/systemd/system/senditto-db-api.service <<'UNIT'
[Unit]
Description=Senditto Database Studio API
After=network.target

[Service]
WorkingDirectory=/opt/senditto/sendittoDB
ExecStart=/usr/bin/node server/index.mjs
Environment=PORT=5181
EnvironmentFile=-/etc/senditto/senditto.env
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now senditto-db-api
systemctl restart senditto-db-api

echo "==> Building Senditto Platform (senditto.dev) — best effort"
PLATFORM_OK=0
(
  set -e
  cd /opt/senditto/Senditto-Platform
  npm ci --no-audit --no-fund
  ./node_modules/.bin/vinext build
) && PLATFORM_OK=1 || echo "!! Platform build failed — continuing; studio will still go live"

if [ "$PLATFORM_OK" = 1 ]; then
  cat > /etc/systemd/system/senditto-platform.service <<'UNIT'
[Unit]
Description=Senditto Platform
After=network.target

[Service]
WorkingDirectory=/opt/senditto/Senditto-Platform
ExecStart=/opt/senditto/Senditto-Platform/node_modules/.bin/vinext start
Environment=PORT=3000
Environment=WRANGLER_LOG_PATH=/opt/senditto/Senditto-Platform/.wrangler/wrangler.log
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now senditto-platform
  systemctl restart senditto-platform
fi

echo "==> Writing Caddyfile"
cat > /etc/caddy/Caddyfile <<'CADDY'
itissendittodb.com, www.itissendittodb.com {
	handle /api/* {
		reverse_proxy 127.0.0.1:5181 {
			flush_interval -1
		}
	}
	handle {
		root * /opt/senditto/sendittoDB/dist
		# The page names its hashed assets, so it must always be re-checked —
		# a cached page keeps loading last week's code.
		@page path / *.html
		header @page >Cache-Control "no-cache, must-revalidate"
		try_files {path} /index.html
		file_server
	}
}

# One canonical host. Cookies are host-only, so a visitor who lands on www
# would not be sent the session set on the apex and would look signed out.
www.senditto.dev {
	redir https://senditto.dev{uri} permanent
}

senditto.dev {
	# Same rule: never let a browser keep the page that names the app's files.
	@page path / *.html
	header @page >Cache-Control "no-cache, must-revalidate"

	# Open and click tracking. These are the only control-API paths reachable
	# from the product domain, and they are public by design — an inbox has to
	# be able to load them. No operator surface is exposed here.
	handle /t/* {
		reverse_proxy 127.0.0.1:5181
	}

	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
CADDY
systemctl enable caddy
systemctl restart caddy

echo "==> Opening firewall ports 80/443 (ufw, if active)"
if ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
else
  ufw allow OpenSSH || true
  ufw allow 80/tcp
  ufw allow 443/tcp
  yes | ufw enable
fi

echo "==> Status"
systemctl --no-pager --lines=0 status senditto-db-api caddy || true
echo
echo "DONE. Give Caddy ~30s to obtain HTTPS certificates, then open:"
echo "  https://itissendittodb.com   (Database Studio)"
echo "  https://senditto.dev         (Platform, if its build succeeded)"
echo
echo "If the sites still time out, also open ports 80+443 in the Vultr"
echo "cloud firewall panel — a cloud-level firewall sits outside this server."
