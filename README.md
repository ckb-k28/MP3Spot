# MP3Spot

**MP3Spot** is een zelf-gehoste webapplicatie die al je lokale muziekbestanden (`.mp3`, `.flac`, `.m4a`, `.wav`, `.aiff`, `.ogg`, `.m3u8`) scant, ze via een meertraps-matcher opzoekt in **Spotify**, de gevonden **Spotify-metadata als binaire ID3v2.3-tags terugschrijft naar je lokale bestanden**, en elk beschikbaar nummer automatisch in een **Spotify-jaarafspeellijst (op basis van releasejaar)** en slimme afspeellijsten plaatst.

---

## Belangrijkste Functionaliteiten

- **Lokale Bestanden Voorzien van Spotify ID3-Tags (`ID3v2.3` Tagging)**:
  - Schrijft de officiële Spotify-metadata (`TIT2` Titel, `TPE1` Artiest, `TALB` Album, `TYER` Releasejaar, `TCON` Genre, `TSRC` ISRC-code en `WOAF` Spotify Track URI) rechtstreeks terug in je lokale audiobestanden op het gemounte `/music`-volume én biedt een directe binaire `.mp3` ID3-download in de browser.
- **Automatische Spotify Jaar-Afspeellijsten**:
  - Zodra een lokaal nummer beschikbaar/gematcht is op Spotify, plaatst MP3Spot het automatisch in een Spotify-afspeellijst die ten minste het releasejaar vertegenwoordigt (bijv. `MP3Spot Jaar: 2016`, `MP3Spot Jaar: 2017`, `MP3Spot Jaar: 2021`), naast eventuele extra map-, genre- of BPM-lijsten.
- **Meertraps Spotify Metadata Matcher**:
  - **Fase 1**: Exacte `ISRC`-code verificatie.
  - **Fase 2**: Genormaliseerde Titel-, Artiest- en Album-matching.
  - **Fase 3**: Fuzzy matching en speelduurvergelijking (`Δ seconden`), met versie-selectie voor o.a. *Radio Edit* vs. *Extended Mix*.
- **Differentiële Synchronisatie (Geen Duplicaten)**:
  - Berekent vooraf een *diff* per afspeellijst zodat enkel nieuwe `spotify:track:`-URI's worden toegevoegd en bestaande nummers nooit dubbel worden toegevoegd.
- **Automatische Build-Versienummering (`year.month.day[.build#]`)**:
  - Elke build krijgt automatisch een versienummer op basis van `jaar.maand.dag.build#` via `scripts/version-build.ts`.
  - De eerste build van de dag heeft `build# = 0` en wordt weergegeven als `YYYY.MM.DD` (bijv. `2026.11.03`).
  - Elke volgende build op dezelfde dag voegt `.build#` toe (`2026.11.03.1`, `2026.11.03.2`, enz.).

---

## Uitrollen in Dockhand / Portainer (Zero-Copy vanaf GitHub)

Je hoeft **geen enkel bestand handmatig naar je server te kopiëren**. Kies hieronder **Optie A** (Standalone Git-Clone container) of **Optie B** (Native Docker Git Build) en plak de YAML rechtstreeks in een nieuwe **Dockhand Stack**.

### Optie A: Standalone Git-Clone Stack (100% Zero-Copy YAML)
Deze configuratie gebruikt `node:22-alpine`, kloont bij het starten automatisch deze GitHub-repository, bouwt de app en koppelt je volumes:

```yaml
services:
  mp3spot:
    image: node:22-alpine
    container_name: mp3spot
    restart: unless-stopped
    working_dir: /app
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - GIT_REPO_URL=https://github.com/JOUW_GEBRUIKERSNAAM/mp3spot.git
      # --- Volume Paden in de Container ---
      - MUSIC_LIBRARY_PATH=/music
      - DATA_PATH=/app/data
      - EXPORTS_PATH=/exports
      # --- Spotify Developer API (optioneel voor live push) ---
      - SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID:-}
      - SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET:-}
      - APP_URL=http://localhost:3000
    volumes:
      # 1. Jouw muziekmap op de server/NAS (:rw zodat MP3Spot Spotify ID3-tags kan schrijven)
      - /mnt/nas/muziek:/music:rw
      # 2. Persistente opslag voor de gekloonde repo, database en sync-status
      - mp3spot_repo:/app
      - mp3spot_data:/app/data
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
  mp3spot_repo:
  mp3spot_data:
```

### Optie B: Native Docker Git Build Stack
Docker Compose ondersteunt het rechtstreeks bouwen van een `Dockerfile` vanaf een GitHub-URL:

```yaml
services:
  mp3spot:
    build:
      context: https://github.com/JOUW_GEBRUIKERSNAAM/mp3spot.git#main
      dockerfile: Dockerfile
    container_name: mp3spot
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - MUSIC_LIBRARY_PATH=/music
      - DATA_PATH=/app/data
      - EXPORTS_PATH=/exports
      - SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID:-}
      - SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET:-}
      - APP_URL=http://localhost:3000
    volumes:
      - /mnt/nas/muziek:/music:rw
      - mp3spot_data:/app/data
      - ./exports:/exports

volumes:
  mp3spot_data:
```

---

## Overzicht van Volume Mappings

MP3Spot maakt gebruik van drie duidelijke volume-mountpoints in de container:

| Container Pad | Omgevingsvariabele | Modus | Beschrijving | Voorbeeld Host Mapping |
| :--- | :--- | :--- | :--- | :--- |
| `/music` | `MUSIC_LIBRARY_PATH` | `:rw` (Lezen/Schrijven) | Hier mount je de hoofdmap van je lokale muziekcollectie op je NAS of server. Gebruik `:rw` zodat MP3Spot de gevonden Spotify ID3v2.3-tags rechtstreeks in je audiobestanden kan bijschrijven. | `/mnt/nas/muziek:/music:rw` |
| `/app/data` | `DATA_PATH` | `:rw` (Lezen/Schrijven) | Bewaart `mp3spot-state.json` (gescande bibliotheek, handmatige Spotify-koppelingen, jaar- en slimme afspeellijstregels en sync-geschiedenis). | `mp3spot_data:/app/data` of `./data:/app/data` |
| `/exports` | `EXPORTS_PATH` | `:rw` (Lezen/Schrijven) | Map waar je met één klik vanuit de UI `.m3u8` afspeellijsten, `.json` mappings en `.csv` rapporten rechtstreeks naar je server wegschrijft. | `./exports:/exports` |

---


## Build Versienummering (`year.month.day[.build#]`)

Elke keer dat `npm run build` wordt uitgevoerd, werkt `scripts/version-build.ts` het bestand `src/version.json` bij:
- **1e build van de dag (`build# = 0`)**: `2026.11.03`
- **2e build van de dag (`build# = 1`)**: `2026.11.03.1`
- **3e build van de dag (`build# = 2`)**: `2026.11.03.2`

---

## Spotify Developer OAuth Instellen

Om afspeellijsten live in je Spotify-account aan te maken en bij te werken:

1. Ga naar het [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) en maak een nieuwe applicatie aan.
2. Voeg bij **Redirect URIs** het adres van je MP3Spot-instantie toe gevolgd door `/auth/callback`, bijvoorbeeld:
   - Lokaal / Thuisserver: `http://localhost:3000/auth/callback`
3. Vul `SPOTIFY_CLIENT_ID` en `SPOTIFY_CLIENT_SECRET` in bij je `docker-compose.yml` omgevingsvariabelen.
4. Klik rechtsboven in MP3Spot op **Verbind Spotify**.
