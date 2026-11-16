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
const DURATION = 360;
const SIDE = (MODULES + QUIET * 2) * CELL;
const CENTER = SIDE / 2;
const NEAR_EDGE = (QUIET + 0.5) * CELL;
const FAR_EDGE = SIDE - NEAR_EDGE;
const LAST = MODULES - 1;
canvas.width = canvas.height = SIDE;

const cells = Array.from({ length: MODULES ** 2 }, (_, index) => {
  const column = index % MODULES;
  const row = Math.floor(index / MODULES);
  const finder = (row < 7 && (column < 7 || column >= MODULES - 7))
    || (column < 7 && row >= MODULES - 7);
  const alignment = column >= 16 && column <= 20 && row >= 16 && row <= 20;
  const timing = row === 6 || column === 6;
  const format = (row === 8 && ((column <= 8 && column !== 6) || column >= MODULES - 8))
    || (column === 8 && ((row < 8 && row !== 6) || row >= MODULES - 7));

  return {
    index,
    column,
    row,
    x: (column + QUIET + 0.5) * CELL,
    y: (row + QUIET + 0.5) * CELL,
    finder,
    format,
    square: alignment,
    fixed: alignment || timing,
    radius: CELL * (timing ? 0.49 : 0.46),
  };
});

const finderCenters = [3 * MODULES + 3, 3 * MODULES + LAST - 3, (LAST - 3) * MODULES + 3];
const layouts = [
  cells,
  cells.map(({ column, row }) => cells[column * MODULES + LAST - row]),
  cells.slice().reverse(),
  cells.map(({ column, row }) => cells[(LAST - column) * MODULES + row]),
].map((layout) => ({
  tiles: cells.map(({ index, radius, fixed, square }) => ({
    index: layout[index].index,
    x: layout[index].x,
    y: layout[index].y,
    radius,
    fixed,
    square,
  })),
  finders: finderCenters.map((index) => layout[index]),
  format: cells.filter(({ format }) => format).map(({ index }) => layout[index]),
}));

const effects = [
  { order: (x, y) => (x + y + 2) / 4, curve: 0.08 }, // Diagonal
  { order: (x, y) => Math.hypot(x, y) * Math.SQRT1_2, curve: 0.35 }, // Ripple
  { order: (x, y) => (Math.atan2(y, x) / (2 * Math.PI) + Math.hypot(x, y) * 0.55 + 1) % 1, curve: 0.55 }, // Spiral
  { order: (x, y) => Math.abs(x - y) / 2, curve: 0.24 }, // Folding
  { order: () => Math.random(), curve: 0.18 }, // Staggered
];

let timer;
let frame;
let prepared;
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

function timeAt(timestamp) {
  const date = new Date(timestamp);
  const hour = date.getHours();
  const minute = date.getMinutes();
  const payload = [hour, minute, date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return { timestamp, hour, payload, quarter: Math.floor(minute / 15) };
}

function encode(time) {
  const qr = QrCode.encodeSegments([QrSegment.makeAlphanumeric(time.payload)], QrCode.Ecc.HIGH, VERSION, VERSION);
  const { tiles, finders, format } = layouts[time.quarter];
  const points = Array(cells.length).fill(null);
  for (const { index, column, row, finder } of cells) {
    if (!finder && qr.getModule(column, row)) {
      const tile = tiles[index];
      points[tile.index] = tile;
    }
  }
  return { ...time, points, finders, format };
}

function drawCells(points, opacity = 1) {
  context.globalAlpha = opacity;
  for (const point of points) {
    if (!point) continue;

    const { x, y, radius, square, fixed } = point;
    context.fillStyle = fixed ? ink : gradient;
    if (square) {
      context.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
    } else {
      context.beginPath();
      context.arc(x, y, radius, 0, 2 * Math.PI);
      context.fill();
    }
  }
}

function drawFinders(origins, destinations = origins, progress = 0) {
  context.globalAlpha = 1;
  context.fillStyle = ink;
  for (const [index, from] of origins.entries()) {
    const to = destinations[index];
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    context.clearRect(x - 4.5 * CELL, y - 4.5 * CELL, 9 * CELL, 9 * CELL);
    context.fillRect(x - 3.5 * CELL, y - 3.5 * CELL, 7 * CELL, 7 * CELL);
    context.clearRect(x - 2.5 * CELL, y - 2.5 * CELL, 5 * CELL, 5 * CELL);
    context.fillRect(x - 1.5 * CELL, y - 1.5 * CELL, 3 * CELL, 3 * CELL);
  }
}

function draw(symbol) {
  context.clearRect(0, 0, SIDE, SIDE);
  drawCells(symbol.points);
  drawFinders(symbol.finders);
}

const unit = (value) => Math.max(0, Math.min(1, value));
const ease = (t) => t * t * (3 - 2 * t);
const boundCenter = (value) => Math.max(NEAR_EDGE, Math.min(FAR_EDGE, value));

function drawMoves(moves, progress) {
  for (const { from, to, controlX, controlY, entering, leaving, delay, duration } of moves) {
    const t = ease(unit((progress - delay) / duration));
    const remaining = 1 - t;
    const middle = 2 * remaining * t;
    const opacity = entering ? t : leaving ? remaining : 1;
    if (opacity === 0) continue;

    const x = remaining ** 2 * from.x + middle * controlX + t ** 2 * to.x;
    const y = remaining ** 2 * from.y + middle * controlY + t ** 2 * to.y;
    const radius = (from.radius * remaining + to.radius * t) * (1 - 0.26 * middle - 0.12 * (1 - opacity));
    const rest = t === 0 ? from : t === 1 ? to : null;

    context.beginPath();
    if (rest?.square) {
      context.rect(x - CELL / 2, y - CELL / 2, CELL, CELL);
    } else {
      context.arc(x, y, radius, 0, 2 * Math.PI);
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

function planChanges(current, target) {
  const reserved = new Set([...current.format, ...target.format]);
  const oldFormat = [];
  const stationary = [];
  const departing = new Set();
  const arriving = new Set();
  const changes = [];
  for (const cell of cells) {
    const before = current.points[cell.index];
    const after = target.points[cell.index];

    if (reserved.has(cell)) {
      if (before) oldFormat.push(before);
    } else if (before && after) {
      if (before.radius === after.radius && before.square === after.square && before.fixed === after.fixed) {
        stationary.push(after);
      } else {
        changes.push({ from: before, to: after });
      }
    } else if (before) {
      departing.add(before);
    } else if (after) {
      arriving.add(after);
    }
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
  for (const { from, to } of candidates) {
    if (!departing.has(from) || !arriving.has(to)) continue;
    departing.delete(from);
    arriving.delete(to);
    changes.push({ from, to });
  }
  for (const from of departing) changes.push({ from });
  for (const to of arriving) changes.push({ to });
  return { stationary, changes, reserved, oldFormat };
}

function atBoundary(boundary, origin) {
  const commit = () => {
    const now = Date.now();
    if (now >= boundary || now < origin) {
      refresh();
    } else {
      timer = setTimeout(commit, boundary - now);
    }
  };
  timer = setTimeout(commit, Math.max(0, boundary - Date.now()));
}

function animate(current, boundary) {
  const now = Date.now();
  if (now >= boundary || now < current.timestamp) {
    refresh();
    return;
  }

  const target = encode(timeAt(boundary));
  prepared = target;
  effectIndex = effectIndex < 0
    ? Math.floor(Math.random() * effects.length)
    : (effectIndex + 1 + Math.floor(Math.random() * (effects.length - 1))) % effects.length;
  const effect = effects[effectIndex];
  const direction = Math.random() < 0.5 ? -1 : 1;
  const { stationary, changes, reserved, oldFormat } = planChanges(current, target);

  const moves = changes.map(({ from, to }) => {
    const origin = from ?? to;
    const destination = to ?? from;
    const x = (origin.x - CENTER) / (CENTER - NEAR_EDGE);
    const y = (origin.y - CENTER) / (CENTER - NEAR_EDGE);
    const offset = effect.order(x * direction, y * direction) * 0.29;
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

  function step() {
    const now = Date.now();
    if (now >= boundary || now < current.timestamp) {
      refresh();
      return;
    }

    const progress = unit(1 - (boundary - now) / DURATION);
    context.clearRect(0, 0, SIDE, SIDE);
    drawMoves(moves, progress);
    drawCells(stationary);

    // Withhold both copies of the QR format bits until their second arrives.
    for (const { x, y } of reserved) {
      context.clearRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
    }
    const fade = 1 - ease(unit(progress * 5));
    if (fade > 0) drawCells(oldFormat, fade);
    drawFinders(current.finders, target.finders, ease(progress));
    frame = requestAnimationFrame(step);
  }

  atBoundary(boundary, current.timestamp);
  step();
}

function refresh() {
  clearTimeout(timer);
  cancelAnimationFrame(frame);
  if (document.hidden) {
    prepared = undefined;
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000) * 1000;
  const time = timeAt(timestamp);
  const current = prepared?.timestamp === timestamp && prepared.payload === time.payload ? prepared : encode(time);
  prepared = undefined;
  clock.dateTime = current.payload;
  clock.textContent = current.payload;
  setTheme(current.hour);
  draw(current);

  const boundary = timestamp + 1000;
  const remaining = boundary - Date.now();
  if (reducedMotion.matches || remaining < DURATION / 2) {
    atBoundary(boundary, timestamp);
  } else {
    timer = setTimeout(() => animate(current, boundary), Math.max(0, remaining - DURATION));
  }
}

document.addEventListener("visibilitychange", refresh);
window.addEventListener("pageshow", refresh);
reducedMotion.addEventListener("change", refresh);
refresh();
