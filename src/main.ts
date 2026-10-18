import './style.css';
import { ScoreBoard } from './engine/highscores';
import { Input } from './engine/input';
import { startLoop } from './engine/loop';
import { Music } from './engine/music';
import { createScreen, drawPowerOn } from './engine/screen';
import { Sound } from './engine/sound';
import { SCREEN_H, SCREEN_W, type ArcadeGame, type CabinetInfo } from './engine/types';
import { CABINETS } from './games/registry';
import { Hall } from './hall/hall';
import { RECORDS } from './hall/records';
import { registerServiceWorker } from './engine/pwa';

const POWER_ON_TIME = 0.35;

const screen = createScreen(document.getElementById('app')!);
const { canvas, g } = screen;
const input = new Input(canvas);
const sound = new Sound();
input.onGesture = () => sound.unlock();
// Der Plattenspieler läuft über Szenenwechsel hinweg weiter, im Spiel nur gedämpft
const music = new Music(sound, RECORDS);

let game: ArcadeGame | null = null;
/** Zeit seit dem letzten Szenenwechsel (für den CRT-Einschalteffekt). */
let sceneT = POWER_ON_TIME;

// Durch die Tür der Halle geht es zurück zur Startseite
const hall = new Hall(CABINETS, { g, input, sound, music }, launch, { onLeave: () => location.assign('/') });

function launch(info: CabinetInfo) {
  sound.stopLoops();
  canvas.style.cursor = 'default';
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
  music.setMuffled(true);
  sceneT = 0;
}

function backToHall() {
  game?.destroy();
  game = null;
  sound.stopLoops();
  hall.resume();
  music.setMuffled(false);
  sceneT = 0;
}

startLoop(
  (dt) => {
    sceneT += dt;
    input.pollPads();
    if (game) game.update(dt);
    else hall.update(dt);
    music.update();
    input.endTick();
  },
  () => {
    (game ?? hall).render();
    if (sceneT < POWER_ON_TIME) drawPowerOn(g, sceneT / POWER_ON_TIME);
    screen.present();
  },
);

registerServiceWorker();
