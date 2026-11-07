import { isTouch, type PortalIndex } from './config';
import { $ } from './ui/dom';

/** Game actions triggered by input. */
export interface InputActions {
  isPlaying(): boolean;
  look(dx: number, dy: number, sensitivity: number): void;
  shoot(index: PortalIndex): void;
  jump(): void;
  grab(): void;
  restart(): void;
  openSettings(): void;
  openMenu(): void;
}

const MOUSE_LOCKED_SENS = 0.0022;
const MOUSE_DRAG_SENS = 0.0045;
const TOUCH_LOOK_SENS = 0.0065;
const JOYSTICK_RADIUS = 50;
/** Pixels of movement under which a drag counts as a click. */
const CLICK_SLOP = 6;

interface Drag {
  x: number;
  y: number;
  moved: number;
  button: number;
}

/**
 * Keyboard, mouse (pointer lock with drag-to-look fallback) and touch
 * (virtual joystick + look area + buttons) input.
 */
export class Input {
  private readonly keys = new Set<string>();
  /** Virtual joystick deflection: x = strafe right, y = forward. */
  readonly joystick = { x: 0, y: 0 };

  private locked = false;
  private lockFailed = isTouch;
  private drag: Drag | null = null;
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookPos = { x: 0, y: 0 };

  private readonly joyBase = $('joyBase');
  private readonly joyKnob = $('joyKnob');
  private readonly resumeEl = $('resume');

  constructor(private readonly canvas: HTMLCanvasElement, private readonly actions: InputActions) {
    this.bindKeyboard();
    this.bindMouse();
    this.bindTouch();
    this.bindButtons();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  get isPointerLocked(): boolean {
    return this.locked;
  }

  /** Requests pointer lock (desktop only); falls back to drag-to-look if refused. */
  tryLock(): void {
    if (this.lockFailed || isTouch) return;
    const onFail = () => {
      this.lockFailed = true;
      this.updateResumeHint();
    };
    try {
      const result = this.canvas.requestPointerLock() as Promise<void> | undefined;
      result?.catch?.(onFail);
    } catch {
      onFail();
    }
  }

  /** Releases pointer lock and any held touches (when a menu opens). */
  release(): void {
    if (this.locked) document.exitPointerLock?.();
    this.joyId = null;
    this.lookId = null;
    this.joystick.x = this.joystick.y = 0;
    this.joyBase.style.display = 'none';
    this.resumeEl.style.display = 'none';
  }

  /** Shows "Click to look around" when the game is running without pointer lock. */
  updateResumeHint(): void {
    const el = this.resumeEl;
    if (!this.actions.isPlaying() || isTouch || this.locked) {
      el.style.display = 'none';
      return;
    }
    el.textContent = this.lockFailed ? 'Drag to look, click to fire' : 'Click to look around';
    el.style.display = 'block';
    if (this.lockFailed) {
      setTimeout(() => {
        if (this.lockFailed) el.style.display = 'none';
      }, 4000);
    }
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (!this.actions.isPlaying() || e.repeat) return;
      switch (e.code) {
        case 'Space': this.actions.jump(); e.preventDefault(); break;
        case 'KeyE': this.actions.grab(); break;
        case 'KeyR': this.actions.restart(); break;
        case 'KeyQ': case 'Digit1': this.actions.shoot(0); break;
        case 'KeyF': case 'Digit2': this.actions.shoot(1); break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private bindMouse(): void {
    const { canvas, actions } = this;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.updateResumeHint();
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
      this.updateResumeHint();
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (!actions.isPlaying()) return;
      if (this.locked) {
        actions.shoot(e.button === 2 ? 1 : 0);
        return;
      }
      if (!this.lockFailed) {
        this.tryLock();
        return;
      }
      this.drag = { x: e.clientX, y: e.clientY, moved: 0, button: e.button };
    });
    window.addEventListener('mousemove', (e) => {
      if (!actions.isPlaying()) return;
      if (this.locked) {
        actions.look(e.movementX, e.movementY, MOUSE_LOCKED_SENS);
      } else if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        actions.look(dx, dy, MOUSE_DRAG_SENS);
      }
    });
    window.addEventListener('mouseup', () => {
      if (this.drag && this.drag.moved < CLICK_SLOP && actions.isPlaying()) {
        actions.shoot(this.drag.button === 2 ? 1 : 0);
      }
      this.drag = null;
    });
  }

  private bindTouch(): void {
    const { canvas } = this;
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!this.actions.isPlaying()) return;
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.45 && this.joyId === null) {
          this.joyId = t.identifier;
          this.joyOrigin = { x: t.clientX, y: t.clientY };
          this.joyBase.style.left = `${t.clientX}px`;
          this.joyBase.style.top = `${t.clientY}px`;
          this.joyBase.style.display = 'block';
          this.joyKnob.style.transform = 'translate(0,0)';
        } else if (this.lookId === null) {
          this.lookId = t.identifier;
          this.lookPos = { x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joyId) {
          let dx = t.clientX - this.joyOrigin.x;
          let dy = t.clientY - this.joyOrigin.y;
          const len = Math.hypot(dx, dy);
          if (len > JOYSTICK_RADIUS) {
            dx *= JOYSTICK_RADIUS / len;
            dy *= JOYSTICK_RADIUS / len;
          }
          this.joystick.x = dx / JOYSTICK_RADIUS;
          this.joystick.y = -dy / JOYSTICK_RADIUS;
          this.joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
        } else if (t.identifier === this.lookId) {
          this.actions.look(t.clientX - this.lookPos.x, t.clientY - this.lookPos.y, TOUCH_LOOK_SENS);
          this.lookPos = { x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: false });

    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joyId) {
          this.joyId = null;
          this.joystick.x = this.joystick.y = 0;
          this.joyBase.style.display = 'none';
        }
        if (t.identifier === this.lookId) this.lookId = null;
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }

  private bindButtons(): void {
    const bind = (id: string, fn: () => void) => {
      const el = $(id);
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('down');
        fn();
      }, { passive: false });
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        el.classList.remove('down');
      });
      el.addEventListener('touchcancel', () => el.classList.remove('down'));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
    };
    bind('bBlue', () => this.actions.shoot(0));
    bind('bOrange', () => this.actions.shoot(1));
    bind('bJump', () => this.actions.jump());
    bind('bGrab', () => this.actions.grab());

    $('resetBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.actions.isPlaying()) this.actions.restart();
      (e.currentTarget as HTMLElement).blur();
    });
    $('menuBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).blur();
      this.actions.openMenu();
    });
    $('gearBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).blur();
      this.actions.openSettings();
    });

    if (isTouch) $('touch').classList.add('on');
  }
}
