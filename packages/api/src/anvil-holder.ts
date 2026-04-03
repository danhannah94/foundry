/**
 * AnvilHolder — lazy container for deferred Anvil initialization.
 * The server starts immediately; Anvil loads in the background.
 *
 * States: not-started → initializing → ready | error
 */

import type { AnvilInstance } from './anvil-loader.js';
import { loadAnvil } from './anvil-loader.js';

export type AnvilStatus = 'not-started' | 'initializing' | 'ready' | 'error';

export class AnvilHolder {
  private anvil: AnvilInstance | null = null;
  private _status: AnvilStatus = 'not-started';
  private _error: string | null = null;

  get(): AnvilInstance | null {
    return this.anvil;
  }

  get status(): AnvilStatus {
    return this._status;
  }

  get error(): string | null {
    return this._error;
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  isInitializing(): boolean {
    return this._status === 'initializing';
  }

  async init(docsPath: string): Promise<void> {
    this._status = 'initializing';
    try {
      const anvil = await loadAnvil(docsPath);
      if (anvil) {
        this.anvil = anvil;
        this._status = 'ready';
      } else {
        this._status = 'error';
        this._error = 'Anvil not available (not installed or init failed)';
      }
    } catch (err) {
      this._status = 'error';
      this._error = err instanceof Error ? err.message : String(err);
    }
  }
}
