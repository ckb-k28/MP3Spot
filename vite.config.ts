import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

interface VersionData {
  date: string;
  buildNumber: number;
  version: string;
  builtAt: string;
}

function mp3spotVersionBumpPlugin(): Plugin {
  return {
    name: 'mp3spot-version-bump',
    configResolved(config) {
      if (config.command !== 'build' || process.env.SKIP_VERSION_BUMP === 'true') {
        return;
      }
      const versionFilePath = path.resolve(__dirname, 'src', 'version.json');
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const todayStr = `${year}.${month}.${day}`;

      let current: VersionData | null = null;
      if (fs.existsSync(versionFilePath)) {
        try {
          current = JSON.parse(fs.readFileSync(versionFilePath, 'utf8')) as VersionData;
        } catch {
          current = null;
        }
      }

      const nextBuildNumber =
        current && current.date === todayStr
          ? (typeof current.buildNumber === 'number' ? current.buildNumber : 0) + 1
          : 0;

      const versionString =
        nextBuildNumber >= 1 ? `${todayStr}.${nextBuildNumber}` : todayStr;

      const nextData: VersionData = {
        date: todayStr,
        buildNumber: nextBuildNumber,
        version: versionString,
        builtAt: now.toISOString(),
      };

      try {
        fs.writeFileSync(versionFilePath, JSON.stringify(nextData, null, 2) + '\n', 'utf8');
        console.log(`[MP3Spot Build] Version bumped to: ${versionString}`);
      } catch {
        // Ignore write errors in read-only filesystems
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [mp3spotVersionBumpPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
