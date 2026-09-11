/**
 * Should "New Chat" actually start a new session?
 *
 * The sidebar button used to skip `newSession()` whenever the transcript was
 * empty, reading "no messages" as "the principal is already on a fresh chat".
 * On the installed build the Gateway takes 30–60 s to become ready, so for the
 * first minute after launch the main session has NO loaded messages yet — and
 * a click in that window silently kept the principal in `agent:main:main`. The
 * turn then went to yesterday's conversation, and when history arrived, old
 * messages and an old error chip surrounded the new exchange (CLWX-140,
 * reproduced 4/4 as the first turn after launch on 2026-09-10; 0/2 once
 * history had loaded).
 *
 * "Already on a fresh chat" is therefore an allowlist, not a denylist
 * (independent review of ea1d478f, HIGH-2): only a key of the exact shape
 * `newSession()` mints — `<prefix>:session-<epoch-ms>` — minted during THIS app
 * run, with no history records, no activity timestamp and no label, is left
 * alone. The main session, cron sessions, the short `main` key, a restored
 * session from an earlier run, or anything unknown always yields a new session.
 * A restored prior session can look empty for the same reason main can (its
 * history and label hydrate late), so its epoch must be newer than launch.
 */
export interface NewChatDecisionInput {
  currentSessionKey: string;
  messages: ReadonlyArray<unknown>;
  sessionLastActivity: Readonly<Record<string, number | undefined>>;
  sessionLabels: Readonly<Record<string, string | undefined>>;
}

const MINTED_SESSION_KEY = /:session-(\d+)$/;

/** Renderer start, used to tell a key minted this run from a restored one. */
export const RENDERER_LAUNCH_MS = Date.now();

export function shouldStartNewSession(input: NewChatDecisionInput, launchMs: number = RENDERER_LAUNCH_MS): boolean {
  const key = input.currentSessionKey || '';
  const minted = MINTED_SESSION_KEY.exec(key);
  if (!minted || Number(minted[1]) < launchMs) return true;
  const alreadyFresh = input.messages.length === 0
    && !input.sessionLastActivity[key]
    && !input.sessionLabels[key];
  return !alreadyFresh;
}
