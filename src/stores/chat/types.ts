/** Metadata for locally-attached files (not from Gateway) */
export interface AttachedFileMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
  filePath?: string;
  source?: 'user-upload' | 'tool-result' | 'message-ref' | 'gateway-media';
  /**
   * For Gateway-injected outgoing media (assistant-media). The Gateway emits
   * an `image` content block with a relative URL like
   * `/api/chat/media/outgoing/<sessionKey>/<attachmentId>/full`. The renderer
   * cannot reach Gateway HTTP directly (CORS / env drift), so this URL is
   * resolved through the Main-process proxy in `media:getThumbnails`, which
   * looks up `~/.openclaw/media/outgoing/records/<attachmentId>.json` and
   * loads the original file off disk.
   */
  gatewayUrl?: string;
}

/** Raw message from OpenClaw chat.history */
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  stopReason?: string;
  stop_reason?: string;
  errorMessage?: string;
  error_message?: string;
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
}

/** Content block inside a message */
export interface ContentBlock {
  type: 'text' | 'image' | 'thinking' | 'tool_use' | 'tool_result' | 'toolCall' | 'toolResult';
  text?: string;
  thinking?: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  /** Flat image format from Gateway tool results (no source wrapper) */
  data?: string;
  mimeType?: string;
  /**
   * Flat URL on an `image` block. Gateway-injected assistant-media messages
   * use this shape: `{ type:'image', url:'/api/chat/media/outgoing/...', mimeType, width, height, alt, openUrl }`.
   * Neither nested `source.url` nor flat `data` is set in that case; the
   * renderer must read `block.url` directly to surface the artifact.
   */
  url?: string;
  /** Optional companion of `url` — points at a higher-resolution variant. */
  openUrl?: string;
  /** Pixel width of the original image, used for layout hints. */
  width?: number;
  /** Pixel height of the original image, used for layout hints. */
  height?: number;
  /** Human-readable filename / alt text emitted by the Gateway. */
  alt?: string;
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
}

/** Session from sessions.list */
export interface ChatSession {
  key: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  thinkingLevel?: string;
  model?: string;
  updatedAt?: number;
}

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  summary?: string;
  updatedAt: number;
}

export interface ChatState {
  // Messages
  messages: RawMessage[];
  loading: boolean;
  loadingMoreHistory: boolean;
  hasMoreHistory: boolean;
  error: string | null;
  runError: string | null;

  // Streaming
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  /** Images collected from tool results, attached to the next assistant message */
  pendingToolImages: AttachedFileMeta[];

  // ── Send-time channel degradation ──────────────────────────────
  // See `src/lib/channel-degrade.ts` and `docs/OFFLINE_ARCHITECTURE.md` §3.1.
  /**
   * Text + attachments of the in-flight turn, kept only so a turn that failed
   * for network reasons can be replayed on-device. Cleared on success.
   */
  lastSentPayload: {
    text: string;
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      fileSize: number;
      stagedPath: string;
      preview: string | null;
    }>;
    targetAgentId?: string | null;
    /**
     * Run-ownership token (CLWX-94). The monotonic send-generation that created
     * this payload. A terminal event only clears the payload when it belongs to
     * the generation that still owns it, so a superseded run cannot wipe a newer
     * send's replayable payload.
     */
    generation?: number;
  } | null;
  /**
   * Set once we have already moved this turn onto the on-device channel.
   * Prevents a failing cloud and a failing local runtime from ping-ponging.
   */
  degradedThisTurn: boolean;
  /**
   * User-facing notice that the turn moved channels, or null. Anonymised per
   * the hard rules: channel vocabulary only, never a model id.
   *
   * `to` is which direction the notice concerns:
   *  - 'on-device': the runtime auto-degraded a failed cloud turn onto the
   *    on-device channel (data stays local — always safe). `resent` says
   *    whether the turn was replayed.
   *  - 'online': a dead on-device turn. Nothing moved — sending on-device data
   *    to the cloud stays the principal's explicit choice — so the notice is an
   *    actionable prompt to switch to Online. `resent` is always false here.
   */
  degradeNotice:
    | {
        reason: 'unreachable' | 'rate-limited';
        resent: boolean;
        to: 'online' | 'on-device';
        /**
         * On-device direction only, and only ever set to `false`: the four
         * config stores moved but the gateway did not acknowledge the session
         * cutover, so the next send may still run on the channel that just
         * failed. The copy then says the switch could not be made rather than
         * claiming one that did not happen. Absent means "confirmed".
         */
        cutoverConfirmed?: boolean;
      }
    | null;

  // Sessions
  sessions: ChatSession[];
  currentSessionKey: string;
  currentAgentId: string;
  /** First user message text per session key, used as display label */
  sessionLabels: Record<string, string>;
  /** Last message timestamp (ms) per session key, used for sorting */
  sessionLastActivity: Record<string, number>;

  // Thinking
  thinkingLevel: string | null;

  // Actions
  loadSessions: () => Promise<void>;
  switchSession: (key: string) => void;
  newSession: () => void;
  deleteSession: (key: string) => Promise<void>;
  renameSession: (key: string, label: string) => Promise<void>;
  cleanupEmptySession: () => void;
  loadHistory: (quiet?: boolean) => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  sendMessage: (
    text: string,
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      fileSize: number;
      stagedPath: string;
      preview: string | null;
    }>,
    targetAgentId?: string | null,
  ) => Promise<void>;
  abortRun: () => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  refresh: () => Promise<void>;
  clearError: () => void;
  /** Dismiss the "moved to on-device" notice. */
  clearDegradeNotice: () => void;
  /**
   * Drop any session-level model pin so this session follows the configured
   * channel again. Call it whenever the principal picks a channel explicitly:
   * a send-time degrade pins the session (that is how the cutover is made to
   * take effect immediately), and a session pin OUTRANKS the config default, so
   * without this the toggle would move the four stores and change nothing the
   * principal can see. Resolves false when the gateway did not accept the clear.
   */
  clearSessionModelPin: (sessionKey?: string) => Promise<boolean>;
}

export const DEFAULT_CANONICAL_PREFIX = 'agent:main';
export const DEFAULT_SESSION_KEY = `${DEFAULT_CANONICAL_PREFIX}:main`;
