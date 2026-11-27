// Demo seed planner for FormBook. Pure ESM: no imports except node:crypto.
//
// It turns a seed config (forms, split tests and per-period target totals)
// into SQL that creates demo forms, a split test and analytics, lead and ad
// spend rows with made-up identities. It never connects to a database.
// Every demo row is marked so it can be removed with two deletes.

import { createHash } from "node:crypto";

export const BATCH_PATTERN = /^[a-z0-9-]{3,40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_SUFFIX_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const KEY_PATTERN = /^[a-z0-9_]{1,40}$/;
const COUNT_FIELDS = ["visitors", "form_starts", "leads", "bookings", "spend_cents"];
const DAY_MS = 24 * 60 * 60 * 1000;

const FIRST_NAMES = [
  "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Parker",
  "Drew", "Reese", "Rowan", "Skyler", "Emerson", "Hayden", "Sawyer", "Logan", "Kendall", "Blake"
];
const LAST_NAMES = [
  "Sample", "Example", "Tester", "Demo", "Placeholder", "Mockford", "Fictus", "Madeup", "Testwell", "Pretend",
  "Notreal", "Specimen", "Dummy", "Prototype", "Template", "Stand", "Model", "Pilot", "Trial", "Draft"
];

const QUESTIONS = [
  {
    key: "q1",
    label: "Do you run a home services business?",
    options: [
      { key: "yes", label: "Yes" },
      { key: "no", label: "No" }
    ]
  },
  {
    key: "q2",
    label: "How many calls do you want a week?",
    options: [
      { key: "under_10", label: "Fewer than 10" },
      { key: "10_plus", label: "10 or more" }
    ]
  }
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

/** Throws one Error listing every problem in the config. */
export function validateSeedConfig(config) {
  const problems = [];
  if (!isPlainObject(config)) throw new Error("Seed config must be a JSON object.");

  if (typeof config.label !== "string" || !config.label.trim()) problems.push("label must be a non-empty string.");
  if (config.scale !== undefined && !(typeof config.scale === "number" && config.scale > 0)) {
    problems.push("scale must be a positive number when given.");
  }

  const forms = Array.isArray(config.forms) ? config.forms : [];
  if (!forms.length) problems.push("forms must list at least one form.");
  const formKeys = new Set();
  const slugSuffixes = new Set();
  for (const [index, form] of forms.entries()) {
    if (!isPlainObject(form) || typeof form.key !== "string" || !KEY_PATTERN.test(form.key)) {
      problems.push(`forms[${index}].key must be lower case letters, digits or underscores.`);
      continue;
    }
    if (formKeys.has(form.key)) problems.push(`forms[${index}].key "${form.key}" is used twice.`);
    formKeys.add(form.key);
    if (typeof form.name !== "string" || !form.name.trim() || form.name.length > 120) {
      problems.push(`forms[${index}].name must be 1 to 120 characters.`);
    }
    if (typeof form.slug_suffix !== "string" || !SLUG_SUFFIX_PATTERN.test(form.slug_suffix) || form.slug_suffix.length > 30) {
      problems.push(`forms[${index}].slug_suffix must be a short address part (a-z, 0-9, hyphens).`);
    } else if (slugSuffixes.has(form.slug_suffix)) {
      problems.push(`forms[${index}].slug_suffix "${form.slug_suffix}" is used twice.`);
    } else {
      slugSuffixes.add(form.slug_suffix);
    }
  }

  const tests = Array.isArray(config.split_tests) ? config.split_tests : [];
  const testKeys = new Map();
  const formInTest = new Map();
  for (const [index, test] of tests.entries()) {
    if (!isPlainObject(test) || typeof test.key !== "string" || !KEY_PATTERN.test(test.key)) {
      problems.push(`split_tests[${index}].key must be lower case letters, digits or underscores.`);
      continue;
    }
    if (testKeys.has(test.key)) problems.push(`split_tests[${index}].key "${test.key}" is used twice.`);
    testKeys.set(test.key, test);
    if (typeof test.name !== "string" || !test.name.trim() || test.name.length > 120) {
      problems.push(`split_tests[${index}].name must be 1 to 120 characters.`);
    }
    if (typeof test.slug_suffix !== "string" || !SLUG_SUFFIX_PATTERN.test(test.slug_suffix) || test.slug_suffix.length > 30) {
      problems.push(`split_tests[${index}].slug_suffix must be a short address part (a-z, 0-9, hyphens).`);
    } else if (slugSuffixes.has(test.slug_suffix)) {
      problems.push(`split_tests[${index}].slug_suffix "${test.slug_suffix}" is used twice.`);
    } else {
      slugSuffixes.add(test.slug_suffix);
    }
    if (test.status !== "running" && test.status !== "ended") {
      problems.push(`split_tests[${index}].status must be "running" or "ended".`);
    }
    if (!isIsoTimestamp(test.started_at)) problems.push(`split_tests[${index}].started_at must be an ISO timestamp.`);
    if (test.status === "ended" && !isIsoTimestamp(test.ended_at)) {
      problems.push(`split_tests[${index}].ended_at must be an ISO timestamp for an ended test.`);
    }
    const members = Array.isArray(test.forms) ? test.forms : [];
    if (members.length < 2 || members.length > 3) problems.push(`split_tests[${index}].forms must list 2 or 3 forms.`);
    if (new Set(members).size !== members.length) problems.push(`split_tests[${index}].forms lists a form twice.`);
    for (const member of members) {
      if (!formKeys.has(member)) problems.push(`split_tests[${index}].forms names unknown form "${member}".`);
      if (formInTest.has(member)) problems.push(`Form "${member}" is in more than one split test.`);
      formInTest.set(member, test.key);
    }
  }

  const periods = Array.isArray(config.periods) ? config.periods : [];
  if (!periods.length) problems.push("periods must list at least one period.");
  const sums = { visitors: 0, form_starts: 0, leads: 0, bookings: 0, spend_cents: 0 };
  const armPeriods = new Set();
  for (const [index, period] of periods.entries()) {
    const label = `periods[${index}]`;
    if (!isPlainObject(period)) {
      problems.push(`${label} must be an object.`);
      continue;
    }
    if (!formKeys.has(period.form)) problems.push(`${label}.form names unknown form "${period.form}".`);
    if (!isIsoDate(period.start)) problems.push(`${label}.start must be a YYYY-MM-DD date.`);
    if (!isIsoDate(period.end)) problems.push(`${label}.end must be a YYYY-MM-DD date.`);
    if (isIsoDate(period.start) && isIsoDate(period.end) && period.end < period.start) {
      problems.push(`${label}.end is before its start.`);
    }
    let countsOk = true;
    for (const field of COUNT_FIELDS) {
      if (!isCount(period[field])) {
        problems.push(`${label}.${field} must be a whole number of 0 or more.`);
        countsOk = false;
      }
    }
    if (countsOk) {
      if (period.form_starts > period.visitors) problems.push(`${label} has more form starts than visitors.`);
      if (period.leads > period.form_starts) problems.push(`${label} has more leads than form starts.`);
      if (period.bookings > period.leads) problems.push(`${label} has more bookings than leads.`);
      for (const field of COUNT_FIELDS) sums[field] += period[field];
    }
    const memberOf = formInTest.get(period.form);
    if (period.split_test !== undefined && period.split_test !== null) {
      if (!testKeys.has(period.split_test)) {
        problems.push(`${label}.split_test names unknown test "${period.split_test}".`);
      } else if (memberOf !== period.split_test) {
        problems.push(`${label}.split_test "${period.split_test}" does not include form "${period.form}".`);
      } else {
        const armKey = `${period.split_test}:${period.form}`;
        if (armPeriods.has(armKey)) problems.push(`${label} repeats the split test period of form "${period.form}".`);
        armPeriods.add(armKey);
        const test = testKeys.get(period.split_test);
        if (isIsoTimestamp(test.started_at) && isIsoDate(period.end) && Date.parse(`${period.end}T00:00:00Z`) + DAY_MS <= Date.parse(test.started_at)) {
          problems.push(`${label} ends before its split test starts.`);
        }
      }
    } else if (memberOf) {
      problems.push(`${label} is for form "${period.form}", which is in split test "${memberOf}"; set split_test.`);
    }
  }

  const expected = config.expected_totals;
  if (!isPlainObject(expected)) {
    problems.push("expected_totals must be an object.");
  } else {
    for (const field of COUNT_FIELDS) {
      if (!isCount(expected[field])) {
        problems.push(`expected_totals.${field} must be a whole number of 0 or more.`);
      } else if (expected[field] !== sums[field]) {
        problems.push(`Periods add up to ${sums[field]} ${field}, but expected_totals says ${expected[field]}.`);
      }
    }
  }

  if (isPlainObject(config.stage_rules) && config.stage_rules.disqualified !== undefined && config.stage_rules.disqualified !== 0) {
    problems.push("stage_rules.disqualified must be 0 (the seed does not create disqualified leads).");
  }

  if (problems.length) throw new Error(`Seed config is not valid:\n- ${problems.join("\n- ")}`);
  return true;
}

/** A uuid (version 4 layout) derived from the batch and a key, so a plan is the same every time. */
export function deterministicUuid(batch, key) {
  const hex = createHash("sha256").update(`${batch}:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

/**
 * Scale one source row for the demo, keeping rates and unit costs exact:
 * visitors rounded; starts and leads from the source rates; bookings from the
 * source lead-to-booking rate; spend = scaled leads x source cost per lead, or
 * scaled spend rounded to whole dollars when the row has no leads.
 */
export function scaleSourceRow(row, scale) {
  if (!(typeof scale === "number" && scale > 0)) throw new Error("scale must be a positive number.");
  const visitors = Math.round(row.visitors * scale);
  const rate = (part) => (row.visitors > 0 ? part / row.visitors : 0);
  const formStarts = Math.round(visitors * rate(row.form_starts));
  const leads = Math.round(visitors * rate(row.leads));
  const bookings = row.leads > 0 ? Math.round(leads * (row.bookings / row.leads)) : 0;
  let spendCents;
  if (leads > 0 && Number.isFinite(row.cost_per_lead_cents) && row.cost_per_lead_cents !== null) {
    spendCents = leads * row.cost_per_lead_cents;
  } else {
    spendCents = Math.round(((row.spend_cents ?? 0) / 100) * scale) * 100;
  }
  return { visitors, form_starts: formStarts, leads, bookings, spend_cents: spendCents };
}

/** Split a whole number by weights with the largest remainder method; the parts always add up to total. */
export function splitByLargestRemainder(total, weights) {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map((_, index) => (index === 0 ? total : 0));
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map((value) => Math.floor(value));
  let left = total - parts.reduce((acc, part) => acc + part, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] += 1;
    left -= 1;
  }
  return parts;
}

function contactStepKey() {
  // Questions come first (intake_flow_order below), then one contact page with
  // the default fields (name and phone), so the contact page is step 3.
  return "contact:3:full_name,phone";
}

/** Builds the full plan: ids, forms, questions, tests, members, spend and visitor batches. */
export function buildSeedPlan(config, { tenantId, batch }) {
  validateSeedConfig(config);
  if (typeof tenantId !== "string" || !UUID_PATTERN.test(tenantId)) throw new Error("tenantId must be a uuid.");
  if (typeof batch !== "string" || !BATCH_PATTERN.test(batch)) {
    throw new Error("batch must be 3 to 40 characters: lower case letters, digits and hyphens.");
  }
  const id = (key) => deterministicUuid(batch, key);

  const forms = config.forms.map((form) => {
    const formId = id(`form:${form.key}`);
    const questions = QUESTIONS.map((question, questionIndex) => ({
      id: id(`question:${form.key}:${question.key}`),
      stableKey: question.key,
      label: question.label,
      displayOrder: questionIndex + 1,
      options: question.options.map((option, optionIndex) => ({
        id: id(`option:${form.key}:${question.key}:${option.key}`),
        stableKey: option.key,
        label: option.label,
        value: option.key,
        displayOrder: optionIndex + 1
      }))
    }));
    return {
      key: form.key,
      id: formId,
      name: form.name,
      slug: `demo-${batch}-${form.slug_suffix}`,
      questions,
      stepKeys: {
        page1: `question:${questions[0].id}`,
        page2: `question:${questions[1].id}`,
        contact: contactStepKey(),
        slots: "slots"
      }
    };
  });
  const formByKey = new Map(forms.map((form) => [form.key, form]));

  const tests = (config.split_tests ?? []).map((test) => ({
    key: test.key,
    id: id(`test:${test.key}`),
    name: test.name,
    slug: `demo-${batch}-${test.slug_suffix}`,
    status: test.status,
    startedAt: new Date(test.started_at).toISOString(),
    endedAt: test.status === "ended" ? new Date(test.ended_at).toISOString() : null
  }));
  const testByKey = new Map(tests.map((test) => [test.key, test]));

  const members = [];
  for (const test of config.split_tests ?? []) {
    test.forms.forEach((formKey, index) => {
      members.push({ testId: testByKey.get(test.key).id, funnelId: formByKey.get(formKey).id, position: index + 1 });
    });
  }

  const spend = [];
  const visitorBatches = [];
  let leadOffset = 0;
  config.periods.forEach((period, index) => {
    const form = formByKey.get(period.form);
    const test = period.split_test ? testByKey.get(period.split_test) : null;
    let startMs = Date.parse(`${period.start}T00:00:00Z`);
    let endMs = Date.parse(`${period.end}T00:00:00Z`) + DAY_MS;
    if (test) {
      // Rows recorded against a test must fall inside its running period.
      startMs = Math.max(startMs, Date.parse(test.startedAt));
      if (test.endedAt) endMs = Math.min(endMs, Date.parse(test.endedAt));
    }
    visitorBatches.push({
      key: `p${index + 1}`,
      funnelId: form.id,
      formKey: form.key,
      splitTestId: test ? test.id : null,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      visitors: period.visitors,
      formStarts: period.form_starts,
      leads: period.leads,
      bookings: period.bookings,
      leadOffset,
      stepKeys: form.stepKeys
    });
    leadOffset += period.leads;
    spend.push({
      id: id(`spend:p${index + 1}`),
      funnelId: form.id,
      splitTestId: test ? test.id : null,
      periodStart: test ? null : period.start,
      periodEnd: test ? null : period.end,
      amountCents: period.spend_cents
    });
  });

  return { tenantId, batch, label: config.label, forms, splitTests: tests, members, spend, visitorBatches };
}

function lit(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonLit(value) {
  return `${lit(JSON.stringify(value))}::jsonb`;
}

function sqlTextArray(values) {
  return `array[${values.map(lit).join(", ")}]`;
}

function renderForms(plan) {
  const lines = [];
  for (const form of plan.forms) {
    const intakeOrder = [
      ...form.questions.map((question) => `question:${question.id}`),
      "contact:full_name",
      "contact:phone",
      "contact:first_name",
      "contact:last_name",
      "contact:email"
    ];
    lines.push(
      `insert into public.funnels (id, tenant_id, name, slug, description, is_published, ghl_connection_id, qualification_rule, demo_seed_batch)`,
      `values (${lit(form.id)}, ${lit(plan.tenantId)}, ${lit(form.name)}, ${lit(form.slug)}, ${lit(plan.label)}, true, null, ${jsonLit({ mode: "all_required_answered", intake_flow_order: intakeOrder })}, ${lit(plan.batch)});`
    );
    for (const question of form.questions) {
      lines.push(
        `insert into public.questions (id, tenant_id, funnel_id, stable_key, label, question_type, is_required, display_order)`,
        `values (${lit(question.id)}, ${lit(plan.tenantId)}, ${lit(form.id)}, ${lit(question.stableKey)}, ${lit(question.label)}, 'single_select', true, ${question.displayOrder});`
      );
      for (const option of question.options) {
        lines.push(
          `insert into public.question_options (id, tenant_id, question_id, stable_key, label, value, display_order)`,
          `values (${lit(option.id)}, ${lit(plan.tenantId)}, ${lit(question.id)}, ${lit(option.stableKey)}, ${lit(option.label)}, ${lit(option.value)}, ${option.displayOrder});`
        );
      }
    }
  }
  return lines.join("\n");
}

function renderTests(plan) {
  const lines = [];
  for (const test of plan.splitTests) {
    lines.push(
      `insert into public.split_tests (id, tenant_id, name, slug, status, demo_seed_batch)`,
      `values (${lit(test.id)}, ${lit(plan.tenantId)}, ${lit(test.name)}, ${lit(test.slug)}, 'draft', ${lit(plan.batch)});`
    );
    for (const member of plan.members.filter((row) => row.testId === test.id)) {
      lines.push(
        `insert into public.split_test_members (test_id, funnel_id, tenant_id, position)`,
        `values (${lit(member.testId)}, ${lit(member.funnelId)}, ${lit(plan.tenantId)}, ${member.position});`
      );
    }
    lines.push(`update public.split_tests set status = 'running', started_at = ${lit(test.startedAt)} where id = ${lit(test.id)};`);
    if (test.status === "ended") {
      lines.push(`update public.split_tests set status = 'ended', ended_at = ${lit(test.endedAt)} where id = ${lit(test.id)};`);
    }
  }
  return lines.join("\n");
}

/**
 * One period: generate_series over its visitors (never one literal row per
 * visitor). Visitor i gets a page view and the first question; the first
 * form_starts visitors start and see question 2; the first leads visitors see
 * the contact page, become lead sessions and see the calendar; the first
 * bookings of them book.
 */
function renderPeriod(plan, period) {
  const seed = `${plan.batch}:${period.formKey}:${period.key}:`;
  const meta = (extra) =>
    `jsonb_build_object('demo_seed', ${lit(plan.batch)}, 'utm_source', 'facebook', 'page_load_id', md5(${lit(`${seed}pl:`)} || g.i)::uuid::text${extra ? `, ${extra}` : ""})`;
  const stepMeta = (key, index, type, label) =>
    meta(`'step_key', ${lit(key)}, 'step_index', ${index}, 'step_type', ${lit(type)}, 'step_label', ${lit(label)}`);
  const form = plan.forms.find((row) => row.id === period.funnelId);
  const sourceUrl = `https://example.com/demo/${form.slug}`;
  const testId = period.splitTestId ? `${lit(period.splitTestId)}::uuid` : "null::uuid";

  // t0 and t1 bound the period; t1 never runs past the moment the SQL runs.
  const window = `select ${lit(period.start)}::timestamptz as t0,
         greatest(${lit(period.start)}::timestamptz + interval '1 hour', least(${lit(period.end)}::timestamptz, now())) as t1`;
  const series = (limit) => `(${window}) w
  cross join lateral (
    select i, md5(${lit(`${seed}v:`)} || i)::uuid::text as visitor_id,
           w.t0 + (i::float8 / ${Math.max(period.visitors, 1)}) * ((w.t1 - w.t0) - interval '10 minutes') as at
    from generate_series(0, ${limit} - 1) as i
  ) g`;

  const analytics = (eventType, limit, offset, metadata) =>
    `insert into public.analytics_events (tenant_id, funnel_id, visitor_id, event_type, source, source_url, user_agent, metadata, split_test_id, occurred_at)
select ${lit(plan.tenantId)}, ${lit(period.funnelId)}, g.visitor_id, ${lit(eventType)}::analytics_event_type, 'page', ${lit(sourceUrl)}, 'Mozilla/5.0 (demo)', ${metadata}, ${testId}, g.at + interval '${offset} seconds'
from ${series(limit)};`;

  const lines = [`-- Period ${period.key}: ${period.visitors} visitors, ${period.formStarts} starts, ${period.leads} leads, ${period.bookings} bookings`];
  if (period.visitors > 0) {
    lines.push(analytics("page_view", period.visitors, 0, meta()));
    lines.push(analytics("step_view", period.visitors, 5, stepMeta(period.stepKeys.page1, 1, "question", form.questions[0].label)));
  }
  if (period.formStarts > 0) {
    lines.push(analytics("form_start", period.formStarts, 30, meta()));
    lines.push(analytics("step_view", period.formStarts, 45, stepMeta(period.stepKeys.page2, 2, "question", form.questions[1].label)));
  }
  if (period.leads > 0) {
    lines.push(analytics("step_view", period.leads, 60, stepMeta(period.stepKeys.contact, 3, "contact", "Contact: Name + Phone Number")));
    lines.push(analytics("step_view", period.leads, 240, stepMeta(period.stepKeys.slots, 4, "calendar", "Calendar availability")));
    lines.push(
      `insert into public.lead_sessions (id, tenant_id, funnel_id, status, first_name, last_name, full_name, email, phone, visitor_id, source_url, utm_source, user_agent, metadata, split_test_id, started_at, qualified_at, slots_shown_at, booked_at, created_at)
select md5(${lit(`${seed}ls:`)} || g.i)::uuid, ${lit(plan.tenantId)}, ${lit(period.funnelId)},
       (case when g.i < ${period.bookings} then 'booked' else 'slots_shown' end)::lead_session_status,
       n.first_name, n.last_name, n.first_name || ' ' || n.last_name,
       'demo+' || ${lit(plan.batch)} || '-' || n.n || '@example.com',
       '+141655501' || lpad((n.n % 100)::text, 2, '0'),
       g.visitor_id, ${lit(sourceUrl)}, 'facebook', 'Mozilla/5.0 (demo)',
       jsonb_build_object('demo_seed', ${lit(plan.batch)}, 'utm_source', 'facebook'), ${testId},
       g.at + interval '2 minutes',
       case when g.i < ${period.bookings} then g.at + interval '3 minutes' end,
       g.at + interval '4 minutes',
       case when g.i < ${period.bookings} then g.at + interval '7 minutes' end,
       g.at + interval '2 minutes'
from ${series(period.leads)}
cross join lateral (
  select ${period.leadOffset} + g.i as n,
         (${sqlTextArray(FIRST_NAMES)})[1 + ((${period.leadOffset} + g.i) % 20)] as first_name,
         (${sqlTextArray(LAST_NAMES)})[1 + (((${period.leadOffset} + g.i) / 20) % 20)] as last_name
) n;`
    );
  }
  return lines.join("\n");
}

function renderHistory(plan) {
  const batch = lit(plan.batch);
  const demoSessions = `select d.id from public.lead_sessions d
  join public.funnels df on df.id = d.funnel_id
  where df.demo_seed_batch = ${batch} and d.metadata->>'demo_seed' = ${batch}`;
  return `-- History: the insert trigger wrote one row per session at now(); move it to the session's last stage time,
-- then add the earlier stages (lead, qualified for booked leads, calendar shown for booked leads).
update public.lead_status_history h
set created_at = coalesce(ls.booked_at, ls.slots_shown_at), metadata = jsonb_build_object('demo_seed', ${batch})
from public.lead_sessions ls
where h.lead_session_id = ls.id and h.reason = 'session_created' and ls.id in (${demoSessions});

insert into public.lead_status_history (tenant_id, lead_session_id, from_status, to_status, reason, metadata, created_at)
select ls.tenant_id, ls.id, 'started'::lead_session_status, 'potential'::lead_session_status, 'demo_seed', jsonb_build_object('demo_seed', ${batch}), ls.started_at
from public.lead_sessions ls where ls.id in (${demoSessions});

insert into public.lead_status_history (tenant_id, lead_session_id, from_status, to_status, reason, metadata, created_at)
select ls.tenant_id, ls.id, 'potential'::lead_session_status, 'qualified'::lead_session_status, 'demo_seed', jsonb_build_object('demo_seed', ${batch}), ls.qualified_at
from public.lead_sessions ls where ls.status = 'booked' and ls.id in (${demoSessions});

insert into public.lead_status_history (tenant_id, lead_session_id, from_status, to_status, reason, metadata, created_at)
select ls.tenant_id, ls.id, 'qualified'::lead_session_status, 'slots_shown'::lead_session_status, 'demo_seed', jsonb_build_object('demo_seed', ${batch}), ls.slots_shown_at
from public.lead_sessions ls where ls.status = 'booked' and ls.id in (${demoSessions});`;
}

function renderSpend(plan) {
  return plan.spend
    .map(
      (entry) =>
        `insert into public.ad_spend_entries (id, tenant_id, funnel_id, split_test_id, period_start, period_end, amount_cents, currency, note)
values (${lit(entry.id)}, ${lit(plan.tenantId)}, ${lit(entry.funnelId)}, ${lit(entry.splitTestId)}, ${entry.periodStart ? `${lit(entry.periodStart)}::date` : "null"}, ${entry.periodEnd ? `${lit(entry.periodEnd)}::date` : "null"}, ${entry.amountCents}, 'USD', ${lit("Sample data")});`
    )
    .join("\n");
}

function renderCheck(plan) {
  const batch = lit(plan.batch);
  return `-- By-eye check: compare with expected_totals in the seed config.
select f.name,
       (select count(distinct a.visitor_id) from public.analytics_events a where a.funnel_id = f.id) as visitors,
       (select count(distinct a.visitor_id) from public.analytics_events a where a.funnel_id = f.id and a.event_type = 'form_start') as form_starts,
       (select count(*) from public.lead_sessions ls where ls.funnel_id = f.id) as leads,
       (select count(*) from public.lead_sessions ls where ls.funnel_id = f.id and ls.status = 'booked') as bookings,
       (select coalesce(sum(s.amount_cents), 0) from public.ad_spend_entries s where s.funnel_id = f.id) as spend_cents
from public.funnels f
where f.demo_seed_batch = ${batch}
order by f.name;`;
}

/** The SQL text for a plan, in one transaction. */
export function renderSeedSql(plan) {
  const tenant = lit(plan.tenantId);
  const batch = lit(plan.batch);
  return [
    `-- FormBook demo seed, batch ${plan.batch}. Made-up identities; every row is marked with the batch.`,
    `-- Remove with: node scripts/seed-demo.mjs --batch ${plan.batch} --remove`,
    "begin;",
    "",
    `do $$
declare
  v_plan text;
begin
  select t.plan into v_plan from public.tenants t where t.id = ${tenant};
  if v_plan is null then
    raise exception 'Demo tenant not found';
  end if;
  if v_plan <> 'scaling' then
    raise exception 'Demo tenant must be on the Scaling plan';
  end if;
  if exists (select 1 from public.funnels where demo_seed_batch = ${batch})
     or exists (select 1 from public.split_tests where demo_seed_batch = ${batch}) then
    raise exception 'Demo batch already exists';
  end if;
end $$;`,
    "",
    "-- Forms",
    renderForms(plan),
    "",
    "-- Split tests",
    renderTests(plan),
    "",
    "-- Analytics and leads",
    ...plan.visitorBatches.map((period) => renderPeriod(plan, period)),
    "",
    renderHistory(plan),
    "",
    "-- Ad spend",
    renderSpend(plan),
    "",
    "commit;",
    "",
    renderCheck(plan),
    ""
  ].join("\n");
}

/** Removal SQL: deletes by batch only. Cascades remove members, questions, leads, history, analytics and spend. */
export function renderRemovalSql(batch) {
  if (typeof batch !== "string" || !BATCH_PATTERN.test(batch)) {
    throw new Error("batch must be 3 to 40 characters: lower case letters, digits and hyphens.");
  }
  const value = lit(batch);
  return [
    `-- Remove FormBook demo seed batch ${batch}.`,
    "begin;",
    `delete from public.split_tests where demo_seed_batch = ${value};`,
    `delete from public.funnels where demo_seed_batch = ${value};`,
    "commit;",
    `select (select count(*) from public.funnels where demo_seed_batch = ${value}) as forms_left,`,
    `       (select count(*) from public.split_tests where demo_seed_batch = ${value}) as tests_left;`,
    ""
  ].join("\n");
}
