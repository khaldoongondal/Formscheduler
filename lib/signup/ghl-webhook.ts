/**
 * Posts a JSON payload to a GoHighLevel inbound webhook. GoHighLevel workflows
 * then send the branded email (signup verification, password reset).
 * The payload holds personal data and a sign-in link, so it is never logged.
 */
const WEBHOOK_TIMEOUT_MS = 8000;

export async function postGhlWebhook(url: string, payload: Record<string, string>): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`GoHighLevel webhook returned status ${response.status}.`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("GoHighLevel webhook timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
