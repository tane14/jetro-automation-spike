const { test } = require("node:test");
const assert = require("node:assert/strict");
const { greet } = require("./control-plane-task");

test('greet("World") returns "Hello, World!"', () => {
  assert.equal(greet("World"), "Hello, World!");
});

test('greet("") returns "Hello, !"', () => {
  assert.equal(greet(""), "Hello, !");
});
