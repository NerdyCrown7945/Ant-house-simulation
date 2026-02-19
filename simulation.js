const Material = {
  AIR: 0,
  DIRT: 1,
  SAND: 2,
  WATER: 3,
  TUNNEL: 4,
  VOID: 5,
};

const State = {
  IDLE: "idle",
  DIGGING: "digging",
  CARRYING: "carrying",
  DEFENDING: "defending",
  REPRODUCING: "reproducing",
};

const CASTES = {
  worker: { color: "#ef4444", size: 0.8, speed: 1.05, dig: 1, life: 60000, carry: 1.1 },
  soldier: { color: "#f59e0b", size: 1.05, speed: 0.8, dig: 0.45, life: 65000, carry: 0.4 },
  male: { color: "#22d3ee", size: 0.72, speed: 1.0, dig: 0, life: 18000, carry: 0.2 },
  queen: { color: "#a855f7", size: 1.45, speed: 0.45, dig: 0.02, life: 120000, carry: 0 },
};

class Physics {
  static step(world) {
    const w = world.width;
    const h = world.height;

    for (let y = h - 2; y >= world.surfaceY + 1; y -= 1) {
      for (let x = 0; x < w; x += 1) {
        const c = world.get(x, y);
        if (c === Material.DIRT && world.isPassableForFalling(x, y + 1)) {
          world.swap(x, y, x, y + 1);
        } else if (c === Material.SAND) {
          if (world.get(x, y + 1) === Material.WATER) {
            world.swap(x, y, x, y + 1);
          } else if (world.isPassableForFalling(x, y + 1)) {
            world.swap(x, y, x, y + 1);
          }
        } else if (c === Material.WATER) {
          if (world.isPassableForLiquid(x, y + 1)) {
            world.swap(x, y, x, y + 1);
          } else {
            const dir = Math.random() < 0.5 ? -1 : 1;
            if (world.isPassableForLiquid(x + dir, y)) world.swap(x, y, x + dir, y);
            else if (world.isPassableForLiquid(x - dir, y)) world.swap(x, y, x - dir, y);
          }
        }
      }
    }
  }
}

class Egg {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.age = 0;
  }
  tick() {
    this.age += 1;
  }
}

class Larva {
  constructor(x, y, genes) {
    this.x = x;
    this.y = y;
    this.age = 0;
    this.genes = genes;
  }
  tick() {
    this.age += 1;
  }
}

class Ant {
  constructor(type, x, y, genes = {}) {
    this.type = type;
    this.x = x;
    this.y = y;
    this.state = State.IDLE;
    this.carrying = false;
    this.age = 0;
    this.hp = 100;
    this.genes = { speedMut: 1 + (Math.random() - 0.5) * 0.08, digMut: 1 + (Math.random() - 0.5) * 0.08, ...genes };
  }

  get cfg() {
    return CASTES[this.type];
  }

  canDie(colonyHasQueen) {
    if (this.age > this.cfg.life) return true;
    if (!colonyHasQueen && this.type !== "queen" && this.age > this.cfg.life * 0.4) return Math.random() < 0.005;
    return false;
  }

  moveTo(world, tx, ty) {
    if (world.isAntPassable(tx, ty)) {
      this.x = tx;
      this.y = ty;
      return true;
    }
    return false;
  }

  pickNeighbor(world, scorer) {
    const cands = world.neighbors8(this.x, this.y).map(([nx, ny]) => ({ nx, ny, s: scorer(nx, ny) }));
    cands.sort((a, b) => b.s - a.s);
    return cands.slice(0, 4)[Math.floor(Math.random() * Math.min(4, cands.length))];
  }

  update(sim) {
    const world = sim.world;
    this.age += 1;

    const nearThreat = sim.isThreatNear(this.x, this.y, 10);
    const queen = sim.findQueen();

    if (this.type === "soldier" && (nearThreat || (queen && sim.dist(this, queen) < 16))) this.state = State.DEFENDING;
    else if (this.type === "queen") this.state = State.REPRODUCING;
    else if (this.carrying) this.state = State.CARRYING;
    else this.state = State.DIGGING;

    if (this.state === State.REPRODUCING) {
      if (sim.food > 12 && sim.ticks % 140 === 0) {
        sim.food -= 6;
        sim.eggs.push(new Egg(this.x, this.y));
      }
      const pick = this.pickNeighbor(world, (nx, ny) => {
        const d = queen ? sim.dist({ x: nx, y: ny }, queen) : 0;
        return (world.isAntPassable(nx, ny) ? 1 : -99) + (ny > world.surfaceY + 18 ? 0.7 : 0) - d * 0.04;
      });
      if (pick) this.moveTo(world, pick.nx, pick.ny);
      return;
    }

    if (this.state === State.DEFENDING) {
      const target = sim.getNearestThreat(this.x, this.y);
      const anchor = target || queen;
      if (!anchor) return;
      const pick = this.pickNeighbor(world, (nx, ny) => {
        const d = sim.dist({ x: nx, y: ny }, anchor);
        return (world.isAntPassable(nx, ny) ? 2 : -99) - d * 0.2;
      });
      if (pick) this.moveTo(world, pick.nx, pick.ny);
      return;
    }

    if (this.state === State.CARRYING) {
      const pick = this.pickNeighbor(world, (nx, ny) => (world.isAntPassable(nx, ny) ? 1 : -99) + (ny < this.y ? 1.1 : 0));
      if (pick) this.moveTo(world, pick.nx, pick.ny);
      if (this.y <= world.surfaceY + 2) {
        this.carrying = false;
        sim.food += 0.25;
      }
      return;
    }

    if (this.state === State.DIGGING) {
      const pick = this.pickNeighbor(world, (nx, ny) => {
        const m = world.get(nx, ny);
        let score = 0;
        if (m === Material.TUNNEL || m === Material.AIR) score += 1.2;
        if (m === Material.DIRT || m === Material.SAND) score += this.cfg.dig * this.genes.digMut;
        if (ny > this.y) score += 0.45;
        return score;
      });
      if (!pick) return;

      const m = world.get(pick.nx, pick.ny);
      if ((m === Material.DIRT || m === Material.SAND) && this.type !== "male") {
        const digChance = 0.03 + this.cfg.dig * this.genes.digMut * 0.2;
        if (Math.random() < digChance) {
          world.set(pick.nx, pick.ny, Material.TUNNEL);
          this.moveTo(world, pick.nx, pick.ny);
          this.carrying = Math.random() < this.cfg.carry;
          sim.efficiency += 0.6;
          if (Math.random() < 0.05) sim.expandChamber(pick.nx, pick.ny);
        }
      } else {
        this.moveTo(world, pick.nx, pick.ny);
      }
    }
  }
}

class WorkerAnt extends Ant { constructor(x, y, genes) { super("worker", x, y, genes); } }
class SoldierAnt extends Ant { constructor(x, y, genes) { super("soldier", x, y, genes); } }
class MaleAnt extends Ant { constructor(x, y, genes) { super("male", x, y, genes); } }
class QueenAnt extends Ant { constructor(x, y, genes) { super("queen", x, y, genes); } }

class World {
  constructor(width, height, viewWidth) {
    this.width = width;
    this.height = height;
    this.viewWidth = viewWidth;
    this.surfaceY = 12;
    this.grid = new Uint8Array(width * height);
    this.reset();
  }

  idx(x, y) {
    return y * this.width + x;
  }

  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  get(x, y) {
    if (!this.inBounds(x, y)) return Material.VOID;
    return this.grid[this.idx(x, y)];
  }

  set(x, y, v) {
    if (!this.inBounds(x, y)) return;
    this.grid[this.idx(x, y)] = v;
  }

  swap(x1, y1, x2, y2) {
    if (!this.inBounds(x1, y1) || !this.inBounds(x2, y2)) return;
    const a = this.idx(x1, y1);
    const b = this.idx(x2, y2);
    const t = this.grid[a];
    this.grid[a] = this.grid[b];
    this.grid[b] = t;
  }

  isPassableForFalling(x, y) {
    const m = this.get(x, y);
    return m === Material.AIR || m === Material.TUNNEL || m === Material.WATER;
  }

  isPassableForLiquid(x, y) {
    const m = this.get(x, y);
    return m === Material.AIR || m === Material.TUNNEL;
  }

  isAntPassable(x, y) {
    const m = this.get(x, y);
    return m === Material.AIR || m === Material.TUNNEL;
  }

  neighbors8(x, y) {
    const out = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (this.inBounds(nx, ny) && ny > this.surfaceY && ny < this.height) out.push([nx, ny]);
      }
    }
    return out;
  }

  reset() {
    this.grid.fill(Material.AIR);
    const entrance = Math.floor(this.width / 2);

    for (let y = this.surfaceY + 1; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const r = Math.random();
        const base = r < 0.12 ? Material.SAND : Material.DIRT;
        this.set(x, y, base);
      }
    }

    for (let x = 0; x < this.width; x += 1) {
      this.set(x, this.surfaceY, Material.AIR);
      if (x % 50 > 35 && x % 50 < 44) {
        for (let y = this.surfaceY + 1; y < this.surfaceY + 8; y += 1) this.set(x, y, Material.WATER);
      }
    }

    for (let y = this.surfaceY; y < this.surfaceY + 10; y += 1) this.set(entrance, y, Material.TUNNEL);
    for (let y = this.surfaceY + 10; y < this.surfaceY + 16; y += 1) {
      this.set(entrance - 1, y, Material.TUNNEL);
      this.set(entrance, y, Material.TUNNEL);
      this.set(entrance + 1, y, Material.TUNNEL);
    }
  }
}

class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.world = world;
    this.cellW = canvas.width / world.viewWidth;
    this.cellH = canvas.height / world.height;
  }

  draw(sim) {
    const { ctx, world } = this;
    const viewX = sim.cameraX;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(0, 0, this.canvas.width, this.cellH * (world.surfaceY + 1));

    for (let y = world.surfaceY + 1; y < world.height; y += 1) {
      for (let sx = 0; sx < world.viewWidth; sx += 1) {
        const wx = viewX + sx;
        const m = world.get(wx, y);
        const px = sx * this.cellW;
        const py = y * this.cellH;
        if (m === Material.DIRT) ctx.fillStyle = "#8b5a2b";
        else if (m === Material.SAND) ctx.fillStyle = "#b08968";
        else if (m === Material.WATER) ctx.fillStyle = "rgba(56,189,248,0.75)";
        else if (m === Material.TUNNEL) ctx.fillStyle = "#111827";
        else continue;
        ctx.fillRect(px, py, this.cellW + 0.5, this.cellH + 0.5);
      }
    }

    for (const egg of sim.eggs) {
      const rx = egg.x - viewX;
      if (rx < 0 || rx >= world.viewWidth) continue;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse((rx + 0.5) * this.cellW, (egg.y + 0.5) * this.cellH, this.cellW * 0.23, this.cellH * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const larva of sim.larvae) {
      const rx = larva.x - viewX;
      if (rx < 0 || rx >= world.viewWidth) continue;
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.arc((rx + 0.5) * this.cellW, (larva.y + 0.5) * this.cellH, Math.max(1.6, this.cellW * 0.28), 0, Math.PI * 2);
      ctx.fill();
    }

    for (const ant of sim.ants) {
      const rx = ant.x - viewX;
      if (rx < 0 || rx >= world.viewWidth) continue;
      const cfg = CASTES[ant.type];
      const r = Math.max(1.6, this.cellW * 0.4 * cfg.size);
      const cx = (rx + 0.5) * this.cellW;
      const cy = (ant.y + 0.5) * this.cellH;
      ctx.fillStyle = cfg.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      if (ant.type === "queen") {
        ctx.strokeStyle = "rgba(216,180,254,0.9)";
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "#f8fafc";
    ctx.font = "13px sans-serif";
    ctx.fillText(`VIEW X: ${viewX} ~ ${viewX + world.viewWidth - 1}`, 10, 18);
  }
}

class UIController {
  constructor(sim) {
    this.sim = sim;
    this.bind();
  }

  bind() {
    const typeEl = document.getElementById("antType");
    const qtyEl = document.getElementById("spawnQty");
    const spawnBtn = document.getElementById("spawnBtn");
    const cam = document.getElementById("cameraSlider");
    const speed = document.getElementById("speedSlider");
    const clearBtn = document.getElementById("clearBtn");
    const eraserBtn = document.getElementById("eraserBtn");
    const voidBtn = document.getElementById("voidBtn");
    const pauseBtn = document.getElementById("pauseBtn");

    cam.max = String(this.sim.world.width - this.sim.world.viewWidth);

    spawnBtn.addEventListener("click", () => {
      const type = typeEl.value;
      const qty = Math.max(1, Math.min(200, Number(qtyEl.value) || 1));
      this.sim.spawn(type, qty);
    });

    cam.addEventListener("input", () => {
      this.sim.cameraX = Number(cam.value);
    });

    speed.addEventListener("input", () => {
      this.sim.speed = Number(speed.value);
    });

    clearBtn.addEventListener("click", () => this.sim.reset());
    eraserBtn.addEventListener("click", () => { this.sim.tool = "eraser"; });
    voidBtn.addEventListener("click", () => { this.sim.tool = "void"; });
    pauseBtn.addEventListener("click", () => {
      this.sim.paused = !this.sim.paused;
      pauseBtn.textContent = this.sim.paused ? "재개" : "일시정지";
    });

    const canvas = this.sim.renderer.canvas;
    let dragging = false;
    const paint = (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = Math.floor(((e.clientX - rect.left) / rect.width) * this.sim.world.viewWidth);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * this.sim.world.height);
      const x = sx + this.sim.cameraX;
      if (!this.sim.world.inBounds(x, y) || y <= this.sim.world.surfaceY) return;
      if (this.sim.tool === "eraser") this.sim.world.set(x, y, Material.TUNNEL);
      if (this.sim.tool === "void") this.sim.world.set(x, y, Material.VOID);
    };

    canvas.addEventListener("mousedown", (e) => { dragging = true; paint(e); });
    canvas.addEventListener("mousemove", (e) => { if (dragging) paint(e); });
    window.addEventListener("mouseup", () => { dragging = false; });
  }

  renderMetrics() {
    const m = document.getElementById("metrics");
    const c = this.sim.countByType();
    const queenAlive = c.queen > 0;

    m.innerHTML = `
      <li>틱: <strong>${this.sim.ticks}</strong></li>
      <li>개체수: <strong>${this.sim.ants.length}</strong> / ${this.sim.maxPopulation}</li>
      <li>일/병/수/여: <strong>${c.worker}/${c.soldier}/${c.male}/${c.queen}</strong></li>
      <li>알/유충: <strong>${this.sim.eggs.length}/${this.sim.larvae.length}</strong></li>
      <li>여왕 상태: <strong>${queenAlive ? "생존" : "사망"}</strong></li>
      <li>콜로니 효율 점수: <strong>${this.sim.efficiency.toFixed(1)}</strong></li>
      <li>콜로니 건강도: <strong>${this.sim.colonyHealth().toFixed(1)}</strong></li>
      <li>식량: <strong>${this.sim.food.toFixed(1)}</strong></li>
    `;
  }
}

class Simulation {
  constructor() {
    this.world = new World(420, 120, 180);
    this.renderer = new Renderer(document.getElementById("simCanvas"), this.world);
    this.ui = new UIController(this);

    this.ants = [];
    this.eggs = [];
    this.larvae = [];
    this.ticks = 0;
    this.speed = 2;
    this.paused = false;
    this.cameraX = 0;
    this.tool = "eraser";
    this.maxPopulation = 380;
    this.food = 40;
    this.efficiency = 0;
    this.threats = [];

    this.spawn("queen", 1);
    this.spawn("worker", 60);
  }

  reset() {
    this.world.reset();
    this.ants = [];
    this.eggs = [];
    this.larvae = [];
    this.ticks = 0;
    this.food = 40;
    this.efficiency = 0;
    this.spawn("queen", 1);
    this.spawn("worker", 60);
  }

  spawn(type, qty) {
    const cx = Math.floor(this.world.width / 2);
    for (let i = 0; i < qty; i += 1) {
      if (this.ants.length >= this.maxPopulation) break;
      const x = cx + ((i % 7) - 3);
      const y = this.world.surfaceY + 8 + (i % 4);
      if (type === "worker") this.ants.push(new WorkerAnt(x, y));
      if (type === "soldier") this.ants.push(new SoldierAnt(x, y));
      if (type === "male") this.ants.push(new MaleAnt(x, y));
      if (type === "queen" && this.countByType().queen < 2) this.ants.push(new QueenAnt(x, y));
    }
  }

  dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  findQueen() {
    return this.ants.find((a) => a.type === "queen") || null;
  }

  isThreatNear(x, y, r) {
    return this.threats.some((t) => Math.hypot(t.x - x, t.y - y) <= r);
  }

  getNearestThreat(x, y) {
    let best = null;
    let bd = Infinity;
    for (const t of this.threats) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  expandChamber(x, y) {
    for (const [nx, ny] of this.world.neighbors8(x, y)) {
      if (Math.random() < 0.35 && (this.world.get(nx, ny) === Material.DIRT || this.world.get(nx, ny) === Material.SAND)) {
        this.world.set(nx, ny, Material.TUNNEL);
      }
    }
  }

  processLifecycle() {
    for (const e of this.eggs) e.tick();
    for (const l of this.larvae) l.tick();

    const bornLarva = [];
    this.eggs = this.eggs.filter((e) => {
      if (e.age > 220) {
        bornLarva.push(new Larva(e.x, e.y, { speedMut: 1 + (Math.random() - 0.5) * 0.05, digMut: 1 + (Math.random() - 0.5) * 0.05 }));
        return false;
      }
      return true;
    });

    const bornAnts = [];
    this.larvae = this.larvae.filter((l) => {
      if (l.age > 240 && this.ants.length + bornAnts.length < this.maxPopulation) {
        const roll = Math.random();
        const type = roll < 0.67 ? "worker" : roll < 0.9 ? "soldier" : "male";
        if (type === "worker") bornAnts.push(new WorkerAnt(l.x, l.y, l.genes));
        if (type === "soldier") bornAnts.push(new SoldierAnt(l.x, l.y, l.genes));
        if (type === "male") bornAnts.push(new MaleAnt(l.x, l.y, l.genes));
        return false;
      }
      return true;
    });

    this.larvae.push(...bornLarva);
    this.ants.push(...bornAnts);
  }

  updateThreats() {
    if (this.ticks % 500 === 0) {
      const q = this.findQueen();
      if (q) this.threats.push({ x: q.x + Math.floor((Math.random() - 0.5) * 20), y: q.y + Math.floor((Math.random() - 0.5) * 8), ttl: 220 });
    }
    this.threats.forEach((t) => { t.ttl -= 1; });
    this.threats = this.threats.filter((t) => t.ttl > 0);
  }

  colonyHealth() {
    const c = this.countByType();
    const queenFactor = c.queen > 0 ? 35 : 5;
    const popFactor = Math.min(40, this.ants.length / this.maxPopulation * 40);
    const foodFactor = Math.min(25, this.food * 0.6);
    return queenFactor + popFactor + foodFactor;
  }

  countByType() {
    return this.ants.reduce((acc, a) => {
      acc[a.type] += 1;
      return acc;
    }, { worker: 0, soldier: 0, male: 0, queen: 0 });
  }

  tick() {
    this.ticks += 1;
    const queenAlive = this.countByType().queen > 0;

    this.updateThreats();

    for (let i = 0; i < this.speed; i += 1) Physics.step(this.world);

    for (const ant of this.ants) ant.update(this);

    this.processLifecycle();

    this.ants = this.ants.filter((a) => !a.canDie(queenAlive));

    this.food -= 0.002 * this.ants.length;
    if (this.food < 0) {
      this.food = 0;
      if (this.ticks % 40 === 0 && this.ants.length) this.ants.splice(0, 1);
    }
  }

  frame() {
    if (!this.paused) this.tick();
    this.renderer.draw(this);
    this.ui.renderMetrics();
    requestAnimationFrame(() => this.frame());
  }
}

const sim = new Simulation();
sim.frame();
