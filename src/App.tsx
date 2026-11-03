import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FolderOpen,
  Upload,
  Search,
  RefreshCw,
  Check,
  AlertTriangle,
  ExternalLink,
  Plus,
  Trash2,
  Sliders,
  Download,
  Music,
  Disc,
  ArrowRight,
  ChevronRight,
  Sun,
  Moon,
  Copy,
  KeyRound,
  Edit3,
  X,
  ListMusic,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import {
  AutoPlaylistRule,
  LocalAudioTrack,
  MatchStatus,
  SpotifyCandidate,
  SyncHistoryEntry,
} from './types/music';
import {
  INITIAL_LOCAL_LIBRARY,
  INITIAL_PLAYLIST_RULES,
  INITIAL_SYNC_HISTORY,
} from './data/sampleLibrary';
import {
  parseLocalAudioFile,
  parseM3UPlaylistContent,
} from './utils/audioMetadataParser';

type ActiveTab = 'library' | 'matcher' | 'playlists' | 'sync';

interface SpotifyAuthStatus {
  connected: boolean;
  hasCredentials: boolean;
  redirectUri: string;
  appUrl: string;
  user: {
    id: string;
    display_name: string;
    email?: string;
    product?: string;
    country?: string;
  } | null;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function doesTrackMatchRule(track: LocalAudioTrack, rule: AutoPlaylistRule): boolean {
  const { filter } = rule;
  if (
    filter.genreContains &&
    !track.genre.toLowerCase().includes(filter.genreContains.toLowerCase())
  ) {
    return false;
  }
  if (
    filter.folderContains &&
    !track.folderPath.toLowerCase().includes(filter.folderContains.toLowerCase())
  ) {
    return false;
  }
  if (filter.minBpm !== undefined && (track.bpm || 0) < filter.minBpm) {
    return false;
  }
  if (filter.maxBpm !== undefined && (track.bpm || 999) > filter.maxBpm) {
    return false;
  }
  if (filter.minYear !== undefined && track.year < filter.minYear) {
    return false;
  }
  if (filter.maxYear !== undefined && track.year > filter.maxYear) {
    return false;
  }
  if (filter.onlyLossless && track.format !== 'FLAC' && track.format !== 'WAV' && track.format !== 'AIFF') {
    return false;
  }
  return true;
}

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('library');

  // Core Library, Playlist Rules & Sync History State
  const [tracks, setTracks] = useState<LocalAudioTrack[]>(() => {
    try {
      const saved = localStorage.getItem('spotisync_tracks_v1');
      return saved ? JSON.parse(saved) : INITIAL_LOCAL_LIBRARY;
    } catch {
      return INITIAL_LOCAL_LIBRARY;
    }
  });

  const [playlistRules, setPlaylistRules] = useState<AutoPlaylistRule[]>(() => {
    try {
      const saved = localStorage.getItem('spotisync_rules_v1');
      return saved ? JSON.parse(saved) : INITIAL_PLAYLIST_RULES;
    } catch {
      return INITIAL_PLAYLIST_RULES;
    }
  });

  const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('spotisync_history_v1');
      return saved ? JSON.parse(saved) : INITIAL_SYNC_HISTORY;
    } catch {
      return INITIAL_SYNC_HISTORY;
    }
  });

  // Filters & Selection
  const [selectedFolder, setSelectedFolder] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MatchStatus>('ALL');
  const [formatFilter, setFormatFilter] = useState<string>('ALL');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>(
    INITIAL_PLAYLIST_RULES[0]?.id || ''
  );

  // Scanning, Matching & Syncing States
  const [isScanningFiles, setIsScanningFiles] = useState<boolean>(false);
  const [scanProgressText, setScanProgressText] = useState<string>('');
  const [isBatchMatching, setIsBatchMatching] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [noticeBanner, setNoticeBanner] = useState<{
    type: 'success' | 'info' | 'warning';
    message: string;
  } | null>(null);

  // Track Metadata Editor & Manual Spotify Search State
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<LocalAudioTrack>>({});
  const [manualSearchTrackId, setManualSearchTrackId] = useState<string | null>(null);
  const [manualSearchQuery, setManualSearchQuery] = useState<string>('');
  const [manualSearchResults, setManualSearchResults] = useState<SpotifyCandidate[]>([]);
  const [isSearchingManual, setIsSearchingManual] = useState<boolean>(false);

  // New Smart Playlist Rule Modal State
  const [showNewRuleForm, setShowNewRuleForm] = useState<boolean>(false);
  const [newRuleDraft, setNewRuleDraft] = useState<{
    name: string;
    description: string;
    genreContains: string;
    folderContains: string;
    minBpm: string;
    maxBpm: string;
    minYear: string;
    maxYear: string;
    minConfidence: number;
    onlyLossless: boolean;
    isPublic: boolean;
  }>({
    name: '',
    description: '',
    genreContains: '',
    folderContains: '',
    minBpm: '',
    maxBpm: '',
    minYear: '',
    maxYear: '',
    minConfidence: 80,
    onlyLossless: false,
    isPublic: false,
  });

  // Spotify OAuth Status & Setup Modal
  const [spotifyAuth, setSpotifyAuth] = useState<SpotifyAuthStatus>({
    connected: false,
    hasCredentials: false,
    redirectUri: `${window.location.origin}/auth/callback`,
    appUrl: window.location.origin,
    user: null,
  });
  const [sessionIdToken, setSessionIdToken] = useState<string>(() => {
    return localStorage.getItem('spotisync_session_id') || '';
  });
  const [showOAuthModal, setShowOAuthModal] = useState<boolean>(false);
  const [copiedUrlKey, setCopiedUrlKey] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // Sync dark mode with <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  // Persist library & rules to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('spotisync_tracks_v1', JSON.stringify(tracks));
    } catch {
      // Ignore quota errors
    }
  }, [tracks]);

  useEffect(() => {
    try {
      localStorage.setItem('spotisync_rules_v1', JSON.stringify(playlistRules));
    } catch {
      // Ignore quota errors
    }
  }, [playlistRules]);

  useEffect(() => {
    try {
      localStorage.setItem('spotisync_history_v1', JSON.stringify(syncHistory));
    } catch {
      // Ignore quota errors
    }
  }, [syncHistory]);

  const fetchSpotifyStatus = async (overrideSessionId?: string) => {
    try {
      const sid = overrideSessionId ?? sessionIdToken;
      const resp = await fetch(
        `/api/auth/spotify/status?origin=${encodeURIComponent(window.location.origin)}`,
        {
          headers: sid ? { 'x-spotify-session': sid } : {},
        }
      );
      if (resp.ok) {
        const data = (await resp.json()) as SpotifyAuthStatus;
        setSpotifyAuth(data);
      }
    } catch {
      // Keep local fallback
    }
  };

  useEffect(() => {
    fetchSpotifyStatus();
  }, []);

  // Listen for OAuth Popup postMessage callback
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const newSessionId = event.data.sessionId || '';
        if (newSessionId) {
          setSessionIdToken(newSessionId);
          localStorage.setItem('spotisync_session_id', newSessionId);
        }
        fetchSpotifyStatus(newSessionId);
        setShowOAuthModal(false);
        setNoticeBanner({
          type: 'success',
          message: 'Succesvol verbonden met je Spotify-account. Live synchronisatie is nu actief.',
        });
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setNoticeBanner({
          type: 'warning',
          message: `Spotify koppeling onderbroken: ${event.data.error || 'Geannuleerd'}`,
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sessionIdToken]);

  const handleConnectSpotify = async () => {
    try {
      const resp = await fetch(
        `/api/auth/spotify/url?origin=${encodeURIComponent(window.location.origin)}`
      );
      if (!resp.ok) {
        setShowOAuthModal(true);
        return;
      }
      const { url } = await resp.json();
      const popup = window.open(url, 'spotify_oauth_popup', 'width=560,height=720');
      if (!popup) {
        setShowOAuthModal(true);
        setNoticeBanner({
          type: 'warning',
          message: 'Pop-up werd geblokkeerd door de browser. Sta pop-ups toe voor deze pagina.',
        });
      }
    } catch {
      setShowOAuthModal(true);
    }
  };

  const handleDisconnectSpotify = async () => {
    try {
      await fetch('/api/auth/spotify/logout', {
        method: 'POST',
        headers: sessionIdToken ? { 'x-spotify-session': sessionIdToken } : {},
      });
      setSessionIdToken('');
      localStorage.removeItem('spotisync_session_id');
      fetchSpotifyStatus('');
      setNoticeBanner({
        type: 'info',
        message: 'Spotify-sessie ontkoppeld.',
      });
    } catch {
      // Ignore error
    }
  };

  // Batch Match local tracks via Backend API
  const runBatchMatcher = async (targetTracks?: LocalAudioTrack[]) => {
    const listToMatch = targetTracks || tracks;
    if (listToMatch.length === 0) return;

    setIsBatchMatching(true);
    try {
      const payload = listToMatch.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        durationSec: t.durationSec,
        isrc: t.isrc,
        year: t.year,
      }));

      const resp = await fetch('/api/spotify/match-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionIdToken ? { 'x-spotify-session': sessionIdToken } : {}),
        },
        body: JSON.stringify({ tracks: payload }),
      });

      if (resp.ok) {
        const data = (await resp.json()) as {
          source: string;
          results: Record<string, SpotifyCandidate[]>;
        };

        setTracks((prev) =>
          prev.map((trk) => {
            const cands = data.results[trk.id];
            if (!cands || cands.length === 0) return trk;
            const best = cands[0];
            const newStatus: MatchStatus =
              trk.matchStatus === 'synced'
                ? 'synced'
                : best.confidence >= 90
                ? 'matched'
                : best.confidence >= 68
                ? 'review'
                : 'unmatched';

            return {
              ...trk,
              candidates: cands,
              selectedMatch: best.confidence >= 68 ? best : trk.selectedMatch,
              matchStatus: newStatus,
            };
          })
        );

        setNoticeBanner({
          type: 'success',
          message: `${listToMatch.length} lokale muziekbestanden geanalyseerd en vergeleken met Spotify metadata (ISRC, titel, artiest en speelduur).`,
        });
      }
    } catch {
      setNoticeBanner({
        type: 'warning',
        message: 'Kon niet alle tracks verifiëren. Controleer de netwerkverbinding.',
      });
    } finally {
      setIsBatchMatching(false);
    }
  };

  // Handle Local File / Folder Upload & Binary Tag Extraction
  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const filesArray = Array.from(fileList);
    const audioExts = ['.mp3', '.flac', '.m4a', '.wav', '.aiff', '.ogg', '.m3u', '.m3u8'];
    const validFiles = filesArray.filter((f) =>
      audioExts.some((ext) => f.name.toLowerCase().endsWith(ext))
    );

    if (validFiles.length === 0) {
      setNoticeBanner({
        type: 'warning',
        message:
          'Geen ondersteunde audiobestanden gevonden. Selecteer .FLAC, .MP3, .M4A, .WAV, .OGG of .M3U8 bestanden.',
      });
      return;
    }

    setIsScanningFiles(true);
    const parsedTracks: LocalAudioTrack[] = [];

    for (let i = 0; i < validFiles.length; i++) {
      const f = validFiles[i];
      setScanProgressText(
        `Analyseren (${i + 1}/${validFiles.length}): ${f.name}`
      );
      const lowerName = f.name.toLowerCase();
      if (lowerName.endsWith('.m3u') || lowerName.endsWith('.m3u8')) {
        const text = await f.text();
        const m3uTracks = parseM3UPlaylistContent(text, f.name);
        parsedTracks.push(...m3uTracks);
      } else {
        const track = await parseLocalAudioFile(f);
        parsedTracks.push(track);
      }
    }

    setIsScanningFiles(false);
    setScanProgressText('');

    if (parsedTracks.length > 0) {
      setTracks((prev) => [...parsedTracks, ...prev]);
      await runBatchMatcher(parsedTracks);
    }
  };

  // Distinct Folders & Genres
  const folderStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tracks) {
      map.set(t.folderPath, (map.get(t.folderPath) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tracks]);

  // Filtered tracks for Library & Matcher views
  const filteredTracks = useMemo(() => {
    return tracks.filter((t) => {
      if (selectedFolder !== 'ALL' && t.folderPath !== selectedFolder) return false;
      if (statusFilter !== 'ALL' && t.matchStatus !== statusFilter) return false;
      if (formatFilter !== 'ALL' && t.format !== formatFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${t.title} ${t.artist} ${t.album} ${t.genre} ${t.fileName} ${
          t.isrc || ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tracks, selectedFolder, statusFilter, formatFilter, searchQuery]);

  // Library Summary Metrics
  const metrics = useMemo(() => {
    const total = tracks.length;
    const exactOrSynced = tracks.filter(
      (t) => t.matchStatus === 'matched' || t.matchStatus === 'synced'
    ).length;
    const reviewCount = tracks.filter((t) => t.matchStatus === 'review').length;
    const unmatchedCount = tracks.filter((t) => t.matchStatus === 'unmatched').length;
    const syncedCount = tracks.filter((t) => t.matchStatus === 'synced').length;
    const totalSizeMB = tracks.reduce((acc, t) => acc + t.fileSizeMB, 0);

    return {
      total,
      exactOrSynced,
      reviewCount,
      unmatchedCount,
      syncedCount,
      totalSizeMB: totalSizeMB.toFixed(1),
      matchRatePct: total > 0 ? Math.round(((exactOrSynced + reviewCount) / total) * 100) : 0,
    };
  }, [tracks]);

  // Computed Auto-Playlists with Qualifying Tracks & Diff
  const evaluatedPlaylists = useMemo(() => {
    return playlistRules.map((rule) => {
      const qualifyingTracks = tracks.filter((t) => doesTrackMatchRule(t, rule));
      const readyMatches = qualifyingTracks.filter(
        (t) =>
          t.selectedMatch &&
          t.selectedMatch.confidence >= rule.filter.minConfidence
      );
      const allUris = Array.from(
        new Set(readyMatches.map((t) => t.selectedMatch!.uri))
      );
      const existingSet = new Set(rule.syncedTrackUris || []);
      const newUrisToAdd = allUris.filter((u) => !existingSet.has(u));
      const alreadySyncedUris = allUris.filter((u) => existingSet.has(u));
      const unmatchedInRule = qualifyingTracks.length - readyMatches.length;

      return {
        rule,
        qualifyingTracks,
        readyMatches,
        allUris,
        newUrisToAdd,
        alreadySyncedUris,
        unmatchedInRule,
      };
    });
  }, [playlistRules, tracks]);

  // Select a candidate match for a track
  const handleSelectCandidate = (trackId: string, candidate: SpotifyCandidate) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          selectedMatch: {
            ...candidate,
            confidence: Math.max(candidate.confidence, 95),
          },
          matchStatus: t.matchStatus === 'synced' ? 'synced' : 'matched',
        };
      })
    );
    setNoticeBanner({
      type: 'success',
      message: `Spotify match gekoppeld: "${candidate.artist} — ${candidate.title}" (${candidate.uri})`,
    });
  };

  // Manual Spotify search for a specific track
  const handleRunManualSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSearchQuery.trim()) return;
    setIsSearchingManual(true);
    try {
      const resp = await fetch(
        `/api/spotify/search?q=${encodeURIComponent(manualSearchQuery)}`,
        {
          headers: sessionIdToken ? { 'x-spotify-session': sessionIdToken } : {},
        }
      );
      if (resp.ok) {
        const data = (await resp.json()) as { candidates: SpotifyCandidate[] };
        setManualSearchResults(data.candidates || []);
      }
    } finally {
      setIsSearchingManual(false);
    }
  };

  // Save edited local metadata & re-match
  const handleSaveTrackEdit = async (trackId: string) => {
    let updatedTrack: LocalAudioTrack | null = null;
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== trackId) return t;
        updatedTrack = {
          ...t,
          title: editDraft.title ?? t.title,
          artist: editDraft.artist ?? t.artist,
          album: editDraft.album ?? t.album,
          genre: editDraft.genre ?? t.genre,
          year: Number(editDraft.year ?? t.year),
          bpm: editDraft.bpm ? Number(editDraft.bpm) : t.bpm,
          isrc: editDraft.isrc !== undefined ? editDraft.isrc : t.isrc,
        };
        return updatedTrack;
      })
    );
    setEditingTrackId(null);
    if (updatedTrack) {
      await runBatchMatcher([updatedTrack]);
    }
  };

  // Auto-generate playlist rules from folders or genres
  const handleGenerateRulesFromFolders = () => {
    const existingFolders = new Set(
      playlistRules.map((r) => r.filter.folderContains?.toLowerCase()).filter(Boolean)
    );
    const created: AutoPlaylistRule[] = [];

    for (const [folderPath] of folderStats) {
      const folderLeaf = folderPath.split('/').filter(Boolean).pop() || folderPath;
      if (existingFolders.has(folderLeaf.toLowerCase())) continue;

      created.push({
        id: `rule_folder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: `Map: ${folderLeaf}`,
        description: `Automatisch gesynchroniseerd vanuit lokale map ${folderPath}`,
        strategy: 'folder',
        isPublic: false,
        autoSync: true,
        filter: {
          folderContains: folderLeaf,
          minConfidence: 80,
        },
        syncedTrackUris: [],
      });
    }

    if (created.length === 0) {
      setNoticeBanner({
        type: 'info',
        message: 'Alle huidige lokale mappen hebben al een gekoppelde afspeellijstregel.',
      });
      return;
    }

    setPlaylistRules((prev) => [...prev, ...created]);
    setSelectedPlaylistId(created[0].id);
    setNoticeBanner({
      type: 'success',
      message: `${created.length} nieuwe automatische afspeellijsten aangemaakt op basis van je mappenstructuur.`,
    });
  };

  const handleCreateCustomRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleDraft.name.trim()) return;

    const newRule: AutoPlaylistRule = {
      id: `rule_custom_${Date.now()}`,
      name: newRuleDraft.name.trim(),
      description:
        newRuleDraft.description.trim() ||
        'Slimme afspeellijst op basis van lokale metadata-filters.',
      strategy: 'custom_rule',
      isPublic: newRuleDraft.isPublic,
      autoSync: true,
      filter: {
        genreContains: newRuleDraft.genreContains.trim() || undefined,
        folderContains: newRuleDraft.folderContains.trim() || undefined,
        minBpm: newRuleDraft.minBpm ? Number(newRuleDraft.minBpm) : undefined,
        maxBpm: newRuleDraft.maxBpm ? Number(newRuleDraft.maxBpm) : undefined,
        minYear: newRuleDraft.minYear ? Number(newRuleDraft.minYear) : undefined,
        maxYear: newRuleDraft.maxYear ? Number(newRuleDraft.maxYear) : undefined,
        minConfidence: newRuleDraft.minConfidence,
        onlyLossless: newRuleDraft.onlyLossless,
      },
      syncedTrackUris: [],
    };

    setPlaylistRules((prev) => [newRule, ...prev]);
    setSelectedPlaylistId(newRule.id);
    setShowNewRuleForm(false);
    setNewRuleDraft({
      name: '',
      description: '',
      genreContains: '',
      folderContains: '',
      minBpm: '',
      maxBpm: '',
      minYear: '',
      maxYear: '',
      minConfidence: 80,
      onlyLossless: false,
      isPublic: false,
    });
    setNoticeBanner({
      type: 'success',
      message: `Slimme afspeellijst "${newRule.name}" aangemaakt.`,
    });
  };

  // Run Differential Synchronization
  const handleRunDifferentialSync = async () => {
    const activePlaylistsToSync = evaluatedPlaylists.filter(
      (ep) => ep.rule.autoSync && ep.newUrisToAdd.length > 0
    );

    if (activePlaylistsToSync.length === 0) {
      setNoticeBanner({
        type: 'info',
        message:
          'Alle afspeellijsten zijn al volledig up-to-date. Er zijn geen nieuwe tracks om toe te voegen.',
      });
      return;
    }

    setIsSyncing(true);
    try {
      const payload = activePlaylistsToSync.map((ep) => ({
        id: ep.rule.id,
        name: ep.rule.name,
        description: ep.rule.description,
        isPublic: ep.rule.isPublic,
        trackUris: ep.newUrisToAdd,
        existingSpotifyPlaylistId: ep.rule.spotifyPlaylistId,
      }));

      const resp = await fetch('/api/spotify/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionIdToken ? { 'x-spotify-session': sessionIdToken } : {}),
        },
        body: JSON.stringify({ playlists: payload }),
      });

      if (resp.ok) {
        const data = (await resp.json()) as {
          mode: 'live_spotify' | 'local_staged';
          results: Array<{
            localPlaylistId: string;
            name: string;
            spotifyPlaylistId: string;
            externalUrl: string;
            addedTracks: number;
            skippedDuplicates: number;
            mode: 'live_spotify' | 'local_staged';
            timestamp: string;
          }>;
        };

        const nowIso = new Date().toISOString();
        const syncedRuleMap = new Map(
          data.results.map((r) => [r.localPlaylistId, r])
        );

        // Update playlist rules with newly synced URIs
        setPlaylistRules((prev) =>
          prev.map((rule) => {
            const res = syncedRuleMap.get(rule.id);
            const ep = evaluatedPlaylists.find((e) => e.rule.id === rule.id);
            if (!res || !ep) return rule;
            return {
              ...rule,
              spotifyPlaylistId: res.spotifyPlaylistId,
              lastSyncedAt: nowIso,
              syncedTrackUris: Array.from(
                new Set([...rule.syncedTrackUris, ...ep.newUrisToAdd])
              ),
            };
          })
        );

        // Mark qualifying tracks as synced
        const newlySyncedUris = new Set(
          activePlaylistsToSync.flatMap((ep) => ep.newUrisToAdd)
        );
        setTracks((prev) =>
          prev.map((trk) => {
            if (trk.selectedMatch && newlySyncedUris.has(trk.selectedMatch.uri)) {
              return {
                ...trk,
                matchStatus: 'synced',
                lastSyncedAt: nowIso,
              };
            }
            return trk;
          })
        );

        // Prepend to Sync History
        const newEntries: SyncHistoryEntry[] = data.results.map((r, idx) => ({
          id: `sync_${Date.now()}_${idx}`,
          timestamp: r.timestamp,
          playlistName: r.name,
          addedTracks: r.addedTracks,
          skippedDuplicates: r.skippedDuplicates,
          mode: r.mode,
          spotifyUrl: r.externalUrl,
        }));
        setSyncHistory((prev) => [...newEntries, ...prev]);

        const totalAdded = data.results.reduce((acc, r) => acc + r.addedTracks, 0);
        setNoticeBanner({
          type: 'success',
          message:
            data.mode === 'live_spotify'
              ? `Live Spotify Synchronisatie voltooid: ${totalAdded} nieuwe nummers toegevoegd over ${data.results.length} afspeellijsten.`
              : `Synchronisatie-diff geregistreerd (${totalAdded} nieuwe nummers over ${data.results.length} afspeellijsten). Verbind je Spotify-account om ze direct naar je Spotify-profiel te pushen.`,
        });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  // Export Library Mapping as JSON or M3U8
  const handleExportSyncReport = (format: 'json' | 'csv' | 'm3u8') => {
    let content = '';
    let mime = 'application/json';
    let filename = `spotisync-bibliotheek-${new Date().toISOString().slice(0, 10)}.json`;

    if (format === 'json') {
      content = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          totalTracks: tracks.length,
          playlists: evaluatedPlaylists.map((ep) => ({
            name: ep.rule.name,
            spotifyPlaylistId: ep.rule.spotifyPlaylistId,
            trackCount: ep.allUris.length,
            trackUris: ep.allUris,
          })),
          tracks: tracks.map((t) => ({
            fileName: t.fileName,
            folderPath: t.folderPath,
            artist: t.artist,
            title: t.title,
            album: t.album,
            isrc: t.isrc,
            matchStatus: t.matchStatus,
            spotifyUri: t.selectedMatch?.uri || null,
            confidence: t.selectedMatch?.confidence || 0,
          })),
        },
        null,
        2
      );
    } else if (format === 'csv') {
      mime = 'text/csv;charset=utf-8';
      filename = `spotisync-mapping-${new Date().toISOString().slice(0, 10)}.csv`;
      const header =
        'Bestandsnaam,Map,Artiest,Titel,Album,Genre,Jaar,BPM,ISRC,Status,Spotify_URI,Match_Score\n';
      const rows = tracks
        .map((t) =>
          [
            `"${t.fileName.replace(/"/g, '""')}"`,
            `"${t.folderPath.replace(/"/g, '""')}"`,
            `"${t.artist.replace(/"/g, '""')}"`,
            `"${t.title.replace(/"/g, '""')}"`,
            `"${t.album.replace(/"/g, '""')}"`,
            `"${t.genre.replace(/"/g, '""')}"`,
            t.year,
            t.bpm || '',
            t.isrc || '',
            t.matchStatus,
            t.selectedMatch?.uri || '',
            t.selectedMatch?.confidence || 0,
          ].join(',')
        )
        .join('\n');
      content = header + rows;
    } else {
      mime = 'audio/x-mpegurl;charset=utf-8';
      filename = `spotisync-export.m3u8`;
      const lines = ['#EXTM3U'];
      for (const t of tracks) {
        lines.push(`#EXTINF:${t.durationSec},${t.artist} - ${t.title}`);
        if (t.selectedMatch?.uri) {
          lines.push(`#EXTSPOTIFY:${t.selectedMatch.uri}`);
        }
        lines.push(`${t.folderPath}/${t.fileName}`);
      }
      content = lines.join('\n');
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrlKey(key);
    setTimeout(() => setCopiedUrlKey(null), 2000);
  };

  const totalPendingSyncTracks = useMemo(() => {
    return evaluatedPlaylists.reduce(
      (sum, ep) => sum + (ep.rule.autoSync ? ep.newUrisToAdd.length : 0),
      0
    );
  }, [evaluatedPlaylists]);

  const activePlaylistEval =
    evaluatedPlaylists.find((ep) => ep.rule.id === selectedPlaylistId) ||
    evaluatedPlaylists[0];

  const devCallbackUrl =
    'https://ais-dev-tzqpzkh4ocjalcl3kqjfzz-636815722959.europe-west3.run.app/auth/callback';
  const sharedCallbackUrl =
    'https://ais-pre-tzqpzkh4ocjalcl3kqjfzz-636815722959.europe-west3.run.app/auth/callback';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Hidden File & Directory Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".mp3,.flac,.m4a,.wav,.aiff,.ogg,.m3u,.m3u8"
        onChange={(e) => handleFilesSelected(e.target.files)}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={(e) => handleFilesSelected(e.target.files)}
        className="hidden"
      />

      {/* Top Bar Contract: Strictly 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#bibliotheek"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('library');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          SpotiSync Studio
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 border-b-2 ${
              activeTab === 'library'
                ? 'text-slate-900 dark:text-white border-emerald-500'
                : 'border-transparent'
            }`}
          >
            Bibliotheek
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('matcher')}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 border-b-2 ${
              activeTab === 'matcher'
                ? 'text-slate-900 dark:text-white border-emerald-500'
                : 'border-transparent'
            }`}
          >
            Spotify Matcher
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('playlists')}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 border-b-2 ${
              activeTab === 'playlists'
                ? 'text-slate-900 dark:text-white border-emerald-500'
                : 'border-transparent'
            }`}
          >
            Slimme Lijsten
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sync')}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 border-b-2 ${
              activeTab === 'sync'
                ? 'text-slate-900 dark:text-white border-emerald-500'
                : 'border-transparent'
            }`}
          >
            Synchronisatie
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          {spotifyAuth.connected ? (
            <button
              type="button"
              onClick={() => {
                setActiveTab('sync');
                handleRunDifferentialSync();
              }}
              disabled={isSyncing}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-500 rounded-lg hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
            >
              {isSyncing
                ? 'Synchroniseren...'
                : `Synchroniseer Nu (${totalPendingSyncTracks})`}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConnectSpotify}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-500 rounded-lg hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
            >
              Verbind Spotify
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace Canvas: Sidebar + Content Viewport */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto">
        {/* Left Navigation & Folder Tree Sidebar */}
        <aside className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 flex flex-col justify-between gap-6">
          <div className="space-y-6">
            {/* Mobile Navigation Switcher */}
            <div className="flex md:hidden items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
              {(
                [
                  ['library', 'Bibliotheek'],
                  ['matcher', 'Matcher'],
                  ['playlists', 'Lijsten'],
                  ['sync', 'Sync'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === key
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Quick Upload Actions */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Lokale Bronbestanden
              </div>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
              >
                <span className="flex items-center gap-2 truncate">
                  <FolderOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Scan Muziekmap</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
              >
                <span className="flex items-center gap-2 truncate">
                  <Upload className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>Importeer Losse Audio / M3U8</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
            </div>

            {/* Local Folder Structure Filter */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>Mappenstructuur</span>
                <span className="font-mono tabular-nums">{folderStats.length}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedFolder('ALL');
                  if (activeTab === 'playlists' || activeTab === 'sync') {
                    setActiveTab('library');
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-md transition-colors ${
                  selectedFolder === 'ALL'
                    ? 'bg-slate-900 text-white dark:bg-slate-800 dark:text-white font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                }`}
              >
                <span className="truncate">Alle Lokale Mappen</span>
                <span className="font-mono tabular-nums text-[11px] opacity-80">
                  {tracks.length}
                </span>
              </button>
              {folderStats.map(([folderPath, count]) => {
                const shortName = folderPath.split('/').filter(Boolean).pop() || folderPath;
                const active = selectedFolder === folderPath;
                return (
                  <button
                    key={folderPath}
                    type="button"
                    title={folderPath}
                    onClick={() => {
                      setSelectedFolder(folderPath);
                      if (activeTab === 'playlists' || activeTab === 'sync') {
                        setActiveTab('library');
                      }
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-md transition-colors ${
                      active
                        ? 'bg-slate-900 text-white dark:bg-slate-800 dark:text-white font-medium'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <span className="truncate">{shortName}</span>
                    <span className="font-mono tabular-nums text-[11px] opacity-80 shrink-0 ml-2">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Smart Playlists Sidebar List */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>Slimme Afspeellijsten</span>
                <span className="font-mono tabular-nums">{evaluatedPlaylists.length}</span>
              </div>
              {evaluatedPlaylists.map((ep) => {
                const isSelected =
                  activeTab === 'playlists' && selectedPlaylistId === ep.rule.id;
                return (
                  <button
                    key={ep.rule.id}
                    type="button"
                    onClick={() => {
                      setSelectedPlaylistId(ep.rule.id);
                      setActiveTab('playlists');
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-md transition-colors ${
                      isSelected
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <span className="truncate">{ep.rule.name}</span>
                    <span className="font-mono tabular-nums text-[11px] shrink-0 ml-2">
                      {ep.allUris.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom Sidebar Controls: Spotify OAuth Status & Theme Toggle */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Spotify Koppeling
                </span>
                <button
                  type="button"
                  onClick={() => setShowOAuthModal(true)}
                  className="text-emerald-600 dark:text-emerald-400 hover:underline text-[11px] font-medium whitespace-nowrap"
                >
                  OAuth Instellingen
                </button>
              </div>
              {spotifyAuth.connected && spotifyAuth.user ? (
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="truncate">
                    Ingelogd: {spotifyAuth.user.display_name}
                  </span>
                  <button
                    type="button"
                    onClick={handleDisconnectSpotify}
                    className="text-rose-600 dark:text-rose-400 hover:underline ml-2 shrink-0"
                  >
                    Log uit
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Catalogus-matcher actief ·{' '}
                  <button
                    type="button"
                    onClick={() => setShowOAuthModal(true)}
                    className="underline hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Configureer API
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap"
              >
                {darkMode ? (
                  <>
                    <Sun className="w-3.5 h-3.5" />
                    <span>Licht Thema</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5" />
                    <span>Donker Thema</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTracks(INITIAL_LOCAL_LIBRARY);
                  setPlaylistRules(INITIAL_PLAYLIST_RULES);
                  setNoticeBanner({
                    type: 'info',
                    message: 'Voorbeeldbibliotheek en standaardregels hersteld.',
                  });
                }}
                className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors whitespace-nowrap"
              >
                Reset Demo
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-6 lg:p-8 space-y-6 min-w-0">
          {/* Notification Banner */}
          {noticeBanner && (
            <div
              className={`flex items-center justify-between gap-4 px-4 py-3 rounded-lg border text-xs ${
                noticeBanner.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
                  : noticeBanner.type === 'warning'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200'
                  : 'bg-slate-200/70 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {noticeBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                )}
                <span>{noticeBanner.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setNoticeBanner(null)}
                className="p-1 hover:opacity-75 shrink-0"
                aria-label="Melding sluiten"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Live File Scanning Progress */}
          {isScanningFiles && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-800 dark:text-emerald-200">
              <RefreshCw className="w-4 h-4 animate-spin shrink-0 text-emerald-500" />
              <span className="font-mono tabular-nums">{scanProgressText}</span>
            </div>
          )}

          {/* KPI Metric Strip — Single-elevation hairline grid with tabular numerals */}
          <section className="grid grid-cols-2 lg:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Lokale Muziekbestanden
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {metrics.total}
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {metrics.totalSizeMB} MB
                </span>
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Spotify Catalogus Match
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                  {metrics.matchRatePct}%
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {metrics.exactOrSynced} bevestigd
                </span>
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Handmatige Controle
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                  {metrics.reviewCount}
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {metrics.unmatchedCount} onbekend
                </span>
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Klaar voor Synchronisatie
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {totalPendingSyncTracks}
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  in {evaluatedPlaylists.length} lijsten
                </span>
              </div>
            </div>
          </section>

          {/* ===================================================================
              VIEW 1: LOKALE BIBLIOTHEEK & METADATA SCANNER
             =================================================================== */}
          {activeTab === 'library' && (
            <div className="space-y-6">
              {/* Drag & Drop Local Music Folder Zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFilesSelected(e.dataTransfer.files);
                }}
                className="border border-dashed border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900/50 p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <h1 className="text-base font-semibold text-slate-900 dark:text-white">
                    Lokale Muziekbibliotheek & Binary Tag Scanner
                  </h1>
                  <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl">
                    Sleep je lokale muziekmap of audiobestanden hierheen. De scanner leest direct{' '}
                    <span className="font-mono">ID3v2.4</span>,{' '}
                    <span className="font-mono">FLAC Vorbis</span>,{' '}
                    <span className="font-mono">ISRC</span>, <span className="font-mono">BPM</span>{' '}
                    en <span className="font-mono">.M3U8</span> afspeellijsten uit zonder de
                    audiobestanden te hoeven uploaden.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                  >
                    Selecteer Lokale Map
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    Kies Bestanden / .M3U8
                  </button>
                  <button
                    type="button"
                    onClick={() => runBatchMatcher()}
                    disabled={isBatchMatching}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isBatchMatching ? 'animate-spin' : ''}`}
                    />
                    <span>{isBatchMatching ? 'Bezig met zoeken...' : 'Herbereken Matches'}</span>
                  </button>
                </div>
              </div>

              {/* Filter & Search Toolbar */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                {/* Interactive Segmented Status Filter */}
                <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                  {(
                    [
                      ['ALL', `Alle (${tracks.length})`],
                      [
                        'matched',
                        `Gematcht (${tracks.filter((t) => t.matchStatus === 'matched').length})`,
                      ],
                      [
                        'review',
                        `Controle (${tracks.filter((t) => t.matchStatus === 'review').length})`,
                      ],
                      [
                        'synced',
                        `Gesynchroniseerd (${
                          tracks.filter((t) => t.matchStatus === 'synced').length
                        })`,
                      ],
                      [
                        'unmatched',
                        `Geen Match (${
                          tracks.filter((t) => t.matchStatus === 'unmatched').length
                        })`,
                      ],
                    ] as const
                  ).map(([st, label]) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        statusFilter === st
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Search & Format Filter */}
                <div className="flex items-center gap-2.5">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Zoek op titel, artiest, ISRC, map..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <select
                    value={formatFilter}
                    onChange={(e) => setFormatFilter(e.target.value)}
                    aria-label="Filter op audioformaat"
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="ALL">Alle formaten</option>
                    <option value="FLAC">FLAC</option>
                    <option value="WAV">WAV</option>
                    <option value="MP3">MP3</option>
                    <option value="M4A">M4A</option>
                  </select>
                </div>
              </div>

              {/* High-Density Local Library Data Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-900/80">
                        <th className="py-2.5 px-4">Titel & Artiest (Lokaal Bestand)</th>
                        <th className="py-2.5 px-4">Album & Genre Metadata</th>
                        <th className="py-2.5 px-4">Audio Specs</th>
                        <th className="py-2.5 px-4 text-right">Speelduur</th>
                        <th className="py-2.5 px-4">Spotify Match & URI</th>
                        <th className="py-2.5 px-4 text-right">Acties</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 text-xs">
                      {filteredTracks.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="py-12 px-4 text-center text-slate-500 dark:text-slate-400"
                          >
                            Geen muziekbestanden gevonden voor de huidige filterselectie.
                          </td>
                        </tr>
                      ) : (
                        filteredTracks.map((trk) => {
                          const isEditing = editingTrackId === trk.id;
                          return (
                            <React.Fragment key={trk.id}>
                              <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                {/* Col 1: Title, Artist & Local Path */}
                                <td className="py-3 px-4 max-w-xs">
                                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    {trk.title}
                                  </div>
                                  <div className="text-slate-600 dark:text-slate-400 truncate">
                                    {trk.artist}
                                  </div>
                                  <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5 font-mono">
                                    {trk.folderPath}/{trk.fileName}
                                  </div>
                                </td>

                                {/* Col 2: Unboxed Metadata with · separators */}
                                <td className="py-3 px-4">
                                  <div className="text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                                    {trk.album}
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 whitespace-nowrap">
                                    <span>{trk.genre}</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums">{trk.year}</span>
                                    {trk.bpm && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-mono tabular-nums">
                                          {trk.bpm} BPM
                                        </span>
                                      </>
                                    )}
                                    {trk.musicalKey && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-mono">{trk.musicalKey}</span>
                                      </>
                                    )}
                                  </div>
                                </td>

                                {/* Col 3: Format, Bitrate, Tag Source */}
                                <td className="py-3 px-4 whitespace-nowrap">
                                  <div className="text-xs font-mono tabular-nums text-slate-800 dark:text-slate-200">
                                    {trk.format} · {trk.bitrateKbps} kbps
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                    {trk.tagSource}
                                    {trk.isrc ? ` · ${trk.isrc}` : ''}
                                  </div>
                                </td>

                                {/* Col 4: Duration */}
                                <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                  {formatDuration(trk.durationSec)}
                                </td>

                                {/* Col 5: Spotify Match Status (paired icon + explicit text label) */}
                                <td className="py-3 px-4">
                                  {trk.selectedMatch ? (
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        {trk.matchStatus === 'synced' ? (
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                        ) : trk.matchStatus === 'matched' ? (
                                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                        ) : (
                                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                        )}
                                        <span className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[180px]">
                                          {trk.selectedMatch.title}
                                        </span>
                                        <span className="font-mono tabular-nums text-[11px] text-emerald-600 dark:text-emerald-400">
                                          {trk.selectedMatch.confidence}%
                                        </span>
                                      </div>
                                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[220px] mt-0.5">
                                        {trk.selectedMatch.matchMethod} · {trk.selectedMatch.uri}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                      <span>Geen automatische match</span>
                                    </div>
                                  )}
                                </td>

                                {/* Col 6: Actions */}
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isEditing) {
                                          setEditingTrackId(null);
                                        } else {
                                          setEditingTrackId(trk.id);
                                          setEditDraft({
                                            title: trk.title,
                                            artist: trk.artist,
                                            album: trk.album,
                                            genre: trk.genre,
                                            year: trk.year,
                                            bpm: trk.bpm,
                                            isrc: trk.isrc || '',
                                          });
                                        }
                                      }}
                                      className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    >
                                      Bewerk Tags
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveTab('matcher');
                                        setManualSearchTrackId(trk.id);
                                        setManualSearchQuery(`${trk.artist} - ${trk.title}`);
                                      }}
                                      className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                    >
                                      Koppel
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {/* Inline Metadata Editor Drawer */}
                              {isEditing && (
                                <tr className="bg-slate-100/70 dark:bg-slate-800/60">
                                  <td colSpan={6} className="p-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                                      <div>
                                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                                          Titel
                                        </label>
                                        <input
                                          type="text"
                                          value={editDraft.title || ''}
                                          onChange={(e) =>
                                            setEditDraft((d) => ({ ...d, title: e.target.value }))
                                          }
                                          className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                                          Artiest
                                        </label>
                                        <input
                                          type="text"
                                          value={editDraft.artist || ''}
                                          onChange={(e) =>
                                            setEditDraft((d) => ({ ...d, artist: e.target.value }))
                                          }
                                          className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                                          Album
                                        </label>
                                        <input
                                          type="text"
                                          value={editDraft.album || ''}
                                          onChange={(e) =>
                                            setEditDraft((d) => ({ ...d, album: e.target.value }))
                                          }
                                          className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                                          Genre
                                        </label>
                                        <input
                                          type="text"
                                          value={editDraft.genre || ''}
                                          onChange={(e) =>
                                            setEditDraft((d) => ({ ...d, genre: e.target.value }))
                                          }
                                          className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                                          ISRC-code
                                        </label>
                                        <input
                                          type="text"
                                          value={editDraft.isrc || ''}
                                          onChange={(e) =>
                                            setEditDraft((d) => ({ ...d, isrc: e.target.value }))
                                          }
                                          placeholder="bijv. NLB631700084"
                                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                                        />
                                      </div>
                                      <div className="flex items-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => handleSaveTrackEdit(trk.id)}
                                          className="px-3 py-1.5 text-xs font-semibold rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap"
                                        >
                                          Opslaan & Herzoek
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingTrackId(null)}
                                          className="px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                                        >
                                          Annuleer
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ===================================================================
              VIEW 2: SPOTIFY MATCHER & CONFLICTRESOLUTIE
             =================================================================== */}
          {activeTab === 'matcher' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <h1 className="text-base font-semibold text-slate-900 dark:text-white">
                    Spotify Metadata Matcher & Versiebeheer
                  </h1>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Controleer twijfelgevallen (zoals Extended Mixes vs. Radio Edits of vinyl-rips)
                    en kies de juiste Spotify Track URI.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runBatchMatcher()}
                    disabled={isBatchMatching}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:opacity-90 transition-opacity whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isBatchMatching ? 'animate-spin' : ''}`}
                    />
                    <span>Scan Alle Nummers Opnieuw</span>
                  </button>
                </div>
              </div>

              {/* Manual Search Box when a specific track is selected for manual lookup */}
              {manualSearchTrackId && (
                <div className="border border-emerald-500/40 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      Handmatig Zoeken in Spotify Catalogus voor:{' '}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {tracks.find((t) => t.id === manualSearchTrackId)?.fileName}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setManualSearchTrackId(null);
                        setManualSearchResults([]);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    >
                      Sluiten
                    </button>
                  </div>
                  <form onSubmit={handleRunManualSearch} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={manualSearchQuery}
                      onChange={(e) => setManualSearchQuery(e.target.value)}
                      placeholder="Zoek op Artiest - Titel of ISRC..."
                      className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                    <button
                      type="submit"
                      disabled={isSearchingManual}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap"
                    >
                      {isSearchingManual ? 'Zoeken...' : 'Zoek in Spotify'}
                    </button>
                  </form>
                  {manualSearchResults.length > 0 && (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800 pt-2">
                      {manualSearchResults.map((cand) => (
                        <div
                          key={cand.spotifyId}
                          className="py-2.5 flex items-center justify-between gap-4 text-xs"
                        >
                          <div>
                            <div className="font-medium text-slate-900 dark:text-white">
                              {cand.artist} — {cand.title}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {cand.album} · {cand.releaseYear} · {formatDuration(cand.durationSec)}{' '}
                              · {cand.uri}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectCandidate(manualSearchTrackId, {
                                ...cand,
                                matchMethod: 'Handmatig Gekoppeld',
                                confidence: 100,
                              });
                              setManualSearchTrackId(null);
                              setManualSearchResults([]);
                            }}
                            className="px-3 py-1.5 text-xs font-semibold rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 whitespace-nowrap"
                          >
                            Kies Deze Match
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Matcher Comparison Rows */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
                {tracks.map((trk) => {
                  const durationDelta = trk.selectedMatch
                    ? Math.abs(trk.durationSec - trk.selectedMatch.durationSec)
                    : 0;

                  return (
                    <div key={trk.id} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Left: Local Audio File Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-white truncate">
                            {trk.artist} — {trk.title}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                          Lokaal: {trk.format} · {formatDuration(trk.durationSec)} · Album:{' '}
                          {trk.album} {trk.isrc ? `· ISRC: ${trk.isrc}` : ''}
                        </div>
                      </div>

                      {/* Center: Selected Spotify Candidate & Alternative Versions */}
                      <div className="flex-1 min-w-0">
                        {trk.selectedMatch ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-medium text-emerald-700 dark:text-emerald-400 truncate">
                                Spotify: {trk.selectedMatch.artist} — {trk.selectedMatch.title}
                              </span>
                              <span className="font-mono tabular-nums text-[11px] text-slate-500">
                                ({trk.selectedMatch.confidence}% · {trk.selectedMatch.matchMethod})
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                              URI: {trk.selectedMatch.uri} · Speelduur:{' '}
                              {formatDuration(trk.selectedMatch.durationSec)}
                              {durationDelta > 5
                                ? ` (Δ ${durationDelta}s t.o.v. lokaal bestand)`
                                : ' (Exacte speelduur)'}
                            </div>

                            {/* Candidate Version Switcher if multiple candidates exist */}
                            {trk.candidates.length > 1 && (
                              <div className="pt-1.5 flex flex-wrap items-center gap-2">
                                <span className="text-[11px] text-slate-400">
                                  Alternatieven:
                                </span>
                                {trk.candidates.map((cand) => {
                                  const isCurrent =
                                    trk.selectedMatch?.spotifyId === cand.spotifyId;
                                  return (
                                    <button
                                      key={cand.spotifyId}
                                      type="button"
                                      onClick={() => handleSelectCandidate(trk.id, cand)}
                                      className={`px-2 py-0.5 text-[11px] rounded border transition-colors font-mono ${
                                        isCurrent
                                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 font-medium'
                                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400'
                                      }`}
                                    >
                                      {cand.title} ({formatDuration(cand.durationSec)})
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-amber-600 dark:text-amber-400">
                            Geen match in Spotify gevonden (bijv. onuitgebrachte bootleg of white
                            label).
                          </div>
                        )}
                      </div>

                      {/* Right: Action Buttons */}
                      <div className="flex items-center gap-2 shrink-0">
                        {trk.matchStatus === 'review' && trk.selectedMatch && (
                          <button
                            type="button"
                            onClick={() => handleSelectCandidate(trk.id, trk.selectedMatch!)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap"
                          >
                            Bevestig Match
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setManualSearchTrackId(trk.id);
                            setManualSearchQuery(`${trk.artist} ${trk.title}`);
                          }}
                          className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                        >
                          Handmatig Zoeken
                        </button>
                        {trk.selectedMatch && (
                          <a
                            href={trk.selectedMatch.externalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                            title="Openen in Spotify"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===================================================================
              VIEW 3: SLIMME AFSPEELLIJSTEN & AUTOMATISCHE GROEPERING
             =================================================================== */}
          {activeTab === 'playlists' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <h1 className="text-base font-semibold text-slate-900 dark:text-white">
                    Automatische Afspeellijst-Generator
                  </h1>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Groepeer je lokale muziekbestanden automatisch in Spotify-afspeellijsten op
                    basis van mappenstructuur, ID3-genre, BPM-bereik of lossless formaat.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleGenerateRulesFromFolders}
                    className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                  >
                    Genereer Lijsten uit Mappen ({folderStats.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewRuleForm((v) => !v)}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nieuwe Slimme Regel</span>
                  </button>
                </div>
              </div>

              {/* New Smart Rule Builder Form */}
              {showNewRuleForm && (
                <form
                  onSubmit={handleCreateCustomRule}
                  className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Nieuwe Automatische Afspeellijst Regel
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowNewRuleForm(false)}
                      className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    >
                      Sluiten
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                    <div className="sm:col-span-2">
                      <label className="block text-slate-500 dark:text-slate-400 mb-1">
                        Naam van Spotify Afspeellijst *
                      </label>
                      <input
                        type="text"
                        required
                        value={newRuleDraft.name}
                        onChange={(e) =>
                          setNewRuleDraft((d) => ({ ...d, name: e.target.value }))
                        }
                        placeholder="bijv. Deep House Warmup (118-124 BPM)"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-slate-400 mb-1">
                        Genre bevat (optioneel)
                      </label>
                      <input
                        type="text"
                        value={newRuleDraft.genreContains}
                        onChange={(e) =>
                          setNewRuleDraft((d) => ({ ...d, genreContains: e.target.value }))
                        }
                        placeholder="bijv. House, Indie, Nederpop"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-slate-400 mb-1">
                        Mapnaam bevat (optioneel)
                      </label>
                      <input
                        type="text"
                        value={newRuleDraft.folderContains}
                        onChange={(e) =>
                          setNewRuleDraft((d) => ({ ...d, folderContains: e.target.value }))
                        }
                        placeholder="bijv. DJ Collectie"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-slate-400 mb-1">
                        Minimum BPM
                      </label>
                      <input
                        type="number"
                        value={newRuleDraft.minBpm}
                        onChange={(e) =>
                          setNewRuleDraft((d) => ({ ...d, minBpm: e.target.value }))
                        }
                        placeholder="bijv. 118"
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-slate-400 mb-1">
                        Maximum BPM
                      </label>
                      <input
                        type="number"
                        value={newRuleDraft.maxBpm}
                        onChange={(e) =>
                          setNewRuleDraft((d) => ({ ...d, maxBpm: e.target.value }))
                        }
                        placeholder="bijv. 128"
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-slate-400 mb-1">
                        Minimale Match Zekerheid (%)
                      </label>
                      <input
                        type="number"
                        min={50}
                        max={99}
                        value={newRuleDraft.minConfidence}
                        onChange={(e) =>
                          setNewRuleDraft((d) => ({
                            ...d,
                            minConfidence: Number(e.target.value) || 80,
                          }))
                        }
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div className="flex flex-col justify-end gap-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newRuleDraft.onlyLossless}
                          onChange={(e) =>
                            setNewRuleDraft((d) => ({ ...d, onlyLossless: e.target.checked }))
                          }
                          className="rounded border-slate-400"
                        />
                        <span>Alleen Lossless (FLAC / WAV)</span>
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newRuleDraft.isPublic}
                          onChange={(e) =>
                            setNewRuleDraft((d) => ({ ...d, isPublic: e.target.checked }))
                          }
                          className="rounded border-slate-400"
                        />
                        <span>Openbare Spotify-lijst</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowNewRuleForm(false)}
                      className="px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700"
                    >
                      Annuleren
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                    >
                      Afspeellijst Regel Opslaan
                    </button>
                  </div>
                </form>
              )}

              {/* Split View: Playlist Rules Grid + Selected Rule Tracklist */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left 5 columns: All Auto-Playlist Rules */}
                <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
                  {evaluatedPlaylists.map((ep) => {
                    const isSelected = activePlaylistEval?.rule.id === ep.rule.id;
                    return (
                      <div
                        key={ep.rule.id}
                        onClick={() => setSelectedPlaylistId(ep.rule.id)}
                        className={`p-4 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-emerald-500/10'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-sm text-slate-900 dark:text-white">
                            {ep.rule.name}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPlaylistRules((prev) =>
                                prev.filter((r) => r.id !== ep.rule.id)
                              );
                            }}
                            className="text-slate-400 hover:text-rose-500 p-1"
                            title="Verwijder afspeellijstregel"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {ep.rule.description}
                        </p>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-2.5 font-mono tabular-nums">
                          <span>{ep.qualifyingTracks.length} lokale tracks</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {ep.newUrisToAdd.length} nieuw te synchroniseren
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{ep.alreadySyncedUris.length} al in Spotify</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right 7 columns: Selected Playlist Preview & Tracks */}
                <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
                  {activePlaylistEval ? (
                    <div>
                      <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                            {activePlaylistEval.rule.name}
                          </h2>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                            Min. matchzekerheid: {activePlaylistEval.rule.filter.minConfidence}%
                            {activePlaylistEval.rule.filter.genreContains
                              ? ` · Genre: ${activePlaylistEval.rule.filter.genreContains}`
                              : ''}
                            {activePlaylistEval.rule.filter.folderContains
                              ? ` · Map: ${activePlaylistEval.rule.filter.folderContains}`
                              : ''}
                            {activePlaylistEval.rule.filter.minBpm
                              ? ` · BPM ≥ ${activePlaylistEval.rule.filter.minBpm}`
                              : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleRunDifferentialSync}
                          disabled={isSyncing}
                          className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
                        >
                          Synchroniseer Deze Lijst ({activePlaylistEval.newUrisToAdd.length} nieuw)
                        </button>
                      </div>

                      <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                        {activePlaylistEval.qualifyingTracks.length === 0 ? (
                          <div className="p-8 text-center text-slate-500">
                            Geen lokale muziekbestanden voldoen momenteel aan deze filtercriteria.
                          </div>
                        ) : (
                          activePlaylistEval.qualifyingTracks.map((trk, i) => {
                            const uri = trk.selectedMatch?.uri;
                            const isAlreadySynced =
                              uri && activePlaylistEval.rule.syncedTrackUris.includes(uri);
                            return (
                              <div
                                key={trk.id}
                                className="px-4 py-3 flex items-center justify-between gap-4"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="font-mono tabular-nums text-slate-400 w-5">
                                    {String(i + 1).padStart(2, '0')}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="font-medium text-slate-900 dark:text-white truncate">
                                      {trk.artist} — {trk.title}
                                    </div>
                                    <div className="text-[11px] text-slate-500 font-mono truncate">
                                      {trk.format} · {trk.bpm || '—'} BPM ·{' '}
                                      {uri || 'Geen Spotify URI gekoppeld'}
                                    </div>
                                  </div>
                                </div>
                                <div className="shrink-0 text-right font-mono text-[11px]">
                                  {isAlreadySynced ? (
                                    <span className="text-slate-500">Al in Spotify (=)</span>
                                  ) : uri ? (
                                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                      + Nieuw in wachtrij
                                    </span>
                                  ) : (
                                    <span className="text-amber-600 dark:text-amber-400">
                                      ! Alleen lokaal
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* ===================================================================
              VIEW 4: DIFFERENTIËLE SYNCHRONISATIE & EXPORT
             =================================================================== */}
          {activeTab === 'sync' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <h1 className="text-base font-semibold text-slate-900 dark:text-white">
                    Differentiële Bibliotheek-Synchronisatie
                  </h1>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Berekent het exacte verschil (diff) tussen je lokale muziekcollectie en je
                    Spotify-afspeellijsten zodat bestaande nummers nooit dubbel worden toegevoegd.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleExportSyncReport('json')}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>JSON Mapping</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportSyncReport('csv')}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>CSV Rapport</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportSyncReport('m3u8')}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Exporteer .M3U8</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRunDifferentialSync}
                    disabled={isSyncing}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap"
                  >
                    {isSyncing
                      ? 'Bezig met synchroniseren...'
                      : `Voer Synchronisatie Uit (+${totalPendingSyncTracks} tracks)`}
                  </button>
                </div>
              </div>

              {/* Differential Sync Queue Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-slate-900 dark:text-white">
                    Synchronisatieplan (Diff per Afspeellijst)
                  </h2>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    Modus:{' '}
                    {spotifyAuth.connected
                      ? `Live Spotify Account (${spotifyAuth.user?.display_name})`
                      : 'Lokale Staging (Verbind Spotify voor Live Push)'}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-900/80">
                        <th className="py-2.5 px-4">Afspeellijst</th>
                        <th className="py-2.5 px-4 text-right">Lokale Matches</th>
                        <th className="py-2.5 px-4 text-right">Reeds Gesynchroniseerd (=)</th>
                        <th className="py-2.5 px-4 text-right">Nieuw Toe te Voegen (+)</th>
                        <th className="py-2.5 px-4 text-right">Onbekend / Lokaal (!)</th>
                        <th className="py-2.5 px-4 text-right">Laatste Sync</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {evaluatedPlaylists.map((ep) => (
                        <tr key={ep.rule.id}>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {ep.rule.name}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {ep.rule.spotifyPlaylistId
                                ? `spotify:playlist:${ep.rule.spotifyPlaylistId}`
                                : 'Nieuwe afspeellijst bij eerstvolgende sync'}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            {ep.readyMatches.length}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">
                            {ep.alreadySyncedUris.length}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                            +{ep.newUrisToAdd.length}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                            {ep.unmatchedInRule}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">
                            {ep.rule.lastSyncedAt
                              ? new Date(ep.rule.lastSyncedAt).toLocaleString('nl-NL', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : 'Nog niet gesynchroniseerd'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Sync History Log */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="text-xs font-semibold text-slate-900 dark:text-white">
                    Synchronisatiegeschiedenis
                  </h2>
                </div>
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {syncHistory.map((item) => (
                    <div
                      key={item.id}
                      className="px-4 py-3 flex items-center justify-between gap-4"
                    >
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">
                          {item.playlistName}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px] ml-2">
                          · +{item.addedTracks} tracks toegevoegd · {item.skippedDuplicates}{' '}
                          duplicaten overgeslagen
                        </span>
                      </div>
                      <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500 shrink-0">
                        <span>
                          {new Date(item.timestamp).toLocaleString('nl-NL', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <a
                          href={item.spotifyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                        >
                          <span>Spotify</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Spotify OAuth Configuration & Redirect URI Modal */}
      {showOAuthModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-xl w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-500" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Spotify Developer OAuth Configuratie
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowOAuthModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Om afspeellijsten rechtstreeks in je persoonlijke Spotify-account aan te maken,
              voeg je onderstaande Redirect URI&apos;s toe in het{' '}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-600 dark:text-emerald-400 underline"
              >
                Spotify Developer Dashboard
              </a>{' '}
              en stel je <span className="font-mono">SPOTIFY_CLIENT_ID</span> en{' '}
              <span className="font-mono">SPOTIFY_CLIENT_SECRET</span> in bij de omgevingsvariabelen.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <div className="text-slate-500 dark:text-slate-400 mb-1 font-medium">
                  1. Development Redirect URI:
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded bg-slate-100 dark:bg-slate-950 font-mono text-[11px] text-slate-800 dark:text-slate-200 overflow-x-auto">
                    {devCallbackUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(devCallbackUrl, 'dev')}
                    className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                  >
                    {copiedUrlKey === 'dev' ? 'Gekopieerd' : 'Kopieer'}
                  </button>
                </div>
              </div>

              <div>
                <div className="text-slate-500 dark:text-slate-400 mb-1 font-medium">
                  2. Shared / Deployed Redirect URI:
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded bg-slate-100 dark:bg-slate-950 font-mono text-[11px] text-slate-800 dark:text-slate-200 overflow-x-auto">
                    {sharedCallbackUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(sharedCallbackUrl, 'shared')}
                    className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                  >
                    {copiedUrlKey === 'shared' ? 'Gekopieerd' : 'Kopieer'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowOAuthModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
              >
                Sluiten
              </button>
              <button
                type="button"
                onClick={handleConnectSpotify}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400"
              >
                Start Spotify OAuth Popup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
