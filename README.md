# SpotiSync Studio

**SpotiSync Studio** is een zelf-gehoste webapplicatie die je lokale muziekbibliotheek (`.flac`, `.mp3`, `.m4a`, `.wav`, `.aiff`, `.ogg`, `.m3u8`) scant op basis van binaire audiometadata (`ID3v2.3/2.4`, `FLAC Vorbis`, `ID3v1`, `ISRC`, `BPM`, `Toonsoort`), deze nummers via een meertraps-matcher opzoekt in de **Spotify-catalogus**, en vervolgens **automatisch slimme afspeellijsten** aanmaakt en differentieel synchroniseert met je Spotify-account.

---

## Belangrijkste Functionaliteiten

- **Lokale Map- & Docker Volume Scanner**:
  - Scan mappen rechtstreeks via een gemount Docker-volume (`/music`) op je NAS of thuisserver, óf sleep mappen vanuit je browser in de webinterface.
  - Leest binaire `ID3v2.4`-, `ID3v2.3`- en `FLAC Vorbis`-headers uit (slechts de eerste 64–128 KB per bestand) voor razendsnelle indexering.
- **Meertraps Spotify Metadata Matcher**:
  - **Fase 1**: Exacte `ISRC`-code verificatie.
  - **Fase 2**: Genormaliseerde Titel-, Artiest- en Album-matching (stript automatisch tags zoals `(Original Mix)` of `[Club Cut]`).
  - **Fase 3**: Fuzzy matching en speelduurvergelijking (`Δ seconden`), met de mogelijkheid om voor twijfelgevallen (zoals *Radio Edit* vs. *Extended Mix*) met één klik de juiste Spotify-versie te kiezen.
- **Automatische Slimme Afspeellijsten**:
  - Genereer automatisch Spotify-afspeellijsten per lokale map, per genre, op basis van BPM-bereik (bijv. `120–132 BPM`) of uitsluitend voor Lossless-bestanden (`FLAC`/`WAV`).
- **Differentiële Synchronisatie (Geen Duplicaten)**:
  - Berekent vooraf een *diff* per afspeellijst zodat enkel nieuwe `spotify:track:`-URI's worden toegevoegd en bestaande nummers nooit dubbel worden toegevoegd.
- **Ingebouwde Login & SHA-256 Wachtwoordbeveiliging**:
  - Beveiligd met een inlogpagina die gebruikersnaam en wachtwoord (of een veilige `SHA-256` hash) uitleest uit je `docker-compose.yml`.

---

## Uitrollen in Dockhand / Portainer (Zero-Copy vanaf GitHub)

Je hoeft **geen enkel bestand handmatig naar je server te kopiëren**. Kies hieronder **Optie A** (Standalone Git-Clone container) of **Optie B** (Native Docker Git Build) en plak de YAML rechtstreeks in een nieuwe **Dockhand Stack**.

### Optie A: Standalone Git-Clone Stack (100% Zero-Copy YAML)
Deze configuratie gebruikt `node:22-alpine`, kloont bij het starten automatisch deze GitHub-repository, bouwt de app en koppelt je volumes:

```yaml
services:
  spotisync:
    image: node:22-alpine
    container_name: spotisync-studio
    restart: unless-stopped
    working_dir: /app
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - GIT_REPO_URL=https://github.com/JOUW_GEBRUIKERSNAAM/spotisync-studio.git
      # --- Inloggegevens Webinterface ---
      - APP_USERNAME=admin
      # Kies APP_PASSWORD (platte tekst) OF APP_PASSWORD_HASH (SHA-256 hex):
      - APP_PASSWORD=verander_dit_wachtwoord
      - APP_PASSWORD_HASH=
      - SESSION_SECRET=vervang_door_een_willekeurige_geheime_sleutel
      # --- Volume Paden in de Container ---
      - MUSIC_LIBRARY_PATH=/music
      - DATA_PATH=/app/data
      - EXPORTS_PATH=/exports
      # --- Spotify Developer API (optioneel voor live push) ---
      - SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID:-}
      - SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET:-}
      - APP_URL=http://localhost:3000
    volumes:
      # 1. Jouw muziekmap op de server/NAS (read-only)
      - /mnt/nas/muziek:/music:ro
      # 2. Persistente opslag voor de gekloonde repo, database en sync-status
      - spotisync_repo:/app
      - spotisync_data:/app/data
      # 3. Map op de host waar geëxporteerde .m3u8/.json/.csv lijsten komen
      - ./exports:/exports
    command: >
      sh -c "apk add --no-cache git &&
      if [ ! -d /app/.git ]; then
        git clone $$GIT_REPO_URL /app;
      else
        git pull;
      fi &&
      npm install &&
      npm run build &&
      npm run start"

volumes:
  spotisync_repo:
  spotisync_data:
```

### Optie B: Native Docker Git Build Stack
Docker Compose ondersteunt het rechtstreeks bouwen van een `Dockerfile` vanaf een GitHub-URL:

```yaml
services:
  spotisync:
    build:
      context: https://github.com/JOUW_GEBRUIKERSNAAM/spotisync-studio.git#main
      dockerfile: Dockerfile
    container_name: spotisync-studio
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - APP_USERNAME=admin
      - APP_PASSWORD_HASH= # Of gebruik APP_PASSWORD=...
      - SESSION_SECRET=vervang_door_een_willekeurige_geheime_sleutel
      - MUSIC_LIBRARY_PATH=/music
      - DATA_PATH=/app/data
      - EXPORTS_PATH=/exports
      - SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID:-}
      - SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET:-}
      - APP_URL=http://localhost:3000
    volumes:
      - /mnt/nas/muziek:/music:ro
      - spotisync_data:/app/data
      - ./exports:/exports

volumes:
  spotisync_data:
```

---

## Overzicht van Volume Mappings

SpotiSync Studio maakt gebruik van drie duidelijke volume-mountpoints in de container:

| Container Pad | Omgevingsvariabele | Modus | Beschrijving | Voorbeeld Host Mapping |
| :--- | :--- | :--- | :--- | :--- |
| `/music` | `MUSIC_LIBRARY_PATH` | `:ro` (Alleen-lezen) | Hier mount je de hoofdmap van je lokale muziekcollectie op je NAS of server. SpotiSync wijzigt je audiobestanden nooit. | `/mnt/nas/muziek:/music:ro` |
| `/app/data` | `DATA_PATH` | `:rw` (Lezen/Schrijven) | Bewaart `spotisync-state.json` (gescande bibliotheek, handmatige Spotify-koppelingen, slimme afspeellijstregels en sync-geschiedenis). | `spotisync_data:/app/data` of `./data:/app/data` |
| `/exports` | `EXPORTS_PATH` | `:rw` (Lezen/Schrijven) | Map waar je met één klik vanuit de UI `.m3u8` afspeellijsten, `.json` mappings en `.csv` rapporten rechtstreeks naar je server wegschrijft (bijv. voor Plex, Jellyfin of Navidrome). | `./exports:/exports` |

---

## Authenticatie & Veilige Wachtwoordopties

Je kunt het inlogscherm op drie manieren configureren via `docker-compose.yml`:

1. **SHA-256 Wachtwoord Hash (`APP_PASSWORD_HASH` — Aanbevolen)**:
   Zodat je wachtwoord nooit in platte tekst in je Dockhand YAML staat.
   Je kunt de hash direct in de SpotiSync webinterface genereren via de knop **"Dockhand Stack YAML"**, of via je terminal:
   ```bash
   echo -n "jouw_geheime_wachtwoord" | sha256sum
   ```
   Plak de 64-karakter hex-string in `APP_PASSWORD_HASH`.
2. **Direct Wachtwoord (`APP_PASSWORD`)**:
   Stel `APP_USERNAME=admin` en `APP_PASSWORD=jouw_wachtwoord` in bij `environment:` in `docker-compose.yml`.
3. **Docker Secrets Bestand (`APP_PASSWORD_FILE`)**:
   Verwijs naar een gemount secret-bestand, bijvoorbeeld `APP_PASSWORD_FILE=/run/secrets/spotisync_password`.

*(Wanneer geen van bovenstaande variabelen is ingesteld bij een eerste teststart, gebruikt de applicatie tijdelijk `admin` / `spotisync` en toont hiervan een melding op het inlogscherm).*

---

## Spotify Developer OAuth Instellen

Om afspeellijsten live in je Spotify-account aan te maken en bij te werken:

1. Ga naar het [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) en maak een nieuwe applicatie aan.
2. Voeg bij **Redirect URIs** het adres van je SpotiSync-instantie toe gevolgd door `/auth/callback`, bijvoorbeeld:
   - Lokaal / Thuisserver: `http://localhost:3000/auth/callback` (of je eigen domeinnaam)
3. Vul `SPOTIFY_CLIENT_ID` en `SPOTIFY_CLIENT_SECRET` in bij je `docker-compose.yml` omgevingsvariabelen.
4. Klik rechtsboven in SpotiSync Studio op **Verbind Spotify**.

---

## Lokaal Ontwikkelen (Zonder Docker)

```bash
# 1. Installeer dependencies
npm install

# 2. Kopieer voorbeeld omgevingsvariabelen
cp .env.example .env

# 3. Start de full-stack ontwikkelserver (Express + Vite op poort 3000)
npm run dev

# 4. Bouw voor productie
npm run build
npm run start
```
