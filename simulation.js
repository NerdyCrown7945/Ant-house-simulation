const canvas = document.getElementById("simCanvas");
const ctx = canvas.getContext("2d");

const WORLD_W = 300;
const WORLD_H = 110;
const VIEW_W = 160;
const VIEW_H = WORLD_H;

const CELL_W = canvas.width / VIEW_W;
const CELL_H = canvas.height / VIEW_H;

const SURFACE_ROW = 12;
const ENTRANCE_X = Math.floor(WORLD_W / 2);

const CAST = {
  worker: { label: "일개미", color: "#ef4444", size: 0.8, dig: 1, carry: 1, guard: 0.1, brood: 0 },
  soldier: { label: "병정개미", color: "#f59e0b", size: 1.05, dig: 0.45, carry: 0.5, guard: 1.1, brood: 0.05 },
  male: { label: "수개미", color: "#22d3ee", size: 0.75, dig: 0.1, carry: 0.2, guard: 0.15, brood: 0.05 },
  queen: { label: "여왕개미", color: "#a855f7", size: 1.35, dig: 0.02, carry: 0.05, guard: 0.3, brood: 1.3 },
};

const CELL = {
  AIR: 0,
  SOIL: 1,
  TUNNEL: 2,
};

const workerCountInput = document.getElementById("workerCount");
const workerCountLabel = document.getElementById("workerCountLabel");
const digBiasInput = document.getElementById("digBias");
const chamberBiasInput = document.getElementById("chamberBias");
const digBiasLabel = document.getElementById("digBiasLabel");
const chamberBiasLabel = document.getElementById("chamberBiasLabel");
const cameraSlider = document.getElementById("cameraSlider");
const cameraLabel = document.getElementById("cameraLabel");
const castSelect = document.getElementById("castSelect");
const spawnCountInput = document.getElementById("spawnCount");
const addAntBtn = document.getElementById("addAntBtn");
const statsList = document.getElementById("stats");
const resetBtn = document.getElementById("resetBtn");
const pauseBtn = document.getElementById("pauseBtn");

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rand = (min, max) => min + Math.random() * (max - min);
const chance = (p) => Math.random() < p;

let world = [];
let hardness = [];
let pheromone = [];
let ants = [];
let eggs = [];
let paused = false;
let tick = 0;
let nextAntId = 1;
let cameraX = 0;

function makeGrid(fill) {
  return Array.from({ length: WORLD_H }, () => Array.from({ length: WORLD_W }, () => fill));
}

function createAnt(type, x = ENTRANCE_X, y = SURFACE_ROW + 2) {
  return {
    id: nextAntId++,
    type,
    x,
    y,
    carrying: false,
    cooldown: 0,
    rest: 0,
  };
}

function initWorld() {
  world = makeGrid(CELL.AIR);
  hardness = makeGrid(0);
  pheromone = makeGrid(0);
  eggs = [];

  for (let y = SURFACE_ROW + 1; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      world[y][x] = CELL.SOIL;
      const depth = (y - SURFACE_ROW) / (WORLD_H - SURFACE_ROW);
      hardness[y][x] = clamp(0.15 + depth * 0.82 + rand(-0.1, 0.14), 0.05, 1.32);
    }
  }

  world[SURFACE_ROW][ENTRANCE_X] = CELL.TUNNEL;
  for (let y = SURFACE_ROW + 1; y < SURFACE_ROW + 8; y += 1) {
    world[y][ENTRANCE_X] = CELL.TUNNEL;
    pheromone[y][ENTRANCE_X] = 0.95;
  }

  for (let r = SURFACE_ROW + 8; r < SURFACE_ROW + 13; r += 1) {
    world[r][ENTRANCE_X - 1] = CELL.TUNNEL;
    world[r][ENTRANCE_X + 1] = CELL.TUNNEL;
  }
}

function spawnInitialAnts(workerCount) {
  ants = [];
  nextAntId = 1;

  ants.push(createAnt("queen", ENTRANCE_X, SURFACE_ROW + 11));
  ants.push(createAnt("male", ENTRANCE_X + 2, SURFACE_ROW + 9));
  ants.push(createAnt("soldier", ENTRANCE_X - 2, SURFACE_ROW + 8));

  for (let i = 0; i < workerCount; i += 1) {
    ants.push(createAnt("worker", ENTRANCE_X + (i % 5) - 2, SURFACE_ROW + 3 + (i % 4)));
  }
}

function neighbors(x, y) {
  return [
    [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
    [x + 1, y + 1], [x - 1, y + 1], [x + 1, y - 1], [x - 1, y - 1],
  ].filter(([nx, ny]) => nx >= 0 && nx < WORLD_W && ny > SURFACE_ROW && ny < WORLD_H);
}

function tunnelDensity(x, y) {
  const cells = neighbors(x, y);
  const tunnelCount = cells.reduce((acc, [nx, ny]) => acc + (world[ny][nx] === CELL.TUNNEL ? 1 : 0), 0);
  return cells.length ? tunnelCount / cells.length : 0;
}

function digAt(x, y, ant, digBias, chamberBias) {
  if (world[y][x] !== CELL.SOIL) return false;

  const role = CAST[ant.type];
  const depthFactor = clamp((y - SURFACE_ROW) / (WORLD_H - SURFACE_ROW), 0, 1);
  const tunnelNear = tunnelDensity(x, y);
  const chamberPush = chance(chamberBias) ? 0.22 : 0;
  const raw =
    digBias * role.dig +
    depthFactor * 0.35 +
    tunnelNear * 0.62 +
    chamberPush -
    hardness[y][x] * 0.75;

  const p = clamp(raw, 0.02, 0.92);
  if (!chance(p)) return false;

  world[y][x] = CELL.TUNNEL;
  pheromone[y][x] = clamp(pheromone[y][x] + 0.56, 0, 1);

  if (chance((chamberBias * 0.7 + 0.05) * role.dig)) {
    neighbors(x, y)
      .filter(([nx, ny]) => world[ny][nx] === CELL.SOIL && chance(0.35))
      .forEach(([nx, ny]) => {
        world[ny][nx] = CELL.TUNNEL;
        pheromone[ny][nx] = clamp(pheromone[ny][nx] + 0.28, 0, 1);
      });
  }

  ant.carrying = chance(0.8 * role.carry + 0.1);
  ant.cooldown = 1;
  return true;
}

function chooseMove(ant) {
  const role = CAST[ant.type];

  return neighbors(ant.x, ant.y)
    .map(([nx, ny]) => {
      let score = 0;
      const cell = world[ny][nx];

      if (cell === CELL.TUNNEL) {
        score += 1 + pheromone[ny][nx] * 1.6;
      }
      if (cell === CELL.SOIL) {
        score += role.dig * 0.4;
      }

      if (ant.type === "worker") {
        score += ant.carrying ? (ny < ant.y ? 1.6 : 0.2) : ny > ant.y ? 0.8 : 0.15;
      } else if (ant.type === "soldier") {
        score += Math.abs(nx - ENTRANCE_X) < 12 ? role.guard : 0.2;
        score += ny < SURFACE_ROW + 22 ? 0.5 : 0.2;
      } else if (ant.type === "male") {
        score += ny < SURFACE_ROW + 16 ? 1.1 : 0.05;
        score += chance(0.15) ? 0.6 : 0;
      } else if (ant.type === "queen") {
        score += ny > SURFACE_ROW + 18 ? role.brood : 0;
        score += ny < ant.y ? -0.5 : 0;
      }

      return { nx, ny, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function moveAnt(ant, digBias, chamberBias) {
  if (ant.cooldown > 0) {
    ant.cooldown -= 1;
    return;
  }
  if (ant.rest > 0) {
    ant.rest -= 1;
    return;
  }

  const candidates = chooseMove(ant);
  if (!candidates.length) return;

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const targetCell = world[pick.ny][pick.nx];

  if (targetCell === CELL.SOIL && ant.type !== "queen" && ant.type !== "male") {
    const success = digAt(pick.nx, pick.ny, ant, digBias, chamberBias);
    if (success) {
      ant.x = pick.nx;
      ant.y = pick.ny;
    }
  } else if (targetCell === CELL.TUNNEL) {
    ant.x = pick.nx;
    ant.y = pick.ny;
  }

  if (ant.carrying && ant.y <= SURFACE_ROW + 2) {
    ant.carrying = false;
  }

  pheromone[ant.y][ant.x] = clamp(pheromone[ant.y][ant.x] + 0.07, 0, 1);

  if (ant.type === "queen" && chance(0.02) && ant.y > SURFACE_ROW + 14) {
    eggs.push({ x: ant.x, y: ant.y, age: 0 });
    ant.rest = 2;
  }
}

function updateEggs() {
  const newborn = [];
  eggs.forEach((egg) => {
    egg.age += 1;
    if (egg.age > 700) {
      const type = chance(0.75) ? "worker" : chance(0.7) ? "soldier" : "male";
      newborn.push(createAnt(type, egg.x, egg.y));
      egg.done = true;
    }
  });
  eggs = eggs.filter((egg) => !egg.done);
  ants.push(...newborn);
}

function evaporatePheromone() {
  for (let y = SURFACE_ROW + 1; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      pheromone[y][x] *= 0.994;
      if (world[y][x] === CELL.TUNNEL) pheromone[y][x] = clamp(pheromone[y][x] + 0.001, 0, 1);
    }
  }
}

function countChambers() {
  let count = 0;
  for (let y = SURFACE_ROW + 2; y < WORLD_H - 1; y += 1) {
    for (let x = 1; x < WORLD_W - 1; x += 1) {
      if (world[y][x] !== CELL.TUNNEL) continue;
      if (tunnelDensity(x, y) > 0.7) count += 1;
    }
  }
  return Math.round(count / 10);
}

function typeCounts() {
  return ants.reduce((acc, ant) => {
    acc[ant.type] = (acc[ant.type] || 0) + 1;
    return acc;
  }, {});
}

function updateStats() {
  let tunnelCells = 0;
  let maxDepth = 0;

  for (let y = SURFACE_ROW + 1; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      if (world[y][x] === CELL.TUNNEL) {
        tunnelCells += 1;
        maxDepth = Math.max(maxDepth, y - SURFACE_ROW);
      }
    }
  }

  const tc = typeCounts();
  statsList.innerHTML = `
    <li>틱: <strong>${tick}</strong></li>
    <li>굴착된 셀: <strong>${tunnelCells}</strong></li>
    <li>최대 깊이: <strong>${maxDepth} 칸</strong></li>
    <li>챔버(넓은 방) 수: <strong>${countChambers()}</strong></li>
    <li>알(부화 대기): <strong>${eggs.length}</strong></li>
    <li>일개미/병정/수개미/여왕: <strong>${tc.worker || 0}/${tc.soldier || 0}/${tc.male || 0}/${tc.queen || 0}</strong></li>
  `;
}

function drawAnt(ant, viewX) {
  const role = CAST[ant.type];
  const rx = ant.x - viewX;
  if (rx < 0 || rx >= VIEW_W) return;

  const px = (rx + 0.5) * CELL_W;
  const py = (ant.y + 0.5) * CELL_H;
  const r = Math.max(1.5, CELL_W * 0.38 * role.size);

  ctx.fillStyle = role.color;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.arc(px + r * 0.3, py - r * 0.25, Math.max(0.7, r * 0.22), 0, Math.PI * 2);
  ctx.fill();

  if (ant.type === "queen") {
    ctx.strokeStyle = "#e9d5ff";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(px, py, r + 1.2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function draw() {
  const viewX = cameraX;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#87ceeb";
  ctx.fillRect(0, 0, canvas.width, CELL_H * (SURFACE_ROW + 1));

  for (let y = SURFACE_ROW + 1; y < WORLD_H; y += 1) {
    for (let sx = 0; sx < VIEW_W; sx += 1) {
      const wx = sx + viewX;
      const px = sx * CELL_W;
      const py = y * CELL_H;

      if (world[y][wx] === CELL.SOIL) {
        const hard = hardness[y][wx];
        const base = 28 + hard * 62;
        ctx.fillStyle = `rgb(${82 + base}, ${58 + base * 0.46}, ${34})`;
        ctx.fillRect(px, py, CELL_W + 0.6, CELL_H + 0.6);
      } else if (world[y][wx] === CELL.TUNNEL) {
        const p = pheromone[y][wx];
        ctx.fillStyle = `rgba(15, 23, 42, ${clamp(0.25 + p * 0.45, 0.25, 0.72)})`;
        ctx.fillRect(px, py, CELL_W + 0.6, CELL_H + 0.6);
      }
    }
  }

  eggs.forEach((egg) => {
    const rx = egg.x - viewX;
    if (rx < 0 || rx >= VIEW_W) return;
    ctx.fillStyle = "#fef08a";
    ctx.beginPath();
    ctx.ellipse((rx + 0.5) * CELL_W, (egg.y + 0.5) * CELL_H, CELL_W * 0.23, CELL_H * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  ants.forEach((ant) => drawAnt(ant, viewX));

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, CELL_H * (SURFACE_ROW + 1));
  ctx.lineTo(canvas.width, CELL_H * (SURFACE_ROW + 1));
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.font = "13px sans-serif";
  ctx.fillText(`단면 가로 범위: ${viewX} ~ ${viewX + VIEW_W - 1}`, 10, 20);
}

function step() {
  tick += 1;
  const digBias = Number(digBiasInput.value);
  const chamberBias = Number(chamberBiasInput.value);

  ants.forEach((ant) => moveAnt(ant, digBias, chamberBias));
  updateEggs();
  evaporatePheromone();
  updateStats();
}

function loop() {
  if (!paused) step();
  draw();
  requestAnimationFrame(loop);
}

function addAnts(type, count) {
  for (let i = 0; i < count; i += 1) {
    ants.push(createAnt(type, ENTRANCE_X + Math.floor(rand(-3, 4)), SURFACE_ROW + 3 + Math.floor(rand(0, 7))));
  }
}

function reset() {
  tick = 0;
  initWorld();
  spawnInitialAnts(Number(workerCountInput.value));
  updateStats();
}

function bindUI() {
  const sync = () => {
    workerCountLabel.textContent = workerCountInput.value;
    digBiasLabel.textContent = Number(digBiasInput.value).toFixed(2);
    chamberBiasLabel.textContent = Number(chamberBiasInput.value).toFixed(2);
    cameraLabel.textContent = cameraSlider.value;
  };

  workerCountInput.addEventListener("input", sync);
  digBiasInput.addEventListener("input", sync);
  chamberBiasInput.addEventListener("input", sync);
  cameraSlider.max = String(WORLD_W - VIEW_W);
  cameraSlider.addEventListener("input", () => {
    cameraX = Number(cameraSlider.value);
    sync();
  });

  addAntBtn.addEventListener("click", () => {
    const type = castSelect.value;
    const count = clamp(Number(spawnCountInput.value) || 1, 1, 20);
    addAnts(type, count);
    updateStats();
  });

  resetBtn.addEventListener("click", reset);

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "재개" : "일시정지";
  });

  sync();
}

function start() {
  bindUI();
  cameraX = Number(cameraSlider.value);
  reset();
  loop();
}

start();
