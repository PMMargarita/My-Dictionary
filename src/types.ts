export type WordStatus = "new" | "in_progress" | "completed";

export type Topic = {
  topicId: string;
  name: string;
  createdAt: string;
};

export type WordEntry = {
  id: string;
  topicId: string;
  wordOrPhrase: string;
  transcription: string;
  meaningEn: string;
  exampleUsage: string;
  translationUk: string;
  tags: string[];
  status: WordStatus;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  rightCount: number;
  wrongCount: number;
  skipCount: number;
  lastReviewedAt: string | null;
};

export type AppData = {
  schemaVersion: number;
  topics: Topic[];
  words: WordEntry[];
};

export type Rating = "again" | "hard" | "good" | "easy";

export type TrainingMode =
  | "flashcards"
  | "fill_blank"
  | "spelling"
  | "sentence";

export type SessionConfig = {
  size: number;
  mode: "mixed" | TrainingMode;
  topicId: string | "all";
  tags: string[];
};

export type SessionStats = {
  total: number;
  answered: number;
  correct: number;
  dueDone: number;
  newIntroduced: number;
  movedCompleted: number;
  lapses: number;
  startedAt: number;
  finishedAt: number | null;
};
