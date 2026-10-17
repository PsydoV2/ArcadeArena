/** Game-Loop mit festem Zeitschritt (Standard 60 Hz), Rendering einmal pro Frame. */
export function startLoop(update: (dt: number) => void, render: () => void, step = 1 / 60): void {
  let acc = 0;
  let last = performance.now();

  const frame = (now: number) => {
    // Begrenzen, damit nach einem Tab-Wechsel nicht hunderte Updates nachgeholt werden
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= step) {
      update(step);
      acc -= step;
    }
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
