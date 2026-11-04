import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const versionFilePath = path.join(process.cwd(), 'src', 'version.json');
const packageJsonPath = path.join(process.cwd(), 'package.json');

function getTodayDateString() {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Amsterdam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA formats as YYYY-MM-DD
    return formatter.format(new Date()).replace(/-/g, '.');
  } catch {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  }
}

function formatBuildVersion(dateStr, buildNumber) {
  // Eerste build van de dag heeft buildNumber = 0 (geen .build# achtervoegsel -> YYYY.MM.DD).
  // Elke volgende build op dezelfde dag (buildNumber >= 1) krijgt .build# (bijv. 2026.11.04.1, 2026.11.04.2).
  return buildNumber >= 1 ? `${dateStr}.${buildNumber}` : dateStr;
}

function getGitCommitsTodayCount() {
  try {
    const out = execSync('git rev-list --count --since="00:00:00" HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parsed = parseInt(out, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function updateBuildVersion() {
  const now = new Date();
  const todayStr = process.env.APP_DATE && process.env.APP_DATE.trim()
    ? process.env.APP_DATE.trim()
    : getTodayDateString();

  let current = null;
  if (fs.existsSync(versionFilePath)) {
    try {
      current = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
    } catch {
      current = null;
    }
  }

  const skipBump = process.env.SKIP_VERSION_BUMP === 'true';
  const envBuildArg =
    process.env.APP_BUILD_NUMBER !== undefined && process.env.APP_BUILD_NUMBER !== ''
      ? parseInt(process.env.APP_BUILD_NUMBER, 10)
      : NaN;

  let nextDate = todayStr;
  let nextBuildNumber = 0;

  if (!Number.isNaN(envBuildArg) && envBuildArg >= 0) {
    // Explicit build number passed from GitHub Actions / Docker build-arg
    const currentTodayBuild =
      current && current.date === todayStr && typeof current.buildNumber === 'number'
        ? current.buildNumber
        : 0;
    nextBuildNumber = Math.max(envBuildArg, currentTodayBuild);
  } else if (skipBump) {
    // Inside Docker build without explicit APP_BUILD_NUMBER:
    // Keep src/version.json if it is already from today; otherwise compute from git commits today
    if (current && current.date === todayStr && typeof current.buildNumber === 'number') {
      nextDate = current.date;
      nextBuildNumber = current.buildNumber;
    } else {
      const commitsToday = getGitCommitsTodayCount();
      nextBuildNumber = commitsToday > 1 ? commitsToday - 1 : 0;
    }
  } else {
    // Standard build (AI Studio / local npm run build): always increment buildNumber for today
    if (current && current.date === todayStr) {
      nextBuildNumber = (typeof current.buildNumber === 'number' ? current.buildNumber : 0) + 1;
    } else {
      const commitsToday = getGitCommitsTodayCount();
      nextBuildNumber = commitsToday > 1 ? commitsToday - 1 : 0;
    }
  }

  const versionString = formatBuildVersion(nextDate, nextBuildNumber);

  const nextData = {
    date: nextDate,
    buildNumber: nextBuildNumber,
    version: versionString,
    builtAt: now.toISOString(),
  };

  fs.writeFileSync(versionFilePath, JSON.stringify(nextData, null, 2) + '\n', 'utf8');

  // Synchroniseer ook package.json zodat beide altijd dezelfde versie tonen
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      pkg.version = versionString;
      fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    } catch {
      // Ignore package.json write errors
    }
  }

  console.log(`[MP3Spot Build] Version: v${versionString} (datum: ${nextDate}, build#: ${nextBuildNumber})`);
}

updateBuildVersion();
