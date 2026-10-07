/**
 * @ghgjkbf/dsh-tank-game — browser half. Rebuilt on the open-source
 * tank-trouble semantics (kneasle/tank-trouble): grid units, precomputed
 * bouncing bullet polylines, integrated tank motion, fixed barrel.
 *
 * Units are MAZE SQUARES, exactly like the reference:
 *   wall 0.1 thick, tank 0.42 x 0.32, bullet r 0.05 at 2.2 squares/s,
 *   rotation 5 rad/s, movement 2 squares/s, 5 bullets per tank alive.
 */
window.__ModuleLoader__.load({
  id: '@ghgjkbf/dsh-tank-game',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    let react = require('react');
    let jsxRuntime = require('react/jsx-runtime');
    const j = jsxRuntime.jsx;
    const js = jsxRuntime.jsxs;

    //#region constants

    const PANEL_ID = 'tank-game';

    /** Reference constants (tanks.js / projectiles.js / wall.py), verbatim. */
    const TANK_LENGTH = 0.42;
    const TANK_WIDTH = 0.32;
    const ROTATION_SPEED = 5;      // rad/s
    const MOVEMENT_SPEED = 2;      // squares/s
    const BULLET_RADIUS = 0.05;
    const BULLET_SPEED = 2.2;      // squares/s
    const BULLET_LIFETIME = 10;    // s
    const MAX_OWNED_BULLETS = 5;
    const WALL_WIDTH = 0.1;
    const WALL_RADIUS = WALL_WIDTH / 2;

    /** Single-machine tuning (not from the reference). */
    const AI_COUNT = 3;
    const MINE_ARM_TIME = 1.5;
    const MINE_LIFE = 12;
    const MINE_TRIGGER_R = 0.45;
    const MINE_BLAST_R = 0.8;
    const TANK_RADIUS = 0.27;      // hull circumscribed circle, wall sliding
    const AI_BURST_IN = 2.5;
    const AI_BURST_FOR = 0.8;
    const AI_REPATH = 0.7;
    const AI_STUCK_TIME = 1.2;
    const AI_BACK_TIME = 0.6;
    const AI_BANK_SCAN = 16;

    //#endregion

    //#region maze (maze_gen.py + wall.py port)

    /**
     * Prim's maze with extra openings, faithful to maze_gen.generate_maze:
     * shuffle every edge, union-find them into a spanning tree, then knock
     * open (1-density) of the remaining walls. right[y][x] walls off
     * (x,y)-(x+1,y); bottom[y][x] walls off (x,y)-(x,y+1).
     */
    function generateMaze(sizeX, sizeY, density, rand) {
      const nodes = [];
      for (let q = 0; q < sizeX * sizeY; q += 1) nodes.push(q);
      const find = (q) => {
        while (nodes[q] !== q) { nodes[q] = nodes[nodes[q]]; q = nodes[q]; }
        return q;
      };
      const edges = [];
      for (let y = 0; y < sizeY; y += 1)
        for (let x = 0; x < sizeX - 1; x += 1) edges.push({ o: 'r', x, y, open: false });
      for (let y = 0; y < sizeY - 1; y += 1)
        for (let x = 0; x < sizeX; x += 1) edges.push({ o: 'b', x, y, open: false });
      for (let i = edges.length - 1; i > 0; i -= 1) {
        const k = Math.floor(rand() * (i + 1));
        const t = edges[i]; edges[i] = edges[k]; edges[k] = t;
      }
      for (const e of edges) {
        const a = e.x + e.y * sizeX;
        const b = e.o === 'r' ? e.x + 1 + e.y * sizeX : e.x + (e.y + 1) * sizeX;
        const ga = find(a), gb = find(b);
        if (ga !== gb) { nodes[gb] = ga; e.open = true; }
      }
      const closed = edges.filter((e) => !e.open);
      for (let i = closed.length - 1; i > 0; i -= 1) {
        const k = Math.floor(rand() * (i + 1));
        const t = closed[i]; closed[i] = closed[k]; closed[k] = t;
      }
      const knock = Math.round((sizeX - 1) * (sizeY - 1) * (1 - density));
      for (let i = 0; i < knock && i < closed.length; i += 1) closed[i].open = true;
      const right = [], bottom = [];
      for (let y = 0; y < sizeY; y += 1) right.push(new Array(sizeX - 1).fill(true));
      for (let y = 0; y < sizeY - 1; y += 1) bottom.push(new Array(sizeX).fill(true));
      for (const e of edges) {
        if (e.o === 'r') right[e.y][e.x] = !e.open;
        else bottom[e.y][e.x] = !e.open;
      }
      return { right, bottom, sizeX, sizeY };
    }

    /** Rectangular walls from the maze grids (wall.py formulas). */
    function buildWalls(maze) {
      const { sizeX, sizeY } = maze;
      const walls = [];
      const hw = (x, y, len) => walls.push({ x: x - WALL_RADIUS, y: y - WALL_RADIUS, w: len + WALL_WIDTH, h: WALL_WIDTH });
      const vw = (x, y, len) => walls.push({ x: x - WALL_RADIUS, y: y - WALL_RADIUS, w: WALL_WIDTH, h: len + WALL_WIDTH });
      hw(0, 0, sizeX); hw(0, sizeY, sizeX);
      vw(0, 0, sizeY); vw(sizeX, 0, sizeY);
      for (let y = 0; y < sizeY - 1; y += 1) {
        let x = 0;
        while (x < sizeX) {
          let len = 0;
          const startX = x;
          while (x < sizeX && maze.bottom[y][x]) { x += 1; len += 1; }
          if (len > 0) hw(startX, y + 1, len);
          x += 1;
        }
      }
      for (let x = 0; x < sizeX - 1; x += 1) {
        let y = 0;
        while (y < sizeY) {
          let len = 0;
          const startY = y;
          while (y < sizeY && maze.right[y][x]) { y += 1; len += 1; }
          if (len > 0) vw(x + 1, startY, len);
          y += 1;
        }
      }
      return walls;
    }

    /** Cell-centre coordinates of a tile. */
    const cellCentre = (x, y) => ({ x: x + 0.5, y: y + 0.5 });

    //#endregion

    //#region bouncing raycast (collisions.js port)

    /**
     * Ray vs padded wall rects; returns first hit { t, axis } — t along the
     * ray, axis 'x'|'y' is the normal axis (reflection flips that component).
     */
    function raycastWalls(px, py, dx, dy, walls, padding, maxT) {
      let best = null;
      let bestT = maxT === undefined ? Infinity : maxT;
      const minT = 1e-4;
      for (const w of walls) {
        const minX = w.x - padding, minY = w.y - padding;
        const maxX = w.x + w.w + padding, maxY = w.y + w.h + padding;
        if (dy !== 0) {
          let t = (minY - py) / dy;
          if (t > minT && t < bestT) {
            const hx = px + dx * t;
            if (hx >= minX && hx <= maxX) { bestT = t; best = { t, axis: 'y' }; }
          }
          t = (maxY - py) / dy;
          if (t > minT && t < bestT) {
            const hx = px + dx * t;
            if (hx >= minX && hx <= maxX) { bestT = t; best = { t, axis: 'y' }; }
          }
        }
        if (dx !== 0) {
          let t = (minX - px) / dx;
          if (t > minT && t < bestT) {
            const hy = py + dy * t;
            if (hy >= minY && hy <= maxY) { bestT = t; best = { t, axis: 'x' }; }
          }
          t = (maxX - px) / dx;
          if (t > minT && t < bestT) {
            const hy = py + dy * t;
            if (hy >= minY && hy <= maxY) { bestT = t; best = { t, axis: 'x' }; }
          }
        }
      }
      return best;
    }

    /**
     * Precompute a bullet's full bouncing path — projectiles.js semantics.
     * Returns [{ x, y, time }]; position at age t is the segment lerp.
     */
    function bulletPath(px, py, angle, walls) {
      const total = BULLET_SPEED * BULLET_LIFETIME;
      const pts = [{ x: px, y: py, time: 0 }];
      let x = px, y = py, dx = Math.cos(angle), dy = Math.sin(angle);
      let travelled = 0;
      let guard = 0;
      while (travelled < total && guard < 64) {
        guard += 1;
        const hit = raycastWalls(x, y, dx, dy, walls, BULLET_RADIUS, total - travelled);
        if (!hit) {
          pts.push({ x: x + dx * (total - travelled), y: y + dy * (total - travelled), time: total / BULLET_SPEED });
          break;
        }
        const nx = x + dx * hit.t, ny = y + dy * hit.t;
        travelled += hit.t;
        pts.push({ x: nx, y: ny, time: travelled / BULLET_SPEED });
        if (hit.axis === 'x') dx = -dx; else dy = -dy;
        x = nx; y = ny;
      }
      return pts;
    }

    /** Bullet position at age t, or null past the end. */
    function bulletPosAt(path, t) {
      let i = 1;
      while (i < path.length && path[i].time < t) i += 1;
      if (i >= path.length) return null;
      const a = path[i - 1], b = path[i];
      const span = b.time - a.time;
      const f = span > 0 ? (t - a.time) / span : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }

    /** Straight-line sight test between two points. */
    function lineOfSight(x1, y1, x2, y2, walls) {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return true;
      return !raycastWalls(x1, y1, dx / len, dy / len, walls, 0, len);
    }

    //#endregion

    //#region sim state

    /** Mulberry32 — small deterministic PRNG for reproducible rounds. */
    function makeRand(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /**
     * One full game world. Everything lives in plain objects so the headless
     * acceptance harness can step the same functions the canvas drives.
     */
    function createGame(seed, aiCount) {
      const rand = makeRand(seed);
      // Maze size biased to player count like game_state.start_new_game.
      const sizeX = Math.min(14, 8 + aiCount);
      const sizeY = Math.min(10, 6 + Math.ceil(aiCount / 2));
      const maze = generateMaze(sizeX, sizeY, 0.9, rand);
      const walls = buildWalls(maze);

      // Spawn at distinct open cell centres (shuffled, like the reference).
      const cells = [];
      for (let y = 0; y < sizeY; y += 1)
        for (let x = 0; x < sizeX; x += 1) cells.push([x, y]);
      for (let i = cells.length - 1; i > 0; i -= 1) {
        const k = Math.floor(rand() * (i + 1));
        const t = cells[i]; cells[i] = cells[k]; cells[k] = t;
      }
      const tanks = [];
      const total = 1 + aiCount;
      // Fair start: the player takes the first cell, and every AI must spawn
      // at least MIN_SPAWN_DIST cells away (Chebyshev) — random cells put an
      // AI 1 square from the player, which is death before the first input.
      const MIN_SPAWN_DIST = 4;
      const placed = [];
      for (let i = 0; i < total; i += 1) {
        let cell = null;
        if (i === 0) cell = cells[0];
        else {
          for (const cand of cells) {
            const ok = placed.every(([px2, py2]) =>
              Math.max(Math.abs(cand[0] - px2), Math.abs(cand[1] - py2)) >= MIN_SPAWN_DIST);
            if (ok) { cell = cand; break; }
          }
          if (!cell) {
            // Small mazes may not fit the constraint; fall back to farthest
            // from everything already placed.
            let bestD = -1;
            for (const cand of cells) {
              const d = Math.min(...placed.map(([px2, py2]) =>
                Math.max(Math.abs(cand[0] - px2), Math.abs(cand[1] - py2))));
              if (d > bestD) { bestD = d; cell = cand; }
            }
          }
        }
        placed.push(cell);
        const [cx, cy] = cell;
        const c = cellCentre(cx, cy);
        tanks.push({
          id: i,
          isAI: i > 0,
          alive: true,
          x: c.x, y: c.y,
          r: rand() * Math.PI * 2,
          forwardVelocity: 0,   // -1..1 (reference semantics)
          angularVelocity: 0,   // -1..1 scaled by ROTATION_SPEED
          bulletsAlive: 0,
          lastShot: -9,
          // AI bookkeeping
          path: null, pathAt: -9, goal: null,
          stuck: 0, backUntil: 0, px: c.x, py: c.y,
          lastSeen: null,
        });
      }
      return {
        maze, walls, sizeX, sizeY, tanks,
        bullets: [], mines: [], explosions: [],
        time: 0, over: null, // over = winner tank id when round ends
        rand,
        stats: { kills: 0 },
      };
    }

    /** Circle-vs-AABB push-out: returns corrected {x, y} for the hull circle. */
    function pushCircle(px, py, radius, walls) {
      let x = px, y = py;
      for (const w of walls) {
        const nx = Math.max(w.x, Math.min(x, w.x + w.w));
        const ny = Math.max(w.y, Math.min(y, w.y + w.h));
        const dx = x - nx, dy = y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 < radius * radius) {
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            x = nx + (dx / d) * radius;
            y = ny + (dy / d) * radius;
          } else {
            // Centre inside the rect: push along the shallow axis.
            const left = x - w.x, right = w.x + w.w - x;
            const top = y - w.y, bottom = w.y + w.h - y;
            const m = Math.min(left, right, top, bottom);
            if (m === left) x = w.x - radius;
            else if (m === right) x = w.x + w.w + radius;
            else if (m === top) y = w.y - radius;
            else y = w.y + w.h + radius;
          }
        }
      }
      return { x, y };
    }

    /**
     * Step the world by dt. Input for the player tank:
     *   { steer: -1..1, forward: -1..1, fire: bool, mine: bool }
     * AI tanks compute their own input from the same intent shape.
     */
    function stepGame(game, playerInput, dt) {
      if (game.over !== null) return;
      game.time += dt;

      // --- 1. tank motion (tanks.js integration + circle wall slide) ---
      for (const tank of game.tanks) {
        if (!tank.alive) continue;
        let input = playerInput;
        if (tank.isAI) input = aiInput(game, tank);
        tank.forwardVelocity = Math.max(-1, Math.min(1, input.forward));
        tank.angularVelocity = Math.max(-1, Math.min(1, input.steer));

        tank.r += tank.angularVelocity * dt * ROTATION_SPEED;
        const step = tank.forwardVelocity * dt * MOVEMENT_SPEED;
        tank.x += step * Math.cos(tank.r);
        tank.y += step * Math.sin(tank.r);

        // Wall slide: hull circle pushed out of every wall rect.
        const fixed = pushCircle(tank.x, tank.y, TANK_RADIUS, game.walls);
        tank.x = fixed.x; tank.y = fixed.y;

        // Tank-vs-tank: equal-mass circle push.
        for (const other of game.tanks) {
          if (other === tank || !other.alive) continue;
          const dx = tank.x - other.x, dy = tank.y - other.y;
          const d = Math.hypot(dx, dy);
          const minD = TANK_RADIUS * 2;
          if (d > 1e-6 && d < minD) {
            const push = (minD - d) / 2;
            tank.x += (dx / d) * push;
            tank.y += (dy / d) * push;
            other.x -= (dx / d) * push;
            other.y -= (dy / d) * push;
          }
        }

        // Firing (burst rhythm for AI, immediate for player).
        if (input.fire && tank.bulletsAlive < MAX_OWNED_BULLETS) {
          const cadence = tank.isAI ? AI_BURST_IN : 0.45;
          if (game.time - tank.lastShot >= cadence) {
            tank.lastShot = game.time;
            tank.bulletsAlive += 1;
            const muzzle = TANK_LENGTH / 2 + BULLET_RADIUS * 2;
            game.bullets.push({
              owner: tank.id,
              path: bulletPath(
                tank.x + Math.cos(tank.r) * muzzle,
                tank.y + Math.sin(tank.r) * muzzle,
                tank.r, game.walls),
              spawn: game.time,
            });
          }
        }
        // Mining.
        if (input.mine && game.time - (tank.lastMine ?? -9) > 1.0) {
          tank.lastMine = game.time;
          game.mines.push({ owner: tank.id, x: tank.x, y: tank.y, born: game.time });
        }
      }

      // --- 2. bullets (precomputed paths) ---
      for (let i = game.bullets.length - 1; i >= 0; i -= 1) {
        const b = game.bullets[i];
        const pos = bulletPosAt(b.path, game.time - b.spawn);
        if (!pos) { // expired
          game.tanks[b.owner].bulletsAlive -= 1;
          game.bullets.splice(i, 1);
          continue;
        }
        b.x = pos.x; b.y = pos.y;
        // Tank hits (reference test: inverse-transform into tank space).
        let hit = false;
        for (const tank of game.tanks) {
          if (!tank.alive) continue;
          const dx = b.x - tank.x, dy = b.y - tank.y;
          const lx = dx * Math.cos(-tank.r) - dy * Math.sin(-tank.r);
          const ly = dx * Math.sin(-tank.r) + dy * Math.cos(-tank.r);
          if (Math.abs(lx) <= TANK_LENGTH / 2 + BULLET_RADIUS
            && Math.abs(ly) <= TANK_WIDTH / 2 + BULLET_RADIUS) {
            // Owner immune briefly? Reference has no i-frames but the muzzle
            // starts outside the hull, so no self-hit on spawn. A bullet CAN
            // hit its owner after a bounce — that is authentic.
            killTank(game, tank, b.owner);
            hit = true;
            break;
          }
        }
        // Bullet-vs-bullet mutual annihilation.
        if (!hit) {
          for (let k = i - 1; k >= 0; k -= 1) {
            const o = game.bullets[k];
            if (Math.hypot(b.x - o.x, b.y - o.y) < BULLET_RADIUS * 2) {
              game.tanks[b.owner].bulletsAlive -= 1;
              game.tanks[o.owner].bulletsAlive -= 1;
              game.bullets.splice(i, 1);
              game.bullets.splice(k, 1);
              hit = true;
              i -= 1; // index shift after removing k
              break;
            }
          }
        }
        if (hit) continue;
      }

      // --- 3. mines ---
      for (let i = game.mines.length - 1; i >= 0; i -= 1) {
        const m = game.mines[i];
        const age = game.time - m.born;
        if (age > MINE_LIFE) { game.mines.splice(i, 1); continue; }
        if (age < MINE_ARM_TIME) continue;
        for (const tank of game.tanks) {
          if (!tank.alive) continue;
          if (Math.hypot(tank.x - m.x, tank.y - m.y) < MINE_TRIGGER_R) {
            game.explosions.push({ x: m.x, y: m.y, born: game.time });
            for (const victim of game.tanks) {
              if (victim.alive && Math.hypot(victim.x - m.x, victim.y - m.y) < MINE_BLAST_R) {
                killTank(game, victim, m.owner);
              }
            }
            game.mines.splice(i, 1);
            break;
          }
        }
      }

      // --- 4. explosion visuals age out ---
      for (let i = game.explosions.length - 1; i >= 0; i -= 1) {
        if (game.time - game.explosions[i].born > 0.6) game.explosions.splice(i, 1);
      }
    }

    function killTank(game, tank, killerId) {
      tank.alive = false;
      game.stats.kills += 1;
      // The round is ABOUT the player: dying ends it immediately, whatever
      // the AI count. Winning means outlasting every AI.
      if (!tank.isAI) {
        game.over = game.tanks.some((t) => t.isAI && t.alive) ? -2 : -1;
        return;
      }
      const aisAlive = game.tanks.filter((t) => t.isAI && t.alive).length;
      if (aisAlive === 0) game.over = 0;
    }

    //#endregion

    //#region ai

    /**
     * AI input, rebuilt simple: three clean rules, no patch stack.
     *   1. SEE the player -> steer at it, fire on the burst rhythm.
     *   2. Bank shot -> probe AI_BANK_SCAN directions with the same raycast
     *      the bullets use; fire along one whose path passes near the player.
     *   3. Blind -> BFS through the maze graph toward the last seen cell
     *      (or a random patrol cell), steer along the path, back off if stuck.
     */
    function aiInput(game, tank) {
      const player = game.tanks[0];
      const input = { steer: 0, forward: 0, fire: false, mine: false };
      if (!player || !player.alive) {
        // Victory lap: patrol.
        return aiHunt(game, tank, input, true);
      }
      const d = Math.hypot(player.x - tank.x, player.y - tank.y);

      // 1. Direct sight.
      if (lineOfSight(tank.x, tank.y, player.x, player.y, game.walls)) {
        tank.lastSeen = { x: player.x, y: player.y, at: game.time };
        return aiEngage(game, tank, player, input, d);
      }

      // 2. Bank shot scan (throttled with the burst rhythm).
      const phase = (game.time + tank.id * 1.7) % (AI_BURST_IN + AI_BURST_FOR);
      if (phase >= AI_BURST_IN) {
        const aim = findBankShot(game, tank, player);
        if (aim !== null) {
          return { ...steerToward(tank, aim), forward: 0, fire: true, mine: false };
        }
      }

      // 3. Blind hunt.
      return aiHunt(game, tank, input, false);
    }

    function aiEngage(game, tank, player, input, d) {
      let aim = Math.atan2(player.y - tank.y, player.x - tank.x);
      const steer = steerToward(tank, aim);
      // Back off when crowded, advance when far, hold in the pocket.
      let forward = 0;
      if (d < 1.1) forward = -1;
      else if (d > 2.2) forward = 1;
      const canFire = Math.abs(aimDiff(tank.r, aim)) < 0.12;
      return { ...steer, forward, fire: canFire, mine: false };
    }

    /**
     * Probe AI_BANK_SCAN uniformly spaced directions (plus the direct
     * bearing) with the bullet path tracer; return the first angle whose
     * precomputed polyline passes within hit range of the player — the same
     * physics the live bullet will follow, so the answer is exact.
     */
    function findBankShot(game, tank, player) {
      const muzzle = TANK_LENGTH / 2 + BULLET_RADIUS * 2;
      const candidates = [];
      for (let i = 0; i < AI_BANK_SCAN; i += 1) {
        candidates.push((i / AI_BANK_SCAN) * Math.PI * 2);
      }
      candidates.push(Math.atan2(player.y - tank.y, player.x - tank.x));
      let best = null;
      let bestLen = Infinity;
      for (const a of candidates) {
        const path = bulletPath(
          tank.x + Math.cos(a) * muzzle, tank.y + Math.sin(a) * muzzle, a, game.walls);
        // Walk the polyline segments against the player position.
        for (let i = 1; i < path.length; i += 1) {
          const p0 = path[i - 1], p1 = path[i];
          const vx = p1.x - p0.x, vy = p1.y - p0.y;
          const segLen2 = vx * vx + vy * vy;
          let t = 0;
          if (segLen2 > 1e-9) {
            t = ((player.x - p0.x) * vx + (player.y - p0.y) * vy) / segLen2;
            t = Math.max(0, Math.min(1, t));
          }
          const cx = p0.x + vx * t, cy = p0.y + vy * t;
          const dist = Math.hypot(player.x - cx, player.y - cy);
          if (dist < 0.45) {
            const travel = Math.hypot(cx - tank.x, cy - tank.y);
            if (travel < bestLen) { bestLen = travel; best = a; }
            break;
          }
        }
        if (best !== null && bestLen < 2.0) break; // close shot, good enough
      }
      return best;
    }

    /** Blind BFS hunt through the cell graph (right/bottom wall grids). */
    function aiHunt(game, tank, input, patrolOnly) {
      const sizeX = game.sizeX, sizeY = game.sizeY;
      const cx = Math.floor(tank.x), cy = Math.floor(tank.y);
      const key = (x, y) => x + ',' + y;

      // Pick a goal: the last-seen cell, else a random far-ish cell.
      if (tank.pathAt + AI_REPATH < game.time || !tank.path) {
        tank.pathAt = game.time;
        let goal = tank.goal;
        const lastSeenFresh = tank.lastSeen && game.time - tank.lastSeen.at < 3.0;
        if (!patrolOnly && lastSeenFresh) {
          goal = [Math.floor(tank.lastSeen.x), Math.floor(tank.lastSeen.y)];
        } else if (!goal || (goal[0] === cx && goal[1] === cy)) {
          goal = [Math.floor(game.rand() * sizeX), Math.floor(game.rand() * sizeY)];
        }
        tank.goal = goal;
        tank.path = bfsPath(game, cx, cy, goal[0], goal[1]);
      }

      // Follow the path: steer at the first cell at least half a cell ahead.
      if (tank.path && tank.path.length > 0) {
        let target = null;
        for (const [gx, gy] of tank.path) {
          const c = cellCentre(gx, gy);
          const along = (c.x - tank.x) * Math.cos(tank.r) + (c.y - tank.y) * Math.sin(tank.r);
          if (along > 0.35 || Math.hypot(c.x - tank.x, c.y - tank.y) > 0.7) { target = c; break; }
        }
        if (!target) target = cellCentre(tank.path[tank.path.length - 1][0], tank.path[tank.path.length - 1][1]);
        const aim = Math.atan2(target.y - tank.y, target.x - tank.x);
        const steer = steerToward(tank, aim);
        const input2 = { ...steer, forward: 1, fire: false, mine: false };
        // Stuck watchdog, dead simple: not moved for a while -> back up.
        const moved = Math.hypot(tank.x - tank.px, tank.y - tank.py);
        if (moved > 0.05) { tank.stuck = 0; tank.px = tank.x; tank.py = tank.y; }
        else {
          tank.stuck += 1 / 60;
          if (tank.stuck > AI_STUCK_TIME && game.time > tank.backUntil) {
            tank.backUntil = game.time + AI_BACK_TIME;
            tank.stuck = 0;
            tank.path = null; // repath after the back-off
          }
        }
        if (game.time < tank.backUntil) { input2.forward = -1; }
        return input2;
      }

      // No path: turn toward a random direction to unstick.
      return { steer: 0.4, forward: 0, fire: false, mine: false };
    }

    /** BFS over cells; right[y][x] blocks x->x+1, bottom[y][x] blocks y->y+1. */
    function bfsPath(game, sx, sy, tx, ty) {
      const sizeX = game.sizeX, sizeY = game.sizeY;
      if (sx === tx && sy === ty) return [];
      const prev = new Map();
      const key = (x, y) => x + ',' + y;
      prev.set(key(sx, sy), null);
      const queue = [[sx, sy]];
      for (let head = 0; head < queue.length; head += 1) {
        const [x, y] = queue[head];
        const neighbours = [];
        if (x + 1 < sizeX && !game.maze.right[y][x]) neighbours.push([x + 1, y]);
        if (x - 1 >= 0 && !game.maze.right[y][x - 1]) neighbours.push([x - 1, y]);
        if (y + 1 < sizeY && !game.maze.bottom[y][x]) neighbours.push([x, y + 1]);
        if (y - 1 >= 0 && !game.maze.bottom[y - 1][x]) neighbours.push([x, y - 1]);
        for (const n of neighbours) {
          const k = key(n[0], n[1]);
          if (prev.has(k)) continue;
          prev.set(k, key(x, y));
          if (n[0] === tx && n[1] === ty) {
            const path = [];
            let node = k;
            while (node !== null) {
              const [px, py] = node.split(',').map(Number);
              path.push([px, py]);
              node = prev.get(node);
            }
            path.reverse();
            return path.slice(1);
          }
          queue.push(n);
        }
      }
      return null;
    }

    /** Normalised angle difference a-b into [-pi, pi]. */
    function aimDiff(a, b) {
      let d = a - b;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    }

    /** Steer input (-1..1) that turns the hull toward `aim` fastest. */
    function steerToward(tank, aim) {
      const d = aimDiff(aim, tank.r);
      return { steer: Math.abs(d) < 0.05 ? 0 : (d > 0 ? 1 : -1) };
    }

    //#endregion

    //#region render

    /** Letterbox the maze into the canvas; returns the world->screen mapping. */
    function makeCamera(canvas, game) {
      const w = canvas.width, h = canvas.height;
      const fill = 0.94;
      const scale = Math.min(w / game.sizeX, h / game.sizeY) * fill;
      const ox = (w - game.sizeX * scale) / 2;
      const oy = (h - game.sizeY * scale) / 2;
      return { scale, ox, oy };
    }

    const TANK_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

    function drawGame(ctx, canvas, game, aim, paused) {
      const cam = makeCamera(canvas, game);
      ctx.fillStyle = '#f4f1ea';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(cam.ox, cam.oy);
      ctx.scale(cam.scale, cam.scale);

      // Walls.
      ctx.fillStyle = '#22201d';
      for (const w of game.walls) ctx.fillRect(w.x, w.y, w.w, w.h);

      // Mines.
      for (const m of game.mines) {
        const armed = game.time - m.born >= MINE_ARM_TIME;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.12, 0, Math.PI * 2);
        ctx.fillStyle = armed ? '#c0392b' : '#7f8c8d';
        ctx.fill();
        ctx.strokeStyle = '#22201d';
        ctx.lineWidth = 0.03;
        ctx.stroke();
      }

      // Tanks (reference draw: hull rect + barrel + turret dot).
      for (const tank of game.tanks) {
        if (!tank.alive) continue;
        const color = TANK_COLORS[tank.id % TANK_COLORS.length];
        ctx.save();
        ctx.translate(tank.x, tank.y);
        ctx.rotate(tank.r);
        ctx.lineWidth = 0.025;
        ctx.strokeStyle = '#22201d';
        // Hull.
        ctx.fillStyle = color;
        roundedRect(ctx, -TANK_LENGTH / 2, -TANK_WIDTH / 2, TANK_LENGTH, TANK_WIDTH, 0.05);
        ctx.fill(); ctx.stroke();
        // Barrel (fixed to the hull — the tank-trouble silhouette).
        ctx.beginPath();
        ctx.moveTo(TANK_LENGTH / 2 - 0.1, 0);
        ctx.lineTo(TANK_LENGTH / 2 + 0.2, 0);
        ctx.lineWidth = 0.1;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.lineWidth = 0.02;
        ctx.strokeStyle = '#22201d';
        ctx.beginPath();
        ctx.moveTo(TANK_LENGTH / 2 - 0.1, 0.05);
        ctx.lineTo(TANK_LENGTH / 2 + 0.2, 0.05);
        ctx.moveTo(TANK_LENGTH / 2 - 0.1, -0.05);
        ctx.lineTo(TANK_LENGTH / 2 + 0.2, -0.05);
        ctx.stroke();
        // Turret dot.
        ctx.beginPath();
        ctx.arc(0, 0, 0.1, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 0.025;
        ctx.strokeStyle = '#22201d';
        ctx.stroke();
        ctx.restore();
      }

      // Bullets.
      ctx.fillStyle = '#111';
      for (const b of game.bullets) {
        if (b.x === undefined) continue;
        ctx.beginPath();
        ctx.arc(b.x, b.y, BULLET_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      // Explosions.
      for (const ex of game.explosions) {
        const age = (game.time - ex.born) / 0.6;
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, MINE_BLAST_R * (0.4 + 0.6 * age), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(192,57,43,${1 - age})`;
        ctx.lineWidth = 0.08;
        ctx.stroke();
      }

      ctx.restore();

      // Aim line from the player tank toward the mouse (fixed barrel: the
      // whole hull aims).
      const player = game.tanks[0];
      if (player && player.alive && aim) {
        ctx.strokeStyle = 'rgba(34,32,29,0.25)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cam.ox + player.x * cam.scale, cam.oy + player.y * cam.scale);
        ctx.lineTo(cam.ox + aim.x * cam.scale, cam.oy + aim.y * cam.scale);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Pause overlay.
      if (paused && game.over === null) {
        ctx.fillStyle = 'rgba(244,241,234,0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#22201d';
        ctx.font = '600 22px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED — P 或 Pause 按钮继续', canvas.width / 2, canvas.height / 2 + 8);
      }

      // Round-over banner.
      if (game.over !== null) {
        ctx.fillStyle = 'rgba(244,241,234,0.75)';
        ctx.fillRect(0, canvas.height / 2 - 34, canvas.width, 68);
        ctx.fillStyle = '#22201d';
        ctx.font = '600 22px ui-monospace, monospace';
        ctx.textAlign = 'center';
        const text = game.over === 0 ? 'YOU WIN — 点击重开'
          : game.over === -1 ? 'MUTUAL DESTRUCTION — 点击重开'
            : '你被击毁 — 点击重开';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 8);
      }
    }

    function roundedRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    //#endregion

    //#region panel

    const styles = `
.tg-wrap{position:absolute;inset:0;display:flex;align-items:stretch;justify-content:center;background:#3b3833;overflow:auto}
.tg-card{display:flex;flex-direction:column;margin:auto;width:min(880px,94vw);height:min(640px,92vh);
  background:#f4f1ea;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.45);overflow:hidden}
.tg-bar{display:flex;gap:10px;align-items:center;padding:8px 14px;background:#f4f1ea;color:#22201d;
  font:12px ui-monospace,monospace;border-bottom:2px solid #22201d}
.tg-bar button{background:#22201d;color:#f4f1ea;border:none;border-radius:5px;padding:4px 12px;cursor:pointer;font:inherit}
.tg-bar .spacer{flex:1}
.tg-canvas-host{flex:1;position:relative;background:#f4f1ea}
.tg-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
.tg-select{background:#ece8df;color:#22201d;border:1px solid #77726a;border-radius:5px;padding:3px 8px;font:inherit;cursor:pointer}
.tg-help{padding:4px 14px;font:11px ui-monospace,monospace;color:#77726a;background:#ece8df;border-top:1px solid #ddd6c8}
`;

    function GamePanel({ onClose }) {
      const hostRef = react.useRef(null);
      const gameRef = react.useRef(null);
      const inputRef = react.useRef({ steer: 0, forward: 0, fire: false, mine: false });
      const mouseRef = react.useRef(null);
      const buttonsRef = react.useRef({ l: false, r: false });

      react.useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        const style = document.createElement('style');
        style.textContent = styles;
        document.head.appendChild(style);

        // The white frame: a fixed-size card centred on the dark backdrop,
        // carrying the controls on its border. The canvas letterboxes inside.
        const card = document.createElement('div');
        card.className = 'tg-card';
        host.appendChild(card);
        const canvas = document.createElement('canvas');
        canvas.className = 'tg-canvas';
        const host2 = document.createElement('div');
        host2.className = 'tg-canvas-host';
        host2.appendChild(canvas);
        // DOM order is fixed up below (bar is created later): move host2
        // after the bar once it exists.

        // Top bar: AI count, pause, back-to-chat. The panel replaces the
        // conversation area, so a visible way out is part of the contract.
        const bar = document.createElement('div');
        bar.className = 'tg-bar';
        const aiLabel = document.createElement('span');
        aiLabel.textContent = 'AI 坦克';
        const aiSelect = document.createElement('select');
        aiSelect.className = 'tg-select';
        for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
          const opt = document.createElement('option');
          opt.value = String(n);
          opt.textContent = String(n);
          if (n === AI_COUNT) opt.selected = true;
          aiSelect.appendChild(opt);
        }
        aiSelect.addEventListener('change', () => {
          aiCount = Number(aiSelect.value);
          startRound();
        });
        const pauseBtn = document.createElement('button');
        pauseBtn.textContent = 'Pause';
        pauseBtn.addEventListener('click', () => {
          paused = !paused;
          pauseBtn.textContent = paused ? 'Resume' : 'Pause';
        });
        const spacer = document.createElement('span');
        spacer.className = 'spacer';
        const backBtn = document.createElement('button');
        backBtn.textContent = '← 返回对话';
        backBtn.addEventListener('click', () => { if (onClose) onClose(); });
        bar.append(aiLabel, aiSelect, pauseBtn, spacer, backBtn);
        card.appendChild(bar);

        const help = document.createElement('div');
        help.className = 'tg-help';
        help.textContent = '鼠标 = 车体朝向（炮管固定） · 左键前进 · 右键后退 · Space 开火 · 中键布雷 · P 暂停';
        card.appendChild(host2);
        card.appendChild(help);

        const ctx = canvas.getContext('2d');
        let game = null;
        let paused = false;
        let aiCount = AI_COUNT;
        const startRound = () => {
          game = createGame((Math.random() * 0xFFFFFFFF) >>> 0, aiCount);
          gameRef.current = game;
          paused = false;
          pauseBtn.textContent = 'Pause';
        };

        // Initial round AFTER the top bar exists: startRound touches the
        // pause button's label.
        startRound();

        // Resize with the panel.
        const resize = () => {
          const rect = host2.getBoundingClientRect();
          canvas.width = Math.max(320, Math.floor(rect.width));
          canvas.height = Math.max(240, Math.floor(rect.height));
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(host2);

        // --- input: document-level capture so the shell cannot eat it ---
        const toWorld = (event) => {
          const rect = canvas.getBoundingClientRect();
          const cam = makeCamera(canvas, game);
          return {
            x: (event.clientX - rect.left - cam.ox) / cam.scale,
            y: (event.clientY - rect.top - cam.oy) / cam.scale,
          };
        };
        const onPointerMove = (event) => {
          if (!rectContains(host2, event)) return;
          mouseRef.current = toWorld(event);
        };
        const rectContains = (el2, event) => {
          const r = el2.getBoundingClientRect();
          return event.clientX >= r.left && event.clientX <= r.right
            && event.clientY >= r.top && event.clientY <= r.bottom;
        };
        const onPointerDown = (event) => {
          if (!rectContains(host2, event)) return;
          if (event.button === 0) buttonsRef.current.l = true;
          if (event.button === 2) buttonsRef.current.r = true;
          if (event.button === 1) {
            inputRef.current.mine = true;
            event.preventDefault();
          }
        };
        const onPointerUp = (event) => {
          if (event.button === 0) buttonsRef.current.l = false;
          if (event.button === 2) buttonsRef.current.r = false;
        };
        const onContextMenu = (event) => {
          if (rectContains(host2, event)) event.preventDefault();
        };
        const onKeyDown = (event) => {
          if (event.code === 'KeyP' && rectContains(host2, event)) {
            paused = !paused;
            pauseBtn.textContent = paused ? 'Resume' : 'Pause';
            event.preventDefault();
            return;
          }
          if (event.code === 'Space' && rectContains(host2, event)) {
            inputRef.current.fire = true;
            event.preventDefault();
          }
        };
        const onKeyUp = (event) => {
          if (event.code === 'Space') inputRef.current.fire = false;
        };

        canvas.addEventListener('contextmenu', onContextMenu);
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('keyup', onKeyUp, true);

        // --- fixed-timestep loop ---
        let raf = 0;
        let last = performance.now();
        let acc = 0;
        const STEP = 1 / 60;
        const loop = (now) => {
          raf = requestAnimationFrame(loop);
          const delta = Math.min(0.25, (now - last) / 1000);
          last = now;
          if (paused || game.over !== null) {
            // Freeze the world; keep drawing so the overlay stays visible.
            drawGame(ctx, canvas, game, null, paused);
            return;
          }
          acc += delta;
          while (acc >= STEP) {
            acc -= STEP;
            if (game.over !== null) break;
            // Player intent: aim IS steer — turn the hull at the mouse.
            const player = game.tanks[0];
            const pi = { steer: 0, forward: 0, fire: false, mine: false };
            if (player.alive) {
              if (mouseRef.current) {
                const aim = Math.atan2(mouseRef.current.y - player.y, mouseRef.current.x - player.x);
                const d = aimDiff(aim, player.r);
                pi.steer = Math.abs(d) < 0.02 ? 0 : (d > 0 ? 1 : -1);
              }
              pi.forward = (buttonsRef.current.l ? 1 : 0) + (buttonsRef.current.r ? -1 : 0);
              pi.fire = inputRef.current.fire;
              pi.mine = inputRef.current.mine;
              inputRef.current.mine = false;
            }
            stepGame(game, pi, STEP);
          }
          // Aim marker for the dash line.
          let aimPt = null;
          const playerNow = game.tanks[0];
          if (playerNow.alive && mouseRef.current) {
            const player = playerNow;
            const dx = mouseRef.current.x - player.x, dy = mouseRef.current.y - player.y;
            const len = Math.hypot(dx, dy) || 1;
            aimPt = { x: player.x + (dx / len) * 3, y: player.y + (dy / len) * 3 };
          }
          drawGame(ctx, canvas, game, aimPt);
        };
        raf = requestAnimationFrame(loop);

        // Restart on click when the round is over.
        const onClick = (event) => {
          if (gameRef.current && gameRef.current.over !== null && rectContains(host2, event)) {
            startRound();
          }
        };
        canvas.addEventListener('click', onClick);

        return () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          canvas.removeEventListener('contextmenu', onContextMenu);
          canvas.removeEventListener('click', onClick);
          document.removeEventListener('pointermove', onPointerMove, true);
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('pointerup', onPointerUp, true);
          document.removeEventListener('keydown', onKeyDown, true);
          document.removeEventListener('keyup', onKeyUp, true);
          style.remove();
        };
      }, []);

      return react.createElement('div', { ref: hostRef, className: 'tg-wrap' });
    }

    //#endregion

    //#region registration

    const inject = ['slots', 'layout'];
    function apply(ctx) {
      const layout = ctx.get('layout');
      if (typeof layout?.selectPanel === 'function') {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 6,
          label: '坦克大战',
        }, () => react.createElement(TankIcon)));
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, () => react.createElement(GamePanel, {
          onClose: () => layout.selectPanel?.(null),
        })));
      }
    }

    function TankIcon() {
      return react.createElement('svg', {
        width: 20, height: 20, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
      }, react.createElement('rect', { x: 4, y: 10, width: 13, height: 8, rx: 2 }),
        react.createElement('path', { d: 'M17 14 L22 14' }),
        react.createElement('circle', { cx: 10.5, cy: 14, r: 2.2 }));
    }

    //#endregion

    exports.apply = apply;
    exports.inject = inject;
    // Headless verification hooks.
    exports.__test = {
      generateMaze, buildWalls, createGame, stepGame, bulletPath, bulletPosAt,
      raycastWalls, lineOfSight, bfsPath, findBankShot, aiInput, pushCircle,
      makeRand, cellCentre, aimDiff,
    };
    return module.exports;
  },
});
