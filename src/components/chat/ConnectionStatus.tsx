/**
 * ConnectionStatus
 * Small coloured dot + label rendered in the chat header. Surfaces the
 * combined status of (a) the local Gateway and (b) the active provider
 * account. Vendor / model names are intentionally hidden — only "Online",
 * "On this device", "Reconnecting" or "Disconnected" are shown.
 *
 * Probe strategy:
 *   • Gateway state and health come from useGatewayStore.
 *   • For an online active provider we issue a short HEAD against the
 *     account's baseUrl, cached for 30s in module scope. If no baseUrl is
 *     known (or for on-device providers) we skip the probe and classify
 *     by vendorId only — the Gateway health acts as the local liveness
 *     signal in that case.
 */
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useSettingsStore } from '@/stores/settings';
import {
  classifyProvider,
  publicLabel,
  publicStatusDot,
  type ProviderClass,
} from '@/lib/provider-display';
import { splitModelRef, resolveRuntimeProviderKey } from '@/lib/model-options';
import type { ProviderAccount } from '@/lib/providers';

type DisplayState = 'online' | 'on-device' | 'reconnecting' | 'disconnected';

interface ProbeEntry {
  ok: boolean;
  expiresAt: number;
}

const PROBE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;
const probeCache = new Map<string, ProbeEntry>();
const inflightProbes = new Map<string, Promise<boolean>>();

function probeOnlineHost(baseUrl: string): Promise<boolean> {
  const now = Date.now();
  const cached = probeCache.get(baseUrl);
  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cached.ok);
  }
  const inflight = inflightProbes.get(baseUrl);
  if (inflight) return inflight;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const probe = fetch(baseUrl, {
    method: 'HEAD',
    mode: 'no-cors',
    signal: controller.signal,
    cache: 'no-store',
  })
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      clearTimeout(timeout);
      inflightProbes.delete(baseUrl);
    })
    .then((ok) => {
      probeCache.set(baseUrl, { ok, expiresAt: Date.now() + PROBE_TTL_MS });
      return ok;
    });
  inflightProbes.set(baseUrl, probe);
  return probe;
}

function pickActiveAccount(
  accounts: ProviderAccount[],
  defaultAccountId: string | null,
  modelRef: string | null | undefined,
): ProviderAccount | null {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const split = splitModelRef(modelRef);
  if (split) {
    const matchByRuntime = accounts.find(
      (account) => resolveRuntimeProviderKey(account) === split.providerKey,
    );
    if (matchByRuntime) return matchByRuntime;
  }
  if (defaultAccountId) {
    const def = accounts.find((account) => account.id === defaultAccountId);
    if (def) return def;
  }
  return accounts.find((account) => account.enabled) ?? accounts[0] ?? null;
}

export function ConnectionStatus() {
  const gatewayStatusState = useGatewayStore((s) => s.status.state);
  const gatewayHealth = useGatewayStore((s) => s.health);
  const accounts = useProviderStore((s) => s.accounts);
  const defaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const agents = useAgentsStore((s) => s.agents);
  const devModeUnlocked = useSettingsStore((s) => s.devModeUnlocked);

  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );

  const activeAccount = useMemo(
    () => pickActiveAccount(accounts, defaultAccountId, currentAgent?.modelRef ?? null),
    [accounts, defaultAccountId, currentAgent?.modelRef],
  );

  const providerClass: ProviderClass = useMemo(
    () => classifyProvider(activeAccount ?? undefined),
    [activeAccount],
  );

  // We only reach into setState inside the async resolution branch — when no
  // probe is needed (on-device, or no baseUrl) we leave the value as `true`.
  // Resetting to `true` on every change is handled by re-running the effect,
  // which short-circuits without touching state when there's nothing to probe.
  const [providerReachable, setProviderReachable] = useState<boolean>(true);

  useEffect(() => {
    if (providerClass !== 'online' || !activeAccount?.baseUrl) return;
    let cancelled = false;
    void probeOnlineHost(activeAccount.baseUrl).then((ok) => {
      if (!cancelled) setProviderReachable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [providerClass, activeAccount?.baseUrl]);

  const display: DisplayState = useMemo(() => {
    if (gatewayStatusState === 'starting' || gatewayStatusState === 'reconnecting') {
      return 'reconnecting';
    }
    if (gatewayStatusState !== 'running') return 'disconnected';
    if (gatewayHealth && gatewayHealth.ok === false) return 'disconnected';
    if (providerClass === 'online' && !providerReachable) return 'disconnected';
    return providerClass;
  }, [gatewayStatusState, gatewayHealth, providerClass, providerReachable]);

  const label = useMemo(() => {
    switch (display) {
      case 'reconnecting': return 'Reconnecting';
      case 'disconnected': return 'Disconnected';
      case 'on-device': return publicLabel('on-device');
      case 'online':
      default: return publicLabel('online');
    }
  }, [display]);

  const dotClass = useMemo(() => {
    if (display === 'reconnecting') return 'bg-amber-400';
    if (display === 'disconnected') return 'bg-red-500';
    return publicStatusDot(display, true);
  }, [display]);

  const devTooltip = devModeUnlocked
    ? `${activeAccount?.vendorId ?? 'no-account'}${activeAccount?.model ? ` · ${activeAccount.model}` : ''}${activeAccount?.baseUrl ? ` · ${activeAccount.baseUrl}` : ''} · gateway:${gatewayStatusState}`
    : undefined;

  return (
    <div
      data-testid="chat-connection-status"
      data-state={display}
      title={devTooltip}
      className="hidden sm:flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-foreground/80 dark:border-white/10 dark:bg-white/5"
    >
      <span
        aria-hidden
        className={cn('h-2 w-2 shrink-0 rounded-full', dotClass, display === 'reconnecting' && 'animate-pulse')}
      />
      <span>{label}</span>
      {devModeUnlocked && activeAccount?.model && (
        <span className="ml-1 text-[10px] font-normal text-muted-foreground/80 truncate max-w-[160px]">
          {activeAccount.model}
        </span>
      )}
    </div>
  );
}

export default ConnectionStatus;
