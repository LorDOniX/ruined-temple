import * as THREE from 'three';

/**
 * Warcraft 3 style game camera. Works in WC3 world coordinates (X east, Y north, Z up);
 * the scene's "world" group is rotated so these map 1:1 onto three.js.
 * Defaults match the game: angle of attack 304° (= 56° down), distance 1650, FOV 70°.
 */
export class RtsCamera {
  readonly camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3();
  distance = 1650;
  pitch = THREE.MathUtils.degToRad(56);
  yaw = THREE.MathUtils.degToRad(90);
  minDistance = 700;
  maxDistance = 3000;
  bounds = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
  scrollSpeed = 2000;
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, inside: false };
  private drag: { x: number; y: number; tx: number; ty: number } | null = null;

  constructor(
    private readonly dom: HTMLElement,
    private readonly world: THREE.Object3D,
    private readonly heightAt: (x: number, y: number) => number,
  ) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 50, 12000);
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key));
    addEventListener('blur', () => this.keys.clear());
    // Window-wide so edge scrolling also works over the console / top bar.
    addEventListener('mousemove', (e) => {
      const r = dom.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top, inside: true };
      if (this.drag) {
        const scale = this.distance / r.height;
        this.target.x = this.drag.tx - (e.clientX - this.drag.x) * scale * 1.2;
        this.target.y = this.drag.ty + (e.clientY - this.drag.y) * scale * 1.6;
        this.clamp();
      }
    });
    document.addEventListener('mouseleave', () => (this.mouse.inside = false));
    dom.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.drag = { x: e.clientX, y: e.clientY, tx: this.target.x, ty: this.target.y };
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 1) this.drag = null;
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance * (1 + Math.sign(e.deltaY) * 0.1), this.minDistance, this.maxDistance);
      },
      { passive: false },
    );
  }

  setBounds(minX: number, minY: number, maxX: number, maxY: number) {
    this.bounds = { minX, minY, maxX, maxY };
    this.clamp();
  }

  panTo(x: number, y: number) {
    this.target.set(x, y, 0);
    this.clamp();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    // WC3's 70° is horizontal for a 4:3 screen.
    const hfov = THREE.MathUtils.degToRad(70);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / (4 / 3)));
    this.camera.updateProjectionMatrix();
  }

  private clamp() {
    const b = this.bounds;
    this.target.x = THREE.MathUtils.clamp(this.target.x, b.minX, b.maxX);
    this.target.y = THREE.MathUtils.clamp(this.target.y, b.minY, b.maxY);
  }

  update(dt: number, edgeScroll = true) {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dy += 1;
    if (this.keys.has('ArrowDown')) dy -= 1;
    if (edgeScroll && this.mouse.inside && !this.drag) {
      const r = this.dom.getBoundingClientRect();
      const m = 6;
      if (this.mouse.x < m) dx -= 1;
      if (this.mouse.x > r.width - m) dx += 1;
      if (this.mouse.y < m) dy += 1;
      if (this.mouse.y > r.height - m) dy -= 1;
    }
    if (dx || dy) {
      const s = this.scrollSpeed * dt * (this.distance / 1650);
      this.target.x += dx * s;
      this.target.y += dy * s;
      this.clamp();
    }
    this.target.z = THREE.MathUtils.lerp(this.target.z, this.heightAt(this.target.x, this.target.y), Math.min(1, dt * 8));

    const horiz = Math.cos(this.pitch) * this.distance;
    const eye = new THREE.Vector3(
      this.target.x - Math.cos(this.yaw) * horiz,
      this.target.y - Math.sin(this.yaw) * horiz,
      this.target.z + Math.sin(this.pitch) * this.distance,
    );
    this.world.updateMatrixWorld();
    this.camera.position.copy(this.world.localToWorld(eye.clone()));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.world.localToWorld(this.target.clone()));
  }
}
