<div align="center">
  <img src="./public/mp3spot-icon.svg" alt="MP3Spot Logo" width="110" height="110" />
  <h1>MP3Spot</h1>
  <p><strong>Self-Hosted Lokale Muziekbibliotheek Synchronisatie, Binaire Spotify ID3v2.3 Tagger & Automatische Afspeellijst-Engine</strong></p>
  <p>
    <img src="https://img.shields.io/badge/Docker-GHCR%20Ready-F58220?style=flat-square&logo=docker&logoColor=white" alt="Docker GHCR Ready" />
    <img src="https://img.shields.io/badge/Spotify_API-2026_Compatible-00A3B4?style=flat-square&logo=spotify&logoColor=white" alt="Spotify Web API 2026" />
    <img src="https://img.shields.io/badge/ID3v2.3-Binary_Tagger-22C55E?style=flat-square" alt="ID3v2.3 Binary Tagger" />
    <img src="https://img.shields.io/badge/Design-Kolenkachel_UI-161616?style=flat-square" alt="Kolenkachel Design System" />
  </p>
</div>

---

**MP3Spot** is een self-hosted webapplicatie ontworpen voor het scannen van lokale audiocollecties (`.mp3`, `.flac`, `.m4a`, `.wav`), het automatisch koppelen van nummers aan de officiële **Spotify-catalogus**, het binair terugschrijven van geverifieerde **ID3v2.3-metadata** naar je eigen `.mp3`-bestanden op schijf, én het automatisch opbouwen en synchroniseren van **Spotify-afspeellijsten per releasejaar** (`MP3Spot Jaar: YYYY`), map, genre of tempo.

De volledige interface is gebouwd volgens het industriële **Kolenkachel Design Systeem** (met zowel een *Warm Carbon Dark Mode* als een *Warm Alabaster Light Mode*) en kan direct als kant-en-klare container in **Dockhand**, **Portainer** of **Docker Compose** worden uitgerold.

---

## ✨ Kernfunctionaliteiten

### 1. Lokale Bibliotheek & Server-Side `/music` Volume Scanner
- **Recursieve `/music` Scanner**: Scant duizenden audiobestanden rechtstreeks vanaf een gemount Docker-volume (`/music:rw`) op je NAS, Unraid-, Synology- of Linux-server.
- **Browser Map-Upload**: Ondersteunt daarnaast direct slepen en selecteren van lokale mappen vanuit de browser (`webkitdirectory`) inclusief client-side ID3v2.2/v2.3/v2.4 header-extractie.
- **In-line Track-Editor**: Pas titel, artiest, album, jaar, genre en BPM direct aan in de tabel met automatische herberekening van de Spotify-match.
- **Snel Bibliotheek Opschonen**: Wis met één klik onderin de zijbalk alle geladen tracks en regels uit de interface en uit `/data/mp3spot-state.json` om met een schone lei te starten.

### 2. Binaire Spotify ID3v2.3 Tagger
- **Schrijf Spotify Metadata naar `.mp3`**: Vervangt of injecteert een standaard **ID3v2.3** binary header in je lokale `.mp3`-bestanden op het `/music`-volume (of via een directe browser-download).
- **Volledige Frame-ondersteuning**:
  - `TIT2` — Officiële Spotify Tracktitel
  - `TPE1` — Officiële Spotify Artiest(en)
  - `TALB` — Officieel Spotify Album
  - `TYER` — Officiële Releasejaar (`YYYY`)
  - `TCON` — Genre & Subgenre
  - `TSRC` — Internationale ISRC-code
  - `WOAF` — Officiële Spotify Track URL
  - `TXXX` — Custom velden voor `SPOTIFY_URI` en `SPOTIFY_ALBUM_ART`

### 3. Meertraps Spotify Matcher & Live URI-Resolutie
- **5-traps Match-algoritme**:
  1. Exacte **ISRC-code** verificatie (`isrc:...`)
  2. Exacte genormaliseerde `track:"..." artist:"..."` zoekopdracht (verwijdert automatisch ruis zoals `(Original Mix)`, `[Remastered]`, `feat.`, bitrate-tags en tracknummers)
  3. Brede zoekopdracht op schoongemaakte titel + primaire artiest
  4. Bestandsnaam-fallback wanneer ID3-tags ontbreken of incompleet zijn
  5. Deterministische lokale fallback-hash wanneer nog geen Spotify API-sleutels zijn gekoppeld
- **Live URI-Resolutie tijdens Synchronisatie**: Nummers die vóór het koppelen van Spotify zijn gescand, worden tijdens het synchroniseren automatisch alsnog live via de Spotify Search API omgezet naar echte `spotify:track:...` URI's voordat ze aan afspeellijsten worden toegevoegd.

### 4. Automatische Jaar-Afspeellijsten & Slimme Regels
- **`MP3Spot Jaar: YYYY`**: Voor elk uniek releasejaar dat in je bibliotheek of via Spotify wordt gedetecteerd, maakt MP3Spot automatisch een bijbehorende jaar-afspeellijst aan (bijv. `MP3Spot Jaar: 1995`, `MP3Spot Jaar: 2024`).
- **Slimme Afspeellijst-regels**: Maak daarnaast dynamische lijsten op basis van:
  - **Bronmap** (bijv. `/music/Vinyl Rips` of `/music/90s Classics`)
  - **Genre** (bijv. `Synthwave`, `Techno`, `Indie Rock`)
  - **Decennium / Jaarbereik** (bijv. `1990 – 1999`)
  - **BPM & Tempo** (bijv. `120 – 138 BPM` voor workout- of DJ-sets)
  - **Aangepaste Zoekfilters** (combinaties van artiest, album of trefwoord)

### 5. Differentiële Spotify Synchronisatie (2026 Web API Ready)
- **Compatibel met de nieuwste Spotify Web API (2026)**:
  - Maakt afspeellijsten aan via `POST /v1/me/playlists` (geen handmatige User ID nodig).
  - Voegt nummers in batches van 100 toe via `POST /v1/playlists/{id}/items` met automatische fallback naar `/tracks`.
  - Hergebruikt bestaande Spotify-afspeellijsten met dezelfde naam en voegt uitsluitend nog ontbrekende nummers toe (voorkomt duplicaten).
- **Interactieve Diff-Preview**: Controleer per afspeellijst exact welke nummers nieuw worden toegevoegd (`+ Toe te voegen`), welke al gesynchroniseerd zijn (`✓ In Spotify`) en welke handmatige review vragen.

### 6. Inline Configuratie (Zonder Container Herstart)
- Stel je **Spotify Client ID**, **Spotify Client Secret**, **Publieke Redirect URI** en **Host-paden** direct in via de webinterface onder **5. Configuratie** in de zijbalk.
- Alle instellingen worden persistent opgeslagen in `/data/mp3spot-config.json` op de server en hebben direct voorrang, zonder dat je de Docker-container hoeft te herstarten.

---

## 🧭 Navigatie & Architectuur

MP3Spot heeft een gestroomlijnde layout met een **inklapbare zijbalk** (`Hoofdnavigatie`) waarin de 5 hoofdmodules en alle mappen/afspeellijsten zijn ondergebracht:

| Module in Zijbalk | Beschrijving |
| :--- | :--- |
| **1. Bibliotheek** | Lokale audiobestanden scannen (`/music` of browser), filteren op map/jaar/afspeellijst, metadata inline bewerken en binaire ID3v2.3-tags naar `.mp3`-bestanden schrijven. |
| **2. Spotify Matcher** | Meertraps match-analyse bekijken, betrouwbaarheidsscores controleren, alternatieve Spotify-kandidaten kiezen of een handmatige Spotify URI (`spotify:track:...`) koppelen. |
| **3. Slimme Lijsten** | Automatische `MP3Spot Jaar: YYYY` lijsten beheren en eigen dynamische afspeellijst-regels opstellen op basis van map, genre, BPM of zoekterm. |
| **4. Synchronisatie** | Differentiële vergelijking per afspeellijst bekijken en met één klik alle gematchte nummers naar je Spotify-account pushen of exporteren als `.m3u8` / `.json`. |
| **5. Configuratie** | Inline Spotify API-sleutels (`Client ID`, `Client Secret`, `Redirect URI`) en volume-paden opslaan in `/data/mp3spot-config.json`, plus een kant-en-klare **Dockhand Stack YAML** genereren. |

---

## 🐳 Uitrollen met Dockhand / Portainer / Docker Compose

De officiële Docker-image wordt automatisch door GitHub Actions gebouwd en gepubliceerd naar de GitHub Container Registry:
**`ghcr.io/ckb-k28/mp3spot:latest`**

### Aanbevolen `docker-compose.yml` (of Dockhand Stack)

```yaml
services:
  mp3spot:
    image: ghcr.io/ckb-k28/mp3spot:latest
    pull_policy: always
    container_name: mp3spot
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      # Lokale muziekcollectie (:rw is vereist om ID3v2.3 tags terug te schrijven naar .mp3)
      - /pad/naar/jouw/muziek:/music:rw
      # Persistente opslag voor status, inline configuratie en Spotify OAuth-sessies
      - /pad/naar/dockhand/mp3spot/data:/data
      # Exportmap voor gegenereerde .m3u8 en .json afspeellijsten
      - /pad/naar/dockhand/mp3spot/exports:/exports
    environment:
      - NODE_ENV=production
      - PORT=3000
      - TZ=Europe/Amsterdam
      # Optioneel: kan ook direct in de webinterface onder '5. Configuratie' worden ingevuld
      - SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID:-}
      - SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET:-}
      - SPOTIFY_REDIRECT_URI=${SPOTIFY_REDIRECT_URI:-}
      - SPOTIFY_MARKET=NL
      - AUTO_SCAN_INTERVAL_MINUTES=30
```

### Updaten naar de nieuwste versie in Dockhand
1. Open je **MP3Spot** stack of container in **Dockhand**.
2. Klik op **Pull Image** / **Update Stack** (of voer `docker compose pull && docker compose up -d` uit).
3. Controleer linksboven onder het MP3Spot-logo of het nieuwe build-versienummer (`vYYYY.MM.DD`) zichtbaar is.

---

## 💾 Volume Mappings & Persistente Bestanden

| Container Pad | Aanbevolen Modus | Inhoud & Functie |
| :--- | :---: | :--- |
| **`/music`** | `:rw` *(Lezen & Schrijven)* | Bevat je lokale `.mp3`, `.flac`, `.m4a`, `.wav` en `.ogg` bestanden. Met `:rw` kan MP3Spot binaire ID3v2.3-tags rechtstreeks in de `.mp3`-bestanden bijwerken. Gebruik `:ro` als je uitsluitend wilt lezen. |
| **`/data`** | `:rw` *(Vereist)* | Bevat de persistente bestanden van MP3Spot:<br>• `mp3spot-state.json` — Gescande nummers, matches en afspeellijst-regels<br>• `mp3spot-config.json` — Inline opgeslagen Spotify API-sleutels en paden<br>• `spotify-session.json` — Actieve Spotify OAuth access- en refresh-tokens |
| **`/exports`** | `:rw` *(Optioneel)* | Doelmap voor geëxporteerde `.m3u8`- en `.json`-afspeellijstbestanden. |

---

## 🎧 Spotify Developer API Configuratie (Stapsgewijs)

Om echte Spotify-zoekopdrachten uit te voeren en afspeellijsten rechtstreeks in je Spotify-account aan te maken en te vullen, koppel je een eigen Spotify Developer App:

1. Ga naar het **[Spotify Developer Dashboard](https://developer.spotify.com/dashboard)** en log in met je Spotify-account.
2. Klik op **Create App** en vul in:
   - **App name**: `MP3Spot`
   - **App description**: `Lokale MP3-bibliotheek synchronisatie en ID3v2.3 tagger`
   - **Redirect URIs**: Voeg het exacte callback-adres toe waarop je MP3Spot opent, gevolgd door `/auth/callback`, bijvoorbeeld:
     - Lokaal op dezelfde machine: `http://127.0.0.1:3000/auth/callback`
     - Via een HTTPS reverse proxy / domein: `https://mp3spot.jouwdomein.nl/auth/callback`
     *(Let op: Spotify vereist voor niet-HTTPS adressen een expliciete loopback zoals `127.0.0.1` of een HTTPS reverse proxy).*
   - Vink **Web API** aan en klik op **Save**.
3. **BELANGRIJK — Voeg je Spotify-account toe onder "Users and Access"**:
   - Nieuwe Spotify Developer apps staan standaard in **Development Mode**.
   - Open in het Spotify Developer Dashboard je app en ga naar het tabblad **User Management** / **Users and Access**.
   - Voeg daar je eigen **naam en het e-mailadres van je Spotify-account** toe. Zonder deze stap blokkeert Spotify toegang tot `/v1/me` en het toevoegen van nummers aan afspeellijsten (`403 Forbidden`).
4. Open **Settings** in het Spotify Developer Dashboard en kopieer je **Client ID** en **Client Secret**.
5. Open **MP3Spot**, klik in de linker zijbalk op **5. Configuratie**, plak je **Client ID**, **Client Secret** en **Redirect URI** en klik op **Bewaar & Activeer Direct**.
6. Klik rechtsboven op **Verbind Spotify** om de OAuth-koppeling te voltooien.

---

## 🎨 Kolenkachel Design Systeem

De interface van MP3Spot volgt de **Kolenkachel** ontwerpstandaard: een hoog-contrast, industrieel kleurenpalet met zowel een donkere als een lichte modus.

| Element | Kleurcode | Toepassing |
| :--- | :--- | :--- |
| **Warm Carbon** | `#161616` | Primaire achtergrond in Dark Mode |
| **Warm Dark Surface** | `#202020` | Kaarten, zijbalk, modale vensters en tabellen |
| **Warm Alabaster** | `#F7F6F2` | Primaire achtergrond in Light Mode |
| **Kolenkachel Oranje** | `#F58220` | Primaire actieknoppen, actieve navigatie en ID3-indicatoren |
| **Kolenkachel Teal** | `#00A3B4` | Secundaire accenten, pad-badges en systeemstatus |
| **Emerald Match** | `#22C55E` | Geverifieerde Spotify-matches en gesynchroniseerde afspeellijsten |

**Typografie**:
- **Titels & Koppen**: `Outfit` (600 / 700, strakke letterafstand)
- **Interface & Tabellen**: `Plus Jakarta Sans` (400 / 500 / 600)
- **Tijdstippen, Versienummers, ISRC & Paden**: `JetBrains Mono`

---

## 🛠️ Lokale Ontwikkeling & Automatische Versienummering

### Vereisten
- **Node.js** `>= 20.x`
- **npm** `>= 10.x`

### Starten in ontwikkelmodus
```bash
# 1. Installeer dependencies
npm install

# 2. Kopieer de voorbeeld-omgevingsvariabelen (optioneel)
cp .env.example .env

# 3. Start de full-stack Express + Vite server op poort 3000
npm run dev
```

### Productie-build & Versienummering
Elke keer dat `npm run build` wordt uitgevoerd (lokaal of via GitHub Actions), genereert `scripts/version-build.ts` automatisch een nieuw datum-gebaseerd versienummer (`YYYY.MM.DD` of `YYYY.MM.DD.build#` bij meerdere builds op dezelfde dag) in `src/version.ts` en `package.json`:

```bash
# Genereer nieuw build-versienummer en bouw de frontend in ./dist
npm run build

# Start de productieserver
npm start
```
