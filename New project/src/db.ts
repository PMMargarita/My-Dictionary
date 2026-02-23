import { Topic, WordEntry } from "./types";

const DB_NAME = "vocab_builder";
const DB_VERSION = 1;
const TOPICS_STORE = "topics";
const WORDS_STORE = "words";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TOPICS_STORE)) {
        db.createObjectStore(TOPICS_STORE, { keyPath: "topicId" });
      }
      if (!db.objectStoreNames.contains(WORDS_STORE)) {
        const store = db.createObjectStore(WORDS_STORE, { keyPath: "id" });
        store.createIndex("topicId", "topicId", { unique: false });
        store.createIndex("dueAt", "dueAt", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function withStore<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      })
  );
}

export function getAllTopics(): Promise<Topic[]> {
  return withStore<Topic[]>(TOPICS_STORE, "readonly", (store) => store.getAll());
}

export function getAllWords(): Promise<WordEntry[]> {
  return withStore<WordEntry[]>(WORDS_STORE, "readonly", (store) => store.getAll());
}

export function putTopic(topic: Topic): Promise<void> {
  return withStore<void>(TOPICS_STORE, "readwrite", (store) => store.put(topic));
}

export function putWord(word: WordEntry): Promise<void> {
  return withStore<void>(WORDS_STORE, "readwrite", (store) => store.put(word));
}

export function deleteWord(id: string): Promise<void> {
  return withStore<void>(WORDS_STORE, "readwrite", (store) => store.delete(id));
}

export function deleteTopic(topicId: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([TOPICS_STORE, WORDS_STORE], "readwrite");
        const topics = tx.objectStore(TOPICS_STORE);
        const words = tx.objectStore(WORDS_STORE);
        topics.delete(topicId);
        const index = words.index("topicId");
        const request = index.openCursor(IDBKeyRange.only(topicId));
        request.onsuccess = () => {
          const cursor = request.result as IDBCursorWithValue | null;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

export function clearAll(): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([TOPICS_STORE, WORDS_STORE], "readwrite");
        tx.objectStore(TOPICS_STORE).clear();
        tx.objectStore(WORDS_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}
