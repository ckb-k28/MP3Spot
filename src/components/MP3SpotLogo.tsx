import React from 'react';

interface MP3SpotLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  version?: string;
  className?: string;
}

export const MP3SpotIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 32,
  className = '',
}) => {
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-label="MP3Spot Logo"
    >
      <defs>
        <radialGradient id="discGradComponent" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2c2f32" />
          <stop offset="70%" stopColor="#202225" />
          <stop offset="100%" stopColor="#16181a" />
        </radialGradient>

        <linearGradient id="fireGradComponent" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#D84315" />
          <stop offset="60%" stopColor="#F4511E" />
          <stop offset="100%" stopColor="#FF8F00" />
        </linearGradient>

        <linearGradient id="coreFlameGradComponent" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#0077B6" />
          <stop offset="50%" stopColor="#00B4D8" />
          <stop offset="100%" stopColor="#90E0EF" />
        </linearGradient>

        <filter id="glowComponent" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Outer Vinyl Disc (Nacht / Antraciet #3A3D40) */}
      <circle cx="64" cy="64" r="58" fill="url(#discGradComponent)" stroke="#3A3D40" strokeWidth="4" />

      {/* Concentric Sound Grooves */}
      <circle cx="64" cy="64" r="49" stroke="#3A3D40" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.7" />
      <circle cx="64" cy="64" r="41" stroke="#3A3D40" strokeWidth="1" strokeDasharray="4 2" opacity="0.6" />
      <circle cx="64" cy="64" r="33" stroke="#3A3D40" strokeWidth="1" opacity="0.5" />

      {/* Radiating Soundwaves (Gloeiende Kolen & Knisperend Vuur #D84315 / #FF8F00) */}
      <path d="M 32 50 A 40 40 0 0 1 96 50" stroke="url(#fireGradComponent)" strokeWidth="4.5" strokeLinecap="round" opacity="0.95" />
      <path d="M 38 64 A 28 28 0 0 1 90 64" stroke="url(#fireGradComponent)" strokeWidth="4" strokeLinecap="round" />
      <path d="M 45 77 A 20 20 0 0 1 83 77" stroke="url(#fireGradComponent)" strokeWidth="3.5" strokeLinecap="round" opacity="0.9" />

      {/* Center Coal Hub */}
      <circle cx="64" cy="64" r="21" fill="#181A1C" stroke="url(#fireGradComponent)" strokeWidth="2.5" />

      {/* Hete Vlamkern (Helder Blauw #00B4D8 Core) */}
      <circle cx="64" cy="64" r="13" fill="#0C1924" stroke="url(#coreFlameGradComponent)" strokeWidth="2.5" filter="url(#glowComponent)" />

      {/* Stylized Heat Flame Spindle */}
      <path d="M 64 54 C 60.5 59.5, 58 63, 58 66.5 C 58 70, 60.5 73, 64 73 C 67.5 73, 70 70, 70 66.5 C 70 63, 67.5 59.5, 64 54 Z" fill="url(#coreFlameGradComponent)" />
      
      {/* Tiny Hot Core Spindle Center */}
      <circle cx="64" cy="66.5" r="2.2" fill="#FFFFFF" />
    </svg>
  );
};

export const MP3SpotLogo: React.FC<MP3SpotLogoProps> = ({
  size = 'md',
  showText = true,
  version,
  className = '',
}) => {
  const pixelSize = size === 'sm' ? 24 : size === 'md' ? 32 : size === 'lg' ? 44 : 56;
  const textSize =
    size === 'sm'
      ? 'text-sm'
      : size === 'md'
      ? 'text-lg'
      : size === 'lg'
      ? 'text-2xl'
      : 'text-3xl';

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <MP3SpotIcon size={pixelSize} />
      {showText && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 leading-none">
            <span className={`font-bold font-display tracking-tight text-slate-900 dark:text-white ${textSize}`}>
              MP3<span className="text-[#FF8F00]">Spot</span>
            </span>
            {version && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#3A3D40]/30 text-[#00B4D8] border border-[#00B4D8]/30">
                v{version}
              </span>
            )}
          </div>
          <span className="text-[10px] text-slate-500 dark:text-[#E6E7E9]/60 font-mono tracking-wider uppercase mt-0.5">
            Spotify ID3 Tagging & Sync
          </span>
        </div>
      )}
    </div>
  );
};
