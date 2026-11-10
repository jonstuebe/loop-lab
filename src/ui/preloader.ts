import { $ } from './dom';

/**
 * Resolves once the browser has had a chance to paint. Falls back to a timer
 * so loading still finishes in a background tab, where frames don't fire.
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 120);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      setTimeout(resolve, 0);
    });
  });
}

/** The full-screen loading bar shown while the game draws its textures and builds the first chamber. */
export class Preloader {
  private readonly root = $('preloader');
  private readonly bar = $('preBar');
  private readonly label = $('preLabel');
  private readonly percent = $('prePct');
  private completed = 0;

  constructor(private readonly total: number) {}

  /** Names the stage about to run and lets the screen repaint before it blocks. */
  async begin(label: string): Promise<void> {
    this.label.textContent = label;
    this.show(this.completed / this.total);
    this.completed++;
    await nextPaint();
  }

  /** Fills the bar, fades the screen out and removes it. */
  async finish(): Promise<void> {
    this.label.textContent = 'Ready';
    this.show(1);
    await nextPaint();
    this.root.classList.add('done');
    setTimeout(() => this.root.remove(), 600);
  }

  fail(): void {
    this.root.classList.add('failed');
    this.label.textContent = 'Could not start. Reload to try again';
  }

  private show(fraction: number): void {
    const pct = Math.round(fraction * 100);
    this.bar.style.transform = `scaleX(${fraction})`;
    this.percent.textContent = `${pct}%`;
    this.root.setAttribute('aria-valuenow', String(pct));
  }
}
