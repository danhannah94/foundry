import { useState, useEffect } from 'react';
import { isAuthenticated } from '../utils/api.js';

const STORAGE_KEY = 'foundry-theme';
const TTS_STORAGE_KEY = 'foundry-tts-enabled';

function getTheme(): 'light' | 'dark' | 'system' {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function setTheme(theme: 'light' | 'dark' | 'system') {
  if (theme === 'system') {
    localStorage.removeItem(STORAGE_KEY);
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } else {
    localStorage.setItem(STORAGE_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function getTtsEnabled(): boolean {
  const stored = localStorage.getItem(TTS_STORAGE_KEY);
  return stored !== 'false'; // Default to true
}

function setTtsEnabled(enabled: boolean) {
  localStorage.setItem(TTS_STORAGE_KEY, String(enabled));
  if (enabled) {
    document.body.classList.remove('tts-disabled');
  } else {
    document.body.classList.add('tts-disabled');
  }
}

export default function SettingsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>('system');
  const [ttsEnabled, setTtsEnabledState] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    setThemeState(getTheme());
    setTtsEnabledState(getTtsEnabled());
    setAuthenticated(isAuthenticated());

    const handleAuthUnlocked = () => setAuthenticated(true);
    const handleAuthRequired = () => setAuthenticated(false);

    window.addEventListener('foundry-auth-unlocked', handleAuthUnlocked);
    window.addEventListener('foundry-auth-required', handleAuthRequired);

    return () => {
      window.removeEventListener('foundry-auth-unlocked', handleAuthUnlocked);
      window.removeEventListener('foundry-auth-required', handleAuthRequired);
    };
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    setThemeState(newTheme);
  };

  const handleTtsToggle = () => {
    const newEnabled = !ttsEnabled;
    setTtsEnabled(newEnabled);
    setTtsEnabledState(newEnabled);
  };

  const handleAuthClick = () => {
    window.dispatchEvent(new CustomEvent('foundry-auth-required'));
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setIsOpen(false);
    }
  };

  return (
    <>
      <button
        className="settings-gear-btn"
        onClick={() => setIsOpen(true)}
        aria-label="Open settings"
        title="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {isOpen && (
        <div className="settings-modal-overlay" onClick={handleOverlayClick}>
          <div className="settings-modal" role="dialog" aria-labelledby="settings-title">
            <div className="settings-modal__header">
              <h3 id="settings-title">Settings</h3>
              <button
                className="settings-modal__close"
                onClick={() => setIsOpen(false)}
                aria-label="Close settings"
              >
                ✕
              </button>
            </div>

            <div className="settings-modal__content">
              {/* Appearance Section */}
              <div className="settings-section">
                <h4 className="settings-section__title">Appearance</h4>
                <div className="settings-radio-group">
                  <label className="settings-radio">
                    <input
                      type="radio"
                      name="theme"
                      value="light"
                      checked={theme === 'light'}
                      onChange={() => handleThemeChange('light')}
                    />
                    <span className="settings-radio__label">Light</span>
                  </label>
                  <label className="settings-radio">
                    <input
                      type="radio"
                      name="theme"
                      value="dark"
                      checked={theme === 'dark'}
                      onChange={() => handleThemeChange('dark')}
                    />
                    <span className="settings-radio__label">Dark</span>
                  </label>
                  <label className="settings-radio">
                    <input
                      type="radio"
                      name="theme"
                      value="system"
                      checked={theme === 'system'}
                      onChange={() => handleThemeChange('system')}
                    />
                    <span className="settings-radio__label">System</span>
                  </label>
                </div>
              </div>

              {/* Audio Section */}
              <div className="settings-section">
                <h4 className="settings-section__title">Audio</h4>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={ttsEnabled}
                    onChange={handleTtsToggle}
                  />
                  <span className="settings-toggle__slider"></span>
                  <span className="settings-toggle__label">Text-to-Speech</span>
                </label>
              </div>

              {/* Authentication Section */}
              <div className="settings-section">
                <h4 className="settings-section__title">Authentication</h4>
                <button
                  className="settings-auth-row"
                  onClick={handleAuthClick}
                  title={authenticated ? 'Click to manage token' : 'Click to authenticate'}
                >
                  <span className="settings-auth-icon">
                    {authenticated ? '🔓' : '🔒'}
                  </span>
                  <span className="settings-auth-label">
                    {authenticated ? 'Unlocked' : 'Locked'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}