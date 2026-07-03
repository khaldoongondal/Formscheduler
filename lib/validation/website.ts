const WEBSITE_VALUE_PATTERN =
  /^(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[/?#][^\s]*)?$/i;

export const websiteValidationMessage = "Please enter a website like company.com.";

export function normalizeWebsiteValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function isValidWebsiteValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.includes("..")) {
    return false;
  }

  return WEBSITE_VALUE_PATTERN.test(trimmed);
}
