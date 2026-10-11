import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  createWildpack,
  isForagingOrMedicalQuestion,
  readWildpack,
  retrieveChunks,
  type Chunk,
  type Poi,
  type RegionPack,
} from "../../packages/core/src/index";
import {
  GeofenceEngine,
  type GeofenceEvent,
  type LocationFix,
} from "../lib/geofence";
import { demoPack } from "../lib/demo-pack";
import {
  getStorageEstimate,
  loadObservations,
  loadPacks,
  removeObservation,
  removePack,
  requestPersistentStorage,
  saveObservation,
  savePack,
  type Observation,
} from "../lib/storage";
import {
  getNetworkUsage,
  subscribeNetworkUsage,
  trackedFetch,
  type NetworkUsage,
} from "../lib/telemetry";
import { distanceMeters } from "../../packages/core/src/index";

type Screen =
  | "catalog"
  | "walk"
  | "ask"
  | "field"
  | "journal"
  | "proof"
  | "settings"
  | "author";

type ApiError = { error?: { message?: string; code?: string } };
type AskResult = {
  answer: string;
  citations: string[];
  model: string;
  latencyMs: number;
};
type VisionResult = {
  candidates: Array<{
    commonName: string;
    scientificName: string;
    confidence: number;
    visibleTraits: string[];
  }>;
  observedTraits: string[];
  followUpQuestion: string;
  needsBetterPhoto: boolean;
  model: string;
  verified: false;
};
type ApiHealth = {
  status: string;
  checks: Record<string, "ok" | "unavailable" | "unconfigured">;
};
type AvailablePack = {
  slug: string;
  name: string;
  version: string;
  counts: { pois: number; species: number; chunks: number; audio: number };
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
};
type TranscriptEntry = {
  question: string;
  answer: string;
  citations: string[];
  model: string;
  latencyMs: number;
  createdAt: string;
};
type SpeechRecognitionResultItem = { transcript: string };
type SpeechRecognitionResultEvent = {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultItem>>;
};
type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type ExtendedWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const screens: Array<{ id: Screen; label: string; icon: string }> = [
  { id: "catalog", label: "Region packs", icon: "⌖" },
  { id: "walk", label: "Walk guide", icon: "↗" },
  { id: "ask", label: "Ask the guide", icon: "◌" },
  { id: "field", label: "Field notes", icon: "◎" },
  { id: "journal", label: "Observation journal", icon: "▤" },
  { id: "proof", label: "Open Proof", icon: "◈" },
  { id: "settings", label: "Settings & privacy", icon: "⚙" },
  { id: "author", label: "Build a pack", icon: "+" },
];

const safetyResponse =
  "I can’t advise on eating, touching, foraging, or using plants, fungi, or wildlife. Please leave it undisturbed and consult a qualified local expert.";

function bytesLabel(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function downloadFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = payload as ApiError;
    throw new Error(
      error.error?.message ?? `Request failed (${response.status}).`,
    );
  }
  return payload as T;
}

function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

async function downscaleImage(file: File): Promise<string> {
  const image = new Image();
  const source = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The selected image could not be read."));
      image.src = source;
    });
    const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot process the selected image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(source);
  }
}

function App() {
  const [screen, setScreen] = useState<Screen>("catalog");
  const [packs, setPacks] = useState<RegionPack[]>([demoPack]);
  const [selectedSlug, setSelectedSlug] = useState(demoPack.manifest.slug);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [networkUsage, setNetworkUsage] = useState<NetworkUsage>(getNetworkUsage);
  const [health, setHealth] = useState<ApiHealth>();
  const [availablePacks, setAvailablePacks] = useState<AvailablePack[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [storageUsage, setStorageUsage] = useState<{ usage: number; quota: number }>();
  const [serviceWorkerReady, setServiceWorkerReady] = useState(
    () => "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller),
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [currentPoi, setCurrentPoi] = useState<Poi>();
  const [walkRunning, setWalkRunning] = useState(false);
  const walkActiveRef = useRef(false);
  const geolocationWatchRef = useRef<number>();
  const [walkStartedAt, setWalkStartedAt] = useState<string>();
  const [playedPoiIds, setPlayedPoiIds] = useState<string[]>([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [retrievedChunks, setRetrievedChunks] = useState<Chunk[]>([]);
  const [modelStatus, setModelStatus] = useState("Checking local Ollama…");
  const [ttsStatus, setTtsStatus] = useState("Not used this session");
  const [listening, setListening] = useState(false);
  const [speechConsent, setSpeechConsent] = useState(
    () => localStorage.getItem("wildpack-speech-consent") === "true",
  );
  const [locationForExport, setLocationForExport] = useState(
    () => localStorage.getItem("wildpack-location-export") === "true",
  );
  const [includePhoto, setIncludePhoto] = useState(true);
  const [photo, setPhoto] = useState<string>();
  const [visionResult, setVisionResult] = useState<VisionResult>();
  const [visionBusy, setVisionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verbosity, setVerbosity] = useState(
    () => localStorage.getItem("wildpack-verbosity") ?? "standard",
  );
  const [voiceId, setVoiceId] = useState(
    () => localStorage.getItem("wildpack-elevenlabs-voice") ?? "",
  );
  const [triggerRadius, setTriggerRadius] = useState(
    () => Number(localStorage.getItem("wildpack-trigger-radius") ?? 40),
  );
  const [deviceLocation, setDeviceLocation] = useState<[number, number]>();
  const [walkLocation, setWalkLocation] = useState<[number, number]>();
  const [breadcrumbs, setBreadcrumbs] = useState<Array<[number, number]>>([]);
  const [walkDistanceM, setWalkDistanceM] = useState(0);
  const [trackPoints, setTrackPoints] = useState<Array<{ coordinates: [number, number]; speedMps: number }>>(
    demoPack.pois.map((poi) => ({ coordinates: poi.coordinates, speedMps: 1 })),
  );
  const geofenceRef = useRef<GeofenceEngine>();
  const replayIndexRef = useRef(0);
  const objectUrlRef = useRef<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gpxInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const selectedPack = useMemo(
    () => packs.find((pack) => pack.manifest.slug === selectedSlug) ?? packs[0],
    [packs, selectedSlug],
  );

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4500);
  }, []);

  async function speakAnswer(text: string): Promise<void> {
    if (navigator.onLine) {
      try {
        const response = await trackedFetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, ...(voiceId ? { voiceId } : {}) }),
        });
        if (!response.ok) {
          const payload: unknown = await response.json();
          throw new Error(
            (payload as ApiError).error?.message ??
              `ElevenLabs narration failed (${response.status}).`,
          );
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = URL.createObjectURL(await response.blob());
        const audio = new Audio(objectUrlRef.current);
        audio.addEventListener("ended", () => {
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = undefined;
        }, { once: true });
        await audio.play();
        setTtsStatus("ElevenLabs audio");
        return;
      } catch (error) {
        setTtsStatus("Browser speech fallback");
        notify(
          error instanceof Error
            ? `${error.message} Using browser speech instead.`
            : "ElevenLabs was unavailable. Using browser speech instead.",
        );
      }
    } else {
      setTtsStatus("Browser speech · offline");
    }
    speak(text);
  }

  const refreshStorage = useCallback(async () => {
    const [storedPacks, storedObservations, estimate] = await Promise.all([
      loadPacks(),
      loadObservations(),
      getStorageEstimate(),
    ]);
    const nextPacks = storedPacks.length > 0
      ? storedPacks
      : [demoPack];
    if (storedPacks.length === 0) await savePack(demoPack);
    setPacks(nextPacks);
    setSelectedSlug((current) =>
      nextPacks.some((pack) => pack.manifest.slug === current)
        ? current
        : nextPacks[0]?.manifest.slug ?? demoPack.manifest.slug,
    );
    setObservations(storedObservations);
    setStorageUsage(estimate);
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await trackedFetch("/api/health");
      const payload: unknown = await response.json();
      if (
        typeof payload === "object" &&
        payload !== null &&
        "checks" in payload
      ) {
        const result = payload as ApiHealth;
        setHealth(result);
        setModelStatus(result.checks.llm === "ok"
          ? "Ollama is reachable"
          : "Ollama unavailable — start it and load a model");
      } else {
        setModelStatus("Local API returned an unexpected health response");
      }
    } catch {
      setHealth(undefined);
      setModelStatus("Local API unavailable — start npm run dev:server");
    }
  }, []);

  const refreshCatalog = useCallback(async () => {
    try {
      const result = await jsonResponse<{ packs: AvailablePack[] }>(
        await trackedFetch("/api/packs"),
      );
      setAvailablePacks(result.packs);
    } catch (error) {
      if (navigator.onLine) {
        console.error("Could not load the server pack catalog.", error);
      }
      setAvailablePacks([]);
      setNotice(
        navigator.onLine
          ? "The pack server is unavailable. Showing packs saved on this device."
          : "Offline: showing packs saved on this device.",
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refreshStorage().catch((error: unknown) => {
      if (active) {
        setErrorMessage(
          error instanceof Error
            ? `Local storage is unavailable: ${error.message}`
            : "Local storage is unavailable.",
        );
      }
    });
    void requestPersistentStorage().then((persistent) => {
      if (active && !persistent) {
        setNotice("The browser did not grant persistent storage. Keep an exported copy of important packs.");
      }
    }).catch((error: unknown) => {
      if (active) setErrorMessage(
        error instanceof Error ? error.message : "Storage persistence could not be checked.",
      );
    });
    void refreshHealth();
    void refreshCatalog();
    const updateServiceWorkerStatus = () => {
      setServiceWorkerReady(Boolean(navigator.serviceWorker?.controller));
    };
    navigator.serviceWorker?.addEventListener(
      "controllerchange",
      updateServiceWorkerStatus,
    );
    void navigator.serviceWorker?.getRegistration().then((registration) => {
      if (active) setServiceWorkerReady(Boolean(registration?.active));
    });
    return () => {
      active = false;
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        updateServiceWorkerStatus,
      );
      if (geolocationWatchRef.current !== undefined) {
        navigator.geolocation?.clearWatch(geolocationWatchRef.current);
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      window.speechSynthesis?.cancel();
    };
  }, [refreshCatalog, refreshHealth, refreshStorage]);

  useEffect(
    () => subscribeNetworkUsage(setNetworkUsage),
    [],
  );

  useEffect(() => {
    localStorage.setItem("wildpack-speech-consent", String(speechConsent));
  }, [speechConsent]);

  useEffect(() => {
    localStorage.setItem("wildpack-location-export", String(locationForExport));
  }, [locationForExport]);

  useEffect(() => {
    localStorage.setItem("wildpack-verbosity", verbosity);
  }, [verbosity]);

  useEffect(() => {
    localStorage.setItem("wildpack-trigger-radius", String(triggerRadius));
  }, [triggerRadius]);

  useEffect(() => {
    localStorage.setItem("wildpack-elevenlabs-voice", voiceId);
  }, [voiceId]);

  const saveUpdatedPack = useCallback(async (pack: RegionPack) => {
    await savePack(pack);
    setPacks((current) => {
      const found = current.some(
        (entry) => entry.manifest.slug === pack.manifest.slug,
      );
      return found
        ? current.map((entry) =>
            entry.manifest.slug === pack.manifest.slug ? pack : entry,
          )
        : [pack, ...current];
    });
    setSelectedSlug(pack.manifest.slug);
  }, []);

  async function handlePackImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setErrorMessage("");
    try {
      if (file.size > 100 * 1024 * 1024) {
        throw new Error("Pack is larger than the 100 MB import limit.");
      }

      const archive = new Uint8Array(await file.arrayBuffer());
      const pack = await readWildpack(archive);
      await saveUpdatedPack(pack);
      notify(`Verified and saved ${pack.manifest.name} for offline use.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "The pack could not be imported.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadAvailablePack(pack: AvailablePack): Promise<void> {
    setBusy(true);
    setErrorMessage("");
    setDownloadProgress((current) => ({ ...current, [pack.slug]: 0 }));
    try {
      const response = await trackedFetch(pack.downloadUrl);
      if (!response.ok || !response.body) {
        throw new Error(`Pack download failed (${response.status}).`);
      }
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let downloaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          downloaded += value.byteLength;
          parts.push(value);
          setDownloadProgress((current) => ({
            ...current,
            [pack.slug]: Math.min(100, Math.round(downloaded / pack.sizeBytes * 100)),
          }));
        }
      }
      const archive = new Uint8Array(downloaded);
      let offset = 0;
      for (const part of parts) {
        archive.set(part, offset);
        offset += part.byteLength;
      }
      const digest = await crypto.subtle.digest("SHA-256", archive.slice().buffer);
      const actualHash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (actualHash !== pack.sha256) {
        throw new Error("Downloaded archive SHA-256 does not match the catalog.");
      }
      const verified = await readWildpack(archive);
      await saveUpdatedPack(verified);
      notify(`Downloaded, verified, and saved ${verified.manifest.name} for offline use.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The pack could not be downloaded.");
    } finally {
      setBusy(false);
      setDownloadProgress((current) => {
        const remaining = { ...current };
        delete remaining[pack.slug];
        return remaining;
      });
    }
  }

  async function handleGpxImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("GPX files are limited to 2 MB.");
      const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
      if (xml.querySelector("parsererror")) throw new Error("The selected file is not valid GPX XML.");
      const track = Array.from(xml.querySelectorAll("trkpt, rtept"))
        .map((point) => {
          const latitude = Number(point.getAttribute("lat"));
          const longitude = Number(point.getAttribute("lon"));
          const speedText = point.querySelector("speed")?.textContent;
          const speedMps = speedText ? Number(speedText) : 1;
          if (
            !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
            !Number.isFinite(speedMps) || speedMps < 0
          ) return undefined;
          return { coordinates: [longitude, latitude] as [number, number], speedMps };
        })
        .filter((point): point is { coordinates: [number, number]; speedMps: number } => point !== undefined);
      if (track.length === 0) {
        throw new Error("No valid <trkpt> or <rtept> coordinates were found.");
      }
      setTrackPoints(track);
      replayIndexRef.current = 0;
      setReplayIndex(0);
      notify(`Loaded ${track.length.toLocaleString()} GPX points for local replay.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The GPX file could not be loaded.");
    }
  }

  async function exportPack(pack: RegionPack): Promise<void> {
    const archive = await createWildpack(pack);
    downloadFile(
      new Blob([archive.slice().buffer as ArrayBuffer], { type: "application/zip" }),
      `${pack.manifest.slug}.wildpack`,
    );
  }

  function sayPoi(poi: Poi): void {
    setCurrentPoi(poi);
    const audioPath = poi.storyCard.audioPath;
    const audioBytes = audioPath ? selectedPack?.audio[audioPath] : undefined;
    if (audioBytes) {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(
        new Blob([audioBytes.slice().buffer as ArrayBuffer], { type: "audio/mpeg" }),
      );
      const audio = new Audio(objectUrlRef.current);
      void audio.play().catch(() => {
        speak(poi.storyCard.text);
        notify("Pack audio could not play; using the browser's offline speech voice.");
      });
      notify("Playing the pre-generated audio stored in this pack.");
      return;
    }
    speak(poi.storyCard.text);
    notify("Using browser speech synthesis; no pre-generated ElevenLabs audio is stored for this card.");
  }

  function handleGeofenceEvent(event: GeofenceEvent): void {
    if (event.type === "trigger") {
      setPlayedPoiIds((current) =>
        current.includes(event.poi.id) ? current : [...current, event.poi.id],
      );
      setCurrentPoi(event.poi);
      sayPoi(event.poi);
      return;
    }
    if (event.reason === "accuracy") {
      notify("GPS accuracy is too low. Narration is paused until the location improves.");
    } else if (event.reason === "speed") {
      notify("Narration is paused while moving faster than walking speed.");
    }
  }

  function processLocationFix(fix: LocationFix, isDeviceLocation = true): void {
    if (isDeviceLocation) setDeviceLocation(fix.coordinates);
    setWalkLocation(fix.coordinates);
    const previous = breadcrumbs.at(-1);
    if (previous) {
      setWalkDistanceM((distance) =>
        distance + Math.round(distanceMeters(previous, fix.coordinates)),
      );
    }
    setBreadcrumbs((current) => [...current, fix.coordinates]);
    const event = geofenceRef.current?.process(fix);
    if (event) handleGeofenceEvent(event);
  }

  function startWalk(): void {
    if (!selectedPack) {
      setErrorMessage("Import a region pack before starting a walk.");
      return;
    }
    geofenceRef.current = new GeofenceEngine(
      selectedPack.pois.map((poi) => ({
        ...poi,
        radiusM: triggerRadius,
      })),
    );
    replayIndexRef.current = 0;
    setReplayIndex(0);
    setPlayedPoiIds([]);
    setCurrentPoi(undefined);
    setDeviceLocation(undefined);
    setWalkLocation(undefined);
    setBreadcrumbs([]);
    setWalkDistanceM(0);
    setWalkStartedAt(new Date().toISOString());
    walkActiveRef.current = true;
    setWalkRunning(true);
    notify("Walk started. Your location stays on this device.");
  }

  function pauseWalk(): void {
    walkActiveRef.current = false;
    setWalkRunning(false);
    if (geolocationWatchRef.current !== undefined) {
      navigator.geolocation?.clearWatch(geolocationWatchRef.current);
      geolocationWatchRef.current = undefined;
    }
    notify("Walk paused. Location-triggered narration has stopped.");
  }

  function nextReplayStop(): void {
    if (!selectedPack || !geofenceRef.current) {
      startWalk();
      if (!selectedPack) return;
      geofenceRef.current = new GeofenceEngine(
        selectedPack.pois.map((poi) => ({ ...poi, radiusM: triggerRadius })),
      );
    }
    const points = trackPoints;
    if (points.length === 0) {
      setErrorMessage("Import a GPX route or use the sample replay.");
      return;
    }
    const index = replayIndexRef.current;
    const point = points[index % points.length];
    if (!point) return;
    const fix: LocationFix = {
      coordinates: point.coordinates,
      accuracy: 5,
      speedMps: point.speedMps,
      timestamp: Date.now() + index * 25_000,
    };
    processLocationFix(fix, false);
    replayIndexRef.current += 1;
    setReplayIndex(replayIndexRef.current);
    walkActiveRef.current = true;
    setWalkRunning(true);
  }

  function useDeviceLocation(): void {
    if (!navigator.geolocation) {
      setErrorMessage("This browser does not provide geolocation.");
      return;
    }
    if (geolocationWatchRef.current !== undefined) {
      navigator.geolocation.clearWatch(geolocationWatchRef.current);
    }
    geolocationWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (!walkActiveRef.current) return;
        processLocationFix({
          coordinates: [
            position.coords.longitude,
            position.coords.latitude,
          ],
          accuracy: position.coords.accuracy,
          speedMps: position.coords.speed ?? 0,
          timestamp: position.timestamp,
        });
      },
      (error) => setErrorMessage(`Location error: ${error.message}`),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
  }

  async function submitQuestion(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedPack || !question.trim()) return;
    const asked = question.trim();
    setBusy(true);
    setErrorMessage("");
    const began = performance.now();
    try {
      if (isForagingOrMedicalQuestion(asked)) {
        const entry = {
          question: asked,
          answer: safetyResponse,
          citations: [],
          model: "fixed-safety-refusal",
          latencyMs: Math.round(performance.now() - began),
          createdAt: new Date().toISOString(),
        };
        setTranscript((current) => [entry, ...current]);
        setQuestion("");
        void speakAnswer(entry.answer);
        return;
      }

      let queryEmbedding: number[] | undefined;
      const hasPackEmbeddings = selectedPack.chunks.some(
        (chunk) => chunk.embedding?.length,
      );
      if (hasPackEmbeddings) {
        try {
          const result = await jsonResponse<{ embeddings: number[][] }>(
            await trackedFetch("/api/embed", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                input: [asked],
                model: selectedPack.manifest.embeddingModel,
              }),
            }),
          );
          queryEmbedding = result.embeddings[0];
        } catch {
          setModelStatus("Using offline lexical retrieval; embedding model unavailable");
        }
      }

      const results = retrieveChunks(asked, selectedPack.chunks, {
        queryEmbedding,
        pois: selectedPack.pois,
        location: walkLocation,
        limit: 5,
      });
      const passages = results.map(({ chunk }) => chunk);
      setRetrievedChunks(passages);
      if (passages.length === 0) {
        throw new Error("This pack contains no knowledge passages to search.");
      }
      const nearestPoi = walkLocation
        ? [...selectedPack.pois].sort(
            (left, right) =>
              distanceMeters(left.coordinates, walkLocation) -
              distanceMeters(right.coordinates, walkLocation),
          )[0]
        : currentPoi;

      const result = await jsonResponse<AskResult>(
        await trackedFetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            packSlug: selectedPack.manifest.slug,
            question: asked,
            chunks: passages.map(({ id, text }) => ({ id, text })),
            month: new Date().getMonth() + 1,
            ...(nearestPoi ? { poiName: nearestPoi.name } : {}),
          }),
        }),
      );
      const entry = { ...result, question: asked, createdAt: new Date().toISOString() };
      setTranscript((current) => [entry, ...current]);
      setQuestion("");
      setModelStatus(`Local Gemma response · ${result.model}`);
      void speakAnswer(result.answer);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The question could not be answered.",
      );
    } finally {
      setBusy(false);
    }
  }

  function startVoiceInput(): void {
    if (!speechConsent) {
      setErrorMessage("Enable the speech-recognition privacy setting first. This browser feature may send audio to its provider and is not guaranteed to work offline.");
      return;
    }
    const SpeechRecognition =
      (window as ExtendedWindow).SpeechRecognition ??
      (window as ExtendedWindow).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMessage("Speech recognition is not available in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcriptText = event.results[0]?.[0]?.transcript;
      if (transcriptText) setQuestion(transcriptText);
      setListening(false);
    };
    recognition.onerror = () => {
      setListening(false);
      setErrorMessage("Speech recognition failed. You can type the question instead.");
    };
    recognition.onend = () => setListening(false);
    try {
      recognition.start();
      setListening(true);
    } catch {
      setErrorMessage("Microphone permission was denied or is already in use.");
    }
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setVisionResult(undefined);
    setErrorMessage("");
    try {
      const compressed = await downscaleImage(file);
      if (compressed.length > 2_000_000) {
        throw new Error("The processed image exceeds the 1.5 MB vision limit. Try a smaller photo.");
      }
      setPhoto(`data:image/jpeg;base64,${compressed}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not process this photo.");
    }
  }

  async function identifyPhoto(): Promise<void> {
    if (!photo || !selectedPack || selectedPack.species.length === 0) {
      setErrorMessage("Import a region pack with a species list before requesting an ID.");
      return;
    }
    setVisionBusy(true);
    setErrorMessage("");
    try {
      const image = photo.split(",")[1] ?? "";
      const result = await jsonResponse<VisionResult>(
        await trackedFetch("/api/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image,
            candidates: selectedPack.species.slice(0, 150).map(
              (species) => species.commonName,
            ),
          }),
        }),
      );
      setVisionResult(result);
      if (result.followUpQuestion) speak(result.followUpQuestion);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "The photo could not be analyzed.",
      );
    } finally {
      setVisionBusy(false);
    }
  }

  async function saveFieldObservation(commonName: string, scientificName?: string, confidence?: number): Promise<void> {
    const observation: Observation = {
      id: crypto.randomUUID(),
      observedAt: new Date().toISOString(),
      commonName,
      ...(scientificName ? { scientificName } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(includePhoto && photo ? { imageDataUrl: photo } : {}),
      ...(deviceLocation && locationForExport
        ? { coordinates: deviceLocation }
        : {}),
      confirmed: false,
      model: visionResult?.model ?? "user-recorded, no model",
    };
    try {
      await saveObservation(observation);
      setObservations((current) => [observation, ...current]);
      notify("Saved locally as an unverified observation.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "The observation could not be saved.",
      );
    }
  }

  async function exportJournal(): Promise<void> {
    const headers = [
      "occurrenceID",
      "scientificName",
      "commonName",
      "eventDate",
      "decimalLatitude",
      "decimalLongitude",
      "geodeticDatum",
      "coordinateUncertaintyInMeters",
      "occurrenceRemarks",
      "identificationVerificationStatus",
    ];
    const rows = observations.map((observation) => [
      observation.id,
      observation.scientificName ?? "",
      observation.commonName,
      observation.observedAt,
      observation.coordinates?.[1].toFixed(1) ?? "",
      observation.coordinates?.[0].toFixed(1) ?? "",
      observation.coordinates ? "WGS84" : "",
      observation.coordinates ? "11000" : "",
      observation.notes ?? "",
      "unverified AI suggestion",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCsv(String(cell))).join(","))
      .join("\r\n");
    const { zipSync, strToU8 } = await import("fflate");
    const files: Record<string, Uint8Array> = {
      "observations.csv": strToU8(csv),
      "README.txt": strToU8(
        "WildPack observation export. Suggestions are unverified. Coordinates are included only when explicitly enabled; exported coordinates are rounded to 0.1 degrees. This Darwin Core-style CSV has not been validated against iNaturalist's current bulk-import workflow.",
      ),
    };
    observations.forEach((observation, index) => {
      if (observation.imageDataUrl) {
        const base64 = observation.imageDataUrl.split(",")[1] ?? "";
        const raw = atob(base64);
        const photoBytes = Uint8Array.from(raw, (character) =>
          character.charCodeAt(0),
        );
        files[`photos/${index + 1}-${observation.id}.jpg`] = photoBytes;
      }
    });
    const zip = zipSync(files, { level: 6 });
    downloadFile(
      new Blob([zip.slice().buffer as ArrayBuffer], { type: "application/zip" }),
      "wildpack-observations.zip",
    );
  }

  async function generatePackAudio(): Promise<void> {
    if (!selectedPack) return;
    const current = selectedPack;
    const audio = { ...current.audio };
    const pois = [...current.pois];
    setBusy(true);
    setErrorMessage("");
    try {
      const encoder = new TextEncoder();
      for (let index = 0; index < pois.length; index += 1) {
        const poi = pois[index];
        if (!poi || poi.storyCard.audioPath) continue;
        setNotice(`Generating ElevenLabs narration ${index + 1}/${pois.length}…`);
        const text = poi.storyCard.text;
        const response = await trackedFetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, ...(voiceId ? { voiceId } : {}) }),
        });
        if (!response.ok) {
          const payload: unknown = await response.json();
          throw new Error(
            (payload as ApiError).error?.message ??
              `Narration generation failed (${response.status}).`,
          );
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const hash = await crypto.subtle.digest("SHA-256", encoder.encode(text));
        const hashText = Array.from(new Uint8Array(hash), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        const path = `audio/${hashText}.mp3`;
        audio[path] = bytes;
        pois[index] = {
          ...poi,
          storyCard: { ...poi.storyCard, audioPath: path },
        };
      }
      const nextPack = { ...current, pois, audio };
      await saveUpdatedPack(nextPack);
      notify("ElevenLabs audio was generated and saved inside the local pack.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Pack narration could not be generated.",
      );
    } finally {
      setBusy(false);
      setNotice("");
    }
  }

  async function removeSavedObservation(observation: Observation): Promise<void> {
    await removeObservation(observation.id);
    setObservations((current) =>
      current.filter((item) => item.id !== observation.id),
    );
  }

  async function deleteSelectedPack(): Promise<void> {
    if (!selectedPack) return;
    await removePack(selectedPack.manifest.slug);
    const remaining = packs.filter(
      (pack) => pack.manifest.slug !== selectedPack.manifest.slug,
    );
    setPacks(remaining.length > 0 ? remaining : [demoPack]);
    setSelectedSlug(remaining[0]?.manifest.slug ?? demoPack.manifest.slug);
    notify("Pack removed from local storage.");
  }

  async function downloadSessionReport(): Promise<void> {
    const report = {
      exportedAt: new Date().toISOString(),
      mode: "local-first",
      localModel: health?.checks.llm === "ok" ? "Ollama available" : "unavailable",
      pack: selectedPack?.manifest.slug ?? null,
      questions: transcript.length,
      observations: observations.length,
      walkDistanceMeters: walkDistanceM,
      walkStartedAt: walkStartedAt ?? null,
      walkDurationSeconds: walkStartedAt
        ? Math.max(0, Math.round((Date.now() - Date.parse(walkStartedAt)) / 1000))
        : 0,
      playedPoiIds,
      network: networkUsage,
      lastInferenceLatencyMs: transcript[0]?.latencyMs ?? null,
      lastTtsMode: ttsStatus,
      coordinatesCollected: deviceLocation !== undefined,
      locationSource: deviceLocation ? "browser-geolocation" : "none",
      coordinatesSentToServer: false,
    };
    downloadFile(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      "wildpack-session-report.json",
    );
  }

  async function shareLocationForCurrentSession(): Promise<void> {
    if (!navigator.geolocation) {
      setErrorMessage("This browser does not provide geolocation.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates: [number, number] = [
          position.coords.longitude,
          position.coords.latitude,
        ];
        setDeviceLocation(coordinates);
          setWalkLocation(coordinates);
        notify("Location is available to the on-device geofence engine only.");
      },
      (error) => setErrorMessage(`Location permission failed: ${error.message}`),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  const syntheticPack = selectedPack?.manifest.slug === demoPack.manifest.slug;
  const apiReady = health?.checks.api === "ok";

  return (
    <div className="wildpack-app">
      <aside className="sidebar">
        <a className="brand" href="#catalog" onClick={() => setScreen("catalog")}>
          <span className="brand-mark" aria-hidden="true">✳</span>
          <span>WildPack<small>FIELD GUIDE</small></span>
        </a>
        <div className="sidebar-label">YOUR FIELD KIT</div>
        <nav className="side-nav" aria-label="WildPack screens">
          {screens.map((item) => (
            <button
              aria-current={screen === item.id ? "page" : undefined}
              className={`nav-item${screen === item.id ? " is-active" : ""}`}
              key={item.id}
              onClick={() => setScreen(item.id)}
              type="button"
            >
              <span aria-hidden="true">{item.icon}</span>{item.label}
              {item.id === "journal" && observations.length > 0 && (
                <span className="nav-count">{observations.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className={`connection-dot${apiReady ? " is-ready" : ""}`} />
          <span>{apiReady ? "Local API connected" : "Local-only preview"}</span>
          <small>Coordinates stay on this device</small>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>WILDPACK</span><span aria-hidden="true">/</span>
            <strong>{screens.find((item) => item.id === screen)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="offline-indicator"><i /> Local-first</span>
            <button className="avatar-button" title="Open settings" onClick={() => setScreen("settings")} type="button">P</button>
          </div>
        </header>

        {(errorMessage || notice) && (
          <div
            className={`app-alert${errorMessage ? " app-alert--error" : ""}`}
            role={errorMessage ? "alert" : "status"}
          >
            <span>{errorMessage || notice}</span>
            <button
              aria-label="Dismiss message"
              onClick={() => { setErrorMessage(""); setNotice(""); }}
              type="button"
            >×</button>
          </div>
        )}

        <div className="page-content">
          {screen === "catalog" && (
            <section>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">GO OUT, STAY CURIOUS</p>
                  <h1>Your field guide</h1>
                  <p className="page-lede">Download a region pack before you head out. Once it’s saved, your guide works without a connection.</p>
                </div>
                <button className="button button--primary" onClick={() => fileInputRef.current?.click()} type="button">
                  <span aria-hidden="true">↓</span> Import .wildpack
                </button>
                <input accept=".wildpack,.zip,application/zip" className="visually-hidden" onChange={(event) => void handlePackImport(event)} ref={fileInputRef} type="file" />
              </div>

              <div className="welcome-banner">
                <div className="welcome-symbol" aria-hidden="true">⌁</div>
                <div>
                  <p className="eyebrow">BUILT FOR THE MOMENTS BETWEEN SIGNAL</p>
                  <h2>Good trails don’t need Wi-Fi.</h2>
                  <p>Your packs, questions, and field notes stay on this device. Start with the synthetic demo, or import a verified pack.</p>
                </div>
                <button className="text-button" onClick={() => setScreen("proof")} type="button">See Open Proof <span aria-hidden="true">↗</span></button>
              </div>

              <div className="section-title-row">
                <div><h2>Saved region packs</h2><p>Stored privately in this browser</p></div>
                <span className="count-pill">{packs.length} {packs.length === 1 ? "PACK" : "PACKS"}</span>
              </div>

              <div className="pack-grid">
                {packs.map((pack, index) => (
                  <article className={`pack-card${selectedSlug === pack.manifest.slug ? " pack-card--selected" : ""}`} key={pack.manifest.slug}>
                    <div className={`pack-art pack-art--${index % 3}`}>
                      <span className="pack-art-label">{pack.manifest.counts.pois} STOPS</span>
                      <div className="contour-lines" aria-hidden="true" />
                      <span className="pack-art-mark" aria-hidden="true">⌁</span>
                      <span className="pack-art-region">{syntheticPack && pack.manifest.slug === demoPack.manifest.slug ? "SYNTHETIC DEMO" : "OFFLINE PACK"}</span>
                    </div>
                    <div className="pack-card-body">
                      <div className="pack-title-line"><h3>{pack.manifest.name}</h3><span className="saved-check" aria-label="Saved offline">✓</span></div>
                      <p>{pack.manifest.slug === demoPack.manifest.slug ? "Illustrative fixture; not a real trail or verified natural history." : `${pack.manifest.counts.species} species · ${pack.manifest.counts.chunks} guide passages`}</p>
                      <div className="pack-card-footer">
                        <span>{pack.manifest.version} · {pack.manifest.counts.audio} audio clips</span>
                        <button className="small-link" onClick={() => { setSelectedSlug(pack.manifest.slug); setScreen("walk"); }} type="button">Open pack <span aria-hidden="true">→</span></button>
                      </div>
                    </div>
                  </article>
                ))}
                <button className="add-pack-card" onClick={() => fileInputRef.current?.click()} type="button">
                  <span className="add-pack-icon">+</span><strong>Add a region pack</strong><span>Import a verified .wildpack file</span>
                </button>
              </div>

              {availablePacks.length > 0 && <div className="server-catalog">
                <div className="section-title-row"><div><h2>Pack catalog</h2><p>Available from this pack server</p></div><button className="small-link" onClick={() => void refreshCatalog()} type="button">Refresh catalog ↻</button></div>
                <div className="catalog-list">{availablePacks.map((pack) => {
                  const saved = packs.some((entry) => entry.manifest.slug === pack.slug);
                  const progress = downloadProgress[pack.slug];
                  return <article className="catalog-row" key={pack.slug}><div><strong>{pack.name}</strong><span>{pack.counts.pois} stops · {pack.counts.species} species · {bytesLabel(pack.sizeBytes)}</span></div>{progress !== undefined ? <span className="download-progress" aria-live="polite">Downloading {progress}%</span> : saved ? <span className="saved-catalog-label">Saved offline</span> : <button className="button button--secondary" disabled={busy} onClick={() => void downloadAvailablePack(pack)} type="button">Download pack ↓</button>}</article>;
                })}</div>
              </div>}

              <div className="readiness-strip">
                <div className="readiness-icon">✓</div>
                <div><strong>Pack saved locally</strong><span>{selectedPack ? `${selectedPack.manifest.name} is available in this browser. Model and narration readiness are separate.` : "Import a pack to save it in this browser"}</span></div>
                <span className="readiness-state">SAVED</span>
                <button className="small-link" onClick={() => setScreen("proof")} type="button">View checks →</button>
              </div>
            </section>
          )}

          {screen === "walk" && selectedPack && (
            <section>
              <div className="page-heading page-heading--compact">
                <div>
                  <p className="eyebrow">YOUR WALK</p>
                  <h1>{selectedPack.manifest.name}</h1>
                  <p className="page-lede">Location processing stays in your browser. Use GPX replay to demo geofences from a laptop.</p>
                </div>
                <select aria-label="Choose region pack" className="select-control" onChange={(event) => setSelectedSlug(event.target.value)} value={selectedPack.manifest.slug}>
                  {packs.map((pack) => <option key={pack.manifest.slug} value={pack.manifest.slug}>{pack.manifest.name}</option>)}
                </select>
              </div>
              {syntheticPack && <div className="demo-disclaimer"><strong>Demo fixture:</strong> coordinates, stops, and narration are synthetic; this is not a real trail guide.</div>}
              <div className="walk-layout">
                <article className="walk-card">
                  <div className="walk-card-top"><span className={`walk-state${walkRunning ? " walk-state--active" : ""}`}><i />{walkRunning ? "WALK IN PROGRESS" : "READY WHEN YOU ARE"}</span><span>{playedPoiIds.length}/{selectedPack.pois.length} stops</span></div>
                  <div className="walk-center">
                    <div className="trail-orbit" aria-hidden="true"><span className="orbit-dot orbit-dot--one" /><span className="orbit-dot orbit-dot--two" /><span className="orbit-dot orbit-dot--three" /><span className="orbit-center">⌁</span></div>
                    <p className="eyebrow">{currentPoi ? "NOW AT THIS STOP" : "CURRENT STOP"}</p>
                    <h2>{currentPoi?.name ?? "Follow the trail"}</h2>
                    <p>{currentPoi ? currentPoi.storyCard.text : "Your guide will speak when you enter a point’s trigger radius, or replay a sample stop below."}</p>
                    {currentPoi && <span className="audio-source">{currentPoi.storyCard.audioPath ? "● PACK AUDIO · OFFLINE" : "● BROWSER SPEECH · OFFLINE FALLBACK"}</span>}
                  </div>
                  <div className="walk-controls">
                    {!walkRunning
                      ? <button className="button button--primary" onClick={startWalk} type="button">Start walk <span aria-hidden="true">→</span></button>
                      : <button className="button button--secondary" onClick={pauseWalk} type="button">Pause walk <span aria-hidden="true">Ⅱ</span></button>}
                    <button className="button button--secondary" onClick={nextReplayStop} type="button">Replay next stop <span aria-hidden="true">⏵</span></button>
                    <button className="icon-button" onClick={() => currentPoi ? sayPoi(currentPoi) : selectedPack.pois[0] && sayPoi(selectedPack.pois[0])} title="Repeat current narration" type="button">↻</button>
                  </div>
                  <div className="walk-card-bottom"><span>Trigger radius</span><span>{triggerRadius} m</span><span className="walk-bottom-divider" /><span>Distance</span><span>{(walkDistanceM / 1000).toFixed(2)} km</span></div>
                </article>

                <aside className="walk-side">
                  <div className="side-card">
                    <div className="side-card-heading"><h3>Trail stops</h3><span>{selectedPack.pois.length}</span></div>
                    <div className="stop-list">
                      {selectedPack.pois.map((poi, index) => (
                        <button className={`stop-row${playedPoiIds.includes(poi.id) ? " stop-row--played" : ""}`} key={poi.id} onClick={() => sayPoi(poi)} type="button">
                          <span className="stop-index">{playedPoiIds.includes(poi.id) ? "✓" : String(index + 1).padStart(2, "0")}</span>
                          <span><strong>{poi.name}</strong><small>{poi.type} · {poi.radiusM} m trigger</small></span>
                          <span className="stop-play" aria-hidden="true">▶</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="side-card simulator-card">
                    <div className="side-card-heading"><h3>Desktop simulator</h3><span className="sim-badge">GPX</span></div>
                    <p>{trackPoints.length} local replay points. GPS data stays in this browser and never enters an API request.</p>
                    <div className="sim-progress"><span style={{ width: `${selectedPack.pois.length ? Math.min(100, playedPoiIds.length / selectedPack.pois.length * 100) : 0}%` }} /></div>
                    <div className="gpx-actions"><button className="small-link" onClick={nextReplayStop} type="button">Replay point {replayIndex + 1} <span aria-hidden="true">→</span></button><button className="small-link" onClick={() => gpxInputRef.current?.click()} type="button">Import GPX ↗</button></div>
                    <input accept=".gpx,application/gpx+xml,application/xml,text/xml" className="visually-hidden" onChange={(event) => void handleGpxImport(event)} ref={gpxInputRef} type="file" />
                  </div>
                  <div className="side-card safety-card"><span className="safety-icon">✳</span><p>Stay on marked trails. Leave plants and wildlife undisturbed. This guide is for curiosity, not safety or foraging advice.</p></div>
                </aside>
              </div>
              <div className="walk-footer-actions">
                <button className="small-link" onClick={useDeviceLocation} type="button">Enable browser location <span aria-hidden="true">↗</span></button>
                <button className="small-link" onClick={shareLocationForCurrentSession} type="button">Check current location <span aria-hidden="true">⌖</span></button>
                <span>{deviceLocation ? "GPS fix stays on device" : walkLocation ? "Simulated route only" : "No location fix yet"}</span>
              </div>
            </section>
          )}

          {screen === "ask" && selectedPack && (
            <section>
              <div className="page-heading page-heading--compact">
                <div><p className="eyebrow">GROUNDED IN YOUR REGION PACK</p><h1>Ask the guide</h1><p className="page-lede">Questions are matched to passages on this device. Local Gemma answers only from those passages.</p></div>
                <span className={`model-pill${health?.checks.llm === "ok" ? " model-pill--ready" : ""}`}><i />{modelStatus}</span>
              </div>
              <div className="qa-layout">
                <div className="qa-main">
                  <form className="question-form" onSubmit={(event) => void submitQuestion(event)}>
                    <label className="visually-hidden" htmlFor="trail-question">Ask a question about your surroundings</label>
                    <textarea id="trail-question" maxLength={1000} onChange={(event) => setQuestion(event.target.value)} placeholder="What would you like to know about this place?" rows={3} value={question} />
                    <div className="question-form-footer"><span>{question.length}/1000 · Retrieved text stays on device</span><div><button className={`button button--secondary${listening ? " is-listening" : ""}`} disabled={listening} onClick={startVoiceInput} type="button">{listening ? "Listening…" : "🎙 Push to talk"}</button><button className="button button--primary" disabled={busy || !question.trim()} type="submit">{busy ? "Searching…" : "Ask locally"} <span aria-hidden="true">→</span></button></div></div>
                  </form>
                  <p className="speech-note">Browser speech recognition may send audio to the browser provider; it is off until you enable consent in Settings. Offline transcription requires a local Whisper model, not yet configured.</p>
                  {transcript.length > 0 && <div className="transcript-list">
                    {transcript.map((entry, index) => (
                      <article className="transcript-card" key={`${entry.createdAt}-${index}`}>
                        <div className="transcript-question"><span className="question-avatar">YOU</span><p>{entry.question}</p></div>
                        <div className="transcript-answer"><span className="guide-avatar">✳</span><div><p>{entry.answer}</p><div className="answer-meta"><span>{entry.model}</span><span>{entry.latencyMs} ms</span>{entry.citations.length > 0 && <span>Sources: {entry.citations.join(", ")}</span>}</div></div></div>
                      </article>
                    ))}
                  </div>}
                  {retrievedChunks.length > 0 && <div className="retrieved-panel"><h3>Local passages retrieved</h3>{retrievedChunks.map((chunk) => <article key={chunk.id}><strong>{chunk.source.title} · {chunk.id}</strong><p>{chunk.text}</p></article>)}</div>}
                  {transcript.length === 0 && <div className="empty-state"><div className="empty-state-icon">◌</div><h2>Curiosity, with a source</h2><p>Your question is searched against the selected pack. If Ollama is unavailable, the app reports that rather than inventing an answer.</p><div className="suggested-questions">{["What is in this pack?", "What should I notice at the next stop?"].map((suggestion) => <button key={suggestion} onClick={() => setQuestion(suggestion)} type="button">{suggestion} <span aria-hidden="true">↗</span></button>)}</div></div>}
                </div>
                <aside className="qa-aside">
                  <div className="side-card"><div className="side-card-heading"><h3>Guide context</h3><span>LOCAL</span></div><dl className="context-list"><div><dt>Pack</dt><dd>{selectedPack.manifest.name}</dd></div><div><dt>Knowledge passages</dt><dd>{selectedPack.chunks.length}</dd></div><div><dt>Nearest stop</dt><dd>{currentPoi?.name ?? "Not set"}</dd></div><div><dt>Location sharing</dt><dd>Never</dd></div></dl></div>
                  <div className="side-card safety-card"><span className="safety-icon">!</span><p>WildPack refuses eating, medical, and foraging advice. Identification suggestions are never verified.</p></div>
                  <button className="small-link" onClick={() => void refreshHealth()} type="button">Check local model status ↻</button>
                </aside>
              </div>
            </section>
          )}

          {screen === "field" && (
            <section>
              <div className="page-heading page-heading--compact"><div><p className="eyebrow">NOTICE, DON’T DISTURB</p><h1>Field notes</h1><p className="page-lede">Photos and observations stay in this browser. AI output is only a suggestion, never a confirmed identification.</p></div></div>
              <div className="field-layout">
                <div className="field-photo-card">
                  <button className={`photo-drop${photo ? " photo-drop--loaded" : ""}`} onClick={() => photoInputRef.current?.click()} type="button">
                    {photo ? <img alt="Selected field observation" src={photo} /> : <><span className="photo-icon">◎</span><strong>Add a field photo</strong><span>Camera or image · resized to 1280 px max</span></>}
                  </button>
                  <input accept="image/*" capture="environment" className="visually-hidden" onChange={(event) => void handlePhoto(event)} ref={photoInputRef} type="file" />
                  <div className="field-photo-actions">
                    <button className="button button--primary" disabled={!photo || visionBusy || !selectedPack?.species.length} onClick={() => void identifyPhoto()} type="button">{visionBusy ? "Analyzing locally…" : "Suggest an ID"}</button>
                    <button className="button button--secondary" disabled={!photo} onClick={() => void saveFieldObservation("Unidentified observation")} type="button">Save as unknown</button>
                  </div>
                  <label className="check-row field-photo-toggle"><input checked={includePhoto} onChange={(event) => setIncludePhoto(event.target.checked)} type="checkbox" /> Keep photo in the local observation journal</label>
                  {photo && selectedPack?.species.length === 0 && <p className="inline-warning">This pack has no species candidates. Photo identification stays disabled rather than guessing beyond a regional species list.</p>}
                </div>
                <div className="field-result">
                  {visionResult ? <div className="side-card">
                    <div className="side-card-heading"><h3>AI suggestions</h3><span className="unverified-badge">UNVERIFIED</span></div>
                    {visionResult.candidates.length === 0 ? <p>No confident match from the species in this pack. Leave the observation unidentified.</p> : visionResult.candidates.map((candidate) => <article className="candidate-card" key={candidate.commonName}><span className="candidate-confidence">{Math.min(candidate.confidence, 0.85).toLocaleString(undefined, { style: "percent", maximumFractionDigits: 0 })}</span><div><h3>{candidate.commonName}</h3><em>{candidate.scientificName}</em><p>{candidate.visibleTraits.join(" · ")}</p><button className="small-link" onClick={() => void saveFieldObservation(candidate.commonName, candidate.scientificName, candidate.confidence)} type="button">Save unverified note →</button></div></article>)}
                    {visionResult.followUpQuestion && <div className="followup-question"><span>TAKE A CLOSER LOOK</span><p>{visionResult.followUpQuestion}</p><button className="small-link" onClick={() => speak(visionResult.followUpQuestion)} type="button">Speak prompt ↗</button></div>}
                    <p className="model-disclaimer">Model: {visionResult.model}. This suggestion has not been verified by a person.</p>
                  </div> : <div className="field-guidance"><span className="field-guidance-icon">✳</span><p className="eyebrow">FIELD GUIDE PROMPT</p><h2>Look closely, leave it as you found it.</h2><p>Pack-limited photo suggestions require a local vision-capable Ollama model and species list. Your image is sent only to the local API on this computer.</p><ul><li>Photograph from a respectful distance.</li><li>Do not handle or disturb wildlife.</li><li>Do not rely on AI for safety or identification.</li></ul></div>}
                </div>
              </div>
            </section>
          )}

          {screen === "journal" && (
            <section>
              <div className="page-heading page-heading--compact">
                <div><p className="eyebrow">PRIVATE TO THIS DEVICE</p><h1>Observation journal</h1><p className="page-lede">A local record of things you noticed. Entries are unverified and are never synced automatically.</p></div>
                <button className="button button--primary" disabled={observations.length === 0} onClick={() => void exportJournal()} type="button">Export observations <span aria-hidden="true">↓</span></button>
              </div>
              <div className="journal-settings"><label className="check-row"><input checked={locationForExport} onChange={(event) => setLocationForExport(event.target.checked)} type="checkbox" /> Include rounded location only when I explicitly enable export</label><span>Coordinates are rounded to 0.1° in the CSV; originals remain on this device.</span></div>
              {observations.length === 0 ? <div className="empty-state"><div className="empty-state-icon">▤</div><h2>Your field notes live here</h2><p>Add a photo observation on the Field Notes screen. Nothing is uploaded or synchronized.</p><button className="button button--secondary" onClick={() => setScreen("field")} type="button">Create a field note →</button></div> : <div className="journal-grid">{observations.map((observation) => <article className="journal-card" key={observation.id}>{observation.imageDataUrl ? <img alt="" src={observation.imageDataUrl} /> : <div className="journal-placeholder">◎</div>}<div><span className="unverified-badge">UNVERIFIED</span><h3>{observation.commonName}</h3>{observation.scientificName && <em>{observation.scientificName}</em>}<p>{new Date(observation.observedAt).toLocaleString()}</p>{observation.notes && <p>{observation.notes}</p>}<button className="small-link danger-link" onClick={() => void removeSavedObservation(observation)} type="button">Delete local entry</button></div></article>)}</div>}
            </section>
          )}

          {screen === "proof" && (
            <section>
              <div className="page-heading page-heading--compact"><div><p className="eyebrow">SHOW YOUR WORK</p><h1>Open Proof</h1><p className="page-lede">A session report that describes local processing honestly. Loopback requests to Ollama stay on this computer.</p></div><button className="button button--primary" onClick={() => void downloadSessionReport()} type="button">Export session JSON <span aria-hidden="true">↓</span></button></div>
              <div className="proof-grid">
                <article className="proof-card proof-card--featured"><span className="proof-label">INFERENCE MODE</span><div className="proof-value">{health?.checks.llm === "ok" ? "Local" : "Local · model offline"}</div><p>Ollama on this computer · no hosted fallback configured</p><span className="proof-check">● {health?.checks.llm === "ok" ? "LOCAL MODEL REACHABLE" : "MODEL NOT AVAILABLE"}</span></article>
                <article className="proof-card"><span className="proof-label">NETWORK BYTES SENT</span><div className="proof-value">{bytesLabel(networkUsage.sentBytes)}</div><p>External browser requests this session; localhost model calls are excluded.</p></article>
                <article className="proof-card"><span className="proof-label">NETWORK BYTES RECEIVED</span><div className="proof-value">{bytesLabel(networkUsage.receivedBytes)}</div><p>Counted from external response headers where available.</p></article>
                <article className="proof-card"><span className="proof-label">LATEST MODEL LATENCY</span><div className="proof-value">{transcript[0] ? `${transcript[0].latencyMs} ms` : "—"}</div><p>{transcript[0]?.model ?? "No local model response yet."}</p></article>
                <article className="proof-card"><span className="proof-label">PACK INTEGRITY</span><div className="proof-value">SHA-256</div><p>Every imported pack file was checked against its manifest before storage.</p></article>
                <article className="proof-card"><span className="proof-label">OFFLINE APP SHELL</span><div className="proof-value">{serviceWorkerReady ? "Ready" : "Not controlled"}</div><p>{serviceWorkerReady ? "The service worker controls this page. Runtime API and model requests still need their services." : "Reload after the service worker installs to confirm app-shell control."}</p></article>
                <article className="proof-card"><span className="proof-label">PACKAGED NARRATION</span><div className="proof-value">{selectedPack ? `${selectedPack.manifest.counts.audio}/${selectedPack.manifest.counts.pois}` : "No pack"}</div><p>Audio clips / stops in the selected pack. Browser speech is not packaged narration.</p></article>
                <article className="proof-card"><span className="proof-label">LOCATION SENT</span><div className="proof-value">Never</div><p>Geofencing and proximity ranking run in this browser. API schemas reject coordinate fields.</p></article>
                <article className="proof-card"><span className="proof-label">ANSWER VOICE</span><div className="proof-value">{ttsStatus}</div><p>Pre-generated pack audio first, ElevenLabs for online answers, browser speech when offline or unavailable.</p></article>
              </div>
              <div className="proof-footnote"><strong>Honesty note</strong><p>Network values measure external browser fetches. Server-side ElevenLabs traffic is separate; TTS is an optional online action. This report does not claim zero total network traffic when online services are used.</p></div>
            </section>
          )}

          {screen === "settings" && (
            <section>
              <div className="page-heading page-heading--compact"><div><p className="eyebrow">YOUR DEVICE, YOUR CHOICES</p><h1>Settings & privacy</h1><p className="page-lede">WildPack requires no hiker account. Settings are stored in this browser.</p></div></div>
              <div className="settings-layout">
                <div className="settings-main">
                  <article className="settings-card"><div><h2>Walking guide</h2><p>Adjust local geofence and narration preferences.</p></div><label className="setting-row"><span>Trigger radius</span><select className="select-control" onChange={(event) => setTriggerRadius(Number(event.target.value))} value={triggerRadius}><option value={30}>30 metres</option><option value={40}>40 metres</option><option value={60}>60 metres</option><option value={80}>80 metres</option></select></label><label className="setting-row"><span>Narration verbosity</span><select className="select-control" onChange={(event) => setVerbosity(event.target.value)} value={verbosity}><option value="brief">Brief</option><option value="standard">Standard</option><option value="detailed">Detailed</option></select></label><label className="setting-row"><span>ElevenLabs voice ID</span><input aria-label="ElevenLabs voice ID" className="voice-input" maxLength={100} onChange={(event) => setVoiceId(event.target.value.trim())} placeholder="Use the server default" value={voiceId} /></label></article>
                  <article className="settings-card"><div><h2>Speech recognition</h2><p>Browser speech recognition may send audio to the browser vendor and may require internet access. It is not the offline Whisper model in the SRS.</p></div><label className="check-row"><input checked={speechConsent} onChange={(event) => setSpeechConsent(event.target.checked)} type="checkbox" /> I explicitly allow browser-managed speech recognition when I press the mic button</label></article>
                  <article className="settings-card"><div><h2>Local storage</h2><p>Region packs, settings, and observations are kept in this browser’s IndexedDB.</p></div><div className="storage-meter"><div><span style={{ width: storageUsage?.quota ? `${Math.min(100, storageUsage.usage / storageUsage.quota * 100)}%` : "0%" }} /></div><span>{bytesLabel(storageUsage?.usage ?? 0)} used · {bytesLabel(storageUsage?.quota ?? 0)} available</span></div><button className="small-link" onClick={() => void requestPersistentStorage().then((result) => notify(result ? "Persistent storage was granted." : "The browser did not grant persistent storage."))} type="button">Request persistent storage ↗</button></article>
                </div>
                <aside className="privacy-card"><span className="privacy-mark">◈</span><p className="eyebrow">PRIVACY PROMISE</p><h2>Your location is yours.</h2><p>WildPack does not send your latitude or longitude to any server. Location is used only in the browser for geofences and optional observation records.</p><ul><li>Local Gemma receives only your question and retrieved pack passages over localhost.</li><li>ElevenLabs receives narration text only when you explicitly generate voice audio online.</li><li>Pack import, journal entries, and photos stay in this browser unless you export them.</li><li>No account, analytics, or third-party font calls.</li></ul><button className="small-link" onClick={() => setScreen("proof")} type="button">Inspect Open Proof →</button></aside>
              </div>
            </section>
          )}

          {screen === "author" && (
            <section>
              <div className="page-heading page-heading--compact"><div><p className="eyebrow">PACK AUTHOR</p><h1>Build a region pack</h1><p className="page-lede">The local builder packages verified source material and voices every story card before export.</p></div></div>
              <div className="author-grid">
                <article className="author-card"><span className="author-step">01</span><h2>Prepare sourced content</h2><p>Add POIs, source chunks, species and attribution to a JSON input. Only cite material you have permission to redistribute.</p></article>
                <article className="author-card"><span className="author-step">02</span><h2>Run the local builder</h2><pre><code>npm run build:pack -- --input samples/my-trail.json</code></pre><p>Story generation and embeddings use Ollama on this laptop. No DigitalOcean host is required.</p></article>
                <article className="author-card"><span className="author-step">03</span><h2>Voice and verify</h2><p>ElevenLabs is compulsory for generated pack audio. The builder stops with an explicit error if its key or quota is unavailable.</p><button className="button button--secondary" onClick={() => void generatePackAudio()} disabled={!selectedPack || syntheticPack || busy} type="button">{busy ? "Generating audio…" : "Generate audio for selected pack"}</button></article>
              </div>
              <div className="author-import"><div><strong>Already have a .wildpack?</strong><span>Import it into this browser; SHA-256 hashes are verified before it is marked ready.</span></div><button className="button button--primary" onClick={() => fileInputRef.current?.click()} type="button">Import pack →</button></div>
              {selectedPack && <div className="author-actions"><button className="button button--secondary" onClick={() => void exportPack(selectedPack)} type="button">Export selected pack</button><button className="small-link danger-link" onClick={() => void deleteSelectedPack()} type="button">Remove selected pack from this device</button></div>}
            </section>
          )}
        </div>

        <footer className="app-footer"><span>WILDPACK · A FIELD GUIDE FOR THE OFFLINE WORLD</span><span>{selectedPack?.manifest.name ?? "No pack selected"} · {navigator.onLine ? "Online" : "Offline"}</span></footer>
      </main>
    </div>
  );
}

export default App;
