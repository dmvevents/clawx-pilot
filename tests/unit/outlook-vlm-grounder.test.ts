import { beforeEach, describe, expect, it, vi } from 'vitest';

// The grounder reads ANTHROPIC_API_KEY in its constructor for the default
// caller path. We always inject a mock caller so the real key is irrelevant
// for these tests, but logger.warn is noisy — silence it.
vi.mock('../../electron/utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { VlmGrounder, bboxCentre } from '@electron/services/outlook-browser-v2/vlm-grounder';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
const BIG_PNG = Buffer.concat([PNG, Buffer.alloc(2048, 0xff)]);

describe('VlmGrounder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns found=true with bbox when the VLM response is well-formed', async () => {
    const caller = vi.fn().mockResolvedValue({
      text: '{"found": true, "bbox": {"x": 100, "y": 50, "width": 80, "height": 32}, "confidence": 0.93, "reasoning": "New mail button top-left"}',
    });
    const grounder = new VlmGrounder({ caller });
    const result = await grounder.ground({
      screenshotPng: PNG,
      imageWidth: 1280,
      imageHeight: 800,
      question: 'New mail button',
    });
    expect(result.found).toBe(true);
    expect(result.bbox).toEqual({ x: 100, y: 50, width: 80, height: 32 });
    expect(result.confidence).toBeCloseTo(0.93);
    expect(caller).toHaveBeenCalledOnce();
  });

  it('caches by (image hash, question) for 60s — second call within ttl is free', async () => {
    const caller = vi.fn().mockResolvedValue({
      text: '{"found": true, "bbox": {"x": 0, "y": 0, "width": 10, "height": 10}, "confidence": 0.9, "reasoning": ""}',
    });
    const grounder = new VlmGrounder({ caller });
    const q = {
      screenshotPng: PNG,
      imageWidth: 100,
      imageHeight: 100,
      question: 'something',
    };
    await grounder.ground(q);
    await grounder.ground(q);
    expect(caller).toHaveBeenCalledOnce();
  });

  it('cache is keyed on image bytes — different image with same question re-asks', async () => {
    const caller = vi.fn().mockResolvedValue({
      text: '{"found": true, "bbox": {"x": 0, "y": 0, "width": 10, "height": 10}, "confidence": 0.9, "reasoning": ""}',
    });
    const grounder = new VlmGrounder({ caller });
    await grounder.ground({
      screenshotPng: PNG,
      imageWidth: 100,
      imageHeight: 100,
      question: 'X',
    });
    await grounder.ground({
      screenshotPng: BIG_PNG,
      imageWidth: 100,
      imageHeight: 100,
      question: 'X',
    });
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it('returns found=false on malformed JSON without throwing', async () => {
    const caller = vi.fn().mockResolvedValue({ text: 'not actually json' });
    const grounder = new VlmGrounder({ caller });
    const r = await grounder.ground({
      screenshotPng: PNG,
      imageWidth: 100,
      imageHeight: 100,
      question: 'anything',
    });
    expect(r.found).toBe(false);
    expect(r.confidence).toBe(0);
  });

  it('strips a markdown fence the model adds despite instructions', async () => {
    const caller = vi.fn().mockResolvedValue({
      text: '```json\n{"found": true, "bbox": {"x": 1, "y": 2, "width": 3, "height": 4}, "confidence": 0.7, "reasoning": "ok"}\n```',
    });
    const grounder = new VlmGrounder({ caller });
    const r = await grounder.ground({
      screenshotPng: PNG,
      imageWidth: 100,
      imageHeight: 100,
      question: 'thing',
    });
    expect(r.found).toBe(true);
    expect(r.bbox).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('rejects bbox outside image bounds — never produces an off-screen click', async () => {
    const caller = vi.fn().mockResolvedValue({
      text: '{"found": true, "bbox": {"x": 90, "y": 0, "width": 50, "height": 10}, "confidence": 0.9, "reasoning": ""}',
    });
    const grounder = new VlmGrounder({ caller });
    const r = await grounder.ground({
      screenshotPng: PNG,
      imageWidth: 100, // 90 + 50 = 140 > 100
      imageHeight: 100,
      question: 'oversized',
    });
    expect(r.found).toBe(false);
    expect(r.reasoning).toMatch(/outside/i);
  });

  it('rejects bbox with non-positive dimensions', async () => {
    const caller = vi.fn().mockResolvedValue({
      text: '{"found": true, "bbox": {"x": 10, "y": 10, "width": 0, "height": 5}, "confidence": 0.9, "reasoning": ""}',
    });
    const grounder = new VlmGrounder({ caller });
    const r = await grounder.ground({
      screenshotPng: PNG,
      imageWidth: 100,
      imageHeight: 100,
      question: 'zero-width',
    });
    expect(r.found).toBe(false);
  });

  it('returns found=false (not throw) when the SDK call rejects', async () => {
    const caller = vi.fn().mockRejectedValue(new Error('429 rate limit'));
    const grounder = new VlmGrounder({ caller });
    const r = await grounder.ground({
      screenshotPng: PNG,
      imageWidth: 100,
      imageHeight: 100,
      question: 'x',
    });
    expect(r.found).toBe(false);
    expect(r.confidence).toBe(0);
    expect(r.reasoning).toMatch(/VLM call failed/i);
  });

  it('respects an explicit found=false from the model', async () => {
    const caller = vi.fn().mockResolvedValue({
      text: '{"found": false, "confidence": 0.2, "reasoning": "no New mail button visible"}',
    });
    const grounder = new VlmGrounder({ caller });
    const r = await grounder.ground({
      screenshotPng: PNG,
      imageWidth: 100,
      imageHeight: 100,
      question: 'New mail',
    });
    expect(r.found).toBe(false);
    expect(r.confidence).toBeCloseTo(0.2);
  });

  it('falls back to gemini caller when primary throws', async () => {
    // Production-grade graceful degradation: when Bedrock fails (AWS auth
    // expired, region unreachable, rate-limited) and a Gemini fallback is
    // configured, ground() retries through the fallback rather than
    // bubbling the error to the user.
    const primary = vi.fn().mockRejectedValue(new Error('Bedrock SSO expired'));
    const fallback = vi.fn().mockResolvedValue({
      text: '{"found": true, "bbox": {"x": 50, "y": 50, "width": 20, "height": 20}, "confidence": 0.85, "reasoning": "via gemini"}',
    });
    const grounder = new VlmGrounder({ caller: primary });
    // Inject the fallback caller directly — the public constructor only
    // attaches one based on env, but the wiring inside ground() is what
    // matters.
    (grounder as unknown as { fallbackCaller: typeof fallback }).fallbackCaller = fallback;

    const result = await grounder.ground({
      screenshotPng: PNG,
      imageWidth: 200,
      imageHeight: 200,
      question: 'test fallback',
    });

    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
    expect(result.found).toBe(true);
    expect(result.bbox).toEqual({ x: 50, y: 50, width: 20, height: 20 });
  });

  it('returns found=false when both primary AND fallback fail', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('Bedrock 503'));
    const fallback = vi.fn().mockRejectedValue(new Error('Gemini 429'));
    const grounder = new VlmGrounder({ caller: primary });
    (grounder as unknown as { fallbackCaller: typeof fallback }).fallbackCaller = fallback;

    const result = await grounder.ground({
      screenshotPng: PNG,
      imageWidth: 200,
      imageHeight: 200,
      question: 'both broken',
    });

    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
    expect(result.found).toBe(false);
    expect(result.reasoning).toMatch(/both primary and fallback/i);
  });

  it('bboxCentre rounds to integer pixel coords', () => {
    expect(bboxCentre({ x: 100, y: 50, width: 80, height: 32 })).toEqual({ x: 140, y: 66 });
    expect(bboxCentre({ x: 0, y: 0, width: 1, height: 1 })).toEqual({ x: 1, y: 1 });
  });
});
