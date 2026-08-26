"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("approval-provenance attestation harness (python)", () => {
  const script = path.join(__dirname, "approval_provenance_attestation_test.py");
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  let result = null;
  let lastError = "";
  for (const bin of candidates) {
    result = spawnSync(bin, [script], { encoding: "utf8" });
    if (result.error && result.error.code === "ENOENT") {
      lastError += `${bin} not found\n`;
      continue;
    }
    break;
  }
  assert.ok(result, lastError || "python interpreter not found");
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /ALL_PASS/);
});
