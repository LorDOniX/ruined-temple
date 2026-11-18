/** Pathing on the war3map.wpm grid (32x32 world units per cell, 4x4 cells per tile). */
export const CELL = 32;
export const NO_WALK = 0x02;
export const NO_FLY = 0x04;
export const NO_BUILD = 0x08;

export class PathingGrid {
  readonly flags: Uint8Array;
  /** Dynamic occupancy (buildings, destructables): 1 = blocks walking and building. */
  readonly occupied: Uint8Array;

  constructor(readonly width: number, readonly height: number, data: Uint8Array, readonly ox: number, readonly oy: number) {
    this.flags = new Uint8Array(data);
    this.occupied = new Uint8Array(width * height);
  }

  cellOf(x: number, y: number): [number, number] {
    return [Math.floor((x - this.ox) / CELL), Math.floor((y - this.oy) / CELL)];
  }

  center(cx: number, cy: number): [number, number] {
    return [this.ox + (cx + 0.5) * CELL, this.oy + (cy + 0.5) * CELL];
  }

  inside(cx: number, cy: number) {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height;
  }

  walkable(cx: number, cy: number) {
    if (!this.inside(cx, cy)) return false;
    const i = cy * this.width + cx;
    return !(this.flags[i] & NO_WALK) && !this.occupied[i];
  }

  buildable(cx: number, cy: number) {
    if (!this.inside(cx, cy)) return false;
    const i = cy * this.width + cx;
    return !(this.flags[i] & (NO_WALK | NO_BUILD)) && !this.occupied[i];
  }

  /** Marks a square footprint (in cells) centred on a world position. */
  setFootprint(x: number, y: number, sizeCells: number, value: 0 | 1) {
    const [x0, y0] = this.footprintOrigin(x, y, sizeCells);
    for (let dy = 0; dy < sizeCells; dy++) {
      for (let dx = 0; dx < sizeCells; dx++) {
        const cx = x0 + dx;
        const cy = y0 + dy;
        if (this.inside(cx, cy)) this.occupied[cy * this.width + cx] = value;
      }
    }
  }

  footprintOrigin(x: number, y: number, sizeCells: number): [number, number] {
    return [Math.round((x - this.ox) / CELL - sizeCells / 2), Math.round((y - this.oy) / CELL - sizeCells / 2)];
  }

  /** Snaps a building centre so its footprint lies on cell boundaries. */
  snap(x: number, y: number, sizeCells: number): [number, number] {
    const half = (sizeCells % 2) * 0.5;
    return [this.ox + (Math.round((x - this.ox) / CELL - half) + half) * CELL, this.oy + (Math.round((y - this.oy) / CELL - half) + half) * CELL];
  }

  footprintCells(x: number, y: number, sizeCells: number) {
    const [x0, y0] = this.footprintOrigin(x, y, sizeCells);
    const cells: { cx: number; cy: number; ok: boolean }[] = [];
    for (let dy = 0; dy < sizeCells; dy++) for (let dx = 0; dx < sizeCells; dx++) cells.push({ cx: x0 + dx, cy: y0 + dy, ok: this.buildable(x0 + dx, y0 + dy) });
    return cells;
  }

  canBuild(x: number, y: number, sizeCells: number) {
    return this.footprintCells(x, y, sizeCells).every((c) => c.ok);
  }

  nearestWalkable(cx: number, cy: number): [number, number] | null {
    if (this.walkable(cx, cy)) return [cx, cy];
    for (let r = 1; r < 24; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.walkable(cx + dx, cy + dy)) return [cx + dx, cy + dy];
        }
      }
    }
    return null;
  }

  /** 8-connected A*; returns world-space waypoints (smoothed) or null. */
  findPath(sx: number, sy: number, tx: number, ty: number): [number, number][] | null {
    const start = this.nearestWalkable(...this.cellOf(sx, sy));
    const goal = this.nearestWalkable(...this.cellOf(tx, ty));
    if (!start || !goal) return null;
    const W = this.width;
    const N = W * this.height;
    const g = new Float32Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const si = start[1] * W + start[0];
    const gi = goal[1] * W + goal[0];
    const h = (i: number) => {
      const dx = Math.abs((i % W) - goal[0]);
      const dy = Math.abs(Math.floor(i / W) - goal[1]);
      return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
    };
    g[si] = 0;
    heap.push(si, h(si));
    let iterations = 0;
    while (heap.size && iterations++ < 200000) {
      const cur = heap.pop();
      if (cur === gi) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W;
      const cy = (cur / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.walkable(nx, ny)) continue;
          if (dx && dy && (!this.walkable(cx + dx, cy) || !this.walkable(cx, cy + dy))) continue;
          const ni = ny * W + nx;
          const cost = g[cur] + (dx && dy ? 1.4142 : 1);
          if (cost < g[ni]) {
            g[ni] = cost;
            from[ni] = cur;
            heap.push(ni, cost + h(ni));
          }
        }
      }
    }
    if (from[gi] === -1 && gi !== si) return null;
    const cells: number[] = [];
    for (let c = gi; c !== -1; c = from[c]) cells.push(c);
    cells.reverse();
    // Line-of-sight smoothing.
    const pts: [number, number][] = [];
    let anchor = 0;
    for (let i = 1; i < cells.length; i++) {
      if (!this.lineWalkable(cells[anchor], cells[i])) {
        pts.push(this.center(cells[i - 1] % W, (cells[i - 1] / W) | 0));
        anchor = i - 1;
      }
    }
    pts.push([tx, ty]);
    return pts;
  }

  private lineWalkable(a: number, b: number) {
    const W = this.width;
    let x0 = a % W;
    let y0 = (a / W) | 0;
    const x1 = b % W;
    const y1 = (b / W) | 0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (!this.walkable(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
