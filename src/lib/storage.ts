import type { RegionPack } from "../../packages/core/src/index";

export type Observation = {
  id: string;
  observedAt: string;
  commonName: string;
  scientificName?: string;
  confidence?: number;
  notes?: string;
  imageDataUrl?: string;
  coordinates?: [number, number];
  confirmed: boolean;
  model: string;
};

type PackRecord = {
  id: string;
  savedAt: string;
  pack: RegionPack;
};

const databaseName = "wildpack-local";
const databaseVersion = 1;

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(new Error("This browser does not support IndexedDB."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("packs")) {
        database.createObjectStore("packs", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("observations")) {
        database.createObjectStore("observations", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("Could not open local storage."),
    );
    request.onblocked = () => reject(
      new Error("A previous WildPack tab is blocking the storage upgrade."),
    );
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("The local storage request failed."),
    );
  });
}

export async function savePack(pack: RegionPack): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("packs", "readwrite");
    transaction.objectStore("packs").put({
      id: pack.manifest.slug,
      savedAt: new Date().toISOString(),
      pack,
    } satisfies PackRecord);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(
        transaction.error ?? new Error("Could not save the pack."),
      );
      transaction.onabort = () => reject(
        transaction.error ?? new Error("Pack saving was cancelled."),
      );
    });
  } finally {
    database.close();
  }
}

export async function loadPacks(): Promise<RegionPack[]> {
  const database = await openDatabase();
  try {
    const records = await requestResult<PackRecord[]>(
      database.transaction("packs", "readonly").objectStore("packs").getAll(),
    );
    return records.map((record) => record.pack);
  } finally {
    database.close();
  }
}

export async function loadPack(slug: string): Promise<RegionPack | undefined> {
  const database = await openDatabase();
  try {
    const record = await requestResult<PackRecord | undefined>(
      database.transaction("packs", "readonly").objectStore("packs").get(slug),
    );
    return record?.pack;
  } finally {
    database.close();
  }
}

export async function removePack(slug: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("packs", "readwrite");
    transaction.objectStore("packs").delete(slug);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(
        transaction.error ?? new Error("Could not remove the pack."),
      );
    });
  } finally {
    database.close();
  }
}

export async function loadObservations(): Promise<Observation[]> {
  const database = await openDatabase();
  try {
    return await requestResult<Observation[]>(
      database.transaction("observations", "readonly")
        .objectStore("observations").getAll(),
    );
  } finally {
    database.close();
  }
}

export async function saveObservation(observation: Observation): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("observations", "readwrite");
    transaction.objectStore("observations").put(observation);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(
        transaction.error ?? new Error("Could not save the observation."),
      );
    });
  } finally {
    database.close();
  }
}

export async function removeObservation(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("observations", "readwrite");
    transaction.objectStore("observations").delete(id);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(
        transaction.error ?? new Error("Could not remove the observation."),
      );
    });
  } finally {
    database.close();
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function getStorageEstimate(): Promise<{
  usage: number;
  quota: number;
} | undefined> {
  if (!navigator.storage?.estimate) return undefined;
  const estimate = await navigator.storage.estimate();
  return {
    usage: estimate.usage ?? 0,
    quota: estimate.quota ?? 0,
  };
}
