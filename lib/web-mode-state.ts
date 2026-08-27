export interface ActiveGoal {
  objective: string;
  startedAt: number;
  completedAt?: number | null;
}

export interface ActivePlan {
  objective: string;
}

export function createActiveGoal(objective: string, startedAt = Date.now(), completedAt: number | null = null): ActiveGoal {
  return { objective: objective.trim(), startedAt, ...(completedAt != null ? { completedAt } : {}) };
}

/** Parse sessionStorage safely: user data and old versions must never break chat. */
export function parseActiveGoal(value: string | null): ActiveGoal | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const { objective, startedAt, completedAt } = parsed as Record<string, unknown>;
    if (typeof objective !== "string" || !objective.trim()
      || typeof startedAt !== "number" || !Number.isFinite(startedAt) || startedAt < 0) return null;
    const validCompletedAt = typeof completedAt === "number" && Number.isFinite(completedAt) && completedAt >= startedAt
      ? completedAt
      : null;
    return {
      objective,
      startedAt,
      ...(validCompletedAt != null ? { completedAt: validCompletedAt } : {}),
    };
  } catch {
    return null;
  }
}

export function formatGoalElapsed(elapsedMs: number): string {
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
