import { Rating, WordEntry } from "./types";

const MIN_EASE = 1.3;

export function applyRating(word: WordEntry, rating: Rating, now: Date): WordEntry {
  const updated: WordEntry = { ...word };
  updated.lastReviewedAt = now.toISOString();

  if (rating === "again") {
    updated.reps = 0;
    updated.lapses = updated.lapses + 1;
    updated.ease = Math.max(MIN_EASE, updated.ease - 0.2);
    updated.intervalDays = 0;
    updated.dueAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  }

  if (rating === "hard") {
    updated.ease = Math.max(MIN_EASE, updated.ease - 0.05);
    updated.intervalDays = Math.max(1, Math.round(updated.intervalDays * 1.2));
    updated.dueAt = addDays(now, updated.intervalDays).toISOString();
    updated.reps = updated.reps + 1;
  }

  if (rating === "good") {
    if (updated.reps === 0) {
      updated.intervalDays = 1;
    } else if (updated.reps === 1) {
      updated.intervalDays = 3;
    } else {
      updated.intervalDays = Math.round(updated.intervalDays * updated.ease);
    }
    updated.dueAt = addDays(now, updated.intervalDays).toISOString();
    updated.reps = updated.reps + 1;
  }

  if (rating === "easy") {
    updated.ease = updated.ease + 0.1;
    updated.intervalDays = Math.max(4, Math.round(updated.intervalDays * updated.ease * 1.3));
    updated.dueAt = addDays(now, updated.intervalDays).toISOString();
    updated.reps = updated.reps + 1;
  }

  updated.updatedAt = now.toISOString();
  updated.status = resolveStatus(updated, rating);
  return updated;
}

export function resolveStatus(word: WordEntry, rating: Rating): WordEntry["status"] {
  if (word.status === "completed" && rating === "again") {
    return "in_progress";
  }
  if (word.reps >= 5 && word.intervalDays >= 21) {
    return "completed";
  }
  if (word.status === "new") {
    return "in_progress";
  }
  return word.status;
}

export function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isDue(word: WordEntry, now: Date): boolean {
  if (!word.dueAt) return true;
  return new Date(word.dueAt).getTime() <= now.getTime();
}
