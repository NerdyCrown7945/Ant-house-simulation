const canvas = document.getElementById("simCanvas");
const ctx = canvas.getContext("2d");

const GRID_W = 160;
const GRID_H = 100;
const CELL_W = canvas.width / GRID_W;
const CELL_H = canvas.height / GRID_H;
const SURFACE_ROW = 12;
const ENTRANCE_X = Math.floor(GRID_W / 2);

const CELL = {
  AIR: 0,
  SOIL: 1,
  TUNNEL: 2,
};

const antCountInput = document.getElementById("antCount");
const digBiasInput = document.getElementById("digBias");
const chamberBiasInput = document.getElementById("chamberBias");
const antCountLabel = document.getElementById("antCountLabel");
const digBiasLabel = document.getElementById("digBiasLabel");
const chamberBiasLabel = document.getElementById("chamberBiasLabel");
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
let paused = false;
let tick = 0;

function makeGrid(fill) {
  return Array.from({ length: GRID_H }, () => Array.from({ length: GRID_W }, () => fill));
}

function initWorld() {
  world = makeGrid(CELL.AIR);
  hardness = makeGrid(0);
  pheromone = makeGrid(0);

  for (let y = SURFACE_ROW + 1; y < GRID_H; y += 1) {
    for (let x = 0; x < GRID_W; x += 1) {
      world[y][x] = CELL.SOIL;
      const depth = (y - SURFACE_ROW) / (GRID_H - SURFACE_ROW);
      hardness[y][x] = clamp(0.18 + depth * 0.76 + rand(-0.12, 0.15), 0.05, 1.25);
    }
  }

  world[SURFACE_ROW][ENTRANCE_X] = CELL.TUNNEL;
  for (let y = SURFACE_ROW + 1; y < SURFACE_ROW + 7; y += 1) {
    world[y][ENTRANCE_X] = CELL.TUNNEL;
    pheromone[y][ENTRANCE_X] = 0.9;
  }
}

function spawnAnts(count) {
  ants = Array.from({ length: count }, (_, i) => ({
    id: i,
    x: ENTRANCE_X,
    y: SURFACE_ROW + 2,
    carrying: false,
    cooldown: 0,
    wander: rand(0, Math.PI * 2),
  }));
}

function neighbors(x, y) {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
    [x + 1, y + 1],
    [x - 1, y + 1],
    [x + 1, y - 1],
    [x - 1, y - 1],
  ].filter(([nx, ny]) => nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H);
}

function tunnelDensity(x, y) {
  const cells = neighbors(x, y);
  const tunnelCount = cells.reduce((acc, [nx, ny]) => acc + (world[ny][nx] === CELL.TUNNEL ? 1 : 0), 0);
  return tunnelCount / cells.length;
}

function digAt(x, y, ant, digBias, chamberBias) {
  if (world[y][x] !== CELL.SOIL) {
    return false;
  }

  const depthFactor = clamp((y - SURFACE_ROW) / (GRID_H - SURFACE_ROW), 0, 1);
  const tunnelNear = tunnelDensity(x, y);
  const chamberPush = chance(chamberBias) ? 0.25 : 0;
  const raw = digBias + depthFactor * 0.35 + tunnelNear * 0.55 + chamberPush - hardness[y][x] * 0.8;
  const p = clamp(raw, 0.04, 0.95);

  if (!chance(p)) {
    return false;
  }

  world[y][x] = CELL.TUNNEL;
  pheromone[y][x] = clamp(pheromone[y][x] + 0.6, 0, 1);

  if (chance(chamberBias * 0.8 + 0.05)) {
    const ring = neighbors(x, y).filter(([nx, ny]) => world[ny][nx] === CELL.SOIL && chance(0.42));
    ring.forEach(([nx, ny]) => {
      world[ny][nx] = CELL.TUNNEL;
      pheromone[ny][nx] = clamp(pheromone[ny][nx] + 0.35, 0, 1);
    });
  }

  ant.carrying = true;
  return true;
}

function moveAnt(ant, digBias, chamberBias) {
  if (ant.cooldown > 0) {
    ant.cooldown -= 1;
    return;
  }

  const dirs = neighbors(ant.x, ant.y)
    .map(([nx, ny]) => {
      if (ny <= SURFACE_ROW) {
        return null;
      }

      let score = 0;
      if (world[ny][nx] === CELL.TUNNEL) {
        score += 1.2 + pheromone[ny][nx] * 1.4;
      }

      if (world[ny][nx] === CELL.SOIL) {
        const towardDepth = ny > ant.y ? 0.35 : 0.12;
        score += ant.carrying ? 0.08 : towardDepth;
      }

      if (ant.carrying) {
        score += ny < ant.y ? 1.4 : 0;
      } else {
        score += ny > ant.y ? 0.6 : 0.1;
      }

      return { nx, ny, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!dirs.length) {
    return;
  }

  const top = dirs.slice(0, 3);
  const pick = top[Math.floor(Math.random() * top.length)];

  if (world[pick.ny][pick.nx] === CELL.SOIL) {
    const success = digAt(pick.nx, pick.ny, ant, digBias, chamberBias);
    ant.cooldown = success ? 2 : 1;
    if (success) {
      ant.x = pick.nx;
      ant.y = pick.ny;
    }
    return;
  }

  ant.x = pick.nx;
  ant.y = pick.ny;

  if (ant.carrying && ant.y <= SURFACE_ROW + 2) {
    ant.carrying = false;
  }

  pheromone[ant.y][ant.x] = clamp(pheromone[ant.y][ant.x] + 0.08, 0, 1);
}

function evaporatePheromone() {
  for (let y = SURFACE_ROW + 1; y < GRID_H; y += 1) {
    for (let x = 0; x < GRID_W; x += 1) {
      pheromone[y][x] *= 0.994;
      if (world[y][x] === CELL.TUNNEL) {
        pheromone[y][x] = clamp(pheromone[y][x] + 0.001, 0, 1);
      }
    }
  }
}

function updateStats() {
  let tunnelCells = 0;
  let maxDepth = 0;

  for (let y = SURFACE_ROW + 1; y < GRID_H; y += 1) {
    for (let x = 0; x < GRID_W; x += 1) {
      if (world[y][x] === CELL.TUNNEL) {
        tunnelCells += 1;
        maxDepth = Math.max(maxDepth, y - SURFACE_ROW);
      }
    }
  }

  const chambers = countChambers();
  statsList.innerHTML = `
    <li>틱: <strong>${tick}</strong></li>
    <li>굴착된 셀: <strong>${tunnelCells}</strong></li>
    <li>최대 깊이: <strong>${maxDepth} 칸</strong></li>
    <li>챔버(넓은 방) 수: <strong>${chambers}</strong></li>
    <li>흙 운반 중인 개미: <strong>${ants.filter((a) => a.carrying).length}</strong></li>
  `;
}

function countChambers() {
  let count = 0;
  for (let y = SURFACE_ROW + 2; y < GRID_H - 1; y += 1) {
    for (let x = 1; x < GRID_W - 1; x += 1) {
      if (world[y][x] !== CELL.TUNNEL) {
        continue;
      }
      const density = tunnelDensity(x, y);
      if (density > 0.68) {
        count += 1;
      }
    }
  }
  return Math.round(count / 9);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#87ceeb";
  ctx.fillRect(0, 0, canvas.width, CELL_H * (SURFACE_ROW + 1));

  for (let y = SURFACE_ROW + 1; y < GRID_H; y += 1) {
    for (let x = 0; x < GRID_W; x += 1) {
      const px = x * CELL_W;
      const py = y * CELL_H;

      if (world[y][x] === CELL.SOIL) {
        const hard = hardness[y][x];
        const base = 30 + hard * 60;
        ctx.fillStyle = `rgb(${80 + base}, ${60 + base * 0.5}, ${35})`;
        ctx.fillRect(px, py, CELL_W + 0.5, CELL_H + 0.5);
      } else if (world[y][x] === CELL.TUNNEL) {
        const p = pheromone[y][x];
        const alpha = clamp(0.22 + p * 0.45, 0.22, 0.67);
        ctx.fillStyle = `rgba(18, 24, 38, ${alpha})`;
        ctx.fillRect(px, py, CELL_W + 0.5, CELL_H + 0.5);
      }
    }
  }

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, CELL_H * (SURFACE_ROW + 1));
  ctx.lineTo(canvas.width, CELL_H * (SURFACE_ROW + 1));
  ctx.stroke();

  ants.forEach((ant) => {
    ctx.fillStyle = ant.carrying ? "#f97316" : "#ef4444";
    ctx.beginPath();
    ctx.arc((ant.x + 0.5) * CELL_W, (ant.y + 0.5) * CELL_H, Math.max(CELL_W * 0.45, 1.4), 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#f8fafc";
  ctx.font = "14px sans-serif";
  ctx.fillText("지표면", 8, CELL_H * (SURFACE_ROW + 1) - 6);
}

function loop() {
  if (!paused) {
    tick += 1;
    const digBias = Number(digBiasInput.value);
    const chamberBias = Number(chamberBiasInput.value);

    ants.forEach((ant) => moveAnt(ant, digBias, chamberBias));
    evaporatePheromone();
    updateStats();
  }

  draw();
  requestAnimationFrame(loop);
}

function bindUI() {
  const syncLabels = () => {
    antCountLabel.textContent = antCountInput.value;
    digBiasLabel.textContent = Number(digBiasInput.value).toFixed(2);
    chamberBiasLabel.textContent = Number(chamberBiasInput.value).toFixed(2);
  };

  antCountInput.addEventListener("input", syncLabels);
  digBiasInput.addEventListener("input", syncLabels);
  chamberBiasInput.addEventListener("input", syncLabels);

  resetBtn.addEventListener("click", () => {
    const antCount = Number(antCountInput.value);
    tick = 0;
    initWorld();
    spawnAnts(antCount);
    updateStats();
  });

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "재개" : "일시정지";
  });

  syncLabels();
}

function start() {
  bindUI();
  initWorld();
  spawnAnts(Number(antCountInput.value));
  updateStats();
  loop();
}

start();
