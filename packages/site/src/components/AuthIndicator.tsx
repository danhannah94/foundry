import { useState, useEffect } from 'react';
import { isAuthenticated, clearToken } from '../utils/api.js';

export default function AuthIndicator() {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = () => {
      setAuthenticated(isAuthenticated());
    };

    const handleAuthUnlocked = () => {
      setAuthenticated(true);
    };

    const handleAuthRequired = () => {
      setAuthenticated(false);
    };

    // Initial check
    checkAuth();

    window.addEventListener('foundry-auth-unlocked', handleAuthUnlocked);
    window.addEventListener('foundry-auth-required', handleAuthRequired);

    return () => {
      window.removeEventListener('foundry-auth-unlocked', handleAuthUnlocked);
      window.removeEventListener('foundry-auth-required', handleAuthRequired);
    };
  }, []);

  const handleClick = () => {
    if (authenticated) {
      if (confirm('Clear access token?')) {
        clearToken();
        setAuthenticated(false);
        // Optionally dispatch event to trigger UI updates
        window.dispatchEvent(new CustomEvent('foundry-auth-required'));
      }
    } else {
      window.dispatchEvent(new CustomEvent('foundry-auth-required'));
    }
  };

  return (
    <button
      className="auth-indicator"
      onClick={handleClick}
      title={authenticated ? 'Click to logout' : 'Click to login'}
      aria-label={authenticated ? 'Logged in - click to logout' : 'Not logged in - click to login'}
    >
      {authenticated ? '🔓' : '🔒'}
    </button>
  );
}