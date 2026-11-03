import { AudioFormat, LocalAudioTrack } from '../types/music';

/**
 * Reads binary ID3v2 (2.3/2.4), FLAC Vorbis Comments, and ID3v1 tags directly
 * from a local File slice without loading the full audio file into memory.
 */
export async function parseLocalAudioFile(file: File): Promise<LocalAudioTrack> {
  const relativePath = (file as any).webkitRelativePath || file.name;
  const pathSegments = relativePath.split('/').filter(Boolean);
  const fileName = pathSegments[pathSegments.length - 1] || file.name;
  const folderPath =
    pathSegments.length > 1
      ? `/${pathSegments.slice(0, pathSegments.length - 1).join('/')}`
      : '/Muziek/Imports';

  const ext = (fileName.split('.').pop() || 'mp3').toUpperCase();
  const format: AudioFormat = ['FLAC', 'MP3', 'M4A', 'WAV', 'AIFF', 'OGG'].includes(ext)
    ? (ext as AudioFormat)
    : 'MP3';

  const fileSizeMB = Number((file.size / (1024 * 1024)).toFixed(2));

  // Default fallback values parsed from filename: "01 - Artist - Title (Original Mix).mp3"
  const fallback = parseFromFilenameAndFolder(fileName, folderPath);

  let title = fallback.title;
  let artist = fallback.artist;
  let album = fallback.album;
  let genre = fallback.genre;
  let year = fallback.year;
  let bpm = fallback.bpm;
  let musicalKey = fallback.musicalKey;
  let isrc: string | undefined = undefined;
  let tagSource: LocalAudioTrack['tagSource'] = 'Bestandsnaam';

  try {
    const headerSlice = file.slice(0, Math.min(file.size, 131072)); // First 128 KB
    const buffer = await headerSlice.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // 1. Check for ID3v2 header ("ID3")
    if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const versionMajor = bytes[3];
      tagSource = versionMajor === 4 ? 'ID3v2.4' : 'ID3v2.3';
      const id3Tags = parseID3v2Frames(bytes, versionMajor);
      if (id3Tags.title) title = id3Tags.title;
      if (id3Tags.artist) artist = id3Tags.artist;
      if (id3Tags.album) album = id3Tags.album;
      if (id3Tags.genre) genre = cleanGenreString(id3Tags.genre);
      if (id3Tags.year) {
        const parsedY = parseInt(id3Tags.year.slice(0, 4), 10);
        if (parsedY >= 1950 && parsedY <= 2030) year = parsedY;
      }
      if (id3Tags.bpm) {
        const parsedBpm = Math.round(parseFloat(id3Tags.bpm));
        if (parsedBpm >= 50 && parsedBpm <= 220) bpm = parsedBpm;
      }
      if (id3Tags.key) musicalKey = id3Tags.key;
      if (id3Tags.isrc) isrc = id3Tags.isrc.trim();
    }
    // 2. Check for FLAC header ("fLaC")
    else if (
      bytes.length > 8 &&
      bytes[0] === 0x66 &&
      bytes[1] === 0x4c &&
      bytes[2] === 0x61 &&
      bytes[3] === 0x43
    ) {
      tagSource = 'FLAC Vorbis';
      const vorbis = parseFlacVorbisComments(bytes);
      if (vorbis.TITLE) title = vorbis.TITLE;
      if (vorbis.ARTIST) artist = vorbis.ARTIST;
      if (vorbis.ALBUM) album = vorbis.ALBUM;
      if (vorbis.GENRE) genre = vorbis.GENRE;
      if (vorbis.DATE || vorbis.YEAR) {
        const y = parseInt((vorbis.DATE || vorbis.YEAR || '').slice(0, 4), 10);
        if (y >= 1950 && y <= 2030) year = y;
      }
      if (vorbis.BPM) {
        const b = Math.round(parseFloat(vorbis.BPM));
        if (b >= 50 && b <= 220) bpm = b;
      }
      if (vorbis.INITIALKEY || vorbis.KEY) {
        musicalKey = vorbis.INITIALKEY || vorbis.KEY;
      }
      if (vorbis.ISRC) {
        isrc = vorbis.ISRC;
      }
    }
    // 3. Check for ID3v1 at the last 128 bytes of the file if still using filename fallback
    if (tagSource === 'Bestandsnaam' && file.size > 128) {
      const tailSlice = file.slice(file.size - 128, file.size);
      const tailBuf = await tailSlice.arrayBuffer();
      const tailBytes = new Uint8Array(tailBuf);
      if (tailBytes[0] === 0x54 && tailBytes[1] === 0x41 && tailBytes[2] === 0x47) {
        const decoder = new TextDecoder('iso-8859-1');
        const tTitle = decoder.decode(tailBytes.subarray(3, 33)).replace(/\0/g, '').trim();
        const tArtist = decoder.decode(tailBytes.subarray(33, 63)).replace(/\0/g, '').trim();
        const tAlbum = decoder.decode(tailBytes.subarray(63, 93)).replace(/\0/g, '').trim();
        const tYear = decoder.decode(tailBytes.subarray(93, 97)).replace(/\0/g, '').trim();
        if (tTitle) title = tTitle;
        if (tArtist) artist = tArtist;
        if (tAlbum) album = tAlbum;
        const parsedY = parseInt(tYear, 10);
        if (parsedY >= 1950 && parsedY <= 2030) year = parsedY;
        tagSource = 'ID3v2.3';
      }
    }
  } catch {
    // Keep filename fallback on malformed binary headers
  }

  // Probe real audio duration with a fast timeout fallback
  const durationSec = await probeAudioDuration(file, format, fileSizeMB);
  const bitrateKbps =
    format === 'FLAC' || format === 'WAV' || format === 'AIFF'
      ? 1411
      : Math.min(320, Math.max(128, Math.round((fileSizeMB * 8192) / Math.max(60, durationSec))));

  return {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    fileName,
    folderPath,
    format,
    fileSizeMB: Math.max(0.5, fileSizeMB),
    bitrateKbps,
    sampleRateHz: format === 'FLAC' || format === 'WAV' ? 48000 : 44100,
    title,
    artist,
    album,
    genre,
    year,
    bpm,
    musicalKey,
    isrc,
    durationSec,
    tagSource,
    matchStatus: 'unmatched',
    candidates: [],
    syncedPlaylistIds: [],
  };
}

function parseID3v2Frames(
  bytes: Uint8Array,
  versionMajor: number
): Partial<Record<'title' | 'artist' | 'album' | 'genre' | 'year' | 'bpm' | 'key' | 'isrc', string>> {
  const result: Partial<
    Record<'title' | 'artist' | 'album' | 'genre' | 'year' | 'bpm' | 'key' | 'isrc', string>
  > = {};

  const tagSize =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);

  const maxOffset = Math.min(bytes.length, 10 + tagSize);
  let offset = 10;

  while (offset + 10 < maxOffset) {
    const frameId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );

    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

    let frameSize = 0;
    if (versionMajor === 4) {
      frameSize =
        ((bytes[offset + 4] & 0x7f) << 21) |
        ((bytes[offset + 5] & 0x7f) << 14) |
        ((bytes[offset + 6] & 0x7f) << 7) |
        (bytes[offset + 7] & 0x7f);
    } else {
      frameSize =
        (bytes[offset + 4] << 24) |
        (bytes[offset + 5] << 16) |
        (bytes[offset + 6] << 8) |
        bytes[offset + 7];
    }

    if (frameSize <= 0 || offset + 10 + frameSize > bytes.length) break;

    const content = bytes.subarray(offset + 10, offset + 10 + frameSize);
    const text = decodeID3TextFrame(content);

    if (text) {
      if (frameId === 'TIT2') result.title = text;
      else if (frameId === 'TPE1' || (!result.artist && frameId === 'TPE2')) result.artist = text;
      else if (frameId === 'TALB') result.album = text;
      else if (frameId === 'TCON') result.genre = text;
      else if (frameId === 'TYER' || frameId === 'TDRC') result.year = text;
      else if (frameId === 'TBPM') result.bpm = text;
      else if (frameId === 'TKEY') result.key = text;
      else if (frameId === 'TSRC') result.isrc = text;
    }

    offset += 10 + frameSize;
  }

  return result;
}

function decodeID3TextFrame(content: Uint8Array): string {
  if (content.length <= 1) return '';
  const encoding = content[0];
  const payload = content.subarray(1);

  try {
    let decoded = '';
    if (encoding === 0) {
      decoded = new TextDecoder('iso-8859-1').decode(payload);
    } else if (encoding === 1) {
      decoded = new TextDecoder('utf-16').decode(payload);
    } else if (encoding === 2) {
      decoded = new TextDecoder('utf-16be').decode(payload);
    } else {
      decoded = new TextDecoder('utf-8').decode(payload);
    }
    return decoded.replace(/\0/g, '').trim();
  } catch {
    return '';
  }
}

function parseFlacVorbisComments(bytes: Uint8Array): Record<string, string> {
  const comments: Record<string, string> = {};
  let offset = 4;

  while (offset + 4 < bytes.length) {
    const headerByte = bytes[offset];
    const isLast = (headerByte & 0x80) !== 0;
    const blockType = headerByte & 0x7f;
    const blockLength =
      (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];

    offset += 4;
    if (offset + blockLength > bytes.length) break;

    if (blockType === 4) {
      // VORBIS_COMMENT block
      const block = bytes.subarray(offset, offset + blockLength);
      const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
      let pos = 0;
      if (pos + 4 > block.length) break;
      const vendorLen = view.getUint32(pos, true);
      pos += 4 + vendorLen;
      if (pos + 4 > block.length) break;
      const commentListLen = view.getUint32(pos, true);
      pos += 4;

      const decoder = new TextDecoder('utf-8');
      for (let i = 0; i < commentListLen; i++) {
        if (pos + 4 > block.length) break;
        const cLen = view.getUint32(pos, true);
        pos += 4;
        if (pos + cLen > block.length) break;
        const raw = decoder.decode(block.subarray(pos, pos + cLen));
        pos += cLen;
        const eqIdx = raw.indexOf('=');
        if (eqIdx > 0) {
          const k = raw.slice(0, eqIdx).toUpperCase().trim();
          const v = raw.slice(eqIdx + 1).trim();
          comments[k] = v;
        }
      }
      break;
    }

    offset += blockLength;
    if (isLast) break;
  }

  return comments;
}

function cleanGenreString(raw: string): string {
  const cleaned = raw.replace(/^\(\d+\)/, '').trim();
  return cleaned || 'Electronic';
}

function parseFromFilenameAndFolder(fileName: string, folderPath: string) {
  const withoutExt = fileName.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
  // Strip leading track numbers like "01 - " or "04. "
  const strippedNum = withoutExt.replace(/^\d{1,3}[\s._-]+/, '').trim();
  const parts = strippedNum.split(/\s+[-–—]\s+/);

  const artist = parts.length >= 2 ? parts[0].trim() : 'Onbekende Artiest';
  const title = parts.length >= 2 ? parts.slice(1).join(' - ').trim() : strippedNum;

  const folderParts = folderPath.split('/').filter(Boolean);
  const lastFolder = folderParts[folderParts.length - 1] || 'Collectie';

  return {
    artist,
    title,
    album: lastFolder,
    genre: inferGenreFromFolder(folderPath),
    year: 2022,
    bpm: 122,
    musicalKey: '8A',
  };
}

function inferGenreFromFolder(folderPath: string): string {
  const lower = folderPath.toLowerCase();
  if (lower.includes('house') || lower.includes('club') || lower.includes('techno')) {
    return 'Melodic House & Techno';
  }
  if (lower.includes('indie') || lower.includes('rock') || lower.includes('alt')) {
    return 'Indie & Alternatief';
  }
  if (lower.includes('nl') || lower.includes('neder') || lower.includes('pop')) {
    return 'Nederpop & Klassiekers';
  }
  if (lower.includes('hip') || lower.includes('soul') || lower.includes('vinyl')) {
    return 'Hip-Hop & Neo-Soul';
  }
  if (lower.includes('ambient') || lower.includes('soundtrack') || lower.includes('focus')) {
    return 'Ambient & Neo-Classical';
  }
  return 'Electronic & Dance';
}

function probeAudioDuration(
  file: File,
  format: AudioFormat,
  fileSizeMB: number
): Promise<number> {
  return new Promise((resolve) => {
    const estimatedSec =
      format === 'FLAC' || format === 'WAV'
        ? Math.round((fileSizeMB * 8192) / 950)
        : Math.round((fileSizeMB * 8192) / 320);
    const clampedEstimate = Math.max(125, Math.min(540, estimatedSec || 215));

    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      resolve(clampedEstimate);
      return;
    }

    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;

    const finish = (val: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(val);
    };

    const timer = setTimeout(() => finish(clampedEstimate), 800);

    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      if (audio.duration && isFinite(audio.duration) && audio.duration > 1) {
        finish(Math.round(audio.duration));
      } else {
        finish(clampedEstimate);
      }
    };
    audio.onerror = () => {
      clearTimeout(timer);
      finish(clampedEstimate);
    };
    audio.src = url;
  });
}

/**
 * Parses an M3U / M3U8 playlist file (#EXTINF lines + file paths) into LocalAudioTrack entries.
 */
export function parseM3UPlaylistContent(content: string, playlistFileName: string): LocalAudioTrack[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  const tracks: LocalAudioTrack[] = [];
  const folderName = playlistFileName.replace(/\.(m3u8?|txt)$/i, '');

  let pendingDuration = 215;
  let pendingArtist = '';
  let pendingTitle = '';

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      // Format: #EXTINF:243,Artist - Title
      const afterColon = line.slice(8);
      const commaIdx = afterColon.indexOf(',');
      if (commaIdx !== -1) {
        const dur = parseInt(afterColon.slice(0, commaIdx), 10);
        if (!isNaN(dur) && dur > 0) pendingDuration = dur;
        const display = afterColon.slice(commaIdx + 1).trim();
        const parts = display.split(/\s+-\s+/);
        if (parts.length >= 2) {
          pendingArtist = parts[0].trim();
          pendingTitle = parts.slice(1).join(' - ').trim();
        } else {
          pendingTitle = display;
        }
      }
    } else if (!line.startsWith('#')) {
      const segments = line.replace(/\\/g, '/').split('/').filter(Boolean);
      const fName = segments[segments.length - 1] || line;
      const folderPath =
        segments.length > 1
          ? `/${segments.slice(0, segments.length - 1).join('/')}`
          : `/Afspeellijsten/${folderName}`;

      const fallback = parseFromFilenameAndFolder(fName, folderPath);
      const ext = (fName.split('.').pop() || 'MP3').toUpperCase();
      const format: AudioFormat = ['FLAC', 'MP3', 'M4A', 'WAV', 'AIFF', 'OGG'].includes(ext)
        ? (ext as AudioFormat)
        : 'MP3';

      tracks.push({
        id: `m3u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fileName: fName,
        folderPath,
        format,
        fileSizeMB: format === 'FLAC' ? 34.2 : 8.4,
        bitrateKbps: format === 'FLAC' ? 1411 : 320,
        sampleRateHz: 44100,
        title: pendingTitle || fallback.title,
        artist: pendingArtist || fallback.artist,
        album: folderName,
        genre: inferGenreFromFolder(folderPath),
        year: 2023,
        bpm: 124,
        musicalKey: '9A',
        durationSec: pendingDuration,
        tagSource: 'ID3v2.4',
        matchStatus: 'unmatched',
        candidates: [],
        syncedPlaylistIds: [],
      });

      pendingDuration = 215;
      pendingArtist = '';
      pendingTitle = '';
    }
  }

  return tracks;
}
