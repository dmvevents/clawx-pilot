/**
 * ConnectionStatus
 * Small coloured dot + label rendered in the chat header. Surfaces the
 * combined status of (a) the local Gateway and (b) the active provider
 * account. Vendor / model names are intentionally hidden — only "Online",
 * "On this device", "Reconnecting" or "Disconnected" are shown.
 *
 * Source of truth: the Gateway status stream (state + gatewayReady) — the
 * same signal the composer footer renders — plus the host-API health check.
 * The badge deliberately does NOT probe the provider host from the renderer:
 * model calls run from the gateway process, whose network path (CSP, proxy,
 * headers) differs from the renderer's, so a renderer-side probe can fail
 * while turns execute fine. Provider unreachability is handled at send time
 * by the channel-degrade path instead.
 */
import { useMemo } from 'react';
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
  const gatewayReady = useGatewayStore((s) => s.status.gatewayReady);
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

  const display: DisplayState = useMemo(() => {
    if (gatewayStatusState === 'starting' || gatewayStatusState === 'reconnecting') {
      return 'reconnecting';
    }
    if (gatewayStatusState !== 'running') return 'disconnected';
    // Running but subsystems not yet ready: the footer calls this "starting";
    // treat it as a transient, not a dead connection.
    if (gatewayReady === false) return 'reconnecting';
    if (gatewayHealth && gatewayHealth.ok === false) return 'disconnected';
    return providerClass;
  }, [gatewayStatusState, gatewayReady, gatewayHealth, providerClass]);

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
