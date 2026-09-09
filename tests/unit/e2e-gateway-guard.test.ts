import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoggerInfo, mockLoggerWarn } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  E2EGatewayLaunchRefusedError,
  E2E_GATEWAY_LAUNCH_REFUSED_CODE,
  assertGatewayLaunchAllowed,
  getE2EGatewayLaunchRefusal,
  isE2EGatewayLaunchAllowed,
  isE2EGatewayLaunchRefusedError,
  isE2EMode,
} from '@electron/utils/e2e-gateway-guard';

describe('E2E gateway launch guard (CLWX-102)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLAWX_E2E', '');
    vi.stubEnv('CLAWX_E2E_ALLOW_GATEWAY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the same CLAWX_E2E=1 signal main uses to skip Gateway auto-start', () => {
    expect(isE2EMode({})).toBe(false);
    expect(isE2EMode({ CLAWX_E2E: 'true' })).toBe(false);
    expect(isE2EMode({ CLAWX_E2E: '1' })).toBe(true);
  });

  it('only honours the exact opt-in value', () => {
    expect(isE2EGatewayLaunchAllowed({})).toBe(false);
    expect(isE2EGatewayLaunchAllowed({ CLAWX_E2E_ALLOW_GATEWAY: 'yes' })).toBe(false);
    expect(isE2EGatewayLaunchAllowed({ CLAWX_E2E_ALLOW_GATEWAY: '1' })).toBe(true);
  });

  it('is inert outside E2E mode regardless of the opt-in variable', () => {
    expect(getE2EGatewayLaunchRefusal('gateway-launch', undefined, {})).toBeNull();
    expect(getE2EGatewayLaunchRefusal('gateway-launch', undefined, { CLAWX_E2E_ALLOW_GATEWAY: '0' })).toBeNull();
    expect(() => assertGatewayLaunchAllowed('doctor-command', undefined, {})).not.toThrow();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('fails closed in E2E mode when the opt-in is absent and logs the refusal', () => {
    const refusal = getE2EGatewayLaunchRefusal('gateway-launch', 'port=18789', { CLAWX_E2E: '1' });

    expect(refusal).toBeInstanceOf(E2EGatewayLaunchRefusedError);
    expect(refusal?.code).toBe(E2E_GATEWAY_LAUNCH_REFUSED_CODE);
    expect(refusal?.entryPoint).toBe('gateway-launch');
    expect(refusal?.message).toContain('CLAWX_E2E_ALLOW_GATEWAY');
    expect(refusal?.message).toContain('port=18789');
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining(E2E_GATEWAY_LAUNCH_REFUSED_CODE));
  });

  it('still fails closed when the opt-in carries a non-"1" value', () => {
    expect(getE2EGatewayLaunchRefusal('doctor-repair', undefined, {
      CLAWX_E2E: '1',
      CLAWX_E2E_ALLOW_GATEWAY: 'true',
    })).toBeInstanceOf(E2EGatewayLaunchRefusedError);
  });

  it('allows the launch in E2E mode only with the explicit opt-in, and says so in the log', () => {
    expect(getE2EGatewayLaunchRefusal('gateway-launch', undefined, {
      CLAWX_E2E: '1',
      CLAWX_E2E_ALLOW_GATEWAY: '1',
    })).toBeNull();
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('CLAWX_E2E_ALLOW_GATEWAY=1'));
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('assertGatewayLaunchAllowed throws the typed error and defaults to process.env', () => {
    vi.stubEnv('CLAWX_E2E', '1');

    expect(() => assertGatewayLaunchAllowed('gateway-launch')).toThrow(E2EGatewayLaunchRefusedError);

    vi.stubEnv('CLAWX_E2E_ALLOW_GATEWAY', '1');
    expect(() => assertGatewayLaunchAllowed('gateway-launch')).not.toThrow();
  });

  it('recognises the refusal by class or by code across module instances', () => {
    expect(isE2EGatewayLaunchRefusedError(new E2EGatewayLaunchRefusedError('doctor-command'))).toBe(true);
    expect(isE2EGatewayLaunchRefusedError({ code: E2E_GATEWAY_LAUNCH_REFUSED_CODE })).toBe(true);
    expect(isE2EGatewayLaunchRefusedError(new Error('ECONNREFUSED'))).toBe(false);
    expect(isE2EGatewayLaunchRefusedError(null)).toBe(false);
  });

  it('does not phrase the refusal like a transient startup error that would trigger retries', async () => {
    const { getGatewayStartupRecoveryAction } = await import('@electron/gateway/startup-recovery');
    const refusal = new E2EGatewayLaunchRefusedError('gateway-launch', 'port=18789');

    expect(getGatewayStartupRecoveryAction({
      startupError: refusal,
      startupStderrLines: [],
      configRepairAttempted: false,
      attempt: 1,
      maxAttempts: 3,
    })).toBe('fail');
  });
});
