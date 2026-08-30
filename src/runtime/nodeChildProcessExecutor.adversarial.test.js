"use strict";

/**
 * Real NodeChildProcessExecutor adversarial tests.
 * Harmless fixtures only. Does not invoke Cursor Agent.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { NodeChildProcessExecutor, FORBIDDEN_FLAGS } = require("./NodeChildProcessExecutor");
const { buildChildEnvironment } = require("./childEnvironment");
const { resolveLaunchTarget, resolveCursorAgentLaunch } = require("./cursorAgentLaunch");
const { canonicalizeWorkspacePath } = require("./workspacePath");

const SYNTHETIC_SECRET = "synthetic-jetro-test-secret-not-real";
const SYNTHETIC_AWS = "synthetic-aws-not-real";
const SYNTHETIC_CURSOR_KEY = "synthetic-cursor-api-key-not-real";

function writeFixture(dir, name, source) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, "utf8");
  return file;
}

function echoArgvFixture() {
  return [
    '"use strict";',
    "const report = {",
    "  argv: process.argv.slice(2),",
    "  secret: process.env.JETRO_TEST_SECRET || null,",
    "  aws: process.env.AWS_SECRET_ACCESS_KEY || null,",
    "  cursorKey: process.env.CURSOR_API_KEY || null,",
    "  nodeOptions: process.env.NODE_OPTIONS || null,",
    "};",
    "process.stdout.write(JSON.stringify(report));",
    "process.exit(0);",
    "",
  ].join("\n");
}

function withSyntheticSecrets(fn) {
  const prev = {
    JETRO_TEST_SECRET: process.env.JETRO_TEST_SECRET,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
  };
  process.env.JETRO_TEST_SECRET = SYNTHETIC_SECRET;
  process.env.AWS_SECRET_ACCESS_KEY = SYNTHETIC_AWS;
  process.env.CURSOR_API_KEY = SYNTHETIC_CURSOR_KEY;
  process.env.NODE_OPTIONS = "--require ./this-must-not-load.js";
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

test("buildChildEnvironment does not copy synthetic parent secrets", () => {
  const child = buildChildEnvironment({
    PATH: "C:\\Windows\\System32",
    SystemRoot: "C:\\Windows",
    JETRO_TEST_SECRET: SYNTHETIC_SECRET,
    AWS_SECRET_ACCESS_KEY: SYNTHETIC_AWS,
    CURSOR_API_KEY: SYNTHETIC_CURSOR_KEY,
    NODE_OPTIONS: "--require ./evil.js",
    GITHUB_TOKEN: "synthetic-github-not-real",
  });
  assert.equal(child.JETRO_TEST_SECRET, undefined);
  assert.equal(child.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(child.CURSOR_API_KEY, undefined);
  assert.equal(child.NODE_OPTIONS, undefined);
  assert.equal(child.GITHUB_TOKEN, undefined);
  assert.equal(child.PATH, "C:\\Windows\\System32");
});

test("real executor does not inherit synthetic parent secrets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-env-probe-"));
  const fixture = writeFixture(dir, "echo-env.js", echoArgvFixture());
  await withSyntheticSecrets(async () => {
    const exec = new NodeChildProcessExecutor();
    const result = await exec.spawn({
      file: process.execPath,
      args: [fixture, "ok"],
      timeoutMs: 8000,
    });
    assert.equal(result.exitCode, 0);
    const report = JSON.parse(result.stdout.toString("utf8"));
    assert.equal(report.secret, null);
    assert.equal(report.aws, null);
    assert.equal(report.cursorKey, null);
    assert.equal(report.nodeOptions, null);
  });
});

test("required injection payload does not create marker or expand secret", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-inject-"));
  const marker = path.join(dir, "pwned.txt");
  const fixture = writeFixture(dir, "echo-argv.js", echoArgvFixture());
  const payload = `q" & echo %JETRO_TEST_SECRET% > "${marker}" & rem "`;
  await withSyntheticSecrets(async () => {
    const spawnCalls = [];
    const exec = new NodeChildProcessExecutor({
      spawnFn: (file, args, opts) => {
        spawnCalls.push({ file, args, opts });
        return spawn(file, args, opts);
      },
    });
    const result = await exec.spawn({
      file: process.execPath,
      args: [fixture, payload],
      timeoutMs: 8000,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(marker), false);
    const report = JSON.parse(result.stdout.toString("utf8"));
    assert.equal(report.argv[0], payload);
    assert.equal(report.secret, null);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].opts.shell, false);
    assert.equal(path.basename(spawnCalls[0].file).toLowerCase() === "cmd.exe", false);
  });
});

const PAYLOADS = [
  ['quote', '"'],
  ["ampersand", "&"],
  ["pipe", "|"],
  ["percent", "%"],
  ["bang", "!"],
  ["parens", "()"],
  ["caret", "^"],
  ["lt", "<"],
  ["gt", ">"],
  ["crlf", "line1\r\nline2"],
];

for (const [name, token] of PAYLOADS) {
  test(`payload ${name} is literal argv or rejected; no marker`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jetro-payload-${name}-`));
    const marker = path.join(dir, "marker.txt");
    const fixture = writeFixture(dir, "echo-argv.js", echoArgvFixture());
    const payload = `${token} echo %JETRO_TEST_SECRET% > "${marker}"`;
    const exec = new NodeChildProcessExecutor();
    const injected = `${payload} --force --yolo --approve-mcps`;
    const result = await exec.spawn({
      file: process.execPath,
      args: [fixture, injected],
      timeoutMs: 8000,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(marker), false);
    const report = JSON.parse(result.stdout.toString("utf8"));
    assert.equal(report.argv.length, 1);
    assert.equal(report.argv[0], injected);
    assert.equal(report.argv.includes("--force"), false);
    assert.equal(report.argv.includes("--yolo"), false);
    assert.equal(report.argv.includes("--approve-mcps"), false);
  });
}

test("forbidden flags as executor args are rejected before spawn", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-flag-"));
  const marker = path.join(dir, "marker.txt");
  const calls = [];
  const exec = new NodeChildProcessExecutor({
    spawnFn: (...spawnArgs) => {
      calls.push(spawnArgs);
      throw new Error("must not spawn forbidden flags");
    },
  });
  await assert.rejects(
    () =>
      exec.spawn({
        file: process.execPath,
        args: ["--force"],
        timeoutMs: 8000,
      }),
    /forbidden CLI flag/,
  );
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(marker), false);
});

test("malicious .cmd does not run chained commands or create marker", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows .cmd boundary");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-cmd-pwn-"));
  const marker = path.join(dir, "marker.txt");
  const script = path.join(dir, "pwn.cmd");
  fs.writeFileSync(
    script,
    `@echo off\r\necho injected> "${marker}"\r\necho %JETRO_TEST_SECRET%>> "${marker}"\r\n`,
    "utf8",
  );
  const calls = [];
  const exec = new NodeChildProcessExecutor({
    spawnFn: (...spawnArgs) => {
      calls.push(spawnArgs);
      throw new Error("must not spawn .cmd");
    },
  });
  await withSyntheticSecrets(async () => {
    await assert.rejects(
      () => exec.spawn({ file: script, args: ['q" & echo pwned'], timeoutMs: 8000 }),
      /cmd\/bat/,
    );
  });
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(marker), false);
});

test("workspace hardening rejects shell-sensitive forms", () => {
  const samples = [
    'C:\\JETRORunnerLab\\MVP01" & echo',
    "C:\\JETRORunnerLab\\MVP01&whoami",
    "C:\\JETRORunnerLab\\MVP01|whoami",
    "C:\\JETRORunnerLab\\MVP01%SECRET%",
    "C:\\JETRORunnerLab\\MVP01!SECRET!",
    "C:\\JETRORunnerLab\\MVP01^",
    "C:\\JETRORunnerLab\\MVP01>",
    "C:\\JETRORunnerLab\\MVP01<",
    "C:\\JETRORunnerLab\\MVP01\r\nwhoami",
    "relative\\path",
    "C:\\JETRORunnerLab\\MVP01\0hidden",
  ];
  const relative = canonicalizeWorkspacePath("relative\\path");
  assert.equal(relative.ok, false);
  for (const sample of samples) {
    const result = canonicalizeWorkspacePath(sample);
    assert.equal(result.ok, false, sample);
  }
});

test("resolveLaunchTarget maps fixture agent.cmd to node.exe argv without executing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-fake-cursor-"));
  const versionDir = path.join(root, "versions", "2026.08.25-abc1234");
  fs.mkdirSync(versionDir, { recursive: true });
  const nodePath = path.join(versionDir, process.platform === "win32" ? "node.exe" : "node");
  const indexPath = path.join(versionDir, "index.js");
  fs.writeFileSync(nodePath, "", "utf8");
  fs.writeFileSync(indexPath, "module.exports = {};\n", "utf8");
  const cmdPath = path.join(root, "agent.cmd");
  fs.writeFileSync(cmdPath, "@echo off\r\nrem fixture only\r\n", "utf8");
  const resolved = resolveCursorAgentLaunch(cmdPath);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.executable, nodePath);
  assert.deepEqual(resolved.prefixArgs, [indexPath]);
  const target = resolveLaunchTarget(cmdPath);
  assert.equal(target.ok, true);
  assert.equal(target.executable, nodePath);
});

test("timeout does not retry on the real executor", async () => {
  let calls = 0;
  const exec = new NodeChildProcessExecutor({
    spawnFn: (file, args, opts) => {
      calls += 1;
      return spawn(file, args, opts);
    },
  });
  const result = await exec.spawn({
    file: process.execPath,
    args: ["-e", "setTimeout(() => {}, 60000)"],
    timeoutMs: 80,
  });
  assert.equal(result.timedOut, true);
  assert.equal(calls, 1);
  assert.equal(result.windowsDescendantTerminationGuarantee, false);
});
