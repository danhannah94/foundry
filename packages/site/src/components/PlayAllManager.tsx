import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { extractSections } from "../utils/tts-extractor";
import { getSharedEngine, getTtsState, setTtsState } from "../utils/tts-state";
import type { TtsEngine } from "../utils/tts-engine";
import type { TtsSection } from "../utils/tts-extractor";
import PlayAllButton from "./PlayAllButton";

const AUTOSCROLL_KEY = "foundry-tts-autoscroll";

export default function PlayAllManager() {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sections, setSections] = useState<TtsSection[]>([]);
  const [autoScroll, setAutoScroll] = useState(false);

  const engineRef = useRef<TtsEngine | null>(null);
  const sectionsRef = useRef<TtsSection[]>([]);
  const currentIndexRef = useRef(0);
  const lastSkipBackTime = useRef(0);
  const isPlayingRef = useRef(false);

  // Initialize engine and find h1
  useEffect(() => {
    const engine = getSharedEngine();
    if (!engine.isSupported()) return;

    engineRef.current = engine;

    // Load autoscroll preference
    try {
      setAutoScroll(localStorage.getItem(AUTOSCROLL_KEY) === "true");
    } catch {
      // localStorage unavailable
    }

    // Find h1 and create portal container after it
    const h1 = document.querySelector("article.content h1");
    if (h1) {
      const container = document.createElement("div");
      h1.insertAdjacentElement("afterend", container);
      setPortalContainer(container);
    }

    return () => {
      engine.cancel();
      // Clean up highlights
      document.querySelectorAll(".tts-playing").forEach((el) => el.classList.remove("tts-playing"));
    };
  }, []);

  // Keep refs in sync with state
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const highlightSection = useCallback((index: number | null) => {
    document.querySelectorAll(".tts-playing").forEach((el) => el.classList.remove("tts-playing"));
    if (index !== null && sectionsRef.current[index]) {
      sectionsRef.current[index].element.classList.add("tts-playing");
    }
  }, []);

  const scrollToSection = useCallback((index: number) => {
    const section = sectionsRef.current[index];
    if (section?.element) {
      section.element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const playSection = useCallback(
    (index: number) => {
      const engine = engineRef.current;
      const sects = sectionsRef.current;

      if (!engine || index < 0 || index >= sects.length) {
        // Playback complete
        setIsPlaying(false);
        setIsPaused(false);
        highlightSection(null);
        setTtsState({ isPlaying: false, isPaused: false, mode: null, currentTitle: "" });
        return;
      }

      setCurrentIndex(index);
      setIsPlaying(true);
      setIsPaused(false);
      highlightSection(index);

      const section = sects[index];
      setTtsState({
        isPlaying: true,
        isPaused: false,
        mode: "playall",
        currentTitle: section.title,
        currentIndex: index,
        totalSections: sects.length,
      });

      // Auto-scroll: read directly from localStorage for freshness
      try {
        if (localStorage.getItem(AUTOSCROLL_KEY) === "true") {
          scrollToSection(index);
        }
      } catch {
        // localStorage unavailable
      }

      const textToSpeak = section.text ? section.title + ". " + section.text : section.title;

      engine.speak(textToSpeak, {
        onEnd: () => {
          // Auto-advance to next section
          playSection(index + 1);
        },
        onError: (error) => {
          console.warn("TTS error:", error);
          setIsPlaying(false);
          setIsPaused(false);
          highlightSection(null);
          setTtsState({ isPlaying: false, isPaused: false, mode: null, currentTitle: "" });
        },
      });
    },
    [highlightSection, scrollToSection],
  );

  const handlePlayPause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    // If section play is active, stop it first
    const state = getTtsState();
    if (state.mode === "section" && state.isPlaying) {
      engine.cancel();
      document.querySelectorAll(".tts-active").forEach((el) => el.classList.remove("tts-active"));
      setTtsState({ isPlaying: false, isPaused: false, mode: null, currentTitle: "" });
    }

    if (isPlayingRef.current && !isPaused) {
      // Pause
      engine.pause();
      setIsPaused(true);
      setTtsState({ isPaused: true });
    } else if (isPaused) {
      // Resume
      engine.resume();
      setIsPaused(false);
      setTtsState({ isPaused: false });
    } else {
      // Start fresh playback
      const content = document.querySelector("article.content");
      if (!content) return;

      const extracted = extractSections(content as HTMLElement);
      if (extracted.length === 0) return;

      setSections(extracted);
      sectionsRef.current = extracted;
      playSection(0);
    }
  }, [isPaused, playSection]);

  const handleSkipForward = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !isPlayingRef.current) return;

    engine.cancel();
    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex < sectionsRef.current.length) {
      playSection(nextIndex);
    } else {
      setIsPlaying(false);
      setIsPaused(false);
      highlightSection(null);
      setTtsState({ isPlaying: false, isPaused: false, mode: null, currentTitle: "" });
    }
  }, [playSection, highlightSection]);

  const handleSkipBack = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !isPlayingRef.current) return;

    const now = Date.now();
    const doubleTap = now - lastSkipBackTime.current < 2000;
    lastSkipBackTime.current = now;

    engine.cancel();

    if (doubleTap && currentIndexRef.current > 0) {
      // Double-tap: go to previous section
      playSection(currentIndexRef.current - 1);
    } else {
      // Single tap: restart current section
      playSection(currentIndexRef.current);
    }
  }, [playSection]);

  // Listen for skip events from TtsControlsBar
  useEffect(() => {
    function onSkipForward() {
      handleSkipForward();
    }
    function onSkipBack() {
      handleSkipBack();
    }
    window.addEventListener("tts-controls-skip-forward", onSkipForward);
    window.addEventListener("tts-controls-skip-back", onSkipBack);
    return () => {
      window.removeEventListener("tts-controls-skip-forward", onSkipForward);
      window.removeEventListener("tts-controls-skip-back", onSkipBack);
    };
  }, [handleSkipForward, handleSkipBack]);

  const handleToggleAutoScroll = useCallback(() => {
    setAutoScroll((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTOSCROLL_KEY, String(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, []);

  if (!portalContainer) return null;

  return createPortal(
    <PlayAllButton
      isPlaying={isPlaying}
      isPaused={isPaused}
      currentIndex={currentIndex}
      totalSections={sections.length}
      currentTitle={sections[currentIndex]?.title ?? ""}
      autoScroll={autoScroll}
      onPlayPause={handlePlayPause}
      onSkipForward={handleSkipForward}
      onSkipBack={handleSkipBack}
      onToggleAutoScroll={handleToggleAutoScroll}
    />,
    portalContainer,
  );
}
