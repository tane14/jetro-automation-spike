"use strict";

/**
 * Thin human-triggered CLI for Executor Exchange Runtime v0.9.
 * Does not call Cursor, Claude, or GitHub. Does not print lease_token.
 * Local JSON only. Not authority.
 */

const fs = require("node:fs");
const path = require("node:path");
const { JsonFileMissionTaskStore } = require("./JsonFileMissionTaskStore");
const { ExecutorExchangeRuntime } = require("./ExecutorExchangeRuntime");
const { RuntimeValidationError } = require("./MissionTaskRuntime");

const COMMANDS = new Set(["export", "ingest"]);

function failCli(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const rest = argv.slice(2);
  const command = rest[0];
  const flags = {};
  for (let i = 1; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      failCli(`unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      failCli(`missing value for --${key}`);
    }
    flags[key] = value;
    i += 1;
  }
  return { command, flags };
}

async function main(argv = process.argv) {
  const { command, flags } = parseArgs(argv);
  if (!COMMANDS.has(command)) {
    failCli("usage: node src/runtime/cli.js export|ingest --root <dir> ...");
  }
  if (typeof flags.root !== "string" || flags.root.trim() === "") {
    failCli("missing --root");
  }
  if (typeof flags["execution-id"] !== "string") {
    failCli("missing --execution-id");
  }

  const store = new JsonFileMissionTaskStore({ rootDir: path.resolve(flags.root) });
  const exchange = new ExecutorExchangeRuntime({ store });

  if (command === "export") {
    const extra = Object.keys(flags).filter((key) => key !== "root" && key !== "execution-id");
    if (extra.length) {
      failCli(`unknown export flag: ${extra.join(", ")}`);
    }
    const result = await exchange.exportDispatchPackage({
      execution_id: flags["execution-id"],
    });
    process.stdout.write(`${JSON.stringify({ path: result.path, execution_id: flags["execution-id"] }, null, 2)}\n`);
    return;
  }

  const extra = Object.keys(flags).filter(
    (key) => key !== "root" && key !== "execution-id" && key !== "lease-token" && key !== "file",
  );
  if (extra.length) {
    failCli(`unknown ingest flag: ${extra.join(", ")}`);
  }
  if (typeof flags["lease-token"] !== "string") {
    failCli("missing --lease-token");
  }
  if (typeof flags.file !== "string") {
    failCli("missing --file");
  }
  const filePath = path.resolve(flags.file);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    failCli(`invalid handoff JSON: ${err.message}`);
  }

  const result = await exchange.ingestHandoff({
    execution_id: flags["execution-id"],
    lease_token: flags["lease-token"],
    handoff: parsed,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        execution_id: result.execution.execution_id,
        state: result.execution.state,
        outcome: result.handoff.outcome,
        task_state: result.task.state,
        authority_claim: result.handoff.authority_claim,
      },
      null,
      2,
    )}\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    if (err instanceof RuntimeValidationError) {
      failCli(err.message);
    }
    failCli(err && err.message ? err.message : String(err));
  });
}

module.exports = { main, parseArgs };
