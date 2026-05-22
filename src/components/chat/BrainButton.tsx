/**
 * Three-state reasoning-visibility toggle for the chat composer.
 *
 * Cycles: hidden → condensed → expanded → hidden.
 *
 * - hidden    🚫 Brain (slash overlay): "Don't show reasoning"
 * - condensed 🧠 Brain (default look):  "Show condensed reasoning"
 * - expanded  ✨ Brain (filled accent): "Show full reasoning"
 *
 * The button mirrors the global setting from Settings → Chat behaviour, but
 * the user can override per-session here. The override persists for the
 * current chat session only; navigating to a new chat resets to the global.
 */
import { Brain, BrainCircuit, BrainCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ReasoningVisibility = 'hidden' | 'condensed' | 'expanded';

const NEXT: Record<ReasoningVisibility, ReasoningVisibility> = {
  hidden: 'condensed',
  condensed: 'expanded',
  expanded: 'hidden',
};

const TOOLTIP: Record<ReasoningVisibility, string> = {
  hidden: 'Reasoning hidden — click to show condensed',
  condensed: 'Reasoning condensed — click to show expanded',
  expanded: 'Reasoning expanded — click to hide',
};

const ARIA: Record<ReasoningVisibility, string> = {
  hidden: 'Reasoning visibility: hidden',
  condensed: 'Reasoning visibility: condensed',
  expanded: 'Reasoning visibility: expanded',
};

export interface BrainButtonProps {
  value: ReasoningVisibility;
  onChange: (next: ReasoningVisibility) => void;
  disabled?: boolean;
  className?: string;
}

export function BrainButton({ value, onChange, disabled, className }: BrainButtonProps) {
  const Icon =
    value === 'hidden' ? Brain : value === 'condensed' ? BrainCircuit : BrainCog;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-testid="chat-composer-reasoning"
      data-reasoning-visibility={value}
      className={cn(
        'shrink-0 h-8 w-8 rounded-lg transition-colors',
        value === 'expanded'
          ? 'bg-primary/10 text-primary hover:bg-primary/15'
          : value === 'hidden'
            ? 'text-muted-foreground/50 hover:bg-black/5 dark:hover:bg-white/10 hover:text-muted-foreground'
            : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground',
        className,
      )}
      onClick={() => onChange(NEXT[value])}
      disabled={disabled}
      title={TOOLTIP[value]}
      aria-label={ARIA[value]}
      aria-pressed={value !== 'hidden'}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={value === 'expanded' ? 2.25 : 1.75} />
    </Button>
  );
}
