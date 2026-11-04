# ==============================================================================
# MP3Spot — Production Dockerfile
# Wordt automatisch gebouwd door GitHub Actions naar ghcr.io/ckb-k28/mp3spot:latest
# ==============================================================================
FROM node:22-alpine

# Installeer git en tijdzone-ondersteuning
RUN apk add --no-cache git tzdata

# Installeer de applicatie in /opt/mp3spot zodat een eventuele volume-mount op /app
# in Dockhand of Synology NAS nooit package.json of de gebouwde app overschrijft!
WORKDIR /opt/mp3spot

# Kopieer package.json en installeer dependencies
COPY package*.json .npmrc* ./
RUN npm install --include=dev --legacy-peer-deps

# Kopieer de volledige applicatiebroncode
COPY . .

# Ontvang optionele build-args vanuit GitHub Actions zodat elke nieuwe build een vers buildnummer krijgt
ARG APP_DATE=""
ARG APP_BUILD_NUMBER=""
ARG BUILD_COMMIT_SHA=""

# Bouw de productie-frontend en schrijf de actuele buildversie naar src/version.json én dist/
RUN SKIP_VERSION_BUMP=true APP_DATE="${APP_DATE}" APP_BUILD_NUMBER="${APP_BUILD_NUMBER}" npm run build

# Maak standaard mappen aan voor gemounte volumes én kopieer een spiegel naar /app
# zodat zowel /opt/mp3spot als /app werkt.
RUN mkdir -p /music /data /app /app/data /exports \
  && cp -a /opt/mp3spot/. /app/ \
  && cp /opt/mp3spot/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV MUSIC_LIBRARY_PATH=/music
ENV DATA_PATH=/data
ENV EXPORTS_PATH=/exports

VOLUME ["/music", "/data", "/exports"]

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
