import fs from 'fs';
import path from 'path';

interface VersionData {
  date: string;
  buildNumber: number;
  version: string;
  builtAt: string;
}

const versionFilePath = path.join(process.cwd(), 'src', 'version.json');

function formatBuildVersion(dateStr: string, buildNumber: number): string {
  // First build of the day has buildNumber = 0 (no .build# suffix).
  // Subsequent builds of the day (buildNumber >= 1) append .build# (e.g. 2026.11.03.1)
  return buildNumber >= 1 ? `${dateStr}.${buildNumber}` : dateStr;
}

function updateBuildVersion() {
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

  let nextBuildNumber = 0;
  if (current && current.date === todayStr) {
    nextBuildNumber = (typeof current.buildNumber === 'number' ? current.buildNumber : -1) + 1;
  } else {
    // First build of the day is 0
    nextBuildNumber = 0;
  }

  const versionString = formatBuildVersion(todayStr, nextBuildNumber);

  const nextData: VersionData = {
    date: todayStr,
    buildNumber: nextBuildNumber,
    version: versionString,
    builtAt: now.toISOString(),
  };

  fs.writeFileSync(versionFilePath, JSON.stringify(nextData, null, 2) + '\n', 'utf8');
  console.log(`[MP3Spot Build] Version: ${versionString} (build# ${nextBuildNumber})`);
}

updateBuildVersion();
