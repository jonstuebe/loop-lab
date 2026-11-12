import './styles.css';
import { Game } from './game';
import { FIRST_TEXTURE_STAGE, TEXTURE_STAGES, textureSteps } from './render/textures';
import { Preloader } from './ui/preloader';

const canvas = document.getElementById('c');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing game canvas #c');

const preloader = new Preloader(TEXTURE_STAGES + 2);

async function boot(canvas: HTMLCanvasElement): Promise<void> {
  // Dev-only Quest emulator; the condition is false in production builds, so IWER isn't bundled.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('xr')) {
    const { installQuestEmulator } = await import('./xr/emulate');
    await installQuestEmulator();
  }
  // Every texture is drawn in code, which blocks; the loader repaints between surfaces.
  const steps = textureSteps();
  await preloader.begin(FIRST_TEXTURE_STAGE);
  let step = steps.next();
  while (!step.done) {
    await preloader.begin(step.value);
    step = steps.next();
  }

  await preloader.begin('Assembling the test chamber');
  const game = new Game(canvas, step.value);
  // Dev-only handle for poking at the game from the console (and for screenshots).
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;

  await preloader.begin('Powering up');
  game.start();
  // Compiles the shaders up front so the first frame of play doesn't hitch.
  await game.warmup();
  await preloader.finish();
}

boot(canvas).catch((error: unknown) => {
  preloader.fail();
  throw error;
});
