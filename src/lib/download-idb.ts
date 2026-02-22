/* eslint-disable no-undef */
'use client';

import { DownloadTask } from '@/lib/download-types';

const DB_NAME = 'decotv-downloads';
const DB_VERSION = 1;
const TASK_STORE = 'tasks';
const SEGMENT_STORE = 'segments';
const SEGMENT_TASK_INDEX = 'taskId';

interface SegmentRecord {
  key: string;
  taskId: string;
  index: number;
  blob: Blob;
  size: number;
}

function supportsIndexedDB(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
  );
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('IndexedDB request failed'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function openDatabase(): Promise<IDBDatabase> {
  if (!supportsIndexedDB()) {
    throw new Error('IndexedDB is not available');
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(TASK_STORE)) {
        db.createObjectStore(TASK_STORE, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(SEGMENT_STORE)) {
        const segmentStore = db.createObjectStore(SEGMENT_STORE, {
          keyPath: 'key',
        });
        segmentStore.createIndex(SEGMENT_TASK_INDEX, SEGMENT_TASK_INDEX, {
          unique: false,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('Failed to open IndexedDB'));
  });

  return dbPromise;
}

export async function loadDownloadTasksFromDB(): Promise<DownloadTask[]> {
  if (!supportsIndexedDB()) return [];
  const db = await openDatabase();
  const tx = db.transaction(TASK_STORE, 'readonly');
  const store = tx.objectStore(TASK_STORE);
  const rows = (await requestToPromise<DownloadTask[]>(store.getAll())) || [];
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveDownloadTaskToDB(task: DownloadTask): Promise<void> {
  if (!supportsIndexedDB()) return;
  const db = await openDatabase();
  const tx = db.transaction(TASK_STORE, 'readwrite');
  tx.objectStore(TASK_STORE).put(task);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error || new Error('Failed to save download task'));
    tx.onabort = () =>
      reject(tx.error || new Error('Transaction aborted while saving task'));
  });
}

export async function deleteDownloadTaskFromDB(taskId: string): Promise<void> {
  if (!supportsIndexedDB()) return;
  const db = await openDatabase();
  const tx = db.transaction(TASK_STORE, 'readwrite');
  tx.objectStore(TASK_STORE).delete(taskId);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error || new Error('Failed to delete download task'));
    tx.onabort = () =>
      reject(tx.error || new Error('Transaction aborted while deleting task'));
  });
}

export async function saveSegmentBlobToDB(
  taskId: string,
  index: number,
  blob: Blob,
): Promise<void> {
  if (!supportsIndexedDB()) return;
  const db = await openDatabase();
  const tx = db.transaction(SEGMENT_STORE, 'readwrite');
  const record: SegmentRecord = {
    key: `${taskId}:${index}`,
    taskId,
    index,
    blob,
    size: blob.size,
  };
  tx.objectStore(SEGMENT_STORE).put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error || new Error('Failed to save segment blob'));
    tx.onabort = () =>
      reject(
        tx.error || new Error('Transaction aborted while saving segment blob'),
      );
  });
}

export async function readSegmentBlobFromDB(
  taskId: string,
  index: number,
): Promise<Blob | null> {
  if (!supportsIndexedDB()) return null;
  const db = await openDatabase();
  const tx = db.transaction(SEGMENT_STORE, 'readonly');
  const store = tx.objectStore(SEGMENT_STORE);
  const row = await requestToPromise<SegmentRecord | undefined>(
    store.get(`${taskId}:${index}`),
  );
  return row?.blob || null;
}

export async function listDownloadedSegmentIndexesFromDB(
  taskId: string,
): Promise<number[]> {
  if (!supportsIndexedDB()) return [];
  const db = await openDatabase();
  const tx = db.transaction(SEGMENT_STORE, 'readonly');
  const index = tx.objectStore(SEGMENT_STORE).index(SEGMENT_TASK_INDEX);
  const rows =
    (await requestToPromise<SegmentRecord[]>(
      index.getAll(IDBKeyRange.only(taskId)),
    )) || [];
  rows.sort((a, b) => a.index - b.index);
  return rows.map((item) => item.index);
}

export async function getDownloadedBytesFromDB(
  taskId: string,
): Promise<number> {
  if (!supportsIndexedDB()) return 0;
  const db = await openDatabase();
  const tx = db.transaction(SEGMENT_STORE, 'readonly');
  const index = tx.objectStore(SEGMENT_STORE).index(SEGMENT_TASK_INDEX);
  const rows =
    (await requestToPromise<SegmentRecord[]>(
      index.getAll(IDBKeyRange.only(taskId)),
    )) || [];
  return rows.reduce((sum, item) => sum + (item.size || 0), 0);
}

export async function clearTaskSegmentsFromDB(taskId: string): Promise<void> {
  if (!supportsIndexedDB()) return;
  const db = await openDatabase();
  const tx = db.transaction(SEGMENT_STORE, 'readwrite');
  const index = tx.objectStore(SEGMENT_STORE).index(SEGMENT_TASK_INDEX);
  const rows =
    (await requestToPromise<SegmentRecord[]>(
      index.getAll(IDBKeyRange.only(taskId)),
    )) || [];
  const store = tx.objectStore(SEGMENT_STORE);
  rows.forEach((item) => {
    store.delete(item.key);
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error || new Error('Failed to clear task segments'));
    tx.onabort = () =>
      reject(
        tx.error || new Error('Transaction aborted while clearing segments'),
      );
  });
}
