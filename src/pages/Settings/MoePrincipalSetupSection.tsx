import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { invokeIpc } from '@/lib/api-client';
import { validateMoEFormUrls, type MoeFormUrls } from '@/lib/moe-forms';
import { toast } from 'sonner';

type IpcEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code?: string; message?: string } };

type SaveEnvelope = { ok: true } | { ok: false; error: { code?: string; message?: string } };

function envelopeMessage(envelope: SaveEnvelope | IpcEnvelope<unknown>): string {
  return envelope.ok ? 'Unexpected empty response' : envelope.error.message ?? envelope.error.code ?? 'Unknown error';
}

export function MoePrincipalSetupSection() {
  const [urls, setUrls] = useState<MoeFormUrls>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadUrls = async () => {
      try {
        const response = await invokeIpc<IpcEnvelope<MoeFormUrls>>('moeforms:get-urls');
        if (cancelled) return;
        if (!response.ok) throw new Error(envelopeMessage(response));
        setUrls({
          dailyReport: response.data.dailyReport ?? '',
          suspension: response.data.suspension ?? '',
        });
      } catch (err) {
        if (!cancelled) toast.error(`MoE Forms setup: ${(err as Error).message}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    void loadUrls();
    return () => {
      cancelled = true;
    };
  }, []);

  const validationErrors = useMemo(() => validateMoEFormUrls(urls), [urls]);
  const configuredCount = Number(Boolean(urls.dailyReport?.trim())) + Number(Boolean(urls.suspension?.trim()));

  const saveUrls = async () => {
    if (validationErrors.length > 0) {
      toast.error(validationErrors[0]);
      return;
    }

    setSaving(true);
    try {
      const response = await invokeIpc<SaveEnvelope>('moeforms:set-urls', {
        dailyReport: urls.dailyReport?.trim() ?? '',
        suspension: urls.suspension?.trim() ?? '',
      });
      if (!response.ok) throw new Error(envelopeMessage(response));
      toast.success('MoE Forms links saved');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="settings-moe-principal-setup-section">
      <h2 className="text-3xl font-serif text-foreground mb-2 font-normal tracking-tight">
        Principal setup
      </h2>
      <p className="text-meta text-muted-foreground mb-6 max-w-prose">
        Store the Ministry form links used by the assistant. Microsoft email
        passwords are entered only on Microsoft's sign-in page, never in this app.
      </p>

      <div className="space-y-5">
        <div className="flex items-center justify-between p-4 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">MoE Forms readiness</span>
            <span className="text-meta text-muted-foreground">
              {loaded ? `${configuredCount} of 2 links configured` : 'Checking saved links'}
            </span>
          </div>
          <span className="text-meta px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            Local profile
          </span>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground/80">
            Daily Report response link
          </Label>
          <Input
            data-testid="moe-daily-report-url-input"
            value={urls.dailyReport ?? ''}
            onChange={(event) => setUrls((current) => ({ ...current, dailyReport: event.target.value }))}
            placeholder="https://forms.office.com/..."
            spellCheck={false}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground/80">
            Student Suspensions response link
          </Label>
          <Input
            data-testid="moe-suspension-url-input"
            value={urls.suspension ?? ''}
            onChange={(event) => setUrls((current) => ({ ...current, suspension: event.target.value }))}
            placeholder="https://forms.office.com/..."
            spellCheck={false}
          />
        </div>

        {validationErrors.length > 0 && (
          <p className="text-meta text-destructive" data-testid="moe-form-url-validation">
            {validationErrors[0]}
          </p>
        )}

        <Button
          onClick={saveUrls}
          disabled={saving || validationErrors.length > 0}
          className="rounded-full"
          data-testid="moe-form-url-save-btn"
        >
          {saving ? 'Saving...' : 'Save form links'}
        </Button>
      </div>
    </div>
  );
}
