/**
 * The browser: a pinned chrome-headless-shell, installed into `~/.cache/lectern/chrome/` on first use
 * (~15 s, ~215 MB), so every machine renders with the same engine. Pinning matches puppeteer-core's own
 * revision, which is the build its CDP client is tested against.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import { Browser as BrowserKind, computeExecutablePath, detectBrowserPlatform, install } from '@puppeteer/browsers';

export const CHROME_BUILD = '157.0.8103.50';

/** Stage size in CSS px and the device scale that makes it 1920×1080. */
export const STAGE = { width: 1280, height: 720, deviceScaleFactor: 1.5 } as const;

const FLAGS = [
  '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars', '--disable-gpu',
  // A screenshot otherwise waits for the next vsync-paced frame: 39 ms → 8.7 ms per capture (calibration).
  '--disable-frame-rate-limit', '--disable-gpu-vsync',
  // Re-rastering only an invalidated rect can differ by 1 LSB from a full raster; every frame must be exact.
  '--disable-partial-raster',
  // setViewport's deviceScaleFactor does not reach captureScreenshot in headless shell (captures came out
  // 1280×720); forcing it at launch makes every capture 1920×1080.
  `--force-device-scale-factor=${STAGE.deviceScaleFactor}`,
  '--allow-file-access-from-files', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--mute-audio',
];

const cacheDir = () => path.join(os.homedir(), '.cache', 'lectern', 'chrome');

async function executable(): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error('lectern: unsupported platform for chrome-headless-shell');
  const opts = { browser: BrowserKind.CHROMEHEADLESSSHELL, buildId: CHROME_BUILD, cacheDir: cacheDir(), platform };
  const exe = computeExecutablePath(opts);
  if (fs.existsSync(exe)) return exe;
  process.stderr.write(`lectern: downloading chrome-headless-shell ${CHROME_BUILD} (one time)\n`);
  return (await install(opts)).executablePath;
}

/**
 * Launch Chrome. With `profile` (a directory the caller owns and deletes, such as the build's scratch), the
 * browser keeps its profile there and is meant to end with `killChrome`; without it, puppeteer keeps a
 * temporary profile that `browser.close()` removes.
 */
export async function launchChrome(profile?: string): Promise<Browser> {
  return puppeteer.launch({ executablePath: await executable(), headless: true, args: FLAGS, defaultViewport: null, protocolTimeout: 120_000,
    ...(profile ? { userDataDir: profile } : {}) });
}

/**
 * End a browser launched with a profile: SIGKILL its process group (the browser and its helpers) and wait
 * for the browser process to exit. Chrome writes nothing we keep, so a graceful close only costs time:
 * 0.04 s typically, and up to 5 s when puppeteer waits out its exit timer.
 */
export async function killChrome(browser: Browser): Promise<void> {
  const proc = browser.process();
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise<void>(r => proc.once('exit', () => r()));
  try { process.kill(-proc.pid!, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }   // the group, else the browser alone
  await exited;
}
