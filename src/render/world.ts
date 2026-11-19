import * as THREE from 'three';
import type { MapData } from '../data/types';
import type { ObjectDB } from '../data/objects';
import { CREEP_PLAYER, PLAYER_COLORS, attackColor, type Destructable, type Game, type Missile, type Unit } from '../game/game';
import { TerrainGrid } from './terrain';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Wc3Assets, applyReplaceable, applyTeamColor, instantiate, pickSequence, type ModelAnimations, type SequenceInfo } from './mdx';
import { ParticleSystem } from './particles';
import {
  auraTowerPlaceholder,
  builderPlaceholder,
  buildingPlaceholder,
  creepPlaceholder,
  doodadPlaceholder,
  doodadShape,
  hashColor,
  mat,
  missilePlaceholder,
  ringMesh,
  towerPlaceholder,
} from './placeholders';

interface UnitView {
  root: THREE.Group;
  body: THREE.Object3D;
  hpBg: THREE.Sprite;
  hpFg: THREE.Sprite;
  selection: THREE.Mesh;
  height: number;
  defId: string;
  baseScale: number;
  /** Set once the original MDX model replaced the placeholder. */
  anim: UnitAnim | null;
}

interface UnitAnim {
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  info: ModelAnimations | null;
  /** Logical animation requested by the game ('stand', 'walk', 'attack', 'death', 'birth'). */
  current: string;
  seq: SequenceInfo | null;
  action: THREE.AnimationAction | null;
  lastAnimTime: number;
}

interface MissileView {
  obj: THREE.Group;
  /** Animation state shared with the particle emitters (stand while flying, death at impact). */
  state: { seq: SequenceInfo | null; action: THREE.AnimationAction | null };
  mixer: THREE.AnimationMixer | null;
  info: ModelAnimations | null;
  last: THREE.Vector3 | null;
  owner: number;
}

const tmpV = new THREE.Vector3();

/** Owns all scene objects that mirror the game state. Everything lives in `world` (WC3 Z-up coordinates). */
export class WorldView {
  readonly world = new THREE.Group();
  private units = new Map<number, UnitView>();
  private missiles = new Map<number, MissileView>();
  readonly particles: ParticleSystem;
  private hover: { el: HTMLElement; unit: Unit; bar: HTMLElement } | null = null;
  private effects: { obj: THREE.Object3D; until: number; start: number; kind: 'ring' | 'line' | 'model'; mixer?: THREE.AnimationMixer; game?: boolean }[] = [];
  private destructables = new Map<string, THREE.Group>();
  private spawnPortal: THREE.Object3D[] = [];
  private regionsGroup = new THREE.Group();
  readonly ghost = new THREE.Group();
  private ghostCells: THREE.InstancedMesh;
  private ghostModel: THREE.Object3D | null = null;
  private ghostId = '';
  /** Currently selected units (selection circles). */
  selection = new Set<Unit>();
  /** Health bars above all units – like the game, only while Alt is held. */
  showAllHp = false;
  private hpMatBg = new THREE.SpriteMaterial({ color: 0x000000, depthTest: false });
  private hpMats = [0xff2020, 0xffd020, 0x20ff20].map((c) => new THREE.SpriteMaterial({ color: c, depthTest: false }));
  private floatLayer: HTMLElement;
  private floats: { el: HTMLElement; x: number; y: number; z: number; start: number; life: number }[] = [];
  private clock = 0;

  constructor(
    scene: THREE.Scene,
    private readonly game: Game,
    private readonly map: MapData,
    private readonly db: ObjectDB,
    readonly grid: TerrainGrid,
    private readonly assets: Wc3Assets | null,
    overlayRoot: HTMLElement,
  ) {
    this.world.rotation.x = -Math.PI / 2;
    scene.add(this.world);
    this.world.add(this.regionsGroup);
    this.regionsGroup.visible = false;

    const cellGeo = new THREE.PlaneGeometry(30, 30);
    this.ghostCells = new THREE.InstancedMesh(cellGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }), 16);
    this.ghostCells.renderOrder = 6;
    this.ghost.add(this.ghostCells);
    this.ghost.visible = false;
    this.world.add(this.ghost);

    this.floatLayer = overlayRoot;
    this.particles = new ParticleSystem(this.world);

    game.on('unitAdded', (u) => this.addUnit(u));
    game.on('unitRemoved', (u) => this.removeUnit(u));
    game.on('missileAdded', (m) => this.addMissile(m));
    game.on('effect', (e) => this.ring(e.x, e.y, e.color));
    game.on('lightning', (e) => this.lightning(e.from, e.to, e.color));
    game.on('floatText', (e) => this.floatText(e.text, e.x, e.y, e.color, e.lifespan));
    game.on('doodadAnim', (e) => {
      if (e.id === 'D004') this.spawnPortal.forEach((o) => (o.visible = e.anim === 'birth'));
    });
  }

  // --- static content -------------------------------------------------------------------------

  async buildStatic() {
    this.buildRegions();
    const dynamic = new Set(this.game.cfg.destructables.map((d) => d.id));
    const groups = new Map<string, THREE.Matrix4[]>();
    const keyOf = (id: string, v: number) => `${id}|${v}`;
    for (const d of this.map.doodads) {
      if (dynamic.has(d.id) && this.game.cfg.destructables.some((x) => x.id === d.id && Math.abs(x.x - d.x) < 1 && Math.abs(x.y - d.y) < 1)) continue;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(d.x, d.y, d.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), d.angle),
        new THREE.Vector3(...d.scale),
      );
      const k = keyOf(d.id, d.variation);
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
    for (const [k, matrices] of groups) {
      const [id, v] = k.split('|');
      const variation = Number(v);
      const placeholder = doodadPlaceholder(id, variation);
      const inst = instantiate(placeholder, matrices);
      inst.name = `doodad:${id}`;
      this.world.add(inst);
      if (id === 'D004') this.spawnPortal.push(inst);
      void this.upgradeDoodad(id, variation, matrices, inst);
    }
    for (const d of Object.values(this.game.destructables)) this.addDestructable(d);
  }

  private async upgradeDoodad(id: string, variation: number, matrices: THREE.Matrix4[], placeholder: THREE.Object3D) {
    if (!this.assets) return;
    const info = this.db.doodadModel(id);
    if (!info) return;
    const path = info.numVar > 1 ? `${info.file}${Math.min(variation, info.numVar - 1)}` : info.file;
    let model = (await this.assets.loadModel(path)) ?? (await this.assets.loadModel(info.file));
    if (!model) return;
    if (info.texId && info.texFile) {
      model = model.clone();
      await applyReplaceable(this.assets, model, info.texId, info.texFile);
    }
    const inst = instantiate(model, matrices);
    inst.visible = placeholder.visible;
    this.world.add(inst);
    this.world.remove(placeholder);
    const idx = this.spawnPortal.indexOf(placeholder);
    if (idx >= 0) this.spawnPortal[idx] = inst;
  }

  private addDestructable(d: Destructable) {
    const g = new THREE.Group();
    g.add(doodadPlaceholder(d.id, 0));
    g.position.set(d.x, d.y, this.grid.heightAt(d.x, d.y));
    g.rotation.z = d.angle;
    g.scale.setScalar(d.scale);
    this.world.add(g);
    this.destructables.set(d.variable, g);
    void (async () => {
      if (!this.assets) return;
      const info = this.db.doodadModel(d.id);
      const model = info && (await this.assets.loadModel(info.file));
      if (model) {
        const m = cloneSkinned(model);
        if (info.texId && info.texFile) await applyReplaceable(this.assets!, m, info.texId, info.texFile);
        g.clear();
        g.add(m);
      }
    })();
  }

  private buildRegions() {
    for (const r of this.map.regions) {
      const w = r.maxX - r.minX;
      const h = r.maxY - r.minY;
      const color = new THREE.Color(r.color[0] / 255, r.color[1] / 255, r.color[2] / 255);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, depthTest: false }));
      const cx = (r.minX + r.maxX) / 2;
      const cy = (r.minY + r.maxY) / 2;
      plane.position.set(cx, cy, this.grid.heightAt(cx, cy) + 8);
      plane.renderOrder = 4;
      this.regionsGroup.add(plane);
      const label = makeLabel(r.name, '#' + color.getHexString());
      label.position.set(cx, cy, this.grid.heightAt(cx, cy) + 60);
      this.regionsGroup.add(label);
    }
    // Creep route.
    const pts = this.game.cfg.path.map((n) => {
      const r = this.game.cfg.regions[n];
      const x = (r.minX + r.maxX) / 2;
      const y = (r.minY + r.maxY) / 2;
      return new THREE.Vector3(x, y, this.grid.heightAt(x, y) + 20);
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffff60, depthTest: false }));
    line.renderOrder = 4;
    this.regionsGroup.add(line);
  }

  toggleRegions() {
    this.regionsGroup.visible = !this.regionsGroup.visible;
    return this.regionsGroup.visible;
  }

  // --- units ---------------------------------------------------------------------------------------

  private placeholderFor(u: Unit): { obj: THREE.Object3D; height: number } {
    const d = u.def;
    switch (u.kind) {
      case 'tower': {
        if (!d.attack) return { obj: auraTowerPlaceholder(), height: 230 };
        const tier = Math.min(3, this.towerTier(d.id));
        const roof = new THREE.Color(PLAYER_COLORS[u.owner] ?? '#888').getHex();
        return { obj: towerPlaceholder(d.attack.attackType, roof, tier), height: 250 + tier * 18 };
      }
      case 'builder':
        return { obj: builderPlaceholder(new THREE.Color(PLAYER_COLORS[u.owner]).getHex(), u.flying), height: 70 };
      case 'spawning':
        return { obj: buildingPlaceholder('spawning', new THREE.Color(PLAYER_COLORS[u.owner]).getHex()), height: 240 };
      case 'shop':
        return { obj: buildingPlaceholder('shop', 0x80e0ff), height: 380 };
      case 'creep': {
        const size = 28 + Math.min(40, d.level * 1.6);
        return { obj: creepPlaceholder(hashColor(d.id + d.name), size, u.flying), height: size * 1.8 };
      }
      default:
        return { obj: creepPlaceholder(new THREE.Color(PLAYER_COLORS[u.owner] ?? '#fff').getHex(), 34, u.flying), height: 70 };
    }
  }

  private towerTier(id: string) {
    let tier = 0;
    let cur = id;
    for (let i = 0; i < 6; i++) {
      const parent = Object.keys(this.map.objects.w3u).find((k) => this.db.unit(k).upgradesTo.includes(cur));
      if (!parent) break;
      tier++;
      cur = parent;
    }
    return tier;
  }

  private addUnit(u: Unit) {
    const { obj, height } = this.placeholderFor(u);
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.add(obj);
    root.add(body);
    const sel = ringMesh(Math.max(30, u.def.selectionScale * 36), u.owner === CREEP_PLAYER ? 0xff3030 : 0x30ff30);
    sel.visible = false;
    root.add(sel);
    const hpBg = new THREE.Sprite(this.hpMatBg);
    hpBg.center.set(0.5, 0.5);
    const hpFg = new THREE.Sprite(this.hpMats[2]);
    hpFg.center.set(0, 0.5);
    hpBg.renderOrder = hpFg.renderOrder = 10;
    root.add(hpBg, hpFg);
    const baseScale = 1;
    this.world.add(root);
    const view: UnitView = { root, body, hpBg, hpFg, selection: sel, height, defId: u.def.id, baseScale, anim: null };
    this.units.set(u.uid, view);
    void this.upgradeUnit(u, view);
  }

  private async upgradeUnit(u: Unit, view: UnitView) {
    if (!this.assets || !u.def.model || !this.assets.modelExists(u.def.model)) return;
    const model = await this.assets.loadModel(u.def.model, String(u.def.fields.uani ?? ''));
    if (!model || !this.units.has(u.uid) || view.defId !== u.def.id) return;
    view.body.clear();
    view.body.position.z = 0;
    // SkeletonUtils.clone rebinds the skinned meshes to the cloned bones.
    const m = cloneSkinned(model);
    m.scale.setScalar(u.def.scale);
    applyTeamColor(this.assets, m, u.owner);
    view.body.add(m);
    const h = Number(model.userData.height) || 0;
    view.height = Math.min(600, Math.max(60, (h || 120) * u.def.scale));
    const info = this.assets.animations(model);
    const anim: UnitAnim = { model: m, mixer: info ? new THREE.AnimationMixer(m) : null, info, current: '', seq: null, action: null, lastAnimTime: 0 };
    view.anim = anim;
    if (info) this.particles.attach(m, model, () => (anim.seq && anim.action ? { interval: anim.seq.interval, frame: anim.seq.interval[0] + anim.action.time * 1000 } : null), info.globals);
  }

  /** Plays the unit's current animation with the matching MDX sequence (animation tags from the "uani" field). */
  private playAnimation(u: Unit, a: UnitAnim, name: string) {
    if (!a.mixer || !a.info) return;
    const tags = String(u.def.fields.uani ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seq = pickSequence(a.info.sequences, name, tags) ?? pickSequence(a.info.sequences, 'stand', tags);
    a.current = name;
    if (!seq) return;
    a.mixer.stopAllAction();
    const action = a.mixer.clipAction(seq.clip);
    action.reset();
    const once = name === 'attack' || name === 'death' || name === 'birth' || seq.nonLooping;
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.timeScale = 1;
    if (name === 'walk' && seq.moveSpeed > 0) action.timeScale = Math.max(0.2, (u.speed * (u.slow ? 1 - u.slow.move : 1)) / seq.moveSpeed);
    if (name === 'birth' && u.constructing) action.timeScale = seq.duration / Math.max(0.1, u.constructing.total);
    action.play();
    a.seq = seq;
    a.action = action;
    a.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name in seq.visibility) o.visible = seq.visibility[o.name];
    });
  }

  private updateAnimation(u: Unit, a: UnitAnim, dt: number) {
    if (!a.mixer) return;
    const wanted = !u.alive ? 'death' : u.constructing ? 'birth' : u.anim === 'birth' ? 'stand' : u.anim;
    const restarted = wanted === 'attack' && u.animTime < a.lastAnimTime;
    a.lastAnimTime = u.animTime;
    if (wanted !== a.current || restarted) this.playAnimation(u, a, wanted);
    else if (wanted === 'attack' && a.action && !a.action.isRunning()) {
      // Between attacks the unit idles, the next attack restarts the attack sequence.
      this.playAnimation(u, a, 'stand');
      a.current = 'attack';
    } else if (wanted === 'walk' && a.action && a.seq && a.seq.moveSpeed > 0) {
      a.action.timeScale = Math.max(0.2, (u.speed * (u.slow ? 1 - u.slow.move : 1)) / a.seq.moveSpeed);
    }
    a.mixer.update(dt);
  }

  private removeUnit(u: Unit) {
    const v = this.units.get(u.uid);
    if (!v) return;
    this.world.remove(v.root);
    this.units.delete(u.uid);
  }

  /**
   * Missiles use the weapon's projectile model (ua1m): the "stand" sequence loops while flying, oriented
   * along the flight path; at impact the model plays its "death" sequence (explosion, particles) in place.
   */
  private addMissile(m: Missile) {
    const obj = new THREE.Group();
    obj.rotation.order = 'ZYX';
    obj.position.set(m.x, m.y, this.grid.heightAt(m.x, m.y) + m.z);
    this.world.add(obj);
    const mv: MissileView = { obj, state: { seq: null, action: null }, mixer: null, info: null, last: null, owner: m.source.owner };
    this.missiles.set(m.id, mv);
    const path = m.model.replace(/\.md[lx]$/i, '');
    if (!this.assets || !path || !this.assets.modelExists(path)) {
      obj.add(missilePlaceholder(m.color));
      return;
    }
    void this.assets.loadModel(path).then((model) => {
      if (!model || !obj.parent) return;
      const inst = cloneSkinned(model);
      applyTeamColor(this.assets!, inst, mv.owner);
      obj.add(inst);
      const info = this.assets!.animations(model);
      if (!info) return;
      mv.info = info;
      mv.mixer = new THREE.AnimationMixer(inst);
      this.playMissile(mv, 'stand');
      this.particles.attach(inst, model, () => (mv.state.seq && mv.state.action ? { interval: mv.state.seq.interval, frame: mv.state.seq.interval[0] + mv.state.action.time * 1000 } : null), info.globals);
    });
  }

  private playMissile(mv: MissileView, name: 'stand' | 'death') {
    if (!mv.mixer || !mv.info) return null;
    const seq = pickSequence(mv.info.sequences, name) ?? (name === 'stand' ? mv.info.sequences.find((q) => !q.words.includes('death')) : undefined);
    if (!seq) return null;
    mv.mixer.stopAllAction();
    const action = mv.mixer.clipAction(seq.clip);
    action.reset();
    action.setLoop(name === 'death' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = name === 'death';
    action.play();
    mv.state.seq = seq;
    mv.state.action = action;
    mv.obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name in seq.visibility) o.visible = seq.visibility[o.name];
    });
    return seq;
  }

  /**
   * Order confirmation like WC3 (UI\\war3skins.txt): TargetPointConfirm = Confirmation.mdl (three curved arrows
   * converging on the clicked point), TargetUnitConfirm = Target.mdl on a targeted unit. The models are white,
   * the engine tints them – green for move, red for attack. Without game assets a shrinking ring stands in.
   */
  orderConfirmation(x: number, y: number, kind: 'move' | 'attack' = 'move', onUnit = false) {
    const z = this.grid.heightAt(x, y) + 2;
    const tint = kind === 'attack' ? 0xff2020 : 0x20ff20;
    const path = onUnit ? 'UI\\Feedback\\Target\\Target' : 'UI\\Feedback\\Confirmation\\Confirmation';
    if (!this.assets?.modelExists(path)) {
      const r = ringMesh(70, kind === 'attack' ? 0xff3030 : 0x30ff30, 0.9, 10);
      r.position.set(x, y, z + 4);
      this.world.add(r);
      this.effects.push({ obj: r, start: this.clock, until: this.clock + 0.5, kind: 'ring' });
      return;
    }
    const start = this.clock;
    void this.assets.loadModel(path).then((model) => {
      if (!model) return;
      const m = cloneSkinned(model);
      m.position.set(x, y, z);
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.renderOrder = 6;
        mesh.material = (mesh.material as THREE.MeshBasicMaterial).clone();
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(tint);
      });
      const anims = this.assets!.animations(model);
      const seq = anims?.sequences[0];
      let mixer: THREE.AnimationMixer | undefined;
      if (seq) {
        mixer = new THREE.AnimationMixer(m);
        const action = mixer.clipAction(seq.clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        mixer.update(this.clock - start);
      }
      this.world.add(m);
      const life = Number(model.userData.lifetime) || 1;
      this.effects.push({ obj: m, start, until: start + life, kind: 'model', mixer });
    });
  }

  private ring(x: number, y: number, color: number) {
    const r = ringMesh(60, color, 0.9, 14);
    r.position.set(x, y, this.grid.heightAt(x, y) + 10);
    this.world.add(r);
    this.effects.push({ obj: r, start: this.clock, until: this.clock + 0.8, kind: 'ring' });
  }

  private lightning(from: Unit, to: Unit, color: number) {
    const a = new THREE.Vector3(from.x, from.y, this.grid.heightAt(from.x, from.y) + Number(from.def.fields.ulpz ?? 150));
    const b = new THREE.Vector3(to.x, to.y, this.grid.heightAt(to.x, to.y) + to.fly + 40);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const p = a.clone().lerp(b, i / 8);
      if (i > 0 && i < 8) p.add(new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30));
      pts.push(p);
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true }));
    this.world.add(line);
    this.effects.push({ obj: line, start: this.clock, until: this.clock + 0.25, kind: 'line' });
  }

  floatText(text: string, x: number, y: number, color: string, life: number) {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.color = color;
    this.floatLayer.appendChild(el);
    this.floats.push({ el, x, y, z: this.grid.heightAt(x, y) + 100, start: this.clock, life });
  }

  // --- placement ghost -------------------------------------------------------------------------------

  showGhost(id: string | null, x = 0, y = 0) {
    if (!id) {
      this.ghost.visible = false;
      return;
    }
    if (id !== this.ghostId) {
      if (this.ghostModel) this.ghost.remove(this.ghostModel);
      const def = this.db.unit(id);
      const obj = def.attack ? towerPlaceholder(def.attack.attackType, 0x40ff40, 0) : auraTowerPlaceholder();
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = mat(0x60ff60, { opacity: 0.45 });
      });
      this.ghostModel = obj;
      this.ghost.add(obj);
      this.ghostId = id;
    }
    const [sx, sy] = this.game.grid.snap(x, y, 4);
    this.ghost.visible = true;
    this.ghostModel!.position.set(sx, sy, this.grid.heightAt(sx, sy));
    const cells = this.game.grid.footprintCells(sx, sy, 4);
    const m = new THREE.Matrix4();
    cells.forEach((c, i) => {
      const [wx, wy] = this.game.grid.center(c.cx, c.cy);
      m.makeTranslation(wx, wy, this.grid.heightAt(wx, wy) + 4);
      this.ghostCells.setMatrixAt(i, m);
      this.ghostCells.setColorAt(i, new THREE.Color(c.ok ? 0x30ff30 : 0xff3030));
    });
    this.ghostCells.instanceMatrix.needsUpdate = true;
    if (this.ghostCells.instanceColor) this.ghostCells.instanceColor.needsUpdate = true;
    return cells.every((c) => c.ok);
  }

  // --- per frame ---------------------------------------------------------------------------------------

  update(dt: number, camera: THREE.Camera, width: number, height: number) {
    this.clock += dt;
    const g = this.game;
    for (const u of g.units) {
      const v = this.units.get(u.uid);
      if (!v) continue;
      if (v.defId !== u.def.id) {
        // Upgrade / morph finished – rebuild visuals.
        this.removeUnit(u);
        this.addUnit(u);
        continue;
      }
      const ground = this.grid.heightAt(u.x, u.y);
      v.root.visible = !u.hidden;
      v.root.position.set(u.x, u.y, ground + u.fly);
      v.body.rotation.z = u.kind === 'tower' || u.kind === 'spawning' || u.kind === 'shop' ? v.body.rotation.z : u.facing;
      let s = 1;
      let opacity = 1;
      if (v.anim) {
        this.updateAnimation(u, v.anim, g.paused ? 0 : dt * g.speed);
        if (!u.alive) opacity = 1 - Math.min(1, Math.max(0, (g.time - u.removeAt - 0.6) / 0.9));
      } else if (!u.alive) {
        const t = Math.min(1, (g.time - u.removeAt) / 1.2);
        s = 1 - t * 0.6;
        v.body.position.z = -t * 40;
        opacity = 1 - t;
      } else if (u.constructing) {
        s = 0.3 + 0.7 * (u.constructing.elapsed / u.constructing.total);
      } else if (u.anim === 'walk') {
        v.body.position.z = Math.abs(Math.sin(this.clock * 10 + u.uid)) * 4 + (u.flying ? Math.sin(this.clock * 3 + u.uid) * 10 : 0);
      } else {
        v.body.position.z = u.flying ? Math.sin(this.clock * 3 + u.uid) * 10 : 0;
      }
      v.body.scale.setScalar(s * v.baseScale);
      const stealth = u.invisible && u.owner === CREEP_PLAYER;
      if (stealth || opacity < 1) {
        v.body.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !(m.userData.fadeMat)) {
            m.userData.fadeMat = true;
            m.material = (m.material as THREE.Material).clone();
            (m.material as THREE.Material).transparent = true;
          }
          if (m.isMesh) (m.material as THREE.MeshLambertMaterial).opacity = (stealth ? 0.4 : 1) * opacity;
        });
      }
      v.selection.visible = this.selection.has(u) && u.alive;
      v.selection.position.z = 4 - u.fly;
      const showHp = u.alive && !u.hidden && (this.showAllHp || !!u.constructing || !!u.upgrading);
      v.hpBg.visible = v.hpFg.visible = showHp;
      if (showHp) {
        const w = Math.max(50, u.def.selectionScale * 40);
        const ratio = Math.max(0, u.hp / u.maxHp);
        const progress = u.constructing ? u.constructing.elapsed / u.constructing.total : u.upgrading ? u.upgrading.elapsed / u.upgrading.total : null;
        const fill = progress ?? ratio;
        v.hpBg.scale.set(w + 4, 9, 1);
        v.hpFg.scale.set(w * fill, 6, 1);
        v.hpBg.position.set(0, 0, v.height + 20);
        // Sprites face the camera; the camera never yaws, so camera-right is world +X.
        v.hpFg.position.copy(v.hpBg.position);
        v.hpFg.center.set(0, 0.5);
        v.hpFg.position.x -= w / 2;
        v.hpFg.material = progress !== null ? this.hpMats[1] : this.hpMats[ratio > 0.66 ? 2 : ratio > 0.33 ? 1 : 0];
      }
    }
    const gdt = g.paused ? 0 : dt * g.speed;
    for (const [id, mv] of this.missiles) {
      const m = g.missiles.find((x) => x.id === id);
      if (!m) {
        // Impact: the projectile model's death sequence plays where it hit.
        this.missiles.delete(id);
        const seq = this.playMissile(mv, 'death');
        if (seq && mv.mixer) {
          this.effects.push({ obj: mv.obj, start: this.clock, until: this.clock + Math.min(4, Math.max(0.2, seq.duration)), kind: 'model', mixer: mv.mixer, game: true });
        } else this.world.remove(mv.obj);
        continue;
      }
      const p = tmpV.set(m.x, m.y, this.grid.heightAt(m.x, m.y) + m.z);
      if (mv.last && p.distanceToSquared(mv.last) > 0.01) {
        const dx = p.x - mv.last.x;
        const dy = p.y - mv.last.y;
        mv.obj.rotation.set(0, -Math.atan2(p.z - mv.last.z, Math.hypot(dx, dy)), Math.atan2(dy, dx));
      } else if (!mv.last) mv.obj.rotation.set(0, 0, Math.atan2(m.ty - m.y, m.tx - m.x));
      mv.obj.position.copy(p);
      (mv.last ??= new THREE.Vector3()).copy(p);
      mv.mixer?.update(gdt);
    }
    this.effects = this.effects.filter((e) => {
      const t = (this.clock - e.start) / (e.until - e.start);
      if (t >= 1) {
        this.world.remove(e.obj);
        return false;
      }
      if (e.kind === 'model') {
        e.mixer?.update(e.game ? gdt : dt);
        return true;
      }
      if (e.kind === 'ring') e.obj.scale.setScalar(1 + t * 1.5);
      const m = (e.obj as THREE.Mesh).material as THREE.Material;
      m.opacity = 1 - t;
      return true;
    });
    for (const [variable, obj] of this.destructables) {
      const d = g.destructables[variable];
      if (d.id === 'ZTg1') obj.position.z = THREE.MathUtils.lerp(obj.position.z, this.grid.heightAt(d.x, d.y) - (d.open ? 170 : 0), Math.min(1, dt * 4));
      else if (!d.alive) obj.scale.set(d.scale, d.scale, Math.max(0.15, obj.scale.z - dt * 2));
      else obj.scale.setScalar(d.scale);
    }
    this.particles.update(gdt, camera);
    this.updateHover(camera, width, height);
    // Float texts (CreateTextTag: velocity 64 upward, fading).
    this.floats = this.floats.filter((f) => {
      const t = this.clock - f.start;
      if (t > f.life) {
        f.el.remove();
        return false;
      }
      const p = this.world.localToWorld(tmpV.set(f.x, f.y, f.z + t * 64)).project(camera);
      f.el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, (f.life - t) / Math.max(0.3, f.life * 0.5)));
      return true;
    });
  }

  /**
   * Mouse-over label like WC3: the owner's name in a gold-bordered box with the unit's health bar below,
   * floating above the unit under the cursor.
   */
  setHover(u: Unit | null, ownerName: (u: Unit) => { name: string; color: string }) {
    if (this.hover?.unit === u) return;
    this.hover?.el.remove();
    this.hover = null;
    if (!u) return;
    const el = document.createElement('div');
    el.className = 'hover-label';
    const o = ownerName(u);
    const name = document.createElement('div');
    name.className = 'hover-name';
    name.textContent = o.name;
    name.style.color = o.color;
    const bar = document.createElement('div');
    bar.className = 'hover-hp';
    bar.appendChild(document.createElement('div'));
    el.append(name, bar);
    this.floatLayer.appendChild(el);
    this.hover = { el, unit: u, bar };
  }

  private updateHover(camera: THREE.Camera, width: number, height: number) {
    const h = this.hover;
    if (!h) return;
    const u = h.unit;
    const v = this.units.get(u.uid);
    if (!v || !u.alive || u.hidden) {
      this.setHover(null, () => ({ name: '', color: '' }));
      return;
    }
    const p = this.world.localToWorld(tmpV.set(u.x, u.y, this.grid.heightAt(u.x, u.y) + u.fly + v.height + 40)).project(camera);
    h.el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
    const ratio = Math.max(0, u.hp / u.maxHp);
    const fill = h.bar.firstChild as HTMLElement;
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    fill.style.background = ratio > 0.66 ? '#20e020' : ratio > 0.33 ? '#e0d020' : '#e02020';
    h.bar.hidden = u.def.abilities.includes('Avul');
  }

  /** Units whose projected position (body centre) lies inside a screen rectangle. */
  unitsInRect(x0: number, y0: number, x1: number, y1: number, camera: THREE.Camera, width: number, height: number): Unit[] {
    const [minX, maxX] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [minY, maxY] = [Math.min(y0, y1), Math.max(y0, y1)];
    const out: Unit[] = [];
    for (const u of this.game.units) {
      if (!u.alive || u.hidden) continue;
      const v = this.units.get(u.uid);
      if (!v) continue;
      const p = this.world.localToWorld(tmpV.set(u.x, u.y, this.grid.heightAt(u.x, u.y) + u.fly + v.height * 0.3)).project(camera);
      if (p.z > 1) continue;
      const sx = ((p.x + 1) / 2) * width;
      const sy = ((1 - p.y) / 2) * height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) out.push(u);
    }
    return out;
  }

  /** Screen-space picking of the unit under the cursor. */
  pick(mx: number, my: number, camera: THREE.Camera, width: number, height: number): Unit | null {
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of this.game.units) {
      if (!u.alive || u.hidden) continue;
      const v = this.units.get(u.uid);
      if (!v) continue;
      // Distance from the cursor to the unit's projected body (feet → head), like clicking anywhere on the model.
      const z0 = this.grid.heightAt(u.x, u.y) + u.fly;
      const a = this.world.localToWorld(tmpV.set(u.x, u.y, z0)).project(camera);
      if (a.z > 1) continue;
      const ax = ((a.x + 1) / 2) * width;
      const ay = ((1 - a.y) / 2) * height;
      const b = this.world.localToWorld(tmpV.set(u.x, u.y, z0 + v.height * 0.85)).project(camera);
      const bx = ((b.x + 1) / 2) * width;
      const by = ((1 - b.y) / 2) * height;
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((mx - ax) * (bx - ax) + (my - ay) * (by - ay)) / len2)) : 0;
      const r = Math.max(18, u.def.selectionScale * 24);
      const d = Math.hypot(ax + (bx - ax) * t - mx, ay + (by - ay) * t - my);
      if (d < r && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }
}

function makeLabel(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, 256, 48);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(200, 38, 1);
  s.renderOrder = 7;
  return s;
}

export { attackColor, doodadShape };
