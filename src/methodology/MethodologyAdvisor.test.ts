import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MethodologyAdvisor, METHODOLOGY_ADDENDUM_PREFIX } from './MethodologyAdvisor.js';

describe('MethodologyAdvisor', () => {
  describe('decline cases (returns null)', () => {
    const advisor = new MethodologyAdvisor();

    it('returns null for empty input', () => {
      assert.equal(advisor.advise(''), null);
      assert.equal(advisor.advise('   '), null);
    });

    it('returns null for whitespace-only input', () => {
      assert.equal(advisor.advise('\n\t  '), null);
    });

    it('returns null for slash commands', () => {
      assert.equal(advisor.advise('/clear'), null);
      assert.equal(advisor.advise('/foo arg1 arg2'), null);
    });

    it('returns null for very short prompts without an image', () => {
      assert.equal(advisor.advise('hi'), null);
      assert.equal(advisor.advise('thx'), null);
    });

    it('does NOT decline a short prompt when an image is attached', () => {
      const r = advisor.advise('do it', { hasImageAttachment: true });
      assert.notEqual(r, null);
    });

    it('returns null when the advisor is disabled globally', () => {
      const a = new MethodologyAdvisor({ enabled: false });
      assert.equal(a.advise('refactor the auth module to remove duplicated code'), null);
    });

    it('returns null when the per-call enabled flag overrides global=true', () => {
      const r = advisor.advise('refactor the auth module to remove duplicated code', { enabled: false });
      assert.equal(r, null);
    });
  });

  describe('happy path', () => {
    const advisor = new MethodologyAdvisor();

    it('classifies a refactor request and emits a prompt addendum', () => {
      const r = advisor.advise('Refactor this code to extract the validation logic into a helper');
      assert.notEqual(r, null);
      assert.equal(r!.classification.type, 'refactor');
      assert.ok(r!.promptAddendum.startsWith(METHODOLOGY_ADDENDUM_PREFIX));
      assert.ok(r!.label.length > 0);
      assert.ok(r!.signature.length > 0);
    });

    it('classifies a debug request', () => {
      const r = advisor.advise('debug this stack trace: TypeError at line 42');
      assert.notEqual(r, null);
      assert.equal(r!.classification.type, 'debug');
    });

    it('classifies an explain request', () => {
      const r = advisor.advise('explain how the token counter works under the hood');
      assert.notEqual(r, null);
      assert.equal(r!.classification.type, 'explain');
    });

    it('produces stable signatures for identical input', () => {
      const r1 = advisor.advise('Implement a new user registration endpoint with validation');
      const r2 = advisor.advise('Implement a new user registration endpoint with validation');
      assert.equal(r1!.signature, r2!.signature);
    });

    it('produces different signatures for different inputs', () => {
      const r1 = advisor.advise('Implement a new user registration endpoint');
      const r2 = advisor.advise('Refactor the entire payment processing module');
      assert.notEqual(r1!.signature, r2!.signature);
    });
  });

  describe('robustness', () => {
    const advisor = new MethodologyAdvisor();

    it('does not throw on extremely long input (> 10k chars)', () => {
      const huge = 'implement a feature ' + 'x'.repeat(20_000);
      const r = advisor.advise(huge);
      assert.notEqual(r, null);
    });

    it('does not throw on unicode / emoji-only', () => {
      const r = advisor.advise('🚀 build me a rocket launcher with safety checks 🛡️');
      assert.notEqual(r, null);
    });

    it('isEnabled reflects setEnabled toggle', () => {
      const a = new MethodologyAdvisor();
      assert.equal(a.isEnabled(), true);
      a.setEnabled(false);
      assert.equal(a.isEnabled(), false);
      assert.equal(a.advise('refactor the auth module to remove duplicated code'), null);
      a.setEnabled(true);
      assert.notEqual(a.advise('refactor the auth module to remove duplicated code'), null);
    });
  });
});
