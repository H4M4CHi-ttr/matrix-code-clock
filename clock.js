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

canvas.width = canvas.height = (MODULES + QUIET * 2) * CELL;

const cells = Array.from({ length: MODULES ** 2 }, (_, index) => {
  const column = index % MODULES;
  const row = Math.floor(index / MODULES);
  const finder = (row < 8 && (column < 8 || column >= MODULES - 8))
    || (column < 8 && row >= MODULES - 8);
  const alignment = column >= 16 && column <= 20 && row >= 16 && row <= 20;

  return {
    column,
    row,
    x: (column + QUIET) * CELL,
    y: (row + QUIET) * CELL,
    fixed: finder || alignment || row === 6 || column === 6,
  };
});

const effects = [
  (x, y) => (x + y + 2) / 4, // Diagonal sweep
  (x, y) => Math.hypot(x, y) * Math.SQRT1_2, // Ripple
  (x, y) => (Math.atan2(y, x) / (2 * Math.PI) + Math.hypot(x, y) * 0.6 + 1) % 1, // Spiral
  (x) => Math.round((x + 1) * 2) / 4, // Shutters
  () => Math.random(), // Scatter
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

function draw(transition, progress = 1) {
  context.clearRect(0, 0, canvas.width, canvas.height);

  for (const [index, cell] of cells.entries()) {
    const { column, row, x, y, fixed } = cell;
    const filled = matrix.getModule(column, row);
    let pulse = 0;
    let changed = false;

    if (transition && !fixed) {
      const start = transition.delays[index] * 0.58;
      const phase = (progress - start) / 0.42;
      if (phase > 0 && phase < 1) {
        pulse = Math.sin(phase * Math.PI);
        changed = transition.previous.getModule(column, row) !== filled;
      }
    }

    if (filled) {
      const inset = Math.round(CELL * pulse * (changed ? 0.15 : 0.05));
      const edge = CELL - inset * 2;
      context.fillStyle = fixed ? ink : gradient;
      context.fillRect(x + inset, y + inset, edge, edge);

      if (pulse > 0) {
        context.globalAlpha = pulse * (changed ? 1 : 0.7);
        context.fillStyle = flash;
        context.fillRect(x + inset, y + inset, edge, edge);
        context.globalAlpha = 1;
      }
    } else if (changed) {
      const edge = Math.round(CELL * 0.8 * pulse);
      const inset = Math.floor((CELL - edge) / 2);
      context.globalAlpha = pulse * 0.18;
      context.fillStyle = flash;
      context.fillRect(x + inset, y + inset, edge, edge);
      context.globalAlpha = 1;
    }
  }
}

function animate(previous, age) {
  effectIndex = (effectIndex + 1 + Math.floor(Math.random() * (effects.length - 1))) % effects.length;
  const order = effects[effectIndex];
  const angle = Math.floor(Math.random() * 4) * Math.PI / 2;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const reversed = Math.random() < 0.5;
  const center = (MODULES - 1) / 2;
  const delays = cells.map(({ column, row }) => {
    const x = (column - center) / center;
    const y = (row - center) / center;
    const delay = order(x * cosine - y * sine, x * sine + y * cosine);
    return reversed ? 1 - delay : delay;
  });

  const transition = { previous, delays };
  const start = performance.now() - age;

  function step(timestamp) {
    const progress = (timestamp - start) / DURATION;
    if (progress < 1) {
      draw(transition, progress);
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
