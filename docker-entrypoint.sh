#!/bin/sh
set -e

# Zorg ervoor dat de standaard volume-mappen altijd aanwezig zijn
mkdir -p /music /data /app/data /exports 2>/dev/null || true

# Start altijd vanuit /opt/mp3spot als deze ingebakken image-map bestaat,
# zodat een eventuele (oude of lege) volume-mount op /app nooit een oude versie of ENOENT veroorzaakt.
if [ -f "/opt/mp3spot/package.json" ]; then
  cd /opt/mp3spot
fi

exec "$@"
