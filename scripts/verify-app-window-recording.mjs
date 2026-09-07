#!/usr/bin/env node
/**
 * verify-app-window-recording.mjs — host-side deterministic verification for
 * Windows app-window recordings pulled back from the VM.
 *
 * This verifies capture mechanics only: video metadata, frame extraction,
 * hashes, and blank-frame rejection. It never reports visual or product PASS;
 * VLM/human/product checks consume the extracted frames separately.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {
    video: null,
    manifest: null,
    outDir: null,
    ffmpeg: process.env.CLAWX_FFMPEG ?? '',
    ffprobe: process.env.CLAWX_FFPROBE ?? '',
    minWidth: 1280,
    minDuration: 5,
    frameCount: 10,
    frameMaxWidth: 2000,
    noFfprobe: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = () => argv[++i];
    if (key === '--video') args.video = next();
    else if (key === '--manifest') args.manifest = next();
    else if (key === '--out-dir') args.outDir = next();
    else if (key === '--ffmpeg') args.ffmpeg = next();
    else if (key === '--ffprobe') args.ffprobe = next();
    else if (key === '--min-width') args.minWidth = Number(next());
    else if (key === '--min-duration') args.minDuration = Number(next());
    else if (key === '--frame-count') args.frameCount = Number(next());
    else if (key === '--frame-max-width') args.frameMaxWidth = Number(next());
    else if (key === '--no-ffprobe') args.noFfprobe = true;
    else throw new Error(`unknown argument: ${key}`);
  }
  return args;
}

function findExecutable(explicit, name) {
  const candidates = [
    explicit,
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw Object.assign(new Error(`${name} not found; pass --${name} <path>`), { exitCode: 3 });
}

function runTool(file, args, options = {}) {
  const run = spawnSync(file, args, {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (run.status !== 0) {
    const tail = String(run.stderr || run.stdout || '').slice(-500).replace(/[\r\n]+/g, ' ');
    throw new Error(`${options.label ?? file} exited ${run.status}: ${tail}`);
  }
  return run;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJsonFile(path, label) {
  if (!existsSync(path)) throw Object.assign(new Error(`${label} missing: ${path}`), { exitCode: 3 });
  try {
    const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error?.message ?? error}`);
  }
}

function validateGuestManifest(manifestPath, videoPath, videoHash, minWidth) {
  const manifest = readJsonFile(manifestPath, 'guest manifest');
  if (manifest?.schemaVersion !== 1 || manifest?.kind !== 'clawx.appWindowRecording') {
    throw new Error('guest manifest is not an app-window recording manifest');
  }
  if (manifest.status !== 'CAPTURE_ONLY') throw new Error(`guest manifest status was ${manifest.status}`);
  if (manifest.visualVerdict !== 'NOT_RUN' || manifest.productVerdict !== 'NOT_RUN') {
    throw new Error('guest manifest must not contain visual/product pass verdicts');
  }
  const videoEntries = (manifest.files ?? []).filter((entry) => entry?.role === 'video');
  if (videoEntries.length !== 1) throw new Error(`guest manifest must contain exactly one video file entry; found ${videoEntries.length}`);
  if (videoEntries[0].sha256 !== videoHash) throw new Error('pulled video hash does not match guest manifest video hash');
  const guestVideoPath = String(videoEntries[0].path ?? '');
  if (!guestVideoPath || guestVideoPath.split(/[\\/]/).at(-1) !== videoPath.split(/[\\/]/).at(-1)) {
    throw new Error('guest manifest video entry does not match pulled video filename');
  }
  const source = manifest.source ?? {};
  const nativeClientWidth = Number(source.nativeClientWidth ?? 0);
  if (!Number.isFinite(nativeClientWidth) || nativeClientWidth < minWidth) {
    throw new Error(`guest manifest native client width ${nativeClientWidth || 0} is below required ${minWidth}`);
  }
  if (source.preserveNativeSize !== true) throw new Error('guest manifest does not preserve native capture size');
  if (String(source.videoFilter ?? '').includes('scale=')) throw new Error('guest manifest used a scaling capture filter');
  if (!String(source.videoFilter ?? '').includes('crop=trunc(iw/2)*2:trunc(ih/2)*2')) {
    throw new Error('guest manifest missing native crop-only capture filter');
  }
  return {
    path: resolve(manifestPath),
    sha256: sha256(manifestPath),
    status: manifest.status,
    guestVerificationStatus: manifest.capture?.guestVerificationStatus ?? null,
    window: manifest.window ?? null,
    source: {
      nativeClientWidth: source.nativeClientWidth ?? null,
      nativeClientHeight: source.nativeClientHeight ?? null,
      nativeWindowWidth: source.nativeWindowWidth ?? null,
      nativeWindowHeight: source.nativeWindowHeight ?? null,
      preserveNativeSize: source.preserveNativeSize ?? null,
      videoFilter: source.videoFilter ?? null,
    },
    video: videoEntries[0],
  };
}

function readMetadataWithFfprobe(ffprobe, video) {
  const run = runTool(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json',
    video,
  ], { label: 'ffprobe metadata' });
  return JSON.parse(run.stdout);
}

function readMetadataWithFfmpegFallback(ffmpeg, video) {
  const run = spawnSync(ffmpeg, ['-hide_banner', '-i', video], { encoding: 'utf8' });
  const text = `${run.stderr ?? ''}\n${run.stdout ?? ''}`;
  const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const sizeMatch = text.match(/Video:[^\n,]*(?:,[^\n,]*)*,\s*(\d{2,5})x(\d{2,5})[\s,]/);
  if (!durationMatch || !sizeMatch) throw new Error('ffmpeg metadata fallback could not parse duration/dimensions');
  const duration = (Number(durationMatch[1]) * 3600) + (Number(durationMatch[2]) * 60) + Number(durationMatch[3]);
  return {
    streams: [{ codec_type: 'video', width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) }],
    format: { duration: String(duration) },
    fallback: 'ffmpeg-stderr',
  };
}

function primaryVideo(metadata) {
  const stream = (metadata.streams ?? []).find((entry) => entry.codec_type === 'video');
  if (!stream) throw new Error('no video stream found');
  return stream;
}

function verifyMetadata(metadata, minWidth, minDuration) {
  const stream = primaryVideo(metadata);
  const duration = Number(metadata.format?.duration ?? 0);
  const width = Number(stream.width ?? 0);
  const height = Number(stream.height ?? 0);
  if (!Number.isFinite(duration) || duration < minDuration) {
    throw new Error(`duration ${duration || 0} is below required ${minDuration}`);
  }
  if (!Number.isFinite(width) || width < minWidth) {
    throw new Error(`width ${width || 0} is below required ${minWidth}`);
  }
  if (!Number.isFinite(height) || height < 1) throw new Error('height is invalid');
  return { durationSeconds: duration, width, height };
}

function frameSchedule(durationSeconds, count) {
  if (count < 8) throw new Error('frame count must be at least 8');
  const last = Math.max(0, durationSeconds - 0.2);
  return Array.from({ length: count }, (_, index) => ({
    index,
    seconds: Number(((last * index) / (count - 1)).toFixed(3)),
  }));
}

function extractFrames(ffmpeg, video, outDir, schedule, maxWidth) {
  const frameDir = join(outDir, 'frames');
  mkdirSync(frameDir, { recursive: false });
  return schedule.map((frame) => {
    const path = join(frameDir, `frame-${String(frame.index).padStart(2, '0')}.png`);
    runTool(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', String(frame.seconds),
      '-i', video,
      '-frames:v', '1',
      '-vf', `scale='min(${maxWidth},iw)':-2`,
      '-y',
      path,
    ], { label: `extract frame ${frame.index}` });
    if (!existsSync(path)) throw new Error(`frame was not created: ${path}`);
    return { path, seconds: frame.seconds, sha256: sha256(path) };
  });
}

function frameSignal(ffmpeg, framePath) {
  const run = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-i', framePath,
    '-vf', 'scale=32:32,format=gray',
    '-f', 'rawvideo',
    '-',
  ], { encoding: 'buffer', maxBuffer: 1024 * 1024 });
  if (run.status !== 0) throw new Error(`signal extraction failed for ${framePath}`);
  const bytes = run.stdout;
  if (!bytes.length) throw new Error(`signal extraction returned no bytes for ${framePath}`);
  let min = 255;
  let max = 0;
  let sum = 0;
  let sum2 = 0;
  for (const byte of bytes) {
    min = Math.min(min, byte);
    max = Math.max(max, byte);
    sum += byte;
    sum2 += byte * byte;
  }
  const mean = sum / bytes.length;
  const variance = (sum2 / bytes.length) - (mean * mean);
  return {
    samples: bytes.length,
    mean: Number(mean.toFixed(3)),
    variance: Number(variance.toFixed(3)),
    range: max - min,
    blank: (max - min) < 5 || variance < 1,
  };
}

function assertNonBlank(frames, ffmpeg) {
  const withSignal = frames.map((frame) => ({ ...frame, signal: frameSignal(ffmpeg, frame.path) }));
  if (!withSignal.some((frame) => !frame.signal.blank)) throw new Error('all extracted frames appear blank');
  return withSignal;
}

function makeOutDir(video, requested) {
  const runId = `host-verify-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(16).slice(2, 10)}`;
  const outDir = resolve(requested || join(dirname(video), runId));
  mkdirSync(outDir, { recursive: false });
  return outDir;
}

function rel(root, file) {
  return relative(root, file).split('\\').join('/');
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.video) throw Object.assign(new Error('--video is required'), { exitCode: 3 });
  if (!Number.isFinite(args.minWidth) || args.minWidth < 1280) throw new Error('--min-width must be at least 1280');
  if (!Number.isFinite(args.minDuration) || args.minDuration <= 0) throw new Error('--min-duration must be positive');
  if (!Number.isFinite(args.frameCount) || args.frameCount < 8) throw new Error('--frame-count must be at least 8');

  const video = resolve(args.video);
  if (!existsSync(video)) throw Object.assign(new Error(`video missing: ${video}`), { exitCode: 3 });
  const videoHash = sha256(video);
  const guestManifest = args.manifest ? validateGuestManifest(resolve(args.manifest), video, videoHash, args.minWidth) : null;
  const ffmpeg = findExecutable(args.ffmpeg, 'ffmpeg');
  let ffprobe = null;
  let metadata;
  try {
    if (args.noFfprobe) throw new Error('ffprobe disabled by --no-ffprobe');
    ffprobe = findExecutable(args.ffprobe, 'ffprobe');
    metadata = readMetadataWithFfprobe(ffprobe, video);
  } catch (error) {
    if (args.ffprobe && !args.noFfprobe) throw error;
    metadata = readMetadataWithFfmpegFallback(ffmpeg, video);
  }

  const outDir = makeOutDir(video, args.outDir);
  const verified = verifyMetadata(metadata, args.minWidth, args.minDuration);
  const schedule = frameSchedule(verified.durationSeconds, args.frameCount);
  const frames = assertNonBlank(
    extractFrames(ffmpeg, video, outDir, schedule, args.frameMaxWidth),
    ffmpeg,
  );

  const manifest = {
    schemaVersion: 1,
    kind: 'clawx.appWindowRecordingHostVerification',
    status: 'CAPTURE_ONLY_VERIFIED',
    visualVerdict: 'NOT_RUN',
    productVerdict: 'NOT_RUN',
    reason: 'Host verified capture mechanics only; visual and product acceptance remain pending.',
    sourceManifest: guestManifest,
    completedAt: new Date().toISOString(),
    tools: { ffmpeg, ffprobe, metadataSource: ffprobe ? 'ffprobe' : 'ffmpeg-fallback' },
    video: {
      path: video,
      sha256: videoHash,
      durationSeconds: Number(verified.durationSeconds.toFixed(3)),
      width: verified.width,
      height: verified.height,
      minWidth: args.minWidth,
    },
    frames: frames.map((frame) => ({
      path: rel(outDir, frame.path),
      seconds: frame.seconds,
      sha256: frame.sha256,
      signal: frame.signal,
    })),
    files: [
      { role: 'video', path: video, sha256: videoHash },
      ...frames.map((frame) => ({ role: 'frame', path: rel(outDir, frame.path), seconds: frame.seconds, sha256: frame.sha256 })),
    ],
  };
  const manifestPath = join(outDir, 'host-verification.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`STATE:APP_WINDOW_RECORDING_CAPTURE_ONLY_VERIFIED manifest=${manifestPath} video=${video} frames=${frames.length} duration=${manifest.video.durationSeconds} w=${verified.width} h=${verified.height} boundManifest=${guestManifest ? 'true' : 'false'} sha256=${manifest.video.sha256}`);
}

try {
  main();
} catch (error) {
  const exitCode = error?.exitCode ?? (/not found|missing/.test(String(error?.message)) ? 3 : 1);
  const state = exitCode === 3 ? 'APP_WINDOW_RECORDING_VERIFY_BLOCKED' : 'APP_WINDOW_RECORDING_VERIFY_INVALID';
  const reason = String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 500);
  console.error(`STATE:${state} reason=${reason}`);
  process.exit(exitCode);
}
