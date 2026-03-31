import { useState, useEffect } from 'react';
import { setToken, clearToken, getToken } from '../utils/api.js';

export default function TokenModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [token, setTokenInput] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const handleAuthRequired = () => {
      setIsOpen(true);
      setError('Token expired or invalid — please re-enter');
    };

    const handleAuthUnlocked = () => {
      setIsOpen(false);
      setError('');
      setTokenInput('');
    };

    window.addEventListener('foundry-auth-required', handleAuthRequired);
    window.addEventListener('foundry-auth-unlocked', handleAuthUnlocked);

    return () => {
      window.removeEventListener('foundry-auth-required', handleAuthRequired);
      window.removeEventListener('foundry-auth-unlocked', handleAuthUnlocked);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token.trim()) {
      setError('Please enter a token');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // Store the token and test it by making a simple request
      setToken(token.trim());

      // Test the token with a simple API call
      const response = await fetch('/api/annotations?doc_path=test&test=true', {
        headers: {
          'Authorization': `Bearer ${token.trim()}`
        }
      });

      if (response.ok || response.status === 404) {
        // 404 is fine for testing - means token is valid but no annotations for test path
        window.dispatchEvent(new CustomEvent('foundry-auth-unlocked'));
        setIsOpen(false);
        setError('');
        setTokenInput('');
      } else if (response.status === 401) {
        // Invalid token
        clearToken();
        setError('Invalid token — please check and try again');
      } else {
        // Other error
        setError('Unable to validate token — please try again');
      }
    } catch (err) {
      setError('Network error — please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setError('');
    setTokenInput('');
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="token-modal-backdrop" onClick={handleBackdropClick}>
      <div className="token-modal">
        <div className="token-modal__content">
          <div className="token-modal__header">
            <h3>🔒 Access Token Required</h3>
            <button
              className="token-modal__close"
              onClick={handleClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <p className="token-modal__description">
            Enter your access token to view and create annotations.
          </p>

          {error && (
            <div className="token-modal__error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <input
              type="password"
              className="token-modal__input"
              placeholder="Enter access token"
              value={token}
              onChange={(e) => setTokenInput(e.target.value)}
              disabled={isSubmitting}
              autoFocus
            />

            <div className="token-modal__actions">
              <button
                type="submit"
                className="token-modal__submit"
                disabled={isSubmitting || !token.trim()}
              >
                {isSubmitting ? 'Validating...' : 'Unlock'}
              </button>
              <button
                type="button"
                className="token-modal__cancel"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      <style jsx>{`
        .token-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          animation: fadeIn 0.2s ease-out;
        }

        .token-modal {
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
          min-width: 400px;
          max-width: 90vw;
          animation: slideIn 0.3s ease-out;
        }

        .token-modal__content {
          padding: var(--spacing-lg);
        }

        .token-modal__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--spacing-md);
        }

        .token-modal__header h3 {
          margin: 0;
          color: var(--color-heading);
          font-size: var(--font-size-lg);
        }

        .token-modal__close {
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          padding: 4px;
          color: var(--color-text-secondary);
          border-radius: 4px;
          transition: background-color var(--transition-fast), color var(--transition-fast);
        }

        .token-modal__close:hover {
          background: var(--color-bg-secondary);
          color: var(--color-text);
        }

        .token-modal__description {
          margin-bottom: var(--spacing-lg);
          color: var(--color-text-secondary);
          font-size: var(--font-size-sm);
        }

        .token-modal__error {
          background: var(--color-danger-bg);
          color: var(--color-danger-border);
          border: 1px solid var(--color-danger-border);
          border-radius: 6px;
          padding: var(--spacing-sm);
          margin-bottom: var(--spacing-md);
          font-size: var(--font-size-sm);
        }

        .token-modal__input {
          width: 100%;
          padding: var(--spacing-sm) var(--spacing-md);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          font-family: var(--font-body);
          font-size: var(--font-size-base);
          background: var(--color-bg);
          color: var(--color-text);
          margin-bottom: var(--spacing-md);
          transition: border-color var(--transition-fast);
        }

        .token-modal__input:focus {
          outline: none;
          border-color: var(--color-accent);
        }

        .token-modal__input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .token-modal__actions {
          display: flex;
          gap: var(--spacing-sm);
        }

        .token-modal__submit {
          flex: 1;
          padding: var(--spacing-sm) var(--spacing-lg);
          background: var(--color-accent);
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: var(--font-size-sm);
          font-weight: 500;
          cursor: pointer;
          transition: background-color var(--transition-fast);
        }

        .token-modal__submit:hover:not(:disabled) {
          background: var(--color-accent-hover);
        }

        .token-modal__submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .token-modal__cancel {
          padding: var(--spacing-sm) var(--spacing-lg);
          background: none;
          color: var(--color-text-secondary);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          font-size: var(--font-size-sm);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .token-modal__cancel:hover:not(:disabled) {
          background: var(--color-bg-secondary);
          color: var(--color-text);
        }

        .token-modal__cancel:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        /* Dark theme adjustments */
        :global([data-theme="dark"]) .token-modal {
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }

        /* Mobile responsive */
        @media (max-width: 768px) {
          .token-modal {
            min-width: 320px;
            max-width: 95vw;
          }

          .token-modal__content {
            padding: var(--spacing-md);
          }
        }
      `}</style>
    </div>
  );
}