/**
 * LatencyTimelinePanel
 * Dev-mode-only flight-recorder view. Reads the OpenClaw trajectory
 * (`<sessionId>.trajectory.jsonl`) for the current chat session and renders
 * each event with a wall-clock delta from the previous event so you can see
 * where a turn spent its time:
 *
 *   prompt.submitted ─┐
 *                     ├─ 240ms  context.compiled
 *                     ├─ 380ms  trace.metadata
 *                     └─ 9.4s   model.completed   ← latency lives here
 *
 * Polls every 2s while open. Only renders when devModeUnlocked is true.
 */
import { useCallback, useEffect, useState } from 'react';
import { hostApiFetch } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';

type TrajectoryEvent = {
  event?: string;
  type?: string;
  timestamp?: number | string;
  ts?: number | string;
  [key: string]: unknown;
};

type TrajectoryResponse = {
  success: boolean;
  events?: TrajectoryEvent[];
  truncated?: boolean;
  totalLines?: number;
  error?: string;
};

const POLL_INTERVAL_MS = 2_000;
const VISIBLE_EVENT_LIMIT = 80;

function parseSessionId(sessionKey: string | null | undefined): { agentId: string; sessionId: string } | null {
  if (!sessionKey || !sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  const agentId = parts[1];
  const sessionId = parts.slice(2).join(':');
  if (!agentId || !sessionId || sessionId === 'main') return null;
  return { agentId, sessionId };
}

function eventTime(event: TrajectoryEvent): number | null {
  const raw = event.timestamp ?? event.ts;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatDelta(ms: number): string {
  if (ms < 1) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function eventLabel(event: TrajectoryEvent): string {
  const name = (event.event ?? event.type ?? 'event') as string;
  return String(name);
}

function severityClass(deltaMs: number): string {
  if (deltaMs >= 5000) return 'text-red-500';
  if (deltaMs >= 1500) return 'text-amber-500';
  return 'text-muted-foreground';
}

export function LatencyTimelinePanel() {
  const devModeUnlocked = useSettingsStore((s) => s.devModeUnlocked);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TrajectoryEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const target = parseSessionId(currentSessionKey);

  const fetchEvents = useCallback(async () => {
    if (!target) {
      setEvents([]);
      setError(null);
      return;
    }
    try {
      setLoading(true);
      const params = new URLSearchParams({
        agentId: target.agentId,
        sessionId: target.sessionId,
        limit: '500',
      });
      const response = await hostApiFetch<TrajectoryResponse>(
        `/api/sessions/trajectory?${params.toString()}`,
      );
      if (response?.success && Array.isArray(response.events)) {
        setEvents(response.events);
        setError(null);
      } else {
        setEvents([]);
        setError(response?.error ?? 'No trajectory yet');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    if (!open || !target) return;
    void fetchEvents();
    const id = window.setInterval(() => {
      void fetchEvents();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [open, target, fetchEvents]);

  if (!devModeUnlocked) return null;

  const visible = events.slice(-VISIBLE_EVENT_LIMIT);
  let prevTime: number | null = null;
  let firstTime: number | null = null;
  const rows = visible.map((event, index) => {
    const t = eventTime(event);
    const delta = t != null && prevTime != null ? t - prevTime : 0;
    if (firstTime == null && t != null) firstTime = t;
    const sinceStart = t != null && firstTime != null ? t - firstTime : 0;
    if (t != null) prevTime = t;
    return { event, t, delta, sinceStart, key: `${index}-${eventLabel(event)}` };
  });

  const total = rows.length > 0 ? rows[rows.length - 1].sinceStart : 0;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-lg border border-black/10 bg-white/95 text-xs shadow-lg backdrop-blur dark:border-white/10 dark:bg-neutral-900/95">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 font-medium hover:bg-black/5 dark:hover:bg-white/5"
      >
        <span className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', loading ? 'bg-blue-400 animate-pulse' : 'bg-green-500')} />
          Latency timeline
          {total > 0 && (
            <span className="text-[10px] font-normal text-muted-foreground">
              · {formatDelta(total)} total
            </span>
          )}
        </span>
        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="max-h-[60vh] overflow-y-auto border-t border-black/10 px-3 py-2 dark:border-white/10">
          {!target && (
            <p className="py-3 text-center text-muted-foreground">No active session</p>
          )}
          {target && error && rows.length === 0 && (
            <p className="py-3 text-center text-muted-foreground">{error}</p>
          )}
          {target && rows.length === 0 && !error && (
            <p className="py-3 text-center text-muted-foreground">Waiting for events…</p>
          )}
          {rows.length > 0 && (
            <ul className="space-y-1 font-mono">
              {rows.map((row, i) => (
                <li key={row.key} className="flex items-baseline gap-2">
                  <span className={cn('w-12 shrink-0 text-right tabular-nums', severityClass(row.delta))}>
                    {i === 0 ? '—' : `+${formatDelta(row.delta)}`}
                  </span>
                  <span className="flex-1 truncate text-foreground/90">{eventLabel(row.event)}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                    {formatDelta(row.sinceStart)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default LatencyTimelinePanel;
