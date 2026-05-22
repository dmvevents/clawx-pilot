/**
 * Vitest Test Setup
 * Global test configuration and mocks
 */
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Node 25+ ships an experimental built-in `localStorage`/`sessionStorage` that
// requires `--localstorage-file=<path>` to be functional; without it the globals
// exist but lack methods like `clear`/`setItem`/`removeItem`, and they shadow
// JSDOM's proper Storage on the window. Install an in-memory shim that matches
// the Web Storage API so tests get a working store regardless of Node version.
function createMemoryStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  } as Storage;
}

function installStorage(name: 'localStorage' | 'sessionStorage') {
  const target: Storage = createMemoryStorage();
  // Define on both window and globalThis so code that reads either gets the shim.
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, {
      value: target,
      writable: true,
      configurable: true,
    });
  }
  Object.defineProperty(globalThis, name, {
    value: target,
    writable: true,
    configurable: true,
  });
}

installStorage('localStorage');
installStorage('sessionStorage');

// Provide a minimal `electron` mock so tests that transitively import
// main-process code (logger, store, etc.) don't blow up when the Electron
// binary is not present (e.g. CI with ELECTRON_SKIP_BINARY_DOWNLOAD=1).
// Individual test files can override with their own vi.mock('electron', ...).
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/clawx-test'),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
    getName: vi.fn().mockReturnValue('clawx-test'),
    isPackaged: false,
    isReady: vi.fn().mockResolvedValue(true),
    on: vi.fn(),
    off: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  session: { defaultSession: { webRequest: { onBeforeSendHeaders: vi.fn() } } },
  utilityProcess: {},
}));

// Mock window.electron API
const mockElectron = {
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  },
  openExternal: vi.fn(),
  platform: 'darwin',
  isDev: true,
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electron', {
    value: mockElectron,
    writable: true,
  });
}

// Mock matchMedia
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Reset mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
