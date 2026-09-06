/**
 * CLWX-83 heap-bound worker probe — COMMITTED, not ad hoc.
 *
 * The tick notes claimed "a worker-side probe confirms the flag reaches
 * forks", but no durable assertion was checked in — so a Vitest upgrade that
 * ignores `test.execArgv` (exactly what happened to `poolOptions.forks.execArgv`
 * in Vitest 4) would regress silently until the next OOM (Codex adversarial
 * review, 2026-09-06). This runs inside a forked worker on every `pnpm test`,
 * so it IS the worker-side proof.
 */
import { describe, expect, it } from 'vitest';

describe('CLWX-83 vitest heap bound reaches forked workers', () => {
  it('this worker process carries --max-old-space-size=4096 from test.execArgv', () => {
    expect(process.execArgv).toContain('--max-old-space-size=4096');
  });

  it('the effective V8 old-space limit reflects the bound (not a machine default)', async () => {
    const v8 = await import('node:v8');
    const limitMb = v8.getHeapStatistics().heap_size_limit / (1024 * 1024);
    // 4096MB old-space + V8 overhead lands slightly above 4096; a machine
    // default (typically ~2GB on Node 26) lands far below.
    expect(limitMb).toBeGreaterThan(3500);
    expect(limitMb).toBeLessThan(6000);
  });
});
