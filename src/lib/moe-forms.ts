export interface MoeFormUrls {
  dailyReport?: string;
  suspension?: string;
}

const ALLOWED_FORMS_HOSTS = new Set(['forms.office.com', 'forms.cloud.microsoft']);
const FORM_RESPONSE_PATHS = [/^\/Pages\/ResponsePage\.aspx$/i, /^\/r\/[A-Za-z0-9_-]+$/i];

export function isAllowedMoEFormsUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return false;
    if (!ALLOWED_FORMS_HOSTS.has(url.hostname.toLowerCase())) return false;
    return FORM_RESPONSE_PATHS.some((pattern) => pattern.test(url.pathname));
  } catch {
    return false;
  }
}

export function validateMoEFormUrls(urls: MoeFormUrls): string[] {
  const errors: string[] = [];
  if (!isAllowedMoEFormsUrl(urls.dailyReport ?? '')) {
    errors.push('Daily Report link must be a Microsoft Forms response link.');
  }
  if (!isAllowedMoEFormsUrl(urls.suspension ?? '')) {
    errors.push('Suspension link must be a Microsoft Forms response link.');
  }
  return errors;
}
