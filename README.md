<div align="center">

<img src="./public/mp3spot-icon.svg" width="128" height="128" alt="MP3Spot Logo - Kolenkachel Editie" />

# MP3Spot

**Lokale Muziekbibliotheek Synchronisatie • Binaire Spotify ID3v2.3 Tagging • Automatische Jaar-Afspeellijsten**

[![Thema: Kolenkachel](https://img.shields.io/badge/Thema-Kolenkachel-FF8F00?style=for-the-badge&logoColor=white)](https://github.com)
[![Spotify: Geïntegreerd](https://img.shields.io/badge/Spotify-1DB954?style=for-the-badge&logo=spotify&logoColor=white)](https://spotify.com)
[![ID3 Tagging: v2.3 Binair](https://img.shields.io/badge/ID3_Tagging-v2.3_Binair-D84315?style=for-the-badge)](https://github.com)
[![Docker: Dockhand Zero--Copy](https://img.shields.io/badge/Docker-Dockhand_Zero--Copy-00B4D8?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![Toegang: Direct LAN / Geen Login](https://img.shields.io/badge/Toegang-Direct_LAN-3A3D40?style=for-the-badge&logoColor=E6E7E9)](https://github.com)
[![Build Versie: YYYY.MM.DD.build](https://img.shields.io/badge/Build_Versie-YYYY.MM.DD[.build%23]-E6E7E9?style=for-the-badge&labelColor=3A3D40&color=FF8F00)](https://github.com)

</div>

---

## 🎨 Kolenkachel Kleurenschema

MP3Spot is vormgegeven volgens het **Kolenkachel Design Systeem**: een industriële en warme visuele identiteit geïnspireerd op een gietijzeren kolenkachel met een gloeiend hart en een hete vlamkern.

| Kleur | Naam | Hex Code | Gebruik in de Applicatie & Icoon |
| :--- | :--- | :--- | :--- |
| <img src="https://via.placeholder.com/20/3A3D40/3A3D40.png" width="20" height="20" alt="#3A3D40" /> | **Nacht** (Lichter Antraciet) | `#3A3D40` | Gietijzeren oppervlakken, achtergronden, vinyl disc randen & panels |
| <img src="https://via.placeholder.com/20/E6E7E9/E6E7E9.png" width="20" height="20" alt="#E6E7E9" /> | **Dag** (Zacht Asgrijs) | `#E6E7E9` | Primaire teksten, duidelijke typografie en contrasterende metadata |
| <img src="https://via.placeholder.com/20/D84315/D84315.png" width="20" height="20" alt="#D84315" /> | **Gloeiende Kolen** (Warm Roodoranje) | `#D84315` | ID3-tagging badges, actieknoppen, waarschuwingen en vurige geluidsgolven |
| <img src="https://via.placeholder.com/20/FF8F00/FF8F00.png" width="20" height="20" alt="#FF8F00" /> | **Knisperend Vuur** (Amber Oranje) | `#FF8F00` | Primaire accenten, actieve filters, gloed-effecten en jaarafspeellijst badges |
| <img src="https://via.placeholder.com/20/00B4D8/00B4D8.png" width="20" height="20" alt="#00B4D8" /> | **Hete Vlamkern** (Helder Blauw) | `#00B4D8` | Spil van het vinyl-icoon, Spotify match-percentages en actieve audio-indicatoren |
| <img src="https://via.placeholder.com/20/1DB954/1DB954.png" width="20" height="20" alt="#1DB954" /> | **Spotify Groen** | `#1DB954` | Officiële Spotify status, directe deep-links en synchronisatieknoppen |

Het officiële icoon bevindt zich in `public/mp3spot-icon.svg` en combineert een vinylplaat (Nacht), geluidsgolven in de vorm van opstijgende vlammen (Gloeiende Kolen & Knisperend Vuur) en een hete blauwe kernspil (Hete Vlamkern).

---

## 🔥 Belangrijkste Functionaliteiten

### 1. Directe Toegang (Zonder Login Drempel)
- MP3Spot opent direct zonder login- of authenticatiewand.
- Ideaal voor lokaal gebruik op je thuisnetwerk (LAN), achter een eigen reverse proxy (bijv. Nginx, Traefik, NPM, Cloudflare Tunnels of Tailscale) of als persoonlijke NAS-container.

### 2. Lokale Bestanden Taggen met Spotify Metadata (`ID3v2.3`)
- **Direct wegschrijven naar schijf**: Schrijft officiële Spotify-tags rechtstreeks terug in je muziekbestanden op het `/music:rw` volume.
- **Binaire ID3-Frames**:
  - `TIT2` (Geverifieerde tracktitel)
  - `TPE1` (Artiest / uitvoerende)
  - `TALB` (Officieel album)
  - `TYER` (Exact releasejaar)
  - `TCON` (Spotify artiest-genre)
  - `TSRC` (Officiële ISRC-registratiecode)
  - `WOAF` (Directe Spotify Web URL)
- **Directe Download**: Mogelijkheid om via de browser met één klik een volledig getagde `.mp3` te downloaden.

### 3. Automatische Spotify Jaar-Afspeellijsten
- Zodra een lokaal nummer beschikbaar is op Spotify, plaatst MP3Spot het automatisch in een Spotify-afspeellijst die **ten minste het releasejaar** vertegenwoordigt (bijv. `MP3Spot Jaar: 2016`, `MP3Spot Jaar: 2021`, `MP3Spot Jaar: 2024`).
- Automatische groepering per map, genre of decennium zonder handmatig sorteerwerk.

### 4. Meertraps Intelligente Matcher
- **Trap 1: Exacte ISRC**: Zoekt eerst op de unieke industry track code voor 100% foutloze matches.
- **Trap 2: Genormaliseerde Query**: Verwijdert overbodige tekens, haakjes en remaster-annotaties.
- **Trap 3: Fuzzy Levenshtein & Duur**: Vergelijkt lengte in seconden ($\Delta \text{ seconden}$) om *Radio Edits* van *Extended Mixes* te onderscheiden.

### 5. Differentiële Synchronisatie (No-Duplicate Engine)
- Voordat nummers naar Spotify worden gepusht, berekent MP3Spot het verschil (*diff*) met reeds bestaande tracks in je afspeellijsten. Alleen ontbrekende tracks worden toegevoegd.

### 6. Automatische Build-Versienummering (`year.month.day[.build#]`)
- Buildnummers volgen het schema `YYYY.MM.DD` voor de eerste build van de dag (`build# = 0`).
- Latere builds op dezelfde dag krijgen automatisch `.1`, `.2`, enz. (bijv. `2026.11.03.1`).
- Direct zichtbaar in de interface footer en in `src/version.json`.

---

## 🐳 Uitrollen in Dockhand / Portainer (Zero-Copy vanaf GitHub)

Je hoeft **geen enkel bestand handmatig naar je server te kopiëren**. Kopieer een van onderstaande configuraties rechtstreeks in je **Dockhand** of **Portainer** stack:

### Optie A: Standalone Git-Clone Stack (100% Zero-Copy)

Deze stack start op een standaard `node:22-alpine` image, haalt de meest recente code automatisch op via `git clone`, installeert dependencies en start MP3Spot op poort `3000`.

> **💡 Opgelost in v2026.11.03:**
> Docker koppelt volumes al vóórdat het container-commando draait. Hierdoor was `/app` niet leeg en gaf Git de melding:
> `fatal: destination path '/app' already exists and is not an empty directory.`
> Onderstaande configuratie lost dit definitief op door persistente data te scheiden naar `/data` én een veilige *clone-and-sync* methode te gebruiken via `/tmp/mp3spot_clone`.

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
      # --- Volume Paden ---
      - MUSIC_LIBRARY_PATH=/music
      - DATA_PATH=/data
      - EXPORTS_PATH=/exports
      # --- Spotify Developer Credentials (optioneel voor live sync) ---
      - SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID:-}
      - SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET:-}
      - APP_URL=http://localhost:3000
    volumes:
      # 1. Je lokale muziekmap op de NAS/host (:rw om ID3-tags te kunnen schrijven)
      - /mnt/nas/muziek:/music:rw
      # 2. Persistente opslag voor app-state en database (veilig gescheiden van /app)
      - mp3spot_data:/data
      # 3. Exportmap voor .m3u8, .json en .csv bestanden
      - ./exports:/exports
      # 4. Volume voor MP3Spot broncode
      - mp3spot_repo:/app
    command: >
      sh -c "apk add --no-cache git &&
      git config --global --add safe.directory /app &&
      if [ ! -d /app/.git ]; then
        echo 'Cloning MP3Spot repository from GitHub...' &&
        rm -rf /tmp/mp3spot_clone &&
        mkdir -p /tmp/mp3spot_clone &&
        git clone $$GIT_REPO_URL /tmp/mp3spot_clone &&
        cp -a /tmp/mp3spot_clone/. /app/ &&
        rm -rf /tmp/mp3spot_clone;
      else
        echo 'Updating MP3Spot repository via git pull...' &&
        cd /app && git pull;
      fi &&
      cd /app &&
      npm install &&
      npm run build &&
      npm run start"

volumes:
  mp3spot_repo:
  mp3spot_data:
```

---

### Optie B: Native Docker Git Build Stack

Laat Docker het image direct compileren vanaf de GitHub repository (als jouw Docker daemon remote git build ondersteunt):

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
      - DATA_PATH=/data
      - EXPORTS_PATH=/exports
      - SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID:-}
      - SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET:-}
      - APP_URL=http://localhost:3000
    volumes:
      - /mnt/nas/muziek:/music:rw
      - mp3spot_data:/data
      - ./exports:/exports

volumes:
  mp3spot_data:
```

---

## 💾 Overzicht van Volume Mappings

MP3Spot werkt met drie geïsoleerde paden binnen de container:

| Container Pad | Omgevingsvariabele | Rechten | Doel | Voorbeeld Host Mapping |
| :--- | :--- | :---: | :--- | :--- |
| `/music` | `MUSIC_LIBRARY_PATH` | `:rw` | De bronmap met je MP3/FLAC collectie. `:rw` is vereist zodat MP3Spot ID3-tags direct kan bijwerken. | `/mnt/nas/muziek:/music:rw` |
| `/data` *(of `/app/data`)* | `DATA_PATH` | `:rw` | Bewaart `mp3spot-state.json` (gescande bibliotheek, matchgeschiedenis en playlistregels). | `mp3spot_data:/data` |
| `/exports` | `EXPORTS_PATH` | `:rw` | Map waarin MP3Spot geëxporteerde `.m3u8` lijsten, `.json` mappings en `.csv` bestanden opslaat. | `./exports:/exports` |

---

## 🎵 Spotify Developer API Koppelen

Om gevonden tracks automatisch te synchroniseren naar afspeellijsten in je Spotify-account:

1. Ga naar het [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) en log in met je Spotify-account.
2. Klik op **Create App** en vul een naam in (bijv. `MP3Spot`).
3. Voeg bij **Redirect URIs** de URL van jouw MP3Spot-instantie toe, gevolgd door `/auth/callback`:
   - Lokaal: `http://localhost:3000/auth/callback`
   - Server / Domein: `https://muziek.jouwdomein.nl/auth/callback`
4. Kopieer je **Client ID** en **Client Secret** naar je environment variabelen (of vul ze in via de instellingenknop in MP3Spot).
5. Klik in MP3Spot rechtsboven op **Verbind Spotify**.

---

## 🛠️ Lokale Ontwikkeling

```bash
# Repository klonen
git clone https://github.com/JOUW_GEBRUIKERSNAAM/mp3spot.git
cd mp3spot

# Afhankelijkheden installeren
npm install

# Lokale testserver starten (poort 3000)
npm run dev

# Productie build genereren met automatische versienummering
npm run build
```

---

<div align="center">
  <small>Ontworpen met het Kolenkachel Kleurenschema • Gemaakt voor muziekliefhebbers met een eigen lokale collectie</small>
</div>
