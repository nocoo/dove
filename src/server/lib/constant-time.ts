/**
 * Constant-time string equality for secret comparison.
 *
 * Plain `===` exits early on the first mismatched byte, leaking secret
 * bytes via response-time differences. While exploitability against a
 * 48-char nanoid token over the noisy CF Workers network is low, OWASP
 * ASVS V6.2.4 / NIST SP 800-63B require constant-time comparison for
 * all secret/token equality checks.
 *
 * Algorithm: XOR every byte and OR into an accumulator; only return
 * after walking MAX(a.length, b.length) iterations (so the loop count
 * itself doesn't depend on the secret). Length-difference is folded
 * into the accumulator first so a 1-char vs 48-char comparison still
 * takes the full longer-string loop.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
