import React, { useState, useEffect } from 'react';
import {
  Server,
  HardDrive,
  KeyRound,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  FolderOpen,
  Sliders,
  ChevronDown,
  ChevronUp,
  Tag,
  Calendar,
  Layers,
  Sparkles,
  Info,
  AlertTriangle,
  X,
} from 'lucide-react';

export interface BuildVersionInfo {
  date: string;
  buildNumber: number;
  version: string;
  builtAt: string;
}

export interface AppAuthStatus {
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

export interface SpotifyOAuthError {
  code: string;
  message: string;
  details?: string;
  hint?: string;
  redirectUriUsed?: string;
  timestamp: string;
}

export interface SpotifyAuthStatus {
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

interface InlineConfigPanelProps {
  buildInfo: BuildVersionInfo;
  onBumpBuild: () => void;
  appAuthStatus: AppAuthStatus;
  spotifyAuth: SpotifyAuthStatus;
  onConnectSpotify: () => void;
  onDisconnectSpotify: () => void;
  onRefreshSpotifyStatus: () => void;
  stackGitRepoUrl: string;
  setStackGitRepoUrl: (v: string) => void;
  stackMusicPath: string;
  setStackMusicPath: (v: string) => void;
  stackDataPath: string;
  setStackDataPath: (v: string) => void;
  stackExportsPath: string;
  setStackExportsPath: (v: string) => void;
  stackPort: string;
  setStackPort: (v: string) => void;
  dockhandMode: 'git_clone' | 'git_build';
  setDockhandMode: (mode: 'git_clone' | 'git_build') => void;
  generatedDockhandYaml: string;
  copyToClipboard: (text: string, key: string) => void;
  copiedUrlKey: string | null;
  onClose?: () => void;
  isCollapsible?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const InlineConfigPanel: React.FC<InlineConfigPanelProps> = ({
  buildInfo,
  onBumpBuild,
  appAuthStatus,
  spotifyAuth,
  onConnectSpotify,
  onDisconnectSpotify,
  onRefreshSpotifyStatus,
  stackGitRepoUrl,
  setStackGitRepoUrl,
  stackMusicPath,
  setStackMusicPath,
  stackDataPath,
  setStackDataPath,
  stackExportsPath,
  setStackExportsPath,
  stackPort,
  setStackPort,
  dockhandMode,
  setDockhandMode,
  generatedDockhandYaml,
  copyToClipboard,
  copiedUrlKey,
  onClose,
  isCollapsible = false,
  isExpanded = true,
  onToggleExpand,
}) => {
  const [clientIdInput, setClientIdInput] = useState<string>(spotifyAuth.clientId || '');
  const [clientSecretInput, setClientSecretInput] = useState<string>('');
  const [isSavingCreds, setIsSavingCreds] = useState<boolean>(false);
  const [isTestingCreds, setIsTestingCreds] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [testResultMsg, setTestResultMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [activeConfigSection, setActiveConfigSection] = useState<'all' | 'spotify' | 'volumes' | 'dockhand' | 'version'>('all');

  // Load existing credentials on mount
  useEffect(() => {
    fetch('/api/auth/spotify/credentials')
      .then((r) => r.json())
      .then((data) => {
        if (data.clientId) {
          setClientIdInput(data.clientId);
        }
      })
      .catch(() => {});
  }, []);

  const saveCredentialsRequest = async () => {
    const resp = await fetch('/api/auth/spotify/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: clientIdInput.trim(),
        clientSecret: clientSecretInput.trim(),
      }),
    });
    return resp.ok;
  };

  const handleSaveSpotifyCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingCreds(true);
    setSaveSuccess(false);
    setTestResultMsg(null);
    try {
      const ok = await saveCredentialsRequest();
      if (ok) {
        setSaveSuccess(true);
        setClientSecretInput('');
        setTimeout(() => setSaveSuccess(false), 3000);
        onRefreshSpotifyStatus();
      }
    } finally {
      setIsSavingCreds(false);
    }
  };

  const handleTestSpotifyCredentials = async () => {
    setIsTestingCreds(true);
    setTestResultMsg(null);
    try {
      const resp = await fetch(
        `/api/auth/spotify/test?origin=${encodeURIComponent(window.location.origin)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientIdInput.trim() || undefined,
            clientSecret: clientSecretInput.trim() || undefined,
          }),
        }
      );
      const data = await resp.json();
      if (resp.ok && data.ok) {
        setClientSecretInput('');
        setTestResultMsg({ ok: true, text: data.message });
      } else {
        setTestResultMsg({
          ok: false,
          text: data.error?.message || 'API-sleutels konden niet worden geverifieerd.',
        });
      }
      onRefreshSpotifyStatus();
    } catch {
      setTestResultMsg({
        ok: false,
        text: 'Netwerkfout bij het testen van de Spotify API-sleutels.',
      });
    } finally {
      setIsTestingCreds(false);
    }
  };

  const handleSaveAndConnectSpotify = async () => {
    if (clientIdInput.trim() || clientSecretInput.trim()) {
      setIsSavingCreds(true);
      try {
        await saveCredentialsRequest();
        setClientSecretInput('');
        onRefreshSpotifyStatus();
      } finally {
        setIsSavingCreds(false);
      }
    }
    onConnectSpotify();
  };

  const handleClearOAuthError = async () => {
    setTestResultMsg(null);
    await fetch('/api/auth/spotify/clear-error', { method: 'POST' }).catch(() => {});
    onRefreshSpotifyStatus();
  };

  const devCallbackUrl =
    'https://ais-dev-tzqpzkh4ocjalcl3kqjfzz-636815722959.europe-west3.run.app/auth/callback';
  const sharedCallbackUrl =
    'https://ais-pre-tzqpzkh4ocjalcl3kqjfzz-636815722959.europe-west3.run.app/auth/callback';
  const activeRedirectUri = spotifyAuth.redirectUri || `${window.location.origin}/auth/callback`;

  return (
    <div className="border border-slate-200 dark:border-[#3A3D40] rounded-xl bg-white dark:bg-[#1E2124] overflow-hidden shadow-lg transition-all">
      {/* Header Bar */}
      <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-[#3A3D40] bg-slate-50/70 dark:bg-[#17191B] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-[#D84315] to-[#FF8F00] text-slate-950">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                MP3Spot Inline Systeem- & Stack-Configuratie
              </h2>
              <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-[#FF8F00]/20 text-[#FF8F00] font-semibold border border-[#FF8F00]/30">
                v{buildInfo.version}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Beheer Spotify OAuth, Docker Volume mappingen (/music, /data, /exports) en Dockhand zero-copy stack
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isCollapsible && onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#3A3D40] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#25282C] transition-colors"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>Inklappen</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Uitklappen</span>
                </>
              )}
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-[#25282C]"
            >
              Sluiten
            </button>
          )}
        </div>
      </div>

      {(!isCollapsible || isExpanded) && (
        <div className="p-4 sm:p-6 space-y-6">
          {/* Quick Filter Navigation Sub-tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-[#151719] border border-slate-200 dark:border-[#3A3D40] rounded-lg overflow-x-auto text-xs">
            {[
              { id: 'all', label: 'Alles Weergeven', icon: Layers },
              { id: 'spotify', label: 'Spotify API & OAuth', icon: KeyRound },
              { id: 'volumes', label: 'Docker Volumes & Mounts', icon: HardDrive },
              { id: 'dockhand', label: 'Dockhand Stack YAML', icon: Server },
              { id: 'version', label: 'Build Versiebeheer', icon: Calendar },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeConfigSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveConfigSection(tab.id as any)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 font-medium rounded-md whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-white dark:bg-[#202225] text-slate-900 dark:text-white shadow-xs border border-slate-200 dark:border-[#3A3D40]'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#FF8F00]' : ''}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* SECTION 1: Spotify API Credentials & Status */}
            {(activeConfigSection === 'all' || activeConfigSection === 'spotify') && (
              <div className={`${activeConfigSection === 'spotify' ? 'lg:col-span-12' : 'lg:col-span-6'} border border-slate-200 dark:border-[#3A3D40] rounded-xl p-5 space-y-4 bg-slate-50/50 dark:bg-[#1A1D20]`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[#FF8F00]" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      1. Spotify API Koppeling & OAuth
                    </h3>
                  </div>
                  {spotifyAuth.connected ? (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/30 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Verbonden ({spotifyAuth.user?.display_name})
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold border border-amber-500/30">
                      Niet verbonden
                    </span>
                  )}
                </div>

                {/* Detailed OAuth Error Diagnostic Card */}
                {spotifyAuth.lastError && (
                  <div className="p-3.5 rounded-lg border border-[#D84315] bg-[#D84315]/10 text-xs space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 font-bold text-[#D84315] dark:text-[#FF8F00]">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Spotify OAuth Foutmelding ({spotifyAuth.lastError.code})</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearOAuthError}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-0.5"
                        title="Foutmelding wissen"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="font-medium text-slate-900 dark:text-white">
                      {spotifyAuth.lastError.message}
                    </p>
                    {spotifyAuth.lastError.details && (
                      <div className="p-2 rounded bg-slate-900/90 text-rose-300 font-mono text-[11px] break-all border border-slate-700">
                        {spotifyAuth.lastError.details}
                      </div>
                    )}
                    {spotifyAuth.lastError.hint && (
                      <div className="p-2.5 rounded bg-[#00B4D8]/10 border border-[#00B4D8]/30 text-slate-800 dark:text-slate-200 leading-relaxed">
                        <strong className="text-[#00B4D8] block mb-0.5">Oplossing:</strong>
                        {spotifyAuth.lastError.hint}
                      </div>
                    )}
                  </div>
                )}

                {testResultMsg && (
                  <div
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                      testResultMsg.ok
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-[#D84315]/50 bg-[#D84315]/10 text-[#D84315] dark:text-[#FF8F00]'
                    }`}
                  >
                    <span>{testResultMsg.text}</span>
                    <button
                      type="button"
                      onClick={() => setTestResultMsg(null)}
                      className="opacity-70 hover:opacity-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Maak een app aan in het{' '}
                  <a
                    href="https://developer.spotify.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#00B4D8] hover:underline inline-flex items-center gap-0.5 font-medium"
                  >
                    Spotify Developer Dashboard <ExternalLink className="w-3 h-3" />
                  </a>
                  , voeg onderstaande Redirect URI toe én voeg bij <strong>Users and Access</strong> je eigen Spotify e-mailadres toe (verplicht in Spotify Development Mode).
                </p>

                {/* Redirect URI with copy */}
                <div className="p-3 rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-white dark:bg-[#141618] space-y-2 text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                    Actieve Redirect URI voor jouw huidige omgeving (voeg toe in Spotify Dashboard):
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={activeRedirectUri}
                      className="flex-1 font-mono text-[11px] px-2.5 py-1.5 rounded border border-slate-300 dark:border-[#3A3D40] bg-slate-50 dark:bg-[#1E2124] text-slate-800 dark:text-slate-200 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(activeRedirectUri, 'inline_uri')}
                      className="px-3 py-1.5 text-xs font-semibold rounded border border-[#00B4D8]/40 bg-[#00B4D8]/10 text-[#00B4D8] hover:bg-[#00B4D8]/20 transition-colors flex items-center gap-1 shrink-0"
                    >
                      {copiedUrlKey === 'inline_uri' ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Gekopieerd
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Kopieer
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Credentials input form */}
                <form onSubmit={handleSaveSpotifyCredentials} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      SPOTIFY_CLIENT_ID
                    </label>
                    <input
                      type="text"
                      value={clientIdInput}
                      onChange={(e) => setClientIdInput(e.target.value)}
                      placeholder="bijv. 3a7f8e910b..."
                      className="w-full font-mono text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#141618] text-slate-900 dark:text-white focus:outline-none focus:border-[#FF8F00]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      SPOTIFY_CLIENT_SECRET
                    </label>
                    <input
                      type="password"
                      value={clientSecretInput}
                      onChange={(e) => setClientSecretInput(e.target.value)}
                      placeholder={
                        spotifyAuth.hasCredentials
                          ? '•••••••••••••••• (reeds opgeslagen — laat leeg of vul nieuw in)'
                          : 'Plak hier je Client Secret van Spotify...'
                      }
                      className="w-full font-mono text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#141618] text-slate-900 dark:text-white focus:outline-none focus:border-[#FF8F00]"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        disabled={isSavingCreds}
                        className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                      >
                        {isSavingCreds ? 'Opslaan...' : saveSuccess ? 'Opgeslagen! ✓' : 'Sleutels Opslaan'}
                      </button>

                      <button
                        type="button"
                        onClick={handleTestSpotifyCredentials}
                        disabled={isTestingCreds}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#00B4D8]/40 bg-[#00B4D8]/10 text-[#00B4D8] hover:bg-[#00B4D8]/20 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isTestingCreds ? 'Testen...' : 'Test API Sleutels'}
                      </button>

                      <button
                        type="button"
                        onClick={onRefreshSpotifyStatus}
                        className="p-1.5 rounded-lg border border-slate-300 dark:border-[#3A3D40] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        title="Ververs status"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {spotifyAuth.connected ? (
                      <button
                        type="button"
                        onClick={onDisconnectSpotify}
                        className="px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline"
                      >
                        Ontkoppel Spotify
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSaveAndConnectSpotify}
                        className="px-3.5 py-1.5 text-xs font-bold rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                      >
                        Verbind Spotify Account
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}

            {/* SECTION 2: Docker Volume Mappings */}
            {(activeConfigSection === 'all' || activeConfigSection === 'volumes') && (
              <div className={`${activeConfigSection === 'volumes' ? 'lg:col-span-12' : 'lg:col-span-6'} border border-slate-200 dark:border-[#3A3D40] rounded-xl p-5 space-y-4 bg-slate-50/50 dark:bg-[#1A1D20]`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-[#00B4D8]" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      2. Docker Volumes & Opslagstatus
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    3 Volumes Geconfigureerd
                  </span>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400">
                  MP3Spot gebruikt 3 persistente Docker mountpunten voor directe toegang tot je lokale collectie en ID3 tagging:
                </p>

                <div className="space-y-2.5 text-xs">
                  {/* Volume 1 */}
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-white dark:bg-[#141618] flex items-start justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="font-mono text-[#FF8F00]">{appAuthStatus.musicLibraryPath || '/music'}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                          :rw (Schrijfbaar)
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Host NAS of lokale muziekmap. Nodig voor het direct schrijven van officiële Spotify ID3v2.3 tags naar de audiobestanden.
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 truncate">
                        Host pad in stack: {stackMusicPath}
                      </div>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold shrink-0 ${
                      appAuthStatus.musicMountAvailable
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}>
                      {appAuthStatus.musicMountAvailable ? 'Gemount' : 'Gereed'}
                    </span>
                  </div>

                  {/* Volume 2 */}
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-white dark:bg-[#141618] flex items-start justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="font-mono text-[#00B4D8]">{appAuthStatus.dataPath || '/data'}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                          :rw Database
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Persistente index, slimme afspeellijstregels, Spotify token sessies en sync historie.
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 truncate">
                        Host volume: {stackDataPath}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
                      Actief
                    </span>
                  </div>

                  {/* Volume 3 */}
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-white dark:bg-[#141618] flex items-start justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="font-mono text-[#00B4D8]">{appAuthStatus.exportsPath || '/exports'}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
                          :rw Exports
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Exportmap op de host voor gegenereerde .m3u8 afspeellijsten, CSV audit reports en JSON sync mappings.
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 truncate">
                        Host export pad: {stackExportsPath}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
                      Actief
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 3: Dockhand Zero-Copy Stack Generator */}
            {(activeConfigSection === 'all' || activeConfigSection === 'dockhand') && (
              <div className="lg:col-span-12 border border-slate-200 dark:border-[#3A3D40] rounded-xl p-5 space-y-4 bg-slate-50/50 dark:bg-[#1A1D20]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-[#3A3D40] pb-3">
                  <div className="flex items-center gap-2.5">
                    <Server className="w-4 h-4 text-[#FF8F00]" />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        3. Dockhand Stack YAML (Zero-Copy GitHub Automatisch)
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Plak deze stack in Dockhand of Portainer. Haalt bij het opstarten zelf de code op van GitHub; je hoeft geen bestanden handmatig te kopiëren!
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1 p-0.5 bg-slate-200 dark:bg-[#151719] rounded-lg text-xs">
                      <button
                        type="button"
                        onClick={() => setDockhandMode('git_clone')}
                        className={`px-2.5 py-1 rounded font-medium transition-colors ${
                          dockhandMode === 'git_clone'
                            ? 'bg-white dark:bg-[#202225] text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Git Clone (Aanbevolen)
                      </button>
                      <button
                        type="button"
                        onClick={() => setDockhandMode('git_build')}
                        className={`px-2.5 py-1 rounded font-medium transition-colors ${
                          dockhandMode === 'git_build'
                            ? 'bg-white dark:bg-[#202225] text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Git Build
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => copyToClipboard(generatedDockhandYaml, 'inline_yaml')}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-gradient-to-r from-[#D84315] to-[#FF8F00] text-slate-950 hover:brightness-110 transition-all shadow-xs"
                    >
                      {copiedUrlKey === 'inline_yaml' ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Gekopieerd!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Kopieer Stack YAML
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Stack Variables Form */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                  <div className="lg:col-span-2">
                    <label className="block text-slate-600 dark:text-slate-400 mb-1 font-semibold">
                      GitHub Repository URL
                    </label>
                    <input
                      type="text"
                      value={stackGitRepoUrl}
                      onChange={(e) => setStackGitRepoUrl(e.target.value)}
                      placeholder="https://github.com/jouw-gebruikersnaam/mp3spot.git"
                      className="w-full font-mono text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#141618] text-slate-900 dark:text-white focus:outline-none focus:border-[#FF8F00]"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1 font-semibold">
                      Host Muziekmap (/music)
                    </label>
                    <input
                      type="text"
                      value={stackMusicPath}
                      onChange={(e) => setStackMusicPath(e.target.value)}
                      placeholder="/mnt/nas/muziek"
                      className="w-full font-mono text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#141618] text-slate-900 dark:text-white focus:outline-none focus:border-[#FF8F00]"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1 font-semibold">
                      Host Database (/data)
                    </label>
                    <input
                      type="text"
                      value={stackDataPath}
                      onChange={(e) => setStackDataPath(e.target.value)}
                      placeholder="mp3spot_data"
                      className="w-full font-mono text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#141618] text-slate-900 dark:text-white focus:outline-none focus:border-[#FF8F00]"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1 font-semibold">
                      Host Port
                    </label>
                    <input
                      type="text"
                      value={stackPort}
                      onChange={(e) => setStackPort(e.target.value)}
                      placeholder="3000"
                      className="w-full font-mono text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-[#3A3D40] bg-white dark:bg-[#141618] text-slate-900 dark:text-white focus:outline-none focus:border-[#FF8F00]"
                    />
                  </div>
                </div>

                {/* Preformatted YAML preview */}
                <div className="relative">
                  <pre className="p-4 rounded-xl bg-[#121416] text-[#E6E7E9] font-mono text-[11px] leading-relaxed overflow-x-auto max-h-72 border border-slate-300/30 dark:border-[#3A3D40]">
                    {generatedDockhandYaml}
                  </pre>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(generatedDockhandYaml, 'inline_yaml')}
                    className="absolute top-3 right-3 px-3 py-1 text-xs font-semibold rounded bg-[#FF8F00] text-slate-950 hover:brightness-110 shadow-xs flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> Kopieer
                  </button>
                </div>
              </div>
            )}

            {/* SECTION 4: Build Versioning & Status */}
            {(activeConfigSection === 'all' || activeConfigSection === 'version') && (
              <div className="lg:col-span-12 border border-slate-200 dark:border-[#3A3D40] rounded-xl p-5 space-y-4 bg-slate-50/50 dark:bg-[#1A1D20]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#FF8F00]" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      4. MP3Spot Build Versiebeheer (year.month.day[.build#])
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={onBumpBuild}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[#FF8F00]/40 bg-[#FF8F00]/10 text-amber-900 dark:text-[#FF8F00] hover:bg-[#FF8F00]/20 transition-colors shrink-0"
                  >
                    Simuleer Nieuwe Build (+1 build#)
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-white dark:bg-[#141618]">
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">Huidige Versie String</div>
                    <div className="text-base font-bold font-mono text-[#FF8F00] mt-0.5">
                      v{buildInfo.version}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-white dark:bg-[#141618]">
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">Dag-Build Teller</div>
                    <div className="text-base font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                      build# {buildInfo.buildNumber} {buildInfo.buildNumber === 0 ? '(Eerste build vandaag)' : ''}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-slate-200 dark:border-[#3A3D40] bg-white dark:bg-[#141618]">
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">Laatst Gebouwd Op</div>
                    <div className="text-xs font-mono text-slate-700 dark:text-slate-300 mt-1 truncate">
                      {new Date(buildInfo.builtAt).toLocaleString('nl-NL')}
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Volgens jouw specificatie: de eerste build van de dag heeft <span className="font-mono">build# = 0</span> en toont alleen de datum (bijv.{' '}
                  <span className="font-mono">{buildInfo.date}</span>). Volgende builds van dezelfde dag tonen{' '}
                  <span className="font-mono">{buildInfo.date}.1</span>,{' '}
                  <span className="font-mono">{buildInfo.date}.2</span>, enz.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
