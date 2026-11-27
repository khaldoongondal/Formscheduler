import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildSeedPlan,
  deterministicUuid,
  renderRemovalSql,
  renderSeedSql,
  scaleSourceRow,
  splitByLargestRemainder,
  validateSeedConfig,
  type SeedConfig
} from "../scripts/demo-seed-plan.mjs";

const FIXTURE_PATH = path.join(process.cwd(), "tests", "fixtures", "demo-seed.sample.json");
const TENANT = "00000000-0000-0000-0000-000000000001";
const BATCH = "sample-test";

function sample(): SeedConfig {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeedConfig;
}

describe("validateSeedConfig", () => {
  it("accepts the sample", () => {
    assert.equal(validateSeedConfig(sample()), true);
  });

  it("rejects totals that do not add up", () => {
    const config = sample();
    config.expected_totals.visitors += 1;
    assert.throws(() => validateSeedConfig(config), /visitors/);
  });

  it("rejects leads above form starts", () => {
    const config = sample();
    config.periods[2].leads = config.periods[2].form_starts + 1;
    config.expected_totals.leads = config.periods.reduce((sum, period) => sum + period.leads, 0);
    assert.throws(() => validateSeedConfig(config), /more leads than form starts/);
  });

  it("rejects bookings above leads and starts above visitors", () => {
    const config = sample();
    config.periods[0].bookings = config.periods[0].leads + 1;
    config.periods[1].form_starts = config.periods[1].visitors + 1;
    assert.throws(() => validateSeedConfig(config), (error: Error) => {
      assert.match(error.message, /more bookings than leads/);
      assert.match(error.message, /more form starts than visitors/);
      return true;
    });
  });

  it("rejects unknown form keys", () => {
    const config = sample();
    config.periods[2].form = "form_z";
    assert.throws(() => validateSeedConfig(config), /unknown form "form_z"/);
  });

  it("rejects a split test arm period without split_test and bad dates", () => {
    const config = sample();
    delete config.periods[0].split_test;
    config.periods[2].start = "2026-13-01";
    assert.throws(() => validateSeedConfig(config), (error: Error) => {
      assert.match(error.message, /set split_test/);
      assert.match(error.message, /YYYY-MM-DD/);
      return true;
    });
  });
});

describe("buildSeedPlan", () => {
  it("is deterministic", () => {
    const first = buildSeedPlan(sample(), { tenantId: TENANT, batch: BATCH });
    const second = buildSeedPlan(sample(), { tenantId: TENANT, batch: BATCH });
    assert.deepEqual(first, second);
    assert.equal(renderSeedSql(first), renderSeedSql(second));
  });

  it("uses uuid shaped ids that change with the batch", () => {
    const id = deterministicUuid(BATCH, "form:form_a");
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(id, deterministicUuid("other-batch", "form:form_a"));
  });

  it("keeps the per-period counts of the config", () => {
    const config = sample();
    const plan = buildSeedPlan(config, { tenantId: TENANT, batch: BATCH });
    assert.equal(plan.visitorBatches.length, config.periods.length);
    plan.visitorBatches.forEach((batch, index) => {
      const period = config.periods[index];
      assert.equal(batch.visitors, period.visitors);
      assert.equal(batch.formStarts, period.form_starts);
      assert.equal(batch.leads, period.leads);
      assert.equal(batch.bookings, period.bookings);
      assert.equal(plan.spend[index].amountCents, period.spend_cents);
    });
    assert.equal(
      plan.spend.reduce((sum, entry) => sum + entry.amountCents, 0),
      config.expected_totals.spend_cents
    );
  });

  it("builds the split test, its members and test spend", () => {
    const plan = buildSeedPlan(sample(), { tenantId: TENANT, batch: BATCH });
    assert.equal(plan.splitTests.length, 1);
    assert.equal(plan.members.length, 2);
    assert.deepEqual(plan.members.map((member) => member.position), [1, 2]);
    const testSpend = plan.spend.filter((entry) => entry.splitTestId);
    assert.equal(testSpend.length, 2);
    for (const entry of testSpend) assert.equal(entry.periodStart, null);
    const single = plan.spend.find((entry) => !entry.splitTestId);
    assert.equal(single?.periodStart, "2026-01-01");
    assert.equal(single?.periodEnd, "2026-01-04");
  });

  it("starts arm periods no earlier than the test", () => {
    const plan = buildSeedPlan(sample(), { tenantId: TENANT, batch: BATCH });
    for (const batch of plan.visitorBatches.filter((item) => item.splitTestId)) {
      assert.equal(batch.start, "2026-01-05T05:00:00.000Z");
    }
  });

  it("uses the same step keys as the analytics flow (questions first, then one contact page)", () => {
    const plan = buildSeedPlan(sample(), { tenantId: TENANT, batch: BATCH });
    const form = plan.forms[0];
    assert.equal(form.stepKeys.page1, `question:${form.questions[0].id}`);
    assert.equal(form.stepKeys.page2, `question:${form.questions[1].id}`);
    assert.equal(form.stepKeys.contact, "contact:3:full_name,phone");
  });

  it("refuses a bad batch or tenant", () => {
    assert.throws(() => buildSeedPlan(sample(), { tenantId: TENANT, batch: "Bad Batch" }), /batch/);
    assert.throws(() => buildSeedPlan(sample(), { tenantId: "not-a-uuid", batch: BATCH }), /tenantId/);
  });
});

describe("renderSeedSql", () => {
  const sql = renderSeedSql(buildSeedPlan(sample(), { tenantId: TENANT, batch: BATCH }));

  it("is one transaction with a preflight", () => {
    assert.ok(sql.includes("begin;"));
    assert.ok(sql.includes("commit;"));
    assert.ok(sql.indexOf("begin;") < sql.indexOf("commit;"));
    assert.ok(sql.includes("Demo tenant must be on the Scaling plan"));
  });

  it("generates rows with generate_series, not one literal row per visitor", () => {
    assert.ok(sql.includes("generate_series"));
    assert.ok(sql.split("\n").length < 1000);
  });

  it("marks every demo row with the batch", () => {
    assert.ok(sql.includes(`demo_seed_batch = '${BATCH}'`));
    assert.ok(sql.includes(`'demo_seed', '${BATCH}'`));
    assert.ok(sql.includes(", 'sample-test');"));
  });

  it("uses made-up identities on example.com and the fictional phone range", () => {
    assert.ok(sql.includes("'demo+' || 'sample-test' || '-' || n.n || '@example.com'"));
    assert.ok(sql.includes("'+141655501' || lpad((n.n % 100)::text, 2, '0')"));
  });

  it("contains nothing from the private seed file", () => {
    assert.ok(!sql.includes("HVAC"));
  });

  it("starts the test from a draft so the database checks it", () => {
    assert.ok(sql.includes("'draft', 'sample-test'"));
    assert.ok(sql.includes("set status = 'running', started_at = '2026-01-05T05:00:00.000Z'"));
  });

  it("ends with a check query", () => {
    assert.ok(sql.trimEnd().endsWith("order by f.name;"));
  });
});

describe("renderRemovalSql", () => {
  it("deletes by batch only", () => {
    const sql = renderRemovalSql(BATCH);
    const deletes = sql.split("\n").filter((line) => line.startsWith("delete"));
    assert.deepEqual(deletes, [
      "delete from public.split_tests where demo_seed_batch = 'sample-test';",
      "delete from public.funnels where demo_seed_batch = 'sample-test';"
    ]);
    assert.ok(sql.includes("forms_left"));
  });

  it("refuses a batch that could inject SQL", () => {
    assert.throws(() => renderRemovalSql("x'; drop table funnels; --"));
  });
});

describe("scaling", () => {
  it("keeps rates and unit costs exact on a synthetic row", () => {
    const source = { visitors: 40, form_starts: 9, leads: 3, bookings: 2, spend_cents: 45000, cost_per_lead_cents: 15000 };
    const scaled = scaleSourceRow(source, 12.5);
    assert.equal(scaled.visitors, 500);
    // leads / visitors equals the source rate within one lead
    assert.ok(Math.abs(scaled.leads - scaled.visitors * (source.leads / source.visitors)) <= 1);
    assert.ok(Math.abs(scaled.form_starts - scaled.visitors * (source.form_starts / source.visitors)) <= 1);
    assert.ok(Math.abs(scaled.bookings - scaled.leads * (source.bookings / source.leads)) <= 1);
    assert.equal(scaled.spend_cents / scaled.leads, source.cost_per_lead_cents);
  });

  it("scales spend to whole dollars when a row has no leads", () => {
    const scaled = scaleSourceRow(
      { visitors: 10, form_starts: 2, leads: 0, bookings: 0, spend_cents: 1000, cost_per_lead_cents: null },
      3.3
    );
    assert.equal(scaled.leads, 0);
    assert.equal(scaled.spend_cents, 3300);
  });

  it("splits totals by largest remainder and always adds up", () => {
    assert.deepEqual(splitByLargestRemainder(10, [1, 1, 1]), [4, 3, 3]);
    assert.deepEqual(splitByLargestRemainder(7, [25, 28]), [3, 4]);
    for (const total of [0, 1, 17, 491]) {
      assert.equal(splitByLargestRemainder(total, [3, 5, 2]).reduce((a, b) => a + b, 0), total);
    }
  });
});

describe("seed-demo.mjs CLI", () => {
  const script = path.join(process.cwd(), "scripts", "seed-demo.mjs");

  it("prints SQL for the sample and exits 0", () => {
    const result = spawnSync(process.execPath, [script, "--config", FIXTURE_PATH, "--tenant", TENANT, "--batch", BATCH], {
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("begin;"));
    assert.equal(result.stderr, "");
  });

  it("prints removal SQL with --remove", () => {
    const result = spawnSync(process.execPath, [script, "--batch", BATCH, "--remove"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("delete from public.funnels where demo_seed_batch = 'sample-test';"));
  });

  it("fails with a message on stderr for a bad batch", () => {
    const result = spawnSync(process.execPath, [script, "--config", FIXTURE_PATH, "--tenant", TENANT, "--batch", "NO"], {
      encoding: "utf8"
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /batch/);
  });
});
