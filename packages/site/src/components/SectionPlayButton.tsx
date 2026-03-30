interface SectionPlayButtonProps {
  sectionId: string;
  sectionText: string;
  isActive: boolean;
  isPaused: boolean;
  onToggle: (sectionId: string, sectionText: string) => void;
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2.5v11l9-5.5L4 2.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="2" width="3.5" height="12" rx="0.5" />
      <rect x="9.5" y="2" width="3.5" height="12" rx="0.5" />
    </svg>
  );
}

export default function SectionPlayButton({
  sectionId,
  sectionText,
  isActive,
  isPaused,
  onToggle,
}: SectionPlayButtonProps) {
  const showPause = isActive && !isPaused;

  return (
    <button
      className={`tts-play-btn${showPause ? ' tts-playing' : ''}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(sectionId, sectionText);
      }}
      aria-label={showPause ? 'Pause reading' : 'Read section aloud'}
      title={showPause ? 'Pause reading' : 'Read section aloud'}
    >
      {showPause ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}
