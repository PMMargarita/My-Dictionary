import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AppData,
  Rating,
  SessionConfig,
  SessionStats,
  Topic,
  TrainingMode,
  WordEntry,
  WordStatus,
} from "./types";
import { applyRating, isDue } from "./srs";
import {
  addUnique,
  createTopic,
  createWord,
  maskWord,
  normalizeInput,
  nowIso,
  pickRandom,
} from "./utils";
import {
  clearAll,
  deleteTopic,
  deleteWord,
  getAllTopics,
  getAllWords,
  putTopic,
  putWord,
} from "./db";

const DEFAULT_SESSION_SIZE = 20;
const SCHEMA_VERSION = 1;
const MODES: TrainingMode[] = ["flashcards", "fill_blank", "spelling", "sentence"];

const emptyConfig: SessionConfig = {
  size: DEFAULT_SESSION_SIZE,
  mode: "mixed",
  topicId: "all",
  tags: [],
};

const emptyStats = (): SessionStats => ({
  total: 0,
  answered: 0,
  correct: 0,
  dueDone: 0,
  newIntroduced: 0,
  movedCompleted: 0,
  lapses: 0,
  startedAt: Date.now(),
  finishedAt: null,
});

type SessionItem = {
  id: string;
  mode: TrainingMode;
  origin: "due" | "in_progress" | "new";
};

export default function App() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [words, setWords] = useState<WordEntry[]>([]);
  const [view, setView] = useState<"manage" | "train" | "stats">("manage");
  const [topicName, setTopicName] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState<string | "all">("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [wordDraft, setWordDraft] = useState<WordEntry | null>(null);
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [sessionConfig, setSessionConfig] = useState<SessionConfig>(emptyConfig);
  const [sessionQueue, setSessionQueue] = useState<SessionItem[]>([]);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessionStats, setSessionStats] = useState<SessionStats>(emptyStats());
  const sessionTimerRef = useRef<number | null>(null);
  const [sessionAttempts, setSessionAttempts] = useState<Record<string, number>>({});
  const [sessionSeen, setSessionSeen] = useState<Record<string, boolean>>({});
  const [sessionMode, setSessionMode] = useState<TrainingMode>("flashcards");
  const [answer, setAnswer] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [hintStep, setHintStep] = useState(0);
  const [pendingRating, setPendingRating] = useState<Rating | null>(null);
  const [lenient, setLenient] = useState(true);
  const [spellingPrompt, setSpellingPrompt] = useState<"meaning" | "translation">("meaning");
  const [spellingMistakes, setSpellingMistakes] = useState(0);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([getAllTopics(), getAllWords()]).then(([loadedTopics, loadedWords]) => {
      setTopics(loadedTopics);
      setWords(loadedWords);
      if (loadedTopics.length > 0 && selectedTopicId === "all") {
        setWordDraft(createWord(loadedTopics[0].topicId));
      }
    });
  }, []);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    words.forEach((word) => word.tags.forEach((tag) => tags.add(tag)));
    return Array.from(tags).sort();
  }, [words]);

  const filteredWords = useMemo(() => {
    return words.filter((word) => {
      if (selectedTopicId !== "all" && word.topicId !== selectedTopicId) return false;
      if (selectedTags.length > 0) {
        const hasTag = selectedTags.some((tag) => word.tags.includes(tag));
        if (!hasTag) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${word.wordOrPhrase} ${word.meaningEn} ${word.translationUk} ${word.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [words, selectedTopicId, selectedTags, searchQuery]);

  const stats = useMemo(() => buildOverallStats(words), [words]);

  function notify(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(""), 2200);
  }

  async function handleAddTopic() {
    if (!topicName.trim()) return;
    const topic = createTopic(topicName);
    await putTopic(topic);
    setTopics((prev) => [...prev, topic]);
    setTopicName("");
    if (!wordDraft) {
      setWordDraft(createWord(topic.topicId));
    }
  }

  async function handleDeleteTopic(topicId: string) {
    if (!confirm("Delete topic and all words inside?")) return;
    await deleteTopic(topicId);
    setTopics((prev) => prev.filter((t) => t.topicId !== topicId));
    setWords((prev) => prev.filter((w) => w.topicId !== topicId));
    if (selectedTopicId === topicId) {
      setSelectedTopicId("all");
    }
  }

  async function handleSaveWord() {
    if (!wordDraft) return;
    if (!wordDraft.topicId) return;
    if (!wordDraft.wordOrPhrase.trim() || !wordDraft.meaningEn.trim()) {
      notify("Word and meaning are required.");
      return;
    }
    const draft = { ...wordDraft };
    if (!draft.createdAt) draft.createdAt = nowIso();
    draft.updatedAt = nowIso();
    await putWord(draft);
    setWords((prev) => {
      const exists = prev.some((w) => w.id === draft.id);
      return exists ? prev.map((w) => (w.id === draft.id ? draft : w)) : [...prev, draft];
    });
    setEditingWordId(null);
    setWordDraft(createWord(draft.topicId));
    notify("Saved.");
  }

  async function handleEditWord(word: WordEntry) {
    setEditingWordId(word.id);
    setWordDraft({ ...word });
  }

  async function handleDeleteWord(id: string) {
    if (!confirm("Delete this word?")) return;
    await deleteWord(id);
    setWords((prev) => prev.filter((w) => w.id !== id));
  }

  function handleAddTag(value: string) {
    if (!wordDraft) return;
    const updated = { ...wordDraft, tags: addUnique(wordDraft.tags, value) };
    setWordDraft(updated);
  }

  function handleRemoveTag(tag: string) {
    if (!wordDraft) return;
    const updated = { ...wordDraft, tags: wordDraft.tags.filter((t) => t !== tag) };
    setWordDraft(updated);
  }

  function handleStartSession() {
    const selection = buildSession(words, sessionConfig);
    if (selection.length === 0) {
      notify("No words match the current filters.");
      return;
    }
    if (sessionTimerRef.current) {
      window.clearTimeout(sessionTimerRef.current);
    }
    setSessionQueue(selection);
    setSessionIndex(0);
    setSessionStats({ ...emptyStats(), total: selection.length, startedAt: Date.now() });
    setSessionAttempts({});
    setSessionSeen({});
    setView("train");
    resetCardState(selection[0]);
    sessionTimerRef.current = window.setTimeout(() => {
      setSessionStats((prev) => ({ ...prev, finishedAt: Date.now() }));
      notify("Session timed out after 10 minutes.");
      setView("stats");
    }, 10 * 60 * 1000);
  }

  function resetCardState(item: SessionItem) {
    setSessionMode(item.mode);
    setAnswer("");
    setShowAnswer(false);
    setHintStep(0);
    setPendingRating(null);
    setSpellingPrompt("meaning");
    setSpellingMistakes(0);
  }

  function currentItem(): SessionItem | null {
    return sessionQueue[sessionIndex] ?? null;
  }

  function currentWord(): WordEntry | null {
    const item = currentItem();
    if (!item) return null;
    return words.find((w) => w.id === item.id) ?? null;
  }

  function advanceSession() {
    const nextIndex = sessionIndex + 1;
    if (nextIndex >= sessionQueue.length) {
      setSessionStats((prev) => ({ ...prev, finishedAt: Date.now() }));
      if (sessionTimerRef.current) {
        window.clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
      notify("Session complete.");
      return;
    }
    setSessionIndex(nextIndex);
    resetCardState(sessionQueue[nextIndex]);
  }

  async function handleRating(rating: Rating, manualAnswer?: string) {
    const item = currentItem();
    const word = currentWord();
    if (!item || !word) return;

    const now = new Date();
    const alreadySeen = sessionSeen[word.id];

    const isNewIntro = word.status === "new" && !alreadySeen;
    const updatedBase = applyRating(word, rating, now);

    let updated: WordEntry = {
      ...updatedBase,
      rightCount: rating === "again" ? word.rightCount : word.rightCount + 1,
      wrongCount: rating === "again" ? word.wrongCount + 1 : word.wrongCount,
      skipCount: rating === "again" && manualAnswer === "skip" ? word.skipCount + 1 : word.skipCount,
    };

    if (rating === "again" && word.status === "completed") {
      updated.status = "in_progress";
    }

    if (isNewIntro) {
      updated.status = "in_progress";
    }

    if (rating === "again") {
      setSessionStats((prev) => ({ ...prev, lapses: prev.lapses + 1 }));
    }

    if (updated.status === "completed" && word.status !== "completed") {
      setSessionStats((prev) => ({ ...prev, movedCompleted: prev.movedCompleted + 1 }));
    }

    if (isNewIntro) {
      setSessionStats((prev) => ({ ...prev, newIntroduced: prev.newIntroduced + 1 }));
    }

    if (item.origin === "due") {
      setSessionStats((prev) => ({ ...prev, dueDone: prev.dueDone + 1 }));
    }

    const accuracyIncrement = rating === "again" ? 0 : 1;
    setSessionStats((prev) => ({
      ...prev,
      answered: prev.answered + 1,
      correct: prev.correct + accuracyIncrement,
    }));

    await putWord(updated);
    setWords((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
    setSessionSeen((prev) => ({ ...prev, [word.id]: true }));

    if (rating === "again") {
      const attempts = (sessionAttempts[word.id] ?? 0) + 1;
      setSessionAttempts((prev) => ({ ...prev, [word.id]: attempts }));
      if (attempts >= 3) {
        const postponed = {
          ...updated,
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: nowIso(),
        };
        await putWord(postponed);
        setWords((prev) => prev.map((w) => (w.id === postponed.id ? postponed : w)));
        advanceSession();
        return;
      }
      const offset = 5 + Math.floor(Math.random() * 3);
      const insertAt = Math.min(sessionQueue.length, sessionIndex + offset);
      const reinsertion: SessionItem = { ...item };
      setSessionQueue((prev) => {
        const next = [...prev];
        next.splice(insertAt, 0, reinsertion);
        return next;
      });
      advanceSession();
      return;
    }

    advanceSession();
  }

  function handleSkip() {
    handleRating("again", "skip");
  }

  function handleSubmit() {
    const word = currentWord();
    const item = currentItem();
    if (!word || !item) return;
    if (pendingRating) return;
    const normalizedAnswer = normalizeInput(answer);
    const normalizedWord = normalizeInput(word.wordOrPhrase);
    const usedHints = hintStep >= 2;

    if (item.mode === "fill_blank" || item.mode === "spelling") {
      const isCorrect = normalizedAnswer === normalizedWord || (lenient && isLenientMatch(normalizedAnswer, normalizedWord));
      if (!isCorrect) {
        if (item.mode === "spelling") {
          const nextMistakes = spellingMistakes + 1;
          setSpellingMistakes(nextMistakes);
          if (nextMistakes >= 2) {
            setPendingRating("again");
            setShowAnswer(true);
            return;
          }
        }
        setPendingRating("again");
        setShowAnswer(true);
        return;
      }
      const rating: Rating = usedHints ? "hard" : "good";
      setPendingRating(rating);
      setShowAnswer(true);
      return;
    }
  }

  function handleContinue() {
    if (pendingRating) {
      handleRating(pendingRating);
    }
  }

  async function handleExport() {
    const data: AppData = {
      schemaVersion: SCHEMA_VERSION,
      topics,
      words,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vocab-builder-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File) {
    const text = await file.text();
    const parsed = JSON.parse(text) as AppData;
    if (!parsed || !Array.isArray(parsed.topics) || !Array.isArray(parsed.words)) {
      notify("Invalid schema.");
      return;
    }
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      notify("Schema version mismatch. Only v1 supported.");
      return;
    }

    if (importMode === "replace") {
      await clearAll();
      for (const topic of parsed.topics) {
        await putTopic(topic);
      }
      for (const word of parsed.words) {
        await putWord(word);
      }
      setTopics(parsed.topics);
      setWords(parsed.words);
      notify("Imported (replace)." );
      return;
    }

    const topicMap = new Map(parsed.topics.map((t) => [t.topicId, t]));
    const wordMap = new Map(parsed.words.map((w) => [w.id, w]));

    for (const topic of topics) {
      topicMap.set(topic.topicId, topic);
    }
    for (const word of words) {
      wordMap.set(word.id, word);
    }

    const mergedTopics = Array.from(topicMap.values());
    const mergedWords = Array.from(wordMap.values());

    for (const topic of mergedTopics) {
      await putTopic(topic);
    }
    for (const word of mergedWords) {
      await putWord(word);
    }

    setTopics(mergedTopics);
    setWords(mergedWords);
    notify("Imported (merge).");
  }

  function renderTraining() {
    const item = currentItem();
    const word = currentWord();
    if (!item || !word) {
      return (
        <div className="panel">
          <h2>Training</h2>
          <p>No active session. Start one from Manage.</p>
        </div>
      );
    }

    const hintList = [
      word.transcription ? `Transcription: ${word.transcription}` : "Transcription: —",
      `First letter: ${word.wordOrPhrase.trim().charAt(0) || "—"}`,
      `Mask: ${maskWord(word.wordOrPhrase)}`,
      `Ukrainian: ${word.translationUk || "—"}`,
    ];

    const hintsToShow = hintList.slice(0, hintStep);

    return (
      <div className="panel">
        <div className="session-header">
          <div>
            <h2>Training Session</h2>
            <p>
              Question {sessionIndex + 1} / {sessionQueue.length}
            </p>
          </div>
          <div>
            <p>Mode: {item.mode.replace("_", " ")}</p>
            <p>
              Accuracy: {sessionStats.answered === 0 ? 0 : Math.round((sessionStats.correct / sessionStats.answered) * 100)}%
            </p>
          </div>
        </div>

        <div className="card">
          {item.mode === "flashcards" && (
            <>
              <div className="card-front">
                <h3>{word.wordOrPhrase || "—"}</h3>
                <p className="muted">{word.transcription}</p>
                <div className="button-row">
                  <button className="btn" onClick={() => setShowAnswer(true)}>Show answer</button>
                  <button className="btn ghost" onClick={() => setHintStep((s) => Math.min(4, s + 1))}>Show hint</button>
                  <button className="btn ghost" onClick={handleSkip}>Skip</button>
                </div>
              </div>
              {showAnswer && (
                <div className="card-back">
                  <p className="label">Meaning (EN)</p>
                  <p>{word.meaningEn || "—"}</p>
                  <p className="label">Translation (UK)</p>
                  <p>{word.translationUk || "—"}</p>
                  <p className="label">Example</p>
                  <p>{word.exampleUsage || "—"}</p>
                  <div className="button-row">
                    <button className="btn danger" onClick={() => handleRating("again")}>Again</button>
                    <button className="btn" onClick={() => handleRating("hard")}>Hard</button>
                    <button className="btn" onClick={() => handleRating("good")}>Good</button>
                    <button className="btn" onClick={() => handleRating("easy")}>Easy</button>
                    <button className="btn ghost" onClick={handleSkip}>Skip</button>
                  </div>
                </div>
              )}
            </>
          )}

          {item.mode === "fill_blank" && (
            <>
              <h3>Fill in the blank</h3>
              <p>{makeBlank(word.exampleUsage, word.wordOrPhrase)}</p>
              <p className="muted">Meaning: {word.meaningEn}</p>
              <input
                className="input"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type the missing word"
              />
              <div className="button-row">
                <button className="btn" onClick={handleSubmit}>Submit</button>
                <button className="btn ghost" onClick={() => setHintStep((s) => Math.min(4, s + 1))}>Show hint</button>
                <button className="btn ghost" onClick={handleSkip}>I don't know</button>
                <button className="btn ghost" onClick={handleSkip}>Skip</button>
              </div>
            </>
          )}

          {item.mode === "spelling" && (
            <>
              <h3>Spelling quiz</h3>
              <p>
                Prompt: {spellingPrompt === "meaning" ? word.meaningEn : word.translationUk}
              </p>
              <button className="btn ghost" onClick={() => setSpellingPrompt((p) => (p === "meaning" ? "translation" : "meaning"))}>
                Switch prompt
              </button>
              <input
                className="input"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type the word"
              />
              <div className="button-row">
                <button className="btn" onClick={handleSubmit}>Submit</button>
                <button className="btn ghost" onClick={() => setHintStep((s) => Math.min(4, s + 1))}>Show hint</button>
                <button className="btn ghost" onClick={handleSkip}>I don't know</button>
                <button className="btn ghost" onClick={handleSkip}>Skip</button>
              </div>
            </>
          )}

          {item.mode === "sentence" && (
            <>
              <h3>Sentence writing</h3>
              <p className="label">Meaning (EN)</p>
              <p>{word.meaningEn}</p>
              <button className="btn ghost" onClick={() => setShowAnswer((prev) => !prev)}>
                {showAnswer ? "Hide translation" : "Show translation"}
              </button>
              {showAnswer && <p>{word.translationUk}</p>}
              <textarea
                className="input"
                rows={4}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Write your sentence"
              />
              <div className="button-row">
                <button className="btn" onClick={() => handleRating(hintStep >= 2 ? "hard" : "good")}>Done</button>
                <button className="btn" onClick={() => handleRating("hard")}>Not sure</button>
                <button className="btn danger" onClick={() => handleRating("again")}>I don't know</button>
                <button className="btn ghost" onClick={() => setHintStep((s) => Math.min(4, s + 1))}>Show hint</button>
                <button className="btn ghost" onClick={handleSkip}>Skip</button>
              </div>
            </>
          )}

          {hintsToShow.length > 0 && (
            <div className="hints">
              {hintsToShow.map((hint) => (
                <p key={hint}>{hint}</p>
              ))}
              {hintStep >= 2 && <p className="muted">Hint limit reached: max rating Hard.</p>}
            </div>
          )}

          {(item.mode === "fill_blank" || item.mode === "spelling") && showAnswer && (
            <div className="answer-card">
              <p className="label">Correct</p>
              <p>{word.wordOrPhrase}</p>
              <p className="label">Meaning</p>
              <p>{word.meaningEn}</p>
              <p className="label">Translation</p>
              <p>{word.translationUk}</p>
              <p className="label">Example</p>
              <p>{word.exampleUsage}</p>
              <div className="button-row">
                <button className="btn" onClick={handleContinue}>Continue</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Vocabulary Builder</h1>
          <p className="muted">English → Ukrainian · Local SRS · IndexedDB</p>
        </div>
        <nav className="tabs">
          <button className={view === "manage" ? "tab active" : "tab"} onClick={() => setView("manage")}>
            Manage
          </button>
          <button className={view === "train" ? "tab active" : "tab"} onClick={() => setView("train")}>
            Train
          </button>
          <button className={view === "stats" ? "tab active" : "tab"} onClick={() => setView("stats")}>
            Stats
          </button>
        </nav>
      </header>

      {message && <div className="toast">{message}</div>}

      {view === "manage" && (
        <div className="grid">
          <section className="panel">
            <h2>Topics</h2>
            <div className="row">
              <input
                className="input"
                value={topicName}
                onChange={(e) => setTopicName(e.target.value)}
                placeholder="New topic"
              />
              <button className="btn" onClick={handleAddTopic}>Add</button>
            </div>
            <ul className="list">
              {topics.map((topic) => (
                <li key={topic.topicId} className="list-item">
                  <span>{topic.name}</span>
                  <button className="btn ghost" onClick={() => handleDeleteTopic(topic.topicId)}>Delete</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Words</h2>
            {topics.length === 0 ? (
              <p>Create a topic first.</p>
            ) : (
              <>
                <div className="word-form">
                  <div className="row">
                    <label>
                      Topic
                      <select
                        value={wordDraft?.topicId ?? ""}
                        onChange={(e) => setWordDraft((prev) => (prev ? { ...prev, topicId: e.target.value } : null))}
                      >
                        {topics.map((topic) => (
                          <option key={topic.topicId} value={topic.topicId}>
                            {topic.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="row">
                    <label>
                      Word or phrase
                      <input
                        className="input"
                        value={wordDraft?.wordOrPhrase ?? ""}
                        onChange={(e) => setWordDraft((prev) => (prev ? { ...prev, wordOrPhrase: e.target.value } : null))}
                      />
                    </label>
                    <label>
                      Transcription
                      <input
                        className="input"
                        value={wordDraft?.transcription ?? ""}
                        onChange={(e) => setWordDraft((prev) => (prev ? { ...prev, transcription: e.target.value } : null))}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label>
                      Meaning (EN)
                      <input
                        className="input"
                        value={wordDraft?.meaningEn ?? ""}
                        onChange={(e) => setWordDraft((prev) => (prev ? { ...prev, meaningEn: e.target.value } : null))}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label>
                      Example
                      <input
                        className="input"
                        value={wordDraft?.exampleUsage ?? ""}
                        onChange={(e) => setWordDraft((prev) => (prev ? { ...prev, exampleUsage: e.target.value } : null))}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label>
                      Translation (UK)
                      <input
                        className="input"
                        value={wordDraft?.translationUk ?? ""}
                        onChange={(e) => setWordDraft((prev) => (prev ? { ...prev, translationUk: e.target.value } : null))}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label>
                      Tags (comma separated)
                      <input
                        className="input"
                        value={wordDraft?.tags.join(", ") ?? ""}
                        onChange={(e) =>
                          setWordDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  tags: e.target.value
                                    .split(",")
                                    .map((t) => t.trim())
                                    .filter(Boolean),
                                }
                              : null
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="row">
                    <button className="btn" onClick={handleSaveWord}>
                      {editingWordId ? "Update" : "Add word"}
                    </button>
                  </div>
                </div>

                <div className="filters">
                  <label>
                    Topic
                    <select value={selectedTopicId} onChange={(e) => setSelectedTopicId(e.target.value as string)}>
                      <option value="all">All topics</option>
                      {topics.map((topic) => (
                        <option key={topic.topicId} value={topic.topicId}>
                          {topic.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Search
                    <input className="input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                  </label>
                  <label>
                    Tags
                    <select
                      multiple
                      value={selectedTags}
                      onChange={(e) =>
                        setSelectedTags(Array.from(e.target.selectedOptions).map((opt) => opt.value))
                      }
                    >
                      {allTags.map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="table">
                  {filteredWords.map((word) => (
                    <div key={word.id} className="table-row">
                      <div>
                        <strong>{word.wordOrPhrase}</strong>
                        <p className="muted">{word.meaningEn}</p>
                        <p className="muted">{word.tags.join(", ")}</p>
                      </div>
                      <div>
                        <p>Status: {word.status}</p>
                        <p>Due: {word.dueAt ? new Date(word.dueAt).toLocaleDateString() : "—"}</p>
                      </div>
                      <div className="row">
                        <button className="btn ghost" onClick={() => handleEditWord(word)}>Edit</button>
                        <button className="btn ghost" onClick={() => handleDeleteWord(word.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="panel">
            <h2>Training Setup</h2>
            <label>
              Session size
              <input
                className="input"
                type="number"
                min={5}
                max={50}
                value={sessionConfig.size}
                onChange={(e) => setSessionConfig((prev) => ({ ...prev, size: Number(e.target.value) }))}
              />
            </label>
            <label>
              Mode
              <select
                value={sessionConfig.mode}
                onChange={(e) => setSessionConfig((prev) => ({ ...prev, mode: e.target.value as SessionConfig["mode"] }))}
              >
                <option value="mixed">Mixed</option>
                {MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Topic filter
              <select
                value={sessionConfig.topicId}
                onChange={(e) => setSessionConfig((prev) => ({ ...prev, topicId: e.target.value as string }))}
              >
                <option value="all">All topics</option>
                {topics.map((topic) => (
                  <option key={topic.topicId} value={topic.topicId}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tag filter (any)
              <select
                multiple
                value={sessionConfig.tags}
                onChange={(e) =>
                  setSessionConfig((prev) => ({
                    ...prev,
                    tags: Array.from(e.target.selectedOptions).map((opt) => opt.value),
                  }))
                }
              >
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lenient phrase match
              <input type="checkbox" checked={lenient} onChange={(e) => setLenient(e.target.checked)} />
            </label>
            <div className="row">
              <button className="btn" onClick={handleStartSession}>Start session</button>
            </div>
            <div className="import-export">
              <button className="btn ghost" onClick={handleExport}>Export JSON</button>
              <label className="file-input">
                Import JSON
                <input type="file" accept="application/json" onChange={(e) => e.target.files && handleImport(e.target.files[0])} />
              </label>
              <select value={importMode} onChange={(e) => setImportMode(e.target.value as "merge" | "replace")}>
                <option value="merge">Merge</option>
                <option value="replace">Replace</option>
              </select>
            </div>
          </section>
        </div>
      )}

      {view === "train" && renderTraining()}

      {view === "stats" && (
        <div className="grid">
          <section className="panel">
            <h2>Session Stats</h2>
            {sessionStats.total === 0 ? (
              <p>No session yet.</p>
            ) : (
              <ul className="list">
                <li>Questions: {sessionStats.answered} / {sessionStats.total}</li>
                <li>Accuracy: {sessionStats.answered ? Math.round((sessionStats.correct / sessionStats.answered) * 100) : 0}%</li>
                <li>Due done: {sessionStats.dueDone}</li>
                <li>New introduced: {sessionStats.newIntroduced}</li>
                <li>Moved to completed: {sessionStats.movedCompleted}</li>
                <li>Lapses: {sessionStats.lapses}</li>
                <li>Duration: {sessionStats.finishedAt ? Math.round((sessionStats.finishedAt - sessionStats.startedAt) / 60000) : 0} min</li>
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Overall</h2>
            <ul className="list">
              <li>New: {stats.byStatus.new}</li>
              <li>In progress: {stats.byStatus.in_progress}</li>
              <li>Completed: {stats.byStatus.completed}</li>
              <li>Due today: {stats.dueToday}</li>
              <li>Due this week: {stats.dueWeek}</li>
            </ul>
          </section>

          <section className="panel">
            <h2>Hardest words</h2>
            <ul className="list">
              {stats.hardest.map((word) => (
                <li key={word.id}>
                  {word.wordOrPhrase} — lapses {word.lapses}, wrong {word.wrongCount}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function buildOverallStats(words: WordEntry[]) {
  const byStatus: Record<WordStatus, number> = {
    new: 0,
    in_progress: 0,
    completed: 0,
  };
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  let dueToday = 0;
  let dueWeek = 0;

  words.forEach((word) => {
    byStatus[word.status] += 1;
    if (word.dueAt) {
      const due = new Date(word.dueAt);
      if (due <= endOfToday) dueToday += 1;
      if (due <= endOfWeek) dueWeek += 1;
    }
  });

  const hardest = [...words]
    .sort((a, b) => (b.lapses + b.wrongCount) - (a.lapses + a.wrongCount))
    .slice(0, 8);

  return { byStatus, dueToday, dueWeek, hardest };
}

function buildSession(words: WordEntry[], config: SessionConfig): SessionItem[] {
  const now = new Date();
  const filtered = words.filter((word) => {
    if (config.topicId !== "all" && word.topicId !== config.topicId) return false;
    if (config.tags.length > 0) {
      const hasTag = config.tags.some((tag) => word.tags.includes(tag));
      if (!hasTag) return false;
    }
    return true;
  });

  const due = filtered.filter((word) => word.status !== "new" && isDue(word, now));
  const inProgress = filtered.filter((word) => word.status === "in_progress" && !isDue(word, now));
  const newWords = filtered.filter((word) => word.status === "new");

  const dueSorted = due.sort((a, b) => {
    const aTime = a.dueAt ? new Date(a.dueAt).getTime() : 0;
    const bTime = b.dueAt ? new Date(b.dueAt).getTime() : 0;
    return aTime - bTime;
  });

  const inProgressSorted = inProgress.sort((a, b) =>
    (b.lapses + b.wrongCount) - (a.lapses + a.wrongCount)
  );

  const size = config.size;
  const dueTarget = Math.min(size, Math.round(size * 0.6));
  const inProgressTarget = Math.min(size - dueTarget, Math.round(size * 0.25));
  const newTarget = Math.max(0, size - dueTarget - inProgressTarget);

  const selection: SessionItem[] = [];
  const pushItem = (word: WordEntry, origin: SessionItem["origin"]) => {
    const mode = config.mode === "mixed" ? pickRandom(MODES) : config.mode;
    selection.push({ id: word.id, mode, origin });
  };

  dueSorted.slice(0, dueTarget).forEach((word) => pushItem(word, "due"));
  inProgressSorted.slice(0, inProgressTarget).forEach((word) => pushItem(word, "in_progress"));
  newWords.slice(0, newTarget).forEach((word) => pushItem(word, "new"));

  if (selection.length < size) {
    const remaining = filtered.filter((word) => !selection.some((s) => s.id === word.id));
    remaining.slice(0, size - selection.length).forEach((word) => pushItem(word, word.status === "new" ? "new" : "in_progress"));
  }

  return shuffle(selection);
}

function shuffle<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeBlank(sentence: string, target: string): string {
  if (!sentence) return "";
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "i");
  return sentence.replace(regex, "____");
}

function isLenientMatch(answer: string, target: string): boolean {
  if (!answer || !target) return false;
  if (answer === target) return true;
  const tokens = target.split(" ").filter((t) => t.length > 2);
  return tokens.some((token) => answer.includes(token));
}
