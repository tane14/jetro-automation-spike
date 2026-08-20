const { test } = require("node:test");
const assert = require("node:assert/strict");
const { greet } = require("./orchestration-greeting");

test('greet("World") returns "Hello, World!"', () => {
  assert.equal(greet("World"), "Hello, World!");
});

test('greet("") returns "Hello, !"', () => {
  assert.equal(greet(""), "Hello, !");
});
