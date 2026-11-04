# ==============================================================================
# MP3Spot — Production Dockerfile
# Kan direct gebouwd worden vanaf GitHub in Dockhand / Portainer / Docker Compose
# ==============================================================================
FROM node:22-alpine

# Installeer git voor eventuele git-gebaseerde updates en tijdzone-ondersteuning
RUN apk add --no-cache git tzdata

WORKDIR /app

# Kopieer package.json en installeer dependencies
COPY package*.json .npmrc* ./
RUN npm install --include=dev --legacy-peer-deps

# Kopieer de volledige applicatiebroncode
COPY . .

# Bouw de productie-frontend (behoudt de exacte buildversie uit src/version.json)
RUN SKIP_VERSION_BUMP=true npm run build

# Maak standaard mappen aan voor gemounte volumes:
# /music   -> Lokale muziekcollectie (read/write voor het terugschrijven van Spotify ID3-tags)
# /data    -> Persistente database/status opslag (tracks, afspeellijstregels, sync-historie)
# /exports -> Automatisch geëxporteerde .m3u8, .json en .csv afspeellijsten op de host
RUN mkdir -p /music /data /app/data /exports

ENV NODE_ENV=production
ENV PORT=3000
ENV MUSIC_LIBRARY_PATH=/music
ENV DATA_PATH=/data
ENV EXPORTS_PATH=/exports

VOLUME ["/music", "/data", "/exports"]

EXPOSE 3000

CMD ["npm", "run", "start"]
