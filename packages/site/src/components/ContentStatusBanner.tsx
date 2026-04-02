import { useState, useEffect } from 'react';

interface ContentStatus {
  status: 'idle' | 'updating' | 'ok' | 'error';
  lastUpdate: string | null;
  lastError: string | null;
}

export default function ContentStatusBanner() {
  const [status, setStatus] = useState<ContentStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/content/status')
      .then(res => res.json())
      .then(setStatus)
      .catch(() => {}); // Silently fail — banner is non-critical
  }, []);

  if (!status || status.status !== 'error' || dismissed) return null;

  return (
    <div style={{
      background: '#fef2f2',
      border: '1px solid #fecaca',
      borderRadius: '8px',
      padding: '12px 16px',
      margin: '0 0 16px 0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: '14px',
      color: '#991b1b',
    }}>
      <span>
        ⚠️ Content update failed{status.lastUpdate ? ` at ${new Date(status.lastUpdate).toLocaleString()}` : ''} 
        {status.lastError ? ` — ${status.lastError}` : ''}
      </span>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '18px',
          color: '#991b1b',
          padding: '0 4px',
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
