import * as THREE from 'three';
import type { AssetCatalog } from '../data/types';

/**
 * Loads original Warcraft 3 MDX models + BLP textures from public/war3 (created by tools/assets.ts)
 * and converts them to three.js objects. Static only: bind pose, geosets hidden at the start of the
 * "stand" sequence are skipped. Skeletal animation / particles are listed as TODO in docs/IMPLEMENTACE.md.
 */
export class Wc3Assets {
  private files: Set<string>;
  private models = new Map<string, Promise<THREE.Group | null>>();
  private textures = new Map<string, Promise<THREE.Texture | null>>();
  private anims = new WeakMap<THREE.Object3D, ModelAnimations>();
  private parsers: Promise<{ Model: any; BlpImage: any }> | null = null;

  constructor(readonly catalog: AssetCatalog, readonly baseUrl = 'war3/') {
    this.files = new Set(catalog.files);
  }

  static normalize(path: string) {
    return path.replace(/\\/g, '/').toLowerCase();
  }

  has(path: string) {
    return this.files.has(Wc3Assets.normalize(path));
  }

  url(path: string) {
    return this.baseUrl + Wc3Assets.normalize(path).split('/').map(encodeURIComponent).join('/');
  }

  private loadParsers() {
    // Vite wraps CommonJS modules, so the constructor may sit under one or two `default` levels.
    const unwrap = (m: any, name: string) => {
      for (let cur = m, i = 0; cur && i < 4; cur = cur.default, i++) {
        if (typeof cur === 'function') return cur;
        if (cur[name]) return cur[name];
      }
      throw new Error(`mdx-m3-viewer export ${name} not found`);
    };
    this.parsers ??= Promise.all([
      import('mdx-m3-viewer/dist/cjs/parsers/mdlx/model'),
      import('mdx-m3-viewer/dist/cjs/parsers/blp/image'),
    ]).then(([m, b]: any[]) => ({ Model: unwrap(m, 'Model'), BlpImage: unwrap(b, 'BlpImage') }));
    return this.parsers;
  }

  /** The parsed MDX (mdx-m3-viewer parser object) without conversion – e.g. the 2D cursor model. */
  async loadRawModel(path: string): Promise<any | null> {
    const key = `${Wc3Assets.normalize(path.replace(/\.md[lx]$/i, ''))}.mdx`;
    if (!this.files.has(key)) return null;
    const { Model } = await this.loadParsers();
    const model = new Model();
    model.load(await (await fetch(this.url(key))).arrayBuffer());
    return model;
  }

  /** Model path without extension, e.g. "units\\orc\\Peon\\Peon". */
  modelExists(path: string) {
    return this.has(`${path.replace(/\.md[lx]$/i, '')}.mdx`);
  }

  /**
   * @param animTags Animation properties (unit field "uani", e.g. "upgrade,second"): the pose is taken from the
   *   stand sequence carrying these tags, which is how one model shows several building variants in WC3.
   */
  loadModel(path: string, animTags = ''): Promise<THREE.Group | null> {
    const key = Wc3Assets.normalize(path.replace(/\.md[lx]$/i, ''));
    const tags = animTags.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    const cacheKey = `${key}|${tags.join(',')}`;
    let p = this.models.get(cacheKey);
    if (!p) {
      p = this.doLoadModel(`${key}.mdx`, tags).catch((e) => {
        console.warn('MDX load failed', path, e);
        return null;
      });
      this.models.set(cacheKey, p);
    }
    return p;
  }

  async loadTexture(path: string): Promise<THREE.Texture | null> {
    const key = Wc3Assets.normalize(path);
    let p = this.textures.get(key);
    if (!p) {
      p = this.doLoadTexture(key).catch((e) => {
        console.warn('BLP load failed', path, e);
        return null;
      });
      this.textures.set(key, p);
    }
    return p;
  }

  /** Decodes a texture: original BLP, or PNG converted from DDS by tools/assets.ts. */
  async decodeImage(path: string): Promise<ImageData | null> {
    const base = Wc3Assets.normalize(path).replace(/\.(blp|tga|dds|png)$/, '');
    if (this.files.has(`${base}.blp`)) {
      const { BlpImage } = await this.loadParsers();
      const buf = await (await fetch(this.url(`${base}.blp`))).arrayBuffer();
      const img = new BlpImage();
      img.load(buf);
      return img.getMipmap(0) as ImageData;
    }
    if (this.files.has(`${base}.png`)) {
      const blob = await (await fetch(this.url(`${base}.png`))).blob();
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height);
    }
    return null;
  }

  private async doLoadTexture(key: string) {
    const img = await this.decodeImage(key);
    if (!img) return null;
    const tex = new THREE.DataTexture(new Uint8Array(img.data.buffer), img.width, img.height, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  /** Animation data of a loaded template model (clips are shared by all clones). */
  animations(template: THREE.Object3D): ModelAnimations | null {
    return this.anims.get(template) ?? null;
  }

  private async doLoadModel(key: string, tags: string[]): Promise<THREE.Group | null> {
    if (!this.files.has(key)) return null;
    const { Model } = await this.loadParsers();
    const buf = await (await fetch(this.url(key))).arrayBuffer();
    const model = new Model();
    model.load(buf);
    const globals: number[] = model.globalSequences;

    const seqs = model.sequences as any[];
    const stand = pickSequence(seqs, 'stand', tags) ?? seqs[0];
    const interval: [number, number] = stand ? [stand.interval[0], stand.interval[1]] : [0, 0];
    const group = new THREE.Group();
    group.name = key;
    const extent = stand?.extent?.max ?? model.extent?.max;
    const lo = stand?.extent?.min ?? model.extent?.min ?? [0, 0, 0];
    const hi = extent ?? [0, 0, 0];
    const cullSphere = new THREE.Sphere(
      new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2),
      Math.max(150, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])),
    );
    group.userData.height = extent && extent[2] > 1 ? extent[2] : 0;
    group.userData.globals = Array.from(globals ?? []);

    const texturePromises: Promise<THREE.Texture | null>[] = (model.textures as any[]).map((t) => {
      if (t.replaceableId === 1) return Promise.resolve(teamColorTexture());
      if (t.replaceableId === 2) return Promise.resolve(teamGlowTexture());
      if (t.path) return this.loadTexture(t.path);
      return Promise.resolve(null);
    });
    const textures = await Promise.all(texturePromises);

    // --- skeleton: every generic object (bone, helper, attachment, emitter…) is a node with a pivot point.
    const nodes: any[] = [];
    for (const list of [model.bones, model.helpers, model.attachments, model.lights, model.particleEmitters, model.particleEmitters2, model.particleEmittersPopcorn, model.ribbonEmitters, model.eventObjects, model.collisionShapes]) {
      for (const n of (list as any[]) ?? []) if (n && n.objectId >= 0) nodes.push(n);
    }
    nodes.sort((a, b) => a.objectId - b.objectId);
    const pivot = (id: number) => {
      const p = model.pivotPoints[id];
      return p ? new THREE.Vector3(p[0], p[1], p[2]) : new THREE.Vector3();
    };
    const boneIndex = new Map<number, number>();
    const bones: THREE.Bone[] = [];
    const nodeById = new Map<number, any>();
    for (const n of nodes) {
      const b = new THREE.Bone();
      b.name = `n${n.objectId}`;
      boneIndex.set(n.objectId, bones.length);
      bones.push(b);
      nodeById.set(n.objectId, n);
    }
    const parentPivot = (n: any) => (n.parentId >= 0 && nodeById.has(n.parentId) ? pivot(n.parentId) : new THREE.Vector3());
    for (const n of nodes) {
      const b = bones[boneIndex.get(n.objectId)!];
      b.position.copy(pivot(n.objectId)).sub(parentPivot(n));
      const parent = n.parentId >= 0 && boneIndex.has(n.parentId) ? bones[boneIndex.get(n.parentId)!] : null;
      (parent ?? group).add(b);
    }
    const skinned = bones.length > 0;
    const skeleton = skinned ? new THREE.Skeleton(bones, nodes.map((n) => new THREE.Matrix4().makeTranslation(pivot(n.objectId).negate()))) : null;

    const meshes: { mesh: THREE.Mesh; geoset: number; layer: any }[] = [];
    (model.geosets as any[]).forEach((geoset, gi) => {
      if (geoset.lod > 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(geoset.vertices), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(geoset.normals), 3));
      if (geoset.uvSets[0]) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geoset.uvSets[0]), 2));
      geo.setIndex(new THREE.BufferAttribute(new Uint16Array(geoset.faces), 1));
      if (skinned) {
        // SD skinning: each vertex references a matrix group (list of bones, equal weights).
        const groups: number[][] = [];
        let k = 0;
        for (const size of geoset.matrixGroups as Uint32Array) {
          groups.push(Array.from((geoset.matrixIndices as Uint32Array).slice(k, k + size)));
          k += size;
        }
        const count = geoset.vertices.length / 3;
        const si = new Uint16Array(count * 4);
        const sw = new Float32Array(count * 4);
        for (let v = 0; v < count; v++) {
          const g = (groups[geoset.vertexGroups[v]] ?? []).filter((id) => boneIndex.has(id)).slice(0, 4);
          if (!g.length) {
            sw[v * 4] = 1;
            continue;
          }
          g.forEach((id, j) => {
            si[v * 4 + j] = boneIndex.get(id)!;
            sw[v * 4 + j] = 1 / g.length;
          });
        }
        geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
        geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      }
      geo.computeBoundingSphere();

      const material = model.materials[geoset.materialId];
      (material?.layers ?? []).forEach((layer: any, li: number) => {
        const alpha = evalTrack(layer, 'KMTA', layer.alpha, interval, globals);
        // KMTF = animated texture id (e.g. flipbook water); the first frame of the sequence is used.
        const textureId = Math.round(evalTrack(layer, 'KMTF', layer.textureId, interval, globals, true));
        const tex = textures[textureId] ?? null;
        const mat = layerMaterial(layer, tex, Math.max(alpha, 0.01));
        const replaceableId = model.textures[textureId]?.replaceableId ?? 0;
        if (replaceableId) mat.userData.replaceable = replaceableId;
        // Animated layer: texture flipbook (KMTF, e.g. naga water), UV animation (KTAT/KTAR/KTAS), alpha (KMTA).
        const anims = (layer.animations as any[]) ?? [];
        const kmtf = anims.find((a) => a.name === 'KMTF' && a.frames.length > 1);
        const kmta = anims.find((a) => a.name === 'KMTA' && a.frames.length > 1);
        const texAnim = layer.textureAnimationId >= 0 ? model.textureAnimations[layer.textureAnimationId] : null;
        if (kmtf || kmta || texAnim) {
          layerAnims.set(mat, { layer, textures: kmtf ? textures : null, texAnim, alpha: !!kmta });
          if (kmta) mat.transparent = true;
        }
        const mesh = skinned ? new THREE.SkinnedMesh(geo, mat) : new THREE.Mesh(geo, mat);
        mesh.name = `g${gi}_${li}`;
        mesh.renderOrder = (material.priorityPlane ?? 0) * 10 + li;
        if (skinned) {
          (mesh as THREE.SkinnedMesh).bind(skeleton!, new THREE.Matrix4());
          // Frustum culling of animated meshes: a generous sphere around the model's extent instead of the
          // per-vertex skinned bounds (three.js would otherwise compute them from the bind pose once).
          (mesh as THREE.SkinnedMesh).boundingSphere = cullSphere.clone();
        }
        meshes.push({ mesh, geoset: gi, layer });
        group.add(mesh);
      });
    });

    // Visibility of each mesh per sequence (geoset alpha KGAO × layer alpha KMTA at the sequence start).
    const ga = (gi: number) => (model.geosetAnimations as any[]).find((a) => a.geosetId === gi);
    const visibleIn = (m: (typeof meshes)[number], iv: [number, number]) => {
      const a = ga(m.geoset);
      const geosetAlpha = a ? evalTrack(a, 'KGAO', a.alpha, iv, globals) : 1;
      return geosetAlpha >= 0.01 && evalTrack(m.layer, 'KMTA', m.layer.alpha, iv, globals) >= 0.01;
    };
    for (const m of meshes) m.mesh.visible = m.mesh.userData.standVisible = visibleIn(m, interval);
    // Moment (seconds into the stand sequence) when every geoset has faded out – lifetime of one-shot effect models.
    let fadeAt = (interval[1] - interval[0]) / 1000;
    const fades = meshes.map((m) => {
      const a = ga(m.geoset)?.animations?.find((x: any) => x.name === 'KGAO');
      if (!a) return Infinity;
      for (let i = 0; i < a.frames.length; i++) if (a.frames[i] > interval[0] && a.frames[i] <= interval[1] && a.values[i][0] < 0.01) return (a.frames[i] - interval[0]) / 1000;
      return Infinity;
    });
    if (fades.length && fades.every(Number.isFinite)) fadeAt = Math.min(fadeAt, Math.max(...fades));
    group.userData.lifetime = fadeAt;

    // Particle emitters (type 2) – simulated by ParticleSystem (particles.ts) on the cloned bones.
    const emitters2: Emitter2Def[] = [];
    for (const e of (model.particleEmitters2 as any[]) ?? []) {
      if (!(e.objectId >= 0) || !boneIndex.has(e.objectId)) continue;
      const tex = e.replaceableId ? null : textures[e.textureId] ?? null;
      emitters2.push({
        node: `n${e.objectId}`,
        raw: e,
        texture: tex,
        filterMode: e.filterMode,
        rows: Math.max(1, e.rows),
        columns: Math.max(1, e.columns),
        head: e.headOrTail === 0 || e.headOrTail === 2,
        tail: e.headOrTail === 1 || e.headOrTail === 2,
        tailLength: e.tailLength,
        timeMiddle: Math.min(0.999, Math.max(0.001, e.timeMiddle)),
        colors: [0, 1, 2].map((i) => [e.segmentColors[i][0], e.segmentColors[i][1], e.segmentColors[i][2], e.segmentAlphas[i] / 255]),
        scaling: [e.segmentScaling[0], e.segmentScaling[1], e.segmentScaling[2]],
        intervals: [e.headIntervals[0], e.headIntervals[1], e.tailIntervals[0], e.tailIntervals[1]].map((v: Uint32Array) => [v[0], v[1], v[2]]),
        lifeSpan: Math.max(0.01, e.lifeSpan),
        squirt: !!e.squirt,
        lineEmitter: (e.flags & 131072) !== 0,
        modelSpace: (e.flags & 524288) !== 0,
        xyQuad: (e.flags & 1048576) !== 0,
        priorityPlane: e.priorityPlane ?? 0,
      });
    }
    group.userData.emitters2 = emitters2;
    // Ribbon emitters (arrow / spear trails …) – simulated by ParticleSystem as well.
    const ribbons: RibbonDef[] = [];
    for (const r of (model.ribbonEmitters as any[]) ?? []) {
      if (!(r.objectId >= 0) || !boneIndex.has(r.objectId)) continue;
      const material = model.materials[r.materialId];
      const layer = material?.layers?.[0];
      ribbons.push({
        node: `n${r.objectId}`,
        raw: r,
        texture: layer ? textures[layer.textureId] ?? null : null,
        filterMode: layer?.filterMode ?? 2,
        twoSided: !!layer && (layer.flags & 16) !== 0,
        rows: Math.max(1, r.rows),
        columns: Math.max(1, r.columns),
        lifeSpan: Math.max(0.01, r.lifeSpan),
        emissionRate: r.emissionRate,
        gravity: r.gravity,
        priorityPlane: material?.priorityPlane ?? 0,
      });
    }
    group.userData.ribbons = ribbons;
    // Event objects: SND (sound), SPL / FPT (splat, footprint), UBR (ubersplat), SPN (spawned model).
    const events: EventDef[] = [];
    for (const e of (model.eventObjects as any[]) ?? []) {
      if (!(e.objectId >= 0) || !boneIndex.has(e.objectId)) continue;
      const type = String(e.name).slice(0, 3).toUpperCase();
      if (!['SND', 'SPL', 'FPT', 'UBR', 'SPN'].includes(type)) continue;
      const gs = e.globalSequenceId;
      events.push({ node: `n${e.objectId}`, type: type === 'FPT' ? 'SPL' : (type as EventDef['type']), id: String(e.name).slice(4, 8).trim(), tracks: Array.from(e.tracks as Uint32Array), globalLength: gs >= 0 && globals[gs] !== undefined ? globals[gs] : -1 });
    }
    group.userData.events = events;
    // Attachment points ("Hand Left Ref", "Chest Ref", "Sprite First Ref" …) for buff / effect art.
    group.userData.attachments = ((model.attachments as any[]) ?? [])
      .filter((a) => a.objectId >= 0 && boneIndex.has(a.objectId))
      .map((a) => ({ words: String(a.name).toLowerCase().replace(/\bref\b/, '').split(/[\s,]+/).filter(Boolean), node: `n${a.objectId}` }));
    const cam = (model.cameras as any[])?.[0];
    if (cam) group.userData.camera = { position: Array.from(cam.position as Float32Array), target: Array.from(cam.targetPosition as Float32Array), fov: cam.fieldOfView, near: cam.nearClippingPlane, far: cam.farClippingPlane };

    if (skinned && seqs.length) {
      // Node tracks on a global sequence loop on their own (e.g. rotating portal planes, waving flags): they are
      // left out of the sequence clips and collected into one looping clip per global sequence.
      const isGlobal = (a: any) => a.globalSequenceId >= 0 && globals[a.globalSequenceId] > 0;
      const globalTracks = new Map<number, THREE.KeyframeTrack[]>();
      const nodeTracks = (n: any, iv: [number, number], wantGlobal: number | null) => {
        const out: THREE.KeyframeTrack[] = [];
        const base = pivot(n.objectId).sub(parentPivot(n));
        for (const [name, prop] of [['KGTR', 'position'], ['KGRT', 'quaternion'], ['KGSC', 'scale']] as const) {
          const a = (n.animations as any[]).find((x) => x.name === name);
          if (!a) continue;
          if (wantGlobal === null ? isGlobal(a) : !isGlobal(a) || a.globalSequenceId !== wantGlobal) continue;
          // A global track is sampled over [0, length] like an ordinary sequence.
          const g = wantGlobal === null ? globals : [];
          if (prop === 'quaternion') out.push(quatTrack(`n${n.objectId}.quaternion`, a, iv, g));
          else if (prop === 'position') out.push(vecTrack(`n${n.objectId}.position`, a, iv, g, [0, 0, 0], base));
          else out.push(vecTrack(`n${n.objectId}.scale`, a, iv, g, [1, 1, 1]));
        }
        return out;
      };
      globals.forEach((len, gid) => {
        if (!(len > 0)) return;
        const tracks = nodes.flatMap((n) => nodeTracks(n, [0, len], gid));
        if (tracks.length) globalTracks.set(gid, tracks);
      });
      const globalClips = [...globalTracks].map(([gid, tracks]) => new THREE.AnimationClip(`global${gid}`, globals[gid] / 1000, tracks));
      const sequences: SequenceInfo[] = seqs.map((s) => {
        const iv: [number, number] = [s.interval[0], s.interval[1]];
        const tracks: THREE.KeyframeTrack[] = nodes.flatMap((n) => nodeTracks(n, iv, null));
        const duration = Math.max(0.001, (iv[1] - iv[0]) / 1000);
        const visibility: Record<string, boolean> = {};
        for (const m of meshes) visibility[m.mesh.name] = visibleIn(m, iv);
        return {
          name: String(s.name),
          interval: iv,
          words: words(s),
          clip: new THREE.AnimationClip(String(s.name), duration, tracks),
          duration,
          moveSpeed: Number(s.moveSpeed) || 0,
          nonLooping: !!s.nonLooping,
          rarity: Number(s.rarity) || 0,
          visibility,
        };
      });
      this.anims.set(group, { sequences, globals, globalClips });
    }
    return group;
  }
}

export interface SequenceInfo {
  name: string;
  /** Frame range in the model (ms) – for evaluating tracks at the current animation time. */
  interval: [number, number];
  words: string[];
  clip: THREE.AnimationClip;
  duration: number;
  moveSpeed: number;
  nonLooping: boolean;
  rarity: number;
  visibility: Record<string, boolean>;
}
export interface ModelAnimations {
  sequences: SequenceInfo[];
  globals: number[];
  /** Looping clips of node tracks driven by global sequences – play them next to the current sequence. */
  globalClips: THREE.AnimationClip[];
}

/** Starts the global-sequence clips of a model instance (after creating its mixer or stopAllAction()). */
export function startGlobalClips(mixer: THREE.AnimationMixer, info: ModelAnimations | null | undefined) {
  for (const clip of info?.globalClips ?? []) mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
}

/** Particle emitter 2 of a model template (see mdx-m3-viewer's ParticleEmitter2Object for the semantics). */
export interface Emitter2Def {
  /** Bone name of the emitter node in the (cloned) skeleton. */
  node: string;
  /** Parser object – animated tracks (KP2V visibility, KP2E rate, KP2S speed …). */
  raw: any;
  texture: THREE.Texture | null;
  filterMode: number;
  rows: number;
  columns: number;
  head: boolean;
  tail: boolean;
  tailLength: number;
  timeMiddle: number;
  colors: number[][];
  scaling: number[];
  intervals: number[][];
  lifeSpan: number;
  squirt: boolean;
  lineEmitter: boolean;
  modelSpace: boolean;
  xyQuad: boolean;
  priorityPlane: number;
}

/** Ribbon emitter of a model template (see mdx-m3-viewer's RibbonEmitterObject). */
export interface RibbonDef {
  node: string;
  /** Parser object – animated tracks KRHA/KRHB (height above/below), KRAL (alpha), KRCO (colour), KRTX (slot), KRVS (visibility). */
  raw: any;
  texture: THREE.Texture | null;
  /** Material layer filter mode (0 none, 1 transparent, 2 blend, 3 additive, 4 add alpha, 5 modulate, 6 modulate 2x). */
  filterMode: number;
  twoSided: boolean;
  rows: number;
  columns: number;
  lifeSpan: number;
  emissionRate: number;
  gravity: number;
  priorityPlane: number;
}

/** Event object (KEVT): fires when the animation passes one of its frames. */
export interface EventDef {
  node: string;
  type: 'SND' | 'SPL' | 'UBR' | 'SPN';
  /** 4-character id looked up in AnimLookups / SplatData / UberSplatData / SpawnData. */
  id: string;
  tracks: number[];
  /** Length of the global sequence driving the track, -1 = the instance's sequence. */
  globalLength: number;
}

/** Portrait camera stored in the model (Cameras chunk), model coordinates. */
export interface ModelCamera {
  position: number[];
  target: number[];
  fov: number;
  near: number;
  far: number;
}

/**
 * Value of an animated scalar track at a given frame of a sequence (linear interpolation) and the index of the
 * active keyframe (-1 when the track has no keys in the sequence → static value).
 */
export function evalTrackAt(obj: any, name: string, fallback: number, [start, end]: [number, number], frame: number, globals: number[], globalTime: number) {
  const anim = (obj.animations as any[] | undefined)?.find((a) => a.name === name);
  if (!anim || !anim.frames.length) return { value: fallback, key: -1 };
  const gid = anim.globalSequenceId;
  const global = gid >= 0 && globals[gid] !== undefined;
  const lo = global ? 0 : start;
  const hi = global ? globals[gid] : end;
  const f = global ? (globals[gid] > 0 ? globalTime % globals[gid] : 0) : frame;
  const frames: number[] = anim.frames;
  let first = -1;
  let k = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i] < lo || frames[i] > hi) continue;
    if (first < 0) first = i;
    if (frames[i] <= f) k = i;
  }
  if (first < 0) return { value: fallback, key: -1 };
  if (k < 0) return { value: anim.values[first][0] as number, key: first };
  const next = k + 1 < frames.length && frames[k + 1] <= hi ? k + 1 : -1;
  if (next < 0 || anim.interpolationType === 0) return { value: anim.values[k][0] as number, key: k };
  const t = (f - frames[k]) / Math.max(1, frames[next] - frames[k]);
  return { value: anim.values[k][0] * (1 - t) + anim.values[next][0] * t, key: k };
}

/** Vector variant of evalTrackAt (e.g. ribbon colour KRCO). */
export function evalVecTrackAt(obj: any, name: string, fallback: ArrayLike<number>, [start, end]: [number, number], frame: number, globals: number[], globalTime: number): number[] {
  const anim = (obj.animations as any[] | undefined)?.find((a) => a.name === name);
  if (!anim || !anim.frames.length) return Array.from(fallback);
  const gid = anim.globalSequenceId;
  const global = gid >= 0 && globals[gid] !== undefined;
  const lo = global ? 0 : start;
  const hi = global ? globals[gid] : end;
  const f = global ? (globals[gid] > 0 ? globalTime % globals[gid] : 0) : frame;
  const frames: number[] = anim.frames;
  let first = -1;
  let k = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i] < lo || frames[i] > hi) continue;
    if (first < 0) first = i;
    if (frames[i] <= f) k = i;
  }
  if (first < 0) return Array.from(fallback);
  if (k < 0) return Array.from(anim.values[first] as ArrayLike<number>);
  const a = Array.from(anim.values[k] as ArrayLike<number>);
  const next = k + 1 < frames.length && frames[k + 1] <= hi ? k + 1 : -1;
  if (next < 0 || anim.interpolationType === 0) return a;
  const t = (f - frames[k]) / Math.max(1, frames[next] - frames[k]);
  const b = anim.values[next] as ArrayLike<number>;
  return a.map((v, i) => v * (1 - t) + b[i] * t);
}

/** The portrait sequence ("Portrait", not "Portrait Talk") of a portrait or unit model. */
export function pickPortraitSequence(seqs: SequenceInfo[], tags: string[] = []) {
  const portrait = seqs.filter((s) => s.words.includes('portrait') && !s.words.includes('talk'));
  const score = (s: SequenceInfo) => tags.filter((t) => s.words.includes(t)).length * 100 - s.words.length;
  if (portrait.length) return portrait.sort((a, b) => score(b) - score(a))[0];
  return pickSequence(seqs, 'stand', tags) ?? seqs[0];
}

const words = (s: { name: string }) => String(s.name).toLowerCase().split(/[\s-]+/).filter(Boolean);

/**
 * Picks a sequence like the game: sequence names are unordered tag sets ("Stand Upgrade First Ready Attack"),
 * so the animation name may be any word; prefer sequences carrying the unit's animation tags, then the plainest.
 */
export function pickSequence<T extends { name: string }>(seqs: T[], anim: string, tags: string[] = []): T | undefined {
  const cands = seqs.filter((s) => words(s).includes(anim) && !words(s).includes('portrait'));
  if (!cands.length) return undefined;
  const score = (s: T) => {
    const w = words(s);
    const hits = tags.filter((t) => w.includes(t)).length;
    return hits * 100 - (w.length - 1 - hits);
  };
  const best = Math.max(...cands.map(score));
  const top = cands.filter((s) => score(s) === best);
  return top[Math.floor(Math.random() * top.length)];
}

/** Keyframes of one track inside a sequence (or its global sequence), with exact values at both ends. */
function trackKeys(anim: any, [start, end]: [number, number], globals: number[]) {
  const global = anim.globalSequenceId >= 0 && globals[anim.globalSequenceId] !== undefined;
  const lo = global ? 0 : start;
  const hi = global ? lo : end;
  const frames: number[] = anim.frames;
  const idx: number[] = [];
  for (let i = 0; i < frames.length; i++) if (frames[i] >= lo && frames[i] <= hi) idx.push(i);
  return { lo, hi: global ? lo : hi, idx, global };
}

function sample(anim: any, idx: number[], frame: number, quat: boolean): number[] {
  const frames: number[] = anim.frames;
  let k = 0;
  while (k < idx.length - 1 && frames[idx[k + 1]] <= frame) k++;
  const i = idx[k];
  const a = Array.from(anim.values[i] as Float32Array);
  if (frames[i] >= frame || k === idx.length - 1 || anim.interpolationType === 0) return a;
  const j = idx[k + 1];
  const tt = Math.min(1, (frame - frames[i]) / Math.max(1, frames[j] - frames[i]));
  const b = Array.from(anim.values[j] as Float32Array);
  if (quat) {
    const q = new THREE.Quaternion(a[0], a[1], a[2], a[3]).slerp(new THREE.Quaternion(b[0], b[1], b[2], b[3]), tt);
    return [q.x, q.y, q.z, q.w];
  }
  return a.map((v, n) => v + (b[n] - v) * tt);
}

function keyTimes(anim: any, iv: [number, number], globals: number[], quat: boolean, size: number, fallback: number[]) {
  const { lo, hi, idx } = trackKeys(anim, iv, globals);
  const times: number[] = [];
  const values: number[] = [];
  const push = (frame: number, v: number[]) => {
    times.push((frame - lo) / 1000);
    values.push(...v.slice(0, size));
  };
  if (!idx.length) {
    push(lo, fallback);
  } else {
    const frames: number[] = anim.frames;
    if (frames[idx[0]] > lo) push(lo, sample(anim, idx, lo, quat));
    for (const i of idx) push(frames[i], Array.from(anim.values[i] as Float32Array));
    if (frames[idx[idx.length - 1]] < hi) push(hi, sample(anim, idx, hi, quat));
  }
  return { times, values };
}

function vecTrack(name: string, anim: any, iv: [number, number], globals: number[], fallback: number[], offset?: THREE.Vector3) {
  const { times, values } = keyTimes(anim, iv, globals, false, 3, fallback);
  if (offset) for (let i = 0; i < values.length; i += 3) {
    values[i] += offset.x;
    values[i + 1] += offset.y;
    values[i + 2] += offset.z;
  }
  const track = new THREE.VectorKeyframeTrack(name, times, values);
  if (anim.interpolationType === 0) track.setInterpolation(THREE.InterpolateDiscrete);
  return track;
}

function quatTrack(name: string, anim: any, iv: [number, number], globals: number[]) {
  const { times, values } = keyTimes(anim, iv, globals, true, 4, [0, 0, 0, 1]);
  const track = new THREE.QuaternionKeyframeTrack(name, times, values);
  if (anim.interpolationType === 0) track.setInterpolation(THREE.InterpolateDiscrete);
  return track;
}

interface LayerAnim {
  layer: any;
  textures: (THREE.Texture | null)[] | null;
  texAnim: any;
  alpha: boolean;
}
/** Animated layers of template materials (not in userData: Material.clone() deep-copies userData as JSON). */
const layerAnims = new WeakMap<THREE.Material, LayerAnim>();

/** Animation state of a model instance: active sequence interval and current frame (ms). */
export type AnimFrame = () => { interval: [number, number]; frame: number } | null;

const uvMatrix = new THREE.Matrix3();

/**
 * Animated material layers of model instances like the game: texture flipbooks (KMTF), texture coordinate
 * animation (KTAT translation, KTAR rotation and KTAS scale around the texture centre, applied in this order as in
 * mdx-m3-viewer's shader) and layer alpha (KMTA). Each registered instance gets its own copies of the animated
 * materials (and textures – they share the GPU image); tracks run on the instance's sequence or on global sequences.
 */
export class MaterialAnimator {
  private entries: { root: THREE.Object3D; frame: AnimFrame | null; globals: number[]; mats: { mat: THREE.MeshBasicMaterial; anim: LayerAnim }[] }[] = [];
  private clockMs = 0;

  register(root: THREE.Object3D, frame: AnimFrame | null, globals: number[]) {
    const mats: (typeof this.entries)[number]['mats'] = [];
    const copies = new Map<THREE.Material, THREE.MeshBasicMaterial>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material as THREE.MeshBasicMaterial | undefined;
      const anim = m ? layerAnims.get(m) : undefined;
      if (!mesh.isMesh || !anim) return;
      let copy = copies.get(m!);
      if (!copy) {
        copy = m!.clone();
        if (anim.texAnim && copy.map) {
          copy.map = copy.map.clone();
          copy.map.matrixAutoUpdate = false;
        }
        copies.set(m!, copy);
        mats.push({ mat: copy, anim });
      }
      mesh.material = copy;
    });
    if (mats.length) this.entries.push({ root, frame, globals, mats });
  }

  update(dt: number, world: THREE.Object3D) {
    this.clockMs += dt * 1000;
    this.entries = this.entries.filter((e) => attachedTo(e.root, world));
    for (const e of this.entries) {
      const f = e.frame?.() ?? { interval: [0, 0] as [number, number], frame: 0 };
      for (const { mat, anim } of e.mats) {
        const at = (obj: any, name: string, fb: number) => evalTrackAt(obj, name, fb, f.interval, f.frame, e.globals, this.clockMs).value;
        if (anim.textures) {
          const id = Math.round(at(anim.layer, 'KMTF', anim.layer.textureId));
          const tex = anim.textures[id];
          if (tex && mat.map !== tex) {
            mat.map = tex;
            mat.needsUpdate = true;
          }
        }
        if (anim.alpha) mat.opacity = Math.max(0, Math.min(1, at(anim.layer, 'KMTA', anim.layer.alpha)));
        if (anim.texAnim && mat.map) {
          const ta = anim.texAnim;
          const t = evalVecTrackAt(ta, 'KTAT', [0, 0, 0], f.interval, f.frame, e.globals, this.clockMs);
          const q = evalVecTrackAt(ta, 'KTAR', [0, 0, 0, 1], f.interval, f.frame, e.globals, this.clockMs);
          const s = evalVecTrackAt(ta, 'KTAS', [1, 1, 1], f.interval, f.frame, e.globals, this.clockMs)[0];
          const angle = 2 * Math.atan2(q[2], q[3]);
          const c = Math.cos(angle) * s;
          const sn = Math.sin(angle) * s;
          // uv' = s·R·(uv + t − ½) + ½
          const ox = t[0] - 0.5;
          const oy = t[1] - 0.5;
          uvMatrix.set(c, -sn, c * ox - sn * oy + 0.5, sn, c, sn * ox + c * oy + 0.5, 0, 0, 1);
          mat.map.matrix.copy(uvMatrix);
        }
      }
    }
  }
}

function attachedTo(o: THREE.Object3D, world: THREE.Object3D) {
  for (let cur: THREE.Object3D | null = o; cur; cur = cur.parent) if (cur === world) return true;
  return false;
}

/** Clones team-coloured materials of a model instance and assigns the player's TeamColor/TeamGlow textures. */
export function applyTeamColor(assets: Wc3Assets, root: THREE.Object3D, player: number) {
  if (player < 0 || player > 11) return;
  const id = String(player).padStart(2, '0');
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const m = mesh.material as THREE.MeshLambertMaterial | undefined;
    if (!mesh.isMesh || (m?.userData?.replaceable !== 1 && m?.userData?.replaceable !== 2)) return;
    const clone = m.clone();
    mesh.material = clone;
    const path = m.userData.replaceable === 1 ? `ReplaceableTextures\\TeamColor\\TeamColor${id}.blp` : `ReplaceableTextures\\TeamGlow\\TeamGlow${id}.blp`;
    void assets.loadTexture(path).then((t) => {
      if (t) {
        clone.map = t;
        clone.needsUpdate = true;
      }
    });
  });
}

/** Assigns a replaceable texture (e.g. id 11 = cliff, 31+ = trees) given by DestructableData/Doodads texFile. */
export function applyReplaceable(assets: Wc3Assets, root: THREE.Object3D, id: number, path: string) {
  const mats = new Map<THREE.Material, THREE.MeshLambertMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const m = mesh.material as THREE.MeshLambertMaterial | undefined;
    if (!mesh.isMesh || m?.userData?.replaceable !== id) return;
    let clone = mats.get(m);
    if (!clone) mats.set(m, (clone = m.clone()));
    mesh.material = clone;
  });
  if (!mats.size) return Promise.resolve();
  return assets.loadTexture(path).then((t) => {
    for (const m of mats.values()) {
      m.map = t;
      m.color.set(0xffffff);
      m.needsUpdate = true;
    }
  });
}

let teamColor: THREE.DataTexture | null = null;
let teamGlow: THREE.DataTexture | null = null;
function teamColorTexture() {
  teamColor ??= solid(0, 0, 0);
  return teamColor;
}
function teamGlowTexture() {
  teamGlow ??= solid(0, 0, 0, 0);
  return teamGlow;
}
function solid(r: number, g: number, b: number, a = 255) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function layerMaterial(layer: any, map: THREE.Texture | null, alpha: number): THREE.Material {
  const unshaded = (layer.flags & 1) !== 0 || layer.filterMode >= 3;
  const params: THREE.MeshLambertMaterialParameters & THREE.MeshBasicMaterialParameters = {
    map,
    color: map ? 0xffffff : 0x888888,
    side: layer.flags & 16 ? THREE.DoubleSide : THREE.FrontSide,
    opacity: alpha,
    transparent: alpha < 1,
  };
  const m = unshaded ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params);
  switch (layer.filterMode) {
    case 1: // Transparent (alpha test)
      m.alphaTest = 0.75;
      break;
    case 2: // Blend
      m.transparent = true;
      m.depthWrite = false;
      break;
    case 3: // Additive
      m.transparent = true;
      m.blending = THREE.AdditiveBlending;
      m.depthWrite = false;
      break;
    case 4: // Add alpha
      m.transparent = true;
      m.blending = THREE.CustomBlending;
      m.blendSrc = THREE.SrcAlphaFactor;
      m.blendDst = THREE.OneFactor;
      m.depthWrite = false;
      break;
    case 5: // Modulate
    case 6: // Modulate 2x
      m.transparent = true;
      m.blending = THREE.CustomBlending;
      m.blendSrc = THREE.DstColorFactor;
      m.blendDst = layer.filterMode === 5 ? THREE.ZeroFactor : THREE.SrcColorFactor;
      m.depthWrite = false;
      break;
  }
  if (layer.flags & 64) m.depthTest = false;
  if (layer.flags & 128) m.depthWrite = false;
  return m;
}

/**
 * Evaluates a scalar track at the start of a sequence like the game does: only keyframes inside the
 * sequence interval count; without any, the static value applies. Global sequences use frame 0.
 */
function evalTrack(obj: any, name: string, fallback: number, [start, end]: [number, number], globalSequences: number[], step = false) {
  const anim = (obj.animations as any[] | undefined)?.find((a) => a.name === name);
  if (!anim || !anim.frames.length) return fallback;
  const global = anim.globalSequenceId >= 0 && globalSequences[anim.globalSequenceId] !== undefined;
  const lo = global ? 0 : start;
  const hi = global ? globalSequences[anim.globalSequenceId] : end;
  const frames: number[] = anim.frames;
  const keys: number[] = [];
  for (let i = 0; i < frames.length; i++) if (frames[i] >= lo && frames[i] <= hi) keys.push(i);
  if (!keys.length) return fallback;
  const f = lo;
  let k = 0;
  while (k < keys.length - 1 && frames[keys[k + 1]] <= f) k++;
  const i = keys[k];
  if (frames[i] > f || step || anim.interpolationType === 0 || k === keys.length - 1) return anim.values[i][0];
  const j = keys[k + 1];
  const t = (f - frames[i]) / Math.max(1, frames[j] - frames[i]);
  return anim.values[i][0] * (1 - t) + anim.values[j][0] * t;
}

/** Bakes many copies of a static template into InstancedMeshes (one per template mesh). */
export function instantiate(template: THREE.Object3D, matrices: THREE.Matrix4[]) {
  const out = new THREE.Group();
  template.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.standVisible === false) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length);
    const m = new THREE.Matrix4();
    matrices.forEach((mat, i) => inst.setMatrixAt(i, m.multiplyMatrices(mat, local)));
    inst.instanceMatrix.needsUpdate = true;
    inst.renderOrder = mesh.renderOrder;
    inst.computeBoundingSphere();
    out.add(inst);
  });
  return out;
}
