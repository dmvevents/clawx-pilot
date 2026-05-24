/**
 * Public type contract for the v2 Outlook integration.
 *
 * Same shape as v1 (../outlook-browser/types.ts) so v2 is a drop-in for the
 * IPC handlers and the host-API routes — no caller changes required when we
 * flip CLAWX_OUTLOOK_V2=1.
 *
 * The send-protection model is stronger than v1 but the public surface is
 * identical: sendEmail with confirm=true triggers the verified-send flow,
 * not a re-draft + naive click.
 */
export type {
  OutlookOpenStatus,
  OutlookOpenResult,
  InboxMessage,
  ReadInboxResult,
  DraftEmailArgs,
  DraftEmailResult,
  SendEmailArgs,
  SendEmailResult,
  SearchInboxArgs,
  SearchInboxResult,
  ReadEmailArgs,
  ReadEmailResult,
  EmailAttachmentInfo,
  ReplyArgs,
  ReplyResult,
  ForwardArgs,
  ForwardResult,
  MarkReadArgs,
  MarkReadResult,
  ListAttachmentsArgs,
  ListAttachmentsResult,
  DownloadAttachmentArgs,
  DownloadAttachmentResult,
} from '../outlook-browser/types';
