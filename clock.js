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
const NEAR_EDGE = (QUIET + 0.5) * CELL;
const FAR_EDGE = SIDE - NEAR_EDGE;
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

const effects = [
  { order: (x, y) => (x + y + 2) / 4, curve: 0.08 }, // Diagonal
  { order: (x, y) => Math.hypot(x, y) * Math.SQRT1_2, curve: 0.35 }, // Ripple
  { order: (x, y) => (Math.atan2(y, x) / (2 * Math.PI) + Math.hypot(x, y) * 0.55 + 1) % 1, curve: 0.55 }, // Spiral
  { order: (x, y) => Math.abs(x - y) / 2, curve: 0.24 }, // Folding
  { order: () => Math.random(), curve: 0.18 }, // Staggered
];

let matrix;
let quarter = 0;
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

function beginFrame(turns) {
  context.clearRect(0, 0, SIDE, SIDE);
  context.save();

  const angle = turns * Math.PI / 2;
  const grid = MODULES * CELL;
  // Leave a pixel at each edge for antialiasing while the square is tilted.
  const available = Number.isInteger(turns) ? grid : grid - 2;
  const fit = available / (grid * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle))));
  context.translate(CENTER, CENTER);
  context.rotate(angle);
  context.scale(fit, fit);
  context.translate(-CENTER, -CENTER);
}

function drawCells(points) {
  context.globalAlpha = 1;
  for (const { x, y, fixed } of points) {
    context.fillStyle = fixed ? ink : gradient;
    context.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
  }
}

function draw() {
  beginFrame(quarter);
  drawCells(cells.filter(({ column, row }) => matrix.getModule(column, row)));
  context.restore();
}

const ease = (t) => t * t * (3 - 2 * t);
const boundCenter = (value) => Math.max(NEAR_EDGE, Math.min(FAR_EDGE, value));

function drawMoves(moves, progress) {
  for (const { from, to, controlX, controlY, entering, leaving, delay, duration } of moves) {
    const phase = Math.max(0, Math.min(1, (progress - delay) / duration));
    const t = ease(phase);
    const remaining = 1 - t;
    const middle = 2 * remaining * t;
    const opacity = entering ? t : leaving ? remaining : 1;
    if (opacity === 0) continue;

    const x = remaining ** 2 * from.x + middle * controlX + t ** 2 * to.x;
    const y = remaining ** 2 * from.y + middle * controlY + t ** 2 * to.y;
    const size = CELL * (1 - 0.32 * middle - 0.12 * (1 - opacity));
    const left = x - size / 2;
    const top = y - size / 2;

    context.beginPath();
    if (context.roundRect) {
      context.roundRect(left, top, size, size, size * middle * 0.76);
    } else {
      context.rect(left, top, size, size);
    }
    context.globalAlpha = opacity;
    context.fillStyle = (t < 0.5 ? from : to).fixed ? ink : gradient;
    context.fill();
    if (!entering && !leaving && middle > 0) {
      context.globalAlpha = middle * 0.68;
      context.fillStyle = flash;
      context.fill();
    }
  }
}

function planChanges(previous) {
  const stationary = [];
  const departing = new Set();
  const arriving = new Set();
  for (const cell of cells) {
    const before = previous.getModule(cell.column, cell.row);
    const after = matrix.getModule(cell.column, cell.row);

    if (before && after) stationary.push(cell);
    else if (before) departing.add(cell);
    else if (after) arriving.add(cell);
  }

  const candidates = [];
  for (const from of departing) {
    for (const to of arriving) {
      const distance = (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
      if (distance <= (5 * CELL) ** 2) candidates.push({ from, to, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);

  // Prefer short moves. Unpaired cells fade in or out at their own position.
  const changes = [];
  for (const { from, to } of candidates) {
    if (!departing.has(from) || !arriving.has(to)) continue;
    departing.delete(from);
    arriving.delete(to);
    changes.push({ from, to });
  }
  for (const from of departing) changes.push({ from });
  for (const to of arriving) changes.push({ to });
  return { stationary, changes };
}

function animate(previous, previousQuarter, age) {
  const start = performance.now() - age;
  effectIndex = effectIndex < 0
    ? Math.floor(Math.random() * effects.length)
    : (effectIndex + 1 + Math.floor(Math.random() * (effects.length - 1))) % effects.length;
  const effect = effects[effectIndex];
  const direction = Math.random() < 0.5 ? -1 : 1;
  const turning = quarter === (previousQuarter + 1) % 4;
  const { stationary, changes } = planChanges(previous);

  const moves = changes.map(({ from, to }) => {
    const origin = from ?? to;
    const destination = to ?? from;
    const x = (origin.x - CENTER) / (CENTER - NEAR_EDGE);
    const y = (origin.y - CENTER) / (CENTER - NEAR_EDGE);
    const order = effect.order(x * direction, y * direction);
    const offset = order * 0.29;
    const dx = destination.x - origin.x;
    const dy = destination.y - origin.y;
    const bend = direction * effect.curve * CELL / (Math.hypot(dx, dy) || CELL);

    return {
      from: origin,
      to: destination,
      controlX: boundCenter((origin.x + destination.x) / 2 - dy * bend),
      controlY: boundCenter((origin.y + destination.y) / 2 + dx * bend),
      entering: !from,
      leaving: !to,
      delay: !from ? 0.17 + offset : !to ? offset * 0.65 : offset,
      duration: from && to ? 0.68 : 0.5,
    };
  });

  function step(timestamp) {
    const progress = (timestamp - start) / DURATION;
    if (progress >= 1) {
      draw();
      return;
    }

    beginFrame(turning ? previousQuarter + ease(progress) : quarter);
    drawMoves(moves, progress);
    drawCells(stationary);
    context.restore();
    frame = requestAnimationFrame(step);
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
  const minute = now.getMinutes();
  const payload = [hour, minute, now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  const previous = matrix;
  const previousQuarter = quarter;
  quarter = Math.floor(minute / 15);

  if (payload !== clock.dateTime) {
    matrix = QrCode.encodeSegments([QrSegment.makeAlphanumeric(payload)], QrCode.Ecc.HIGH, VERSION, VERSION);
    clock.dateTime = payload;
    clock.textContent = payload;
    setTheme(hour);
  }

  const age = Date.now() - second * 1000;
  if (allowMotion && !reducedMotion.matches && previous && matrix !== previous
      && second === previousSecond + 1 && age < DURATION) {
    animate(previous, previousQuarter, age);
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
