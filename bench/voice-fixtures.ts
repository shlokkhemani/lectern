// Usage: bun bench/voice-fixtures.ts <script.md> [more scripts...]
// Refreshes test/fixtures/voice/ from the voice cache ($XDG_CACHE_HOME/lectern/voice, else ~/.cache/lectern/voice):
// for every narrated scene of the scripts, the cache entry verbatim (<key>.json) and its audio as 24 kb/s Opus
// (<key>.opus, ~1/30 of the WAV), with the WAV's sample count in index.json. The e2e suite decodes them into a
// temporary cache, so its builds take the real voice path with no network. Build the scripts once first (with
// keys) so every scene is cached; a scene that is not is reported and the run fails. Fixtures no script needs go.
// The suite's scripts: examples/part8.md test/scripts/edits/edits.md test/scripts/edits/said.md (list them all).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from '../src/script/index.ts';
import { narrationText } from '../src/audio/voice.ts';
import { cacheKey, voiceCacheDir } from '../src/audio/cache.ts';
import { TTS_PROVIDER } from '../src/audio/tts.ts';

const OUT = join(import.meta.dir, '..', 'test', 'fixtures', 'voice');
const files = Bun.argv.slice(2);
if (!files.length) throw new Error('usage: bun bench/voice-fixtures.ts <script.md>...');

const index: Record<string, number> = {};
let missing = 0;
mkdirSync(OUT, { recursive: true });
for (const file of files) {
  const dir = dirname(resolve(file));
  const { ir, errors } = parse(readFileSync(file, 'utf8'), file, p => (existsSync(resolve(dir, p)) ? readFileSync(resolve(dir, p), 'utf8') : null));
  if (!ir) throw new Error(`${file}: ${errors[0]?.code} ${errors[0]?.message}`);
  for (const scene of ir.scenes) {
    const text = narrationText(scene);
    if (!text) continue;
    const key = cacheKey({ provider: TTS_PROVIDER, model: ir.meta.ttsModel, voice: ir.meta.voice, text });
    const entry = join(voiceCacheDir(), `${key}.json`);
    if (!existsSync(entry)) { console.log(`${file} S${scene.index}: not cached`); missing++; continue; }
    const json = readFileSync(entry, 'utf8');
    const wav = join(voiceCacheDir(), (JSON.parse(json) as { wav: string }).wav);
    writeFileSync(join(OUT, `${key}.json`), json);
    const enc = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-c:a', 'libopus', '-b:a', '24k', '-ac', '1', '-map_metadata', '-1', '-fflags', '+bitexact', join(OUT, `${key}.opus`)]);
    if (enc.exitCode) throw new Error(enc.stderr.toString());
    index[key] = (Bun.file(wav).size - 44) / 2;
  }
}
if (missing) process.exit(1);
for (const f of readdirSync(OUT)) {
  const key = f.replace(/\.(json|opus)$/, '');
  if (f !== 'index.json' && !(key in index)) rmSync(join(OUT, f));
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`${Object.keys(index).length} scenes in ${OUT}`);
