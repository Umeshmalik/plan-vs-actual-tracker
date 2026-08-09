/**
 * THE password policy, pure so the sign-up meter renders the exact rule the
 * server enforces. Shaped after NIST 800-63B: length scores heavily, no
 * character-class mandate (that rule produces `Password1!`). Sign-IN never
 * applies it — see domain/users.ts.
 */

/** 2 = "Fair". */
export const MIN_SCORE = 2;

export const MIN_LENGTH = 8;

export const STRENGTH_LABELS = ["Too weak", "Weak", "Fair", "Strong", "Very strong"] as const;

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: (typeof STRENGTH_LABELS)[number];
  /** Present whenever the score is below MIN_SCORE: what to change. */
  hint?: string;
}

/** Not a control on its own, but it stops the handful a real person types. */
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

/** `email` is optional context: a password built out of its own address is worth nothing. */
export function passwordStrength(password: string, email?: string): Strength {
  const pw = password ?? "";
  if (pw.length < MIN_LENGTH) return weak(0, `Use at least ${MIN_LENGTH} characters.`);

  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return weak(0, "That is one of the most-guessed passwords. Pick something else.");
  if (/^(.)\1+$/.test(pw)) return weak(0, "One repeated character is not a password.");
  if (isSequential(lower)) return weak(0, "A straight run of characters is guessed first.");

  const local = email?.trim().toLowerCase().split("@")[0] ?? "";
  if (local.length >= 3 && lower.includes(local))
    return weak(1, "Leave your email address out of your password.");

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(re => re.test(pw)).length;

  // Length first, variety as one bonus: a long passphrase beats a short one
  // wearing punctuation.
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

export const isStrongEnough = (password: string, email?: string) =>
  passwordStrength(password, email).score >= MIN_SCORE;
