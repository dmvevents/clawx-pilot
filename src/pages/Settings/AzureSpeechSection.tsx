/**
 * Settings tile for Azure Speech-to-Text (optional cloud fallback ASR).
 *
 * Three fields: region, apiKey, locale. The "Test connection" button runs a
 * 1-second silent clip through Azure and reports the result — Azure's STT
 * service responds with HTTP 200 and a NoMatch RecognitionStatus for clean
 * silence, which is enough to prove the credentials are valid without sending
 * any real audio.
 *
 * Default locale is en-TT (Trinidad & Tobago English; Azure supports this
 * since 2022 and the Ministry of Education Trinidad & Tobago is the pilot
 * tenant for this feature).
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { azureSpeech, type AzureSpeechConfig } from '@/lib/azure-speech';

const DEFAULT_LOCALE = 'en-TT';
const REGION_PLACEHOLDER = 'eastus';
const KEY_PLACEHOLDER = 'paste Azure Speech subscription key';

export function AzureSpeechSection() {
  const [config, setConfig] = useState<AzureSpeechConfig>({
    region: '',
    apiKey: '',
    locale: DEFAULT_LOCALE,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const persisted = await azureSpeech.getConfig();
        if (!cancelled) {
          setConfig({
            region: persisted.region,
            apiKey: persisted.apiKey,
            locale: persisted.locale || DEFAULT_LOCALE,
          });
        }
      } catch (err) {
        toast.error(`Azure Speech: ${(err as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await azureSpeech.setConfig({
        region: config.region.trim(),
        apiKey: config.apiKey.trim(),
        locale: (config.locale || DEFAULT_LOCALE).trim(),
      });
      toast.success('Azure Speech configuration saved');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      // Persist first so the test handler reads the current values.
      await azureSpeech.setConfig({
        region: config.region.trim(),
        apiKey: config.apiKey.trim(),
        locale: (config.locale || DEFAULT_LOCALE).trim(),
      });
      const result = await azureSpeech.test();
      // Empty text is the expected outcome for a silent clip — that just
      // means the credentials worked and Azure returned NoMatch.
      toast.success(
        result.text
          ? `Azure Speech ok — heard: "${result.text}"`
          : 'Azure Speech ok (credentials valid, silent clip → NoMatch)',
      );
    } catch (err) {
      toast.error(`Test failed: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const configured = Boolean(config.region.trim() && config.apiKey.trim());

  return (
    <div data-testid="settings-azure-speech-section">
      <h2 className="text-3xl font-serif text-foreground mb-2 font-normal tracking-tight">
        Azure Speech (optional)
      </h2>
      <p className="text-meta text-muted-foreground mb-6 max-w-prose">
        Optional cloud fallback for speech-to-text. When configured, ClawX can
        stream microphone audio to your tenant's Azure Speech resource for
        higher-quality transcription with live partial results. Native
        on-device recognition (Apple / Windows) remains the default. Default
        locale is <code>en-TT</code> (Trinidad &amp; Tobago English).
      </p>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground/80">Region</Label>
          <Input
            data-testid="azure-speech-region-input"
            value={config.region}
            onChange={(e) => setConfig({ ...config, region: e.target.value })}
            placeholder={REGION_PLACEHOLDER}
            spellCheck={false}
          />
          <p className="text-meta text-muted-foreground">
            Short region name from the Azure portal (e.g. <code>eastus</code>,{' '}
            <code>southcentralus</code>, <code>westus2</code>). For Trinidad &amp;
            Tobago, <code>eastus</code> or <code>southcentralus</code> typically
            give the lowest latency.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground/80">
            Subscription key
          </Label>
          <Input
            data-testid="azure-speech-key-input"
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            placeholder={KEY_PLACEHOLDER}
            spellCheck={false}
          />
          <p className="text-meta text-muted-foreground">
            From the Speech resource in the Azure portal under{' '}
            <strong>Keys and Endpoint</strong> → either <code>Key 1</code> or{' '}
            <code>Key 2</code>. No additional Entra app permissions are needed —
            the resource key is the only credential.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground/80">Locale</Label>
          <Input
            data-testid="azure-speech-locale-input"
            value={config.locale}
            onChange={(e) => setConfig({ ...config, locale: e.target.value })}
            placeholder={DEFAULT_LOCALE}
            spellCheck={false}
          />
          <p className="text-meta text-muted-foreground">
            BCP-47 language tag. Defaults to <code>en-TT</code>. Other useful
            values for the Ministry's pilot: <code>en-US</code>,{' '}
            <code>en-GB</code>, <code>en-IN</code>.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={save}
            disabled={saving}
            className="rounded-full"
            data-testid="azure-speech-save-btn"
          >
            {saving ? 'Saving…' : 'Save configuration'}
          </Button>
          <Button
            onClick={test}
            variant="outline"
            disabled={testing || !configured}
            className="rounded-full"
            data-testid="azure-speech-test-btn"
          >
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
        </div>
      </div>
    </div>
  );
}
