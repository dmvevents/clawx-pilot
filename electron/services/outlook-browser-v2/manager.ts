/**
 * Public manager for the v2 Outlook integration. Same surface as
 * ../outlook-browser/manager.ts so the IPC handlers and host-API routes
 * are drop-in compatible — they just import from here when
 * OUTLOOK_BROWSER_V2 is on.
 *
 * Lifecycle: a single module-level singleton. The first call constructs
 * the Playwright driver + VLM grounder. close() resets state so the next
 * call boots a fresh session (useful when the user closes their Outlook
 * tab manually).
 */
import { logger } from '../../utils/logger';
import { PlaywrightDriver } from './playwright-driver';
import { VlmGrounder } from './vlm-grounder';
import { OutlookActions } from './outlook-actions';
import type {
  OutlookOpenResult,
  ReadInboxResult,
  DraftEmailArgs,
  DraftEmailResult,
  SendEmailArgs,
  SendEmailResult,
} from './types';

class OutlookBrowserManagerV2 {
  private actions: OutlookActions | null = null;
  private driver: PlaywrightDriver | null = null;

  private ensureActions(): OutlookActions {
    if (!this.actions) {
      this.driver = new PlaywrightDriver();
      const grounder = new VlmGrounder();
      this.actions = new OutlookActions(this.driver, grounder);
      logger.info('[outlook-v2] Manager initialised (Playwright CDP + Sonnet 4.5 grounding)');
    }
    return this.actions;
  }

  async open(): Promise<OutlookOpenResult> {
    return this.ensureActions().open();
  }

  async readInbox(top?: number): Promise<ReadInboxResult> {
    return this.ensureActions().readInbox(top);
  }

  async draftEmail(args: DraftEmailArgs): Promise<DraftEmailResult> {
    return this.ensureActions().draftEmail(args);
  }

  async sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
    return this.ensureActions().sendEmail(args);
  }

  async close(): Promise<void> {
    try {
      await this.driver?.close();
    } catch (err) {
      logger.warn(
        `[outlook-v2] driver.close failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.driver = null;
      this.actions = null;
    }
  }
}

export const outlookBrowserManagerV2 = new OutlookBrowserManagerV2();
