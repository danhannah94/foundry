export interface TtsEngineEvents {
  onStart?: () => void;
  onEnd?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onBoundary?: (charIndex: number) => void;
  onError?: (error: string) => void;
}

export interface TtsEngine {
  speak(text: string, events?: TtsEngineEvents): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  setRate(rate: number): void;
  getRate(): number;
  isSupported(): boolean;
  isSpeaking(): boolean;
  isPaused(): boolean;
}

const STORAGE_KEY = "foundry-tts-speed";
const CHUNK_TARGET = 200;

/** Split text into chunks at sentence boundaries, targeting ~200 chars each. */
function splitIntoChunks(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or newline
  const sentences = text.split(/(?<=[.!?])[\s\n]+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    if (current.length + sentence.length > CHUNK_TARGET && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

function loadRate(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const val = parseFloat(stored);
      if (!isNaN(val) && val > 0) return val;
    }
  } catch {
    // localStorage unavailable
  }
  return 1;
}

function saveRate(rate: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(rate));
  } catch {
    // localStorage unavailable
  }
}

export function createTtsEngine(): TtsEngine {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  let rate = supported ? loadRate() : 1;
  let paused = false;
  let speaking = false;
  let cancelRequested = false;

  function speakChunks(
    chunks: string[],
    index: number,
    events?: TtsEngineEvents,
    charOffset = 0,
  ): void {
    if (!supported || cancelRequested || index >= chunks.length) {
      speaking = false;
      paused = false;
      if (!cancelRequested) events?.onEnd?.();
      cancelRequested = false;
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    utterance.rate = rate;

    utterance.onstart = () => {
      if (index === 0) events?.onStart?.();
    };

    utterance.onboundary = (e) => {
      events?.onBoundary?.(charOffset + e.charIndex);
    };

    utterance.onerror = (e) => {
      if (e.error === "canceled" || e.error === "interrupted") return;
      speaking = false;
      paused = false;
      events?.onError?.(e.error);
    };

    utterance.onend = () => {
      const nextOffset = charOffset + chunks[index].length + 1;
      speakChunks(chunks, index + 1, events, nextOffset);
    };

    window.speechSynthesis.speak(utterance);
  }

  return {
    speak(text: string, events?: TtsEngineEvents): void {
      if (!supported) return;
      this.cancel();
      cancelRequested = false;
      speaking = true;
      paused = false;
      const chunks = splitIntoChunks(text);
      speakChunks(chunks, 0, events);
    },

    pause(): void {
      if (!supported || !speaking) return;
      window.speechSynthesis.pause();
      paused = true;
    },

    resume(): void {
      if (!supported || !paused) return;
      window.speechSynthesis.resume();
      paused = false;
    },

    cancel(): void {
      if (!supported) return;
      cancelRequested = true;
      window.speechSynthesis.cancel();
      speaking = false;
      paused = false;
    },

    setRate(newRate: number): void {
      rate = newRate;
      if (supported) saveRate(newRate);
    },

    getRate(): number {
      return rate;
    },

    isSupported(): boolean {
      return supported;
    },

    isSpeaking(): boolean {
      return speaking;
    },

    isPaused(): boolean {
      return paused;
    },
  };
}
