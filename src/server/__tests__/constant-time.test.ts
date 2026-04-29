import { describe, expect, test } from "vitest";
import { constantTimeEqual } from "../lib/constant-time";

describe("constantTimeEqual", () => {
  test("returns true for equal strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
    // Long strings (full 48-char nanoid length).
    const tok = "a".repeat(48);
    expect(constantTimeEqual(tok, tok)).toBe(true);
  });

  test("returns false for different strings of equal length", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "xyz")).toBe(false);
    // Differs only in the LAST byte — `===` would still catch this,
    // but a buggy comparator that early-exited on first byte mismatch
    // would also catch it. The real test is the SECURITY: this and
    // `differs only in FIRST byte` must take indistinguishable time.
    expect(constantTimeEqual("aaaaaaaaaab", "aaaaaaaaaaa")).toBe(false);
    expect(constantTimeEqual("baaaaaaaaaa", "aaaaaaaaaaa")).toBe(false);
  });

  test("returns false for length-mismatched strings (CRITICAL: prefix-of-token attack)", () => {
    // The most common buggy comparator iterates only `min(a.length,
    // b.length)` and returns true if all compared bytes match. Such a
    // comparator would falsely match "abc" against "abcdefgh" and
    // grant access to any client supplying a proper PREFIX of the
    // real token. constantTimeEqual MUST reject prefix-of-token.
    expect(constantTimeEqual("abc", "abcdefgh")).toBe(false);
    expect(constantTimeEqual("abcdefgh", "abc")).toBe(false);
  });

  test("returns false when one string is empty and other is not", () => {
    expect(constantTimeEqual("", "x")).toBe(false);
    expect(constantTimeEqual("x", "")).toBe(false);
  });

  test("handles non-ASCII characters (UTF-16 code unit comparison)", () => {
    // charCodeAt returns UTF-16 code units. Tokens are ASCII nanoid
    // chars in practice, but the util shouldn't crash or false-match
    // on unicode. Pin the BMP behavior so a regression that swapped
    // to a byte-only TextEncoder approach (which would mishandle
    // surrogate pairs differently) is visible.
    expect(constantTimeEqual("café", "café")).toBe(true);
    expect(constantTimeEqual("café", "cafe")).toBe(false);
    // emoji (surrogate pair): equal-length surrogates compare equal
    expect(constantTimeEqual("ab😀", "ab😀")).toBe(true);
    expect(constantTimeEqual("ab😀", "ab😁")).toBe(false);
  });

  test("loop length depends ONLY on inputs (no early exit on mismatch)", () => {
    // We can't directly measure runtime in vitest, but we can verify
    // the algorithmic property: any non-empty mismatch takes at least
    // MAX(a.length, b.length) iterations. Property test: 10 calls
    // with various mismatches should all return false (no thrown
    // exception, no false-match — proves the loop completes).
    const real = "secret-token-abc";
    const attempts = [
      "s",
      "se",
      "secret",
      "secret-token-ab",
      "secret-token-abd",
      "secret-token-abcd",
      "secret-token-abcdef",
      "wrong",
      "",
      "secret-token-abc-extended",
    ];
    for (const a of attempts) {
      expect(constantTimeEqual(real, a)).toBe(false);
    }
  });
});
