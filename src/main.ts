import './styles.css';
import { Preloader } from './ui/preloader';

async function boot(): Promise<void> {
  const loader = new Preloader();
  try {
    const canvas = document.getElementById('c');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing game canvas #c');

    await loader.step('Loading the lab…', 0.15);
    // The engine is split into its own chunk so the loading screen can report progress while it downloads.
    const { Game } = await import('./game');
    await document.fonts?.ready;

    await loader.step('Painting the test panels…', 0.45);
    const game = new Game(canvas);

    await loader.step('Building today’s chamber…', 0.7);
    game.start();

    await loader.step('Warming up the portal device…', 0.9);
    await game.warmup();

    loader.finish();

    // Dev-only handle for poking at the game from the console (and for screenshots).
    if (import.meta.env.DEV) (window as unknown as { __game: unknown }).__game = game;
  } catch (err) {
    console.error(err);
    loader.fail('Loop Lab couldn’t start. Your browser may have WebGL turned off; try another browser or device.');
  }
}

void boot();
