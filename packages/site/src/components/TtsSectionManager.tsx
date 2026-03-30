import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { extractSections } from '../utils/tts-extractor';
import { getSharedEngine, getTtsState, setTtsState } from '../utils/tts-state';
import type { TtsSection } from '../utils/tts-extractor';
import SectionPlayButton from './SectionPlayButton';

interface SectionEntry {
  section: TtsSection;
  container: HTMLElement;
}

export default function TtsSectionManager() {
  const [entries, setEntries] = useState<SectionEntry[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const engine = getSharedEngine();
    if (!engine.isSupported()) return;

    const contentEl = document.querySelector('.content') as HTMLElement;
    if (!contentEl) return;

    const sections = extractSections(contentEl);
    const newEntries: SectionEntry[] = [];

    for (const section of sections) {
      if (!section.id) continue;
      const container = document.createElement('span');
      container.className = 'tts-btn-container';
      section.element.appendChild(container);
      newEntries.push({ section, container });
    }

    setEntries(newEntries);

    return () => {
      engine.cancel();
      for (const { container } of newEntries) {
        container.remove();
      }
    };
  }, []);

  function handleToggle(sectionId: string, sectionText: string) {
    const engine = getSharedEngine();
    const state = getTtsState();

    // If PlayAll is active, stop it first
    if (state.mode === 'playall' && state.isPlaying) {
      engine.cancel();
      document.querySelectorAll('.tts-playing').forEach((el) => el.classList.remove('tts-playing'));
      setTtsState({ isPlaying: false, isPaused: false, mode: null, currentTitle: '' });
    }

    // Clicking the currently active section: toggle pause/resume
    if (activeSectionId === sectionId) {
      if (engine.isPaused()) {
        engine.resume();
        setIsPaused(false);
        setTtsState({ isPaused: false });
      } else if (engine.isSpeaking()) {
        engine.pause();
        setIsPaused(true);
        setTtsState({ isPaused: true });
      }
      return;
    }

    // Remove highlight from previous section
    if (activeSectionId) {
      document.getElementById(activeSectionId)?.classList.remove('tts-active');
    }

    // Find section title
    const entry = entries.find((e) => e.section.id === sectionId);
    const title = entry?.section.title ?? '';

    // Start new section
    const heading = document.getElementById(sectionId);
    heading?.classList.add('tts-active');
    setActiveSectionId(sectionId);
    setIsPaused(false);

    setTtsState({
      isPlaying: true,
      isPaused: false,
      mode: 'section',
      currentTitle: title,
      currentIndex: 0,
      totalSections: 0,
    });

    engine.speak(sectionText, {
      onEnd() {
        heading?.classList.remove('tts-active');
        setActiveSectionId(null);
        setIsPaused(false);
        setTtsState({ isPlaying: false, isPaused: false, mode: null, currentTitle: '' });
      },
      onError() {
        heading?.classList.remove('tts-active');
        setActiveSectionId(null);
        setIsPaused(false);
        setTtsState({ isPlaying: false, isPaused: false, mode: null, currentTitle: '' });
      },
    });
  }

  return (
    <>
      {entries.map(({ section, container }) =>
        createPortal(
          <SectionPlayButton
            key={section.id}
            sectionId={section.id}
            sectionText={section.title + '. ' + section.text}
            isActive={activeSectionId === section.id}
            isPaused={isPaused && activeSectionId === section.id}
            onToggle={handleToggle}
          />,
          container,
        ),
      )}
    </>
  );
}
