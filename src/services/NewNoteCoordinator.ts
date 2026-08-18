import { NEW_NOTE_PROMPT_WINDOW_MS } from '../constants';

interface CandidateState {
  createdAt: number;
  handled: boolean;
  skipped: boolean;
}

export class NewNoteCoordinator {
  private readonly candidates = new Map<string, CandidateState>();
  private ready = false;

  constructor(
    private readonly clock: () => number = () => Date.now(),
    private readonly promptWindowMs: number = NEW_NOTE_PROMPT_WINDOW_MS,
  ) {}

  public markReady(): void {
    this.ready = true;
  }

  public markCreated(filePath: string): void {
    if (!this.ready) {
      return;
    }

    this.candidates.set(filePath, {
      createdAt: this.clock(),
      handled: false,
      skipped: false,
    });
  }

  public shouldPrompt(filePath: string): boolean {
    const candidate = this.candidates.get(filePath);
    if (!candidate || candidate.handled || candidate.skipped) {
      return false;
    }

    return this.clock() - candidate.createdAt <= this.promptWindowMs;
  }

  public markHandled(filePath: string): void {
    const candidate = this.candidates.get(filePath);
    if (!candidate) {
      return;
    }

    candidate.handled = true;
  }

  public markSkipped(filePath: string): void {
    const candidate = this.candidates.get(filePath);
    if (!candidate) {
      return;
    }

    candidate.skipped = true;
  }

  public handleRename(oldPath: string, newPath: string): void {
    const candidate = this.candidates.get(oldPath);
    if (!candidate) {
      return;
    }

    this.candidates.delete(oldPath);
    this.candidates.set(newPath, candidate);
  }

  public clearExpired(): void {
    const now = this.clock();
    for (const [filePath, candidate] of this.candidates.entries()) {
      if (candidate.handled || candidate.skipped || now - candidate.createdAt > this.promptWindowMs) {
        this.candidates.delete(filePath);
      }
    }
  }
}
