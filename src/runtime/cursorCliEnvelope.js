"use strict";

/**
 * Defensive parser for Cursor Agent CLI --print --output-format json.
 * Malformed input fails closed. Not an authority source.
 */

const RESULT_CLASS = {
  SUCCEEDED: "SUCCEEDED",
  CLI_ERROR: "CLI_ERROR",
  INVALID_STRUCTURED_OUTPUT: "INVALID_STRUCTURED_OUTPUT",
};

function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value) {
  return typeof value === "string" ? value : null;
}

function parseUsage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const usage = {};
  if (typeof raw.inputTokens === "number" && Number.isFinite(raw.inputTokens)) {
    usage.inputTokens = raw.inputTokens;
  }
  if (typeof raw.outputTokens === "number" && Number.isFinite(raw.outputTokens)) {
    usage.outputTokens = raw.outputTokens;
  }
  if (typeof raw.cacheReadTokens === "number" && Number.isFinite(raw.cacheReadTokens)) {
    usage.cacheReadTokens = raw.cacheReadTokens;
  }
  if (typeof raw.cacheWriteTokens === "number" && Number.isFinite(raw.cacheWriteTokens)) {
    usage.cacheWriteTokens = raw.cacheWriteTokens;
  }
  return Object.keys(usage).length ? usage : null;
}

function parseCursorCliEnvelope(stdoutText) {
  if (typeof stdoutText !== "string" || stdoutText.trim() === "") {
    return {
      structuredOutputValid: false,
      protocolStatus: RESULT_CLASS.INVALID_STRUCTURED_OUTPUT,
      envelope: null,
      agentResult: null,
      sessionId: null,
      requestId: null,
      usage: null,
      parseError: "stdout is empty or not text",
    };
  }
  const trimmed = stdoutText.trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      structuredOutputValid: false,
      protocolStatus: RESULT_CLASS.INVALID_STRUCTURED_OUTPUT,
      envelope: null,
      agentResult: null,
      sessionId: null,
      requestId: null,
      usage: null,
      parseError: err instanceof Error ? err.message : "JSON parse failed",
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      structuredOutputValid: false,
      protocolStatus: RESULT_CLASS.INVALID_STRUCTURED_OUTPUT,
      envelope: null,
      agentResult: null,
      sessionId: null,
      requestId: null,
      usage: null,
      parseError: "JSON root is not an object",
    };
  }
  const envelope = {
    type: asString(parsed.type),
    subtype: asString(parsed.subtype),
    is_error: typeof parsed.is_error === "boolean" ? parsed.is_error : null,
    duration_ms: asFiniteNumber(parsed.duration_ms),
    duration_api_ms: asFiniteNumber(parsed.duration_api_ms),
    result: typeof parsed.result === "string" ? parsed.result : null,
    session_id: asString(parsed.session_id),
    request_id: asString(parsed.request_id),
    usage: parseUsage(parsed.usage),
  };
  if (envelope.type !== "result") {
    return {
      structuredOutputValid: false,
      protocolStatus: RESULT_CLASS.INVALID_STRUCTURED_OUTPUT,
      envelope,
      agentResult: envelope.result,
      sessionId: envelope.session_id,
      requestId: envelope.request_id,
      usage: envelope.usage,
      parseError: "envelope type is not result",
    };
  }
  if (envelope.is_error === true || envelope.subtype === "error") {
    return {
      structuredOutputValid: true,
      protocolStatus: RESULT_CLASS.CLI_ERROR,
      envelope,
      agentResult: envelope.result,
      sessionId: envelope.session_id,
      requestId: envelope.request_id,
      usage: envelope.usage,
      parseError: null,
    };
  }
  if (envelope.subtype !== null && envelope.subtype !== "success") {
    return {
      structuredOutputValid: true,
      protocolStatus: RESULT_CLASS.CLI_ERROR,
      envelope,
      agentResult: envelope.result,
      sessionId: envelope.session_id,
      requestId: envelope.request_id,
      usage: envelope.usage,
      parseError: null,
    };
  }
  return {
    structuredOutputValid: true,
    protocolStatus: RESULT_CLASS.SUCCEEDED,
    envelope,
    agentResult: envelope.result,
    sessionId: envelope.session_id,
    requestId: envelope.request_id,
    usage: envelope.usage,
    parseError: null,
  };
}

module.exports = {
  RESULT_CLASS,
  parseCursorCliEnvelope,
};
