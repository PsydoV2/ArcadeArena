import './style.css';
import { ScoreBoard } from './engine/highscores';
import { Input } from './engine/input';
import { startLoop } from './engine/loop';
import { createScreen } from './engine/screen';
import { Sound } from './engine/sound';
import { SCREEN_H, SCREEN_W, type ArcadeGame, type CabinetInfo } from './engine/types';
import { CABINETS } from './games/registry';
import { Hall } from './hall/hall';

const { canvas, g } = createScreen(document.getElementById('app')!);
const input = new Input(canvas);
const sound = new Sound();
input.onGesture = () => sound.unlock();

let game: ArcadeGame | null = null;

const hall = new Hall(CABINETS, { g, input, sound }, launch);

function launch(info: CabinetInfo) {
  const next = info.create!();
  next.init({
    g,
    width: SCREEN_W,
    height: SCREEN_H,
    input,
    audio: sound,
    scores: new ScoreBoard(info.id),
    exit: backToHall,
  });
  game = next;
}

function backToHall() {
  game?.destroy();
  game = null;
  hall.resume();
}

startLoop(
  (dt) => {
    if (game) game.update(dt);
    else hall.update(dt);
    input.endTick();
  },
  () => (game ?? hall).render(),
);
