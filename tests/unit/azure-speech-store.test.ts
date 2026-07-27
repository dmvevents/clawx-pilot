// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  userDataPath: '/tmp/clawx-azure-speech-user-data',
  appPath: '/tmp/clawx-azure-speech-app',
  cwdPath: '/tmp/clawx-azure-speech-cwd',
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return mocks.userDataPath;
      return '/tmp';
    }),
    getAppPath: vi.fn(() => mocks.appPath),
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getAzureSpeechCandidateConfigPaths,
  resolveAzureSpeechSeedConfig,
} from '@electron/services/azure-speech/store';

const cwdSpy = vi.spyOn(process, 'cwd');
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
const ENV_KEYS = [
  'CLAWX_AZURE_SPEECH_CONFIG',
  'CLAWX_AZURE_SPEECH_ENABLED',
  'CLAWX_AZURE_SPEECH_REGION',
  'CLAWX_AZURE_SPEECH_API_KEY',
  'CLAWX_AZURE_SPEECH_API_KEY_FILE',
  'CLAWX_AZURE_SPEECH_LOCALE',
  'AZURE_SPEECH_REGION',
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_KEY_FILE',
  'AZURE_SPEECH_LOCALE',
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

describe('Azure Speech seed config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEnv();
    cwdSpy.mockReturnValue(mocks.cwdPath);
    if (originalResourcesPath) {
      Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
    } else {
      delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    }
  });

  it('checks user, packaged resources, app, and repo config locations', () => {
    Object.defineProperty(process, 'resourcesPath', {
      value: '/installed/resources',
      configurable: true,
    });

    expect(getAzureSpeechCandidateConfigPaths()).toEqual([
      join(mocks.userDataPath, 'azure-speech.json'),
      join('/installed/resources', 'resources', 'azure-speech.json'),
      join(mocks.appPath, 'resources', 'azure-speech.json'),
      join(mocks.cwdPath, 'resources', 'azure-speech.json'),
    ]);
  });

  it('reads release-provided env config without a file', async () => {
    process.env.CLAWX_AZURE_SPEECH_REGION = 'eastus';
    process.env.CLAWX_AZURE_SPEECH_API_KEY = 'azure-test-key';
    process.env.CLAWX_AZURE_SPEECH_LOCALE = 'en-TT';

    await expect(resolveAzureSpeechSeedConfig()).resolves.toEqual({
      region: 'eastus',
      apiKey: 'azure-test-key',
      locale: 'en-TT',
    });
  });

  it('reads a packaged config with a sibling key file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clawx-azure-speech-seed-'));
    try {
      const configPath = join(dir, 'azure-speech.json');
      const keyPath = join(dir, 'azure-speech.key');
      await writeFile(keyPath, 'azure-key-from-file\n', 'utf-8');
      await writeFile(configPath, JSON.stringify({
        enabled: true,
        region: 'southcentralus',
        apiKeyFile: 'azure-speech.key',
        locale: 'en-TT',
      }), 'utf-8');

      process.env.CLAWX_AZURE_SPEECH_CONFIG = configPath;

      await expect(resolveAzureSpeechSeedConfig()).resolves.toEqual({
        region: 'southcentralus',
        apiKey: 'azure-key-from-file',
        locale: 'en-TT',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('prefers packaged resources seed config when user config is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clawx-azure-speech-packaged-seed-'));
    try {
      const resourcesPath = join(dir, 'installed-resources');
      const seedDir = join(resourcesPath, 'resources');
      await mkdir(seedDir, { recursive: true });
      await writeFile(join(seedDir, 'azure-speech.key'), 'packaged-key', 'utf-8');
      await writeFile(join(seedDir, 'azure-speech.json'), JSON.stringify({
        enabled: true,
        region: 'eastus2',
        apiKeyFile: 'azure-speech.key',
      }), 'utf-8');
      Object.defineProperty(process, 'resourcesPath', {
        value: resourcesPath,
        configurable: true,
      });

      await expect(resolveAzureSpeechSeedConfig()).resolves.toEqual({
        region: 'eastus2',
        apiKey: 'packaged-key',
        locale: 'en-TT',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('treats disabled or incomplete release configs as absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clawx-azure-speech-seed-'));
    try {
      const disabled = join(dir, 'disabled.json');
      const incomplete = join(dir, 'incomplete.json');
      await writeFile(disabled, JSON.stringify({
        enabled: false,
        region: 'eastus',
        apiKey: 'azure-key',
      }), 'utf-8');
      await writeFile(incomplete, JSON.stringify({
        enabled: true,
        region: 'eastus',
      }), 'utf-8');

      process.env.CLAWX_AZURE_SPEECH_CONFIG = disabled;
      await expect(resolveAzureSpeechSeedConfig()).resolves.toBeNull();

      process.env.CLAWX_AZURE_SPEECH_CONFIG = incomplete;
      await expect(resolveAzureSpeechSeedConfig()).resolves.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves relative key files from the config directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clawx-azure-speech-seed-'));
    try {
      await mkdir(join(dir, 'secrets'));
      const configPath = join(dir, 'azure-speech.json');
      await writeFile(join(dir, 'secrets', 'speech.key'), 'nested-key', 'utf-8');
      await writeFile(configPath, JSON.stringify({
        region: 'eastus',
        apiKeyFile: 'secrets/speech.key',
      }), 'utf-8');

      process.env.CLAWX_AZURE_SPEECH_CONFIG = configPath;

      await expect(resolveAzureSpeechSeedConfig()).resolves.toEqual({
        region: 'eastus',
        apiKey: 'nested-key',
        locale: 'en-TT',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
