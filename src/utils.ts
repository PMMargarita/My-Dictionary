import { Topic, WordEntry } from "./types";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createTopic(name: string): Topic {
  return {
    topicId: uid(),
    name: name.trim(),
    createdAt: nowIso(),
  };
}

export function createWord(topicId: string): WordEntry {
  const now = nowIso();
  return {
    id: uid(),
    topicId,
    wordOrPhrase: "",
    transcription: "",
    meaningEn: "",
    exampleUsage: "",
    translationUk: "",
    tags: [],
    status: "new",
    createdAt: now,
    updatedAt: now,
    dueAt: null,
    intervalDays: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    rightCount: 0,
    wrongCount: 0,
    skipCount: 0,
    lastReviewedAt: null,
  };
}

export function normalizeInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, " ")
    .replace(/[.,!?;:()\[\]"“”'’]/g, "")
    .trim();
}

export function maskWord(value: string): string {
  const letters = value.replace(/\s+/g, " ").trim();
  return letters
    .split(" ")
    .map((chunk) => chunk.replace(/./g, "_"))
    .join(" ");
}

export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function addUnique(list: string[], value: string): string[] {
  const clean = value.trim();
  if (!clean) return list;
  if (list.includes(clean)) return list;
  return [...list, clean];
}
