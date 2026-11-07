import { isTouch } from '../config';
import { formatTime } from '../daily/calendar';
import { $ } from './dom';

const TOAST_SECONDS = 1.6;

/** In-game heads-up display: chamber chip, crosshair and toast messages. */
export class Hud {
  private readonly chip = $('chip');
  private readonly levelNum = $('lvlNum');
  private readonly levelName = $('lvlName');
  private readonly hint = $('hint');
  private readonly toastEl = $('toast');
  private readonly crossBlue = document.getElementById('xhB') as SVGPathElement | null;
  private readonly crossOrange = document.getElementById('xhO') as SVGPathElement | null;
  private toastTimer = 0;
  private label = '';
  private shownSeconds = -1;

  constructor() {
    const toggle = () => this.chip.classList.toggle('collapsed');
    this.chip.addEventListener('click', toggle);
    this.chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
    const tap = this.chip.querySelector('.tap');
    if (tap) tap.textContent = isTouch ? 'Tap to hide' : 'Click to hide';
  }

  /** Shows a chamber's label (e.g. "Daily #7"), name and hint in the info chip. */
  showLevel(label: string, name: string, hint: string): void {
    this.label = label;
    this.shownSeconds = -1;
    this.levelNum.textContent = label;
    this.levelName.textContent = name;
    this.hint.textContent = hint;
    this.chip.classList.remove('collapsed');
  }

  /** Shows the run time next to the chamber label; null hides it. */
  setTime(seconds: number | null): void {
    const whole = seconds === null ? -1 : Math.floor(seconds);
    if (whole === this.shownSeconds) return;
    this.shownSeconds = whole;
    this.levelNum.textContent = seconds === null ? this.label : `${this.label} · ${formatTime(seconds)}`;
  }

  setCrosshair(bluePlaced: boolean, orangePlaced: boolean): void {
    this.crossBlue?.classList.toggle('on', bluePlaced);
    this.crossOrange?.classList.toggle('on', orangePlaced);
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    this.toastTimer = TOAST_SECONDS;
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}
