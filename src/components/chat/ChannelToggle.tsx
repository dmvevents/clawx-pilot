import { Cloud, Laptop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ProviderClass } from '@/lib/provider-display';

interface ChannelToggleProps {
  /** The currently effective channel (after override + setting + accounts) */
  value: ProviderClass;
  /** Cycle the channel. Component does NOT compute the next value itself. */
  onChange: (next: ProviderClass) => void;
  /** Set true when neither channel has at least one account. Renders nothing. */
  hidden?: boolean;
  /** Set true to show the toggle in a disabled state (e.g. gateway down) */
  disabled?: boolean;
  /**
   * Set true when the chosen channel has no available account. Click still
   * fires; consumer surfaces the failover toast on send.
   */
  unavailable?: boolean;
}

/**
 * Two-state pill switching between "On this device" (local Ollama) and
 * "Online" (cloud router) for the next chat message.
 *
 * Anonymised on purpose: never exposes the underlying vendor or model id.
 */
export function ChannelToggle({
  value, onChange, hidden = false, disabled = false, unavailable = false,
}: ChannelToggleProps) {
  if (hidden) return null;
  const isOnline = value === 'online';
  const next: ProviderClass = isOnline ? 'on-device' : 'online';
  const label = isOnline ? 'Online' : 'On this device';
  const Icon = isOnline ? Cloud : Laptop;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="chat-composer-channel"
          data-channel={value}
          disabled={disabled}
          onClick={() => onChange(next)}
          className={cn(
            'h-8 rounded-lg px-2 gap-1.5 text-xs text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors',
            unavailable && 'text-amber-500 hover:text-amber-600',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="font-medium">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs">
        {unavailable
          ? `${label} isn't configured on this machine — your message will run on the other one.`
          : `Tap to switch to ${next === 'online' ? 'Online' : 'On this device'} for the next message.`}
      </TooltipContent>
    </Tooltip>
  );
}
