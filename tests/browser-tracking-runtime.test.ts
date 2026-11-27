import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { startBrowserTracking } from "@/components/booking/browser-tracking";
import { postMetaEvents } from "@/components/booking/meta-bridge";
import { toClientEvents } from "@/lib/meta/client-events";
import { consentedGaClientId, forgetGaClientId, readBrowserAttribution } from "@/lib/tracking/attribution";

const settings = {
  meta_pixel_id: "1234567890", gtm_container_id: "GTM-EXAMPLE",
  ga4_measurement_id: "G-EXAMPLE", clarity_project_id: "example"
};
const attribution = { utm_source: "google", utm_campaign: "Fall Painting 2026", gclid: "click-test001" };
const html = readFileSync("public/embed/formbook-tracking/frame.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];

function sandbox(origin = "null") {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const loaded: string[] = [];
  const window = {
    origin, parent: {}, addEventListener: listeners.set.bind(listeners), removeEventListener: listeners.delete.bind(listeners)
  };
  const document = {
    createElement: () => ({}),
    head: { appendChild: (element: { src: string }) => loaded.push(element.src) }
  };
  const navigator = { cookieEnabled: true };
  runInNewContext(script, {
    window, document, navigator, URL, location: { href: "https://example.test/embed/formbook-tracking/frame.html" }
  });
  const port = { onmessage: (_: { data: object }) => {}, postMessage: (_: unknown) => {} };
  const env = window as typeof window & {
    dataLayer: Array<Record<string, unknown>>;
    formbookGoogle: Array<ArrayLike<unknown>>;
    clarity: { q: Array<ArrayLike<unknown>> };
    fbq: { queue: Array<ArrayLike<unknown>> };
  };
  return {
    env, loaded, navigator,
    init(source = window.parent) {
      listeners.get("message")?.({ source, data: { type: "formbook:init", mode: "embed", formId: "public-form", settings, attribution, gaClientId: "123.456" }, ports: [port] });
    },
    send(data: object) { port.onmessage({ data }); }
  };
}

test("tag bootstrap requires an opaque sandbox and a parent-issued port", () => {
  const direct = sandbox("https://example.test");
  direct.init();
  assert.deepEqual(direct.loaded, []);
  const frame = sandbox();
  frame.init({});
  assert.deepEqual(frame.loaded, []);
  frame.init();
  assert.equal(frame.loaded.length, 3);
  frame.init();
  assert.equal(frame.loaded.length, 3);
});

test("isolated vendors receive only named lifecycle events and the explicit Pixel ID", () => {
  const frame = sandbox();
  frame.init();
  frame.send({ type: "event", name: "step_view", step: 3, email: "discard@example.test" });
  frame.send({ type: "event", name: "booked_call" });
  frame.send({ type: "event", name: "unknown" });
  assert.deepEqual(Array.from(frame.env.dataLayer, (row) => row.event), ["gtm.js", "formbook_step_view", "formbook_booked_call"]);
  assert.equal(frame.env.dataLayer[1].formbook_step, 3);
  assert.equal(frame.env.dataLayer[1].gclid, attribution.gclid);
  const google = Array.from(frame.env.formbookGoogle, (args) => Array.from(args));
  assert.equal(google[1][0], "config");
  const config = google[1][2] as Record<string, unknown>;
  assert.equal(config.send_page_view, false);
  assert.equal(config.client_id, "123.456");
  assert.equal(config.campaign_source, "google");
  assert.equal(config.campaign_name, attribution.utm_campaign);
  assert.equal(config.page_location, "https://example.test/embed/public-form?gclid=click-test001");
  assert.equal(google[3][1], "formbook_booked_call");
  assert.ok(!JSON.stringify([frame.env.dataLayer, google, frame.env.clarity.q]).includes("discard@"));
  assert.ok(!frame.loaded.some((url) => url.includes("facebook.net")));
  assert.equal(frame.navigator.cookieEnabled, false);
  const consent = frame.env.clarity.q[0][1] as Record<string, unknown>;
  assert.equal(consent.ad_Storage, "denied");
  assert.equal(consent.analytics_Storage, "denied");
  assert.ok(!JSON.stringify(frame.env.clarity.q).includes("click-test001"));
  frame.send({ type: "pixel", standard: true, name: "Schedule", id: "fbk1.booked_call.opaque_ref" });
  frame.send({ type: "pixel", standard: false, name: "FormStart", id: "fbk1.form_start.opaque_ref" });
  assert.equal(frame.loaded.filter((url) => url.includes("facebook.net")).length, 1);
  const pixel = Array.from(frame.env.fbq.queue, (args) => Array.from(args));
  assert.equal(pixel[2][0], "trackSingle");
  assert.equal(pixel[2][1], settings.meta_pixel_id);
  assert.equal((pixel[2][4] as { eventID: string }).eventID, "fbk1.booked_call.opaque_ref");
  assert.equal(pixel[3][0], "trackSingleCustom");
});

test("published parent queues events before frame load, deduplicates and stops on withdrawal", async (t) => {
  const listeners = new Map<string, () => void>();
  const ports: MessagePort[] = [];
  let removed = false;
  const frame = {
    setAttribute: (_key: string, _value: string) => {},
    addEventListener: listeners.set.bind(listeners),
    contentWindow: { postMessage: (_message: object, _origin: string, transfer: MessagePort[]) => ports.push(...transfer) },
    remove: () => { removed = true; }
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { search: "" } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => frame, body: { appendChild() {} } } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  for (const coupled of [true, false]) {
    const tracker = startBrowserTracking(settings, "form", "full", coupled, new Set(), "page_ref_123");
    tracker.track("lead");
    tracker.track("lead");
    const approved = { event_name: "Lead", event_id: "fbk1.lead.approved_ref_123", browser_dataset_id: settings.meta_pixel_id };
    tracker.trackServerPixel([{ ...approved, browser_dataset_id: "777777777" }, { ...approved, browser_dataset_id: undefined }]);
    tracker.trackServerPixel([approved, approved]);
    listeners.get("load")!();
    const messages: Array<{ type: string; id?: string }> = [];
    const received = new Promise<void>((resolve) => {
      ports.at(-1)!.onmessage = ({ data }) => {
        messages.push(data);
        if (data.name === "booked_call") resolve();
      };
    });
    tracker.track("booked_call");
    await received;
    tracker.stop();
    tracker.track("step_view", 3);
    assert.ok(removed);
    assert.deepEqual(messages.map((row) => row.type), ["event", "pixel", "event"]);
    assert.equal(messages[1].id, coupled ? "fbk1.lead.approved_ref_123" : "fbk1.lead.page_ref_123");
  }
});

test("host and embedded landing queries forward only bounded ad campaign fields", () => {
  const query = new URLSearchParams({
    landing_page_url: "https://store.example/contact?gclid=currentClick001&wbraid=currentBraid002&email=private@example.test&utm_campaign=Fall+Painting+2026",
    gclid: "GCL.1700000000.oldCookieClick", utm_campaignid: "1234567890", utm_medium: "cpc", utm_content: "someone@example.test",
    utm_term: "555 123 4567", utm_source: "https://private.example", token: "privatevalue", lead_session_id: "privatevalue"
  });
  assert.deepEqual(readBrowserAttribution(query.toString()), {
    utm_campaign: "Fall Painting 2026", utm_id: "1234567890", utm_medium: "cpc", gclid: "currentClick001", wbraid: "currentBraid002"
  });
  assert.deepEqual(readBrowserAttribution("?gclid=GCL.1700000000.trackedClick&utm_campaign=" + "a".repeat(81)), { gclid: "trackedClick" });
  assert.deepEqual(readBrowserAttribution("?utm_source=google&utm_campaign=paint-sale&gbraid=abc009876"), {
    utm_source: "google", utm_campaign: "paint-sale", gbraid: "abc009876"
  });
});

test("GA4 browser identity is scoped to one form and renewed after explicit withdrawal", (t) => {
  const values = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const location = { localStorage: { getItem: values.get.bind(values), setItem: values.set.bind(values), removeItem: values.delete.bind(values) } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: location });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const first = consentedGaClientId("one");
  assert.equal(consentedGaClientId("one"), first);
  const other = consentedGaClientId("two");
  assert.notEqual(first, other);
  forgetGaClientId("one");
  assert.equal(values.size, 1);
  assert.notEqual(consentedGaClientId("one"), first);
  assert.equal(consentedGaClientId("two"), other);
  Object.defineProperty(location, "localStorage", { get() { throw Error("blocked"); } });
  assert.match(consentedGaClientId("one"), /^\d+\.\d+$/);
  assert.doesNotThrow(() => forgetGaClientId("one"));
});

test("the public response binds eligible events to their dataset and the embedding bridge retains its contract", (t) => {
  const pending = { id: "queue", eventName: "Lead", eventId: "fbk1.lead.opaque_local", browserDatasetId: settings.meta_pixel_id };
  const events = toClientEvents([{ ...pending, status: "pending" }, { ...pending, status: "held" }]);
  assert.deepEqual(events, [{ event_name: "Lead", event_id: pending.eventId, browser_dataset_id: settings.meta_pixel_id }]);
  const messages: unknown[] = [];
  const target = { postMessage: (message: unknown) => messages.push(message) };
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { parent: target, opener: target, self: {} } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  postMetaEvents(events);
  const legacy = { type: "formbook:meta-event", event_name: "Lead", event_id: pending.eventId };
  assert.deepEqual(messages, [legacy, legacy]);
});
