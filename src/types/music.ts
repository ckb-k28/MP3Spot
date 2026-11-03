export type AudioFormat = 'FLAC' | 'MP3' | 'M4A' | 'WAV' | 'AIFF' | 'OGG';

export type MatchStatus = 'matched' | 'review' | 'unmatched' | 'synced';

export interface SpotifyCandidate {
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

export interface LocalAudioTrack {
  id: string;
  fileName: string;
  folderPath: string;
  format: AudioFormat;
  fileSizeMB: number;
  bitrateKbps: number;
  sampleRateHz: number;
  // Extracted Audio Metadata (ID3v2 / Vorbis / M4A / Filename)
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number;
  bpm?: number;
  musicalKey?: string;
  isrc?: string;
  durationSec: number;
  tagSource: 'ID3v2.4' | 'ID3v2.3' | 'FLAC Vorbis' | 'M4A Atom' | 'Bestandsnaam' | 'Spotify ID3v2.3';
  // Spotify Matching & ID3 Tagging State
  matchStatus: MatchStatus;
  selectedMatch?: SpotifyCandidate;
  candidates: SpotifyCandidate[];
  id3TaggedFromSpotify?: boolean;
  id3TaggedAt?: string;
  lastSyncedAt?: string;
  syncedPlaylistIds: string[];
}

export type GroupingStrategy =
  | 'year'
  | 'folder'
  | 'genre'
  | 'decade'
  | 'tempo'
  | 'custom_rule';

export interface SmartRuleFilter {
  exactYear?: number;
  genreContains?: string;
  folderContains?: string;
  minBpm?: number;
  maxBpm?: number;
  minYear?: number;
  maxYear?: number;
  minConfidence: number;
  onlyLossless?: boolean;
}

export interface AutoPlaylistRule {
  id: string;
  name: string;
  description: string;
  strategy: GroupingStrategy;
  isPublic: boolean;
  autoSync: boolean;
  filter: SmartRuleFilter;
  spotifyPlaylistId?: string;
  lastSyncedAt?: string;
  syncedTrackUris: string[];
}

export interface SyncHistoryEntry {
  id: string;
  timestamp: string;
  playlistName: string;
  addedTracks: number;
  skippedDuplicates: number;
  mode: 'live_spotify' | 'local_staged';
  spotifyUrl: string;
}
