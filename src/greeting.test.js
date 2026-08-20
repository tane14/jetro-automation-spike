const { test } = require("node:test");
const assert = require("node:assert/strict");
const { greet } = require("./greeting");

test("greets a normal, non-empty name", () => {
  assert.equal(greet("World"), "Hello, World!");
});

test("greets an empty string name", () => {
  assert.equal(greet(""), "Hello, !");
});
