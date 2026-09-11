import { WorkflowState, StoredAsset } from '../types';

const DB_NAME = 'MetaExtensionDB';
const DB_VERSION = 1;
const ASSETS_STORE = 'assets';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAsset(
  id: string,
  blob: Blob,
  name: string
): Promise<StoredAsset> {
  const db = await openDB();
  const arrayBuffer = await blob.arrayBuffer();

  let dataUrl: string | undefined;
  if (blob.type.startsWith('image/')) {
    dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  let textSnippet: string | undefined;
  if (blob.type.startsWith('text/') || name.endsWith('.txt')) {
    const text = await blob.text();
    textSnippet = text.slice(0, 100);
  }

  const asset: StoredAsset = {
    id,
    name,
    size: blob.size,
    type: blob.type || 'application/octet-stream',
    dataUrl,
    textSnippet,
    createdAt: Date.now()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite');
    const store = tx.objectStore(ASSETS_STORE);
    store.put({ ...asset, data: arrayBuffer });
    tx.oncomplete = () => resolve(asset);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAssetBlob(id: string): Promise<{ asset: StoredAsset; blob: Blob } | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readonly');
    const store = tx.objectStore(ASSETS_STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const record = request.result;
      if (!record) {
        resolve(null);
        return;
      }
      const blob = new Blob([record.data], { type: record.type });
      resolve({
        asset: {
          id: record.id,
          name: record.name,
          size: record.size,
          type: record.type,
          dataUrl: record.dataUrl,
          textSnippet: record.textSnippet,
          createdAt: record.createdAt
        },
        blob
      });
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite');
    const store = tx.objectStore(ASSETS_STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllAssets(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite');
    const store = tx.objectStore(ASSETS_STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Chrome storage local state helpers
const STATE_STORAGE_KEY = 'meta_assistant_workflow_state';
const LEGACY_STORAGE_KEY = 'qwen_assistant_workflow_state';

export async function loadWorkflowState(): Promise<WorkflowState | null> {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return null;
  }
  return new Promise((resolve) => {
    chrome.storage.local.get([STATE_STORAGE_KEY, LEGACY_STORAGE_KEY], (result) => {
      resolve(result[STATE_STORAGE_KEY] || result[LEGACY_STORAGE_KEY] || null);
    });
  });
}

export async function saveWorkflowState(state: WorkflowState): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return;
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STATE_STORAGE_KEY]: state }, () => {
      resolve();
    });
  });
}
