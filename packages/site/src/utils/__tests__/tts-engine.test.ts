import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTtsEngine } from "../tts-engine";

// Mock SpeechSynthesisUtterance
class MockUtterance {
  text: string;
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onboundary: ((e: { charIndex: number }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

function setupSpeechSynthesis() {
  const spoken: MockUtterance[] = [];
  const mock = {
    speak: vi.fn((u: MockUtterance) => {
      spoken.push(u);
      // Auto-trigger onstart then onend for testing
      u.onstart?.();
      u.onend?.();
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    speaking: false,
    paused: false,
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: mock,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: MockUtterance,
    writable: true,
    configurable: true,
  });
  return { mock, spoken };
}

function removeSpeechSynthesis() {
  // @ts-expect-error - removing for test
  delete window.speechSynthesis;
  // @ts-expect-error - removing for test
  delete window.SpeechSynthesisUtterance;
}

describe("createTtsEngine", () => {
  beforeEach(() => {
    localStorage.clear();
    removeSpeechSynthesis();
  });

  it("isSupported() returns false when speechSynthesis not available", () => {
    const engine = createTtsEngine();
    expect(engine.isSupported()).toBe(false);
  });

  it("isSupported() returns true when available", () => {
    setupSpeechSynthesis();
    const engine = createTtsEngine();
    expect(engine.isSupported()).toBe(true);
  });

  it("speak() creates SpeechSynthesisUtterance with correct text", () => {
    const { spoken } = setupSpeechSynthesis();
    const engine = createTtsEngine();
    engine.speak("Hello world.");
    expect(spoken.length).toBeGreaterThanOrEqual(1);
    expect(spoken[0].text).toBe("Hello world.");
  });

  it("chunks long text at sentence boundaries", () => {
    const { spoken } = setupSpeechSynthesis();
    const engine = createTtsEngine();
    // Build text with multiple sentences exceeding 200 chars
    const sentences = [
      "This is the first sentence that has some decent length to it.",
      "Here is the second sentence which also has some words.",
      "A third sentence to push us over the character limit for chunking.",
      "And a fourth sentence just for good measure.",
      "Fifth sentence brings extra content beyond the boundary.",
    ];
    const text = sentences.join(" ");
    engine.speak(text);
    // Should have been split into multiple chunks
    expect(spoken.length).toBeGreaterThan(1);
    // All text should be present across chunks
    const allText = spoken.map((u) => u.text).join(" ");
    for (const s of sentences) {
      expect(allText).toContain(s.replace(/\.$/, ""));
    }
  });

  it("setRate() persists to localStorage", () => {
    setupSpeechSynthesis();
    const engine = createTtsEngine();
    engine.setRate(1.5);
    expect(localStorage.getItem("foundry-tts-speed")).toBe("1.5");
    expect(engine.getRate()).toBe(1.5);
  });

  it("cancel() calls speechSynthesis.cancel()", () => {
    const { mock } = setupSpeechSynthesis();
    const engine = createTtsEngine();
    engine.cancel();
    expect(mock.cancel).toHaveBeenCalled();
  });

  it("rate loaded from localStorage on creation", () => {
    localStorage.setItem("foundry-tts-speed", "1.25");
    setupSpeechSynthesis();
    const engine = createTtsEngine();
    expect(engine.getRate()).toBe(1.25);
  });

  it("all methods are no-ops when not supported", () => {
    const engine = createTtsEngine();
    // These should not throw
    expect(() => engine.speak("test")).not.toThrow();
    expect(() => engine.pause()).not.toThrow();
    expect(() => engine.resume()).not.toThrow();
    expect(() => engine.cancel()).not.toThrow();
    expect(engine.isSpeaking()).toBe(false);
    expect(engine.isPaused()).toBe(false);
  });

  it("speak() applies current rate to utterance", () => {
    const { spoken } = setupSpeechSynthesis();
    const engine = createTtsEngine();
    engine.setRate(2);
    engine.speak("Test.");
    expect(spoken[0].rate).toBe(2);
  });
});
