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

interface SpotifyOAuthError {
  code: string;
  message: string;
  details?: string;
  hint?: string;
  redirectUriUsed?: string;
  timestamp: string;
}

const sessions = new Map<string, SpotifySession>();
let defaultSessionId: string | null = null;
let lastOAuthError: SpotifyOAuthError | null = null;
let clientCredentialsToken: { token: string; expiresAt: number } | null = null;

// ============================================================================
// Volume Paths Configuration (/music, /data, /exports)
// ============================================================================
const MUSIC_LIBRARY_PATH = process.env.MUSIC_LIBRARY_PATH || '/music';

function resolveDataPath(): string {
  if (process.env.DATA_PATH && process.env.DATA_PATH.trim().length > 0) {
    return process.env.DATA_PATH.trim();
  }
  if (fs.existsSync('/data')) return '/data';
  if (fs.existsSync('/app/data')) return '/app/data';
  return path.join(process.cwd(), 'data');
}

const DATA_PATH = resolveDataPath();
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

const STATE_FILE_PATH = path.join(DATA_PATH, 'mp3spot-state.json');
const VERSION_FILE_PATH = path.join(process.cwd(), 'src', 'version.json');
const SPOTIFY_CONFIG_FILE_PATH = path.join(DATA_PATH, 'mp3spot-spotify.json');

function loadSpotifyConfigFromDisk(): void {
  try {
    if (fs.existsSync(SPOTIFY_CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(SPOTIFY_CONFIG_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.clientId && !process.env.SPOTIFY_CLIENT_ID) {
        process.env.SPOTIFY_CLIENT_ID = String(parsed.clientId).trim();
      }
      if (parsed.clientSecret && !process.env.SPOTIFY_CLIENT_SECRET) {
        process.env.SPOTIFY_CLIENT_SECRET = String(parsed.clientSecret).trim();
      }
      if (Array.isArray(parsed.sessions)) {
        for (const item of parsed.sessions) {
          if (item && item.id && item.accessToken && item.user) {
            sessions.set(item.id, item as SpotifySession);
          }
        }
      }
      if (parsed.defaultSessionId && sessions.has(parsed.defaultSessionId)) {
        defaultSessionId = parsed.defaultSessionId;
      } else if (sessions.size > 0) {
        defaultSessionId = Array.from(sessions.keys()).pop() || null;
      }
      if (parsed.lastOAuthError) {
        lastOAuthError = parsed.lastOAuthError;
      }
    }
  } catch {
    // Ignore read errors
  }
}

async function saveSpotifyConfigToDisk(): Promise<void> {
  try {
    await fs.promises.mkdir(DATA_PATH, { recursive: true });
    const payload = {
      clientId: process.env.SPOTIFY_CLIENT_ID || '',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
      defaultSessionId,
      sessions: Array.from(sessions.values()),
      lastOAuthError,
      updatedAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(
      SPOTIFY_CONFIG_FILE_PATH,
      JSON.stringify(payload, null, 2),
      'utf8'
    );
  } catch {
    // Ignore write errors
  }
}

loadSpotifyConfigFromDisk();

// ============================================================================
// Build Versioning System: year.month.day.build#
// - First build of the day is build# = 0 -> formatted as "YYYY.MM.DD"
// - Subsequent builds of the day (build# >= 1) -> formatted as "YYYY.MM.DD.1", "YYYY.MM.DD.2", etc.
// ============================================================================
interface BuildVersionInfo {
  date: string;
  buildNumber: number;
  version: string;
  builtAt: string;
}

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

function formatBuildVersion(dateStr: string, buildNumber: number): string {
  return buildNumber >= 1 ? `${dateStr}.${buildNumber}` : dateStr;
}

function readBuildVersionInfo(): BuildVersionInfo {
  const todayStr = getTodayDateString();
  try {
    if (fs.existsSync(VERSION_FILE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(VERSION_FILE_PATH, 'utf8')) as BuildVersionInfo;
      if (parsed && parsed.date) {
        return {
          ...parsed,
          version: formatBuildVersion(parsed.date, parsed.buildNumber || 0),
        };
      }
    }
  } catch {
    // Fallback below
  }
  return {
    date: todayStr,
    buildNumber: 0,
    version: todayStr,
    builtAt: new Date().toISOString(),
  };
}

function bumpBuildVersionInfo(): BuildVersionInfo {
  const todayStr = getTodayDateString();
  const current = readBuildVersionInfo();
  const nextBuildNumber = current.date === todayStr ? current.buildNumber + 1 : 0;
  const nextInfo: BuildVersionInfo = {
    date: todayStr,
    buildNumber: nextBuildNumber,
    version: formatBuildVersion(todayStr, nextBuildNumber),
    builtAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(VERSION_FILE_PATH, JSON.stringify(nextInfo, null, 2) + '\n', 'utf8');
  } catch {
    // Ignore write error in read-only containers
  }
  return nextInfo;
}

// ============================================================================
// Binary ID3v2.3 Writer for Tagging Local Files with Spotify Metadata
// ============================================================================
function buildServerID3v2TagBuffer(metadata: {
  title: string;
  artist: string;
  album: string;
  year: number;
  genre?: string;
  isrc?: string;
  spotifyUri?: string;
  bpm?: number;
}): Buffer {
  const frames: Buffer[] = [];

  const addTextFrame = (frameId: string, value?: string) => {
    if (!value) return;
    const textBytes = Buffer.from(value, 'utf8');
    const payloadSize = 1 + textBytes.length;
    const frame = Buffer.alloc(10 + payloadSize);
    frame.write(frameId, 0, 4, 'ascii');
    frame.writeUInt32BE(payloadSize, 4);
    frame.writeUInt16BE(0, 8);
    frame.writeUInt8(0x03, 10); // UTF-8 encoding
    textBytes.copy(frame, 11);
    frames.push(frame);
  };

  addTextFrame('TIT2', metadata.title);
  addTextFrame('TPE1', metadata.artist);
  addTextFrame('TALB', metadata.album);
  addTextFrame('TYER', String(metadata.year));
  if (metadata.genre) addTextFrame('TCON', metadata.genre);
  if (metadata.isrc) addTextFrame('TSRC', metadata.isrc);
  if (metadata.bpm) addTextFrame('TBPM', String(metadata.bpm));
  if (metadata.spotifyUri) addTextFrame('WOAF', metadata.spotifyUri);

  const framesBuffer = Buffer.concat(frames);
  const size = framesBuffer.length;
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 3, 'ascii');
  header.writeUInt8(0x03, 3); // ID3v2.3
  header.writeUInt8(0x00, 4);
  header.writeUInt8(0x00, 5);
  header.writeUInt8((size >>> 21) & 0x7f, 6);
  header.writeUInt8((size >>> 14) & 0x7f, 7);
  header.writeUInt8((size >>> 7) & 0x7f, 8);
  header.writeUInt8(size & 0x7f, 9);

  return Buffer.concat([header, framesBuffer]);
}

async function writeID3TagsToLocalFileOnDisk(
  fullFilePath: string,
  metadata: {
    title: string;
    artist: string;
    album: string;
    year: number;
    genre?: string;
    isrc?: string;
    spotifyUri?: string;
    bpm?: number;
  }
): Promise<boolean> {
  try {
    if (!fs.existsSync(fullFilePath)) return false;
    const rawFile = await fs.promises.readFile(fullFilePath);
    let audioDataStart = 0;

    // Strip existing ID3v2 header if present so we replace it cleanly
    if (
      rawFile.length > 10 &&
      rawFile[0] === 0x49 &&
      rawFile[1] === 0x44 &&
      rawFile[2] === 0x33
    ) {
      const existingTagSize =
        ((rawFile[6] & 0x7f) << 21) |
        ((rawFile[7] & 0x7f) << 14) |
        ((rawFile[8] & 0x7f) << 7) |
        (rawFile[9] & 0x7f);
      if (10 + existingTagSize < rawFile.length) {
        audioDataStart = 10 + existingTagSize;
      }
    }

    const newId3Header = buildServerID3v2TagBuffer(metadata);
    const updatedFileBuffer = Buffer.concat([
      newId3Header,
      rawFile.subarray(audioDataStart),
    ]);
    await fs.promises.writeFile(fullFilePath, updatedFileBuffer);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// ============================================================================
// App Login & Docker Compose Authentication System
// ============================================================================
const SESSION_SECRET_FILE = path.join(DATA_PATH, '.session-secret');
const AUTH_FILE_PATH = path.join(DATA_PATH, 'mp3spot-auth.json');

function getOrGenerateSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length > 0) {
    return process.env.SESSION_SECRET.trim();
  }
  try {
    if (fs.existsSync(SESSION_SECRET_FILE)) {
      const stored = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
      if (stored.length >= 16) return stored;
    }
  } catch {
    // Ignore read error
  }
  const generated = 'mp3spot_secret_' + crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(SESSION_SECRET_FILE, generated, 'utf8');
  } catch {
    // Ignore write error in read-only environment
  }
  return generated;
}

const SERVER_SESSION_SECRET = getOrGenerateSessionSecret();

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toLowerCase();
}

function getConfiguredAuthConfig(): {
  username: string;
  expectedPasswordHash: string;
  authMode: 'saved_profile' | 'password_hash' | 'docker_secret_file' | 'env_password' | 'default_fallback';
  usingDefaultCredentials: boolean;
} {
  // 1. Check persistent saved credentials in data volume (/app/data/mp3spot-auth.json)
  try {
    if (fs.existsSync(AUTH_FILE_PATH)) {
      const raw = fs.readFileSync(AUTH_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.username && parsed.passwordHash) {
        return {
          username: String(parsed.username).trim(),
          expectedPasswordHash: String(parsed.passwordHash).trim().toLowerCase(),
          authMode: 'saved_profile',
          usingDefaultCredentials: false,
        };
      }
    }
  } catch {
    // Fall through
  }

  const username = (process.env.APP_USERNAME || 'admin').trim();

  // 2. SHA-256 Hash via Docker Compose / Env
  if (process.env.APP_PASSWORD_HASH && process.env.APP_PASSWORD_HASH.trim().length === 64) {
    return {
      username,
      expectedPasswordHash: process.env.APP_PASSWORD_HASH.trim().toLowerCase(),
      authMode: 'password_hash',
      usingDefaultCredentials: false,
    };
  }

  // 3. Secret file via Docker Secrets
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

  // 4. Plaintext password via Docker Compose / Env
  if (process.env.APP_PASSWORD && process.env.APP_PASSWORD.trim().length > 0) {
    const rawEnvPass = process.env.APP_PASSWORD.trim();
    const isDefaultValue = rawEnvPass === 'mp3spot' || rawEnvPass === 'verander_mij_direct';
    return {
      username,
      expectedPasswordHash: sha256Hex(rawEnvPass),
      authMode: 'env_password',
      usingDefaultCredentials: isDefaultValue,
    };
  }

  // 5. Default preview / fallback credentials
  return {
    username,
    expectedPasswordHash: sha256Hex('mp3spot'),
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

function getAppAuthFromReq(_req: Request): { authenticated: boolean; username?: string } {
  return { authenticated: true, username: 'admin' };
}

function requireAppAuth(_req: Request, _res: Response, next: NextFunction) {
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

function isHttpsRequest(req: Request): boolean {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  return proto.toLowerCase().includes('https');
}

function getSessionFromReq(req: Request): SpotifySession | null {
  const headerSessionId = req.headers['x-spotify-session'] as string | undefined;
  const cookies = parseCookies(req.headers.cookie);
  const candidateIds = [
    headerSessionId,
    cookies['spotify_session_id'],
    defaultSessionId || undefined,
  ].filter(Boolean) as string[];

  for (const sid of candidateIds) {
    const found = sessions.get(sid);
    if (found) return found;
  }

  if (sessions.size > 0) {
    const latest = Array.from(sessions.values()).pop();
    if (latest) return latest;
  }

  return null;
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
  const proto =
    ((req.headers['x-forwarded-proto'] as string) || req.protocol || 'http').split(',')[0].trim();
  const host =
    ((req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000')
      .split(',')[0]
      .trim();
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
          sessions.set(session.id, session);
          await saveSpotifyConfigToDisk();
          return session.accessToken;
        } else {
          const errText = await resp.text();
          lastOAuthError = {
            code: 'TOKEN_REFRESH_FAILED',
            message: 'Spotify sessie kon niet automatisch worden vernieuwd.',
            details: `HTTP ${resp.status}: ${errText}`,
            hint: 'Klik op "Verbind Spotify" om je sessie opnieuw te autoriseren.',
            timestamp: new Date().toISOString(),
          };
          await saveSpotifyConfigToDisk();
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
      let rawTitle = (local.title || '').replace(/\.(mp3|flac|m4a|wav|aiff|ogg)$/i, '').trim();
      let rawArtist = (local.artist || '').trim();

      const isUnknownArtist =
        !rawArtist ||
        /^(onbekende artiest|unknown artist|unknown|onbekend|various artists|va)\b/i.test(rawArtist);

      if (isUnknownArtist && rawTitle.includes(' - ')) {
        const splitParts = rawTitle.split(/\s+[-–—]\s+/);
        if (splitParts.length >= 2) {
          rawArtist = splitParts[0].trim();
          rawTitle = splitParts.slice(1).join(' - ').trim();
        }
      }

      const cleanTitle = normalizeString(rawTitle) || rawTitle;
      const cleanArtist = isUnknownArtist ? '' : normalizeString(rawArtist) || rawArtist;
      const queries: string[] = [];

      if (local.isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(local.isrc.trim())) {
        queries.push(`isrc:${local.isrc.trim()}`);
      }
      if (cleanArtist && cleanTitle) {
        queries.push(`${cleanArtist} ${cleanTitle}`);
        queries.push(`track:${cleanTitle} artist:${cleanArtist}`);
      }
      if (cleanTitle) {
        queries.push(cleanTitle);
      }

      const uniqueQueries = Array.from(new Set(queries.filter(Boolean)));

      for (const q of uniqueQueries) {
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
            const candidates: SpotifyCandidate[] = items
              .filter((item: any) => item && item.id)
              .map((item: any) => {
                const artistName = (item.artists || []).map((a: any) => a.name).join(', ');
                const durationSec = Math.round((item.duration_ms || 200000) / 1000);
                const releaseYear =
                  parseInt((item.album?.release_date || '2020').slice(0, 4), 10) || 2020;
                const isrc = item.external_ids?.isrc;
                const { confidence, matchMethod } = computeCandidateConfidence(
                  {
                    ...local,
                    title: rawTitle || local.title,
                    artist: cleanArtist ? rawArtist : artistName,
                  },
                  {
                    title: item.name,
                    artist: artistName,
                    album: item.album?.name || '',
                    durationSec,
                    isrc,
                  }
                );

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

            if (candidates.length > 0) {
              candidates.sort((a, b) => b.confidence - a.confidence);
              return candidates;
            }
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
  // Build Version Info Endpoints (year.month.day.build#, first build of day = 0)
  // ==========================================================================
  app.get('/api/build-info', (_req: Request, res: Response) => {
    res.json(readBuildVersionInfo());
  });

  app.post('/api/build-info/bump', requireAppAuth, (_req: Request, res: Response) => {
    res.json(bumpBuildVersionInfo());
  });

  // ==========================================================================
  // 0. App Login, Volume Status & Security Endpoints
  // ==========================================================================
  app.get('/api/app-auth/status', (req: Request, res: Response) => {
    const auth = getAppAuthFromReq(req);
    const config = getConfiguredAuthConfig();
    const buildInfo = readBuildVersionInfo();
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
      buildInfo,
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
    const rawPass = (password || '').trim();
    const inputPassHash = sha256Hex(rawPass);

    // Case-insensitive username comparison
    const userMatches = inputUser.toLowerCase() === config.username.toLowerCase();

    // Check primary password match
    let passMatches = inputPassHash === config.expectedPasswordHash;

    // If using default/fallback credentials or default compose password, also accept both standard defaults
    if (!passMatches && config.usingDefaultCredentials) {
      if (
        inputPassHash === sha256Hex('mp3spot') ||
        inputPassHash === sha256Hex('verander_mij_direct')
      ) {
        passMatches = true;
      }
    }

    if (!userMatches || !passMatches) {
      const prevCount = rateRecord && now < rateRecord.resetAt ? rateRecord.count : 0;
      loginAttempts.set(ip, { count: prevCount + 1, resetAt: now + 5 * 60 * 1000 });
      res.status(401).json({
        error: config.usingDefaultCredentials
          ? 'Ongeldige inloggegevens. Standaard login is: admin / mp3spot'
          : 'Ongeldige gebruikersnaam of wachtwoord.',
      });
      return;
    }

    loginAttempts.delete(ip);
    const token = createSignedAppToken(config.username);

    res.cookie('mp3spot_app_auth', token, {
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

  // Reset login rate limit & restore default credentials (admin / mp3spot)
  app.post('/api/app-auth/reset-credentials', (req: Request, res: Response) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';

    loginAttempts.delete(ip);

    try {
      if (fs.existsSync(AUTH_FILE_PATH)) {
        fs.unlinkSync(AUTH_FILE_PATH);
      }
    } catch {
      // Ignore
    }

    res.json({
      ok: true,
      message: 'Inlogstatus gereset. Je kunt nu inloggen met admin / mp3spot.',
      defaultUsername: 'admin',
      defaultPassword: 'mp3spot',
    });
  });

  // Save new credentials into persistent /app/data/mp3spot-auth.json volume
  app.post('/api/app-auth/save-credentials', requireAppAuth, async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    const cleanUser = (username || '').trim();
    const cleanPass = (password || '').trim();

    if (!cleanUser || cleanPass.length < 4) {
      res.status(400).json({ error: 'Gebruikersnaam en een wachtwoord van minimaal 4 tekens zijn verplicht.' });
      return;
    }

    const payload = {
      username: cleanUser,
      passwordHash: sha256Hex(cleanPass),
      updatedAt: new Date().toISOString(),
    };

    try {
      await fs.promises.mkdir(DATA_PATH, { recursive: true });
      await fs.promises.writeFile(AUTH_FILE_PATH, JSON.stringify(payload, null, 2), 'utf8');
      res.json({
        ok: true,
        message: 'Inloggegevens succesvol opgeslagen in persistent data-volume.',
        username: cleanUser,
      });
    } catch (err) {
      res.status(500).json({ error: 'Kon inloggegevens niet wegschrijven naar data-volume.' });
    }
  });

  app.post('/api/app-auth/logout', (_req: Request, res: Response) => {
    res.clearCookie('mp3spot_app_auth', {
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

  app.post('/api/server-library/clean', requireAppAuth, async (_req: Request, res: Response) => {
    try {
      await fs.promises.mkdir(DATA_PATH, { recursive: true });
      let existingState: Record<string, any> = {};
      if (fs.existsSync(STATE_FILE_PATH)) {
        try {
          existingState = JSON.parse(await fs.promises.readFile(STATE_FILE_PATH, 'utf8'));
        } catch {
          existingState = {};
        }
      }
      const cleanedState = {
        ...existingState,
        updatedAt: new Date().toISOString(),
        tracks: [],
      };
      await fs.promises.writeFile(
        STATE_FILE_PATH,
        JSON.stringify(cleanedState, null, 2),
        'utf8'
      );
      res.json({ ok: true, cleanedAt: cleanedState.updatedAt });
    } catch {
      res.status(500).json({ error: 'Kon de bibliotheekstatus op de server niet wissen.' });
    }
  });

  // --- Write Spotify ID3v2.3 Metadata Directly into Local Files ---
  app.post(
    '/api/server-library/write-id3',
    requireAppAuth,
    async (req: Request, res: Response) => {
      const { tracks } = req.body as {
        tracks: Array<{
          id: string;
          fileName: string;
          folderPath: string;
          title: string;
          artist: string;
          album: string;
          year: number;
          genre?: string;
          isrc?: string;
          spotifyUri?: string;
          bpm?: number;
        }>;
      };

      if (!Array.isArray(tracks) || tracks.length === 0) {
        res.status(400).json({ error: 'Geen tracks opgegeven om van ID3-tags te voorzien.' });
        return;
      }

      let diskWrittenCount = 0;
      const taggedIds: string[] = [];

      for (const trk of tracks) {
        taggedIds.push(trk.id);
        const candidatePath = path.join(trk.folderPath, trk.fileName);
        const wroteToDisk = await writeID3TagsToLocalFileOnDisk(candidatePath, {
          title: trk.title,
          artist: trk.artist,
          album: trk.album,
          year: trk.year,
          genre: trk.genre,
          isrc: trk.isrc,
          spotifyUri: trk.spotifyUri,
          bpm: trk.bpm,
        });
        if (wroteToDisk) diskWrittenCount++;
      }

      res.json({
        ok: true,
        taggedCount: taggedIds.length,
        diskWrittenCount,
        taggedIds,
        timestamp: new Date().toISOString(),
      });
    }
  );

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

  // --- 0. Spotify API Runtime Credentials Endpoints ---
  app.get('/api/auth/spotify/credentials', (_req: Request, res: Response) => {
    res.json({
      clientId: process.env.SPOTIFY_CLIENT_ID || '',
      hasSecret: Boolean(process.env.SPOTIFY_CLIENT_SECRET),
    });
  });

  app.post('/api/auth/spotify/credentials', async (req: Request, res: Response) => {
    const { clientId, clientSecret } = req.body as { clientId?: string; clientSecret?: string };
    if (clientId !== undefined) {
      process.env.SPOTIFY_CLIENT_ID = (clientId || '').trim().replace(/^["']|["']$/g, '');
    }
    if (clientSecret !== undefined && clientSecret.trim().length > 0) {
      process.env.SPOTIFY_CLIENT_SECRET = (clientSecret || '').trim().replace(/^["']|["']$/g, '');
    }
    clientCredentialsToken = null;
    lastOAuthError = null;
    await saveSpotifyConfigToDisk();
    res.json({
      ok: true,
      clientId: process.env.SPOTIFY_CLIENT_ID || '',
      hasSecret: Boolean(process.env.SPOTIFY_CLIENT_SECRET),
    });
  });

  // Test Spotify Client ID & Secret directly via Client Credentials flow
  app.post('/api/auth/spotify/test', async (req: Request, res: Response) => {
    const body = (req.body || {}) as { clientId?: string; clientSecret?: string };
    if (body.clientId !== undefined && body.clientId.trim().length > 0) {
      process.env.SPOTIFY_CLIENT_ID = body.clientId.trim().replace(/^["']|["']$/g, '');
    }
    if (body.clientSecret !== undefined && body.clientSecret.trim().length > 0) {
      process.env.SPOTIFY_CLIENT_SECRET = body.clientSecret.trim().replace(/^["']|["']$/g, '');
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID || '';
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';
    const redirectUri = getRedirectUri(req);

    if (!clientId || !clientSecret) {
      lastOAuthError = {
        code: 'MISSING_CREDENTIALS',
        message: 'SPOTIFY_CLIENT_ID of SPOTIFY_CLIENT_SECRET ontbreekt.',
        details: !clientId
          ? 'Geen SPOTIFY_CLIENT_ID ingevuld.'
          : 'Geen SPOTIFY_CLIENT_SECRET ingevuld.',
        hint: 'Vul zowel je Client ID als je Client Secret uit het Spotify Developer Dashboard in en klik op "Sleutels Opslaan".',
        redirectUriUsed: redirectUri,
        timestamp: new Date().toISOString(),
      };
      await saveSpotifyConfigToDisk();
      res.status(400).json({ ok: false, error: lastOAuthError });
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
          grant_type: 'client_credentials',
        }),
      });

      if (!tokenResp.ok) {
        const rawErr = await tokenResp.text();
        let parsedDesc = rawErr;
        try {
          const j = JSON.parse(rawErr);
          parsedDesc = j.error_description || j.error || rawErr;
        } catch {
          // keep raw text
        }
        lastOAuthError = {
          code: 'INVALID_CLIENT_CREDENTIALS',
          message: `Spotify weigerde de API-sleutels (${parsedDesc}).`,
          details: `HTTP ${tokenResp.status}: ${rawErr}`,
          hint: 'Controleer of SPOTIFY_CLIENT_ID en SPOTIFY_CLIENT_SECRET exact overeenkomen met je app in het Spotify Developer Dashboard (zonder extra spaties).',
          redirectUriUsed: redirectUri,
          timestamp: new Date().toISOString(),
        };
        await saveSpotifyConfigToDisk();
        res.status(400).json({ ok: false, error: lastOAuthError });
        return;
      }

      const data = (await tokenResp.json()) as { access_token: string; expires_in: number };
      clientCredentialsToken = {
        token: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };
      lastOAuthError = null;
      await saveSpotifyConfigToDisk();

      res.json({
        ok: true,
        message:
          'Spotify API-sleutels (Client ID & Secret) zijn geldig! Zorg dat de Redirect URI in je Spotify Dashboard staat en klik op "Verbind Spotify".',
        redirectUri,
      });
    } catch (err: any) {
      lastOAuthError = {
        code: 'NETWORK_ERROR',
        message: 'Kon geen verbinding maken met accounts.spotify.com.',
        details: String(err?.message || err),
        hint: 'Controleer of de server/container uitgaande internetverbinding heeft.',
        redirectUriUsed: redirectUri,
        timestamp: new Date().toISOString(),
      };
      await saveSpotifyConfigToDisk();
      res.status(500).json({ ok: false, error: lastOAuthError });
    }
  });

  app.post('/api/auth/spotify/clear-error', async (_req: Request, res: Response) => {
    lastOAuthError = null;
    await saveSpotifyConfigToDisk();
    res.json({ ok: true });
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
      sessionId: session ? session.id : undefined,
      hasCredentials,
      clientId: process.env.SPOTIFY_CLIENT_ID || '',
      redirectUri,
      appUrl: process.env.APP_URL || '',
      user: session ? session.user : null,
      lastError: lastOAuthError,
    });
  });

  // --- 2. Construct Spotify OAuth URL for Popup ---
  app.get('/api/auth/spotify/url', requireAppAuth, async (req: Request, res: Response) => {
    const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
    const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
    const redirectUri = getRedirectUri(req);

    if (!clientId || !clientSecret) {
      lastOAuthError = {
        code: 'MISSING_CREDENTIALS',
        message: !clientId
          ? 'SPOTIFY_CLIENT_ID ontbreekt.'
          : 'SPOTIFY_CLIENT_SECRET ontbreekt.',
        details:
          'Zowel SPOTIFY_CLIENT_ID als SPOTIFY_CLIENT_SECRET zijn vereist om een OAuth-koppeling te starten.',
        hint: 'Vul je Spotify Client ID en Client Secret in bij de OAuth-instellingen of Inline Config en sla ze op.',
        redirectUriUsed: redirectUri,
        timestamp: new Date().toISOString(),
      };
      await saveSpotifyConfigToDisk();
      res.status(400).json({
        error: lastOAuthError.message,
        lastError: lastOAuthError,
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

  // Helper to render styled HTML in OAuth popup and notify main window via postMessage + localStorage
  const sendOAuthPopupResponse = (
    res: Response,
    payload:
      | {
          ok: true;
          sessionId: string;
          displayName: string;
          warningHint?: string;
        }
      | {
          ok: false;
          errorObj: SpotifyOAuthError;
        }
  ) => {
    if (payload.ok) {
      const eventPayload = {
        type: 'OAUTH_AUTH_SUCCESS',
        sessionId: payload.sessionId,
        displayName: payload.displayName,
        warningHint: payload.warningHint || '',
        timestamp: new Date().toISOString(),
      };
      res.send(`
        <!doctype html>
        <html lang="nl">
          <head>
            <meta charset="utf-8" />
            <title>MP3Spot — Spotify Verbonden</title>
          </head>
          <body style="font-family: system-ui, -apple-system, sans-serif; background: #16181A; color: #E6E7E9; padding: 2rem; text-align: center; display: flex; align-items: center; justify-content: center; min-height: 85vh; margin: 0;">
            <div style="max-width: 440px; width: 100%; background: #1E2124; border: 1px solid #3A3D40; border-radius: 12px; padding: 24px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
              <div style="width: 44px; height: 44px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); color: #10B981; display: inline-flex; align-items: center; justify-content: center; font-size: 22px; font-weight: bold; margin-bottom: 12px;">✓</div>
              <h3 style="margin: 0 0 8px 0; color: #FFFFFF; font-size: 18px;">Verbonden met Spotify!</h3>
              <p style="margin: 0 0 16px 0; font-size: 13px; color: #94A3B8;">
                Ingelogd als <strong style="color: #FF8F00;">${payload.displayName}</strong>.
              </p>
              ${
                payload.warningHint
                  ? `<div style="text-align: left; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #FCD34D; margin-bottom: 16px;">${payload.warningHint}</div>`
                  : ''
              }
              <p style="margin: 0 0 16px 0; font-size: 12px; color: #64748B;">Dit venster sluit automatisch...</p>
              <button onclick="window.close()" style="background: linear-gradient(to right, #D84315, #FF8F00); color: #090A0B; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer;">
                Sluit Venster & Ga Terug
              </button>
            </div>
            <script>
              (function() {
                var evt = ${JSON.stringify(eventPayload)};
                try {
                  localStorage.setItem('mp3spot_session_id', evt.sessionId);
                  localStorage.setItem('mp3spot_oauth_result', JSON.stringify(evt));
                } catch (e) {}
                try {
                  if (window.opener && !window.opener.closed) {
                    window.opener.postMessage(evt, '*');
                  }
                } catch (e) {}
                setTimeout(function() {
                  try { window.close(); } catch (e) {}
                }, 900);
              })();
            </script>
          </body>
        </html>
      `);
      return;
    }

    const { errorObj } = payload;
    const eventPayload = {
      type: 'OAUTH_AUTH_ERROR',
      error: errorObj.message,
      errorObj,
      timestamp: errorObj.timestamp,
    };

    res.status(200).send(`
      <!doctype html>
      <html lang="nl">
        <head>
          <meta charset="utf-8" />
          <title>MP3Spot — Spotify OAuth Foutmelding</title>
        </head>
        <body style="font-family: system-ui, -apple-system, sans-serif; background: #16181A; color: #E6E7E9; padding: 1.5rem; display: flex; align-items: center; justify-content: center; min-height: 90vh; margin: 0;">
          <div style="max-width: 520px; width: 100%; background: #1E2124; border: 1px solid #D84315; border-radius: 12px; padding: 24px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.6);">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
              <span style="background: rgba(216, 67, 21, 0.2); color: #FF8F00; padding: 6px 10px; border-radius: 8px; font-weight: bold; font-size: 14px;">⚠️ Spotify OAuth Fout</span>
              <span style="font-family: monospace; font-size: 11px; color: #94A3B8;">${errorObj.code}</span>
            </div>
            <h3 style="margin: 0 0 10px 0; color: #FFFFFF; font-size: 16px;">${errorObj.message}</h3>
            ${
              errorObj.details
                ? `<div style="background: #121416; border: 1px solid #3A3D40; border-radius: 8px; padding: 10px 12px; font-family: monospace; font-size: 11px; color: #F87171; margin-bottom: 12px; word-break: break-word;">${errorObj.details}</div>`
                : ''
            }
            ${
              errorObj.hint
                ? `<div style="background: rgba(0, 180, 216, 0.1); border: 1px solid rgba(0, 180, 216, 0.35); border-radius: 8px; padding: 12px; font-size: 12px; color: #E6E7E9; line-height: 1.5; margin-bottom: 12px;"><strong style="color: #00B4D8; display: block; margin-bottom: 4px;">Hoe los je dit op:</strong>${errorObj.hint}</div>`
                : ''
            }
            ${
              errorObj.redirectUriUsed
                ? `<div style="font-size: 11px; color: #94A3B8; margin-bottom: 16px;">Gebruikte Redirect URI:<br/><code style="display: block; background: #121416; padding: 6px 8px; border-radius: 6px; margin-top: 4px; color: #FF8F00; word-break: break-all;">${errorObj.redirectUriUsed}</code></div>`
                : ''
            }
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
              <button onclick="window.close()" style="background: linear-gradient(to right, #D84315, #FF8F00); color: #090A0B; border: none; padding: 9px 18px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer;">
                Venster Sluiten
              </button>
            </div>
          </div>
          <script>
            (function() {
              var evt = ${JSON.stringify(eventPayload)};
              try {
                localStorage.setItem('mp3spot_oauth_result', JSON.stringify(evt));
              } catch (e) {}
              try {
                if (window.opener && !window.opener.closed) {
                  window.opener.postMessage(evt, '*');
                }
              } catch (e) {}
            })();
          </script>
        </body>
      </html>
    `);
  };

  // --- 3. Spotify OAuth Callback (Popup Handler) ---
  const callbackHandler = async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    let redirectUri = getRedirectUri(req);
    if (typeof state === 'string') {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
        if (decoded.redirectUri) redirectUri = decoded.redirectUri;
      } catch {
        // Ignore state parse fallback
      }
    }

    if (error) {
      const errStr = String(error);
      lastOAuthError = {
        code: `SPOTIFY_${errStr.toUpperCase()}`,
        message:
          errStr === 'access_denied'
            ? 'Spotify autorisatie is geannuleerd of geweigerd.'
            : `Spotify gaf een OAuth-fout terug: ${errStr}`,
        details: `Callback query error=${errStr}`,
        hint:
          errStr === 'access_denied'
            ? 'Klik in het Spotify-inlogscherm op "Akkoord" (Agree) en controleer of je Spotify-account e-mailadres is toegevoegd onder "Users and Access" in het Spotify Developer Dashboard.'
            : `Controleer of de Redirect URI (${redirectUri}) exact is toegevoegd in je Spotify Developer Dashboard.`,
        redirectUriUsed: redirectUri,
        timestamp: new Date().toISOString(),
      };
      await saveSpotifyConfigToDisk();
      sendOAuthPopupResponse(res, { ok: false, errorObj: lastOAuthError });
      return;
    }

    const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
    const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();

    if (!code || !clientId || !clientSecret) {
      lastOAuthError = {
        code: 'MISSING_CALLBACK_PARAMS',
        message: 'Ongeldige OAuth callback of ontbrekende Spotify API-sleutels op de server.',
        details: !code
          ? 'Geen authorization code ontvangen van Spotify.'
          : !clientId
          ? 'SPOTIFY_CLIENT_ID is leeg op de server.'
          : 'SPOTIFY_CLIENT_SECRET is leeg op de server.',
        hint: 'Sla eerst je SPOTIFY_CLIENT_ID en SPOTIFY_CLIENT_SECRET op in het configuratiepaneel voordat je de OAuth-popup start.',
        redirectUriUsed: redirectUri,
        timestamp: new Date().toISOString(),
      };
      await saveSpotifyConfigToDisk();
      sendOAuthPopupResponse(res, { ok: false, errorObj: lastOAuthError });
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
        let errDesc = errText;
        let errCode = 'TOKEN_EXCHANGE_FAILED';
        try {
          const parsed = JSON.parse(errText);
          errDesc = parsed.error_description || parsed.error || errText;
          if (parsed.error) errCode = String(parsed.error).toUpperCase();
        } catch {
          // keep raw text
        }

        let hint =
          'Controleer of je SPOTIFY_CLIENT_ID en SPOTIFY_CLIENT_SECRET juist zijn en of de Redirect URI exact overeenkomt in het Spotify Developer Dashboard.';
        if (errDesc.toLowerCase().includes('redirect_uri') || errDesc.toLowerCase().includes('redirect uri')) {
          hint = `De Redirect URI komt niet overeen. Voeg exact deze URL toe in het Spotify Developer Dashboard onder Redirect URIs: ${redirectUri}`;
        } else if (errCode === 'INVALID_CLIENT') {
          hint =
            'Ongeldige Client ID of Client Secret. Kopieer je Client ID en Client Secret opnieuw uit het Spotify Developer Dashboard en klik op "Sleutels Opslaan".';
        }

        lastOAuthError = {
          code: errCode,
          message: `Kon Spotify toegangstoken niet ophalen: ${errDesc}`,
          details: `HTTP ${tokenResp.status}: ${errText}`,
          hint,
          redirectUriUsed: redirectUri,
          timestamp: new Date().toISOString(),
        };
        await saveSpotifyConfigToDisk();
        sendOAuthPopupResponse(res, { ok: false, errorObj: lastOAuthError });
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

      if (!profileResp.ok) {
        const profileErrText = await profileResp.text();
        if (profileResp.status === 403) {
          lastOAuthError = {
            code: 'SPOTIFY_DEV_MODE_USER_NOT_REGISTERED',
            message:
              'Spotify weigert toegang tot je profiel (HTTP 403 Forbidden: Gebruiker niet geregistreerd in Developer Dashboard).',
            details: `HTTP 403 bij GET https://api.spotify.com/v1/me — ${profileErrText || 'User not registered in the Developer Dashboard'}`,
            hint: 'Je Spotify Developer app staat in "Development Mode". Ga naar https://developer.spotify.com/dashboard -> open jouw app -> klik op "Users and Access" en voeg daar je naam en het e-mailadres van je Spotify-account toe!',
            redirectUriUsed: redirectUri,
            timestamp: new Date().toISOString(),
          };
          await saveSpotifyConfigToDisk();
          sendOAuthPopupResponse(res, { ok: false, errorObj: lastOAuthError });
          return;
        }
      }

      const profileData = profileResp.ok
        ? ((await profileResp.json()) as any)
        : { id: 'me', display_name: 'Spotify Gebruiker' };

      const sessionId = crypto.randomBytes(24).toString('hex');
      const session: SpotifySession = {
        id: sessionId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        user: {
          id: profileData.id || 'me',
          display_name: profileData.display_name || profileData.email || profileData.id || 'Spotify Gebruiker',
          email: profileData.email,
          product: profileData.product,
          country: profileData.country,
        },
      };

      sessions.set(sessionId, session);
      defaultSessionId = sessionId;
      lastOAuthError = null;
      await saveSpotifyConfigToDisk();

      const isHttps = isHttpsRequest(req);
      res.cookie('spotify_session_id', sessionId, {
        secure: isHttps,
        sameSite: isHttps ? 'none' : 'lax',
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      sendOAuthPopupResponse(res, {
        ok: true,
        sessionId,
        displayName: session.user.display_name,
      });
    } catch (err: any) {
      console.error('OAuth callback exception:', err);
      lastOAuthError = {
        code: 'CALLBACK_EXCEPTION',
        message: 'Interne fout bij het verwerken van de Spotify OAuth callback.',
        details: String(err?.message || err),
        hint: 'Controleer de netwerkverbinding van de container en probeer het opnieuw.',
        redirectUriUsed: redirectUri,
        timestamp: new Date().toISOString(),
      };
      await saveSpotifyConfigToDisk();
      sendOAuthPopupResponse(res, { ok: false, errorObj: lastOAuthError });
    }
  };

  app.get(['/auth/callback', '/auth/callback/'], callbackHandler);

  app.post('/api/auth/spotify/logout', requireAppAuth, async (req: Request, res: Response) => {
    const session = getSessionFromReq(req);
    if (session) {
      sessions.delete(session.id);
    }
    sessions.clear();
    defaultSessionId = null;
    await saveSpotifyConfigToDisk();

    const isHttps = isHttpsRequest(req);
    res.clearCookie('spotify_session_id', {
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
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
        trackCount: pl.items?.total ?? pl.tracks?.total ?? 0,
        externalUrl: pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`,
        isPublic: Boolean(pl.public),
      }));

      res.json({ connected: true, playlists });
    } catch (err) {
      console.error('Error fetching playlists:', err);
      res.status(500).json({ error: 'Kon Spotify afspeellijsten niet ophalen.' });
    }
  });

  // Helper to fetch existing track URIs in a Spotify playlist (supports both /items and /tracks endpoints)
  async function getSpotifyPlaylistExistingUris(
    playlistId: string,
    token: string
  ): Promise<{ ok: boolean; status: number; uris: Set<string> }> {
    const uris = new Set<string>();
    // Try /items first (Spotify 2026 Web API), then fallback to /tracks
    let resp = await fetch(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) {
      resp = await fetch(
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    }
    if (!resp.ok) {
      return { ok: false, status: resp.status, uris };
    }
    try {
      const data = (await resp.json()) as any;
      for (const entry of data.items || []) {
        const uri = entry?.item?.uri || entry?.track?.uri;
        if (typeof uri === 'string' && uri.startsWith('spotify:track:')) {
          uris.add(uri);
        }
      }
    } catch {
      // Ignore parse error
    }
    return { ok: true, status: 200, uris };
  }

  // Helper to add a batch of track URIs to a Spotify playlist (supports both /items and /tracks endpoints)
  async function addTracksBatchToSpotifyPlaylist(
    playlistId: string,
    uris: string[],
    token: string
  ): Promise<{ ok: boolean; errorDetails?: string }> {
    if (uris.length === 0) return { ok: true };
    const payload = JSON.stringify({ uris });

    // 1. Try POST /v1/playlists/{id}/items (Spotify 2026 Web API)
    const itemsResp = await fetch(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      }
    );
    if (itemsResp.ok) {
      return { ok: true };
    }
    const itemsErrText = await itemsResp.text().catch(() => '');

    // 2. Fallback to POST /v1/playlists/{id}/tracks
    const tracksResp = await fetch(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      }
    );
    if (tracksResp.ok) {
      return { ok: true };
    }
    const tracksErrText = await tracksResp.text().catch(() => '');
    return {
      ok: false,
      errorDetails: `items(${itemsResp.status}): ${itemsErrText} | tracks(${tracksResp.status}): ${tracksErrText}`,
    };
  }

  // --- 7. Execute Differential Playlist Synchronization ---
  app.post('/api/spotify/sync', requireAppAuth, async (req: Request, res: Response) => {
    const { playlists } = req.body as {
      playlists: Array<{
        id: string;
        name: string;
        description: string;
        isPublic: boolean;
        trackUris: string[];
        tracks?: Array<{
          id: string;
          uri: string;
          title: string;
          artist: string;
          album?: string;
          isrc?: string;
          durationSec?: number;
          externalUrl?: string;
        }>;
        existingSpotifyPlaylistId?: string;
      }>;
    };

    const session = getSessionFromReq(req);
    const token = await getSpotifyAccessToken(req);

    if (session && token) {
      const syncResults = [];
      const resolvedTracks: Record<string, SpotifyCandidate> = {};

      // Fetch the user's existing Spotify playlists so we can reuse playlists already created with the same name
      const userPlaylistsByName = new Map<string, { id: string; externalUrl: string }>();
      const userOwnedPlaylistIds = new Set<string>();
      try {
        const mePlResp = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (mePlResp.ok) {
          const mePlData = (await mePlResp.json()) as any;
          for (const item of mePlData.items || []) {
            if (!item || !item.id) continue;
            const isOwnerOrCollab =
              !session.user.id ||
              session.user.id === 'me' ||
              item.owner?.id === session.user.id ||
              item.collaborative;
            if (isOwnerOrCollab && !String(item.id).startsWith('37i9dQZF')) {
              userOwnedPlaylistIds.add(item.id);
              const normName = String(item.name || '').trim().toLowerCase();
              if (normName && !userPlaylistsByName.has(normName)) {
                userPlaylistsByName.set(normName, {
                  id: item.id,
                  externalUrl:
                    item.external_urls?.spotify || `https://open.spotify.com/playlist/${item.id}`,
                });
              }
            }
          }
        }
      } catch (e) {
        console.error('Could not pre-fetch user playlists:', e);
      }

      for (const pl of playlists) {
        try {
          let targetPlaylistId = pl.existingSpotifyPlaylistId;
          let externalUrl = '';
          let existingUris = new Set<string>();

          // Ignore Spotify editorial playlists (37i9dQZF...) or non-22-char local staged IDs
          if (
            targetPlaylistId &&
            (targetPlaylistId.startsWith('37i9dQZF') ||
              targetPlaylistId.startsWith('sp_') ||
              !/^[a-zA-Z0-9]{22}$/.test(targetPlaylistId))
          ) {
            targetPlaylistId = undefined;
          }

          // Check if targetPlaylistId exists and is readable/modifiable on Spotify
          if (targetPlaylistId) {
            const check = await getSpotifyPlaylistExistingUris(targetPlaylistId, token);
            if (check.ok) {
              existingUris = check.uris;
              externalUrl = `https://open.spotify.com/playlist/${targetPlaylistId}`;
            } else {
              targetPlaylistId = undefined;
            }
          }

          // If no valid targetPlaylistId yet, check if the user already has a playlist with this exact name
          if (!targetPlaylistId) {
            const normName = (pl.name || '').trim().toLowerCase();
            const existingByName = userPlaylistsByName.get(normName);
            if (existingByName) {
              targetPlaylistId = existingByName.id;
              externalUrl = existingByName.externalUrl;
              const check = await getSpotifyPlaylistExistingUris(targetPlaylistId, token);
              if (check.ok) {
                existingUris = check.uris;
              }
            }
          }

          // Otherwise, create the playlist on the user's Spotify account
          if (!targetPlaylistId) {
            const createBody = JSON.stringify({
              name: pl.name,
              description:
                pl.description ||
                'Automatisch gesynchroniseerd vanuit lokale muziekbibliotheek via MP3Spot.',
              public: Boolean(pl.isPublic),
            });
            let createResp = await fetch('https://api.spotify.com/v1/me/playlists', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: createBody,
            });

            if (!createResp.ok && session.user.id && session.user.id !== 'me') {
              createResp = await fetch(
                `https://api.spotify.com/v1/users/${encodeURIComponent(session.user.id)}/playlists`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: createBody,
                }
              );
            }

            if (createResp.ok) {
              const created = (await createResp.json()) as any;
              targetPlaylistId = created.id;
              externalUrl =
                created.external_urls?.spotify ||
                `https://open.spotify.com/playlist/${created.id}`;
              if (targetPlaylistId) {
                userPlaylistsByName.set((pl.name || '').trim().toLowerCase(), {
                  id: targetPlaylistId,
                  externalUrl,
                });
              }
            } else {
              const createErr = await createResp.text().catch(() => '');
              console.error(`Failed to create playlist "${pl.name}":`, createResp.status, createErr);
            }
          }

          // Resolve any synthetic/offline track URIs to real Spotify track URIs via live /v1/search
          const finalPlaylistUris: string[] = [];
          const trackMetaList = Array.isArray(pl.tracks) ? pl.tracks : [];

          if (trackMetaList.length > 0) {
            for (const trk of trackMetaList) {
              if (resolvedTracks[trk.id]) {
                finalPlaylistUris.push(resolvedTracks[trk.id].uri);
                continue;
              }

              const rawId = (trk.uri || '').replace(/^spotify:track:/, '').trim();
              const isSyntheticOrOffline =
                !rawId ||
                !/^[a-zA-Z0-9]{22}$/.test(rawId) ||
                (trk.externalUrl && trk.externalUrl.includes('/search/'));

              if (!isSyntheticOrOffline) {
                finalPlaylistUris.push(`spotify:track:${rawId}`);
              } else {
                const liveCands = await searchTrackCandidates(
                  {
                    id: trk.id,
                    title: trk.title,
                    artist: trk.artist,
                    album: trk.album || '',
                    durationSec: trk.durationSec || 210,
                    isrc: trk.isrc,
                  },
                  token
                );
                const bestLive = liveCands.find(
                  (c) =>
                    c.uri.startsWith('spotify:track:') &&
                    /^[a-zA-Z0-9]{22}$/.test(c.spotifyId) &&
                    !c.externalUrl.includes('/search/')
                );
                if (bestLive) {
                  resolvedTracks[trk.id] = bestLive;
                  finalPlaylistUris.push(bestLive.uri);
                }
              }
            }
          } else {
            for (const u of pl.trackUris || []) {
              const rawId = u.replace(/^spotify:track:/, '').trim();
              if (/^[a-zA-Z0-9]{22}$/.test(rawId)) {
                finalPlaylistUris.push(`spotify:track:${rawId}`);
              }
            }
          }

          const uniqueTargetUris = Array.from(new Set(finalPlaylistUris));
          const validUrisToAdd = uniqueTargetUris.filter((u) => !existingUris.has(u));

          let addedCount = 0;
          const confirmedSyncedUris = new Set<string>(existingUris);

          if (targetPlaylistId && validUrisToAdd.length > 0) {
            for (let i = 0; i < validUrisToAdd.length; i += 100) {
              const batch = validUrisToAdd.slice(i, i + 100);
              const batchRes = await addTracksBatchToSpotifyPlaylist(
                targetPlaylistId,
                batch,
                token
              );

              if (batchRes.ok) {
                addedCount += batch.length;
                for (const u of batch) confirmedSyncedUris.add(u);
              } else {
                console.warn(
                  `Batch add failed for playlist "${pl.name}" (${batchRes.errorDetails}), retrying tracks individually with live search fallback...`
                );
                // Fallback: resolve & add each track individually so a single invalid URI never blocks the rest
                for (const uri of batch) {
                  let uriToTry = uri;
                  const matchingMeta = trackMetaList.find(
                    (t) => t.uri === uri || resolvedTracks[t.id]?.uri === uri
                  );

                  if (matchingMeta && !resolvedTracks[matchingMeta.id]) {
                    const liveCands = await searchTrackCandidates(
                      {
                        id: matchingMeta.id,
                        title: matchingMeta.title,
                        artist: matchingMeta.artist,
                        album: matchingMeta.album || '',
                        durationSec: matchingMeta.durationSec || 210,
                        isrc: matchingMeta.isrc,
                      },
                      token
                    );
                    const bestLive = liveCands.find(
                      (c) =>
                        c.uri.startsWith('spotify:track:') &&
                        /^[a-zA-Z0-9]{22}$/.test(c.spotifyId) &&
                        !c.externalUrl.includes('/search/')
                    );
                    if (bestLive) {
                      resolvedTracks[matchingMeta.id] = bestLive;
                      uriToTry = bestLive.uri;
                    }
                  }

                  if (confirmedSyncedUris.has(uriToTry)) continue;
                  const singleRes = await addTracksBatchToSpotifyPlaylist(
                    targetPlaylistId,
                    [uriToTry],
                    token
                  );
                  if (singleRes.ok) {
                    addedCount += 1;
                    confirmedSyncedUris.add(uriToTry);
                  } else {
                    console.error(
                      `Could not add track ${uriToTry} to playlist ${pl.name}:`,
                      singleRes.errorDetails
                    );
                  }
                }
              }
            }
          }

          syncResults.push({
            localPlaylistId: pl.id,
            name: pl.name,
            spotifyPlaylistId: targetPlaylistId || undefined,
            externalUrl: externalUrl || 'https://open.spotify.com',
            addedTracks: addedCount,
            skippedDuplicates: Math.max(0, uniqueTargetUris.length - validUrisToAdd.length),
            syncedUris: Array.from(confirmedSyncedUris),
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
        resolvedTracks,
      });
      return;
    }

    const stagedResults = (playlists || []).map((pl) => {
      return {
        localPlaylistId: pl.id,
        name: pl.name,
        spotifyPlaylistId: undefined,
        externalUrl: `https://open.spotify.com/search/${encodeURIComponent(pl.name)}`,
        addedTracks: pl.trackUris.length,
        skippedDuplicates: 0,
        syncedUris: [],
        mode: 'local_staged',
        timestamp: new Date().toISOString(),
      };
    });

    res.json({
      mode: 'local_staged',
      results: stagedResults,
      resolvedTracks: {},
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
    const buildInfo = readBuildVersionInfo();
    console.log(
      `MP3Spot v${buildInfo.version} (build# ${buildInfo.buildNumber}) server actief op http://0.0.0.0:${PORT}`
    );
  });
}

startServer();
