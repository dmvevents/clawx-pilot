/**
 * Preload Script
 * Exposes safe APIs to the renderer process via contextBridge
 */
import { contextBridge, ipcRenderer } from 'electron';

/**
 * IPC renderer methods exposed to the renderer process
 */
const electronAPI = {
  /**
   * IPC invoke (request-response pattern)
   */
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      const validChannels = [
        // Gateway
        'gateway:status',
        'gateway:isConnected',
        'gateway:start',
        'gateway:stop',
        'gateway:restart',
        'gateway:rpc',
        'gateway:httpProxy',
        'hostapi:fetch',
        'hostapi:token',
        'gateway:health',
        'gateway:getControlUiUrl',
        // OpenClaw
        'openclaw:status',
        'openclaw:isReady',
        // Shell
        'shell:openExternal',
        'shell:showItemInFolder',
        'shell:openPath',
        // Dialog
        'dialog:open',
        'dialog:save',
        'dialog:message',
        // App
        'app:version',
        'app:name',
        'app:getPath',
        'app:platform',
        'app:quit',
        'app:relaunch',
        'app:request',
        // Window controls
        'window:minimize',
        'window:maximize',
        'window:close',
        'window:isMaximized',
        // Settings
        'settings:get',
        'settings:set',
        'settings:setMany',
        'settings:getAll',
        'settings:reset',
        'usage:recentTokenHistory',
        // Update
        'update:status',
        'update:version',
        'update:check',
        'update:download',
        'update:install',
        'update:setChannel',
        'update:setAutoDownload',
        'update:cancelAutoInstall',
        // Env
        'env:getConfig',
        'env:setApiKey',
        'env:deleteApiKey',
        // Provider
        'provider:list',
        'provider:get',
        'provider:save',
        'provider:delete',
        'provider:setApiKey',
        'provider:updateWithKey',
        'provider:deleteApiKey',
        'provider:hasApiKey',
        'provider:getApiKey',
        'provider:setDefault',
        'provider:getDefault',
        'provider:validateKey',
        'provider:requestOAuth',
        'provider:cancelOAuth',
        // Cron
        'cron:list',
        'cron:create',
        'cron:update',
        'cron:delete',
        'cron:toggle',
        'cron:trigger',
        // Channel Config
        'channel:saveConfig',
        'channel:getConfig',
        'channel:getFormValues',
        'channel:deleteConfig',
        'channel:listConfigured',
        'channel:setEnabled',
        'channel:validate',
        'channel:validateCredentials',
        // WhatsApp
        'channel:requestWhatsAppQr',
        'channel:cancelWhatsAppQr',
        // ClawHub
        'clawhub:search',
        'clawhub:install',
        'clawhub:uninstall',
        'clawhub:list',
        'clawhub:openSkillReadme',
        // UV
        'uv:check',
        'uv:install-all',
        // Skill config (direct file access)
        'skill:updateConfig',
        'skill:getConfig',
        'skill:getAllConfigs',
        // Logs
        'log:getRecent',
        'log:readFile',
        'log:getFilePath',
        'log:getDir',
        'log:listFiles',
        // File staging & media
        'file:stage',
        'file:stageBuffer',
        'media:getThumbnails',
        'media:saveImage',
        // File preview (sandboxed read/write/list/tree)
        'file:readText',
        'file:readBinary',
        'file:writeText',
        'file:stat',
        'file:listDir',
        'file:listTree',
        // Chat send with media (reads staged files in main process)
        'chat:sendWithMedia',
        // Session management
        'session:delete',
        'session:rename',
        // OpenClaw extras
        'openclaw:getDir',
        'openclaw:getConfigDir',
        'openclaw:getSkillsDir',
        'openclaw:getCliCommand',
        // Microsoft Graph (Outlook) capability
        'msgraph:status',
        'msgraph:get-config',
        'msgraph:set-config',
        'msgraph:sign-in',
        'msgraph:sign-out',
        'msgraph:submit-manual-code',
        'msgraph:set-mock-mailbox',
        'msgraph:rpc',
        // MoE form-filler (Microsoft Forms automation)
        'moeforms:status',
        'moeforms:get-urls',
        'moeforms:set-urls',
        'moeforms:start',
        'moeforms:resume',
        'moeforms:confirm',
        'moeforms:cancel',
        // Outlook (browser-session) — drives Outlook Web in the user's Chrome
        'outlook:open',
        'outlook:readInbox',
        'outlook:draft',
        'outlook:send',
        // ASR (microphone capture → main process)
        'asr:saveBlob',
        'asr:transcribe',
        'asr:transcribe-stream',
        // Azure Speech (optional cloud fallback ASR)
        'azure-speech:get-config',
        'azure-speech:set-config',
        'azure-speech:test',
        // MoE seed (cron + form URLs)
        'moe:seed-cron',
        'moe:set-form-urls',
      ];

      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }

      throw new Error(`Invalid IPC channel: ${channel}`);
    },

    /**
     * Listen for events from main process
     */
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      const validChannels = [
        'gateway:status-changed',
        'gateway:message',
        'gateway:notification',
        'gateway:health-changed',
        'gateway:presence-changed',
        'gateway:channel-status',
        'gateway:chat-message',
        'channel:whatsapp-qr',
        'channel:whatsapp-success',
        'channel:whatsapp-error',
        'channel:wechat-qr',
        'channel:wechat-success',
        'channel:wechat-error',
        'gateway:exit',
        'gateway:error',
        'navigate',
        'update:status-changed',
        'update:checking',
        'update:available',
        'update:not-available',
        'update:progress',
        'update:downloaded',
        'update:error',
        'update:auto-install-countdown',
        'cron:updated',
        'oauth:code',
        'oauth:success',
        'oauth:error',
        'openclaw:cli-installed',
        // Microsoft Graph (Outlook) capability
        'msgraph:code',
        'msgraph:signed-in',
        'msgraph:signed-out',
        'msgraph:error',
        // MoE form-filler
        'moeforms:status',
        // ASR streaming partials (Azure Speech path)
        'asr:transcribe-partial',
      ];

      if (validChannels.includes(channel) || channel.startsWith('ext:')) {
        const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
          callback(...args);
        };
        ipcRenderer.on(channel, subscription);

        // Return unsubscribe function
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }

      throw new Error(`Invalid IPC channel: ${channel}`);
    },

    /**
     * Listen for a single event from main process
     */
    once: (channel: string, callback: (...args: unknown[]) => void) => {
      const validChannels = [
        'gateway:status-changed',
        'gateway:message',
        'gateway:notification',
        'gateway:health-changed',
        'gateway:presence-changed',
        'gateway:channel-status',
        'gateway:chat-message',
        'channel:whatsapp-qr',
        'channel:whatsapp-success',
        'channel:whatsapp-error',
        'channel:wechat-qr',
        'channel:wechat-success',
        'channel:wechat-error',
        'gateway:exit',
        'gateway:error',
        'navigate',
        'update:status-changed',
        'update:checking',
        'update:available',
        'update:not-available',
        'update:progress',
        'update:downloaded',
        'update:error',
        'update:auto-install-countdown',
        'oauth:code',
        'oauth:success',
        'oauth:error',
        // Microsoft Graph (Outlook) capability
        'msgraph:code',
        'msgraph:signed-in',
        'msgraph:signed-out',
        'msgraph:error',
      ];

      if (validChannels.includes(channel) || channel.startsWith('ext:')) {
        ipcRenderer.once(channel, (_event, ...args) => callback(...args));
        return;
      }

      throw new Error(`Invalid IPC channel: ${channel}`);
    },

    /**
     * Remove all listeners for a channel
     */
    off: (channel: string, callback?: (...args: unknown[]) => void) => {
      if (callback) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ipcRenderer.removeListener(channel, callback as any);
      } else {
        ipcRenderer.removeAllListeners(channel);
      }
    },
  },

  /**
   * Open external URL in default browser
   */
  openExternal: (url: string) => {
    return ipcRenderer.invoke('shell:openExternal', url);
  },

  /**
   * Outlook (browser-session) facade.
   *
   * Thin pass-through to the main-process OutlookBrowserManager via IPC.
   * All four calls return { ok: true, data } on success or { ok: false, error }
   * on failure. The renderer's Settings tile uses these to verify the
   * connection; the principal-assistant plugin's outlook.* tools route
   * through the main process via the Host API and are gated by the
   * PRINCIPAL_SKILL_ALLOWLIST flag.
   *
   * Hard rules (preserved by the manager and re-asserted here):
   *   - profile is always 'user' (managed Chromium is blocked).
   *   - No password is ever stored or transmitted.
   *   - send() refuses unless { confirm: true } is set; the agent must show
   *     the draft and obtain explicit user consent before flipping the bit.
   */
  outlook: {
    open: () => ipcRenderer.invoke('outlook:open'),
    readInbox: (top?: number) => ipcRenderer.invoke('outlook:readInbox', { top }),
    draft: (args: {
      to: string | string[];
      subject: string;
      body: string;
      cc?: string | string[];
      bcc?: string | string[];
    }) => ipcRenderer.invoke('outlook:draft', args),
    send: (args: {
      to: string | string[];
      subject: string;
      body: string;
      cc?: string | string[];
      bcc?: string | string[];
      confirm: boolean;
    }) => ipcRenderer.invoke('outlook:send', args),
  },

  /**
   * Get current platform
   */
  platform: process.platform,

  /**
   * Check if running in development
   */
  isDev: process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL,
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electron', electronAPI);

// Type declarations for the renderer process
export type ElectronAPI = typeof electronAPI;
