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
  Download,
  ChevronRight,
  Sun,
  Moon,
  KeyRound,
  X,
  CheckCircle2,
  Server,
  HardDrive,
  Tag,
  Calendar,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  ListMusic,
  Layers,
  PanelLeft,
  PanelLeftClose,
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
  createID3v2TagBytes,
} from './utils/audioMetadataParser';
import initialVersionData from './version.json';
import { MP3SpotLogo, MP3SpotIcon } from './components/MP3SpotLogo';
import { InlineConfigPanel, SpotifyOAuthError } from './components/InlineConfigPanel';

type ActiveTab = 'library' | 'matcher' | 'playlists' | 'sync' | 'config';

interface BuildVersionInfo {
  date: string;
  buildNumber: number;
  version: string;
  builtAt: string;
}

interface SpotifyAuthStatus {
  connected: boolean;
  sessionId?: string;
  hasCredentials: boolean;
  clientId?: string;
  redirectUri: string;
  appUrl: string;
  user: {
    id: string;
    display_name: string;
    email?: string;
    product?: string;
    country?: string;
  } | null;
  lastError?: SpotifyOAuthError | null;
}

interface AppAuthStatus {
  authenticated: boolean;
  username?: string;
  musicLibraryPath: string;
  musicMountAvailable: boolean;
  dataPath?: string;
  dataMountAvailable?: boolean;
  exportsPath?: string;
  exportsMountAvailable?: boolean;
  buildInfo?: BuildVersionInfo;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function doesTrackMatchRule(track: LocalAudioTrack, rule: AutoPlaylistRule): boolean {
  const { filter } = rule;
  const effectiveYear = track.selectedMatch?.releaseYear || track.year;

  if (filter.exactYear !== undefined && effectiveYear !== filter.exactYear) {
    return false;
  }
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
  if (filter.minYear !== undefined && effectiveYear < filter.minYear) {
    return false;
  }
  if (filter.maxYear !== undefined && effectiveYear > filter.maxYear) {
    return false;
  }
  if (
    filter.onlyLossless &&
    track.format !== 'FLAC' &&
    track.format !== 'WAV' &&
    track.format !== 'AIFF'
  ) {
    return false;
  }
  return true;
}

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('library');
  // Optional sidebar on smaller screens (< lg hidden by default, toggleable drawer) + collapsible on desktop
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mp3spot_desktop_sidebar') !== 'closed';
    } catch {
      return true;
    }
  });

  const toggleDesktopSidebar = () => {
    setIsDesktopSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('mp3spot_desktop_sidebar', next ? 'open' : 'closed');
      } catch {
        // Ignore
      }
      return next;
    });
  };

  const handleSwitchTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setIsMobileSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // --- Build Version State (year.month.day[.build#], first build of day = 0) ---
  const [buildInfo, setBuildInfo] = useState<BuildVersionInfo>(() => ({
    date: initialVersionData.date || '2026.11.03',
    buildNumber: initialVersionData.buildNumber ?? 0,
    version: initialVersionData.version || '2026.11.03',
    builtAt: initialVersionData.builtAt || new Date().toISOString(),
  }));

  // --- Server Volumes & Path Status State ---
  const [appAuthStatus, setAppAuthStatus] = useState<AppAuthStatus>({
    authenticated: true,
    username: 'admin',
    musicLibraryPath: '/music',
    musicMountAvailable: false,
    dataPath: '/app/data',
    dataMountAvailable: true,
    exportsPath: '/exports',
    exportsMountAvailable: true,
  });

  // --- Dockhand / GitHub Stack Generator Modal State ---
  const [showDockhandModal, setShowDockhandModal] = useState<boolean>(false);
  const [dockhandMode, setDockhandMode] = useState<'git_clone' | 'git_build'>('git_clone');
  const [stackGitRepoUrl, setStackGitRepoUrl] = useState<string>(
    'https://github.com/jouw-gebruikersnaam/mp3spot.git'
  );
  const [stackMusicPath, setStackMusicPath] = useState<string>('/mnt/nas/muziek');
  const [stackDataPath, setStackDataPath] = useState<string>('mp3spot_data');
  const [stackExportsPath, setStackExportsPath] = useState<string>('./exports');
  const [stackPort, setStackPort] = useState<string>('3000');

  // Core Library, Playlist Rules & Sync History State
  const [tracks, setTracks] = useState<LocalAudioTrack[]>(() => {
    try {
      const saved = localStorage.getItem('mp3spot_tracks_v2');
      return saved ? JSON.parse(saved) : INITIAL_LOCAL_LIBRARY;
    } catch {
      return INITIAL_LOCAL_LIBRARY;
    }
  });

  const [playlistRules, setPlaylistRules] = useState<AutoPlaylistRule[]>(() => {
    try {
      const saved = localStorage.getItem('mp3spot_rules_v2');
      return saved ? JSON.parse(saved) : INITIAL_PLAYLIST_RULES;
    } catch {
      return INITIAL_PLAYLIST_RULES;
    }
  });

  const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('mp3spot_history_v2');
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
  const [matcherFilter, setMatcherFilter] = useState<'ALL' | 'review' | 'matched' | 'unmatched' | 'tagged'>('ALL');
  const [showInlineConfigBanner, setShowInlineConfigBanner] = useState<boolean>(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>(
    INITIAL_PLAYLIST_RULES[0]?.id || ''
  );

  // Scanning, Matching, ID3 Tagging & Syncing States
  const [isScanningFiles, setIsScanningFiles] = useState<boolean>(false);
  const [scanProgressText, setScanProgressText] = useState<string>('');
  const [isBatchMatching, setIsBatchMatching] = useState<boolean>(false);
  const [isWritingId3, setIsWritingId3] = useState<boolean>(false);
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
    exactYear: string;
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
    exactYear: '',
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
    lastError: null,
  });
  const [sessionIdToken, setSessionIdToken] = useState<string>(() => {
    return localStorage.getItem('mp3spot_session_id') || '';
  });
  const [showOAuthModal, setShowOAuthModal] = useState<boolean>(false);
  const [copiedUrlKey, setCopiedUrlKey] = useState<string | null>(null);
  const [modalClientId, setModalClientId] = useState<string>('');
  const [modalClientSecret, setModalClientSecret] = useState<string>('');
  const [isSavingModalCreds, setIsSavingModalCreds] = useState<boolean>(false);
  const [isTestingModalCreds, setIsTestingModalCreds] = useState<boolean>(false);
  const [modalTestMessage, setModalTestMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isWaitingForOAuthPopup, setIsWaitingForOAuthPopup] = useState<boolean>(false);
  const oauthPopupRef = useRef<Window | null>(null);

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

  // Automatically ensure every track available on Spotify has a corresponding Year Playlist rule ("MP3Spot Jaar: YYYY")
  useEffect(() => {
    const matchedYears = new Set<number>();
    for (const t of tracks) {
      if (t.selectedMatch) {
        const y = t.selectedMatch.releaseYear || t.year;
        if (y && y >= 1900 && y <= 2100) {
          matchedYears.add(y);
        }
      }
    }

    if (matchedYears.size === 0) return;

    setPlaylistRules((prevRules) => {
      const existingYearRules = new Set<number>();
      for (const r of prevRules) {
        if (r.filter.exactYear !== undefined) {
          existingYearRules.add(r.filter.exactYear);
        }
      }

      const missingYears = Array.from(matchedYears)
        .filter((y) => !existingYearRules.has(y))
        .sort((a, b) => b - a);

      if (missingYears.length === 0) return prevRules;

      const newYearRules: AutoPlaylistRule[] = missingYears.map((yr) => ({
        id: `rule_year_${yr}`,
        name: `MP3Spot Jaar: ${yr}`,
        description: `Automatische jaar-afspeellijst voor alle tracks op Spotify uit ${yr}`,
        strategy: 'year',
        isPublic: false,
        autoSync: true,
        filter: {
          exactYear: yr,
          minConfidence: 68,
        },
        syncedTrackUris: [],
      }));

      return [...prevRules, ...newYearRules];
    });
  }, [tracks]);

  // Build auth headers for API calls
  const getAuthHeaders = (_overrideAppToken?: string, overrideSpotifySession?: string) => {
    const headers: Record<string, string> = {};
    const localSpotifySession =
      typeof localStorage !== 'undefined' ? localStorage.getItem('mp3spot_session_id') || '' : '';
    const spSid = overrideSpotifySession || sessionIdToken || localSpotifySession;
    if (spSid) headers['x-spotify-session'] = spSid;
    return headers;
  };

  // Fetch Build Info from server
  const fetchBuildInfo = async () => {
    try {
      const resp = await fetch('/api/build-info');
      if (resp.ok) {
        const data = (await resp.json()) as BuildVersionInfo;
        if (data.version) setBuildInfo(data);
      }
    } catch {
      // Keep bundled version.json
    }
  };

  // Increment/Bump Build Number (simulates subsequent build on same day: year.month.day.build#)
  const handleBumpBuildVersion = async () => {
    try {
      const resp = await fetch('/api/build-info/bump', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (resp.ok) {
        const data = (await resp.json()) as BuildVersionInfo;
        setBuildInfo(data);
        setNoticeBanner({
          type: 'success',
          message: `Build versie bijgewerkt naar v${data.version} (datum: ${data.date}, build# van vandaag: ${data.buildNumber}).`,
        });
      }
    } catch {
      // Ignore error
    }
  };

  // Load persisted state from /app/data volume
  const loadServerVolumeState = async () => {
    try {
      const resp = await fetch('/api/server-state', {
        headers: getAuthHeaders(),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.exists && data.state) {
          if (Array.isArray(data.state.tracks) && data.state.tracks.length > 0) {
            setTracks(data.state.tracks);
          }
          if (Array.isArray(data.state.playlistRules) && data.state.playlistRules.length > 0) {
            setPlaylistRules(data.state.playlistRules);
          }
          if (Array.isArray(data.state.syncHistory) && data.state.syncHistory.length > 0) {
            setSyncHistory(data.state.syncHistory);
          }
        }
      }
    } catch {
      // Ignore fallback to localStorage
    }
  };

  // Fetch volume paths and system status on mount
  const fetchAppAuthStatus = async () => {
    try {
      const resp = await fetch('/api/app-auth/status', {
        headers: getAuthHeaders(),
      });
      if (resp.ok) {
        const data = (await resp.json()) as AppAuthStatus;
        setAppAuthStatus(data);
        if (data.buildInfo?.version) {
          setBuildInfo(data.buildInfo);
        }
      }
    } catch {
      // Ignore network error on boot
    }
  };

  useEffect(() => {
    fetchBuildInfo();
    fetchAppAuthStatus();
    fetchSpotifyStatus();
    loadServerVolumeState();
  }, []);

  // Scan Server Mounted Docker Directory (/music)
  const handleScanServerVolume = async () => {
    setIsScanningFiles(true);
    setScanProgressText(
      `Scannen van gemounte Docker-map (${appAuthStatus.musicLibraryPath || '/music'})...`
    );
    try {
      const resp = await fetch('/api/server-library/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ path: appAuthStatus.musicLibraryPath || '/music' }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setNoticeBanner({
          type: 'warning',
          message: data.error || 'Kon servermap niet scannen.',
        });
        return;
      }
      if (!data.tracks || data.tracks.length === 0) {
        setNoticeBanner({
          type: 'info',
          message: `De gemounte map "${data.path}" is bereikbaar, maar bevat nog geen audiobestanden. Koppel je muziekmap via volumes in je Dockhand stack.`,
        });
        return;
      }
      setTracks((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const fresh = (data.tracks as LocalAudioTrack[]).filter((t) => !existingIds.has(t.id));
        return [...fresh, ...prev];
      });
      await runBatchMatcher(data.tracks);
    } catch {
      setNoticeBanner({
        type: 'warning',
        message: 'Kon de servermap niet uitlezen.',
      });
    } finally {
      setIsScanningFiles(false);
      setScanProgressText('');
    }
  };

  // Write Spotify ID3v2.3 Metadata Tags to Local Audio Files (Server /music Volume + Local State)
  const handleWriteSpotifyId3Tags = async (targetTracks?: LocalAudioTrack[]) => {
    const listToTag = (targetTracks || tracks).filter((t) => t.selectedMatch);
    if (listToTag.length === 0) {
      setNoticeBanner({
        type: 'warning',
        message: 'Geen nummers met een gekoppelde Spotify-match gevonden om te taggen.',
      });
      return;
    }

    setIsWritingId3(true);
    try {
      const itemsPayload = listToTag.map((t) => {
        const match = t.selectedMatch!;
        return {
          trackId: t.id,
          folderPath: t.folderPath,
          fileName: t.fileName,
          title: match.title,
          artist: match.artist,
          album: match.album,
          year: match.releaseYear || t.year,
          genre: t.genre,
          isrc: match.isrc || t.isrc,
          bpm: t.bpm,
          spotifyUri: match.uri,
        };
      });

      let diskWrittenCount = 0;
      try {
        const resp = await fetch('/api/server-library/write-id3', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ items: itemsPayload }),
        });
        if (resp.ok) {
          const data = await resp.json();
          diskWrittenCount = (data.results || []).filter((r: any) => r.writtenToDisk).length;
        }
      } catch {
        // Fallback to local state tagging if offline
      }

      const nowIso = new Date().toISOString();
      const targetIds = new Set(listToTag.map((t) => t.id));

      setTracks((prev) =>
        prev.map((trk) => {
          if (!targetIds.has(trk.id) || !trk.selectedMatch) return trk;
          const m = trk.selectedMatch;
          return {
            ...trk,
            title: m.title,
            artist: m.artist,
            album: m.album,
            year: m.releaseYear || trk.year,
            isrc: m.isrc || trk.isrc,
            tagSource: 'Spotify ID3v2.3',
            id3TaggedFromSpotify: true,
            id3TaggedAt: nowIso,
          };
        })
      );

      setNoticeBanner({
        type: 'success',
        message:
          diskWrittenCount > 0
            ? `Spotify ID3v2.3 tags (TIT2, TPE1, TALB, TYER, TSRC, WOAF) naar ${listToTag.length} nummers geschreven (${diskWrittenCount} direct op het /music volume bijgewerkt).`
            : `Spotify ID3v2.3 metadata (Titel, Artiest, Album, Jaar, ISRC & Spotify URI) toegepast op ${listToTag.length} lokale bestanden.`,
      });
    } finally {
      setIsWritingId3(false);
    }
  };

  // Download binary ID3v2.3 tag header / tagged MP3 file in browser
  const handleDownloadBinaryId3File = (track: LocalAudioTrack) => {
    const match = track.selectedMatch;
    const id3Bytes = createID3v2TagBytes({
      title: match?.title || track.title,
      artist: match?.artist || track.artist,
      album: match?.album || track.album,
      year: match?.releaseYear || track.year,
      genre: track.genre,
      isrc: match?.isrc || track.isrc,
      bpm: track.bpm,
      spotifyUri: match?.uri,
    });

    const blob = new Blob([id3Bytes.buffer as ArrayBuffer], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const baseName = track.fileName.replace(/\.[^.]+$/, '');
    a.href = url;
    a.download = `${baseName}.spotify-id3v2.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    handleWriteSpotifyId3Tags([track]);
  };

  // Persist library & rules to localStorage AND to /app/data volume
  useEffect(() => {
    try {
      localStorage.setItem('mp3spot_tracks_v2', JSON.stringify(tracks));
      localStorage.setItem('mp3spot_rules_v2', JSON.stringify(playlistRules));
      localStorage.setItem('mp3spot_history_v2', JSON.stringify(syncHistory));
    } catch {
      // Ignore quota errors
    }

    const timer = setTimeout(() => {
      fetch('/api/server-state', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          updatedAt: new Date().toISOString(),
          tracks,
          playlistRules,
          syncHistory,
        }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [tracks, playlistRules, syncHistory]);

  const fetchSpotifyStatus = async (overrideSpotifySid?: string) => {
    try {
      const resp = await fetch(
        `/api/auth/spotify/status?origin=${encodeURIComponent(window.location.origin)}`,
        {
          headers: getAuthHeaders(undefined, overrideSpotifySid),
        }
      );
      if (resp.ok) {
        const data = (await resp.json()) as SpotifyAuthStatus;
        setSpotifyAuth(data);
        if (data.clientId && !modalClientId) {
          setModalClientId(data.clientId);
        }
        if (data.connected && data.sessionId) {
          setSessionIdToken(data.sessionId);
          try {
            localStorage.setItem('mp3spot_session_id', data.sessionId);
          } catch {
            // Ignore
          }
        }
        return data;
      }
    } catch {
      // Keep local fallback
    }
    return null;
  };

  // Process OAuth callback event from either postMessage or localStorage
  const processOAuthResultPayload = (payload: any) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.type === 'OAUTH_AUTH_SUCCESS') {
      const newSessionId = payload.sessionId || '';
      if (newSessionId) {
        setSessionIdToken(newSessionId);
        try {
          localStorage.setItem('mp3spot_session_id', newSessionId);
        } catch {
          // Ignore
        }
      }
      setIsWaitingForOAuthPopup(false);
      fetchSpotifyStatus(newSessionId);
      setShowOAuthModal(false);
      setNoticeBanner({
        type: 'success',
        message: `Succesvol verbonden met Spotify${
          payload.displayName ? ` als ${payload.displayName}` : ''
        }. Live synchronisatie is nu actief!`,
      });
    } else if (payload.type === 'OAUTH_AUTH_ERROR') {
      setIsWaitingForOAuthPopup(false);
      fetchSpotifyStatus();
      const errMsg =
        payload.errorObj?.message ||
        payload.error ||
        'Er is een fout opgetreden bij het verbinden met Spotify.';
      const errHint = payload.errorObj?.hint ? ` — ${payload.errorObj.hint}` : '';
      setNoticeBanner({
        type: 'warning',
        message: `Spotify OAuth fout: ${errMsg}${errHint}`,
      });
      setShowOAuthModal(true);
    }
  };

  // Listen for OAuth Popup postMessage callback, localStorage fallback & window focus
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.data?.type !== 'OAUTH_AUTH_SUCCESS' &&
        event.data?.type !== 'OAUTH_AUTH_ERROR'
      ) {
        return;
      }
      const origin = event.origin || '';
      const isTrustedOrigin =
        origin === window.location.origin ||
        origin.endsWith('.run.app') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1');
      // Accept if origin matches current host/run.app/localhost or has valid MP3Spot OAuth payload
      if (!isTrustedOrigin && !event.data?.type?.startsWith('OAUTH_AUTH_')) {
        return;
      }
      processOAuthResultPayload(event.data);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'mp3spot_oauth_result' && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          processOAuthResultPayload(parsed);
        } catch {
          // Ignore parse error
        }
      } else if (event.key === 'mp3spot_session_id' && event.newValue) {
        setSessionIdToken(event.newValue);
        fetchSpotifyStatus(event.newValue);
      }
    };

    const handleWindowFocus = () => {
      fetchSpotifyStatus();
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [sessionIdToken]);

  // Poll backend status while OAuth popup is open so connection/errors are detected even if window.opener is severed
  useEffect(() => {
    if (!isWaitingForOAuthPopup) return;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const rawStored = localStorage.getItem('mp3spot_oauth_result');
        if (rawStored) {
          localStorage.removeItem('mp3spot_oauth_result');
          const parsed = JSON.parse(rawStored);
          processOAuthResultPayload(parsed);
          return;
        }
      } catch {
        // Ignore
      }

      const status = await fetchSpotifyStatus();
      if (status?.connected) {
        setIsWaitingForOAuthPopup(false);
        setShowOAuthModal(false);
        try {
          if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
            oauthPopupRef.current.close();
          }
        } catch {
          // Ignore
        }
        setNoticeBanner({
          type: 'success',
          message: `Verbonden met Spotify als ${status.user?.display_name || 'Spotify Gebruiker'}. Live synchronisatie is nu actief!`,
        });
      } else if (status?.lastError) {
        setIsWaitingForOAuthPopup(false);
        setNoticeBanner({
          type: 'warning',
          message: `Spotify OAuth fout (${status.lastError.code}): ${status.lastError.message}${
            status.lastError.hint ? ` — ${status.lastError.hint}` : ''
          }`,
        });
        setShowOAuthModal(true);
      } else if (
        (oauthPopupRef.current && oauthPopupRef.current.closed) ||
        attempts > 90
      ) {
        setIsWaitingForOAuthPopup(false);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isWaitingForOAuthPopup]);

  const handleSaveModalCredentials = async () => {
    if (!modalClientId.trim() && !modalClientSecret.trim()) return true;
    setIsSavingModalCreds(true);
    try {
      const resp = await fetch('/api/auth/spotify/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: modalClientId.trim() || undefined,
          clientSecret: modalClientSecret.trim() || undefined,
        }),
      });
      if (resp.ok) {
        setModalClientSecret('');
        await fetchSpotifyStatus();
        return true;
      }
    } catch {
      // Ignore
    } finally {
      setIsSavingModalCreds(false);
    }
    return false;
  };

  const handleTestModalCredentials = async () => {
    setIsTestingModalCreds(true);
    setModalTestMessage(null);
    try {
      const resp = await fetch(
        `/api/auth/spotify/test?origin=${encodeURIComponent(window.location.origin)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: modalClientId.trim() || undefined,
            clientSecret: modalClientSecret.trim() || undefined,
          }),
        }
      );
      const data = await resp.json();
      if (resp.ok && data.ok) {
        setModalClientSecret('');
        setModalTestMessage({ ok: true, text: data.message });
      } else {
        setModalTestMessage({
          ok: false,
          text: data.error?.message || 'API-sleutels konden niet worden geverifieerd.',
        });
      }
      await fetchSpotifyStatus();
    } catch {
      setModalTestMessage({
        ok: false,
        text: 'Netwerkfout bij het testen van de Spotify API-sleutels.',
      });
    } finally {
      setIsTestingModalCreds(false);
    }
  };

  const handleClearSpotifyError = async () => {
    setModalTestMessage(null);
    await fetch('/api/auth/spotify/clear-error', { method: 'POST' }).catch(() => {});
    await fetchSpotifyStatus();
  };

  const handleConnectSpotify = async () => {
    try {
      // Clear any stale localStorage oauth event
      try {
        localStorage.removeItem('mp3spot_oauth_result');
      } catch {
        // Ignore
      }
      await fetch('/api/auth/spotify/clear-error', { method: 'POST' }).catch(() => {});

      if (modalClientId.trim() || modalClientSecret.trim()) {
        await handleSaveModalCredentials();
      }

      const resp = await fetch(
        `/api/auth/spotify/url?origin=${encodeURIComponent(window.location.origin)}`,
        {
          headers: getAuthHeaders(),
        }
      );
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        await fetchSpotifyStatus();
        setShowOAuthModal(true);
        if (errData.error) {
          setNoticeBanner({
            type: 'warning',
            message: `Spotify configuratie vereist: ${errData.error}`,
          });
        }
        return;
      }
      const { url } = await resp.json();
      const popup = window.open(url, 'spotify_oauth_popup', 'width=560,height=720');
      oauthPopupRef.current = popup;
      if (!popup) {
        setShowOAuthModal(true);
        setNoticeBanner({
          type: 'warning',
          message: 'Pop-up werd geblokkeerd door de browser. Sta pop-ups toe voor deze pagina.',
        });
      } else {
        setIsWaitingForOAuthPopup(true);
      }
    } catch {
      setShowOAuthModal(true);
    }
  };

  const handleDisconnectSpotify = async () => {
    try {
      await fetch('/api/auth/spotify/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      setSessionIdToken('');
      try {
        localStorage.removeItem('mp3spot_session_id');
        localStorage.removeItem('mp3spot_oauth_result');
      } catch {
        // Ignore
      }
      fetchSpotifyStatus('');
      setNoticeBanner({
        type: 'info',
        message: 'Spotify-sessie ontkoppeld.',
      });
    } catch {
      // Ignore error
    }
  };

  // Batch Match local tracks via Backend API & Auto-Tag with Spotify ID3
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
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ tracks: payload }),
      });

      if (resp.ok) {
        const data = (await resp.json()) as {
          source: string;
          results: Record<string, SpotifyCandidate[]>;
        };

        const nowIso = new Date().toISOString();
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

            const matchedCandidate = best.confidence >= 68 ? best : trk.selectedMatch;

            // Automatically enrich local ID3 tags when high-confidence Spotify match is found
            if (matchedCandidate && best.confidence >= 90) {
              return {
                ...trk,
                candidates: cands,
                selectedMatch: matchedCandidate,
                matchStatus: newStatus,
                year: matchedCandidate.releaseYear || trk.year,
                isrc: matchedCandidate.isrc || trk.isrc,
                tagSource: 'Spotify ID3v2.3',
                id3TaggedFromSpotify: true,
                id3TaggedAt: nowIso,
              };
            }

            return {
              ...trk,
              candidates: cands,
              selectedMatch: matchedCandidate,
              matchStatus: newStatus,
            };
          })
        );

        setNoticeBanner({
          type: 'success',
          message: `${listToMatch.length} lokale muziekbestanden gematcht met Spotify, voorzien van Spotify ID3-tags en gekoppeld aan hun Jaar-afspeellijst.`,
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
      setScanProgressText(`Analyseren (${i + 1}/${validFiles.length}): ${f.name}`);
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

  // Distinct Years for Spotify-matched tracks
  const yearStats = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of tracks) {
      if (t.selectedMatch) {
        const y = t.selectedMatch.releaseYear || t.year;
        map.set(y, (map.get(y) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [tracks]);

  // Filtered tracks for Library & Matcher views
  const filteredTracks = useMemo(() => {
    return tracks.filter((t) => {
      if (selectedFolder !== 'ALL' && t.folderPath !== selectedFolder) return false;
      if (statusFilter !== 'ALL' && t.matchStatus !== statusFilter) return false;
      if (formatFilter !== 'ALL' && t.format !== formatFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${t.title} ${t.artist} ${t.album} ${t.genre} ${t.fileName} ${t.year} ${
          t.isrc || ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tracks, selectedFolder, statusFilter, formatFilter, searchQuery]);

  // Filtered tracks specifically for Spotify Matcher view
  const matcherFilteredTracks = useMemo(() => {
    return tracks.filter((t) => {
      if (selectedFolder !== 'ALL' && t.folderPath !== selectedFolder) return false;
      if (matcherFilter === 'review' && t.matchStatus !== 'review') return false;
      if (matcherFilter === 'matched' && t.matchStatus !== 'matched' && t.matchStatus !== 'synced') return false;
      if (matcherFilter === 'unmatched' && t.matchStatus !== 'unmatched') return false;
      if (matcherFilter === 'tagged' && !t.id3TaggedFromSpotify) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${t.title} ${t.artist} ${t.album} ${t.genre} ${t.fileName} ${t.year} ${
          t.isrc || ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tracks, selectedFolder, matcherFilter, searchQuery]);

  // Library Summary Metrics
  const metrics = useMemo(() => {
    const total = tracks.length;
    const exactOrSynced = tracks.filter(
      (t) => t.matchStatus === 'matched' || t.matchStatus === 'synced'
    ).length;
    const reviewCount = tracks.filter((t) => t.matchStatus === 'review').length;
    const unmatchedCount = tracks.filter((t) => t.matchStatus === 'unmatched').length;
    const syncedCount = tracks.filter((t) => t.matchStatus === 'synced').length;
    const id3TaggedCount = tracks.filter((t) => t.id3TaggedFromSpotify).length;
    const totalSizeMB = tracks.reduce((acc, t) => acc + t.fileSizeMB, 0);

    return {
      total,
      exactOrSynced,
      reviewCount,
      unmatchedCount,
      syncedCount,
      id3TaggedCount,
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
          t.selectedMatch && t.selectedMatch.confidence >= rule.filter.minConfidence
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

  // Select a candidate match for a track & tag with Spotify ID3
  const handleSelectCandidate = (trackId: string, candidate: SpotifyCandidate) => {
    const nowIso = new Date().toISOString();
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
          year: candidate.releaseYear || t.year,
          isrc: candidate.isrc || t.isrc,
          tagSource: 'Spotify ID3v2.3',
          id3TaggedFromSpotify: true,
          id3TaggedAt: nowIso,
        };
      })
    );
    setNoticeBanner({
      type: 'success',
      message: `Spotify match gekoppeld, ID3v2.3 getagd en ingedeeld in "MP3Spot Jaar: ${candidate.releaseYear}": "${candidate.artist} — ${candidate.title}"`,
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
          headers: getAuthHeaders(),
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

  // Auto-generate playlist rules from folders
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

  // Ensure Year Playlists exist for all years in library
  const handleGenerateRulesFromYears = () => {
    const existingYears = new Set(
      playlistRules.map((r) => r.filter.exactYear).filter((y): y is number => y !== undefined)
    );
    const created: AutoPlaylistRule[] = [];

    for (const [yr] of yearStats) {
      if (existingYears.has(yr)) continue;
      created.push({
        id: `rule_year_${yr}`,
        name: `MP3Spot Jaar: ${yr}`,
        description: `Automatische jaar-afspeellijst voor alle tracks op Spotify uit ${yr}`,
        strategy: 'year',
        isPublic: false,
        autoSync: true,
        filter: {
          exactYear: yr,
          minConfidence: 68,
        },
        syncedTrackUris: [],
      });
    }

    if (created.length === 0) {
      setNoticeBanner({
        type: 'info',
        message: `Alle ${yearStats.length} releasejaren van je gematchte Spotify-nummers hebben al een eigen "MP3Spot Jaar"-afspeellijst.`,
      });
      return;
    }

    setPlaylistRules((prev) => [...prev, ...created]);
    setSelectedPlaylistId(created[0].id);
    setNoticeBanner({
      type: 'success',
      message: `${created.length} nieuwe jaar-afspeellijsten aangemaakt.`,
    });
  };

  const handleCreateCustomRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleDraft.name.trim()) return;

    const exactYr = newRuleDraft.exactYear ? Number(newRuleDraft.exactYear) : undefined;
    const newRule: AutoPlaylistRule = {
      id: `rule_custom_${Date.now()}`,
      name: newRuleDraft.name.trim(),
      description:
        newRuleDraft.description.trim() ||
        'Slimme afspeellijst op basis van lokale metadata-filters.',
      strategy: exactYr ? 'year' : 'custom_rule',
      isPublic: newRuleDraft.isPublic,
      autoSync: true,
      filter: {
        exactYear: exactYr,
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
      exactYear: '',
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
          'Alle afspeellijsten (inclusief jaar-afspeellijsten) zijn al volledig up-to-date.',
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
          ...getAuthHeaders(),
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
              ? `Live Spotify Synchronisatie voltooid: ${totalAdded} nieuwe nummers toegevoegd over ${data.results.length} afspeellijsten (waaronder de Jaar-afspeellijsten).`
              : `Synchronisatie-diff geregistreerd (${totalAdded} nieuwe nummers over ${data.results.length} afspeellijsten). Verbind je Spotify-account om ze direct naar je Spotify-profiel te pushen.`,
        });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  // Build export payload string for JSON, CSV, or M3U8
  const buildExportContent = (format: 'json' | 'csv' | 'm3u8') => {
    let content = '';
    let mime = 'application/json';
    let filename = `mp3spot-bibliotheek-${new Date().toISOString().slice(0, 10)}.json`;

    if (format === 'json') {
      content = JSON.stringify(
        {
          app: 'MP3Spot',
          buildVersion: buildInfo.version,
          exportedAt: new Date().toISOString(),
          totalTracks: tracks.length,
          playlists: evaluatedPlaylists.map((ep) => ({
            name: ep.rule.name,
            strategy: ep.rule.strategy,
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
            year: t.year,
            isrc: t.isrc,
            id3TaggedFromSpotify: Boolean(t.id3TaggedFromSpotify),
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
      filename = `mp3spot-mapping-${new Date().toISOString().slice(0, 10)}.csv`;
      const header =
        'Bestandsnaam,Map,Artiest,Titel,Album,Genre,Jaar,BPM,ISRC,ID3_Getagd,Status,Spotify_URI,Match_Score\n';
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
            t.id3TaggedFromSpotify ? 'Ja' : 'Nee',
            t.matchStatus,
            t.selectedMatch?.uri || '',
            t.selectedMatch?.confidence || 0,
          ].join(',')
        )
        .join('\n');
      content = header + rows;
    } else {
      mime = 'audio/x-mpegurl;charset=utf-8';
      filename = `mp3spot-export.m3u8`;
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

    return { content, mime, filename };
  };

  // Export Library Mapping as Browser Download
  const handleExportSyncReport = (format: 'json' | 'csv' | 'm3u8') => {
    const { content, mime, filename } = buildExportContent(format);
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

  // Write Export Directly to Mounted Docker /exports Volume
  const handleWriteExportToVolume = async (format: 'json' | 'csv' | 'm3u8') => {
    const { content, filename } = buildExportContent(format);
    try {
      const resp = await fetch('/api/server-library/export-to-volume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ filename, content }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setNoticeBanner({
          type: 'success',
          message: `Bestand rechtstreeks weggeschreven naar je Docker export-volume: ${data.savedPath}`,
        });
      } else {
        setNoticeBanner({
          type: 'warning',
          message: data.error || 'Kon niet schrijven naar het export-volume.',
        });
      }
    } catch {
      setNoticeBanner({
        type: 'warning',
        message: 'Netwerkfout bij schrijven naar het server export-volume.',
      });
    }
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

  // Generate Dockhand / Docker Compose YAML string dynamically with all 3 volume mappings (:rw on /music for ID3 tagging)
  const generatedDockhandYaml = useMemo(() => {
    const cleanRepo =
      stackGitRepoUrl.trim() || 'https://github.com/jouw-gebruikersnaam/mp3spot.git';
    const musicMount = stackMusicPath.trim() || '/mnt/nas/muziek';
    const dataMount = stackDataPath.trim() || 'mp3spot_data';
    const exportsMount = stackExportsPath.trim() || './exports';
    const isNamedDataVol = !dataMount.startsWith('/') && !dataMount.startsWith('.');

    if (dockhandMode === 'git_clone') {
      return `# ==============================================================================
# MP3Spot (v${buildInfo.version}) — Zero-Copy Dockhand Stack (Automatische GitHub Clone)
# Je hoeft GEEN bestanden handmatig te kopiëren. Plak deze YAML in Dockhand!
# De container haalt bij het opstarten zelf alle bronbestanden op van GitHub.
# ==============================================================================
services:
  mp3spot:
    image: node:22-alpine
    container_name: mp3spot
    restart: unless-stopped
    working_dir: /app
    ports:
      - "${stackPort || '3000'}:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - GIT_REPO_URL=${cleanRepo}
      - MUSIC_LIBRARY_PATH=/music
      - DATA_PATH=/data
      - EXPORTS_PATH=/exports
      - SPOTIFY_CLIENT_ID=\${SPOTIFY_CLIENT_ID:-}
      - SPOTIFY_CLIENT_SECRET=\${SPOTIFY_CLIENT_SECRET:-}
      - APP_URL=http://localhost:${stackPort || '3000'}
    volumes:
      # 1. Lokale muziekmap op de host/NAS (:rw voor Spotify ID3v2.3 tagging)
      - ${musicMount}:/music:rw
      # 2. Persistente database & app-status (buiten /app)
      - ${dataMount}:/data
      # 3. Geëxporteerde .m3u8, .json en .csv afspeellijsten op de host
      - ${exportsMount}:/exports
      # 4. Volume voor MP3Spot applicatiecode
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
        echo 'Updating MP3Spot repository from GitHub...' &&
        cd /app &&
        git remote set-url origin $$GIT_REPO_URL &&
        git fetch origin &&
        git reset --hard origin/HEAD &&
        git clean -fd;
      fi &&
      cd /app &&
      npm install --include=dev --legacy-peer-deps &&
      npm run build &&
      npm run start"

volumes:
  mp3spot_repo:${isNamedDataVol ? `\n  ${dataMount}:` : ''}`;
    }

    return `# ==============================================================================
# MP3Spot (v${buildInfo.version}) — Native Docker Git Build Stack voor Dockhand
# Docker bouwt de Dockerfile direct vanaf je GitHub-URL zonder lokale bestanden.
# ==============================================================================
services:
  mp3spot:
    build:
      context: ${cleanRepo.endsWith('.git') ? `${cleanRepo}#main` : cleanRepo}
      dockerfile: Dockerfile
    container_name: mp3spot
    restart: unless-stopped
    ports:
      - "${stackPort || '3000'}:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - MUSIC_LIBRARY_PATH=/music
      - DATA_PATH=/data
      - EXPORTS_PATH=/exports
      - SPOTIFY_CLIENT_ID=\${SPOTIFY_CLIENT_ID:-}
      - SPOTIFY_CLIENT_SECRET=\${SPOTIFY_CLIENT_SECRET:-}
      - APP_URL=http://localhost:${stackPort || '3000'}
    volumes:
      # 1. Lokale muziekmap op de host/NAS (:rw voor Spotify ID3v2.3 tagging)
      - ${musicMount}:/music:rw
      # 2. Persistente database & app-status (buiten /app)
      - ${dataMount}:/data
      # 3. Geëxporteerde .m3u8, .json en .csv afspeellijsten op de host
      - ${exportsMount}:/exports
${isNamedDataVol ? `\nvolumes:\n  ${dataMount}:` : ''}`;
  }, [
    buildInfo.version,
    dockhandMode,
    stackGitRepoUrl,
    stackMusicPath,
    stackDataPath,
    stackExportsPath,
    stackPort,
  ]);

  // Render Dockhand / GitHub Stack Modal
  const renderDockhandModal = () => {
    if (!showDockhandModal) return null;
    return (
      <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-xs">
        <div className="bg-white dark:bg-[#1E2124] border border-slate-300 dark:border-[#3A3D40] rounded-xl max-w-3xl w-full p-6 space-y-5 shadow-2xl my-8">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#3A3D40] pb-4">
            <div className="flex items-center gap-2.5">
              <Server className="w-5 h-5 text-[#FF8F00] shrink-0" />
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>MP3Spot Dockhand Stack & Volume Configuratie</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Huidige Build: <span className="font-mono font-semibold text-[#FF8F00]">v{buildInfo.version}</span>{' '}
                  (dag-build# <span className="font-mono">{buildInfo.buildNumber}</span>) · Volumes:{' '}
                  <span className="font-mono text-[#00B4D8]">/music:rw</span>,{' '}
                  <span className="font-mono text-[#00B4D8]">/data</span>,{' '}
                  <span className="font-mono text-[#00B4D8]">/exports</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDockhandModal(false)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Build Versioning Strip */}
          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <div className="font-semibold text-slate-900 dark:text-white font-mono flex items-center gap-2">
                <span>Build Versie: v{buildInfo.version}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FF8F00]/20 text-[#FF8F00] font-mono">
                  build# {buildInfo.buildNumber}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Formaat: <span className="font-mono">year.month.day.build#</span> — eerste build van
                de dag heeft <span className="font-mono">build# = 0</span> ({buildInfo.date}),
                volgende builds tonen <span className="font-mono">{buildInfo.date}.1</span>,{' '}
                <span className="font-mono">{buildInfo.date}.2</span>, enz.
              </div>
            </div>
            <button
              type="button"
              onClick={handleBumpBuildVersion}
              className="px-3 py-1.5 rounded-lg border border-[#FF8F00]/50 bg-[#FF8F00]/10 text-amber-900 dark:text-[#FF8F00] font-medium hover:bg-[#FF8F00]/20 transition-colors whitespace-nowrap shrink-0"
            >
              Simuleer Nieuwe Build (+1 build#)
            </button>
          </div>

          {/* Mode Selector */}
          <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-[#16181A] border border-slate-200 dark:border-[#3A3D40] rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setDockhandMode('git_clone')}
              className={`flex-1 py-2 px-3 font-medium rounded-md transition-colors ${
                dockhandMode === 'git_clone'
                  ? 'bg-white dark:bg-[#202225] text-slate-900 dark:text-white shadow-xs border border-slate-200 dark:border-[#3A3D40]'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Optie 1: Standalone Git-Clone Container (100% Zero-Copy YAML)
            </button>
            <button
              type="button"
              onClick={() => setDockhandMode('git_build')}
              className={`flex-1 py-2 px-3 font-medium rounded-md transition-colors ${
                dockhandMode === 'git_build'
                  ? 'bg-white dark:bg-[#202225] text-slate-900 dark:text-white shadow-xs border border-slate-200 dark:border-[#3A3D40]'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Optie 2: Native Docker Git Build Context
            </button>
          </div>

          {/* Interactive Parameters for the Stack YAML & Volumes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <div className="sm:col-span-2">
              <label className="block text-slate-500 dark:text-slate-400 mb-1">
                Jouw GitHub Repository URL
              </label>
              <input
                type="text"
                value={stackGitRepoUrl}
                onChange={(e) => setStackGitRepoUrl(e.target.value)}
                placeholder="https://github.com/gebruiker/mp3spot.git"
                className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
              />
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 mb-1">
                Webinterface Poort (`APP_PORT`)
              </label>
              <input
                type="text"
                value={stackPort}
                onChange={(e) => setStackPort(e.target.value)}
                placeholder="3000"
                className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
              />
            </div>

            {/* Volume Mapping Inputs */}
            <div>
              <label className="block text-slate-500 dark:text-slate-400 mb-1">
                Volume 1: Host Muziekmap (`:/music:rw`)
              </label>
              <input
                type="text"
                value={stackMusicPath}
                onChange={(e) => setStackMusicPath(e.target.value)}
                placeholder="/mnt/nas/muziek"
                className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
              />
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 mb-1">
                Volume 2: App Data (`:/data`)
              </label>
              <input
                type="text"
                value={stackDataPath}
                onChange={(e) => setStackDataPath(e.target.value)}
                placeholder="mp3spot_data of ./data"
                className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
              />
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 mb-1">
                Volume 3: Playlist Exports (`:/exports`)
              </label>
              <input
                type="text"
                value={stackExportsPath}
                onChange={(e) => setStackExportsPath(e.target.value)}
                placeholder="./exports"
                className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
              />
            </div>
          </div>

          {/* Generated YAML Code Block */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-600 dark:text-slate-300">
                Kopieer deze `docker-compose.yml` rechtstreeks in Dockhand:
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(generatedDockhandYaml, 'dockhand_yaml')}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 font-bold hover:brightness-110 transition-all shadow-sm"
              >
                {copiedUrlKey === 'dockhand_yaml'
                  ? 'YAML Gekopieerd!'
                  : 'Kopieer Dockhand YAML'}
              </button>
            </div>
            <pre className="p-4 rounded-lg bg-[#121416] text-[#E6E7E9] font-mono text-[11px] overflow-x-auto max-h-60 leading-relaxed border border-[#3A3D40]">
              {generatedDockhandYaml}
            </pre>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-[#3A3D40] text-xs text-slate-500 dark:text-slate-400">
            <span>
              Zie ook `README.md` in de hoofdmap voor de volledige GitHub- en volume-documentatie.
            </span>
            <button
              type="button"
              onClick={() => setShowDockhandModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D40] text-slate-700 dark:text-slate-200 font-medium hover:border-[#FF8F00] transition-colors"
            >
              Sluiten
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F0F2F4] dark:bg-[#16181A] text-slate-900 dark:text-[#E6E7E9] flex flex-col">
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

      {/* Top Bar Navigation: Sidebar Toggle + Brand + Polished Responsive Segmented Tabs + Quick Actions */}
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-[#3A3D40] bg-white/95 dark:bg-[#1E2124]/95 backdrop-blur-md sticky top-0 z-30 shadow-xs">
        {/* Zone 1: Optional Sidebar Toggle + Brand anchor */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Mobile / Tablet (< lg) Optional Sidebar Drawer Toggle */}
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen((v) => !v)}
            className={`lg:hidden flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
              isMobileSidebarOpen || selectedFolder !== 'ALL'
                ? 'border-[#FF8F00] bg-[#FF8F00]/15 text-[#FF8F00]'
                : 'border-slate-200 dark:border-[#3A3D40] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#2A2D30]'
            }`}
            title="Zijbalk met mappen & lijsten openen/sluiten"
            aria-label="Zijbalk wisselen"
          >
            {isMobileSidebarOpen ? (
              <PanelLeftClose className="w-4 h-4 text-[#FF8F00]" />
            ) : (
              <PanelLeft className="w-4 h-4 text-[#FF8F00]" />
            )}
            <span className="hidden sm:inline">Zijbalk</span>
            {selectedFolder !== 'ALL' && (
              <span className="w-2 h-2 rounded-full bg-[#FF8F00]" />
            )}
          </button>

          {/* Desktop (lg+) Collapsible Sidebar Toggle */}
          <button
            type="button"
            onClick={toggleDesktopSidebar}
            className="hidden lg:flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-[#3A3D40] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2A2D30] transition-colors cursor-pointer"
            title={isDesktopSidebarOpen ? 'Zijbalk inklappen' : 'Zijbalk uitklappen'}
            aria-label="Zijbalk inklappen of uitklappen"
          >
            {isDesktopSidebarOpen ? (
              <PanelLeftClose className="w-4 h-4 text-[#FF8F00]" />
            ) : (
              <PanelLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            )}
          </button>

          <a
            href="#bibliotheek"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('library');
            }}
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 font-display hover:opacity-90 transition-opacity"
          >
            <MP3SpotIcon size={30} />
            <div className="flex flex-col">
              <span className="leading-tight">
                MP3<span className="text-[#FF8F00]">Spot</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400 font-normal leading-none">
                v{buildInfo.version}
              </span>
            </div>
          </a>
        </div>

        {/* Zone 2: Polished 5-Tab Segmented Control (Always visible & responsive) */}
        <nav
          className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-[#151719] border border-slate-200 dark:border-[#3A3D40] rounded-xl overflow-x-auto no-scrollbar max-w-full"
          role="tablist"
          aria-label="MP3Spot Hoofdnavigatie"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'library'}
            onClick={() => handleSwitchTab('library')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'library'
                ? 'bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 font-bold shadow-md ring-1 ring-[#FF8F00]/50 scale-[1.02]'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/80 dark:hover:bg-[#202225]'
            }`}
          >
            <FolderOpen className={`w-3.5 h-3.5 ${activeTab === 'library' ? 'text-slate-950' : 'text-[#FF8F00]'}`} />
            <span>Bibliotheek</span>
            <span
              className={`font-mono tabular-nums text-[10px] px-1.5 py-0.2 rounded-full ${
                activeTab === 'library'
                  ? 'bg-slate-950/20 text-slate-950 font-bold'
                  : 'bg-slate-200 dark:bg-[#2A2D30] text-slate-600 dark:text-slate-400'
              }`}
            >
              {metrics.total}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'matcher'}
            onClick={() => handleSwitchTab('matcher')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'matcher'
                ? 'bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 font-bold shadow-md ring-1 ring-[#FF8F00]/50 scale-[1.02]'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/80 dark:hover:bg-[#202225]'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${activeTab === 'matcher' ? 'text-slate-950' : 'text-[#00B4D8]'}`} />
            <span>Spotify Matcher</span>
            <span
              className={`font-mono tabular-nums text-[10px] px-1.5 py-0.2 rounded-full ${
                activeTab === 'matcher'
                  ? 'bg-slate-950/20 text-slate-950 font-bold'
                  : 'bg-[#FF8F00]/20 text-[#FF8F00]'
              }`}
            >
              {metrics.matchRatePct}%
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'playlists'}
            onClick={() => handleSwitchTab('playlists')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'playlists'
                ? 'bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 font-bold shadow-md ring-1 ring-[#FF8F00]/50 scale-[1.02]'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/80 dark:hover:bg-[#202225]'
            }`}
          >
            <Calendar className={`w-3.5 h-3.5 ${activeTab === 'playlists' ? 'text-slate-950' : 'text-[#FF8F00]'}`} />
            <span>Slimme Lijsten</span>
            <span
              className={`font-mono tabular-nums text-[10px] px-1.5 py-0.2 rounded-full ${
                activeTab === 'playlists'
                  ? 'bg-slate-950/20 text-slate-950 font-bold'
                  : 'bg-slate-200 dark:bg-[#2A2D30] text-slate-600 dark:text-slate-400'
              }`}
            >
              {evaluatedPlaylists.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sync'}
            onClick={() => handleSwitchTab('sync')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'sync'
                ? 'bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 font-bold shadow-md ring-1 ring-[#FF8F00]/50 scale-[1.02]'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/80 dark:hover:bg-[#202225]'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${activeTab === 'sync' ? 'text-slate-950 animate-spin' : 'text-[#00B4D8]'}`} />
            <span>Synchronisatie</span>
            {totalPendingSyncTracks > 0 && (
              <span
                className={`font-mono tabular-nums text-[10px] px-1.5 py-0.2 rounded-full ${
                  activeTab === 'sync'
                    ? 'bg-slate-950/20 text-slate-950 font-bold'
                    : 'bg-[#00B4D8]/20 text-[#00B4D8] font-bold'
                }`}
              >
                +{totalPendingSyncTracks}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'config'}
            onClick={() => handleSwitchTab('config')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'config'
                ? 'bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 font-bold shadow-md ring-1 ring-[#FF8F00]/50 scale-[1.02]'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/80 dark:hover:bg-[#202225]'
            }`}
          >
            <Sliders className={`w-3.5 h-3.5 ${activeTab === 'config' ? 'text-slate-950' : 'text-[#FF8F00]'}`} />
            <span>Configuratie</span>
            <span
              className={`font-mono text-[9px] px-1 py-0.2 rounded ${
                activeTab === 'config'
                  ? 'bg-slate-950/20 text-slate-950 font-bold'
                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold'
              }`}
            >
              Inline
            </span>
          </button>
        </nav>

        {/* Zone 3: Quick Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Quick Toggle for Inline Config Banner (Accessible from any tab) */}
          <button
            type="button"
            onClick={() => setShowInlineConfigBanner((prev) => !prev)}
            title="Snelle Inline Configuratie uitklappen"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              showInlineConfigBanner
                ? 'border-[#FF8F00] bg-[#FF8F00]/15 text-[#FF8F00] font-semibold'
                : 'border-slate-200 dark:border-[#3A3D40] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2A2D30]'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#FF8F00]" />
            <span className="hidden sm:inline">Inline Config</span>
          </button>

          {/* Theme switcher */}
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-[#3A3D40] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2A2D30] transition-colors"
            title={darkMode ? 'Licht thema' : 'Donker thema'}
            aria-label="Thema wisselen"
          >
            {darkMode ? <Sun className="w-4 h-4 text-[#FF8F00]" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>

          {/* Primary Action Button */}
          {spotifyAuth.connected ? (
            <button
              type="button"
              onClick={() => {
                setActiveTab('sync');
                handleRunDifferentialSync();
              }}
              disabled={isSyncing}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-gradient-to-r from-[#D84315] to-[#FF8F00] rounded-lg hover:brightness-110 transition-all whitespace-nowrap shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isSyncing ? 'Synchroniseren...' : `Sync Nu (${totalPendingSyncTracks})`}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConnectSpotify}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-gradient-to-r from-[#D84315] to-[#FF8F00] rounded-lg hover:brightness-110 transition-all whitespace-nowrap shadow-sm cursor-pointer"
            >
              Verbind Spotify
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace Canvas: Optional/Responsive Sidebar + Content Viewport */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto relative">
        {/* Backdrop overlay when optional sidebar drawer is open on smaller screens (< lg) */}
        {isMobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Left Navigation & Folder Tree Sidebar — Optional slide-over drawer on < lg, collapsible panel on lg+ */}
        <aside
          className={`${
            isMobileSidebarOpen
              ? 'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto shadow-2xl flex'
              : 'hidden'
          } ${
            isDesktopSidebarOpen
              ? 'lg:static lg:z-auto lg:w-64 lg:shadow-none lg:flex'
              : 'lg:hidden'
          } shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#181B1E] lg:dark:bg-slate-900/60 p-5 flex-col justify-between gap-6`}
        >
          <div className="space-y-6">
            {/* Mobile Drawer Header with Close Button (< lg only) */}
            <div className="flex lg:hidden items-center justify-between pb-3 border-b border-slate-200 dark:border-[#3A3D40]">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                <MP3SpotIcon size={22} />
                <span>Zijbalk & Mappen</span>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(false)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-[#3A3D40] text-slate-500 hover:text-slate-900 dark:hover:text-white"
                aria-label="Sluit zijbalk"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Hoofdnavigatie Menu (All screen sizes: Desktop & Mobile) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>Hoofdnavigatie</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#25282C]">
                  5 Tabs
                </span>
              </div>
              <div className="space-y-1">
                {[
                  {
                    id: 'library' as const,
                    label: 'Bibliotheek',
                    desc: 'Lokale Audio & ID3',
                    icon: FolderOpen,
                    badge: `${metrics.total}`,
                    color: 'text-[#FF8F00]',
                  },
                  {
                    id: 'matcher' as const,
                    label: 'Spotify Matcher',
                    desc: 'Metadata & Tagging',
                    icon: Sparkles,
                    badge: `${metrics.matchRatePct}%`,
                    color: 'text-[#00B4D8]',
                  },
                  {
                    id: 'playlists' as const,
                    label: 'Slimme Lijsten',
                    desc: 'Jaar- & Filterregels',
                    icon: Calendar,
                    badge: `${evaluatedPlaylists.length}`,
                    color: 'text-[#FF8F00]',
                  },
                  {
                    id: 'sync' as const,
                    label: 'Synchronisatie',
                    desc: 'Spotify & Exports',
                    icon: RefreshCw,
                    badge: totalPendingSyncTracks > 0 ? `+${totalPendingSyncTracks}` : 'Actief',
                    color: 'text-[#00B4D8]',
                  },
                  {
                    id: 'config' as const,
                    label: 'Inline Config',
                    desc: 'Dockhand & Volumes',
                    icon: Sliders,
                    badge: `v${buildInfo.version}`,
                    color: 'text-[#FF8F00]',
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSwitchTab(item.id)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-lg text-xs transition-all cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 font-bold shadow-sm ring-1 ring-[#FF8F00]/50'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#25282C]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-950' : item.color}`} />
                        <div className="text-left truncate">
                          <div className="font-semibold leading-tight truncate">{item.label}</div>
                          <div
                            className={`text-[10px] leading-tight truncate ${
                              isActive ? 'text-slate-950/80 font-normal' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {item.desc}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`font-mono tabular-nums text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ml-1.5 ${
                          isActive
                            ? 'bg-slate-950/25 text-slate-950 font-extrabold'
                            : 'bg-slate-200 dark:bg-[#2A2D30] text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {item.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Upload & Docker Server Volume Actions */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Lokale Bronbestanden
              </div>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#1E2124] hover:bg-slate-100 dark:hover:bg-[#25282C] text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
              >
                <span className="flex items-center gap-2 truncate">
                  <FolderOpen className="w-4 h-4 text-[#FF8F00] shrink-0" />
                  <span>Scan Browser Map</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
              <button
                type="button"
                onClick={handleScanServerVolume}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#1E2124] hover:bg-slate-100 dark:hover:bg-[#25282C] text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
              >
                <span className="flex items-center gap-2 truncate">
                  <HardDrive className="w-4 h-4 text-[#00B4D8] shrink-0" />
                  <span>Scan Docker Volume (/music)</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => handleWriteSpotifyId3Tags()}
                disabled={isWritingId3}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium rounded-lg border border-[#D84315]/40 bg-[#D84315]/10 hover:bg-[#D84315]/20 text-[#D84315] dark:text-[#FF8F00] transition-colors whitespace-nowrap"
              >
                <span className="flex items-center gap-2 truncate">
                  <Tag className="w-4 h-4 text-[#D84315] dark:text-[#FF8F00] shrink-0" />
                  <span>{isWritingId3 ? 'ID3 Schrijven...' : 'Schrijf Spotify ID3 Tags'}</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-[#FF8F00] shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#1E2124] hover:bg-slate-100 dark:hover:bg-[#25282C] text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
              >
                <span className="flex items-center gap-2 truncate">
                  <Upload className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>Importeer Audio / M3U8</span>
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
                  setIsMobileSidebarOpen(false);
                  if (activeTab === 'playlists' || activeTab === 'sync' || activeTab === 'config') {
                    handleSwitchTab('library');
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-md transition-colors ${
                  selectedFolder === 'ALL'
                    ? 'bg-slate-900 text-white dark:bg-[#3A3D40] dark:text-[#E6E7E9] font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#25282C]'
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
                      setIsMobileSidebarOpen(false);
                      if (activeTab === 'playlists' || activeTab === 'sync' || activeTab === 'config') {
                        handleSwitchTab('library');
                      }
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-md transition-colors ${
                      active
                        ? 'bg-slate-900 text-white dark:bg-[#3A3D40] dark:text-[#E6E7E9] font-medium'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#25282C]'
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

            {/* Smart Playlists Sidebar List (including automatic Year Playlists) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>Slimme & Jaar-Lijsten</span>
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
                      setIsMobileSidebarOpen(false);
                      handleSwitchTab('playlists');
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-md transition-colors ${
                      isSelected
                        ? 'bg-[#FF8F00]/15 text-amber-900 dark:text-[#FF8F00] font-medium'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#25282C]'
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

          {/* Bottom Sidebar Controls: Dockhand & Volume Config, Build Version, Spotify OAuth & Logout */}
          <div className="pt-4 border-t border-slate-200 dark:border-[#3A3D40] space-y-3">
            <button
              type="button"
              onClick={() => setShowDockhandModal(true)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg border border-[#FF8F00]/40 bg-[#FF8F00]/10 text-amber-900 dark:text-[#FF8F00] hover:bg-[#FF8F00]/20 transition-colors"
            >
              <span className="flex items-center gap-2 truncate">
                <Server className="w-3.5 h-3.5 shrink-0" />
                <span>Dockhand & Volumes</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            </button>

            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 space-y-0.5">
              <div className="text-slate-700 dark:text-slate-300 font-semibold">
                Build: v{buildInfo.version} (build# {buildInfo.buildNumber})
              </div>
              <div>Volume 1: {appAuthStatus.musicLibraryPath} (:rw ID3)</div>
              <div>Volume 2: {appAuthStatus.dataPath || '/app/data'} (:rw)</div>
              <div>Volume 3: {appAuthStatus.exportsPath || '/exports'} (:rw)</div>
            </div>

            <div className="text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Spotify Koppeling
                </span>
                <button
                  type="button"
                  onClick={() => setShowOAuthModal(true)}
                  className="text-[#00B4D8] hover:underline text-[11px] font-medium whitespace-nowrap"
                >
                  OAuth Instellingen
                </button>
              </div>
              {spotifyAuth.connected && spotifyAuth.user ? (
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="truncate">
                    Spotify: {spotifyAuth.user.display_name}
                  </span>
                  <button
                    type="button"
                    onClick={handleDisconnectSpotify}
                    className="text-rose-600 dark:text-rose-400 hover:underline ml-2 shrink-0"
                  >
                    Ontkoppel
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Catalogus-matcher actief ·{' '}
                  <button
                    type="button"
                    onClick={() => setShowOAuthModal(true)}
                    className="underline text-[#00B4D8] hover:opacity-80"
                  >
                    Configureer API
                  </button>
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-[#3A3D40] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
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
                  ? 'bg-[#FF8F00]/10 border-[#FF8F00]/30 text-amber-900 dark:text-[#FF8F00]'
                  : noticeBanner.type === 'warning'
                  ? 'bg-[#D84315]/10 border-[#D84315]/30 text-[#D84315] dark:text-[#FF8F00]'
                  : 'bg-slate-200/70 dark:bg-[#1E2124] border-slate-300 dark:border-[#3A3D40] text-slate-800 dark:text-[#E6E7E9]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {noticeBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-[#FF8F00] shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-[#D84315] shrink-0" />
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
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#FF8F00]/30 bg-[#FF8F00]/10 text-xs text-amber-900 dark:text-[#FF8F00]">
              <RefreshCw className="w-4 h-4 animate-spin shrink-0 text-[#FF8F00]" />
              <span className="font-mono tabular-nums">{scanProgressText}</span>
            </div>
          )}

          {/* Optional Collapsible Inline Config Drawer (Accessible from any tab via top button) */}
          {showInlineConfigBanner && activeTab !== 'config' && (
            <div className="mb-6">
              <InlineConfigPanel
                buildInfo={buildInfo}
                onBumpBuild={handleBumpBuildVersion}
                appAuthStatus={appAuthStatus}
                spotifyAuth={spotifyAuth}
                onConnectSpotify={handleConnectSpotify}
                onDisconnectSpotify={handleDisconnectSpotify}
                onRefreshSpotifyStatus={fetchSpotifyStatus}
                stackGitRepoUrl={stackGitRepoUrl}
                setStackGitRepoUrl={setStackGitRepoUrl}
                stackMusicPath={stackMusicPath}
                setStackMusicPath={setStackMusicPath}
                stackDataPath={stackDataPath}
                setStackDataPath={setStackDataPath}
                stackExportsPath={stackExportsPath}
                setStackExportsPath={setStackExportsPath}
                stackPort={stackPort}
                setStackPort={setStackPort}
                dockhandMode={dockhandMode}
                setDockhandMode={setDockhandMode}
                generatedDockhandYaml={generatedDockhandYaml}
                copyToClipboard={copyToClipboard}
                copiedUrlKey={copiedUrlKey}
                isCollapsible
                isExpanded={showInlineConfigBanner}
                onToggleExpand={() => setShowInlineConfigBanner(false)}
                onClose={() => setShowInlineConfigBanner(false)}
              />
            </div>
          )}

          {/* KPI Metric Strip — Interactive: clicking a box switches directly to that view */}
          {activeTab !== 'config' && (
            <section className="grid grid-cols-2 lg:grid-cols-4 border border-slate-200 dark:border-[#3A3D40] rounded-xl bg-white dark:bg-[#1E2124] divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-[#3A3D40] overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => handleSwitchTab('library')}
                className={`p-4 text-left transition-all cursor-pointer ${
                  activeTab === 'library'
                    ? 'bg-gradient-to-br from-[#D84315]/10 to-[#FF8F00]/15 ring-2 ring-inset ring-[#FF8F00]'
                    : 'hover:bg-slate-50 dark:hover:bg-[#25282C]'
                }`}
              >
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>Lokale Muziekbestanden</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${activeTab === 'library' ? 'bg-[#FF8F00] text-slate-950 font-bold' : 'opacity-0'}`}>
                    Actief
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {metrics.total}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {metrics.totalSizeMB} MB
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchTab('matcher')}
                className={`p-4 text-left transition-all cursor-pointer ${
                  activeTab === 'matcher'
                    ? 'bg-gradient-to-br from-[#D84315]/10 to-[#FF8F00]/15 ring-2 ring-inset ring-[#FF8F00]'
                    : 'hover:bg-slate-50 dark:hover:bg-[#25282C]'
                }`}
              >
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>Spotify Match & ID3 Getagd</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${activeTab === 'matcher' ? 'bg-[#FF8F00] text-slate-950 font-bold' : 'opacity-0'}`}>
                    Actief
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-[#FF8F00]">
                    {metrics.matchRatePct}%
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {metrics.id3TaggedCount} ID3v2.3
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchTab('playlists')}
                className={`p-4 text-left transition-all cursor-pointer ${
                  activeTab === 'playlists'
                    ? 'bg-gradient-to-br from-[#D84315]/10 to-[#FF8F00]/15 ring-2 ring-inset ring-[#FF8F00]'
                    : 'hover:bg-slate-50 dark:hover:bg-[#25282C]'
                }`}
              >
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>Automatische Jaar-Lijsten</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${activeTab === 'playlists' ? 'bg-[#FF8F00] text-slate-950 font-bold' : 'opacity-0'}`}>
                    Actief
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {yearStats.length}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    jaren in Spotify
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchTab('sync')}
                className={`p-4 text-left transition-all cursor-pointer ${
                  activeTab === 'sync'
                    ? 'bg-gradient-to-br from-[#D84315]/10 to-[#FF8F00]/15 ring-2 ring-inset ring-[#FF8F00]'
                    : 'hover:bg-slate-50 dark:hover:bg-[#25282C]'
                }`}
              >
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>Klaar voor Synchronisatie</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${activeTab === 'sync' ? 'bg-[#FF8F00] text-slate-950 font-bold' : 'opacity-0'}`}>
                    Actief
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-[#00B4D8]">
                    {totalPendingSyncTracks}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    in {evaluatedPlaylists.length} lijsten
                  </span>
                </div>
              </button>
            </section>
          )}

          {/* Active Module Header Strip — Clear Breadcrumb & View Status for Immediate Visual Feedback */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-[#181A1D] border border-slate-200 dark:border-[#3A3D40] shadow-xs">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-[#D84315] to-[#FF8F00] text-slate-950 shrink-0 shadow-sm">
                {activeTab === 'library' && <FolderOpen className="w-4 h-4" />}
                {activeTab === 'matcher' && <Sparkles className="w-4 h-4" />}
                {activeTab === 'playlists' && <Calendar className="w-4 h-4" />}
                {activeTab === 'sync' && <RefreshCw className="w-4 h-4" />}
                {activeTab === 'config' && <Sliders className="w-4 h-4" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#FF8F00] font-bold">
                    Actieve Tab
                  </span>
                  <span className="text-slate-400">/</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    {activeTab === 'library' && '1. Lokale Bibliotheek & ID3 Bestandsbeheer'}
                    {activeTab === 'matcher' && '2. Spotify Metadata Matcher & ID3v2.3 Tagger'}
                    {activeTab === 'playlists' && '3. Automatische Jaar-Lijsten & Slimme Regels'}
                    {activeTab === 'sync' && '4. Differentiële Synchronisatie & Volume Export'}
                    {activeTab === 'config' && '5. Inline Configuratie & Dockhand Stack'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {activeTab === 'library' && `${metrics.total} bestanden · ${metrics.totalSizeMB} MB · Volume: ${appAuthStatus.musicLibraryPath}`}
                  {activeTab === 'matcher' && `${metrics.matchRatePct}% gematcht · ${metrics.id3TaggedCount} ID3v2.3 getagd · ${metrics.reviewCount} te beoordelen`}
                  {activeTab === 'playlists' && `${evaluatedPlaylists.length} actieve lijsten (inclusief automatische releasejaren)`}
                  {activeTab === 'sync' && `${totalPendingSyncTracks} tracks klaar voor live sync naar Spotify of /exports`}
                  {activeTab === 'config' && `Build v${buildInfo.version} · 3 Volumes (/music:rw, /data, /exports)`}
                </div>
              </div>
            </div>

            {/* Quick direct jumper tabs + Optional Sidebar Button for Smaller Screens */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className="lg:hidden flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#121416] text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:border-[#FF8F00] transition-colors cursor-pointer"
              >
                <PanelLeft className="w-3.5 h-3.5 text-[#FF8F00]" />
                <span>
                  Mappen & Lijsten
                  {selectedFolder !== 'ALL'
                    ? ` (${selectedFolder.split('/').filter(Boolean).pop()})`
                    : ''}
                </span>
              </button>

              <div className="flex items-center gap-1 bg-slate-200/60 dark:bg-[#121416] p-1 rounded-lg text-[11px]">
                {(
                  [
                    ['library', 'Bibliotheek'],
                    ['matcher', 'Matcher'],
                    ['playlists', 'Lijsten'],
                    ['sync', 'Sync'],
                    ['config', 'Config'],
                  ] as const
                ).map(([tabId, tabName]) => (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => handleSwitchTab(tabId)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      activeTab === tabId
                        ? 'bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 font-bold shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tabName}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ===================================================================
              VIEW 1: LOKALE BIBLIOTHEEK, SPOTIFY ID3 TAGGER & SCANNER
             =================================================================== */}
          {activeTab === 'library' && (
            <div className="space-y-6">
              {/* Library View Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-[#3A3D40] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-5 h-5 text-[#FF8F00]" />
                    <h1 className="text-base font-bold text-slate-900 dark:text-white">
                      MP3Spot Lokale Bibliotheek & Bestandsbeheer
                    </h1>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Doorzoek en bewerk lokale metadata, inspecteer ID3v2.3 tags en beheer audiobestanden op de host of in het Docker /music volume.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-[#3A3D40] text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#25282C] transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#FF8F00]" />
                    <span>Scan Browser Map</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleScanServerVolume}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#00B4D8]/40 text-[#00B4D8] hover:bg-[#00B4D8]/10 transition-colors"
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Scan /music Volume</span>
                  </button>
                </div>
              </div>

              {/* Drag & Drop Local Music Folder Zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFilesSelected(e.dataTransfer.files);
                }}
                className="border border-dashed border-slate-300 dark:border-[#3A3D40] rounded-lg bg-white dark:bg-[#1E2124]/50 p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <h1 className="text-base font-semibold text-slate-900 dark:text-white">
                    MP3Spot Bibliotheek, Spotify ID3v2.3 Tagger & Jaar-Indeling
                  </h1>
                  <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl">
                    Sleep je lokale muziekmap hierheen of scan het gemounte Docker-volume (
                    <span className="font-mono text-[#00B4D8]">{appAuthStatus.musicLibraryPath}</span>). MP3Spot
                    schrijft Spotify metadata (<span className="font-mono">TIT2</span>,{' '}
                    <span className="font-mono">TPE1</span>, <span className="font-mono">TALB</span>,{' '}
                    <span className="font-mono">TYER</span>, <span className="font-mono">TSRC</span>)
                    terug als ID3v2.3 tags en plaatst elk gevonden nummer automatisch in een{' '}
                    <span className="font-mono text-[#FF8F00]">MP3Spot Jaar: YYYY</span> afspeellijst.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-[#E6E7E9] dark:text-[#16181A] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                  >
                    Selecteer Browser Map
                  </button>
                  <button
                    type="button"
                    onClick={handleScanServerVolume}
                    className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-[#3A3D40] text-slate-700 dark:text-[#E6E7E9] hover:bg-slate-100 dark:hover:bg-[#25282C] transition-colors whitespace-nowrap shrink-0"
                  >
                    Scan /music Volume
                  </button>
                  <button
                    type="button"
                    onClick={() => handleWriteSpotifyId3Tags()}
                    disabled={isWritingId3}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 transition-all whitespace-nowrap shrink-0 shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>
                      {isWritingId3 ? 'ID3 Schrijven...' : 'Tag Alle met Spotify ID3'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runBatchMatcher()}
                    disabled={isBatchMatching}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-[#00B4D8]/40 text-[#00B4D8] hover:bg-[#00B4D8]/10 transition-colors whitespace-nowrap shrink-0"
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
                <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-[#16181A] border border-slate-200 dark:border-[#3A3D40] rounded-lg overflow-x-auto">
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
                          ? 'bg-white dark:bg-[#202225] text-slate-900 dark:text-white shadow-xs border border-slate-200 dark:border-[#3A3D40]'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Zoek op titel, artiest, jaar, ISRC..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-white dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
                    />
                  </div>
                  <select
                    value={formatFilter}
                    onChange={(e) => setFormatFilter(e.target.value)}
                    aria-label="Filter op audioformaat"
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-white dark:bg-[#16181A] text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#FF8F00]"
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
              <div className="border border-slate-200 dark:border-[#3A3D40] rounded-lg bg-white dark:bg-[#1E2124] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-[#3A3D40] text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-[#16181A]">
                        <th className="py-2.5 px-4">Titel & Artiest (Lokaal Bestand)</th>
                        <th className="py-2.5 px-4">Album, Genre & Jaar-Lijst</th>
                        <th className="py-2.5 px-4">ID3 Tag Status & Specs</th>
                        <th className="py-2.5 px-4 text-right">Speelduur</th>
                        <th className="py-2.5 px-4">Spotify Match & URI</th>
                        <th className="py-2.5 px-4 text-right">Acties</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-[#3A3D40]/80 text-xs">
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
                          const effectiveYear = trk.selectedMatch?.releaseYear || trk.year;
                          return (
                            <React.Fragment key={trk.id}>
                              <tr className="hover:bg-slate-50/80 dark:hover:bg-[#25282C] transition-colors">
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

                                <td className="py-3 px-4">
                                  <div className="text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                                    {trk.album}
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 whitespace-nowrap">
                                    <span>{trk.genre}</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums font-medium text-[#FF8F00]">
                                      Jaar: {effectiveYear}
                                    </span>
                                    {trk.bpm && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-mono tabular-nums">
                                          {trk.bpm} BPM
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </td>

                                <td className="py-3 px-4 whitespace-nowrap">
                                  <div className="text-xs font-mono tabular-nums text-slate-800 dark:text-slate-200">
                                    {trk.format} · {trk.bitrateKbps} kbps
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                                    {trk.id3TaggedFromSpotify ? (
                                      <span className="text-[#00B4D8] font-medium">
                                        Spotify ID3v2.3
                                      </span>
                                    ) : (
                                      <span>{trk.tagSource}</span>
                                    )}
                                    {trk.isrc ? ` · ${trk.isrc}` : ''}
                                  </div>
                                </td>

                                <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                  {formatDuration(trk.durationSec)}
                                </td>

                                <td className="py-3 px-4">
                                  {trk.selectedMatch ? (
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        {trk.matchStatus === 'synced' ? (
                                          <CheckCircle2 className="w-3.5 h-3.5 text-[#FF8F00] shrink-0" />
                                        ) : trk.matchStatus === 'matched' ? (
                                          <Check className="w-3.5 h-3.5 text-[#FF8F00] shrink-0" />
                                        ) : (
                                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                        )}
                                        <span className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[180px]">
                                          {trk.selectedMatch.title}
                                        </span>
                                        <span className="font-mono tabular-nums text-[11px] text-[#FF8F00]">
                                          {trk.selectedMatch.confidence}%
                                        </span>
                                      </div>
                                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[240px] mt-0.5">
                                        Lijst: MP3Spot Jaar: {effectiveYear} · <span className="text-[#00B4D8]">{trk.selectedMatch.uri}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                      <span>Geen automatische match</span>
                                    </div>
                                  )}
                                </td>

                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5">
                                    {trk.selectedMatch && (
                                      <button
                                        type="button"
                                        onClick={() => handleWriteSpotifyId3Tags([trk])}
                                        title="Schrijf Spotify ID3v2.3 metadata naar lokaal bestand"
                                        className="px-2.5 py-1 text-[11px] font-medium rounded border border-[#FF8F00]/40 text-amber-900 dark:text-[#FF8F00] hover:bg-[#FF8F00]/10 transition-colors"
                                      >
                                        Tag ID3
                                      </button>
                                    )}
                                    {trk.selectedMatch && (
                                      <button
                                        type="button"
                                        onClick={() => handleDownloadBinaryId3File(trk)}
                                        title="Download binair ID3v2.3 getagd audiobestand"
                                        className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded border border-slate-200 dark:border-[#3A3D40]"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                      </button>
                                    )}
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
                                      className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-[#3A3D40] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#25282C] transition-colors"
                                    >
                                      Bewerk
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveTab('matcher');
                                        setManualSearchTrackId(trk.id);
                                        setManualSearchQuery(`${trk.artist} - ${trk.title}`);
                                      }}
                                      className="px-2.5 py-1 text-[11px] font-medium rounded border border-[#00B4D8]/40 text-[#00B4D8] hover:bg-[#00B4D8]/10 transition-colors"
                                    >
                                      Koppel
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {isEditing && (
                                <tr className="bg-slate-100/70 dark:bg-[#16181A]">
                                  <td colSpan={6} className="p-4 border-t border-[#3A3D40]">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                                      <div>
                                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                                          Titel (TIT2)
                                        </label>
                                        <input
                                          type="text"
                                          value={editDraft.title || ''}
                                          onChange={(e) =>
                                            setEditDraft((d) => ({ ...d, title: e.target.value }))
                                          }
                                          className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#1E2124]"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                                          Artiest (TPE1)
                                        </label>
                                        <input
                                          type="text"
                                          value={editDraft.artist || ''}
                                          onChange={(e) =>
                                            setEditDraft((d) => ({ ...d, artist: e.target.value }))
                                          }
                                          className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#1E2124]"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                                          Album (TALB)
                                        </label>
                                        <input
                                          type="text"
                                          value={editDraft.album || ''}
                                          onChange={(e) =>
                                            setEditDraft((d) => ({ ...d, album: e.target.value }))
                                          }
                                          className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#1E2124]"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                                          Jaar (TYER)
                                        </label>
                                        <input
                                          type="number"
                                          value={editDraft.year || ''}
                                          onChange={(e) =>
                                            setEditDraft((d) => ({
                                              ...d,
                                              year: Number(e.target.value) || 2024,
                                            }))
                                          }
                                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#1E2124]"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                                          ISRC-code (TSRC)
                                        </label>
                                        <input
                                          type="text"
                                          value={editDraft.isrc || ''}
                                          onChange={(e) =>
                                            setEditDraft((d) => ({ ...d, isrc: e.target.value }))
                                          }
                                          placeholder="bijv. NLB631700084"
                                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#1E2124]"
                                        />
                                      </div>
                                      <div className="flex items-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => handleSaveTrackEdit(trk.id)}
                                          className="px-3 py-1.5 text-xs font-bold rounded bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 transition-all whitespace-nowrap shadow-xs cursor-pointer"
                                        >
                                          Opslaan & Herzoek
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingTrackId(null)}
                                          className="px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-[#3A3D40] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#25282C]"
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
              VIEW 2: SPOTIFY MATCHER, ID3 SCHRIJVER & CONFLICTRESOLUTIE
             =================================================================== */}
          {activeTab === 'matcher' && (
            <div className="space-y-6">
              {/* Matcher View Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-[#3A3D40] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-[#00B4D8]" />
                    <h1 className="text-base font-bold text-slate-900 dark:text-white">
                      Spotify Metadata Matcher & ID3v2.3 Tagger
                    </h1>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Verifieer matches in de Spotify catalogus en schrijf direct de officiële Spotify ID3 metadata (TIT2, TPE1, TALB, TYER, TSRC & Spotify URI) naar je lokale bestanden.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleWriteSpotifyId3Tags()}
                    disabled={isWritingId3}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 transition-all whitespace-nowrap shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>Tag Alle Gematchte Bestanden met Spotify ID3</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runBatchMatcher()}
                    disabled={isBatchMatching}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-[#00B4D8]/40 text-[#00B4D8] hover:bg-[#00B4D8]/10 transition-colors whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isBatchMatching ? 'animate-spin' : ''}`}
                    />
                    <span>Scan Alle Nummers Opnieuw</span>
                  </button>
                </div>
              </div>

              {/* Matcher Filter Bar & Search */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-[#151719] border border-slate-200 dark:border-[#3A3D40]">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold text-slate-500 dark:text-slate-400 mr-1 text-[11px]">
                    Filter Status:
                  </span>
                  {[
                    { id: 'ALL', label: 'Alle Nummers', count: tracks.length },
                    { id: 'review', label: 'Te Beoordelen', count: metrics.reviewCount, alert: metrics.reviewCount > 0 },
                    { id: 'matched', label: 'Gematcht', count: metrics.exactOrSynced },
                    { id: 'unmatched', label: 'Geen Match', count: metrics.unmatchedCount },
                    { id: 'tagged', label: 'Spotify ID3 Getagd', count: metrics.id3TaggedCount },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setMatcherFilter(f.id as any)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                        matcherFilter === f.id
                          ? 'bg-white dark:bg-[#202225] text-slate-900 dark:text-white shadow-xs border border-slate-300 dark:border-[#3A3D40] font-bold'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <span>{f.label}</span>
                      <span className={`font-mono text-[10px] px-1.5 py-0.2 rounded-full ${
                        f.alert
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold'
                          : matcherFilter === f.id
                          ? 'bg-[#FF8F00]/20 text-[#FF8F00]'
                          : 'bg-slate-200 dark:bg-slate-800'
                      }`}>
                        {f.count}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Zoek in matcher..."
                      className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#1E2124] text-slate-900 dark:text-white focus:outline-none focus:border-[#FF8F00] w-48 sm:w-60"
                    />
                  </div>
                  <div className="text-xs font-mono text-slate-500 hidden sm:block whitespace-nowrap">
                    Score: <span className="font-bold text-[#FF8F00]">{metrics.matchRatePct}%</span>
                  </div>
                </div>
              </div>

              {manualSearchTrackId && (
                <div className="border border-[#FF8F00]/40 rounded-lg bg-white dark:bg-[#1E2124] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      Handmatig Zoeken in Spotify Catalogus voor:{' '}
                      <span className="text-[#FF8F00]">
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
                      className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
                    />
                    <button
                      type="submit"
                      disabled={isSearchingManual}
                      className="px-4 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 transition-all whitespace-nowrap shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      {isSearchingManual ? 'Zoeken...' : 'Zoek in Spotify'}
                    </button>
                  </form>
                  {manualSearchResults.length > 0 && (
                    <div className="divide-y divide-slate-200 dark:divide-[#3A3D40] border-t border-slate-200 dark:border-[#3A3D40] pt-2">
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
                              · <span className="text-[#00B4D8]">{cand.uri}</span>
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
                            className="px-3 py-1.5 text-xs font-bold rounded bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 whitespace-nowrap shadow-xs"
                          >
                            Kies Match & Tag ID3
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="border border-slate-200 dark:border-[#3A3D40] rounded-lg bg-white dark:bg-[#1E2124] divide-y divide-slate-200 dark:divide-[#3A3D40]">
                {matcherFilteredTracks.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    Geen nummers gevonden voor het gekozen filter &quot;{matcherFilter}&quot;.
                  </div>
                ) : (
                  matcherFilteredTracks.map((trk) => {
                  const durationDelta = trk.selectedMatch
                    ? Math.abs(trk.durationSec - trk.selectedMatch.durationSec)
                    : 0;
                  const effectiveYear = trk.selectedMatch?.releaseYear || trk.year;

                  return (
                    <div
                      key={trk.id}
                      className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-[#25282C] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-white truncate">
                            {trk.artist} — {trk.title}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                          Lokaal: {trk.format} · {formatDuration(trk.durationSec)} · Album:{' '}
                          {trk.album} · Tags: {trk.tagSource}{' '}
                          {trk.isrc ? `· ISRC: ${trk.isrc}` : ''}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        {trk.selectedMatch ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-medium text-[#00B4D8] truncate">
                                Spotify: {trk.selectedMatch.artist} — {trk.selectedMatch.title}
                              </span>
                              <span className="font-mono tabular-nums text-[11px] text-[#FF8F00]">
                                ({trk.selectedMatch.confidence}% · {trk.selectedMatch.matchMethod})
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                              Jaar-lijst: <span className="text-[#FF8F00]">MP3Spot Jaar: {effectiveYear}</span> · Speelduur:{' '}
                              {formatDuration(trk.selectedMatch.durationSec)}
                              {durationDelta > 5
                                ? ` (Δ ${durationDelta}s t.o.v. lokaal bestand)`
                                : ' (Exacte speelduur)'}
                            </div>

                            {trk.candidates.length > 1 && (
                              <div className="pt-1.5 flex flex-wrap items-center gap-2">
                                <span className="text-[11px] text-slate-400">Alternatieven:</span>
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
                                          ? 'border-[#FF8F00] bg-[#FF8F00]/15 text-[#FF8F00] font-medium'
                                          : 'border-slate-200 dark:border-[#3A3D40] text-slate-600 dark:text-slate-400 hover:border-slate-400'
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

                      <div className="flex items-center gap-2 shrink-0">
                        {trk.selectedMatch && (
                          <button
                            type="button"
                            onClick={() => handleWriteSpotifyId3Tags([trk])}
                            className="px-3 py-1.5 text-xs font-medium rounded-md border border-[#FF8F00]/40 text-amber-900 dark:text-[#FF8F00] hover:bg-[#FF8F00]/10 transition-colors whitespace-nowrap"
                          >
                            Schrijf Spotify ID3
                          </button>
                        )}
                        {trk.matchStatus === 'review' && trk.selectedMatch && (
                          <button
                            type="button"
                            onClick={() => handleSelectCandidate(trk.id, trk.selectedMatch!)}
                            className="px-3 py-1.5 text-xs font-bold rounded-md bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 transition-all whitespace-nowrap shadow-xs"
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
                          className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-[#3A3D40] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#25282C] transition-colors whitespace-nowrap"
                        >
                          Handmatig Zoeken
                        </button>
                        {trk.selectedMatch && (
                          <a
                            href={trk.selectedMatch.externalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-md border border-slate-200 dark:border-[#3A3D40] text-[#00B4D8] hover:text-white hover:bg-[#00B4D8]/20 transition-colors"
                            title="Openen in Spotify"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                }))}
              </div>
            </div>
          )}

          {/* ===================================================================
              VIEW 3: SLIMME AFSPEELLIJSTEN & AUTOMATISCHE JAAR-LIJSTEN
             =================================================================== */}
          {activeTab === 'playlists' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-[#3A3D40] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-[#FF8F00]" />
                    <h1 className="text-base font-bold text-slate-900 dark:text-white">
                      Automatische Jaar-Afspeellijsten & Slimme Regels
                    </h1>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Elk nummer dat op Spotify beschikbaar is, wordt automatisch in een{' '}
                    <span className="font-mono text-[#FF8F00]">MP3Spot Jaar: YYYY</span> afspeellijst geplaatst,
                    aangevuld met je eigen map-, genre- en BPM-regels.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleGenerateRulesFromYears}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-[#FF8F00]/40 text-amber-900 dark:text-[#FF8F00] hover:bg-[#FF8F00]/10 transition-colors whitespace-nowrap"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Synchroniseer Jaar-Lijsten ({yearStats.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateRulesFromFolders}
                    className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-[#3A3D40] text-slate-800 dark:text-[#E6E7E9] hover:bg-slate-100 dark:hover:bg-[#25282C] transition-colors whitespace-nowrap"
                  >
                    Genereer uit Mappen ({folderStats.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewRuleForm((v) => !v)}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 transition-all whitespace-nowrap shadow-sm cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nieuwe Slimme Regel</span>
                  </button>
                </div>
              </div>

              {showNewRuleForm && (
                <form
                  onSubmit={handleCreateCustomRule}
                  className="border border-slate-200 dark:border-[#3A3D40] rounded-lg bg-white dark:bg-[#1E2124] p-5 space-y-4"
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
                        placeholder="bijv. MP3Spot Jaar: 2020 of Deep House Warmup"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-slate-400 mb-1">
                        Specifiek Releasejaar (optioneel)
                      </label>
                      <input
                        type="number"
                        value={newRuleDraft.exactYear}
                        onChange={(e) =>
                          setNewRuleDraft((d) => ({ ...d, exactYear: e.target.value }))
                        }
                        placeholder="bijv. 2021"
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
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
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
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
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
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
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
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
                        className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#16181A] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FF8F00]"
                      />
                    </div>
                    <div className="flex flex-col justify-end gap-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={newRuleDraft.onlyLossless}
                          onChange={(e) =>
                            setNewRuleDraft((d) => ({ ...d, onlyLossless: e.target.checked }))
                          }
                          className="rounded border-[#3A3D40] text-[#D84315] focus:ring-[#FF8F00]"
                        />
                        <span>Alleen Lossless (FLAC / WAV)</span>
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={newRuleDraft.isPublic}
                          onChange={(e) =>
                            setNewRuleDraft((d) => ({ ...d, isPublic: e.target.checked }))
                          }
                          className="rounded border-[#3A3D40] text-[#D84315] focus:ring-[#FF8F00]"
                        />
                        <span>Openbare Spotify-lijst</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowNewRuleForm(false)}
                      className="px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-[#3A3D40] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#25282C]"
                    >
                      Annuleren
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 shadow-sm"
                    >
                      Afspeellijst Regel Opslaan
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-5 border border-slate-200 dark:border-[#3A3D40] rounded-lg bg-white dark:bg-[#1E2124] divide-y divide-slate-200 dark:divide-[#3A3D40]">
                  {evaluatedPlaylists.map((ep) => {
                    const isSelected = activePlaylistEval?.rule.id === ep.rule.id;
                    return (
                      <div
                        key={ep.rule.id}
                        onClick={() => setSelectedPlaylistId(ep.rule.id)}
                        className={`p-4 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#FF8F00]/10 border-l-4 border-l-[#FF8F00]'
                            : 'hover:bg-slate-50 dark:hover:bg-[#25282C]'
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
                          <span className="text-[#00B4D8] font-medium">
                            {ep.newUrisToAdd.length} nieuw te synchroniseren
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{ep.alreadySyncedUris.length} al in Spotify</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="lg:col-span-7 border border-slate-200 dark:border-[#3A3D40] rounded-lg bg-white dark:bg-[#1E2124] overflow-hidden">
                  {activePlaylistEval ? (
                    <div>
                      <div className="p-5 border-b border-slate-200 dark:border-[#3A3D40] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                            {activePlaylistEval.rule.name}
                          </h2>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                            Min. matchzekerheid: {activePlaylistEval.rule.filter.minConfidence}%
                            {activePlaylistEval.rule.filter.exactYear
                              ? ` · Jaar: ${activePlaylistEval.rule.filter.exactYear}`
                              : ''}
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
                          className="px-3.5 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 transition-all whitespace-nowrap shrink-0 shadow-sm cursor-pointer disabled:opacity-50"
                        >
                          Synchroniseer Deze Lijst ({activePlaylistEval.newUrisToAdd.length} nieuw)
                        </button>
                      </div>

                      <div className="divide-y divide-slate-200 dark:divide-[#3A3D40] text-xs">
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
                                className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-[#25282C] transition-colors"
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
                                      {trk.format} · Jaar: {trk.selectedMatch?.releaseYear || trk.year}{' '}
                                      · {uri ? <span className="text-[#00B4D8]">{uri}</span> : 'Geen Spotify URI gekoppeld'}
                                    </div>
                                  </div>
                                </div>
                                <div className="shrink-0 text-right font-mono text-[11px]">
                                  {isAlreadySynced ? (
                                    <span className="text-slate-500">Al in Spotify (=)</span>
                                  ) : uri ? (
                                    <span className="text-[#FF8F00] font-medium">
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
              VIEW 4: DIFFERENTIËLE SYNCHRONISATIE & VOLUME EXPORT
             =================================================================== */}
          {activeTab === 'sync' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-[#3A3D40] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-5 h-5 text-[#00B4D8]" />
                    <h1 className="text-base font-bold text-slate-900 dark:text-white">
                      MP3Spot Differentiële Synchronisatie & Volume Export
                    </h1>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Synchroniseer je jaar-afspeellijsten en slimme lijsten naar Spotify of schrijf
                    `.m3u8` / `.json` / `.csv` rechtstreeks naar het gemounte Docker-volume (
                    <span className="font-mono text-[#00B4D8]">{appAuthStatus.exportsPath || '/exports'}</span>).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleWriteExportToVolume('m3u8')}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[#00B4D8]/40 text-[#00B4D8] hover:bg-[#00B4D8]/10 transition-colors whitespace-nowrap"
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Schrijf .M3U8 naar /exports</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportSyncReport('json')}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-[#3A3D40] text-slate-700 dark:text-[#E6E7E9] hover:bg-slate-100 dark:hover:bg-[#25282C] transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>JSON Mapping</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportSyncReport('csv')}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-[#3A3D40] text-slate-700 dark:text-[#E6E7E9] hover:bg-slate-100 dark:hover:bg-[#25282C] transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>CSV Rapport</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRunDifferentialSync}
                    disabled={isSyncing}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 transition-all whitespace-nowrap shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {isSyncing
                      ? 'Bezig met synchroniseren...'
                      : `Voer Synchronisatie Uit (+${totalPendingSyncTracks} tracks)`}
                  </button>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-[#3A3D40] rounded-lg bg-white dark:bg-[#1E2124] overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-[#3A3D40] flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-slate-900 dark:text-white">
                    Synchronisatieplan (Inclusief Jaar-Afspeellijsten)
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
                      <tr className="border-b border-slate-200 dark:border-[#3A3D40] text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-[#16181A]">
                        <th className="py-2.5 px-4">Afspeellijst</th>
                        <th className="py-2.5 px-4">Type</th>
                        <th className="py-2.5 px-4 text-right">Lokale Matches</th>
                        <th className="py-2.5 px-4 text-right">Reeds Gesynchroniseerd (=)</th>
                        <th className="py-2.5 px-4 text-right">Nieuw Toe te Voegen (+)</th>
                        <th className="py-2.5 px-4 text-right">Laatste Sync</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-[#3A3D40]">
                      {evaluatedPlaylists.map((ep) => (
                        <tr key={ep.rule.id} className="hover:bg-slate-50/50 dark:hover:bg-[#25282C] transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {ep.rule.name}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {ep.rule.spotifyPlaylistId ? (
                                <span className="text-[#00B4D8]">spotify:playlist:{ep.rule.spotifyPlaylistId}</span>
                              ) : (
                                'Nieuwe afspeellijst bij eerstvolgende sync'
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                            {ep.rule.strategy === 'year'
                              ? `Jaar (${ep.rule.filter.exactYear})`
                              : ep.rule.strategy}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            {ep.readyMatches.length}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">
                            {ep.alreadySyncedUris.length}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-[#FF8F00]">
                            +{ep.newUrisToAdd.length}
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

              <div className="border border-slate-200 dark:border-[#3A3D40] rounded-lg bg-white dark:bg-[#1E2124] overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-[#3A3D40]">
                  <h2 className="text-xs font-semibold text-slate-900 dark:text-white">
                    Synchronisatiegeschiedenis
                  </h2>
                </div>
                <div className="divide-y divide-slate-200 dark:divide-[#3A3D40] text-xs">
                  {syncHistory.map((item) => (
                    <div
                      key={item.id}
                      className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-[#25282C] transition-colors"
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
                          className="text-[#00B4D8] hover:underline flex items-center gap-1 font-medium"
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

          {/* ===================================================================
              VIEW 5: INLINE CONFIGURATIE & DOCKHAND STACK (DE INLINE CONFIG!)
             =================================================================== */}
          {activeTab === 'config' && (
            <div className="space-y-6">
              <InlineConfigPanel
                buildInfo={buildInfo}
                onBumpBuild={handleBumpBuildVersion}
                appAuthStatus={appAuthStatus}
                spotifyAuth={spotifyAuth}
                onConnectSpotify={handleConnectSpotify}
                onDisconnectSpotify={handleDisconnectSpotify}
                onRefreshSpotifyStatus={fetchSpotifyStatus}
                stackGitRepoUrl={stackGitRepoUrl}
                setStackGitRepoUrl={setStackGitRepoUrl}
                stackMusicPath={stackMusicPath}
                setStackMusicPath={setStackMusicPath}
                stackDataPath={stackDataPath}
                setStackDataPath={setStackDataPath}
                stackExportsPath={stackExportsPath}
                setStackExportsPath={setStackExportsPath}
                stackPort={stackPort}
                setStackPort={setStackPort}
                dockhandMode={dockhandMode}
                setDockhandMode={setDockhandMode}
                generatedDockhandYaml={generatedDockhandYaml}
                copyToClipboard={copyToClipboard}
                copiedUrlKey={copiedUrlKey}
                isCollapsible={false}
              />
            </div>
          )}
        </main>
      </div>

      {renderDockhandModal()}

      {/* Spotify OAuth Configuration, Credentials & Diagnostics Modal */}
      {showOAuthModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-xs">
          <div className="bg-white dark:bg-[#1E2124] border border-slate-300 dark:border-[#3A3D40] rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#3A3D40] pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#FF8F00]" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Spotify Developer OAuth Configuratie & Diagnose
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

            {/* Detailed Error Banner inside OAuth Modal when a connection attempt failed */}
            {spotifyAuth.lastError && (
              <div className="p-4 rounded-xl border border-[#D84315] bg-[#D84315]/10 text-xs space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-[#D84315] dark:text-[#FF8F00]">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Laatste Spotify OAuth Fout ({spotifyAuth.lastError.code})</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearSpotifyError}
                    className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-0.5"
                    title="Foutmelding wissen"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {spotifyAuth.lastError.message}
                </p>
                {spotifyAuth.lastError.details && (
                  <div className="p-2 rounded bg-slate-900 text-rose-300 font-mono text-[11px] break-all border border-slate-700">
                    {spotifyAuth.lastError.details}
                  </div>
                )}
                {spotifyAuth.lastError.hint && (
                  <div className="p-2.5 rounded bg-[#00B4D8]/10 border border-[#00B4D8]/30 text-slate-800 dark:text-slate-200 leading-relaxed">
                    <strong className="text-[#00B4D8] block mb-0.5">Hoe los je dit op:</strong>
                    {spotifyAuth.lastError.hint}
                  </div>
                )}
              </div>
            )}

            {modalTestMessage && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                  modalTestMessage.ok
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-[#D84315]/50 bg-[#D84315]/10 text-[#D84315] dark:text-[#FF8F00]'
                }`}
              >
                <span>{modalTestMessage.text}</span>
                <button
                  type="button"
                  onClick={() => setModalTestMessage(null)}
                  className="opacity-70 hover:opacity-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Om afspeellijsten rechtstreeks in je persoonlijke Spotify-account aan te maken:
              <br />
              1. Open het{' '}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-[#00B4D8] underline hover:opacity-80 font-medium"
              >
                Spotify Developer Dashboard
              </a>{' '}
              en voeg bij <strong>Settings &rarr; Redirect URIs</strong> onderstaande Redirect URI toe.
              <br />
              2. Voeg bij <strong>Users and Access</strong> in het Spotify Dashboard je eigen naam en Spotify e-mailadres toe (verplicht zolang je Spotify-app in <em>Development Mode</em> staat, anders weigert Spotify de verbinding met HTTP 403).
            </p>

            {/* Step 1: API Credentials right inside the modal */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#3A3D40] bg-slate-50/70 dark:bg-[#16181A] space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900 dark:text-white">
                  Spotify API-sleutels (worden persistent opgeslagen in /data)
                </span>
                <span
                  className={`font-mono text-[10px] px-2 py-0.5 rounded ${
                    spotifyAuth.hasCredentials
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold'
                  }`}
                >
                  {spotifyAuth.hasCredentials ? 'Sleutels Geconfigureerd ✓' : 'Sleutels Vereist'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    SPOTIFY_CLIENT_ID
                  </label>
                  <input
                    type="text"
                    value={modalClientId}
                    onChange={(e) => setModalClientId(e.target.value)}
                    placeholder="Plak je Spotify Client ID..."
                    className="w-full font-mono text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#1E2124] text-slate-900 dark:text-white focus:outline-none focus:border-[#FF8F00]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    SPOTIFY_CLIENT_SECRET
                  </label>
                  <input
                    type="password"
                    value={modalClientSecret}
                    onChange={(e) => setModalClientSecret(e.target.value)}
                    placeholder={
                      spotifyAuth.hasCredentials
                        ? '•••••••••••••••• (reeds opgeslagen)'
                        : 'Plak je Spotify Client Secret...'
                    }
                    className="w-full font-mono text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#1E2124] text-slate-900 dark:text-white focus:outline-none focus:border-[#FF8F00]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSaveModalCredentials}
                  disabled={isSavingModalCreds}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#FF8F00]/50 bg-[#FF8F00]/15 text-amber-900 dark:text-[#FF8F00] hover:bg-[#FF8F00]/25 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSavingModalCreds ? 'Opslaan...' : 'Sleutels Opslaan'}
                </button>
                <button
                  type="button"
                  onClick={handleTestModalCredentials}
                  disabled={isTestingModalCreds}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#00B4D8]/40 bg-[#00B4D8]/10 text-[#00B4D8] hover:bg-[#00B4D8]/20 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isTestingModalCreds ? 'Controleren...' : 'Test API Sleutels'}
                </button>
              </div>
            </div>

            {/* Step 2: Redirect URIs */}
            <div className="space-y-2.5 text-xs">
              <div>
                <div className="text-slate-700 dark:text-slate-300 mb-1 font-semibold">
                  Huidige Actieve Redirect URI (voeg deze exact toe in je Spotify Dashboard):
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded bg-slate-100 dark:bg-[#121416] font-mono text-[11px] text-[#FF8F00] overflow-x-auto border border-[#FF8F00]/40">
                    {spotifyAuth.redirectUri || `${window.location.origin}/auth/callback`}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        spotifyAuth.redirectUri || `${window.location.origin}/auth/callback`,
                        'active_redirect'
                      )
                    }
                    className="px-3 py-2 rounded border border-[#FF8F00]/40 bg-[#FF8F00]/10 text-amber-900 dark:text-[#FF8F00] text-xs font-semibold hover:bg-[#FF8F00]/20 shrink-0"
                  >
                    {copiedUrlKey === 'active_redirect' ? 'Gekopieerd ✓' : 'Kopieer'}
                  </button>
                </div>
              </div>

              <div>
                <div className="text-slate-500 dark:text-slate-400 mb-1 font-medium">
                  Development Redirect URI:
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-1.5 rounded bg-slate-100 dark:bg-[#121416] font-mono text-[11px] text-slate-800 dark:text-[#E6E7E9] overflow-x-auto border border-slate-200 dark:border-[#3A3D40]">
                    {devCallbackUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(devCallbackUrl, 'dev')}
                    className="px-3 py-1.5 rounded border border-slate-200 dark:border-[#3A3D40] text-xs font-medium hover:bg-slate-100 dark:hover:bg-[#25282C] shrink-0"
                  >
                    {copiedUrlKey === 'dev' ? 'Gekopieerd' : 'Kopieer'}
                  </button>
                </div>
              </div>

              <div>
                <div className="text-slate-500 dark:text-slate-400 mb-1 font-medium">
                  Shared / Deployed Redirect URI:
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-1.5 rounded bg-slate-100 dark:bg-[#121416] font-mono text-[11px] text-slate-800 dark:text-[#E6E7E9] overflow-x-auto border border-slate-200 dark:border-[#3A3D40]">
                    {sharedCallbackUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(sharedCallbackUrl, 'shared')}
                    className="px-3 py-1.5 rounded border border-slate-200 dark:border-[#3A3D40] text-xs font-medium hover:bg-slate-100 dark:hover:bg-[#25282C] shrink-0"
                  >
                    {copiedUrlKey === 'shared' ? 'Gekopieerd' : 'Kopieer'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-[#3A3D40]">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {spotifyAuth.connected
                  ? `Verbonden als ${spotifyAuth.user?.display_name}`
                  : isWaitingForOAuthPopup
                  ? 'Wachten op Spotify autorisatie in pop-up...'
                  : 'Niet verbonden'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowOAuthModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-[#3A3D40] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#25282C]"
                >
                  Sluiten
                </button>
                <button
                  type="button"
                  onClick={handleConnectSpotify}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 shadow-sm cursor-pointer"
                >
                  {modalClientId.trim() || modalClientSecret.trim()
                    ? 'Opslaan & Start Spotify OAuth Popup'
                    : 'Start Spotify OAuth Popup'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
