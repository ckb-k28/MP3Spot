#!/bin/sh
set -e

# Zorg ervoor dat de standaard volume-mappen altijd aanwezig zijn
mkdir -p /music /data /app/data /exports 2>/dev/null || true

# Als /app/package.json ontbreekt (bijv. omdat er in Dockhand/Synology een volume op /app is gemount),
# schakel dan altijd over naar de veilige, ingebakken applicatiemap /opt/mp3spot.
if [ ! -f "$(pwd)/package.json" ] && [ -f "/opt/mp3spot/package.json" ]; then
  echo "[MP3Spot] Werkmap $(pwd) bevat geen package.json (mogelijk overschreven door een volume-mount op /app)."
  echo "[MP3Spot] Overschakelen naar ingebakken applicatiemap /opt/mp3spot..."
  cd /opt/mp3spot
fi

exec "$@"
