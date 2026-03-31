const TOKEN_KEY = 'foundry_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// Wrapper for fetch that adds auth headers to protected endpoints
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });

  // If we get a 401, clear the stored token and dispatch event
  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('foundry-auth-required'));
  }

  return response;
}