#!/usr/bin/env node
// Prints SQL for a FormBook demo account. It never connects to a database:
// read the SQL, then run it yourself in the Supabase SQL editor.
//
//   node scripts/seed-demo.mjs --config <seed.json> --tenant <uuid> --batch <name>
//   node scripts/seed-demo.mjs --batch <name> --remove
//
// SQL goes to stdout and nothing else; errors go to stderr with exit code 1.

import { readFileSync } from "node:fs";
import { BATCH_PATTERN, buildSeedPlan, renderRemovalSql, renderSeedSql } from "./demo-seed-plan.mjs";

function parseArgs(argv) {
  const args = { remove: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--remove") {
      args.remove = true;
    } else if (arg === "--config" || arg === "--tenant" || arg === "--batch") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value.`);
      args[arg.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.batch || !BATCH_PATTERN.test(args.batch)) {
    throw new Error("--batch is required: 3 to 40 characters, lower case letters, digits and hyphens.");
  }
  if (args.remove) {
    process.stdout.write(renderRemovalSql(args.batch));
    return;
  }
  if (!args.config) throw new Error("--config is required.");
  if (!args.tenant) throw new Error("--tenant is required.");

  let config;
  try {
    config = JSON.parse(readFileSync(args.config, "utf8"));
  } catch (error) {
    throw new Error(`Could not read the config file: ${error instanceof Error ? error.message : String(error)}`);
  }
  const plan = buildSeedPlan(config, { tenantId: args.tenant, batch: args.batch });
  process.stdout.write(renderSeedSql(plan));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
