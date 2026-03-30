import { createTtsEngine } from "./tts-engine";
import type { TtsEngine } from "./tts-engine";

export interface TtsPlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  mode: "section" | "playall" | null;
  currentTitle: string;
  currentIndex: number;
  totalSections: number;
}

export type TtsStateListener = (state: TtsPlaybackState) => void;

// Module-level singleton
let listeners: TtsStateListener[] = [];
let currentState: TtsPlaybackState = {
  isPlaying: false,
  isPaused: false,
  mode: null,
  currentTitle: "",
  currentIndex: 0,
  totalSections: 0,
};

let sharedEngine: TtsEngine | null = null;

export function getTtsState(): TtsPlaybackState {
  return currentState;
}

export function setTtsState(partial: Partial<TtsPlaybackState>): void {
  currentState = { ...currentState, ...partial };
  for (const listener of listeners) {
    listener(currentState);
  }
}

export function subscribeTtsState(
  listener: TtsStateListener,
): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getSharedEngine(): TtsEngine {
  if (!sharedEngine) sharedEngine = createTtsEngine();
  return sharedEngine;
}
