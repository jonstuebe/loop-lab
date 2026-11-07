/**
 * Drives the loading screen that index.html paints before any script runs.
 * Each step updates the status line and progress bar; finish() fades it out.
 */
export class Preloader {
  private readonly root = document.getElementById('preloader');
  private readonly fill = document.getElementById('plFill');
  private readonly status = document.getElementById('plStatus');

  /** Shows a status message and moves the bar to `progress` (0–1). Resolves once it's painted. */
  async step(message: string, progress: number): Promise<void> {
    if (this.status) this.status.textContent = message;
    if (this.fill) this.fill.style.width = `${Math.round(Math.max(0.06, Math.min(1, progress)) * 100)}%`;
    await nextPaint();
  }

  finish(): void {
    const root = this.root;
    if (!root) return;
    if (this.fill) this.fill.style.width = '100%';
    root.classList.add('gone');
    root.addEventListener('transitionend', () => root.remove(), { once: true });
    setTimeout(() => root.remove(), 1000);
  }

  fail(message: string): void {
    if (this.status) {
      this.status.textContent = message;
      this.status.classList.add('err');
    }
    this.fill?.parentElement?.remove();
  }
}

/** Resolves after the browser has had a chance to paint (two animation frames). */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
