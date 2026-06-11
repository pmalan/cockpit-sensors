#!/usr/bin/env bash
# Install the cockpit-sensors plugin on Fedora 44
set -euo pipefail

echo "Installing cockpit-sensors..."

sudo mkdir -p /usr/share/cockpit/sensors
sudo cp manifest.json index.html index.js index.css /usr/share/cockpit/sensors/
sudo cp org.cockpit_project.sensors_read.policy /usr/share/polkit-1/actions/
sudo systemctl restart cockpit.socket

echo "Done. Open https://$(hostname):9090 and click 'Hardware Sensors'."
