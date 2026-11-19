import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Unit } from '../game/game';
import { applyTeamColor, pickPortraitSequence, type ModelCamera, type Wc3Assets } from './mdx';

/**
 * The animated unit portrait of the console: "<model>_portrait.mdx" (or the unit model itself) playing its
 * "Portrait" sequence, viewed through the camera stored in the model – rendered into the portrait hole
 * of the console with a scissored viewport after the main scene.
 */
export class PortraitView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 1, 10000);
  private root = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private key = '';
  private modelCamera: ModelCamera | null = null;
  private height = 100;
  visible = false;

  constructor(private readonly assets: Wc3Assets | null) {
    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
    sun.position.set(0.6, 0.8, 0.6);
    this.scene.add(sun);
  }

  setUnit(u: Unit | null) {
    const key = u ? `${u.uid}|${u.def.id}` : '';
    if (key === this.key) return;
    this.key = key;
    this.root.clear();
    this.mixer = null;
    this.visible = false;
    if (!u || !this.assets || !u.def.model) return;
    const portraitPath = `${u.def.model}_portrait`;
    const path = this.assets.modelExists(portraitPath) ? portraitPath : u.def.model;
    if (!this.assets.modelExists(path)) return;
    const tags = String(u.def.fields.uani ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    void this.assets.loadModel(path, tags.join(',')).then((model) => {
      if (!model || this.key !== key) return;
      const m = cloneSkinned(model);
      applyTeamColor(this.assets!, m, u.owner);
      this.root.add(m);
      this.modelCamera = (model.userData.camera as ModelCamera | undefined) ?? null;
      this.height = Number(model.userData.height) || 100;
      const info = this.assets!.animations(model);
      if (info?.sequences.length) {
        const seq = pickPortraitSequence(info.sequences, tags);
        this.mixer = new THREE.AnimationMixer(m);
        this.mixer.clipAction(seq.clip).setLoop(THREE.LoopRepeat, Infinity).play();
        m.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.name in seq.visibility) o.visible = seq.visibility[o.name];
        });
      }
      this.visible = true;
    });
  }

  update(dt: number) {
    this.mixer?.update(dt);
  }

  render(renderer: THREE.WebGLRenderer, rect: DOMRect, canvasHeight: number) {
    if (rect.width < 2 || rect.height < 2) return;
    const y = canvasHeight - rect.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(rect.left, y, rect.width, rect.height);
    renderer.setViewport(rect.left, y, rect.width, rect.height);
    renderer.clear();
    if (!this.visible) {
      // Empty portrait hole is black like in the game.
      renderer.setScissorTest(false);
      const size = renderer.getSize(new THREE.Vector2());
      renderer.setViewport(0, 0, size.x, size.y);
      return;
    }
    const aspect = rect.width / rect.height;
    const c = this.modelCamera;
    this.root.updateMatrixWorld(true);
    if (c) {
      this.camera.position.copy(this.root.localToWorld(new THREE.Vector3(c.position[0], c.position[1], c.position[2])));
      const target = this.root.localToWorld(new THREE.Vector3(c.target[0], c.target[1], c.target[2]));
      // MDX field of view is horizontal (the portrait frame is wider than tall).
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(c.fov / 2) / aspect));
      this.camera.near = Math.max(1, c.near);
      this.camera.far = Math.max(c.far, 1000);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(target);
    } else {
      // No portrait camera: frame the whole model from the front (models face +X).
      const h = this.height;
      this.camera.position.copy(this.root.localToWorld(new THREE.Vector3(h * 1.25, 0, h * 0.62)));
      this.camera.fov = 40;
      this.camera.near = 1;
      this.camera.far = h * 10;
      this.camera.lookAt(this.root.localToWorld(new THREE.Vector3(0, 0, h * 0.5)));
    }
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, size.x, size.y);
  }
}
