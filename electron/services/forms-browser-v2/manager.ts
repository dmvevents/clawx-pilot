/**
 * Singleton manager for the forms-browser-v2 surface.
 * Mirrors outlook-browser-v2/manager.ts: one shared FormsDriver, one shared
 * SuspensionsActions, exposed to both the IPC bridge and the host-API.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FormsDriver, type FillResult, type SubmitResult } from './forms-driver';
import { SuspensionsActions, type SuspensionsPayload } from './suspensions-actions';
import { logger } from '../../utils/logger';

const URL_PATH = join(process.cwd(), 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt');

export class FormsBrowserManager {
  private driver: FormsDriver | null = null;
  private suspensions: SuspensionsActions | null = null;

  private ensureDriver(): { driver: FormsDriver; suspensions: SuspensionsActions } {
    if (!this.driver) {
      this.driver = new FormsDriver();
      this.suspensions = new SuspensionsActions(this.driver);
    }
    return { driver: this.driver, suspensions: this.suspensions! };
  }

  /** Load the cloned-form URL from disk. */
  private getSuspensionsFormUrl(): string | null {
    if (!existsSync(URL_PATH)) return null;
    const v = readFileSync(URL_PATH, 'utf-8').trim();
    return v && /forms\.(office|cloud\.microsoft)\.com/.test(v) ? v : null;
  }

  async listSupportedForms(): Promise<{ status: 'ok'; forms: Array<{ id: string; title: string; status: 'available' | 'not_configured' }> }> {
    const url = this.getSuspensionsFormUrl();
    return {
      status: 'ok',
      forms: [
        {
          id: 'suspensions',
          title: 'Primary School Student Suspensions: Term 3 2025/26',
          status: url ? 'available' : 'not_configured',
        },
      ],
    };
  }

  async previewSuspension(payload: SuspensionsPayload): Promise<
    | { status: 'previewed'; url: string; filledCount: number; skippedCount: number; errors: FillResult['errors'] }
    | { status: 'error'; reason: string }
  > {
    const url = this.getSuspensionsFormUrl();
    if (!url) {
      return {
        status: 'error',
        reason: 'Suspensions form URL not configured. See extensions/moe-principal-assistant/forms/suspensions-form-spec.md to clone the form on test.fac, then write the URL to suspensions-test-fac-url.txt.',
      };
    }
    const { suspensions } = this.ensureDriver();
    const o = await suspensions.open(url);
    if (o.status !== 'opened') {
      return { status: 'error', reason: o.reason ?? 'open failed' };
    }
    const f = await suspensions.fill(payload);
    return {
      status: 'previewed',
      url,
      filledCount: f.filledCount,
      skippedCount: f.skippedCount,
      errors: f.errors,
    };
  }

  async submitSuspension({ confirm }: { confirm: boolean }): Promise<SubmitResult> {
    const { suspensions } = this.ensureDriver();
    const r = await suspensions.submit({ confirm });
    logger.info(`[forms-v2] submit result: ${r.status}`);
    return r;
  }

  async close(): Promise<void> {
    await this.driver?.close();
    this.driver = null;
    this.suspensions = null;
  }
}

export const formsBrowserManagerV2 = new FormsBrowserManager();
