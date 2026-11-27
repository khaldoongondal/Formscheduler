import { z } from "zod";

export const browserTrackingFields = {
  meta_pixel_id: { label: "Meta Pixel ID", example: "123456789012345", pattern: /^[0-9]{5,20}$/ },
  gtm_container_id: { label: "Google Tag Manager container ID", example: "GTM-ABC1234", pattern: /^GTM-[A-Z0-9]{1,32}$/ },
  ga4_measurement_id: { label: "Google Analytics 4 measurement ID", example: "G-ABC1234567", pattern: /^G-[A-Z0-9]{1,32}$/ },
  clarity_project_id: { label: "Microsoft Clarity project ID", example: "abc123def4", pattern: /^[a-zA-Z0-9]{1,40}$/ }
} as const;

function optionalId(field: keyof typeof browserTrackingFields) {
  const { label, example, pattern } = browserTrackingFields[field];
  return z.string().trim().regex(pattern, `Enter a valid ${label}, such as ${example}.`).optional();
}

export const browserTrackingSettingsSchema = z.object({
  meta_pixel_id: optionalId("meta_pixel_id"),
  gtm_container_id: optionalId("gtm_container_id"),
  ga4_measurement_id: optionalId("ga4_measurement_id"),
  clarity_project_id: optionalId("clarity_project_id")
}).strict();

export type BrowserTrackingSettings = z.infer<typeof browserTrackingSettingsSchema>;

/** Old rows and invalid settings never enable third-party scripts. */
export function readBrowserTrackingSettings(value: unknown): BrowserTrackingSettings {
  const result = browserTrackingSettingsSchema.safeParse(value);
  return result.success ? result.data : {};
}

export function browserTrackingFromForm(formData: FormData): BrowserTrackingSettings {
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(browserTrackingFields)) {
    const value = formData.get(`browser_${key}`);
    if (typeof value === "string" && !value.trim()) continue;
    if (value !== null) values[key] = value;
  }
  return browserTrackingSettingsSchema.parse(values);
}
