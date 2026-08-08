/**
 * password.ts — THE password policy. One pure function, no dependencies, so the
 * sign-up form can render a live meter from exactly the rule the server will
 * enforce. (DRY, and the same instinct as locking: the UI may show it, but
 * `createUser` is what refuses.)
 *
 * The shape of the rule follows NIST 800-63B: length is what actually buys
 * entropy, so it is scored heavily, and a blocklist catches the passwords that
 * are guessed first regardless of how many character classes they contain.
 * There is deliberately no "must contain one uppercase and one symbol" mandate
 * — that rule produces `Password1!` and little else.
 *
 * Sign-IN never applies this. An account created before a policy change must
 * still be able to sign in, and refusing at the sign-in form would tell an
 * attacker their guess was well-formed but wrong.
 */

/** The score a new password must reach. 2 = "Fair". */
export const MIN_SCORE = 2;

/** Anything shorter cannot reach MIN_SCORE, and Zod rejects it first. */
export const MIN_LENGTH = 8;

export const STRENGTH_LABELS = ["Too weak", "Weak", "Fair", "Strong", "Very strong"] as const;

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: (typeof STRENGTH_LABELS)[number];
  /** Present whenever the score is below MIN_SCORE: what to change. */
  hint?: string;
}

/**
 * The passwords that top every breach corpus, plus the ones this app invites by
 * name. Not a security control on its own — an attacker's list is millions long
 * — but it costs nothing and stops the handful a real person actually types.
 */
const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "qwerty123",
  "iloveyou",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "welcome1",
  "welcome123",
  "admin123",
  "letmein1",
  "letmein123",
  "monkey123",
  "abc12345",
  "trustno1",
  "changeme",
  "secret123",
  "planvsactual",
]);

/** "abcdefgh", "12345678", "87654321" — a straight run in either direction. */
function isSequential(s: string): boolean {
  if (s.length < 4) return false;
  const step = s.charCodeAt(1) - s.charCodeAt(0);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < s.length; i++) if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return false;
  return true;
}

const weak = (score: 0 | 1, hint: string): Strength => ({ score, label: STRENGTH_LABELS[score], hint });

/**
 * Score a candidate password. `email` is optional context: a password built out
 * of the address it protects is worth nothing, and only the caller knows it.
 */
export function passwordStrength(password: string, email?: string): Strength {
  const pw = password ?? "";
  if (pw.length < MIN_LENGTH) return weak(0, `Use at least ${MIN_LENGTH} characters.`);

  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return weak(0, "That is one of the most-guessed passwords. Pick something else.");
  if (/^(.)\1+$/.test(pw)) return weak(0, "One repeated character is not a password.");
  if (isSequential(lower)) return weak(0, "A straight run of characters is guessed first.");

  // The local part of the address, when it is long enough to be distinctive.
  const local = email?.trim().toLowerCase().split("@")[0] ?? "";
  if (local.length >= 3 && lower.includes(local))
    return weak(1, "Leave your email address out of your password.");

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(re => re.test(pw)).length;

  // Length first, variety as a single bonus — a long passphrase of plain words
  // beats a short one wearing punctuation, and this scores it that way.
  let score = 1;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (classes >= 3) score++;

  const capped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
  return {
    score: capped,
    label: STRENGTH_LABELS[capped],
    hint:
      capped < MIN_SCORE
        ? `Make it longer (${MIN_LENGTH + 4}+ characters), or mix in a number or symbol.`
        : undefined,
  };
}

/** The one question callers actually ask. */
export const isStrongEnough = (password: string, email?: string) =>
  passwordStrength(password, email).score >= MIN_SCORE;
