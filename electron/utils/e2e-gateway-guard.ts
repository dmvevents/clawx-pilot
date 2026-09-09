import { logger } from './logger';

/**
 * CLWX-102: fail-closed guard for every entry point that can start a real
 * OpenClaw process (Gateway launch, startup doctor repair, Developer Doctor).
 *
 * The Playwright fixture launches the app with CLAWX_E2E=1 and main skips
 * Gateway auto-start, but nothing stopped a later restart (for example the
 * provider:delete → debouncedRestart chain) from forking the real Gateway
 * out of an isolated temp HOME. That chain ends in a second, unguarded
 * Electron application and a native Keychain prompt on the operator's
 * machine. In E2E mode a launch is refused unless the spec explicitly opts in
 * with CLAWX_E2E_ALLOW_GATEWAY=1. Outside E2E mode this module is inert.
 */

export const E2E_MODE_ENV = 'CLAWX_E2E';
export const E2E_ALLOW_GATEWAY_ENV = 'CLAWX_E2E_ALLOW_GATEWAY';
export const E2E_GATEWAY_LAUNCH_REFUSED_CODE = 'E2E_GATEWAY_LAUNCH_REFUSED';

export type GatewayLaunchEntryPoint = 'gateway-launch' | 'doctor-repair' | 'doctor-command';

export class E2EGatewayLaunchRefusedError extends Error {
  readonly code = E2E_GATEWAY_LAUNCH_REFUSED_CODE;
  readonly entryPoint: GatewayLaunchEntryPoint;

  constructor(entryPoint: GatewayLaunchEntryPoint, detail?: string) {
    super(
      `${E2E_GATEWAY_LAUNCH_REFUSED_CODE}: refusing OpenClaw ${entryPoint} because ${E2E_MODE_ENV}=1 `
      + `and ${E2E_ALLOW_GATEWAY_ENV} is not '1'`
      + (detail ? ` (${detail})` : ''),
    );
    this.name = 'E2EGatewayLaunchRefusedError';
    this.entryPoint = entryPoint;
  }
}

export function isE2EMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[E2E_MODE_ENV] === '1';
}

export function isE2EGatewayLaunchAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[E2E_ALLOW_GATEWAY_ENV] === '1';
}

export function isE2EGatewayLaunchRefusedError(error: unknown): error is E2EGatewayLaunchRefusedError {
  return error instanceof E2EGatewayLaunchRefusedError
    || (typeof error === 'object'
      && error !== null
      && (error as { code?: unknown }).code === E2E_GATEWAY_LAUNCH_REFUSED_CODE);
}

/**
 * Returns the refusal for this launch attempt, or null when the launch may
 * proceed. Logs either way so a refused restart is visible in the main log
 * instead of silently never producing a Gateway.
 */
export function getE2EGatewayLaunchRefusal(
  entryPoint: GatewayLaunchEntryPoint,
  detail?: string,
  env: NodeJS.ProcessEnv = process.env,
): E2EGatewayLaunchRefusedError | null {
  if (!isE2EMode(env)) {
    return null;
  }
  if (isE2EGatewayLaunchAllowed(env)) {
    logger.info(`[e2e-gateway-guard] ${E2E_ALLOW_GATEWAY_ENV}=1; allowing OpenClaw ${entryPoint} in E2E mode`);
    return null;
  }
  const refusal = new E2EGatewayLaunchRefusedError(entryPoint, detail);
  logger.warn(`[e2e-gateway-guard] ${refusal.message}`);
  return refusal;
}

export function assertGatewayLaunchAllowed(
  entryPoint: GatewayLaunchEntryPoint,
  detail?: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const refusal = getE2EGatewayLaunchRefusal(entryPoint, detail, env);
  if (refusal) {
    throw refusal;
  }
}
