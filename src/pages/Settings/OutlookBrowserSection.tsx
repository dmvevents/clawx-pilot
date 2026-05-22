/**
 * Settings tile for the Phase-1 Outlook (browser-session) integration.
 *
 * This is the path that ships before IT returns an Entra app-registration
 * client_id. ClawX attaches to the principal's existing Chrome session via
 * the bundled browser plugin (profile=user) and drives Outlook Web through
 * the DOM. There is no OAuth, no token, and no password stored here — the
 * principal is "connected" exactly when they're signed in to Outlook in
 * their own Chrome.
 *
 * The Phase-2 Graph OAuth path is parked in MicrosoftGraphSection; the two
 * tiles sit side by side until that one is unblocked.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { invokeIpc } from '@/lib/api-client';

type ConnectionState = 'idle' | 'testing' | 'connected' | 'needs_signin' | 'error';

export function OutlookBrowserSection() {
  const [state, setState] = useState<ConnectionState>('idle');
  const [detail, setDetail] = useState<string>('');

  const testConnection = async () => {
    setState('testing');
    setDetail('');
    try {
      // The main process is expected to register an `outlook:open` IPC handler
      // that returns { status: 'opened' | 'needs_signin', message?: string }.
      // We treat a missing handler as "not wired yet" rather than an error.
      const result = await invokeIpc<{ status: string; message?: string }>(
        'outlook:open',
      );
      if (result?.status === 'opened') {
        setState('connected');
        setDetail('Outlook is open and signed in.');
        toast.success('Outlook connection verified');
      } else if (result?.status === 'needs_signin') {
        setState('needs_signin');
        setDetail(
          result.message ??
            'Please sign in to Outlook in the Chrome window that just opened.',
        );
      } else {
        setState('error');
        setDetail('Unexpected response from Outlook test.');
      }
    } catch (err) {
      setState('error');
      const msg = (err as Error)?.message ?? String(err);
      setDetail(msg);
      toast.error(`Outlook test failed: ${msg}`);
    }
  };

  return (
    <div data-testid="settings-outlook-browser-section">
      <h2 className="text-3xl font-serif text-foreground mb-2 font-normal tracking-tight">
        Outlook (Browser session)
      </h2>
      <p className="text-meta text-muted-foreground mb-6 max-w-prose">
        Connected when you are signed in to Outlook in Chrome. The assistant
        opens Outlook in your existing Chrome window — no separate sign-in is
        required. Drafts are always left open in Outlook for you to review;
        emails are never sent without your explicit confirmation.
      </p>

      <div className="flex items-center justify-between p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            {state === 'connected' && 'Connected'}
            {state === 'needs_signin' && 'Sign-in required in Chrome'}
            {state === 'testing' && 'Testing…'}
            {state === 'error' && 'Connection error'}
            {state === 'idle' && 'Status unknown — run a test'}
          </span>
          {detail && (
            <span className="text-meta text-muted-foreground max-w-prose">
              {detail}
            </span>
          )}
        </div>
        <Button
          data-testid="outlook-browser-test-btn"
          onClick={testConnection}
          disabled={state === 'testing'}
          variant="outline"
          className="rounded-full"
        >
          {state === 'testing' ? 'Testing…' : 'Test connection'}
        </Button>
      </div>
    </div>
  );
}
