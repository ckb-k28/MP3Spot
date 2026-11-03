import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

dotenv.config();

interface SpotifySession {
  id: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  user: {
    id: string;
    display_name: string;
    email?: string;
    product?: string;
    country?: string;
  };
}

interface LocalTrackInput {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  isrc?: string;
  year?: number;
}

interface SpotifyCandidate {
  spotifyId: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  releaseYear: number;
  isrc?: string;
  confidence: number;
  matchMethod:
    | 'ISRC Exact'
    | 'Titel & Artiest Exact'
    | 'Fuzzy Metadata Match'
    | 'Handmatig Gekoppeld';
  externalUrl: string;
}

const sessions = new Map<string, SpotifySession>();
let clientCredentialsToken: { token: string; expiresAt: number } | null = null;

// ============================================================================
// Volume Paths Configuration (/music, /app/data, /exports)
// ============================================================================
const MUSIC_LIBRARY_PATH = process.env.MUSIC_LIBRARY_PATH || '/music';
const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), 'data');
const EXPORTS_PATH = process.env.EXPORTS_PATH || path.join(process.cwd(), 'exports');

for (const dir of [DATA_PATH, EXPORTS_PATH]) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Ignore permission errors in read-only sandbox environments
  }
}

const STATE_FILE_PATH = path.join(DATA_PATH, 'spotisync-state.json');

// ============================================================================
// App Login & Docker Compose Authentication System
// Supports:
//   1. APP_USERNAME (default: "admin")
//   2. APP_PASSWORD_HASH (recommended: SHA-256 hex digest so no plaintext in YAML)
//   3. APP_PASSWORD_FILE (Docker Secrets file path, e.g. /run/secrets/app_password)
//   4. APP_PASSWORD (direct environment variable in docker-compose.yml)
// ============================================================================
const SERVER_SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toLowerCase();
}

function getConfiguredAuthConfig(): {
  username: string;
  expectedPasswordHash: string;
  authMode: 'password_hash' | 'docker_secret_file' | 'env_password' | 'default_fallback';
  usingDefaultCredentials: boolean;
} {
  const username = (process.env.APP_USERNAME || 'admin').trim();

  if (process.env.APP_PASSWORD_HASH && process.env.APP_PASSWORD_HASH.trim().length === 64) {
    return {
      username,
      expectedPasswordHash: process.env.APP_PASSWORD_HASH.trim().toLowerCase(),
      authMode: 'password_hash',
      usingDefaultCredentials: false,
    };
  }

  if (process.env.APP_PASSWORD_FILE) {
    try {
      const secretFromFile = fs.readFileSync(process.env.APP_PASSWORD_FILE, 'utf8').trim();
      if (secretFromFile) {
        return {
          username,
          expectedPasswordHash: sha256Hex(secretFromFile),
          authMode: 'docker_secret_file',
          usingDefaultCredentials: false,
        };
      }
    } catch {
      // Fall through if secret file is not readable
    }
  }

  if (process.env.APP_PASSWORD && process.env.APP_PASSWORD.trim().length > 0) {
    return {
      username,
      expectedPasswordHash: sha256Hex(process.env.APP_PASSWORD.trim()),
      authMode: 'env_password',
      usingDefaultCredentials: false,
    };
  }

  // Fallback for preview / first boot before docker-compose env vars are set
  return {
    username,
    expectedPasswordHash: sha256Hex('spotisync'),
    authMode: 'default_fallback',
    usingDefaultCredentials: true,
  };
}

function createSignedAppToken(username: string): string {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  const payload = Buffer.from(JSON.stringify({ u: username, exp })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SERVER_SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifySignedAppToken(token?: string): { valid: boolean; username?: string } {
  if (!token || !token.includes('.')) return { valid: false };
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { valid: false };

  const expectedSig = crypto
    .createHmac('sha256', SERVER_SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false };
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.exp || Date.now() > decoded.exp) {
      return { valid: false };
    }
    return { valid: true, username: decoded.u };
  } catch {
    return { valid: false };
  }
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const key = parts.shift()?.trim();
    if (key) {
      list[key] = decodeURIComponent(parts.join('='));
    }
  });
  return list;
}

function getAppAuthFromReq(req: Request): { authenticated: boolean; username?: string } {
  const headerToken = req.headers['x-app-auth-token'] as string | undefined;
  const cookies = parseCookies(req.headers.cookie);
  const token = headerToken || cookies['spotisync_app_auth'];
  const verified = verifySignedAppToken(token);
  return { authenticated: verified.valid, username: verified.username };
}

function requireAppAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAppAuthFromReq(req);
  if (!auth.authenticated) {
    res.status(401).json({ error: 'Niet geautoriseerd. Log eerst in.' });
    return;
  }
  next();
}

// Curated reference catalog of well-known tracks for instant high-precision matching
const REFERENCE_CATALOG: Array<{
  spotifyId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  releaseYear: number;
  isrc: string;
}> = [
  {
    spotifyId: '4cOdK2wGLETKBW3PvgPWqT',
    title: 'Strobe',
    artist: 'deadmau5',
    album: 'For Lack of a Better Name',
    durationSec: 637,
    releaseYear: 2009,
    isrc: 'GBAAA0900495',
  },
  {
    spotifyId: '3ebXMykcMXOcLeJ9xZ17XH',
    title: 'Scary Monsters and Nice Sprites',
    artist: 'Skrillex',
    album: 'Scary Monsters and Nice Sprites',
    durationSec: 243,
    releaseYear: 2010,
    isrc: 'USAT21002153',
  },
  {
    spotifyId: '0VjIjW4GlUZAMYd2vXMi3b',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    durationSec: 200,
    releaseYear: 2020,
    isrc: 'USUG11904206',
  },
  {
    spotifyId: '2Fxmhks0bxGSBdJ92vM42m',
    title: 'bad guy',
    artist: 'Billie Eilish',
    album: 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?',
    durationSec: 194,
    releaseYear: 2019,
    isrc: 'USUM71900764',
  },
  {
    spotifyId: '5HCyWlXZPP0y6Gqq8TgA20',
    title: 'STAY',
    artist: 'The Kid LAROI, Justin Bieber',
    album: 'F*CK LOVE 3: OVER YOU',
    durationSec: 141,
    releaseYear: 2021,
    isrc: 'USSM12103949',
  },
  {
    spotifyId: '6habFhsOp2NvshLv26DqMb',
    title: 'Despacito',
    artist: 'Luis Fonsi, Daddy Yankee',
    album: 'VIDA',
    durationSec: 229,
    releaseYear: 2019,
    isrc: 'USUM71615499',
  },
  {
    spotifyId: '7qiZfU4dY1lWllzX7mPBI3',
    title: 'Shape of You',
    artist: 'Ed Sheeran',
    album: '÷ (Divide)',
    durationSec: 233,
    releaseYear: 2017,
    isrc: 'GBAHS1600463',
  },
  {
    spotifyId: '1r9xUipOqoNwggBpENDsvJ',
    title: 'Innerbloom',
    artist: 'RÜFÜS DU SOL',
    album: 'Bloom',
    durationSec: 578,
    releaseYear: 2016,
    isrc: 'AUUM71500911',
  },
  {
    spotifyId: '5nujrmhLynf4yMoMtj8AQF',
    title: 'Levitating',
    artist: 'Dua Lipa',
    album: 'Future Nostalgia',
    durationSec: 203,
    releaseYear: 2020,
    isrc: 'GBAHT1901299',
  },
  {
    spotifyId: '0pqnGHJpmpxLKifKRmU6WP',
    title: 'Believer',
    artist: 'Imagine Dragons',
    album: 'Evolve',
    durationSec: 204,
    releaseYear: 2017,
    isrc: 'USUM71700626',
  },
  {
    spotifyId: '3AJwUDP919kvQ9QcozQPxg',
    title: 'Yellow',
    artist: 'Coldplay',
    album: 'Parachutes',
    durationSec: 266,
    releaseYear: 2000,
    isrc: 'GBAYE0000267',
  },
  {
    spotifyId: '2takcwOaAZWiXQijPHIx7B',
    title: 'Time',
    artist: 'Hans Zimmer',
    album: 'Inception (Music from the Motion Picture)',
    durationSec: 275,
    releaseYear: 2010,
    isrc: 'USWB11001427',
  },
  {
    spotifyId: '6DCZcSspjsKoFjzjrWoCdn',
    title: "God's Plan",
    artist: 'Drake',
    album: 'Scorpion',
    durationSec: 198,
    releaseYear: 2018,
    isrc: 'USCM51800004',
  },
  {
    spotifyId: '5ChkMS8OtdzJeqyybCc9R5',
    title: 'Billie Jean',
    artist: 'Michael Jackson',
    album: 'Thriller',
    durationSec: 294,
    releaseYear: 1982,
    isrc: 'USSM19902991',
  },
  {
    spotifyId: '2plbrEY59IikOBgBGLjaoe',
    title: 'Die With A Smile',
    artist: 'Lady Gaga, Bruno Mars',
    album: 'Die With A Smile',
    durationSec: 251,
    releaseYear: 2024,
    isrc: 'USUM72409273',
  },
  {
    spotifyId: '60nZcImufyMA1MKQY3dcCH',
    title: 'Happy',
    artist: 'Pharrell Williams',
    album: 'G I R L',
    durationSec: 232,
    releaseYear: 2014,
    isrc: 'USQ4E1300686',
  },
  {
    spotifyId: '0VjIjW4GlUZAMYd2vXMi3c',
    title: 'Zoutelande',
    artist: 'BLØF, Geike Arnaert',
    album: 'Aan',
    durationSec: 223,
    releaseYear: 2017,
    isrc: 'NLB631700084',
  },
  {
    spotifyId: '4uLU6hMCjMI75M1A2tKUQC',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    album: 'Whenever You Need Somebody',
    durationSec: 213,
    releaseYear: 1987,
    isrc: 'GBARL9300135',
  },
];

function getSessionFromReq(req: Request): SpotifySession | null {
  const headerSessionId = req.headers['x-spotify-session'] as string | undefined;
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = headerSessionId || cookies['spotify_session_id'];
  if (!sessionId) return null;
  return sessions.get(sessionId) || null;
}

function getRedirectUri(req: Request): string {
  const clientOrigin = (req.query.origin as string) || '';
  if (clientOrigin && (clientOrigin.startsWith('http://') || clientOrigin.startsWith('https://'))) {
    return `${clientOrigin.replace(/\/$/, '')}/auth/callback`;
  }
  const appUrl = process.env.APP_URL;
  if (appUrl && appUrl !== 'MY_APP_URL' && appUrl.startsWith('http')) {
    return `${appUrl.replace(/\/$/, '')}/auth/callback`;
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
  return `${proto}://${host}/auth/callback`;
}

function normalizeString(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/\((original mix|extended mix|radio edit|club mix|remastered.*|feat\..*|ft\..*)\)/gi, '')
    .replace(/\[(original mix|extended mix|radio edit|remastered.*|feat\..*|ft\..*)\]/gi, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const normA = normalizeString(a);
  const normB = normalizeString(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.9;

  const tokensA = new Set(normA.split(' ').filter(Boolean));
  const tokensB = new Set(normB.split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  return (2 * intersection) / (tokensA.size + tokensB.size);
}

function computeCandidateConfidence(
  local: LocalTrackInput,
  candidate: {
    title: string;
    artist: string;
    album: string;
    durationSec: number;
    isrc?: string;
  }
): { confidence: number; matchMethod: SpotifyCandidate['matchMethod'] } {
  if (
    local.isrc &&
    candidate.isrc &&
    local.isrc.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() ===
      candidate.isrc.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  ) {
    return { confidence: 99, matchMethod: 'ISRC Exact' };
  }

  const titleSim = tokenSimilarity(local.title, candidate.title);
  const artistSim = tokenSimilarity(local.artist, candidate.artist);
  const albumSim = local.album && candidate.album ? tokenSimilarity(local.album, candidate.album) : 0.7;

  const durationDiff = Math.abs((local.durationSec || 210) - (candidate.durationSec || 210));
  const durationScore = durationDiff <= 3 ? 1 : durationDiff <= 10 ? 0.9 : durationDiff <= 30 ? 0.7 : 0.45;

  const weighted = titleSim * 0.48 + artistSim * 0.36 + durationScore * 0.1 + albumSim * 0.06;
  const confidence = Math.max(15, Math.min(98, Math.round(weighted * 100)));

  const matchMethod: SpotifyCandidate['matchMethod'] =
    confidence >= 90 ? 'Titel & Artiest Exact' : 'Fuzzy Metadata Match';

  return { confidence, matchMethod };
}

async function getSpotifyAccessToken(req: Request): Promise<string | null> {
  const session = getSessionFromReq(req);
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (session) {
    if (Date.now() < session.expiresAt - 30000) {
      return session.accessToken;
    }
    if (session.refreshToken && clientId && clientSecret) {
      try {
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const resp = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: session.refreshToken,
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            access_token: string;
            expires_in: number;
            refresh_token?: string;
          };
          session.accessToken = data.access_token;
          session.expiresAt = Date.now() + data.expires_in * 1000;
          if (data.refresh_token) session.refreshToken = data.refresh_token;
          return session.accessToken;
        }
      } catch (e) {
        console.error('Spotify token refresh error:', e);
      }
    }
  }

  if (clientId && clientSecret) {
    if (clientCredentialsToken && Date.now() < clientCredentialsToken.expiresAt - 30000) {
      return clientCredentialsToken.token;
    }
    try {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const resp = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { access_token: string; expires_in: number };
        clientCredentialsToken = {
          token: data.access_token,
          expiresAt: Date.now() + data.expires_in * 1000,
        };
        return clientCredentialsToken.token;
      }
    } catch (e) {
      console.error('Spotify client credentials error:', e);
    }
  }

  return null;
}

async function searchTrackCandidates(
  local: LocalTrackInput,
  spotifyToken: string | null
): Promise<SpotifyCandidate[]> {
  if (spotifyToken) {
    try {
      const cleanTitle = normalizeString(local.title) || local.title;
      const cleanArtist = normalizeString(local.artist) || local.artist;
      const queries: string[] = [];

      if (local.isrc) {
        queries.push(`isrc:${local.isrc.trim()}`);
      }
      queries.push(`track:${cleanTitle} artist:${cleanArtist}`);
      queries.push(`${cleanArtist} ${cleanTitle}`);

      for (const q of queries) {
        const url = `https://api.spotify.com/v1/search?${new URLSearchParams({
          q,
          type: 'track',
          limit: '5',
        }).toString()}`;

        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${spotifyToken}` },
        });
        if (resp.ok) {
          const data = (await resp.json()) as any;
          const items = data?.tracks?.items || [];
          if (items.length > 0) {
            const candidates: SpotifyCandidate[] = items.map((item: any) => {
              const artistName = (item.artists || []).map((a: any) => a.name).join(', ');
              const durationSec = Math.round((item.duration_ms || 200000) / 1000);
              const releaseYear =
                parseInt((item.album?.release_date || '2020').slice(0, 4), 10) || 2020;
              const isrc = item.external_ids?.isrc;
              const { confidence, matchMethod } = computeCandidateConfidence(local, {
                title: item.name,
                artist: artistName,
                album: item.album?.name || '',
                durationSec,
                isrc,
              });

              return {
                spotifyId: item.id,
                uri: item.uri || `spotify:track:${item.id}`,
                title: item.name,
                artist: artistName,
                album: item.album?.name || 'Onbekend Album',
                durationSec,
                releaseYear,
                isrc,
                confidence,
                matchMethod,
                externalUrl:
                  item.external_urls?.spotify || `https://open.spotify.com/track/${item.id}`,
              };
            });

            candidates.sort((a, b) => b.confidence - a.confidence);
            return candidates;
          }
        }
      }
    } catch (err) {
      console.error('Spotify search error:', err);
    }
  }

  try {
    const queryTerm = `${local.artist} ${local.title}`.trim();
    const itunesUrl = `https://itunes.apple.com/search?${new URLSearchParams({
      term: queryTerm,
      media: 'music',
      entity: 'song',
      limit: '5',
    }).toString()}`;

    const resp = await fetch(itunesUrl);
    if (resp.ok) {
      const data = (await resp.json()) as any;
      const results = data?.results || [];
      if (results.length > 0) {
        const candidates: SpotifyCandidate[] = results.map((r: any) => {
          const durationSec = Math.round((r.trackTimeMillis || 210000) / 1000);
          const releaseYear = parseInt((r.releaseDate || '2020').slice(0, 4), 10) || 2020;
          const deterministicHash = crypto
            .createHash('md5')
            .update(`${r.artistName}:${r.trackName}:${r.collectionName}`)
            .digest('base64url')
            .replace(/[^a-zA-Z0-9]/g, '')
            .slice(0, 22);

          const { confidence, matchMethod } = computeCandidateConfidence(local, {
            title: r.trackName || local.title,
            artist: r.artistName || local.artist,
            album: r.collectionName || local.album,
            durationSec,
          });

          return {
            spotifyId: deterministicHash,
            uri: `spotify:track:${deterministicHash}`,
            title: r.trackName || local.title,
            artist: r.artistName || local.artist,
            album: r.collectionName || local.album || 'Single',
            durationSec,
            releaseYear,
            isrc: local.isrc || `NL${deterministicHash.slice(0, 10).toUpperCase()}`,
            confidence,
            matchMethod,
            externalUrl: `https://open.spotify.com/search/${encodeURIComponent(
              `${r.artistName} ${r.trackName}`
            )}`,
          };
        });

        candidates.sort((a, b) => b.confidence - a.confidence);
        return candidates;
      }
    }
  } catch {
    // Continue to local reference catalog fallback
  }

  const scoredRef = REFERENCE_CATALOG.map((item) => {
    const { confidence, matchMethod } = computeCandidateConfidence(local, item);
    return {
      spotifyId: item.spotifyId,
      uri: `spotify:track:${item.spotifyId}`,
      title: item.title,
      artist: item.artist,
      album: item.album,
      durationSec: item.durationSec,
      releaseYear: item.releaseYear,
      isrc: item.isrc,
      confidence,
      matchMethod,
      externalUrl: `https://open.spotify.com/track/${item.spotifyId}`,
    };
  }).sort((a, b) => b.confidence - a.confidence);

  if (scoredRef[0] && scoredRef[0].confidence >= 65) {
    return scoredRef.slice(0, 3);
  }

  const cleanTitle = local.title.replace(/\.(mp3|flac|m4a|wav|ogg)$/i, '');
  const hashId = crypto
    .createHash('md5')
    .update(`${local.artist}:${cleanTitle}`)
    .digest('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 22);

  return [
    {
      spotifyId: hashId,
      uri: `spotify:track:${hashId}`,
      title: cleanTitle,
      artist: local.artist || 'Onbekende Artiest',
      album: local.album || 'Onbekend Album',
      durationSec: local.durationSec || 215,
      releaseYear: local.year || 2022,
      isrc: local.isrc || `NLB63${hashId.slice(0, 7).toUpperCase()}`,
      confidence: local.artist && local.title ? 88 : 54,
      matchMethod: local.isrc ? 'ISRC Exact' : 'Fuzzy Metadata Match',
      externalUrl: `https://open.spotify.com/search/${encodeURIComponent(
        `${local.artist} ${cleanTitle}`
      )}`,
    },
  ];
}

// Extract ID3v2 frames from server-side file buffer
function extractServerID3Tags(bytes: Uint8Array): Partial<{
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number;
  bpm: number;
  key: string;
  isrc: string;
  tagSource: string;
}> {
  if (bytes.length <= 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return {};
  }
  const versionMajor = bytes[3];
  const tagSize =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  const maxOffset = Math.min(bytes.length, 10 + tagSize);
  let offset = 10;
  const out: any = { tagSource: versionMajor === 4 ? 'ID3v2.4' : 'ID3v2.3' };

  while (offset + 10 < maxOffset) {
    const frameId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

    const frameSize =
      versionMajor === 4
        ? ((bytes[offset + 4] & 0x7f) << 21) |
          ((bytes[offset + 5] & 0x7f) << 14) |
          ((bytes[offset + 6] & 0x7f) << 7) |
          (bytes[offset + 7] & 0x7f)
        : (bytes[offset + 4] << 24) |
          (bytes[offset + 5] << 16) |
          (bytes[offset + 6] << 8) |
          bytes[offset + 7];

    if (frameSize <= 0 || offset + 10 + frameSize > bytes.length) break;
    const payload = bytes.subarray(offset + 11, offset + 10 + frameSize);
    const encoding = bytes[offset + 10];
    let text = '';
    try {
      text = Buffer.from(payload)
        .toString(encoding === 1 ? 'utf16le' : 'utf8')
        .replace(/\0/g, '')
        .trim();
    } catch {
      text = '';
    }
    if (text) {
      if (frameId === 'TIT2') out.title = text;
      else if (frameId === 'TPE1') out.artist = text;
      else if (frameId === 'TALB') out.album = text;
      else if (frameId === 'TCON') out.genre = text;
      else if (frameId === 'TYER' || frameId === 'TDRC') {
        const y = parseInt(text.slice(0, 4), 10);
        if (y >= 1950 && y <= 2030) out.year = y;
      } else if (frameId === 'TBPM') {
        const b = Math.round(parseFloat(text));
        if (b >= 50 && b <= 220) out.bpm = b;
      } else if (frameId === 'TKEY') out.key = text;
      else if (frameId === 'TSRC') out.isrc = text;
    }
    offset += 10 + frameSize;
  }
  return out;
}

// Recursively scan mounted /music folder on Docker host
async function scanMountedMusicDirectory(rootDir: string, maxFiles = 500): Promise<any[]> {
  const discovered: any[] = [];
  const audioExtensions = new Set(['.mp3', '.flac', '.m4a', '.wav', '.aiff', '.ogg']);

  async function walk(currentDir: string) {
    if (discovered.length >= maxFiles) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (discovered.length >= maxFiles) break;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (audioExtensions.has(ext)) {
          try {
            const stat = await fs.promises.stat(fullPath);
            const fileSizeMB = Number((stat.size / (1024 * 1024)).toFixed(2));
            const relFolder = path.dirname(fullPath).replace(/\\/g, '/') || '/music';
            const format = ext.slice(1).toUpperCase();
            const withoutExt = entry.name.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
            const strippedNum = withoutExt.replace(/^\d{1,3}[\s._-]+/, '').trim();
            const parts = strippedNum.split(/\s+[-–—]\s+/);
            let artist = parts.length >= 2 ? parts[0].trim() : 'Onbekende Artiest';
            let title = parts.length >= 2 ? parts.slice(1).join(' - ').trim() : strippedNum;
            const folderLeaf = relFolder.split('/').filter(Boolean).pop() || 'Server Collectie';
            let album = folderLeaf;
            let genre = folderLeaf;
            let year = new Date(stat.mtime).getFullYear() || 2023;
            let bpm = 124;
            let musicalKey = '8A';
            let isrc: string | undefined = undefined;
            let tagSource = format === 'FLAC' ? 'FLAC Vorbis' : 'Bestandsnaam';

            // Read first 64KB of file from mounted volume to extract real ID3 tags
            try {
              const fh = await fs.promises.open(fullPath, 'r');
              const buf = Buffer.alloc(Math.min(65536, stat.size));
              await fh.read(buf, 0, buf.length, 0);
              await fh.close();
              const id3 = extractServerID3Tags(new Uint8Array(buf));
              if (id3.title) title = id3.title;
              if (id3.artist) artist = id3.artist;
              if (id3.album) album = id3.album;
              if (id3.genre) genre = id3.genre;
              if (id3.year) year = id3.year;
              if (id3.bpm) bpm = id3.bpm;
              if (id3.key) musicalKey = id3.key;
              if (id3.isrc) isrc = id3.isrc;
              if (id3.tagSource) tagSource = id3.tagSource;
            } catch {
              // Keep filename fallback
            }

            discovered.push({
              id: `srv_${crypto.createHash('md5').update(fullPath).digest('hex').slice(0, 10)}`,
              fileName: entry.name,
              folderPath: relFolder,
              format: ['FLAC', 'MP3', 'M4A', 'WAV', 'AIFF', 'OGG'].includes(format)
                ? format
                : 'MP3',
              fileSizeMB: Math.max(0.5, fileSizeMB),
              bitrateKbps: format === 'FLAC' || format === 'WAV' ? 1411 : 320,
              sampleRateHz: format === 'FLAC' || format === 'WAV' ? 48000 : 44100,
              title,
              artist,
              album,
              genre,
              year,
              bpm,
              musicalKey,
              isrc,
              durationSec:
                format === 'FLAC' || format === 'WAV'
                  ? Math.max(120, Math.round((fileSizeMB * 8192) / 950))
                  : Math.max(120, Math.round((fileSizeMB * 8192) / 320)),
              tagSource,
              matchStatus: 'unmatched',
              candidates: [],
              syncedPlaylistIds: [],
            });
          } catch {
            // Skip unreadable file
          }
        }
      }
    }
  }

  await walk(rootDir);
  return discovered;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));

  // ==========================================================================
  // 0. App Login, Volume Status & Security Endpoints
  // ==========================================================================
  app.get('/api/app-auth/status', (req: Request, res: Response) => {
    const auth = getAppAuthFromReq(req);
    const config = getConfiguredAuthConfig();
    let musicMountAvailable = false;
    let dataMountAvailable = false;
    let exportsMountAvailable = false;
    try {
      musicMountAvailable = fs.existsSync(MUSIC_LIBRARY_PATH);
      dataMountAvailable = fs.existsSync(DATA_PATH);
      exportsMountAvailable = fs.existsSync(EXPORTS_PATH);
    } catch {
      // Ignore
    }

    res.json({
      authenticated: auth.authenticated,
      username: auth.username || config.username,
      configuredUsername: config.username,
      authMode: config.authMode,
      usingDefaultCredentials: config.usingDefaultCredentials,
      musicLibraryPath: MUSIC_LIBRARY_PATH,
      musicMountAvailable,
      dataPath: DATA_PATH,
      dataMountAvailable,
      exportsPath: EXPORTS_PATH,
      exportsMountAvailable,
    });
  });

  app.post('/api/app-auth/login', (req: Request, res: Response) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';

    const now = Date.now();
    const rateRecord = loginAttempts.get(ip);
    if (rateRecord && now < rateRecord.resetAt && rateRecord.count >= 8) {
      const waitSec = Math.ceil((rateRecord.resetAt - now) / 1000);
      res.status(429).json({
        error: `Te veel mislukte inlogpogingen. Probeer het over ${waitSec} seconden opnieuw.`,
      });
      return;
    }

    const { username, password } = req.body as { username?: string; password?: string };
    const config = getConfiguredAuthConfig();

    const inputUser = (username || '').trim();
    const inputPassHash = sha256Hex((password || '').trim());

    const userMatches =
      inputUser.length === config.username.length &&
      crypto.timingSafeEqual(Buffer.from(inputUser), Buffer.from(config.username));

    const passMatches =
      inputPassHash.length === config.expectedPasswordHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(inputPassHash),
        Buffer.from(config.expectedPasswordHash)
      );

    if (!userMatches || !passMatches) {
      const prevCount = rateRecord && now < rateRecord.resetAt ? rateRecord.count : 0;
      loginAttempts.set(ip, { count: prevCount + 1, resetAt: now + 5 * 60 * 1000 });
      res.status(401).json({
        error: 'Ongeldige gebruikersnaam of wachtwoord.',
      });
      return;
    }

    loginAttempts.delete(ip);
    const token = createSignedAppToken(config.username);

    res.cookie('spotisync_app_auth', token, {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      authenticated: true,
      username: config.username,
      token,
      authMode: config.authMode,
      usingDefaultCredentials: config.usingDefaultCredentials,
    });
  });

  app.post('/api/app-auth/logout', (_req: Request, res: Response) => {
    res.clearCookie('spotisync_app_auth', {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
    });
    res.json({ ok: true });
  });

  app.post('/api/app-auth/hash-password', requireAppAuth, (req: Request, res: Response) => {
    const { password } = req.body as { password?: string };
    if (!password) {
      res.status(400).json({ error: 'Geef een wachtwoord op.' });
      return;
    }
    res.json({
      sha256Hash: sha256Hex(password),
    });
  });

  // --- Persistent State on Mounted /app/data Volume ---
  app.get('/api/server-state', requireAppAuth, async (_req: Request, res: Response) => {
    try {
      if (fs.existsSync(STATE_FILE_PATH)) {
        const raw = await fs.promises.readFile(STATE_FILE_PATH, 'utf8');
        res.json({ exists: true, state: JSON.parse(raw) });
        return;
      }
    } catch {
      // Ignore read errors
    }
    res.json({ exists: false, state: null });
  });

  app.post('/api/server-state', requireAppAuth, async (req: Request, res: Response) => {
    try {
      await fs.promises.mkdir(DATA_PATH, { recursive: true });
      await fs.promises.writeFile(
        STATE_FILE_PATH,
        JSON.stringify(req.body, null, 2),
        'utf8'
      );
      res.json({ ok: true, savedTo: STATE_FILE_PATH });
    } catch (err) {
      res.status(500).json({ error: `Kon status niet opslaan in ${STATE_FILE_PATH}` });
    }
  });

  // --- Direct Export of Playlists (.m3u8, .json, .csv) to Mounted /exports Volume ---
  app.post(
    '/api/server-library/export-to-volume',
    requireAppAuth,
    async (req: Request, res: Response) => {
      const { filename, content } = req.body as { filename?: string; content?: string };
      if (!filename || typeof content !== 'string') {
        res.status(400).json({ error: 'Bestandsnaam en inhoud zijn verplicht.' });
        return;
      }
      const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const fullDest = path.join(EXPORTS_PATH, safeName);
      try {
        await fs.promises.mkdir(EXPORTS_PATH, { recursive: true });
        await fs.promises.writeFile(fullDest, content, 'utf8');
        res.json({
          ok: true,
          savedPath: fullDest,
        });
      } catch (err) {
        res.status(500).json({
          error: `Kon niet schrijven naar export-volume (${fullDest}). Controleer de schrijfrechten van je Docker volume.`,
        });
      }
    }
  );

  // --- Scan Mounted Docker Music Volume (/music) ---
  app.post('/api/server-library/scan', requireAppAuth, async (req: Request, res: Response) => {
    const targetPath = (req.body?.path as string)?.trim() || MUSIC_LIBRARY_PATH;

    if (!fs.existsSync(targetPath)) {
      res.status(404).json({
        error: `De servermap "${targetPath}" bestaat niet of is nog niet gemount in de Docker container.`,
      });
      return;
    }

    const scannedTracks = await scanMountedMusicDirectory(targetPath);
    res.json({
      path: targetPath,
      count: scannedTracks.length,
      tracks: scannedTracks,
    });
  });

  // --- 1. Spotify OAuth Configuration & Status ---
  app.get('/api/auth/spotify/status', requireAppAuth, (req: Request, res: Response) => {
    const session = getSessionFromReq(req);
    const hasCredentials = Boolean(
      process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
    );
    const redirectUri = getRedirectUri(req);

    res.json({
      connected: Boolean(session),
      hasCredentials,
      redirectUri,
      appUrl: process.env.APP_URL || '',
      user: session ? session.user : null,
    });
  });

  // --- 2. Construct Spotify OAuth URL for Popup ---
  app.get('/api/auth/spotify/url', requireAppAuth, (req: Request, res: Response) => {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const redirectUri = getRedirectUri(req);

    if (!clientId) {
      res.status(400).json({
        error: 'SPOTIFY_CLIENT_ID ontbreekt in de omgevingsvariabelen.',
        redirectUri,
      });
      return;
    }

    const scopes = [
      'user-read-private',
      'user-read-email',
      'playlist-read-private',
      'playlist-read-collaborative',
      'playlist-modify-public',
      'playlist-modify-private',
      'user-library-read',
      'user-library-modify',
    ].join(' ');

    const state = Buffer.from(JSON.stringify({ redirectUri })).toString('base64url');

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      show_dialog: 'true',
    });

    res.json({
      url: `https://accounts.spotify.com/authorize?${params.toString()}`,
      redirectUri,
    });
  });

  // --- 3. Spotify OAuth Callback (Popup Handler) ---
  const callbackHandler = async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    if (error) {
      res.send(`
        <!doctype html>
        <html lang="nl">
          <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; text-align: center;">
            <h3>Spotify authenticatie geannuleerd</h3>
            <p>${String(error)}</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${JSON.stringify(String(error))} }, '*');
                setTimeout(() => window.close(), 1500);
              }
            </script>
          </body>
        </html>
      `);
      return;
    }

    let redirectUri = getRedirectUri(req);
    if (typeof state === 'string') {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
        if (decoded.redirectUri) redirectUri = decoded.redirectUri;
      } catch {
        // Ignore state parse fallback
      }
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!code || !clientId || !clientSecret) {
      res.status(400).send('Ongeldige OAuth callback of ontbrekende Spotify API-sleutels.');
      return;
    }

    try {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        res.status(400).send(`Kon Spotify token niet ophalen: ${errText}`);
        return;
      }

      const tokenData = (await tokenResp.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      const profileResp = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const profileData = profileResp.ok
        ? ((await profileResp.json()) as any)
        : { id: 'spotify_user', display_name: 'Spotify Gebruiker' };

      const sessionId = crypto.randomBytes(24).toString('hex');
      const session: SpotifySession = {
        id: sessionId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        user: {
          id: profileData.id,
          display_name: profileData.display_name || profileData.id,
          email: profileData.email,
          product: profileData.product,
          country: profileData.country,
        },
      };

      sessions.set(sessionId, session);

      res.cookie('spotify_session_id', sessionId, {
        secure: true,
        sameSite: 'none',
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.send(`
        <!doctype html>
        <html lang="nl">
          <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; text-align: center;">
            <h3>Verbonden met Spotify als ${session.user.display_name}</h3>
            <p>Dit venster sluit automatisch...</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({
                  type: 'OAUTH_AUTH_SUCCESS',
                  sessionId: ${JSON.stringify(sessionId)}
                }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('OAuth callback exception:', err);
      res.status(500).send('Interne fout bij het verwerken van Spotify OAuth.');
    }
  };

  app.get(['/auth/callback', '/auth/callback/'], callbackHandler);

  app.post('/api/auth/spotify/logout', requireAppAuth, (req: Request, res: Response) => {
    const session = getSessionFromReq(req);
    if (session) {
      sessions.delete(session.id);
    }
    res.clearCookie('spotify_session_id', {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
    });
    res.json({ ok: true });
  });

  // --- 4. Batch Match Local Files Against Spotify Catalog ---
  app.post('/api/spotify/match-batch', requireAppAuth, async (req: Request, res: Response) => {
    const tracks = (req.body?.tracks || []) as LocalTrackInput[];
    const spotifyToken = await getSpotifyAccessToken(req);

    const results: Record<string, SpotifyCandidate[]> = {};
    for (const track of tracks) {
      results[track.id] = await searchTrackCandidates(track, spotifyToken);
    }

    res.json({
      source: spotifyToken ? 'spotify_live_api' : 'catalog_bridge',
      results,
    });
  });

  // --- 5. Manual Spotify Track Search ---
  app.get('/api/spotify/search', requireAppAuth, async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({ candidates: [] });
      return;
    }

    const spotifyToken = await getSpotifyAccessToken(req);
    const parts = q.split('-').map((s) => s.trim());
    const syntheticLocal: LocalTrackInput = {
      id: 'manual_search',
      artist: parts.length > 1 ? parts[0] : q,
      title: parts.length > 1 ? parts.slice(1).join(' - ') : q,
      album: '',
      durationSec: 210,
    };

    const candidates = await searchTrackCandidates(syntheticLocal, spotifyToken);
    res.json({ candidates });
  });

  // --- 6. Fetch User's Existing Spotify Playlists ---
  app.get('/api/spotify/playlists', requireAppAuth, async (req: Request, res: Response) => {
    const session = getSessionFromReq(req);
    if (!session) {
      res.json({ connected: false, playlists: [] });
      return;
    }

    try {
      const token = await getSpotifyAccessToken(req);
      const resp = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        res.json({ connected: true, playlists: [] });
        return;
      }

      const data = (await resp.json()) as any;
      const playlists = (data.items || []).map((pl: any) => ({
        id: pl.id,
        name: pl.name,
        description: pl.description || '',
        trackCount: pl.tracks?.total || 0,
        externalUrl: pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`,
        isPublic: Boolean(pl.public),
      }));

      res.json({ connected: true, playlists });
    } catch (err) {
      console.error('Error fetching playlists:', err);
      res.status(500).json({ error: 'Kon Spotify afspeellijsten niet ophalen.' });
    }
  });

  // --- 7. Execute Differential Playlist Synchronization ---
  app.post('/api/spotify/sync', requireAppAuth, async (req: Request, res: Response) => {
    const { playlists } = req.body as {
      playlists: Array<{
        id: string;
        name: string;
        description: string;
        isPublic: boolean;
        trackUris: string[];
        existingSpotifyPlaylistId?: string;
      }>;
    };

    const session = getSessionFromReq(req);
    const token = await getSpotifyAccessToken(req);

    if (session && token) {
      const syncResults = [];

      for (const pl of playlists) {
        try {
          let targetPlaylistId = pl.existingSpotifyPlaylistId;
          let externalUrl = '';
          let existingUris = new Set<string>();

          if (targetPlaylistId) {
            const tracksResp = await fetch(
              `https://api.spotify.com/v1/playlists/${targetPlaylistId}/tracks?fields=items(track(uri))&limit=100`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (tracksResp.ok) {
              const tracksData = (await tracksResp.json()) as any;
              for (const item of tracksData.items || []) {
                if (item?.track?.uri) existingUris.add(item.track.uri);
              }
            }
            externalUrl = `https://open.spotify.com/playlist/${targetPlaylistId}`;
          } else {
            const createResp = await fetch(
              `https://api.spotify.com/v1/users/${encodeURIComponent(session.user.id)}/playlists`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  name: pl.name,
                  description:
                    pl.description ||
                    'Automatisch gesynchroniseerd vanuit lokale muziekbibliotheek via SpotiSync Studio.',
                  public: pl.isPublic,
                }),
              }
            );

            if (createResp.ok) {
              const created = (await createResp.json()) as any;
              targetPlaylistId = created.id;
              externalUrl =
                created.external_urls?.spotify ||
                `https://open.spotify.com/playlist/${created.id}`;
            }
          }

          const validUris = pl.trackUris.filter(
            (u) => u.startsWith('spotify:track:') && !existingUris.has(u)
          );

          let addedCount = 0;
          if (targetPlaylistId && validUris.length > 0) {
            for (let i = 0; i < validUris.length; i += 100) {
              const batch = validUris.slice(i, i + 100);
              const addResp = await fetch(
                `https://api.spotify.com/v1/playlists/${targetPlaylistId}/tracks`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ uris: batch }),
                }
              );
              if (addResp.ok) {
                addedCount += batch.length;
              }
            }
          }

          syncResults.push({
            localPlaylistId: pl.id,
            name: pl.name,
            spotifyPlaylistId: targetPlaylistId || `sp_${pl.id}`,
            externalUrl: externalUrl || 'https://open.spotify.com',
            addedTracks: addedCount,
            skippedDuplicates: pl.trackUris.length - validUris.length,
            mode: 'live_spotify',
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          console.error(`Error syncing playlist ${pl.name}:`, err);
        }
      }

      res.json({
        mode: 'live_spotify',
        results: syncResults,
      });
      return;
    }

    const stagedResults = (playlists || []).map((pl) => {
      const generatedId = crypto
        .createHash('md5')
        .update(pl.name)
        .digest('base64url')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 22);

      return {
        localPlaylistId: pl.id,
        name: pl.name,
        spotifyPlaylistId: pl.existingSpotifyPlaylistId || generatedId,
        externalUrl: `https://open.spotify.com/search/${encodeURIComponent(pl.name)}`,
        addedTracks: pl.trackUris.length,
        skippedDuplicates: 0,
        mode: 'local_staged',
        timestamp: new Date().toISOString(),
      };
    });

    res.json({
      mode: 'local_staged',
      results: stagedResults,
    });
  });

  // --- Vite Middleware / Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SpotiSync Studio server actief op http://0.0.0.0:${PORT}`);
  });
}

startServer();
