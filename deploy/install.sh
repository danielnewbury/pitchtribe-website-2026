#!/usr/bin/env bash
# PitchTribe installer for Raspberry Pi OS (Trixie or Bookworm, Lite or Desktop)
# on a Pi 4/5.
#
#   git clone <this repo> pitchtribe && sudo pitchtribe/deploy/install.sh
#
# Or let deploy/bootstrap.sh fetch the checkout for you, which is the same thing
# in one line and is what the website publishes:
#
#   curl -sSL https://pitchtribe.media/install.sh | sudo bash
#
# Installs:
#   - Node.js 22 (NodeSource) if a recent Node isn't present
#   - PitchTribe in /opt/pitchtribe (app/ + the signage-server sports engine it embeds),
#     data in /var/lib/pitchtribe
#   - pitchtribe.service        — dashboard + API on port 80
#   - pitchtribe-kiosk.service  — full-screen Chromium (in the cage Wayland
#                                 kiosk) on the HDMI output, showing this Pi's screen
#   - avahi so the dashboard is reachable at http://<hostname>.local
#
# Options (environment variables):
#   PITCHTRIBE_NO_KIOSK=1         server only (e.g. a headless "hub" Pi)
#   PITCHTRIBE_SERVER=http://hub.local   kiosk only: show a screen from another PitchTribe server
#   PITCHTRIBE_PORT=80            dashboard port
#   PITCHTRIBE_PORTAL=1           also set up the guest Wi-Fi captive portal on wlan0
#                                 (the Pi must be connected to the club router by cable)
#   PITCHTRIBE_IMAGE_BUILD=1      used by image/build.sh: install into a mounted SD card
#                                 image from a chroot. Services are enabled for the
#                                 first boot but not started now.
set -euo pipefail

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# This script copies app/ and signage-server/ into /opt/pitchtribe, so it needs
# the repository on disk and cannot be read from a pipe: when bash reads a script
# from stdin BASH_SOURCE is unset, and SRC_DIR below would silently resolve to /.
# deploy/bootstrap.sh is the pipeable entry point — it clones a checkout first.
[[ -n "${BASH_SOURCE[0]:-}" ]] || die "this script cannot be piped into a shell — it needs a PitchTribe checkout on disk.
Use the one-line installer, which fetches one for you:
  curl -sSL https://pitchtribe.media/install.sh | sudo bash"

APP_DIR=/opt/pitchtribe
DATA_DIR=/var/lib/pitchtribe
SVC_USER=pitchtribe
KIOSK_USER=pitchtribe-kiosk
PORT="${PITCHTRIBE_PORT:-80}"
SERVER="${PITCHTRIBE_SERVER:-}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ -f "$SRC_DIR/app/server.js" && -f "$SRC_DIR/signage-server/package.json" ]] || die "run this script from a PitchTribe checkout (app/ and signage-server/ not found)"
command -v apt-get >/dev/null || die "this installer supports Debian / Raspberry Pi OS only"

export DEBIAN_FRONTEND=noninteractive

IMAGE_BUILD="${PITCHTRIBE_IMAGE_BUILD:-0}"
# Start or restart a unit now — except when building an image, where nothing runs
# until the card boots (the units are enabled, so they start then).
start_now() { [[ "$IMAGE_BUILD" == 1 ]] || systemctl "$@"; }

if [[ -z "$SERVER" ]]; then
  # ---------------------------------------------------------------- server
  need_node=1
  if command -v node >/dev/null; then
    major="$(node -p 'process.versions.node.split(".")[0]')"
    [[ "$major" -ge 20 ]] && need_node=0
  fi
  if [[ $need_node -eq 1 ]]; then
    log "Installing Node.js 22"
    apt-get update -q
    apt-get install -y -q ca-certificates curl gnupg
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
    apt-get update -q
    apt-get install -y -q nodejs
  fi

  log "Installing avahi (http://$(hostname).local)"
  apt-get install -y -q avahi-daemon

  log "Installing PitchTribe to $APP_DIR"
  id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
  install -d -o "$SVC_USER" -g "$SVC_USER" -m 0750 "$DATA_DIR"
  rm -rf "$APP_DIR.new"
  mkdir -p "$APP_DIR.new/app" "$APP_DIR.new/signage-server"
  cp -a "$SRC_DIR/app/." "$APP_DIR.new/app/"
  cp -a "$SRC_DIR/signage-server/." "$APP_DIR.new/signage-server/"
  rm -rf "$APP_DIR.new/app/data" "$APP_DIR.new/app/node_modules" "$APP_DIR.new/signage-server/config.json"
  # app depends on ../signage-server (file: dependency, linked by npm)
  (cd "$APP_DIR.new/app" && npm ci --omit=dev --no-audit --no-fund)
  rm -rf "$APP_DIR.old"
  [[ -d "$APP_DIR" ]] && mv "$APP_DIR" "$APP_DIR.old"
  mv "$APP_DIR.new" "$APP_DIR"
  rm -rf "$APP_DIR.old"

  install -m 0755 "$SRC_DIR/deploy/reset-password.sh" /usr/local/bin/pitchtribe-reset-password
  sed -e "s|@PORT@|$PORT|g" "$SRC_DIR/deploy/pitchtribe.service" >/etc/systemd/system/pitchtribe.service
  start_now daemon-reload
  systemctl enable pitchtribe.service
  start_now restart pitchtribe.service
  SERVER="http://localhost$([[ "$PORT" == 80 ]] || echo ":$PORT")"
fi

if [[ "${PITCHTRIBE_PORTAL:-0}" == 1 ]]; then
  # ------------------------------------------------------------ guest Wi-Fi
  log "Installing the guest Wi-Fi captive portal (hostapd, dnsmasq, nftables)"
  if [[ "$IMAGE_BUILD" != 1 ]] && ! ip -o link show eth0 >/dev/null 2>&1; then
    die "the guest Wi-Fi needs the Pi's network cable (eth0) for its internet connection"
  fi
  apt-get install -y -q hostapd dnsmasq nftables
  # NetworkManager must leave wlan0 alone: it becomes the guest access point.
  if [[ -d /etc/NetworkManager/conf.d ]]; then
    cat >/etc/NetworkManager/conf.d/99-pitchtribe-portal.conf <<'NMCONF'
[keyfile]
unmanaged-devices=interface-name:wlan0
NMCONF
    start_now reload NetworkManager 2>/dev/null || true
  fi
  rfkill unblock wlan 2>/dev/null || true
  # The default dnsmasq config must not grab every interface.
  grep -q '^conf-dir=/etc/dnsmasq.d' /etc/dnsmasq.conf 2>/dev/null || echo 'conf-dir=/etc/dnsmasq.d/,*.conf' >>/etc/dnsmasq.conf
  install -m 0755 "$SRC_DIR/deploy/portal/portal-apply.sh" /usr/local/bin/pitchtribe-portal-apply
  install -m 0644 "$SRC_DIR/deploy/portal/pitchtribe-portal.service" /etc/systemd/system/
  install -m 0644 "$SRC_DIR/deploy/portal/pitchtribe-portal-apply.service" /etc/systemd/system/
  install -m 0644 "$SRC_DIR/deploy/portal/pitchtribe-portal-apply.path" /etc/systemd/system/
  start_now daemon-reload
  systemctl enable pitchtribe-portal.service pitchtribe-portal-apply.service pitchtribe-portal-apply.path
  start_now start pitchtribe-portal-apply.path
  start_now start pitchtribe-portal-apply.service || true
  log "Guest Wi-Fi installed — switch it on and design the sign-in page under Guest Wi-Fi in the dashboard"
fi

if [[ "${PITCHTRIBE_NO_KIOSK:-0}" != 1 ]]; then
  # ----------------------------------------------------------------- kiosk
  log "Installing the kiosk display (cage + Chromium)"
  apt-get install -y -q cage fonts-noto-color-emoji
  if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
    apt-get install -y -q chromium || apt-get install -y -q chromium-browser
  fi
  CHROMIUM="$(command -v chromium || command -v chromium-browser)"

  id -u "$KIOSK_USER" >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin "$KIOSK_USER"
  usermod -a -G video,render,input,audio "$KIOSK_USER"

  install -m 0755 "$SRC_DIR/deploy/kiosk.sh" /usr/local/bin/pitchtribe-kiosk
  cat >/etc/default/pitchtribe-kiosk <<EOF
# Read by pitchtribe-kiosk.service. @HOSTNAME@ becomes this Pi's hostname when the
# kiosk starts, so each Pi shows its own screen (and an SD card image works on any Pi).
PITCHTRIBE_URL=${SERVER%/}/player/?screen=@HOSTNAME@
CHROMIUM=${CHROMIUM}
EOF
  install -m 0644 "$SRC_DIR/deploy/pitchtribe-kiosk.service" /etc/systemd/system/pitchtribe-kiosk.service
  start_now daemon-reload
  # The kiosk takes over the first console; boot to the console, not a desktop.
  systemctl set-default multi-user.target
  systemctl disable getty@tty1.service 2>/dev/null || true
  systemctl enable pitchtribe-kiosk.service
  start_now restart pitchtribe-kiosk.service || true
fi

if [[ "$IMAGE_BUILD" == 1 ]]; then
  log "Done — PitchTribe is installed in the image and starts on first boot"
  exit 0
fi

HOST="$(hostname).local"
log "Done!"
if systemctl is-enabled pitchtribe.service >/dev/null 2>&1; then
  echo
  echo "  Dashboard:  http://${HOST}$([[ "$PORT" == 80 ]] || echo ":$PORT")/"
  for ip in $(hostname -I); do echo "              http://${ip}$([[ "$PORT" == 80 ]] || echo ":$PORT")/"; done
  echo
  echo "  Open it on your phone (same network) to create the admin password."
fi
