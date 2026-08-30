"use strict";

/**
 * SHA-256 hex of raw bytes. Evidence data only. Not an authority source.
 */

const { createHash } = require("node:crypto");

function sha256BytesHex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return createHash("sha256").update(buf).digest("hex");
}

module.exports = { sha256BytesHex };
