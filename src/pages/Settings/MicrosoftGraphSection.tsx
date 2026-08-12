/**
 * Settings tile for Microsoft 365 / Outlook (Microsoft Graph) sign-in.
 *
 * Three states:
 *   - not configured  → administrator tenant + clientId form
 *   - configured but signed-out → Microsoft sign-in button
 *   - signed in → account info + Sign out
 *
 * If the loopback redirect on :53682 is unavailable (port-in-use) or the user
 * doesn't complete sign-in in time, the main process emits `msgraph:code` with
 * the authorize URL — the modal here lets the user paste the redirected URL
 * back. Same UX pattern as the existing OpenAI/Google OAuth flows.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  microsoftGraph,
  type MicrosoftGraphConfig,
  type MicrosoftGraphStatus,
  type ManualCodePrompt,
} from '@/lib/microsoft-graph';

const DEFAULT_TENANT_PLACEHOLDER = 'moe.gov.tt';
const DEFAULT_CLIENT_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

export function MicrosoftGraphSection() {
  const [status, setStatus] = useState<MicrosoftGraphStatus | null>(null);
  const [config, setConfigState] = useState<MicrosoftGraphConfig>({ tenantId: '', clientId: '' });
  const [editingConfig, setEditingConfig] = useState<boolean>(false);
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [manualPrompt, setManualPrompt] = useState<ManualCodePrompt | null>(null);
  const [manualValue, setManualValue] = useState<string>('');

  const refresh = useMemo(
    () => async () => {
      try {
        const next = await microsoftGraph.status();
        setStatus(next);
        const persistedConfig = await microsoftGraph.getConfig();
        if (persistedConfig) {
          setConfigState({
            tenantId: persistedConfig.tenantId,
            clientId: persistedConfig.clientId,
            scopes: persistedConfig.scopes,
            redirectUri: persistedConfig.redirectUri,
          });
        }
      } catch (err) {
        toast.error(`Microsoft 365 status: ${(err as Error).message}`);
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
    const offCode = microsoftGraph.on.code(setManualPrompt);
    const offSignedIn = microsoftGraph.on.signedIn(() => {
      void refresh();
      toast.success('Microsoft 365 connected');
    });
    const offSignedOut = microsoftGraph.on.signedOut(() => {
      void refresh();
    });
    const offError = microsoftGraph.on.error(({ message }) => {
      toast.error(`Microsoft 365: ${message}`);
    });
    return () => {
      offCode();
      offSignedIn();
      offSignedOut();
      offError();
    };
  }, [refresh]);

  const saveConfig = async () => {
    const tenantId = config.tenantId.trim();
    const clientId = config.clientId.trim();
    if (!tenantId || !clientId) {
      toast.error('Tenant and Client ID are both required');
      return;
    }
    try {
      await microsoftGraph.setConfig({ tenantId, clientId });
      setEditingConfig(false);
      await refresh();
      toast.success('Microsoft 365 configuration saved');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  };

  const signIn = async () => {
    setSigningIn(true);
    try {
      await microsoftGraph.signIn({ promptSelectAccount: true });
    } catch (err) {
      toast.error(`Sign-in failed: ${(err as Error).message}`);
    } finally {
      setSigningIn(false);
      setManualPrompt(null);
      setManualValue('');
    }
  };

  const signOut = async () => {
    try {
      await microsoftGraph.signOut();
      await refresh();
      toast.success('Microsoft 365 signed out');
    } catch (err) {
      toast.error(`Sign-out failed: ${(err as Error).message}`);
    }
  };

  const submitManualCode = async () => {
    const value = manualValue.trim();
    if (!value) return;
    try {
      await microsoftGraph.submitManualCode(value);
      setManualPrompt(null);
      setManualValue('');
    } catch (err) {
      toast.error(`Manual code submit failed: ${(err as Error).message}`);
    }
  };

  const showConfigForm = editingConfig || !status?.configured;

  return (
    <div data-testid="settings-msgraph-section">
      <h2 className="text-3xl font-serif text-foreground mb-2 font-normal tracking-tight">
        Microsoft 365 sign-in
      </h2>
      <p className="text-meta text-muted-foreground mb-6 max-w-prose">
        Connect the principal's Outlook mailbox through Microsoft sign-in. This
        app never asks for or stores the Microsoft password; credentials are
        entered only on Microsoft's sign-in page.
      </p>

      {showConfigForm && (
        <div className="space-y-4 mb-6">
          <p className="text-meta text-muted-foreground max-w-prose">
            Administrator setup is needed only when tenant defaults were not
            packaged with the installer. Your IT administrator provides the
            Tenant and Client ID.
          </p>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground/80">
              Tenant (domain or GUID)
            </Label>
            <Input
              data-testid="msgraph-tenant-input"
              value={config.tenantId}
              onChange={(e) => setConfigState({ ...config, tenantId: e.target.value })}
              placeholder={DEFAULT_TENANT_PLACEHOLDER}
              spellCheck={false}
            />
            <p className="text-meta text-muted-foreground">
              Your organisation's Entra ID tenant. The verified domain (e.g.{' '}
              <code>{DEFAULT_TENANT_PLACEHOLDER}</code>) or the tenant GUID.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground/80">
              Application (client) ID
            </Label>
            <Input
              data-testid="msgraph-clientid-input"
              value={config.clientId}
              onChange={(e) => setConfigState({ ...config, clientId: e.target.value })}
              placeholder={DEFAULT_CLIENT_PLACEHOLDER}
              spellCheck={false}
            />
            <p className="text-meta text-muted-foreground">
              From the App registration in the Entra admin portal. Must be a
              public-client (native) registration with redirect{' '}
              <code>http://localhost:53682/callback</code> and delegated scopes:{' '}
              <code>Mail.Read</code>, <code>Mail.ReadWrite</code>,{' '}
              <code>Mail.Send</code>, <code>Calendars.Read</code>,{' '}
              <code>offline_access</code>, <code>User.Read</code>.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveConfig} className="rounded-full">
              Save configuration
            </Button>
            {status?.configured && (
              <Button
                variant="outline"
                onClick={() => setEditingConfig(false)}
                className="rounded-full"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {!showConfigForm && status && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium flex items-center gap-2">
                {status.signedIn ? status.account?.email ?? 'Signed in' : 'Not signed in'}
                {status.effectiveMock && (
                  <span className="text-meta px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                    Mock mailbox
                  </span>
                )}
              </span>
              <span className="text-meta text-muted-foreground">
                Tenant: {status.account?.tenantId ?? config.tenantId}
              </span>
              <span className="text-meta text-muted-foreground">
                Client ID: <code>{config.clientId}</code>
              </span>
              {status.signedIn && status.expiresAt && (
                <span className="text-meta text-muted-foreground">
                  Token expires: {new Date(status.expiresAt).toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {status.signedIn ? (
                <Button onClick={signOut} variant="outline" className="rounded-full">
                  Sign out
                </Button>
              ) : (
                <Button
                  data-testid="msgraph-signin-btn"
                  onClick={signIn}
                  disabled={signingIn}
                  className="rounded-full"
                >
                  {signingIn ? 'Signing in…' : 'Sign in'}
                </Button>
              )}
              <Button
                onClick={() => setEditingConfig(true)}
                variant="ghost"
                className="rounded-full"
              >
                Change
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Mock mailbox (demo mode)</span>
              <span className="text-meta text-muted-foreground">
                Returns realistic Ministry-style fixture messages instead of hitting
                Microsoft Graph. Useful for stakeholder demos before tenant
                onboarding is complete. Auto-on when not signed in.
              </span>
            </div>
            <Button
              variant={status.mockMailbox ? 'default' : 'outline'}
              onClick={async () => {
                try {
                  await microsoftGraph.setMockMailbox(!status.mockMailbox);
                  await refresh();
                } catch (err) {
                  toast.error(`Toggle failed: ${(err as Error).message}`);
                }
              }}
              className="rounded-full"
            >
              {status.mockMailbox ? 'On' : 'Off'}
            </Button>
          </div>
        </div>
      )}

      {manualPrompt && (
        <div className="mt-4 p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10">
          <p className="text-sm font-medium text-foreground mb-2">
            Microsoft sign-in callback could not complete automatically (
            {manualPrompt.reason === 'port_in_use'
              ? 'localhost:53682 is in use'
              : 'callback timed out'}
            ).
          </p>
          <p className="text-meta text-muted-foreground mb-3">
            Open the sign-in page below if it didn't open automatically, complete
            sign-in, then paste the URL of the page you land on (or the{' '}
            <code>code</code> parameter from it) here.
          </p>
          <a
            href={manualPrompt.authorizationUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary underline"
          >
            Open Microsoft sign-in page
          </a>
          <div className="mt-3 flex gap-2">
            <Input
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="Paste full callback URL or just the code"
              spellCheck={false}
            />
            <Button onClick={submitManualCode} className="rounded-full whitespace-nowrap">
              Submit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
