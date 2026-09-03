"use strict";

/**
 * Pluggable reviewer transport for Reviewer Automation v1.6.
 * Adapter output is untrusted. Core runtime validates independently.
 * Not GitHub approval, merge, completion, policy, or evidence authority.
 * ClaudeReviewerAdapter is intentionally not implemented in this slice.
 */

class ReviewerAdapter {
  async review(_reviewRequest) {
    throw new Error("ReviewerAdapter.review is not implemented");
  }
}

class FakeReviewerAdapter extends ReviewerAdapter {
  /**
   * @param {{ result?: object, handler?: Function, error?: Error }} [options]
   */
  constructor(options = {}) {
    super();
    this.result = options.result || null;
    this.handler = typeof options.handler === "function" ? options.handler : null;
    this.error = options.error || null;
    this.calls = [];
  }

  async review(reviewRequest) {
    this.calls.push(reviewRequest);
    if (this.error) {
      throw this.error;
    }
    if (this.handler) {
      return this.handler(reviewRequest);
    }
    if (!this.result || typeof this.result !== "object") {
      throw new Error("FakeReviewerAdapter has no review result");
    }
    return JSON.parse(JSON.stringify(this.result));
  }
}

module.exports = {
  ReviewerAdapter,
  FakeReviewerAdapter,
};
