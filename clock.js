const { QrCode, QrSegment } = qrcodegen;
const clock = document.querySelector("#time");
const root = document.documentElement;
const canvas = document.querySelector("#matrix");
const context = canvas.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const VERSION = 2;
const MODULES = VERSION * 4 + 17;
const QUIET = 4;
const CELL = 24;
const DURATION = 480;

const SIDE = (MODULES + QUIET * 2) * CELL;
const CENTER = SIDE / 2;
canvas.width = canvas.height = SIDE;

const cells = Array.from({ length: MODULES ** 2 }, (_, index) => {
  const column = index % MODULES;
  const row = Math.floor(index / MODULES);
  const finder = (row < 8 && (column < 8 || column >= MODULES - 8))
    || (column < 8 && row >= MODULES - 8);
  const alignment = column >= 16 && column <= 20 && row >= 16 && row <= 20;

  return {
    column,
    row,
    x: (column + QUIET + 0.5) * CELL,
    y: (row + QUIET + 0.5) * CELL,
    fixed: finder || alignment || row === 6 || column === 6,
  };
});

const signedRandom = () => Math.random() * 2 - 1;

const effects = [
  (x, y) => [x * 1.46 + signedRandom() * 0.32, y * 1.46 + signedRandom() * 0.32], // Burst
  (x, y, direction) => { // Vortex
    const angle = direction * (1.1 + Math.hypot(x, y) * 1.9);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [(x * cosine - y * sine) * 1.28, (x * sine + y * cosine) * 1.28];
  },
  (x, y) => { // Crossing streams
    const edge = Math.sign(signedRandom()) * (0.78 + Math.random() * 0.2);
    return Math.random() < 0.5
      ? [edge, y * 0.65 + signedRandom() * 0.55]
      : [x * 0.65 + signedRandom() * 0.55, edge];
  },
  (x, y, direction) => [x + direction * Math.sin(y * 5) * 0.72, y * 1.33 + Math.sin(x * 4) * 0.26], // Wave
  () => [signedRandom(), signedRandom()], // Scatter
];

let matrix;
let previousSecond;
let timer;
let frame;
let ink;
let gradient;
let flash;
let effectIndex = -1;

function setTheme(hour) {
  let theme = "night";
  if (hour >= 5 && hour < 9) theme = "dawn";
  if (hour >= 9 && hour < 17) theme = "day";
  if (hour >= 17 && hour < 19) theme = "dusk";
  if (root.dataset.theme === theme) return;

  root.dataset.theme = theme;
  const style = getComputedStyle(root);
  ink = style.getPropertyValue("--ink").trim();
  flash = style.getPropertyValue("--flash").trim();
  gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, ink);
  gradient.addColorStop(1, style.getPropertyValue("--ink-end").trim());
}

function draw() {
  context.clearRect(0, 0, SIDE, SIDE);

  for (const { column, row, x, y, fixed } of cells) {
    if (!matrix.getModule(column, row)) continue;
    context.fillStyle = fixed ? ink : gradient;
    context.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
  }
}

function drawFlights(flights, progress) {
  context.clearRect(0, 0, SIDE, SIDE);

  for (const { from, to, bendX, bendY, enters, leaves, delay, duration, tint } of flights) {
    const phase = Math.max(0, Math.min(1, (progress - delay) / duration));
    const t = phase * phase * (3 - 2 * phase);
    const bend = 4 * t * (1 - t);
    const opacity = (enters ? t : 1) * (leaves ? 1 - t : 1);
    if (opacity === 0) continue;

    const x = from.x + (to.x - from.x) * t + bendX * bend;
    const y = from.y + (to.y - from.y) * t + bendY * bend;
    const size = CELL * (1 - 0.59 * bend) * (0.72 + 0.28 * opacity);
    const left = x - size / 2;
    const top = y - size / 2;

    context.beginPath();
    if (context.roundRect) {
      context.roundRect(left, top, size, size, size * bend / 2);
    } else {
      context.rect(left, top, size, size);
    }
    context.globalAlpha = opacity;
    context.fillStyle = (t < 0.5 ? from : to).fixed ? ink : gradient;
    context.fill();
    if (bend > 0) {
      context.globalAlpha = opacity * bend * tint;
      context.fillStyle = flash;
      context.fill();
    }
  }

  context.globalAlpha = 1;
}

function animate(previous, age) {
  effectIndex = effectIndex < 0
    ? Math.floor(Math.random() * effects.length)
    : (effectIndex + 1 + Math.floor(Math.random() * (effects.length - 1))) % effects.length;
  const waypoint = effects[effectIndex];
  const direction = Math.random() < 0.5 ? -1 : 1;
  const origin = cells.filter(({ column, row }) => previous.getModule(column, row));
  const destination = cells.filter(({ column, row }) => matrix.getModule(column, row));
  const count = Math.max(origin.length, destination.length);

  // Pair by scan order and spread surplus particles across the whole code.
  const flights = Array.from({ length: count }, (_, index) => {
    const originIndex = Math.floor(index * origin.length / count);
    const destinationIndex = Math.floor(index * destination.length / count);
    const from = origin[originIndex];
    const to = destination[destinationIndex];
    const [x, y] = waypoint((from.x - CENTER) / CENTER, (from.y - CENTER) / CENTER, direction);
    const limit = 0.90 + Math.random() * 0.06;
    const midX = CENTER * (1 + Math.max(-limit, Math.min(limit, x)));
    const midY = CENTER * (1 + Math.max(-limit, Math.min(limit, y)));
    const delay = Math.random() * 0.1;

    return {
      from,
      to,
      bendX: midX - (from.x + to.x) / 2,
      bendY: midY - (from.y + to.y) / 2,
      enters: originIndex === Math.floor((index - 1) * origin.length / count),
      leaves: destinationIndex === Math.floor((index - 1) * destination.length / count),
      delay,
      duration: 1 - delay - Math.random() * 0.1,
      tint: 0.2 + Math.random() * 0.8,
    };
  });
  const start = performance.now() - age;

  function step(timestamp) {
    const progress = (timestamp - start) / DURATION;
    if (progress < 1) {
      drawFlights(flights, progress);
      frame = requestAnimationFrame(step);
    } else {
      draw();
    }
  }

  step(performance.now());
}

function tick(allowMotion = true) {
  clearTimeout(timer);
  cancelAnimationFrame(frame);
  if (document.hidden) return;

  const now = new Date();
  const second = Math.floor(now.getTime() / 1000);
  const hour = now.getHours();
  const payload = [hour, now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  const previous = matrix;

  if (payload !== clock.dateTime) {
    matrix = QrCode.encodeSegments([QrSegment.makeAlphanumeric(payload)], QrCode.Ecc.HIGH, VERSION, VERSION);
    clock.dateTime = payload;
    clock.textContent = payload;
    setTheme(hour);
  }

  const age = Date.now() - second * 1000;
  if (allowMotion && !reducedMotion.matches && previous && matrix !== previous
      && second === previousSecond + 1 && age < DURATION) {
    animate(previous, age);
  } else {
    draw();
  }

  previousSecond = second;
  const next = (second + 1) * 1000 - Date.now();
  timer = setTimeout(tick, Math.max(0, Math.min(1000, next)));
}

document.addEventListener("visibilitychange", () => tick(false));
window.addEventListener("pageshow", () => tick(false));
reducedMotion.addEventListener("change", () => tick(false));
tick(false);
