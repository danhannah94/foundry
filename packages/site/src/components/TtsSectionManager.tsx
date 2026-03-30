import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { extractSections } from '../utils/tts-extractor';
import { createTtsEngine } from '../utils/tts-engine';
import type { TtsSection } from '../utils/tts-extractor';
import type { TtsEngine } from '../utils/tts-engine';
import SectionPlayButton from './SectionPlayButton';

let sharedEngine: TtsEngine | null = null;
function getEngine(): TtsEngine {
  if (!sharedEngine) sharedEngine = createTtsEngine();
  return sharedEngine;
}

interface SectionEntry {
  section: TtsSection;
  container: HTMLElement;
}

export default function TtsSectionManager() {
  const [entries, setEntries] = useState<SectionEntry[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const engine = getEngine();
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
    const engine = getEngine();

    // Clicking the currently active section: toggle pause/resume
    if (activeSectionId === sectionId) {
      if (engine.isPaused()) {
        engine.resume();
        setIsPaused(false);
      } else if (engine.isSpeaking()) {
        engine.pause();
        setIsPaused(true);
      }
      return;
    }

    // Remove highlight from previous section
    if (activeSectionId) {
      document.getElementById(activeSectionId)?.classList.remove('tts-active');
    }

    // Start new section
    const heading = document.getElementById(sectionId);
    heading?.classList.add('tts-active');
    setActiveSectionId(sectionId);
    setIsPaused(false);

    engine.speak(sectionText, {
      onEnd() {
        heading?.classList.remove('tts-active');
        setActiveSectionId(null);
        setIsPaused(false);
      },
      onError() {
        heading?.classList.remove('tts-active');
        setActiveSectionId(null);
        setIsPaused(false);
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
