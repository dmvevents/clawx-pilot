# W8 — Mac whisper smoke (on-device ASR proof)

Date: 2026-09-02 (evidence dir dated per task spec 2026-09-03)
Machine: Mac dev laptop (darwin arm64), repo `/Users/antonalexander/Github/moe-tt/ClawX`, branch `fix/doc-tooling-steering`
Task: flip the Mac voice cell from ◐ to ● with a real transcript, or report BLOCKED with the failing command.

## Verdict: PASS

Real transcript produced twice (skill quick-start model and skill default model). Both contain the
required phrases `staff meeting` and `Thursday` (case-insensitive). Reported speech duration is
non-zero (2.28 s), so no PLAUD-ZERO-MIN-style zero-duration flag.

## 1. Skill mechanism (what the app actually invokes)

Skill source: `build/preinstalled-skills/openai-whisper/SKILL.md` (byte-identical to
`build/openclaw/skills/openai-whisper/SKILL.md` except frontmatter description quoting;
`resources/skills/preinstalled-manifest.json` lists slug `openai-whisper`, and
`resources/skills/bundles.json` includes it in the recommended bundle).

This skill is NOT a uv/python entry-script skill. It declares
`requires: { bins: ["whisper"] }` with a brew install spec (`formula: openai-whisper`), and its
body instructs the agent to run the `whisper` CLI directly:

```
whisper /path/audio.mp3 --model medium --output_format txt --output_dir .
```

Note in SKILL.md: models download to `~/.cache/whisper` on first run; `--model` defaults to
`turbo` on this install.

Local binary check:

```
$ command -v whisper
/opt/homebrew/bin/whisper        # openai-whisper 20250625_5, python3.14 libexec
```

Models were already cached in `~/.cache/whisper/` (large-v3-turbo.pt 1.5G, medium.pt 1.4G,
small/base variants), so no first-run download was needed.

## 2. Deterministic test utterance

```
$ /usr/bin/say -o /tmp/asr-smoke.aiff 'The staff meeting moves to Thursday at ten'
$ afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/asr-smoke.aiff /tmp/asr-smoke.wav
$ afinfo /tmp/asr-smoke.wav | grep duration
estimated duration: 2.394687 sec
```

Files: `/tmp/asr-smoke.aiff` (109,700 B), `/tmp/asr-smoke.wav` (80,726 B, 16 kHz mono LEI16).

## 3. Run A — skill quick-start invocation, verbatim (`--model medium`)

```
$ cd /tmp/asr-smoke-out && whisper /tmp/asr-smoke.wav --model medium --output_format txt --output_dir .
UserWarning: FP16 is not supported on CPU; using FP32 instead
Detecting language using up to the first 30 seconds. Use `--language` to specify the language
Detected language: English
[00:00.000 --> 00:02.520]  The staff meeting moves to Thursday at 10.
94.89s user 2.89s system 558% cpu 17.497 total
```

`/tmp/asr-smoke-out/asr-smoke.txt`:

```
The staff meeting moves to Thursday at 10.
```

## 4. Run B — skill default model path (turbo, no `--model` flag), JSON metadata

```
$ cd /tmp/asr-smoke-out && whisper /tmp/asr-smoke.wav --output_format json --output_dir .
Detected language: English
[00:00.000 --> 00:02.280]  The staff meeting moves to Thursday at 10.
118.90s user 1.71s system 612% cpu 19.706 total
```

Parsed `/tmp/asr-smoke-out/asr-smoke.json`:

```
text: The staff meeting moves to Thursday at 10.
language: en
segments: 1
first seg start/end: 0.0 2.2800000000000002
reported speech duration (last seg end): 2.2800000000000002
ASSERT staff meeting: True
ASSERT thursday: True
```

## 5. Assertions

| Check | Result |
|---|---|
| Transcript contains `staff meeting` (case-insensitive) | PASS (both runs) |
| Transcript contains `thursday` (case-insensitive) | PASS (both runs) |
| Duration metadata | 2.28 s speech reported by whisper vs 2.39 s WAV; non-zero, NOT a PLAUD-ZERO-MIN case |
| Skill mechanism honoured | Yes: bare `whisper` CLI per SKILL.md, both the documented quick-start form and the default-model form |

## 6. Caveats

- "ten" was transcribed as the numeral "10" by both models — expected Whisper text normalisation,
  irrelevant to the assertion set.
- Runs executed on CPU (FP32 fallback warning); ~17-20 s wall per 2.4 s clip with cached models.
  First-ever run on a clean laptop would add a model download to `~/.cache/whisper`.
- No source files were modified; this directory is the only new artifact.
