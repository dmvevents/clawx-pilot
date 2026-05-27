/**
 * Singleton manager for the forms-browser-v2 surface.
 * Mirrors outlook-browser-v2/manager.ts: one shared FormsDriver, one shared
 * SuspensionsActions, exposed to both the IPC bridge and the host-API.
 */
import { readFileSync, existsSync } from 'node:fs';
import { FormsDriver, type FillResult, type SubmitResult } from './forms-driver';
import { DailyReportActions, type DailyReportPayload } from './daily-report-actions';
import { SuspensionsActions, type SuspensionsPayload } from './suspensions-actions';
import { resolveFormsResourcePath } from './paths';
import { logger } from '../../utils/logger';

const SUSPENSIONS_URL_RELATIVE_PATH = 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt';
const DAILY_REPORT_URL_RELATIVE_PATH = 'extensions/moe-principal-assistant/forms/daily-report-test-fac-url.txt';

export class FormsBrowserManager {
  private driver: FormsDriver | null = null;
  private dailyReport: DailyReportActions | null = null;
  private suspensions: SuspensionsActions | null = null;

  private ensureDriver(): { driver: FormsDriver; dailyReport: DailyReportActions; suspensions: SuspensionsActions } {
    if (!this.driver) {
      this.driver = new FormsDriver();
      this.dailyReport = new DailyReportActions(this.driver);
      this.suspensions = new SuspensionsActions(this.driver);
    }
    return { driver: this.driver, dailyReport: this.dailyReport!, suspensions: this.suspensions! };
  }

  /** Load a cloned-form URL from disk. */
  private getFormUrl(relativePath: string): string | null {
    const urlPath = resolveFormsResourcePath(relativePath);
    if (!urlPath || !existsSync(urlPath)) return null;
    const v = readFileSync(urlPath, 'utf-8').trim();
    return v && /forms\.(?:office\.com|cloud\.microsoft)/.test(v) ? v : null;
  }

  private getDailyReportFormUrl(): string | null {
    return this.getFormUrl(DAILY_REPORT_URL_RELATIVE_PATH);
  }

  private getSuspensionsFormUrl(): string | null {
    return this.getFormUrl(SUSPENSIONS_URL_RELATIVE_PATH);
  }

  async listSupportedForms(): Promise<{ status: 'ok'; forms: Array<{ id: string; title: string; status: 'available' | 'not_configured' }> }> {
    const dailyReportUrl = this.getDailyReportFormUrl();
    const suspensionsUrl = this.getSuspensionsFormUrl();
    return {
      status: 'ok',
      forms: [
        {
          id: 'daily-report',
          title: 'Primary School Daily Report: Term 3 2025/26',
          status: dailyReportUrl ? 'available' : 'not_configured',
        },
        {
          id: 'suspensions',
          title: 'Primary School Student Suspensions: Term 3 2025/26',
          status: suspensionsUrl ? 'available' : 'not_configured',
        },
      ],
    };
  }

  async previewDailyReport(payload: DailyReportPayload): Promise<
    | { status: 'previewed'; url: string; filledCount: number; skippedCount: number; errors: FillResult['errors'] }
    | { status: 'error'; reason: string }
  > {
    const url = this.getDailyReportFormUrl();
    if (!url) {
      return {
        status: 'error',
        reason: 'Daily report form URL not configured. Clone the Primary School Daily Report form on test.fac, then write the response URL to daily-report-test-fac-url.txt.',
      };
    }
    const { dailyReport } = this.ensureDriver();
    const o = await dailyReport.open(url);
    if (o.status !== 'opened') {
      return { status: 'error', reason: o.reason ?? 'open failed' };
    }
    const f = await dailyReport.fill(payload);
    return {
      status: 'previewed',
      url,
      filledCount: f.filledCount,
      skippedCount: f.skippedCount,
      errors: f.errors,
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

  async submitDailyReport({ confirm }: { confirm: boolean }): Promise<SubmitResult> {
    const { dailyReport } = this.ensureDriver();
    const r = await dailyReport.submit({ confirm });
    logger.info(`[forms-v2] daily-report submit result: ${r.status}`);
    return r;
  }

  async submitSuspension({ confirm }: { confirm: boolean }): Promise<SubmitResult> {
    const { suspensions } = this.ensureDriver();
    const r = await suspensions.submit({ confirm });
    logger.info(`[forms-v2] suspension submit result: ${r.status}`);
    return r;
  }

  async close(): Promise<void> {
    await this.driver?.close();
    this.driver = null;
    this.dailyReport = null;
    this.suspensions = null;
  }
}

export const formsBrowserManagerV2 = new FormsBrowserManager();
