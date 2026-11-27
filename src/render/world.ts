import * as THREE from 'three';
import type { AssetCatalog, MapData } from '../data/types';
import type { ObjectDB } from '../data/objects';
import { CREEP_PLAYER, PLAYER_COLORS, attackColor, type Destructable, type Game, type Missile, type Unit } from '../game/game';
import { TerrainGrid } from './terrain';
import { MaterialAnimator, Wc3Assets, cloneModel, sequenceVariants, startGlobalClips, applyReplaceable, applyTeamColor, instantiate, pickSequence, type ModelAnimations, type SequenceInfo } from './mdx';
import { ParticleSystem, type ModelEvent, type ModelParticle } from './particles';
import { DecalLayer, type Decal } from './decals';
import type { LoopHandle, SoundPlayer } from '../sound';
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
  /** Selection circle (ReplaceableTextures\Selection) and blob shadow on the ground (null without game assets). */
  circle: Decal | null;
  shadow: Decal | null;
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
  /** The current idle animation has random variants (re-picked whenever one ends). */
  variants?: boolean;
  /** Animation time not yet applied while the unit is off screen (animation LOD). */
  pending?: number;
  /** Meshes of the model; off screen they leave the camera layer so three.js skips their skeleton update too. */
  meshes?: THREE.Mesh[];
}

interface MissileView {
  obj: THREE.Group;
  /** The model's short "birth" sequence (launch sound) plays first, then "stand" while flying. */
  phase: 'birth' | 'stand' | 'death';
  /** Animation state shared with the particle emitters (stand while flying, death at impact). */
  state: { seq: SequenceInfo | null; action: THREE.AnimationAction | null };
  mixer: THREE.AnimationMixer | null;
  info: ModelAnimations | null;
  last: THREE.Vector3 | null;
  owner: number;
}

interface AnimatedProp {
  mixer: THREE.AnimationMixer;
  info: ModelAnimations;
  root: THREE.Object3D;
  seq: SequenceInfo | null;
  action: THREE.AnimationAction | null;
  current: string;
}

const tmpV = new THREE.Vector3();

/** Owns all scene objects that mirror the game state. Everything lives in `world` (WC3 Z-up coordinates). */
export class WorldView {
  readonly world = new THREE.Group();
  private units = new Map<number, UnitView>();
  private missiles = new Map<number, MissileView>();
  readonly particles: ParticleSystem;
  /** Animated material layers (water flipbooks, scrolling textures, alpha) of all model instances. */
  readonly matAnim = new MaterialAnimator();
  /** Splats, ubersplats, shadows and selection circles (only with game assets). */
  readonly decals: DecalLayer | null;
  /** Sounds of model event objects (SND) and weapon impacts. */
  sound: SoundPlayer | null = null;
  /** Ubersplats under buildings (unit field "uubs"), faded out once the building is gone. */
  private uberSplats = new Map<number, { unit: Unit; release: () => void }>();
  private hover: { el: HTMLElement; unit: Unit; bar: HTMLElement } | null = null;
  private effects: { obj: THREE.Object3D; until: number; start: number; kind: 'ring' | 'line' | 'model'; mixer?: THREE.AnimationMixer; game?: boolean }[] = [];
  private destructables = new Map<string, THREE.Group>();
  private destructableProps = new Map<string, AnimatedProp>();
  /** Animated doodads and destructables. */
  private props: AnimatedProp[] = [];
  private bolts: { mesh: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3; segs: number; def: NonNullable<AssetCatalog['lightnings']>[string]; start: number; life: number; jitter: number[][]; nextJitter: number; linkId?: number; follow?: { from: Unit; to: Unit } }[] = [];
  /** Buff art attached to unit models, by unit and buff id. */
  private buffArts = new Map<number, Map<string, THREE.Object3D[]>>();
  private spawnPortal: THREE.Object3D[] = [];
  private regionsGroup = new THREE.Group();
  readonly ghost = new THREE.Group();
  private ghostCells: THREE.InstancedMesh;
  private ghostModel: THREE.Object3D | null = null;
  private ghostId = '';
  private planned = new Map<string, THREE.Object3D>();
  /** Player whose planned buildings are shown. */
  localPlayer = 0;
  /** Currently selected units (selection circles). */
  selection = new Set<Unit>();
  /** Blob shadows under units (video option). */
  showShadows = true;
  /** Health bars above all units – like the game, only while Alt is held. */
  showAllHp = false;
  private hpMatBg = new THREE.SpriteMaterial({ color: 0x000000, depthTest: false });
  private hpMats = [0xff2020, 0xffd020, 0x20ff20].map((c) => new THREE.SpriteMaterial({ color: c, depthTest: false }));
  private floatLayer: HTMLElement;
  private floats: { el: HTMLElement; x: number; y: number; z: number; start: number; life: number }[] = [];
  private clock = 0;
  /** Game time seen by the renderer (stops while paused, follows the game speed). */
  private gclock = 0;

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
    // Static: without auto update three.js no longer forces a matrix update of every object below each frame,
    // so units off screen can skip theirs (animation LOD).
    this.world.updateMatrix();
    this.world.matrixAutoUpdate = false;
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
    this.particles.onEvent = (e) => this.modelEvent(e);
    this.particles.modelParticle = (path) => this.modelParticle(path);
    this.decals = assets?.catalog.ui ? new DecalLayer(this.world, (x, y) => this.grid.heightAt(x, y), (p) => assets.loadTexture(p)) : null;

    game.on('unitAdded', (u) => this.addUnit(u));
    game.on('unitRemoved', (u) => this.removeUnit(u));
    game.on('missileAdded', (m) => this.addMissile(m));
    game.on('effect', (e) => {
      const path = e.model.replace(/\.md[lx]$/i, '');
      if (this.assets?.modelExists(path)) this.spawnModel(path, e.x, e.y, this.grid.heightAt(e.x, e.y), 0);
      else this.ring(e.x, e.y, e.color);
    });
    game.on('buff', (e) => this.buffArt(e.unit, e.id, e.on));
    game.on('spellArt', (e) => {
      const storm = e.unit ? 0 : (e.duration ?? 20);
      // Looping effect sounds (Effectsoundlooped, e.g. MonsoonLoop) run for the spell's duration.
      if (e.sound && storm > 0 && this.sound?.isLooping(e.sound)) this.addLoop(this.sound.playLoop(e.sound, { x: e.x, y: e.y }), { until: this.gclock + storm });
      else if (e.sound) this.sound?.playLabel(e.sound, { x: e.x, y: e.y });
      const path = e.model.replace(/\.md[lx]$/i, '');
      if (!path) return;
      this.spawnModel(path, e.x, e.y, this.grid.heightAt(e.x, e.y) + (e.unit?.fly ?? 0), 0, 'birth', storm);
    });
    game.on('link', (e) => {
      this.link(e.id, e.from, e.to, e.lightning, e.until);
      // A link replaces / ends the previous one of the caster, with its channel loop (SiphonManaLoop).
      this.stopLoops((l) => l.linkId === e.id);
      if (e.lightning && e.sound) this.addLoop(this.sound?.playLoop(e.sound, { x: e.from.x, y: e.from.y }) ?? null, { linkId: e.id, until: this.gclock + Math.max(0.1, e.until - this.game.time) });
    });
    game.on('lightning', (e) => this.lightning(e.from, e.to, e.color, e.model));
    game.on('floatText', (e) => this.floatText(e.text, e.x, e.y, e.color, e.lifespan));
    game.on('combatHit', (e) => this.sound?.playLabel(`${e.weaponSound}${e.armor}`, { x: e.x, y: e.y }));
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
  }

  /** Gates, portcullises and the portal – they exist once the game has started (Game.start creates them). */
  buildDestructables() {
    for (const d of Object.values(this.game.destructables)) if (!this.destructables.has(d.variable)) this.addDestructable(d);
  }

  private async upgradeDoodad(id: string, variation: number, matrices: THREE.Matrix4[], placeholder: THREE.Object3D) {
    if (!this.assets) return;
    const info = this.db.doodadModel(id);
    if (!info) return;
    const path = info.numVar > 1 ? `${info.file}${Math.min(variation, info.numVar - 1)}` : info.file;
    const template = (await this.assets.loadModel(path)) ?? (await this.assets.loadModel(info.file));
    if (!template) return;
    let model = template;
    if (info.texId && info.texFile) {
      model = cloneModel(model, false);
      await applyReplaceable(this.assets, model, info.texId, info.texFile);
    }
    let inst: THREE.Object3D;
    if (this.isAnimated(template)) {
      // Moving parts / emitters (fires, smoke, flies, totems): individual animated copies with a random phase.
      inst = new THREE.Group();
      for (const mtx of matrices) {
        const c = cloneModel(model);
        c.applyMatrix4(mtx);
        inst.add(c);
        this.animatedProp(template, c, true);
      }
    } else {
      inst = instantiate(model, matrices);
      this.matAnim.register(inst, null, model.userData.globals ?? []);
    }
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
        const m = cloneModel(model);
        if (info.texId && info.texFile) await applyReplaceable(this.assets!, m, info.texId, info.texFile);
        g.clear();
        g.add(m);
        const p = this.animatedProp(model, m, false);
        if (p) this.destructableProps.set(d.variable, p);
        else this.matAnim.register(m, null, model.userData.globals ?? []);
      }
    })();
  }

  /** Whether a doodad model moves in its stand sequence or carries emitters / ribbons / event objects. */
  private isAnimated(template: THREE.Object3D) {
    const u = template.userData;
    if ((u.emitters2?.length ?? 0) + (u.ribbons?.length ?? 0) + (u.events?.length ?? 0) > 0) return true;
    const info = this.assets?.animations(template);
    const seq = info && pickSequence(info.sequences, 'stand');
    if (!seq) return false;
    return seq.clip.tracks.some((t) => {
      const n = t.getValueSize();
      for (let i = n; i < t.values.length; i++) if (Math.abs(t.values[i] - t.values[i % n]) > 1e-3) return true;
      return false;
    });
  }

  /** Animated doodad / destructable: own mixer (looping stand), particle emitters, events, material animations. */
  private animatedProp(template: THREE.Object3D, root: THREE.Object3D, randomPhase: boolean): AnimatedProp | null {
    const info = this.assets?.animations(template);
    if (!info) return null;
    const p: AnimatedProp = { mixer: new THREE.AnimationMixer(root), info, root, seq: null, action: null, current: '' };
    this.playProp(p, 'stand');
    if (randomPhase && p.action && p.seq) p.action.time = Math.random() * p.seq.duration;
    const frame = () => (p.seq && p.action ? { interval: p.seq.interval, frame: p.seq.interval[0] + p.action.time * 1000 } : null);
    this.particles.attach(root, template, frame, info.globals);
    this.matAnim.register(root, frame, template.userData.globals ?? []);
    this.props.push(p);
    return p;
  }

  private playProp(p: AnimatedProp, name: string) {
    const seq = pickSequence(p.info.sequences, name) ?? (name === 'stand' ? p.info.sequences[0] : undefined);
    p.current = name;
    if (!seq) return false;
    p.mixer.stopAllAction();
    startGlobalClips(p.mixer, p.info);
    const action = p.mixer.clipAction(seq.clip);
    action.reset();
    const once = name !== 'stand';
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.play();
    p.seq = seq;
    p.action = action;
    p.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name in seq.visibility) o.visible = seq.visibility[o.name];
    });
    return true;
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
    // Particle emitters of units use the bone matrices of the last rendered frame (see ParticleSystem.update).
    root.userData.lagOk = true;
    const body = new THREE.Group();
    body.add(obj);
    root.add(body);
    const sel = ringMesh(Math.max(30, u.def.selectionScale * 36), u.owner === CREEP_PLAYER ? 0xff3030 : 0x30ff30);
    sel.visible = false;
    if (!this.decals) root.add(sel);
    const { circle, shadow } = this.groundDecals(u);
    const hpBg = new THREE.Sprite(this.hpMatBg);
    hpBg.center.set(0.5, 0.5);
    const hpFg = new THREE.Sprite(this.hpMats[2]);
    hpFg.center.set(0, 0.5);
    hpBg.renderOrder = hpFg.renderOrder = 10;
    root.add(hpBg, hpFg);
    const baseScale = 1;
    this.world.add(root);
    const view: UnitView = { root, body, hpBg, hpFg, selection: sel, circle, shadow, height, defId: this.visualDef(u).id, baseScale, anim: null };
    this.units.set(u.uid, view);
    void this.upgradeUnit(u, view);
  }

  /**
   * The definition whose model is shown: while a building upgrades, the engine already shows the new building's
   * model playing its "Birth Upgrade …" sequence along with the upgrade progress (scaffolding growing).
   */
  private visualDef(u: Unit) {
    return u.upgrading && u.alive ? this.db.unit(u.upgrading.to) : u.def;
  }

  private async upgradeUnit(u: Unit, view: UnitView) {
    const def = this.visualDef(u);
    if (!this.assets || !def.model || !this.assets.modelExists(def.model)) return;
    const model = await this.assets.loadModel(def.model, String(def.fields.uani ?? ''));
    if (!model || !this.units.has(u.uid) || view.defId !== def.id || this.visualDef(u).id !== def.id) return;
    view.body.clear();
    view.body.position.z = 0;
    // SkeletonUtils.clone rebinds the skinned meshes to the cloned bones.
    const m = cloneModel(model);
    m.scale.setScalar(def.scale);
    applyTeamColor(this.assets, m, this.colorOf(u.owner));
    view.body.add(m);
    const h = Number(model.userData.height) || 0;
    view.height = Math.min(600, Math.max(60, (h || 120) * def.scale));
    const info = this.assets.animations(model);
    const anim: UnitAnim = { model: m, mixer: info ? new THREE.AnimationMixer(m) : null, info, current: '', seq: null, action: null, lastAnimTime: 0 };
    view.anim = anim;
    const frame = () => (anim.seq && anim.action ? { interval: anim.seq.interval, frame: anim.seq.interval[0] + anim.action.time * 1000 } : null);
    if (info) this.particles.attach(m, model, frame, info.globals);
    this.matAnim.register(m, frame, model.userData.globals ?? []);
    // Art of the model's abilities and of buffs it already has (the model may load after the buff was applied).
    this.permanentArt(u);
    this.buffArts.delete(u.uid);
    for (const id of Object.keys(u.buffs)) this.buffArt(u, id, true);
  }

  /** Plays the unit's current animation with the matching MDX sequence (animation tags from the "uani" field). */
  private playAnimation(u: Unit, a: UnitAnim, name: string) {
    if (!a.mixer || !a.info) return;
    const tags = String(this.visualDef(u).fields.uani ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seq = pickSequence(a.info.sequences, name, tags) ?? pickSequence(a.info.sequences, 'stand', tags);
    a.current = name;
    if (!seq) return;
    a.mixer.stopAllAction();
    startGlobalClips(a.mixer, a.info);
    const action = a.mixer.clipAction(seq.clip);
    action.reset();
    const once = name === 'attack' || name === 'death' || name === 'birth' || name === 'spell' || seq.nonLooping;
    // Idle animations with several variants play one at a time and pick the next variant when it ends.
    a.variants = !once && (name === 'stand' || name === 'work') && sequenceVariants(a.info.sequences, name, tags).length > 1;
    action.setLoop(once || a.variants ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once || a.variants;
    action.timeScale = 1;
    if (name === 'walk' && seq.moveSpeed > 0) action.timeScale = Math.max(0.2, (u.speed * (u.slow ? 1 - u.slow.move : 1)) / seq.moveSpeed);
    // Construction: the birth sequence follows the construction progress (it stops while no builder works).
    if (name === 'birth' && (u.constructing || u.upgrading)) action.timeScale = 0;
    action.play();
    a.seq = seq;
    a.action = action;
    a.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name in seq.visibility) o.visible = seq.visibility[o.name];
    });
  }

  private updateAnimation(u: Unit, a: UnitAnim, dt: number) {
    if (!a.mixer) return;
    const wanted = !u.alive ? 'death' : u.constructing || u.upgrading ? 'birth' : u.anim === 'birth' ? 'stand' : u.anim;
    const restarted = wanted === 'attack' && u.animTime < a.lastAnimTime;
    a.lastAnimTime = u.animTime;
    if (wanted !== a.current || restarted) this.playAnimation(u, a, wanted);
    else if (wanted === 'attack' && a.action && !a.action.isRunning()) {
      // Between attacks the unit idles, the next attack restarts the attack sequence.
      this.playAnimation(u, a, 'stand');
      a.current = 'attack';
    } else if (a.variants && a.action && !a.action.isRunning()) {
      this.playAnimation(u, a, wanted);
    } else if (wanted === 'walk' && a.action && a.seq && a.seq.moveSpeed > 0) {
      a.action.timeScale = Math.max(0.2, (u.speed * (u.slow ? 1 - u.slow.move : 1)) / a.seq.moveSpeed);
    }
    const build = u.constructing ?? u.upgrading;
    if (wanted === 'birth' && build && a.action && a.seq) a.action.time = a.seq.duration * Math.min(0.999, build.elapsed / Math.max(0.1, build.total));
    a.mixer.update(dt);
  }

  /**
   * Ground decals of a unit like the game: selection circle texture by size (ussc × ScaleFactor, UI\MiscData.txt),
   * coloured friend / enemy / neutral; blob shadow image (ushu) placed by ushx / ushy / ushw / ushh; and the
   * ubersplat under buildings (uubs), which fades in during construction and out after the building is gone.
   */
  private groundDecals(u: Unit): { circle: Decal | null; shadow: Decal | null } {
    const ui = this.assets?.catalog.ui;
    if (!this.decals || !ui) return { circle: null, shadow: null };
    const size = u.def.selectionScale * ui.selectionScale;
    const tex = ui.selectionCircles.find((c) => size <= c.maxSize) ?? ui.selectionCircles[ui.selectionCircles.length - 1];
    const argb = u.owner === CREEP_PLAYER ? ui.selectionColors.enemy : u.owner < CREEP_PLAYER ? ui.selectionColors.friend : ui.selectionColors.neutral;
    const lin = (c: number) => Math.pow(c / 255, 2.2);
    const circle = this.decals.add({ x: u.x, y: u.y, halfW: size / 2, halfH: size / 2, layer: 3, visible: false, color: [lin(argb[1]), lin(argb[2]), lin(argb[3]), argb[0] / 255] }, tex?.texture);
    let shadow: Decal | null = null;
    const f = u.def.fields;
    const image = String(f.ushu ?? '').trim();
    const w = Number(f.ushw) || 0;
    const h = Number(f.ushh) || 0;
    if (image && w > 0 && h > 0) {
      const sc = ui.shadowColor;
      shadow = this.decals.add({ x: u.x, y: u.y, halfW: w / 2, halfH: h / 2, layer: 2, color: [lin(sc[1]), lin(sc[2]), lin(sc[3]), sc[0] / 255] }, `ReplaceableTextures\\Shadows\\${image}`);
      shadow.cache = undefined;
    }
    const ubr = String(f.uubs ?? '').trim();
    const def = ubr ? this.assets?.catalog.uberSplats?.[ubr] : undefined;
    if (def && !this.uberSplats.has(u.uid)) this.uberSplats.set(u.uid, { unit: u, release: this.decals.uberSplat(def, u.x, u.y, true).release });
    return { circle, shadow };
  }

  /**
   * Corpses (UI\MiscData.txt): after the death sequence the body stays and plays "Decay Flesh" until BoneDecayTime
   * (88 s) after the death, then turns to bones ("Decay Bone") that sink into the ground over DecayTime (2 s).
   * The game logic drops dead units after 1.5 s; the renderer keeps the body on its own. At most 120 corpses.
   */
  private corpses: { v: UnitView; u: Unit; died: number; stage: 'death' | 'flesh' | 'bone'; boneAt: number }[] = [];
  private static readonly BONE_DECAY = 88;
  private static readonly DECAY = 2;

  private keepCorpse(u: Unit, v: UnitView) {
    const a = v.anim;
    if (!a?.mixer || !a.info || u.flying || !pickSequence(a.info.sequences, 'decay', ['flesh'])) return false;
    v.hpBg.visible = v.hpFg.visible = false;
    v.selection.visible = false;
    if (v.circle) this.decals?.remove(v.circle);
    if (v.shadow) this.decals?.remove(v.shadow);
    v.circle = v.shadow = null;
    // Game time (u.removeAt = moment of death), so pausing / game speed apply.
    this.corpses.push({ v, u, died: u.removeAt, stage: 'death', boneAt: u.removeAt + WorldView.BONE_DECAY });
    while (this.corpses.length > 120) {
      const old = this.corpses.shift()!;
      this.world.remove(old.v.root);
    }
    return true;
  }

  private playCorpse(a: UnitAnim, name: string, tag: string) {
    const seq = a.info && pickSequence(a.info.sequences, name, [tag]);
    if (!seq || !a.mixer) return;
    a.mixer.stopAllAction();
    const action = a.mixer.clipAction(seq.clip);
    action.reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    a.seq = seq;
    a.action = action;
    a.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name in seq.visibility) o.visible = seq.visibility[o.name];
    });
  }

  private updateCorpses(dt: number) {
    this.corpses = this.corpses.filter((c) => {
      const a = c.v.anim!;
      if (c.stage === 'death' && (!a.action || !a.action.isRunning())) {
        c.stage = 'flesh';
        this.playCorpse(a, 'decay', 'flesh');
      } else if (c.stage === 'flesh' && this.game.time >= c.boneAt) {
        c.stage = 'bone';
        this.playCorpse(a, 'decay', 'bone');
      }
      a.mixer!.update(dt);
      if (c.stage === 'bone') {
        const t = (this.game.time - c.boneAt) / WorldView.DECAY;
        c.v.body.position.z = -Math.max(0, t) * 30;
        if (t >= 1) {
          this.world.remove(c.v.root);
          return false;
        }
      }
      return true;
    });
  }

  private removeUnit(u: Unit) {
    const v = this.units.get(u.uid);
    if (!v) return;
    if (!u.alive && this.units.get(u.uid) === v && this.keepCorpse(u, v)) {
      this.units.delete(u.uid);
      this.buffArts.delete(u.uid);
      return;
    }
    this.world.remove(v.root);
    if (v.circle) this.decals?.remove(v.circle);
    if (v.shadow) this.decals?.remove(v.shadow);
    this.units.delete(u.uid);
    this.buffArts.delete(u.uid);
  }

  /** Art of a buff: map buffs (w3h ftat / fta0) or the game's profile (Targetart / Targetattach). */
  private buffDef(id: string): { art: string[]; attach: string[] } | null {
    const custom = this.map.objects.w3h?.[id];
    const ftat = custom?.fields.ftat;
    if (ftat) {
      const art = String(ftat).split(',').filter(Boolean);
      return { art, attach: art.map((_, i) => String(custom.fields[`fta${i}`] ?? custom.fields.fta0 ?? '')) };
    }
    const c = this.assets?.catalog.buffs?.[id] ?? (custom ? this.assets?.catalog.buffs?.[custom.base] : undefined);
    return c && c.targetArt.length ? { art: c.targetArt, attach: c.targetAttach } : null;
  }

  private buffArt(u: Unit, id: string, on: boolean) {
    let arts = this.buffArts.get(u.uid);
    if (!on) {
      for (const o of arts?.get(id) ?? []) o.parent?.remove(o);
      arts?.delete(id);
      return;
    }
    const def = this.buffDef(id);
    if (!def) return;
    if (!arts) this.buffArts.set(u.uid, (arts = new Map()));
    const list: THREE.Object3D[] = [];
    arts.set(id, list);
    def.art.forEach((path, i) => void this.attachArt(u, path, def.attach[i] ?? def.attach[0] ?? '').then((o) => o && (arts!.get(id) === list ? list.push(o) : o.parent?.remove(o))));
  }

  /**
   * Attaches an effect model to an attachment point of a unit's model ("hand,left" → "Hand Left Ref", "overhead",
   * "chest", "sprite,first" …); without such a point it sits at the origin / above the unit. The effect loops its
   * stand sequence and follows the unit's animation.
   */
  private async attachArt(u: Unit, path: string, tags: string): Promise<THREE.Object3D | null> {
    const file = path.replace(/\.md[lx]$/i, '');
    if (!this.assets?.modelExists(file)) return null;
    const template = await this.assets.loadModel(file);
    const v = this.units.get(u.uid);
    if (!template || !v || !u.alive) return null;
    const words = tags.toLowerCase().split(/[\s,]+/).filter(Boolean);
    let parent: THREE.Object3D = v.body;
    let z = 0;
    const model = v.anim?.model;
    const points = (model?.userData.attachments as { words: string[]; node: string }[] | undefined) ?? [];
    const want = words.length ? words : ['origin'];
    const point = points.find((p) => want.every((w) => p.words.includes(w))) ?? (want[0] === 'origin' ? undefined : points.find((p) => p.words.includes(want[0])));
    if (model && point) {
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone && o.name === point.node) parent = o;
      });
    } else if (want.includes('overhead') || want.includes('head')) z = v.height + 10;
    else if (want.includes('chest')) z = v.height * 0.6;
    const fx = cloneModel(template);
    fx.position.z = z;
    // Bones carry the unit's model scale; effects keep their own size.
    if (parent !== v.body) fx.scale.setScalar(1 / Math.max(0.1, u.def.scale));
    parent.add(fx);
    this.animatedProp(template, fx, false);
    return fx;
  }

  /** Art of abilities that is always shown on the unit (Asp3 "Sphere": orbs circling the Water Spirit). */
  private permanentArt(u: Unit) {
    for (const id of u.def.abilities) {
      const ab = this.db.ability(id);
      if (!/^Asp/.test(ab.base)) continue;
      const art = String(ab.fields.atat ?? '').split(',').filter(Boolean);
      art.forEach((p, i) => void this.attachArt(u, p, String(ab.fields[`ata${i}`] ?? ab.fields.ata0 ?? '')));
    }
  }

  /** Event objects of animated models: sounds, splats (blood, footprints), ubersplats (craters) and spawned models. */
  private modelEvent(e: ModelEvent) {
    for (let o: THREE.Object3D | null = e.root; o; o = o.parent) if (!o.visible) return;
    const cat = this.assets?.catalog;
    if (!cat) return;
    if (e.type === 'SND') this.sound?.playLabel(cat.eventSounds?.[e.id], { x: e.x, y: e.y });
    else if (e.type === 'SPL') {
      const def = cat.splats?.[e.id];
      if (def && this.decals) {
        this.decals.splat(def, e.x, e.y, e.yaw);
        if (def.sound) this.sound?.playLabel(def.sound, { x: e.x, y: e.y });
      }
    } else if (e.type === 'UBR') {
      const def = cat.uberSplats?.[e.id];
      if (def && this.decals) {
        this.decals.uberSplat(def, e.x, e.y);
        if (def.sound) this.sound?.playLabel(def.sound, { x: e.x, y: e.y });
      }
    } else if (e.type === 'SPN') {
      const path = cat.spawns?.[e.id];
      if (path) this.spawnModel(path, e.x, e.y, e.z, e.yaw);
    }
  }

  /** Ally colour mode (Alt+A): you blue, allies teal, enemies red; otherwise the player colours. */
  private allyColors = false;
  /** Full opacity of each selection circle (pre-selected circles are drawn at half of it). */
  private circleAlpha = new WeakMap<Decal, number>();

  private colorOf(owner: number) {
    if (!this.allyColors || owner > CREEP_PLAYER) return owner;
    return owner === this.localPlayer ? 1 : owner === CREEP_PLAYER ? 0 : 2;
  }

  setAllyColors(on: boolean) {
    if (on === this.allyColors || !this.assets) return;
    this.allyColors = on;
    // Team colour swaps materials; the highlight is re-applied on top of the new ones.
    this.highlight(null);
    for (const u of this.game.units) {
      const v = this.units.get(u.uid);
      if (v?.anim) applyTeamColor(this.assets, v.anim.model, this.colorOf(u.owner));
    }
  }

  /** Running loop sounds: spell loops end at `until` (game clock), links with their bolt, construction per building. */
  private loops: { handle: LoopHandle; until?: number; linkId?: number; uid?: number }[] = [];

  private addLoop(handle: LoopHandle | null, opts: { until?: number; linkId?: number; uid?: number }) {
    if (handle) this.loops.push({ handle, ...opts });
  }

  private stopLoops(pred: (l: WorldView['loops'][number]) => boolean) {
    this.loops = this.loops.filter((l) => {
      if (!pred(l)) return true;
      l.handle.stop();
      return false;
    });
  }

  /**
   * Construction loop (unit field ubsl, BuildingConstructionLoop) while a builder works on a site; loops of spells
   * stop when their time is up.
   */
  private updateLoops() {
    if (!this.sound) return;
    const working = new Set<number>();
    for (const u of this.game.units) if (u.alive && u.constructs?.constructing && u.anim === 'work') working.add(u.constructs.uid);
    this.stopLoops((l) => (l.uid !== undefined && !working.has(l.uid)) || (l.until !== undefined && this.gclock >= l.until));
    for (const uid of working) {
      if (this.loops.some((l) => l.uid === uid)) continue;
      const site = this.game.units.find((u) => u.uid === uid)!;
      const label = String(site.def.fields.ubsl ?? '').trim() || 'BuildingConstructionLoop';
      this.addLoop(this.sound.playLoop(label, { x: site.x, y: site.y }), { uid });
    }
  }

  /** Templates of type 1 particle models (null = missing / failed, undefined entry = loading). */
  private particleModels = new Map<string, THREE.Group | null | 'loading'>();

  /** Instance of a type 1 particle model playing its first sequence; null until the template is loaded. */
  private modelParticle(path: string): ModelParticle | null {
    const t = this.particleModels.get(path);
    if (t === undefined) {
      this.particleModels.set(path, 'loading');
      if (!this.assets?.modelExists(path)) this.particleModels.set(path, null);
      else void this.assets.loadModel(path).then((m) => this.particleModels.set(path, m));
      return null;
    }
    if (!t || t === 'loading') return null;
    const obj = cloneModel(t);
    const info = this.assets!.animations(t);
    const seq = info?.sequences[0];
    if (!info || !seq) return { obj, update: () => {} };
    const mixer = new THREE.AnimationMixer(obj);
    startGlobalClips(mixer, info);
    mixer.clipAction(seq.clip).setLoop(THREE.LoopRepeat, Infinity).play();
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name in seq.visibility) o.visible = seq.visibility[o.name];
    });
    return { obj, update: (dt) => mixer.update(dt) };
  }

  /** A model spawned by an SPN event (blood gush, debris) or an instant attack's impact: plays one sequence once. */
  /** @param loopFor > 0: the stand sequence loops for this many seconds (e.g. the Skyfury rain cloud). */
  private spawnModel(path: string, x: number, y: number, z: number, yaw: number, sequence = 'birth', loopFor = 0) {
    if (!this.assets?.modelExists(path)) return;
    const start = this.clock;
    void this.assets.loadModel(path).then((model) => {
      if (!model) return;
      const m = cloneModel(model);
      m.position.set(x, y, z);
      m.rotation.z = yaw;
      const info = this.assets!.animations(model);
      const want = loopFor > 0 ? 'stand' : sequence;
      const seq = info ? (pickSequence(info.sequences, want) ?? pickSequence(info.sequences, 'birth') ?? pickSequence(info.sequences, 'stand') ?? info.sequences[0]) : undefined;
      let mixer: THREE.AnimationMixer | undefined;
      let action: THREE.AnimationAction | null = null;
      if (seq) {
        mixer = new THREE.AnimationMixer(m);
        startGlobalClips(mixer, info);
        action = mixer.clipAction(seq.clip);
        action.setLoop(loopFor > 0 ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        action.clampWhenFinished = loopFor <= 0;
        action.play();
        m.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.name in seq.visibility) o.visible = seq.visibility[o.name];
        });
      }
      this.world.add(m);
      const frame = () => (seq && action ? { interval: seq.interval, frame: seq.interval[0] + action.time * 1000 } : null);
      if (info) this.particles.attach(m, model, frame, info.globals);
      this.matAnim.register(m, frame, model.userData.globals ?? []);
      const life = loopFor > 0 ? loopFor : Math.min(6, Math.max(0.5, seq?.duration ?? Number(model.userData.lifetime) ?? 1));
      this.effects.push({ obj: m, start, until: start + life, kind: 'model', mixer, game: true });
    });
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
    const mv: MissileView = { obj, phase: 'birth', state: { seq: null, action: null }, mixer: null, info: null, last: null, owner: m.source.owner };
    this.missiles.set(m.id, mv);
    const path = m.model.replace(/\.md[lx]$/i, '');
    if (!this.assets || !path || !this.assets.modelExists(path)) {
      obj.add(missilePlaceholder(m.color));
      return;
    }
    void this.assets.loadModel(path).then((model) => {
      if (!model || !obj.parent) return;
      const inst = cloneModel(model);
      applyTeamColor(this.assets!, inst, this.colorOf(mv.owner));
      obj.add(inst);
      this.matAnim.register(inst, () => (mv.state.seq && mv.state.action ? { interval: mv.state.seq.interval, frame: mv.state.seq.interval[0] + mv.state.action.time * 1000 } : null), model.userData.globals ?? []);
      const info = this.assets!.animations(model);
      if (!info) return;
      mv.info = info;
      mv.mixer = new THREE.AnimationMixer(inst);
      // Already hit while the model was loading: the impact is handled by update().
      if (!this.playMissile(mv, mv.phase === 'birth' ? 'birth' : 'stand')) this.playMissile(mv, 'stand');
      this.particles.attach(inst, model, () => (mv.state.seq && mv.state.action ? { interval: mv.state.seq.interval, frame: mv.state.seq.interval[0] + mv.state.action.time * 1000 } : null), info.globals);
    });
  }

  private playMissile(mv: MissileView, name: 'birth' | 'stand' | 'death') {
    mv.phase = name;
    if (!mv.mixer || !mv.info) return null;
    const seq = pickSequence(mv.info.sequences, name) ?? (name === 'stand' ? mv.info.sequences.find((q) => !q.words.includes('death') && !q.words.includes('birth')) : undefined);
    if (!seq) return null;
    mv.mixer.stopAllAction();
    startGlobalClips(mv.mixer, mv.info);
    const action = mv.mixer.clipAction(seq.clip);
    action.reset();
    const once = name !== 'stand';
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
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
      const m = cloneModel(model);
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

  /**
   * Instant attack: a lightning bolt like the game's lightning effects (Splats\LightningData.slk, "CHIM" = Lightning
   * Attack) – a camera-facing textured strip split into segments of AvgSegLen that jitter by NoiseScale × length,
   * additive, fading out – and the weapon's model plays its death (impact) sequence at the target.
   */
  private lightning(from: Unit, to: Unit, color: number, model = '') {
    const a = new THREE.Vector3(from.x, from.y, this.grid.heightAt(from.x, from.y) + from.fly + Number(from.def.fields.ulpz ?? 150));
    const b = new THREE.Vector3(to.x, to.y, this.grid.heightAt(to.x, to.y) + to.fly + to.def.impactZ);
    const path = model.replace(/\.md[lx]$/i, '');
    if (path) this.spawnModel(path, b.x, b.y, b.z, Math.atan2(b.y - a.y, b.x - a.x), 'death');
    const def = this.assets?.catalog.lightnings?.CHIM;
    if (def) {
      const segs = Math.max(2, Math.round(a.distanceTo(b) / Math.max(10, def.avgSegLen)));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segs + 1) * 6), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((segs + 1) * 4), 2));
      const idx: number[] = [];
      for (let i = 0; i < segs; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
      geo.setIndex(idx);
      const c = def.color.map((v) => v / 255);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]), transparent: true, opacity: c[3], blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      void this.assets!.loadTexture(`${def.texture}.blp`).then((t) => {
        mat.map = t;
        mat.needsUpdate = true;
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 21;
      this.world.add(mesh);
      this.bolts.push({ mesh, a, b, segs, def, start: this.gclock, life: 0.45, jitter: [], nextJitter: 0 });
      return;
    }
    this.boltLine(a, b, color);
  }

  /** Lasting lightning between two units (Mana Drain); an empty id ends the link. */
  private link(id: number, from: Unit, to: Unit, lightning: string, until: number) {
    const old = this.bolts.find((b) => b.linkId === id);
    if (old) old.life = Math.min(old.life, this.gclock - old.start);
    const def = lightning ? this.assets?.catalog.lightnings?.[lightning] : undefined;
    if (!def) return;
    const mesh = this.boltMesh(def, 4);
    this.bolts.push({ mesh, a: new THREE.Vector3(), b: new THREE.Vector3(), segs: 4, def, start: this.gclock, life: Math.max(0.1, until - this.gclock), jitter: [], nextJitter: 0, linkId: id, follow: { from, to } });
  }

  private boltMesh(def: NonNullable<AssetCatalog['lightnings']>[string], segs: number) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segs + 1) * 6), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((segs + 1) * 4), 2));
    const idx: number[] = [];
    for (let i = 0; i < segs; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
    geo.setIndex(idx);
    const c = def.color.map((v) => v / 255);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]), transparent: true, opacity: c[3], blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    void this.assets!.loadTexture(`${def.texture}.blp`).then((t) => {
      mat.map = t;
      mat.needsUpdate = true;
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 21;
    this.world.add(mesh);
    return mesh;
  }

  private boltLine(a: THREE.Vector3, b: THREE.Vector3, color: number) {
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

  private updateBolts(camera: THREE.Camera) {
    if (!this.bolts.length) return;
    // View direction in WC3 coordinates – the strip faces the camera.
    const inv = new THREE.Matrix4().copy(this.world.matrixWorld).invert();
    const view = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(inv);
    this.bolts = this.bolts.filter((bolt) => {
      const t = (this.gclock - bolt.start) / bolt.life;
      if (t >= 1) {
        this.world.remove(bolt.mesh);
        bolt.mesh.geometry.dispose();
        return false;
      }
      if (bolt.follow) {
        const { from, to } = bolt.follow;
        if (!from.alive || !to.alive) bolt.life = Math.min(bolt.life, this.gclock - bolt.start + 0.05);
        bolt.a.set(from.x, from.y, this.grid.heightAt(from.x, from.y) + from.fly + (this.units.get(from.uid)?.height ?? 100) * 0.6);
        bolt.b.set(to.x, to.y, this.grid.heightAt(to.x, to.y) + to.fly + (this.units.get(to.uid)?.height ?? 100) * 0.6);
      }
      const { a, b, segs, def } = bolt;
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      dir.normalize();
      const side = new THREE.Vector3().crossVectors(dir, view).normalize();
      const up = new THREE.Vector3().crossVectors(side, dir).normalize();
      // New jagged shape every few frames, ends stay attached.
      if (this.gclock >= bolt.nextJitter) {
        bolt.nextJitter = this.gclock + 0.05;
        const amp = def.noiseScale * len;
        bolt.jitter = Array.from({ length: segs + 1 }, (_, i) => (i === 0 || i === segs ? [0, 0] : [(Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp]));
      }
      const pos = bolt.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const uv = bolt.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
      const half = def.width / 2;
      const p = new THREE.Vector3();
      for (let i = 0; i <= segs; i++) {
        const [j1, j2] = bolt.jitter[i] ?? [0, 0];
        p.copy(a).lerp(b, i / segs).addScaledVector(side, j1).addScaledVector(up, j2);
        pos.setXYZ(i * 2, p.x - side.x * half, p.y - side.y * half, p.z - side.z * half);
        pos.setXYZ(i * 2 + 1, p.x + side.x * half, p.y + side.y * half, p.z + side.z * half);
        const u = i * def.texCoordScale + (this.gclock - bolt.start) * 2;
        uv.setXY(i * 2, u, 0);
        uv.setXY(i * 2 + 1, u, 1);
      }
      pos.needsUpdate = uv.needsUpdate = true;
      (bolt.mesh.material as THREE.MeshBasicMaterial).opacity = (def.color[3] / 255) * (bolt.follow ? Math.min(1, (bolt.life - (this.gclock - bolt.start)) / 0.2) : 1 - t * t);
      return true;
    });
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

  /**
   * Placement ghost: the building's own model in its stand pose, translucent, over a grid of footprint cells
   * (green = buildable, red = blocked or taken by a planned building).
   */
  showGhost(id: string | null, x = 0, y = 0) {
    if (!id) {
      this.ghost.visible = false;
      return;
    }
    if (id !== this.ghostId) {
      if (this.ghostModel) this.ghost.remove(this.ghostModel);
      this.ghostModel = this.ghostOf(id, null, 0.55);
      this.ghost.add(this.ghostModel);
      this.ghostId = id;
    }
    const [sx, sy] = this.game.grid.snap(x, y, 4);
    this.ghost.visible = true;
    this.ghostModel!.position.set(sx, sy, this.grid.heightAt(sx, sy));
    const cells = this.game.grid.footprintCells(sx, sy, 4);
    const planned = this.game.plannedSites();
    const m = new THREE.Matrix4();
    let all = true;
    cells.forEach((c, i) => {
      const [wx, wy] = this.game.grid.center(c.cx, c.cy);
      const ok = c.ok && !planned.some((p) => Math.abs(p.x - wx) < 64 && Math.abs(p.y - wy) < 64);
      all &&= ok;
      m.makeTranslation(wx, wy, this.grid.heightAt(wx, wy) + 4);
      this.ghostCells.setMatrixAt(i, m);
      this.ghostCells.setColorAt(i, new THREE.Color(ok ? 0x30ff30 : 0xff3030));
    });
    this.ghostCells.instanceMatrix.needsUpdate = true;
    if (this.ghostCells.instanceColor) this.ghostCells.instanceColor.needsUpdate = true;
    return all;
  }

  /**
   * Translucent copy of a building in its stand pose (placement ghost, planned building). `tint` multiplies the
   * model colour like UI\MiscData.txt [Placement] PaidStructureColor. Placeholder shape until the model loads.
   */
  private ghostOf(id: string, tint: THREE.Color | null, opacity: number) {
    const g = new THREE.Group();
    const def = this.db.unit(id);
    const ph = def.attack ? towerPlaceholder(def.attack.attackType, 0x40ff40, 0) : auraTowerPlaceholder();
    ph.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh) mm.material = mat(tint ? tint.getHex() : 0x60ff60, { opacity: opacity * 0.8 });
    });
    g.add(ph);
    if (!this.assets || !def.model || !this.assets.modelExists(def.model)) return g;
    const tags = String(def.fields.uani ?? '');
    void this.assets.loadModel(def.model, tags).then((model) => {
      if (!model) return;
      const m = cloneModel(model);
      m.scale.setScalar(def.scale);
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mt = (mesh.material as THREE.MeshLambertMaterial).clone();
        mt.transparent = true;
        mt.opacity *= opacity;
        mt.depthWrite = false;
        if (tint) mt.color.multiply(tint);
        mesh.material = mt;
        mesh.renderOrder = 5;
      });
      const info = this.assets!.animations(model);
      const seq = info && pickSequence(info.sequences, 'stand', tags.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
      if (info && seq) {
        const mixer = new THREE.AnimationMixer(m);
        startGlobalClips(mixer, info);
        mixer.clipAction(seq.clip).play();
        mixer.update(0);
        m.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.name in seq.visibility) o.visible = seq.visibility[o.name];
        });
      }
      g.clear();
      g.add(m);
    });
    return g;
  }

  /** Planned buildings (paid, builder still walking): ghosts tinted with PaidStructureColor (96,128,128,255). */
  private updatePlanned() {
    const keep = new Set<string>();
    for (const s of this.game.plannedSites()) {
      if (s.owner !== this.localPlayer) continue;
      const key = `${s.id}|${s.x}|${s.y}`;
      keep.add(key);
      if (this.planned.has(key)) continue;
      const g = this.ghostOf(s.id, new THREE.Color(128 / 255, 128 / 255, 1), 96 / 255);
      g.position.set(s.x, s.y, this.grid.heightAt(s.x, s.y));
      this.world.add(g);
      this.planned.set(key, g);
    }
    for (const [key, g] of this.planned) {
      if (keep.has(key)) continue;
      this.world.remove(g);
      this.planned.delete(key);
    }
  }

  // --- per frame ---------------------------------------------------------------------------------------

  /**
   * Animation LOD: units outside the view (plus a margin) advance their animation only every OFFSCREEN_STEP seconds
   * and skip the matrix update of their bones and the emission of their particles in between – bone matrices,
   * mixers and emitters of a whole wave are the main CPU cost. The accumulated time is applied at once, so the
   * animation phase stays exact; event objects (blood, sounds) still fire.
   */
  private static readonly OFFSCREEN_STEP = 0.25;
  private viewFrustum = new THREE.Frustum();
  private viewSphere = new THREE.Sphere();
  /** Units whose animation ran this frame / was deferred (for profiling). */
  animStats = { full: 0, deferred: 0 };

  private onScreen(u: Unit, v: UnitView, ground: number) {
    const r = Math.max(v.height, 120) * v.baseScale + 250;
    this.viewSphere.center.set(u.x, u.y, ground + u.fly + v.height * 0.5);
    this.viewSphere.radius = r;
    return this.viewFrustum.intersectsSphere(this.viewSphere);
  }

  update(dt: number, camera: THREE.Camera, width: number, height: number) {
    this.clock += dt;
    const g = this.game;
    camera.updateMatrixWorld();
    this.viewFrustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.animStats.full = this.animStats.deferred = 0;
    for (const u of g.units) {
      const v = this.units.get(u.uid);
      if (!v) continue;
      if (v.defId !== this.visualDef(u).id) {
        // Upgrade started / cancelled / finished or morph – rebuild visuals.
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
        const a = v.anim;
        const step = (g.paused ? 0 : dt * g.speed) + (a.pending ?? 0);
        const busy = !u.alive || !!u.constructing || !!u.upgrading || this.selection.has(u);
        const near = busy || this.onScreen(u, v, ground);
        if (near || step >= WorldView.OFFSCREEN_STEP) {
          a.pending = 0;
          v.root.matrixWorldAutoUpdate = true;
          this.updateAnimation(u, a, step);
          this.animStats.full++;
        } else {
          // Leaving the view: start at a per-unit phase so the deferred updates of a wave spread over frames.
          a.pending = v.root.matrixWorldAutoUpdate ? step + ((u.uid * 0.618) % 1) * WorldView.OFFSCREEN_STEP * 0.9 : step;
          v.root.matrixWorldAutoUpdate = false;
          this.animStats.deferred++;
        }
        if (!a.meshes) {
          a.meshes = [];
          a.model.traverse((o) => (o as THREE.Mesh).isMesh && a.meshes!.push(o as THREE.Mesh));
        }
        for (const m of a.meshes) m.layers.mask = near ? 1 : 0;
        // Bodies with decay sequences stay as corpses (updateCorpses); others fade out.
        if (!u.alive && !(v.anim.info && pickSequence(v.anim.info.sequences, 'decay', ['flesh']) && !u.flying)) opacity = 1 - Math.min(1, Math.max(0, (g.time - u.removeAt - 0.6) / 0.9));
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
      v.body.scale.setScalar(s * v.baseScale * g.buffScale(u));
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
      if (v.circle) {
        // Pre-selection: the unit under the cursor shows its circle at half opacity, like the game.
        const pre = !v.selection.visible && this.hover?.unit === u && u.alive;
        if (!this.circleAlpha.has(v.circle)) this.circleAlpha.set(v.circle, v.circle.color[3]);
        v.circle.color[3] = this.circleAlpha.get(v.circle)! * (pre ? 0.5 : 1);
        v.circle.visible = (v.selection.visible || pre) && !u.hidden;
        v.circle.x = u.x;
        v.circle.y = u.y;
      }
      if (v.shadow) {
        // ushx / ushy = position of the unit inside the shadow image (from its lower left corner).
        const f = u.def.fields;
        v.shadow.x = u.x - (Number(f.ushx) || 0) + v.shadow.halfW;
        v.shadow.y = u.y - (Number(f.ushy) || 0) + v.shadow.halfH;
        v.shadow.visible = this.showShadows && !u.hidden && opacity > 0.05;
        v.shadow.color[3] = (this.assets!.catalog.ui!.shadowColor[0] / 255) * opacity * (stealth ? 0.4 : 1);
      }
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
    this.gclock += gdt;
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
      if (mv.phase === 'birth' && mv.state.action && !mv.state.action.isRunning()) this.playMissile(mv, 'stand');
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
      else if (!d.alive) {
        // Destroyed: the model's death sequence (falling gate), or a squash without one.
        const p = this.destructableProps.get(variable);
        if (p && p.current !== 'death') {
          if (!this.playProp(p, 'death')) p.current = 'death';
        }
        if (!p?.seq || !p.seq.words.includes('death')) obj.scale.set(d.scale, d.scale, Math.max(0.15, obj.scale.z - dt * 2));
      } else if (this.destructableProps.get(variable)?.current === 'death') this.playProp(this.destructableProps.get(variable)!, 'stand');
      else obj.scale.setScalar(d.scale);
    }
    for (const [uid, b] of this.uberSplats) {
      if (b.unit.alive && g.units.includes(b.unit)) continue;
      b.release();
      this.uberSplats.delete(uid);
    }
    this.updatePlanned();
    this.updateBolts(camera);
    this.props = this.props.filter((p) => {
      for (let o: THREE.Object3D | null = p.root; o; o = o.parent) if (o === this.world) {
        p.mixer.update(gdt);
        return true;
      }
      return !!p.root.parent;
    });
    this.matAnim.update(gdt, this.world);
    this.updateCorpses(gdt);
    this.updateLoops();
    this.particles.update(gdt, camera);
    this.decals?.update(gdt);
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
    if (this.hover?.unit === u) {
      // The model may have loaded (or been rebuilt by an upgrade) since the cursor came over the unit.
      if (u && this.highlighted?.model !== this.units.get(u.uid)?.anim?.model) this.highlight(u);
      return;
    }
    this.hover?.el.remove();
    this.hover = null;
    this.highlight(u);
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

  /** Meshes of the highlighted model with their original materials (restored when the cursor leaves). */
  private highlighted: { model: THREE.Object3D; meshes: [THREE.Mesh, THREE.Material][] } | null = null;

  /**
   * Mouse-over highlight like the game: the unit under the cursor is drawn brighter. Its meshes get brightened
   * material copies (additive effect layers stay as they are); the originals come back when the cursor leaves.
   */
  private highlight(u: Unit | null) {
    if (this.highlighted) {
      for (const [mesh, mat] of this.highlighted.meshes) {
        (mesh.material as THREE.Material).dispose();
        mesh.material = mat;
      }
      this.highlighted = null;
    }
    const model = u ? this.units.get(u.uid)?.anim?.model : null;
    if (!model) return;
    const meshes: [THREE.Mesh, THREE.Material][] = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const orig = mesh.material as THREE.MeshLambertMaterial;
      if (orig.blending === THREE.AdditiveBlending || !orig.color) return;
      const bright = orig.clone();
      if ((bright as THREE.MeshLambertMaterial).isMeshLambertMaterial) {
        // Lit materials: the texture also glows a little, so the unit stays brighter even in shadow / at night.
        bright.emissive.setScalar(0.55);
        bright.emissiveMap = bright.map;
      } else bright.color.multiplyScalar(1.45);
      mesh.material = bright;
      meshes.push([mesh, orig]);
    });
    this.highlighted = { model, meshes };
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
    if (this.highlighted?.model !== v.anim?.model) this.highlight(u);
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
