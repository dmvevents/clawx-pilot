#!/usr/bin/env node
/**
 * clwx87-wer-bench.mjs — ASR quality WER benchmark (CLWX-87).
 *
 * The owner asked four times across a month whether the ASR model had been
 * updated ("this one is not that good") — System.Speech quality, previously
 * masked by the ffmpeg/packaging failures (CLWX-20/K4). The PIPELINE is
 * proven (ASR_SMOKE_OK); this bench answers the QUALITY question with
 * numbers: word error rate on a fixed known-speech fixture set, per engine,
 * so the engine decision is recorded on evidence instead of vibes.
 *
 * Fixtures: eval/fixtures/clwx87-asr-manifest.json — reference transcripts
 * with deterministic synthetic speech (macOS `say`, voice+rate pinned per
 * row; Windows System.Speech synthesis on the VM leg). No audio binaries in
 * the repo. HONEST GAP, named in every report: synthetic TTS measures the
 * engine floor on clean scripted audio, NOT Trinidadian-accented real-room
 * performance — the manifest accepts operator-supplied `source: "real"`
 * rows (audioPath + reference text) for that; recording them is an owner
 * ask.
 *
 * Engines:
 *   --engine whisper       local Whisper CLI (reference implementation —
 *                          same weights as whisper.cpp, quality-equivalent
 *                          proxy; bundling-cost estimates use whisper.cpp
 *                          sizes). --model tiny|base|small (default tiny).
 *   --engine transcripts   grade a transcripts JSON produced elsewhere —
 *                          the Windows System.Speech leg
 *                          (windows-pilot/scripts/pilot-asr-wer.ps1 writes
 *                          it on the VM; this keeps grading in ONE place).
 *   --engine azure         Azure Speech REST, ONLY when AZURE_SPEECH_KEY +
 *                          AZURE_SPEECH_REGION are set; loud SKIP otherwise.
 *
 * Usage:
 *   node scripts/clwx87-wer-bench.mjs --engine whisper --model tiny
 *   node scripts/clwx87-wer-bench.mjs --engine transcripts --file <path.json>
 *   node scripts/clwx87-wer-bench.mjs --engine whisper --report docs/evidence/CLWX87_WER.md
 *
 * Exit codes: 0 bench ran (WER is DATA, not pass/fail — the decision is the
 * card's, made on the recorded numbers); 1 harness/infra failure; 3 blocked
 * input (missing fixture audio / transcripts file / azure env).
 *
 * Read-only outside its temp dir + optional report path; no sends; no
 * secrets read or printed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'eval', 'fixtures', 'clwx87-asr-manifest.json');

// ── WER (pure; unit-tested) ─────────────────────────────────────────────────

/** Normalize a transcript for WER: lowercase, digits kept, punctuation
 * dropped, whitespace collapsed. Numbers are NOT expanded — engines that
 * emit "3:45" vs "three forty five" differ genuinely and the fixture texts
 * spell numbers out to keep the reference unambiguous. */
export function werTokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ']/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Word error rate = word-level Levenshtein(ref, hyp) / len(ref).
 * Returns { wer, errors, refWords }. wer can exceed 1.0 on garbage
 * hypotheses (standard WER semantics).
 */
export function computeWer(refText, hypText) {
  const ref = werTokens(refText);
  const hyp = werTokens(hypText);
  const m = ref.length;
  const n = hyp.length;
  if (m === 0) return { wer: n === 0 ? 0 : Infinity, errors: n, refWords: 0 };
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  const errors = prev[n];
  return { wer: errors / m, errors, refWords: m };
}

// ── fixture audio ───────────────────────────────────────────────────────────

/** Synthesize one manifest row to a 16kHz mono wav via macOS say+afconvert.
 * Deterministic: voice and rate are pinned in the manifest. */
function synthesizeDarwin(clip, workDir) {
  const aiff = path.join(workDir, `${clip.id}.aiff`);
  const wav = path.join(workDir, `${clip.id}.wav`);
  const saySay = spawnSync('say', ['-v', clip.voice, '-r', String(clip.rate), '-o', aiff, clip.text], { encoding: 'utf8' });
  if (saySay.status !== 0) throw new Error(`say failed for ${clip.id}: ${saySay.stderr?.slice(0, 200)}`);
  const conv = spawnSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav], { encoding: 'utf8' });
  if (conv.status !== 0) throw new Error(`afconvert failed for ${clip.id}: ${conv.stderr?.slice(0, 200)}`);
  return wav;
}

function resolveClipAudio(clip, workDir) {
  if (clip.source === 'real') {
    const p = path.resolve(path.dirname(MANIFEST_PATH), clip.audioPath ?? '');
    if (!existsSync(p)) {
      throw Object.assign(new Error(`real clip ${clip.id}: audio not found at ${p}`), { blocked: true });
    }
    return p;
  }
  if (clip.source === 'synthetic-say') {
    if (process.platform !== 'darwin') {
      throw Object.assign(new Error('synthetic-say fixtures need macOS (the Windows leg synthesizes via System.Speech in pilot-asr-wer.ps1)'), { blocked: true });
    }
    return synthesizeDarwin(clip, workDir);
  }
  throw new Error(`clip ${clip.id}: unknown source "${clip.source}"`);
}

// ── engines ─────────────────────────────────────────────────────────────────

function transcribeWhisper(wavPath, model, workDir) {
  const outDir = path.join(workDir, `whisper-${model}`);
  mkdirSync(outDir, { recursive: true });
  const run = spawnSync('whisper', [
    wavPath, '--model', model, '--language', 'en', '--task', 'transcribe',
    '--output_format', 'json', '--output_dir', outDir, '--fp16', 'False',
    '--verbose', 'False',
  ], { encoding: 'utf8', timeout: 300_000 });
  if (run.status !== 0) throw new Error(`whisper failed on ${path.basename(wavPath)}: ${(run.stderr || run.stdout || '').slice(-300)}`);
  const jsonPath = path.join(outDir, `${path.basename(wavPath, '.wav')}.json`);
  const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
  return String(parsed.text ?? '').trim();
}

async function transcribeAzure(wavPath, key, region) {
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-TT&format=simple`;
  const body = readFileSync(wavPath);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
    },
    body,
  });
  if (!resp.ok) throw new Error(`azure stt http ${resp.status}`);
  const parsed = await resp.json();
  return String(parsed.DisplayText ?? '').trim();
}

// ── main ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { engine: 'whisper', model: 'tiny', file: null, report: null, keepAudio: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--engine') args.engine = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--keep-audio') args.keepAudio = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const clips = manifest.clips;
  const syntheticOnly = clips.every((c) => c.source !== 'real');
  console.log(`=== CLWX-87 ASR WER bench — engine=${args.engine}${args.engine === 'whisper' ? ` model=${args.model}` : ''} ===`);
  console.log(`fixtures: ${clips.length} clips (${MANIFEST_PATH})`);
  if (syntheticOnly) {
    console.log('HONEST GAP: all clips are synthetic TTS — this measures the engine floor on clean scripted audio, NOT Trinidadian-accented real-room performance. Add source:"real" rows for that (owner ask).\n');
  }

  let hypotheses = {};
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'clwx87-'));
  try {
    if (args.engine === 'transcripts') {
      if (!args.file || !existsSync(args.file)) {
        console.error('VERDICT: BLOCKED-INPUT — --engine transcripts needs --file <transcripts.json> (the pilot-asr-wer.ps1 output).');
        process.exit(3);
      }
      const parsed = JSON.parse(readFileSync(args.file, 'utf8'));
      hypotheses = parsed.transcripts ?? parsed;
    } else if (args.engine === 'azure') {
      const key = process.env.AZURE_SPEECH_KEY;
      const region = process.env.AZURE_SPEECH_REGION;
      if (!key || !region) {
        console.error('VERDICT: BLOCKED-INPUT — azure engine needs AZURE_SPEECH_KEY + AZURE_SPEECH_REGION (loud skip; not configured on this machine).');
        process.exit(3);
      }
      for (const clip of clips) {
        const wav = resolveClipAudio(clip, workDir);
        hypotheses[clip.id] = await transcribeAzure(wav, key, region);
        console.log(`  azure ${clip.id}: "${hypotheses[clip.id]}"`);
      }
    } else if (args.engine === 'whisper') {
      const which = spawnSync('which', ['whisper'], { encoding: 'utf8' });
      if (which.status !== 0) {
        console.error('VERDICT: BLOCKED-INPUT — whisper CLI not on PATH (brew install openai-whisper).');
        process.exit(3);
      }
      for (const clip of clips) {
        const wav = resolveClipAudio(clip, workDir);
        hypotheses[clip.id] = transcribeWhisper(wav, args.model, workDir);
        console.log(`  whisper/${args.model} ${clip.id}: "${hypotheses[clip.id]}"`);
      }
    } else {
      console.error(`VERDICT: BLOCKED-INPUT — unknown engine "${args.engine}".`);
      process.exit(3);
    }

    console.log('\nclip              | ref words | errors | WER');
    console.log('------------------|-----------|--------|------');
    const rows = [];
    for (const clip of clips) {
      const hyp = hypotheses[clip.id];
      if (typeof hyp !== 'string') {
        console.error(`VERDICT: BLOCKED-INPUT — no hypothesis for clip ${clip.id} (transcripts file incomplete?).`);
        process.exit(3);
      }
      const { wer, errors, refWords } = computeWer(clip.text, hyp);
      rows.push({ id: clip.id, source: clip.source, refWords, errors, wer, hypothesis: hyp });
      console.log(`${clip.id.padEnd(18)}| ${String(refWords).padStart(9)} | ${String(errors).padStart(6)} | ${(wer * 100).toFixed(1)}%`);
    }
    const totalErrors = rows.reduce((n, r) => n + r.errors, 0);
    const totalWords = rows.reduce((n, r) => n + r.refWords, 0);
    const aggregate = totalErrors / totalWords;
    console.log(`\naggregate WER: ${totalErrors}/${totalWords} = ${(aggregate * 100).toFixed(1)}% (engine=${args.engine}${args.engine === 'whisper' ? `/${args.model}` : ''})`);

    if (args.report) {
      const engineLabel = args.engine === 'whisper' ? `whisper/${args.model}` : args.engine;
      const lines = [
        `## WER — ${engineLabel} (${new Date().toISOString().slice(0, 10)})`,
        '',
        syntheticOnly ? '_All clips synthetic TTS: engine floor on clean scripted audio; Trinidadian-accent real-room rows are the named owner-supplied gap._' : '_Includes operator-supplied real clips._',
        '',
        '| Clip | Source | Ref words | Errors | WER | Hypothesis |',
        '|---|---|---|---|---|---|',
        ...rows.map((r) => `| ${r.id} | ${r.source} | ${r.refWords} | ${r.errors} | ${(r.wer * 100).toFixed(1)}% | ${r.hypothesis.replace(/\|/g, '\\|')} |`),
        '',
        `**Aggregate: ${totalErrors}/${totalWords} = ${(aggregate * 100).toFixed(1)}%**`,
        '',
      ];
      mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
      const existing = existsSync(args.report) ? readFileSync(args.report, 'utf8') : `# CLWX-87 ASR WER bench results\n\nGrading: scripts/clwx87-wer-bench.mjs over eval/fixtures/clwx87-asr-manifest.json.\n`;
      writeFileSync(args.report, `${existing}\n${lines.join('\n')}`);
      console.log(`report appended: ${args.report}`);
    }
    if (args.keepAudio) console.log(`audio kept at ${workDir}`);
  } finally {
    if (!args.keepAudio) rmSync(workDir, { recursive: true, force: true });
  }
}

// Realpath comparison — a symlinked invocation must still run main()
// (harness-artifact isolation-lens lesson, 2026-09-06).
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main().catch((err) => {
    if (err?.blocked) {
      console.error(`VERDICT: BLOCKED-INPUT — ${err.message}`);
      process.exit(3);
    }
    console.error(`clwx87-wer-bench crashed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
