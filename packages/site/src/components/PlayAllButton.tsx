interface PlayAllButtonProps {
  isPlaying: boolean;
  isPaused: boolean;
  currentIndex: number;
  totalSections: number;
  currentTitle: string;
  autoScroll: boolean;
  onPlayPause: () => void;
  onSkipForward: () => void;
  onSkipBack: () => void;
  onToggleAutoScroll: () => void;
}

export default function PlayAllButton({
  isPlaying,
  isPaused,
  currentIndex,
  totalSections,
  currentTitle,
  autoScroll,
  onPlayPause,
  onSkipForward,
  onSkipBack,
  onToggleAutoScroll,
}: PlayAllButtonProps) {
  const active = isPlaying || isPaused;

  return (
    <div className="tts-play-all">
      {active && (
        <button onClick={onSkipBack} aria-label="Skip back" title="Restart section (double-tap for previous)">
          ⏮
        </button>
      )}

      <button onClick={onPlayPause} aria-label={active ? (isPaused ? "Resume" : "Pause") : "Play all"}>
        {active ? (isPaused ? "▶ Resume" : "⏸ Pause") : "▶ Play All"}
      </button>

      {active && (
        <button onClick={onSkipForward} aria-label="Skip forward" title="Skip to next section">
          ⏭
        </button>
      )}

      {active && (
        <button
          onClick={onToggleAutoScroll}
          aria-label="Toggle auto-scroll"
          title={autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
          style={{ opacity: autoScroll ? 1 : 0.5 }}
        >
          {autoScroll ? "↓ Scroll" : "↓"}
        </button>
      )}

      {active && currentTitle && (
        <span className="tts-status">
          Reading: {currentTitle} ({currentIndex + 1}/{totalSections})
        </span>
      )}
    </div>
  );
}
