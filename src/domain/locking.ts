/**
 * THE lock guard, called from every mutating path: plan upsert/delete, actual
 * create/delete, CSV commit. The UI disables controls; THIS enforces.
 */
import { AppError } from "../lib/errors";
import type { ScopedRepo } from "./repo";

export async function assertPeriodUnlocked(repo: ScopedRepo, month: string) {
  if (await repo.isLocked(month)) {
    throw new AppError("PERIOD_LOCKED", `${month} is locked. Unlock the period before editing.`, { month });
  }
}

export async function assertMonthsUnlocked(repo: ScopedRepo, months: string[]) {
  for (const m of [...new Set(months)]) await assertPeriodUnlocked(repo, m);
}
