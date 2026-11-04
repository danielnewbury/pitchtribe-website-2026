#!/usr/bin/env bash
# PitchTribe one-line installer. Safe to pipe into a shell:
#
#   curl -sSL https://pitchtribe.media/install.sh | sudo bash
#
# Run this on a Raspberry Pi that is already booted into Raspberry Pi OS
# (Bookworm, Lite or Desktop). It does not write an SD card — flash the card
# with Raspberry Pi Imager first, boot the Pi, then run this.
#
# All it does is fetch a checkout and hand over to deploy/install.sh, which does
# the real work. That script copies app/ and signage-server/ into /opt/pitchtribe,
# so it needs the repository on disk and cannot be piped into a shell itself.
# This wrapper is what makes the one-liner above work.
#
# Every PITCHTRIBE_* option documented in deploy/install.sh works here too — the
# install script inherits this shell's environment:
#
#   curl -sSL https://pitchtribe.media/install.sh | sudo PITCHTRIBE_PORTAL=1 bash
#
# Options for this wrapper only:
#   PITCHTRIBE_REPO=<url>   clone from somewhere else (default: GitHub)
#   PITCHTRIBE_REF=<ref>    clone a different branch or tag (default: main)
set -euo pipefail

REPO="${PITCHTRIBE_REPO:-https://github.com/pitchtribe/pitchtribe-display.git}"
REF="${PITCHTRIBE_REF:-main}"

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "this installer needs root. Pipe it into sudo bash:
  curl -sSL https://pitchtribe.media/install.sh | sudo bash"
command -v apt-get >/dev/null || die "this installer supports Debian / Raspberry Pi OS only"

export DEBIAN_FRONTEND=noninteractive

if ! command -v git >/dev/null; then
  log "Installing git"
  apt-get update -q
  apt-get install -y -q git ca-certificates
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log "Fetching PitchTribe ($REF)"
git clone --depth 1 --branch "$REF" --quiet "$REPO" "$WORK/pitchtribe" \
  || die "could not clone $REPO at $REF — check the Pi's internet connection"

# Hand over. Not exec'd, so the trap above still cleans up the checkout, which
# install.sh has finished with by then (it copies what it needs into place).
bash "$WORK/pitchtribe/deploy/install.sh"
