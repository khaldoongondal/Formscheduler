/**
 * Calendly API calls (P3.7). The token travels only in the Authorization
 * header. Every uri given to a call is checked against its pattern before any
 * request, so a uri sent by a browser can never send the token elsewhere.
 */
import {
  CALENDLY_API_BASE,
  EVENT_URI_PATTERN,
  INVITEE_URI_PATTERN,
  ORGANIZATION_URI_PATTERN,
  USER_URI_PATTERN,
  WEBHOOK_SUBSCRIPTION_URI_PATTERN
} from "@/lib/calendly/constants";
import {
  parseCurrentUser,
  parseEventResource,
  parseEventTypes,
  parseInviteeResource,
  parseSubscription,
  parseSubscriptions,
  type CalendlyEvent,
  type CalendlyEventType,
  type CalendlyInvitee,
  type CalendlySubscription,
  type CalendlyUser
} from "@/lib/calendly/mapping";
import { providerRequest } from "@/lib/connections/http";

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function checked(uri: string, pattern: RegExp): string {
  if (typeof uri !== "string" || !pattern.test(uri)) throw new Error("calendly_invalid_uri");
  return uri;
}

export async function getCurrentUser(token: string): Promise<CalendlyUser> {
  const { body } = await providerRequest({ provider: "calendly", url: `${CALENDLY_API_BASE}/users/me`, headers: auth(token) });
  const user = parseCurrentUser(body);
  if (!user) throw new Error("calendly_user_invalid_response");
  return user;
}

export async function listEventTypes(token: string, userUri: string): Promise<CalendlyEventType[]> {
  const url = new URL(`${CALENDLY_API_BASE}/event_types`);
  url.searchParams.set("user", checked(userUri, USER_URI_PATTERN));
  url.searchParams.set("active", "true");
  url.searchParams.set("count", "100");
  const { body } = await providerRequest({ provider: "calendly", url: url.toString(), headers: auth(token) });
  return parseEventTypes(body).filter((eventType) => eventType.active);
}

export async function getInvitee(token: string, uri: string): Promise<CalendlyInvitee | null> {
  const { body } = await providerRequest({ provider: "calendly", url: checked(uri, INVITEE_URI_PATTERN), headers: auth(token) });
  return parseInviteeResource(body);
}

export async function getEvent(token: string, uri: string): Promise<CalendlyEvent | null> {
  const { body } = await providerRequest({ provider: "calendly", url: checked(uri, EVENT_URI_PATTERN), headers: auth(token) });
  return parseEventResource(body);
}

export async function createWebhookSubscription(
  token: string,
  input: { url: string; organization: string; user: string; signingKey: string }
): Promise<CalendlySubscription> {
  const { body } = await providerRequest({
    provider: "calendly",
    url: `${CALENDLY_API_BASE}/webhook_subscriptions`,
    method: "POST",
    headers: auth(token),
    json: {
      url: input.url,
      events: ["invitee.created", "invitee.canceled"],
      organization: checked(input.organization, ORGANIZATION_URI_PATTERN),
      user: checked(input.user, USER_URI_PATTERN),
      scope: "user",
      signing_key: input.signingKey
    }
  });
  const subscription = parseSubscription(body);
  if (!subscription) throw new Error("calendly_subscription_invalid_response");
  return subscription;
}

export async function listWebhookSubscriptions(token: string, input: { organization: string; user: string }): Promise<CalendlySubscription[]> {
  const url = new URL(`${CALENDLY_API_BASE}/webhook_subscriptions`);
  url.searchParams.set("organization", checked(input.organization, ORGANIZATION_URI_PATTERN));
  url.searchParams.set("user", checked(input.user, USER_URI_PATTERN));
  url.searchParams.set("scope", "user");
  url.searchParams.set("count", "100");
  const { body } = await providerRequest({ provider: "calendly", url: url.toString(), headers: auth(token) });
  return parseSubscriptions(body);
}

export async function deleteWebhookSubscription(token: string, uri: string): Promise<void> {
  await providerRequest({
    provider: "calendly",
    url: checked(uri, WEBHOOK_SUBSCRIPTION_URI_PATTERN),
    method: "DELETE",
    headers: auth(token)
  });
}
