import { useState, useEffect, useCallback } from "react";
import {
  subscribeTtsState,
  getTtsState,
  setTtsState,
  getSharedEngine,
} from "../utils/tts-state";
import type { TtsPlaybackState } from "../utils/tts-state";

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2.5v11l9-5.5L4 2.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="2" width="3.5" height="12" rx="0.5" />
      <rect x="9.5" y="2" width="3.5" height="12" rx="0.5" />
    </svg>
  );
}

function SkipBackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="3" width="2" height="10" rx="0.5" />
      <path d="M14 3v10L6 8l8-5z" />
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 3v10l8-5L2 3z" />
      <rect x="12" y="3" width="2" height="10" rx="0.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
    </svg>
  );
}

export default function TtsControlsBar() {
  const [state, setState] = useState<TtsPlaybackState>(getTtsState);
  const [speed, setSpeed] = useState(() => {
    try {
      const stored = localStorage.getItem("foundry-tts-speed");
      if (stored) {
        const val = parseFloat(stored);
        if (!isNaN(val) && val > 0) return val;
      }
    } catch {
      // ignore
    }
    return 1;
  });

  useEffect(() => {
    return subscribeTtsState(setState);
  }, []);

  const visible = state.isPlaying || state.isPaused;

  // Toggle body class for bottom padding
  useEffect(() => {
    if (visible) {
      document.body.classList.add("tts-bar-active");
    } else {
      document.body.classList.remove("tts-bar-active");
    }
    return () => {
      document.body.classList.remove("tts-bar-active");
    };
  }, [visible]);

  const handlePlayPause = useCallback(() => {
    const engine = getSharedEngine();
    if (state.isPaused) {
      engine.resume();
      setTtsState({ isPaused: false });
    } else if (state.isPlaying) {
      engine.pause();
      setTtsState({ isPaused: true });
    }
  }, [state.isPlaying, state.isPaused]);

  const handleStop = useCallback(() => {
    const engine = getSharedEngine();
    engine.cancel();
    document.querySelectorAll(".tts-active, .tts-playing").forEach((el) => {
      el.classList.remove("tts-active", "tts-playing");
    });
    setTtsState({
      isPlaying: false,
      isPaused: false,
      mode: null,
      currentTitle: "",
    });
  }, []);

  const handleSpeedChange = useCallback((newSpeed: number) => {
    const engine = getSharedEngine();
    engine.setRate(newSpeed);
    setSpeed(newSpeed);
  }, []);

  const handleSkipBack = useCallback(() => {
    // Dispatch a custom event that PlayAllManager listens to
    window.dispatchEvent(new CustomEvent("tts-controls-skip-back"));
  }, []);

  const handleSkipForward = useCallback(() => {
    window.dispatchEvent(new CustomEvent("tts-controls-skip-forward"));
  }, []);

  // Keyboard shortcut: Space to play/pause when bar is visible
  useEffect(() => {
    if (!visible) return;

    function handleKeydown(e: KeyboardEvent) {
      // Don't intercept if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      // Don't intercept if contenteditable
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.code === "Space") {
        e.preventDefault();
        const engine = getSharedEngine();
        const s = getTtsState();
        if (s.isPaused) {
          engine.resume();
          setTtsState({ isPaused: false });
        } else if (s.isPlaying) {
          engine.pause();
          setTtsState({ isPaused: true });
        }
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [visible]);

  // Build info text
  let infoText = "";
  if (state.mode === "playall" && state.totalSections > 0) {
    infoText = `${state.currentIndex + 1}/${state.totalSections} — ${state.currentTitle}`;
  } else if (state.currentTitle) {
    infoText = state.currentTitle;
  }

  return (
    <div className={`tts-controls-bar${visible ? " visible" : ""}`}>
      {state.mode === "playall" && (
        <button
          className="tts-bar-btn"
          onClick={handleSkipBack}
          aria-label="Previous section"
          title="Previous section"
        >
          <SkipBackIcon />
        </button>
      )}

      <button
        className="tts-bar-btn tts-bar-btn-play"
        onClick={handlePlayPause}
        aria-label={state.isPaused ? "Resume" : "Pause"}
        title={state.isPaused ? "Resume" : "Pause"}
      >
        {state.isPaused ? <PlayIcon /> : <PauseIcon />}
      </button>

      {state.mode === "playall" && (
        <button
          className="tts-bar-btn"
          onClick={handleSkipForward}
          aria-label="Next section"
          title="Next section"
        >
          <SkipForwardIcon />
        </button>
      )}

      {infoText && (
        <span className="tts-bar-info" title={infoText}>
          {infoText}
        </span>
      )}

      <div className="tts-bar-speed">
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            className={`tts-bar-speed-btn${speed === s ? " active" : ""}`}
            onClick={() => handleSpeedChange(s)}
            aria-label={`Speed ${s}x`}
            title={`${s}x speed`}
          >
            {s}x
          </button>
        ))}
      </div>

      <button
        className="tts-bar-btn tts-bar-btn-close"
        onClick={handleStop}
        aria-label="Stop playback"
        title="Stop playback"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
