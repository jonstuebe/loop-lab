import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

const W = 1024;
const H = 512;

export interface PanelText {
  eyebrow?: string;
  title: string;
  body?: string;
  /** Button prompt at the bottom, e.g. "A  Enter training chamber 2". */
  prompt?: string;
  toast?: string;
}

/**
 * A flat in-world text card drawn on a canvas, standing in for the DOM HUD and
 * menus, which don't exist inside a headset.
 */
export class VRPanel {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private last = '';

  /** @param width panel width in metres (height is half of it) */
  constructor(width: number) {
    this.canvas.width = W;
    this.canvas.height = H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthTest: false });
    this.mesh = new Mesh(new PlaneGeometry(width, width / 2), material);
    // Draw over the world so walls never cut through the card.
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  /** Redraws only when the text changed. */
  set(text: PanelText): void {
    const key = JSON.stringify(text);
    if (key === this.last) return;
    this.last = key;
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8, 12, 18, 0.86)';
    roundRect(ctx, 8, 8, W - 16, H - 16, 36);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190, 210, 230, 0.35)';
    ctx.lineWidth = 4;
    ctx.stroke();

    let y = 80;
    ctx.textBaseline = 'alphabetic';
    if (text.eyebrow) {
      ctx.fillStyle = '#93a0b0';
      ctx.font = '600 36px Rajdhani, system-ui, sans-serif';
      ctx.fillText(text.eyebrow.toUpperCase(), 48, y);
      y += 74;
    }
    ctx.fillStyle = '#eef2f6';
    ctx.font = '700 64px Rajdhani, system-ui, sans-serif';
    ctx.fillText(text.title, 48, y, W - 96);
    y += 64;
    if (text.body) {
      ctx.fillStyle = '#c9d2dc';
      ctx.font = '500 36px Inter, system-ui, sans-serif';
      for (const line of wrap(ctx, text.body, W - 96).slice(0, 4)) {
        ctx.fillText(line, 48, y);
        y += 46;
      }
    }
    if (text.toast) {
      ctx.fillStyle = '#ffcf8a';
      ctx.font = '600 38px Inter, system-ui, sans-serif';
      ctx.fillText(text.toast, 48, H - (text.prompt ? 110 : 48), W - 96);
    }
    if (text.prompt) {
      ctx.fillStyle = '#4fe3a1';
      ctx.font = '700 44px Rajdhani, system-ui, sans-serif';
      ctx.fillText(text.prompt, 48, H - 48, W - 96);
    }
    this.texture.needsUpdate = true;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
