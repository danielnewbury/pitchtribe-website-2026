#!/usr/bin/env bash
# Applies the guest Wi-Fi settings saved in the dashboard. Run as root by
# pitchtribe-portal-apply.service whenever /var/lib/pitchtribe/portal-network.json
# changes (pitchtribe-portal-apply.path), and once at boot.
#
#   wlan0 (guests, 10.42.0.1/24) ──nftables──▶ eth0 (club router / internet)
#
# - hostapd: open access point with client isolation
# - dnsmasq: DHCP + DNS for guests, advertises the portal (RFC 8910)
# - nftables: unapproved guests' web traffic -> portal; everything else dropped;
#   approved guests (set "allowed", filled by the portal with a timeout) get the
#   internet only — never the club LAN — with per-device speed limits.
set -euo pipefail

CONF=/var/lib/pitchtribe/portal-network.json
GUEST_IF="${PORTAL_IF:-wlan0}"
UPLINK_IF="${PORTAL_UPLINK:-eth0}"
ADDR=10.42.0.1
PORTAL_PORT=8082

[[ -f "$CONF" ]] || { echo "no $CONF yet — nothing to do"; exit 0; }

# Read and validate the JSON with node (installed with PitchTribe).
eval "$(node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const ssid = String(c.ssid || "Club-Guest");
  if (!/^[\x20-\x7e]{1,32}$/.test(ssid)) throw new Error("bad ssid");
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const sh = (s) => "\x27" + s.replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
  console.log([
    "ENABLED=" + (c.enabled ? 1 : 0),
    "SSID=" + sh(ssid),
    "CHANNEL=" + ([1, 6, 11].includes(Number(c.channel)) ? Number(c.channel) : 6),
    "DOWN_KBYTES=" + int(c.downMbps, 1, 200, 10) * 125,
    "UP_KBYTES=" + int(c.upMbps, 1, 100, 3) * 125,
  ].join("\n"));
' "$CONF")"

if [[ "$ENABLED" != 1 ]]; then
  echo "guest Wi-Fi off"
  systemctl stop pitchtribe-portal.service hostapd.service || true
  systemctl stop dnsmasq.service || true
  nft delete table inet pitchtribe_portal 2>/dev/null || true
  ip addr flush dev "$GUEST_IF" 2>/dev/null || true
  exit 0
fi

# --- access point ------------------------------------------------------------
install -d -m 0755 /etc/pitchtribe
cat >/etc/hostapd/hostapd.conf <<EOF
# Written by pitchtribe-portal-apply — edit in the PitchTribe dashboard (Guest Wi-Fi).
interface=${GUEST_IF}
driver=nl80211
ssid=${SSID}
utf8_ssid=1
country_code=${PORTAL_COUNTRY:-GB}
hw_mode=g
channel=${CHANNEL}
ieee80211n=1
wmm_enabled=1
auth_algs=1
ignore_broadcast_ssid=0
# Open network; stop guests talking to each other's devices.
ap_isolate=1
max_num_sta=60
EOF

# --- guest addressing ----------------------------------------------------------
ip link set "$GUEST_IF" up
ip addr flush dev "$GUEST_IF"
ip addr add "$ADDR/24" dev "$GUEST_IF"
sysctl -q -w net.ipv4.ip_forward=1

cat >/etc/dnsmasq.d/pitchtribe-portal.conf <<EOF
# Written by pitchtribe-portal-apply.
interface=${GUEST_IF}
bind-interfaces
except-interface=lo
dhcp-range=10.42.0.20,10.42.0.250,255.255.255.0,2h
dhcp-option=option:router,${ADDR}
dhcp-option=option:dns-server,${ADDR}
# RFC 8910: tell modern devices where the captive portal is.
dhcp-option=114,"http://${ADDR}/"
domain-needed
bogus-priv
EOF

# --- firewall ------------------------------------------------------------------
cat >/etc/pitchtribe/portal.nft <<EOF
# Written by pitchtribe-portal-apply.
table inet pitchtribe_portal
delete table inet pitchtribe_portal
table inet pitchtribe_portal {
  # Guests who accepted the terms; the portal adds them with a timeout.
  set allowed { type ipv4_addr; flags timeout; }
  set down_rate { type ipv4_addr; flags dynamic, timeout; timeout 1m; }
  set up_rate { type ipv4_addr; flags dynamic, timeout; timeout 1m; }

  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    # The portal address always shows the portal...
    iifname "${GUEST_IF}" ip daddr ${ADDR} tcp dport 80 dnat ip to ${ADDR}:${PORTAL_PORT}
    # ...and unapproved guests' web requests go there too (this pops up the sign-in sheet).
    iifname "${GUEST_IF}" ip saddr != @allowed tcp dport 80 dnat ip to ${ADDR}:${PORTAL_PORT}
  }

  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    iifname "${GUEST_IF}" oifname "${UPLINK_IF}" masquerade
  }

  chain input {
    type filter hook input priority filter; policy accept;
    # Guests may only use DHCP, DNS and the portal on this Pi — not the dashboard.
    iifname "${GUEST_IF}" udp dport { 53, 67 } accept
    iifname "${GUEST_IF}" tcp dport { 53, ${PORTAL_PORT} } accept
    iifname "${GUEST_IF}" icmp type echo-request accept
    iifname "${GUEST_IF}" ct state established,related accept
    iifname "${GUEST_IF}" drop
  }

  chain forward {
    type filter hook forward priority filter; policy accept;
    iifname "${GUEST_IF}" ip saddr != @allowed drop
    # Internet only: never the club's own network.
    iifname "${GUEST_IF}" ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 } drop
    # Per-device speed limits.
    iifname "${GUEST_IF}" update @up_rate { ip saddr limit rate over ${UP_KBYTES} kbytes/second } drop
    oifname "${GUEST_IF}" update @down_rate { ip daddr limit rate over ${DOWN_KBYTES} kbytes/second } drop
  }
}
EOF

# Keep current guests online across re-applies.
saved="$(nft -j list set inet pitchtribe_portal allowed 2>/dev/null || true)"
nft -f /etc/pitchtribe/portal.nft
if [[ -n "$saved" ]]; then
  node -e '
    const j = JSON.parse(process.argv[1]);
    const set = (j.nftables || []).find((x) => x.set)?.set;
    for (const e of set?.elem || []) {
      const ip = e.elem?.val ?? e;
      const left = e.elem?.expires;
      if (typeof ip === "string" && left > 0) console.log(`${ip} timeout ${left}s`);
    }
  ' "$saved" | while read -r ip _ t; do nft add element inet pitchtribe_portal allowed "{ $ip timeout $t }" || true; done
fi

systemctl unmask hostapd.service >/dev/null 2>&1 || true
systemctl restart hostapd.service
systemctl restart dnsmasq.service
systemctl restart pitchtribe-portal.service
echo "guest Wi-Fi “${SSID}” on channel ${CHANNEL} (down ${DOWN_KBYTES} kB/s, up ${UP_KBYTES} kB/s per device)"
