import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { funnelCopyPayload } from "@/lib/funnels/copy-payload";
import { browserTrackingFromForm, readBrowserTrackingSettings } from "@/lib/tracking/settings";
import { updateFunnelSchema } from "@/lib/validation/funnels";

const id = "ad217ad5-8c02-4204-9b8b-82ec282daacf";
const settings = {
  meta_pixel_id: "123456789012345",
  gtm_container_id: "GTM-ABC1234",
  ga4_measurement_id: "G-ABC1234567",
  clarity_project_id: "abc123def4"
};

describe("per-form browser tracking settings", () => {
  it("round trips all four IDs through builder and API validation", () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(settings)) form.set(`browser_${key}`, ` ${value} `);
    const browser_tracking = browserTrackingFromForm(form);
    assert.deepEqual(browser_tracking, settings);
    const update = updateFunnelSchema.parse({ id, browser_tracking });
    assert.deepEqual(readBrowserTrackingSettings(update.browser_tracking), settings);
  });

  it("clears individual IDs and keeps unrelated API edits independent", () => {
    const form = new FormData();
    form.set("browser_meta_pixel_id", " ");
    form.set("browser_gtm_container_id", settings.gtm_container_id);
    assert.deepEqual(browserTrackingFromForm(form), { gtm_container_id: settings.gtm_container_id });
    assert.deepEqual(browserTrackingFromForm(new FormData()), {});
    assert.equal("browser_tracking" in updateFunnelSchema.parse({ id, name: "Edited form" }), false);
    assert.deepEqual(readBrowserTrackingSettings(null), {});
    assert.deepEqual(readBrowserTrackingSettings(undefined), {});
  });

  it("rejects invalid IDs and unknown script or URL settings at write time and on read", () => {
    for (const invalid of [
      { meta_pixel_id: "123x" }, { gtm_container_id: "GTM-ID/script" },
      { ga4_measurement_id: "UA-123456-1" }, { clarity_project_id: "https://example.com" },
      { script: "alert(1)" }, { ...settings, extra: true }
    ]) {
      assert.equal(updateFunnelSchema.safeParse({ id, browser_tracking: invalid }).success, false);
      assert.deepEqual(readBrowserTrackingSettings(invalid), {});
    }
    const form = new FormData();
    form.set("browser_meta_pixel_id", "abc");
    assert.throws(() => browserTrackingFromForm(form));
  });

  it("keeps copied forms disconnected from the source's browser tags", () => {
    const copy = funnelCopyPayload({ name: "Template", browser_tracking: settings }, "template-copy");
    assert.equal("browser_tracking" in copy, false);
  });
});
