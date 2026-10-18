import './style.css';
import { CabinetView } from './engine/cabinet-view';
import { ScoreBoard } from './engine/highscores';
import { Input } from './engine/input';
import { startLoop } from './engine/loop';
import { Music } from './engine/music';
import { createScreen, drawPowerOff, drawPowerOn } from './engine/screen';
import { Sound } from './engine/sound';
import { SCREEN_H, SCREEN_W, type ArcadeGame, type CabinetInfo, type Rect } from './engine/types';
import { CABINETS } from './games/registry';
import { Hall } from './hall/hall';
import { RECORDS } from './hall/records';
import { registerServiceWorker } from './engine/pwa';
import { loadAnalyticsIfGranted } from './engine/consent';

const POWER_ON_TIME = 0.35;
const POWER_OFF_TIME = 0.3;
const ZOOM_IN_TIME = 0.8;
const ZOOM_OUT_TIME = 0.65;

/** hall → enter (Zoom an den Automaten) → game → off (Röhre aus) → leave (Zoom zurück) → hall */
type Scene = 'hall' | 'enter' | 'game' | 'off' | 'leave';

const app = document.getElementById('app')!;
const screen = createScreen(app);
const { canvas, g } = screen;
const input = new Input(canvas);
const view = new CabinetView(app, screen, input);
const sound = new Sound();
input.onGesture = () => sound.unlock();
// Der Plattenspieler läuft über Szenenwechsel hinweg weiter, im Spiel nur gedämpft
const music = new Music(sound, RECORDS);

let scene: Scene = 'hall';
let game: ArcadeGame | null = null;
let current: CabinetInfo | null = null;
/** Bildschirmchen des Automaten in der Halle, an dem der Zoom ansetzt. */
let from: Rect | null = null;
/** Zeit seit dem letzten Szenenwechsel. */
let sceneT = 0;

// Durch die Tür der Halle geht es zurück zur Startseite
const hall = new Hall(CABINETS, { g, input, sound, music }, approach, { onLeave: () => location.assign('/') });

// Startlink von den Spielseiten: /play/?game=<id> startet das Spiel sofort (ohne Zoom),
// Esc führt dann zurück in die Halle, direkt vor diesen Automaten.
const startWith = CABINETS.find((c) => c.create && c.id === new URLSearchParams(location.search).get('game'));
if (startWith) {
  hall.standAt(startWith.id);
  current = startWith;
  view.show(startWith, hall.neighborsOf(startWith.id));
  view.setZoom(1);
  launch(startWith);
  history.replaceState(null, '', location.pathname);
}

/** In der Halle Enter gedrückt: an den Automaten herantreten. */
function approach(info: CabinetInfo) {
  sound.stopLoops();
  canvas.style.cursor = 'default';
  current = info;
  from = hall.screenOf(info.id);
  view.show(info, hall.neighborsOf(info.id));
  music.setMuffled(true);
  footsteps();
  setScene('enter');
}

function launch(info: CabinetInfo) {
  const next = info.create!();
  next.init({
    g,
    width: SCREEN_W,
    height: SCREEN_H,
    input,
    audio: sound,
    scores: new ScoreBoard(info.id),
    exit: () => setScene('off'),
  });
  game = next;
  music.setMuffled(true);
  sound.tone({ freq: 70, dur: 0.12, type: 'sine', vol: 0.14 });
  setScene('game');
}

function setScene(next: Scene) {
  scene = next;
  sceneT = 0;
  if (next === 'off') sound.tone({ freq: 420, to: 60, dur: POWER_OFF_TIME, type: 'triangle', vol: 0.07 });
}

/** Zwei leise Schritte – wie beim Laufen durch die Halle. */
function footsteps() {
  for (const delay of [0, 0.28]) sound.tone({ freq: 110, dur: 0.03, type: 'triangle', vol: 0.06, jitter: 0.1, delay });
}

startLoop(
  (dt) => {
    sceneT += dt;
    input.pollPads();
    switch (scene) {
      case 'hall':
        hall.update(dt);
        break;
      case 'enter':
        view.setZoom(sceneT / ZOOM_IN_TIME, from);
        if (sceneT >= ZOOM_IN_TIME) launch(current!);
        break;
      case 'game':
        game!.update(dt);
        break;
      case 'off':
        if (sceneT >= POWER_OFF_TIME) {
          game!.destroy();
          game = null;
          sound.stopLoops();
          hall.resume();
          music.setMuffled(false);
          from = hall.screenOf(current!.id);
          footsteps();
          setScene('leave');
        }
        break;
      case 'leave':
        view.setZoom(1 - sceneT / ZOOM_OUT_TIME, from);
        if (sceneT >= ZOOM_OUT_TIME) setScene('hall');
        break;
    }
    music.update();
    input.endTick();
  },
  () => {
    if (game) {
      game.render();
      if (scene === 'off') drawPowerOff(g, Math.min(1, sceneT / POWER_OFF_TIME));
      else if (sceneT < POWER_ON_TIME) drawPowerOn(g, sceneT / POWER_ON_TIME);
    } else {
      hall.render(scene === 'hall');
    }
    screen.present();
    view.render();
  },
);

registerServiceWorker();
loadAnalyticsIfGranted();
