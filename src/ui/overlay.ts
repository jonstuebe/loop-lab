import { QUALITY, QUALITY_ORDER, type QualityName } from '../config';
import { $ } from './dom';

export interface CardAction {
  label: string;
  onClick: (button: HTMLButtonElement) => void;
}

export interface CardSpec {
  html: string;
  /** Main call-to-action: hides the overlay, then runs `onGo`. */
  label: string;
  onGo: () => void;
  /** Secondary buttons shown under the main one. They don't hide the overlay by themselves. */
  actions?: CardAction[];
  /** Called after the card is rendered, e.g. to wire up buttons inside `html`. */
  onMount?: (card: HTMLElement) => void;
}

export interface SettingsSpec {
  current: QualityName;
  closeLabel: string;
  onSelect: (quality: QualityName) => void;
  onClose: () => void;
}

/** Modal cards (title, level complete) and the graphics settings sheet. */
export class Overlay {
  private readonly root = $('overlay');
  private readonly card = $('card');
  private fpsEl: HTMLElement | null = null;
  /** The card currently shown, so settings can return to it. */
  current: CardSpec | null = null;

  showCard(spec: CardSpec): void {
    this.current = spec;
    this.fpsEl = null;
    this.root.classList.remove('peek');
    const actions = spec.actions?.length
      ? `<div class="actions">${spec.actions.map((a, i) => `<button class="cta alt" data-action="${i}">${a.label}</button>`).join('')}</div>`
      : '';
    this.card.innerHTML = `${spec.html}<button class="cta" id="go">${spec.label}</button>${actions}`;
    this.card.scrollTop = 0;
    this.root.classList.remove('hidden');
    const go = $('go');
    go.addEventListener('click', () => {
      this.hide();
      spec.onGo();
    });
    this.card.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) => {
      const action = spec.actions?.[Number(b.dataset.action)];
      if (action) b.addEventListener('click', () => action.onClick(b));
    });
    spec.onMount?.(this.card);
    go.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.root.classList.remove('peek');
    this.current = null;
    this.fpsEl = null;
  }

  /** Shows the quality picker as a bottom sheet so the scene stays visible behind it. */
  showSettings(spec: SettingsSpec): void {
    let quality = spec.current;
    const options = QUALITY_ORDER
      .map((k) => `<button role="radio" data-q="${k}" aria-checked="${k === quality}">${QUALITY[k].label}</button>`)
      .join('');
    this.card.innerHTML = `<h2>Graphics quality</h2>
      <p class="qnote">Higher settings look sharper but can lower the frame rate. The scene behind updates as you switch, so you can compare.</p>
      <div class="seg" role="radiogroup" aria-label="Graphics quality">${options}</div>
      <div class="qrow"><p id="qdesc"></p><p class="fps" id="fpsOut">– fps</p></div>
      <button class="cta" id="go">${spec.closeLabel}</button>`;
    this.root.classList.add('peek');
    this.root.classList.remove('hidden');
    this.fpsEl = $('fpsOut');

    const seg = this.card.querySelector<HTMLElement>('.seg');
    if (!seg) throw new Error('Missing quality selector');
    const desc = $('qdesc');
    const select = (q: QualityName) => {
      quality = q;
      spec.onSelect(q);
      sync();
    };
    const sync = () => {
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        b.setAttribute('aria-checked', String(b.dataset.q === quality));
      });
      desc.textContent = QUALITY[quality].desc;
    };
    seg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      const q = b?.dataset.q;
      if (q && q in QUALITY) select(q as QualityName);
    });
    seg.addEventListener('keydown', (e) => {
      let i = QUALITY_ORDER.indexOf(quality);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = Math.min(QUALITY_ORDER.length - 1, i + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = Math.max(0, i - 1);
      else return;
      e.preventDefault();
      const q = QUALITY_ORDER[i];
      select(q);
      seg.querySelector<HTMLButtonElement>(`[data-q="${q}"]`)?.focus();
    });
    sync();

    const go = $('go');
    go.addEventListener('click', () => {
      this.fpsEl = null;
      this.root.classList.remove('peek');
      spec.onClose();
    });
    go.focus({ preventScroll: true });
  }

  /** Updates the fps readout, if the settings sheet is open. */
  setFps(fps: number): void {
    if (this.fpsEl) this.fpsEl.textContent = `${Math.round(fps)} fps`;
  }
}
