import * as THREE from 'three';
import './style.css';
import type { AssetCatalog, MapData } from './data/types';
import { ObjectDB } from './data/objects';
import { TerrainGrid, buildCliffMeshes, buildTerrainMesh, cliffInstances, type CliffInstance, type TerrainLayerSource } from './render/terrain';
import { layerFromImage } from './render/textures';
import { RtsCamera } from './render/camera';
import { WorldView } from './render/world';
import { Wc3Assets } from './render/mdx';
import { CREEP_PLAYER, Game, type Unit } from './game/game';
import { Hud } from './ui/hud';
import { PortraitView } from './render/portrait';
import { plainText } from './data/objects';
import { SoundPlayer } from './sound';

async function loadJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

const loadingEl = () => document.getElementById('loading')!;
/** Loading progress shown on the loading screen; stage timings are kept as performance marks. */
function stage(text: string) {
  performance.mark(text);
  loadingEl().textContent = text;
}

async function main() {
  stage('Načítám data mapy…');
  const map = await loadJson<MapData>('map/map.json');
  if (!map) {
    document.getElementById('loading')!.textContent = 'Chybí public/map/map.json – spusťte "npm run extract".';
    return;
  }
  const catalog = await loadJson<AssetCatalog>('war3/catalog.json');
  const assets = catalog ? new Wc3Assets(catalog) : null;
  const db = new ObjectDB(map, catalog);
  const grid = new TerrainGrid(map.terrain);

  // --- renderer & scene ----------------------------------------------------------------------------
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.9);
  sun.position.set(-0.3, 0.9, 0.3); // WC3 (-0.3, -0.3, 0.9) in three.js axes
  scene.add(sun);

  // --- terrain ------------------------------------------------------------------------------------------
  // Real (HD) textures get 1024x512 layers – 256 px per tile cell in the extended layout.
  const layerSize: [number, number] = catalog ? [1024, 512] : [512, 256];
  const layerFromBlp = async (path: string | undefined): Promise<TerrainLayerSource | null> => {
    if (!assets || !path) return null;
    const img = await assets.decodeImage(path);
    return img ? layerFromImage(img, ...layerSize) : null;
  };
  stage('Načítám textury terénu…');
  const groundLayers = await Promise.all(map.terrain.groundTilesets.map((id) => layerFromBlp(catalog?.terrain[id]?.file)));
  const cliffLayers = await Promise.all(map.terrain.cliffTilesets.map((id) => layerFromBlp(catalog?.cliffs[id]?.texture)));
  const cliffGroundTiles = catalog ? Object.fromEntries(Object.entries(catalog.cliffs).map(([k, v]) => [k, v.groundTile])) : undefined;
  const shadows = map.shadows ? { width: map.shadows.width, height: map.shadows.height, data: Uint8Array.from(atob(map.shadows.data), (c) => c.charCodeAt(0)) } : null;
  // Original cliff models replace the steep-slope fallback wherever the model file is available.
  let cliffs: CliffInstance[] = [];
  if (assets && catalog) {
    const dirs = map.terrain.cliffTilesets.map((id) => catalog.cliffs[id]?.modelDir ?? 'Cliffs');
    cliffs = cliffInstances(grid, dirs).filter((c) => assets.modelExists(c.path));
  }
  stage('Stavím terén…');
  const terrain = buildTerrainMesh(grid, { groundLayers, cliffLayers, cliffGroundTiles, shadows, layerSize, cliffModelTiles: new Set(cliffs.map((c) => c.tile)) });

  const game = new Game(map, db, (x, y) => grid.heightAt(x, y), 1);
  const overlay = document.getElementById('float-layer')!;
  const view = new WorldView(scene, game, map, db, grid, assets, overlay);
  view.world.add(terrain.mesh);
  if (assets && catalog && cliffs.length) {
    stage('Načítám útesy…');
    const models = new Map<string, THREE.BufferGeometry[]>();
    await Promise.all(
      [...new Set(cliffs.map((c) => c.path))].map(async (path) => {
        const g = await assets.loadModel(path);
        const geos = new Set<THREE.BufferGeometry>();
        g?.traverse((o) => (o as THREE.Mesh).isMesh && o.visible && geos.add((o as THREE.Mesh).geometry));
        if (geos.size) models.set(path, [...geos]);
      }),
    );
    const materials = await Promise.all(
      map.terrain.cliffTilesets.map(async (id) => new THREE.MeshLambertMaterial({ map: await assets.loadTexture(catalog.cliffs[id]?.texture ?? '') })),
    );
    view.world.add(buildCliffMeshes(grid, cliffs, models, materials));
  }

  const hud = new Hud(game, map, 0, assets);
  const portrait = new PortraitView(assets);
  const p = hud.playable;
  terrain.material.uniforms.uPlayable.value.set(p.minX, p.minY, p.maxX, p.maxY);

  // --- camera -------------------------------------------------------------------------------------------
  const cam = new RtsCamera(canvas, view.world, (x, y) => grid.heightAt(x, y));
  const cb = map.info.cameraBounds;
  cam.setBounds(Math.min(cb[0], cb[4]), Math.min(cb[1], cb[7]), Math.max(cb[2], cb[6]), Math.max(cb[3], cb[5]));
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    cam.resize(w, h);
  };
  addEventListener('resize', resize);
  resize();

  // --- sounds ---------------------------------------------------------------------------------------------
  const sound = new SoundPlayer(assets);
  game.on('sound', (s) => sound.play(s.file, s.volume, s.pitch));
  // war3map.j main(): SetMapMusic("Music", true, 0) → race playlist from UI\war3skins.txt.
  if (catalog?.music) sound.startMusic(catalog.music);
  const musicBtn = document.getElementById('btn-music')!;
  musicBtn.hidden = !sound.hasMusic;
  const musicLabel = () => {
    musicBtn.classList.toggle('on', sound.musicOn);
    musicBtn.textContent = `Hudba: ${sound.musicOn ? 'zapnuta' : 'vypnuta'}`;
  };
  musicLabel();
  musicBtn.addEventListener('click', () => {
    sound.toggleMusic();
    musicLabel();
  });

  stage('Rozmisťuji doodady a jednotky…');
  await view.buildStatic();
  game.start();
  const myBuilder = game.units.find((u) => u.kind === 'builder' && u.owner === 0);
  if (myBuilder) cam.panTo(myBuilder.x, myBuilder.y);
  hud.onMinimapClick = (x, y) => cam.panTo(x, y);
  // Selection: the first unit is the "primary" one shown in the info panel / command card.
  let group: Unit[] = [];
  let selected: Unit | null = null;
  const setSelection = (units: Unit[]) => {
    group = units.slice(0, 12);
    selected = group[0] ?? null;
    view.selection = new Set(group);
    hud.group = group;
    hud.submenu = null;
  };
  const select = (u: Unit | null) => setSelection(u ? [u] : []);
  hud.onSelect = (u) => {
    select(u);
    if (u) cam.panTo(u.x, u.y);
  };

  // --- pathing overlay (F3) -------------------------------------------------------------------------
  const pathTex = new THREE.DataTexture(new Uint8Array(game.grid.width * game.grid.height * 4), game.grid.width, game.grid.height, THREE.RGBAFormat);
  terrain.material.uniforms.uOverlay.value = pathTex;
  let pathingOn = false;
  const refreshPathing = () => {
    const d = pathTex.image.data as Uint8Array;
    const g = game.grid;
    for (let i = 0; i < g.flags.length; i++) {
      const f = g.flags[i];
      const o = i * 4;
      if (g.occupied[i]) d.set([255, 0, 255, 150], o);
      else if (f & 0x02) d.set([255, 0, 0, 150], o);
      else if (f & 0x08) d.set([255, 210, 0, 110], o);
      else d.set([0, 255, 0, 60], o);
    }
    pathTex.needsUpdate = true;
  };
  const togglePathing = () => {
    pathingOn = !pathingOn;
    terrain.material.uniforms.uOverlayStrength.value = pathingOn ? 1 : 0;
    document.getElementById('btn-pathing')!.classList.toggle('on', pathingOn);
    if (pathingOn) refreshPathing();
  };
  const toggleRegions = () => document.getElementById('btn-regions')!.classList.toggle('on', view.toggleRegions());
  document.getElementById('btn-pathing')!.addEventListener('click', togglePathing);
  document.getElementById('btn-regions')!.addEventListener('click', toggleRegions);
  addEventListener('keydown', (e) => {
    if (e.key === 'Alt') {
      e.preventDefault();
      view.showAllHp = true;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      toggleRegions();
    }
    if (e.key === 'F3') {
      e.preventDefault();
      togglePathing();
    }
  });

  addEventListener('keyup', (e) => {
    if (e.key === 'Alt') view.showAllHp = false;
  });
  addEventListener('blur', () => (view.showAllHp = false));

  // --- mouse --------------------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPoint = (mx: number, my: number) => {
    ndc.set((mx / canvas.clientWidth) * 2 - 1, -(my / canvas.clientHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, cam.camera);
    const hit = raycaster.intersectObject(terrain.mesh, false)[0];
    return hit ? view.world.worldToLocal(hit.point.clone()) : null;
  };
  const mousePos = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // Drag selection box (left button), WC3 style: units preferred over structures, Shift adds/removes.
  const dragBox = document.getElementById('drag-box')!;
  let drag: { x: number; y: number; cx: number; cy: number; active: boolean } | null = null;
  // Mouse-over label: owner name in the player's colour (the creep player is shown red like in the game).
  const creepName = map.info.players.find((p) => p.id === CREEP_PLAYER)?.name ?? 'Creeps';
  const ownerName = (u: Unit) =>
    u.owner === CREEP_PLAYER ? { name: creepName, color: '#ff0303' } : u.owner < game.players.length ? { name: game.players[u.owner].name, color: game.players[u.owner].color } : { name: plainText(u.def.name), color: '#ffffff' };
  canvas.addEventListener('mouseleave', () => view.setHover(null, ownerName));
  canvas.addEventListener('mousemove', (e) => {
    const [mx, my] = mousePos(e);
    view.setHover(drag?.active ? null : view.pick(mx, my, cam.camera, canvas.clientWidth, canvas.clientHeight), ownerName);
    if (drag) {
      drag.cx = mx;
      drag.cy = my;
      if (!drag.active && Math.hypot(mx - drag.x, my - drag.y) > 5) drag.active = true;
      if (drag.active) {
        Object.assign(dragBox.style, { left: `${Math.min(drag.x, mx)}px`, top: `${Math.min(drag.y, my)}px`, width: `${Math.abs(mx - drag.x)}px`, height: `${Math.abs(my - drag.y)}px` });
        dragBox.hidden = false;
      }
    }
    if (hud.mode.kind !== 'build') return;
    const pt = groundPoint(mx, my);
    if (pt) view.showGhost(hud.mode.id, pt.x, pt.y);
  });
  const finishSelection = (e: MouseEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    dragBox.hidden = true;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    let picked: Unit[];
    if (d.active) {
      const inBox = view.unitsInRect(d.x, d.y, d.cx, d.cy, cam.camera, W, H);
      const own = inBox.filter((u) => u.owner === hud.localPlayer);
      const mobile = own.filter((u) => u.speed > 0);
      picked = mobile.length ? mobile : own.length ? own : inBox.slice(0, 1);
    } else {
      const u = view.pick(d.x, d.y, cam.camera, W, H);
      picked = u ? [u] : [];
    }
    if (e.shiftKey && selected && selected.owner === hud.localPlayer) {
      const next = [...group];
      for (const u of picked) {
        if (u.owner !== hud.localPlayer) continue;
        const i = next.indexOf(u);
        if (i >= 0 && !d.active) next.splice(i, 1);
        else if (i < 0) next.push(u);
      }
      setSelection(next);
    } else setSelection(picked);
  };
  addEventListener('mouseup', (e) => {
    if (e.button === 0) finishSelection(e);
  });
  /** Group move: spread the units in a small grid around the target point so they don't stack. */
  const groupMove = (units: Unit[], x: number, y: number) => {
    const movers = units.filter((u) => u.alive && u.owner === hud.localPlayer && u.speed > 0);
    const cols = Math.ceil(Math.sqrt(movers.length));
    movers.forEach((u, i) => {
      const ox = movers.length > 1 ? ((i % cols) - (cols - 1) / 2) * 70 : 0;
      const oy = movers.length > 1 ? (Math.floor(i / cols) - (cols - 1) / 2) * 70 : 0;
      game.orderMove(u, x + ox, y + oy);
    });
    return movers.length;
  };
  canvas.addEventListener('mousedown', (e) => {
    const [mx, my] = mousePos(e);
    if (e.button === 0) {
      if (hud.mode.kind === 'build') {
        const pt = groundPoint(mx, my);
        if (pt && selected) {
          hud.report(game.build(selected, hud.mode.id, pt.x, pt.y));
          if (!e.shiftKey) {
            hud.mode = { kind: 'normal' };
            hud.submenu = null;
            view.showGhost(null);
          }
        }
        return;
      }
      if (hud.mode.kind === 'target' && selected) {
        const target = view.pick(mx, my, cam.camera, canvas.clientWidth, canvas.clientHeight);
        if (hud.mode.ability === 'coin') {
          if (target && target.owner === CREEP_PLAYER) hud.report(game.coinBash(selected, target));
          else hud.report('Must target a creep.');
        } else if (hud.mode.ability === 'move') {
          const pt = groundPoint(mx, my);
          if (pt && groupMove(group, pt.x, pt.y)) view.orderConfirmation(pt.x, pt.y);
        } else if (hud.mode.ability === 'attack') {
          const own = group.filter((u) => u.alive && u.owner === hud.localPlayer);
          if (target && target.owner === CREEP_PLAYER && own.some((u) => u.def.attack)) {
            for (const u of own) if (u.def.attack) game.orderAttack(u, target);
            view.orderConfirmation(target.x, target.y, 'attack', true);
          } else {
            const pt = groundPoint(mx, my);
            if (pt && groupMove(own, pt.x, pt.y)) view.orderConfirmation(pt.x, pt.y, 'attack');
          }
        }
        hud.mode = { kind: 'normal' };
        return;
      }
      drag = { x: mx, y: my, cx: mx, cy: my, active: false };
    } else if (e.button === 2) {
      if (hud.mode.kind !== 'normal') {
        hud.mode = { kind: 'normal' };
        view.showGhost(null);
        return;
      }
      const own = group.filter((u) => u.alive && u.owner === hud.localPlayer);
      if (!own.length) return;
      const target = view.pick(mx, my, cam.camera, canvas.clientWidth, canvas.clientHeight);
      if (target && target.owner === CREEP_PLAYER && own.some((u) => u.def.attack)) {
        for (const u of own) if (u.def.attack) game.orderAttack(u, target);
        view.orderConfirmation(target.x, target.y, 'attack', true);
      } else {
        const pt = groundPoint(mx, my);
        if (pt && groupMove(own, pt.x, pt.y)) view.orderConfirmation(pt.x, pt.y);
      }
    }
  });

  stage('Hotovo');
  loadingEl().hidden = true;

  // --- loop ----------------------------------------------------------------------------------------------
  let last = performance.now();
  let pathingTimer = 0;
  const frustumCorners = () => {
    const pts: { x: number; y: number }[] = [];
    for (const [sx, sy] of [[0, 0], [canvas.clientWidth, 0], [canvas.clientWidth, canvas.clientHeight], [0, canvas.clientHeight]]) {
      const pt = groundPoint(sx, sy);
      if (pt) pts.push({ x: pt.x, y: pt.y });
    }
    return pts;
  };
  const frame = (dt: number) => {
    game.update(dt);
    cam.update(dt);
    // Dead / removed units drop out of the selection (a dying creep stays selected until removed, as in WC3).
    if (group.some((u) => !game.units.includes(u) || (!u.alive && u.owner !== CREEP_PLAYER))) {
      setSelection(group.filter((u) => game.units.includes(u) && (u.alive || u.owner === CREEP_PLAYER)));
    }
    if (hud.mode.kind !== 'build') view.showGhost(null);
    view.update(dt, cam.camera, canvas.clientWidth, canvas.clientHeight);
    hud.update(selected);
    portrait.setUnit(selected && (selected.alive || selected.owner === CREEP_PLAYER) ? selected : null);
    portrait.update(game.paused ? 0 : dt);
    hud.drawMinimap(frustumCorners());
    if (pathingOn && (pathingTimer += dt) > 0.5) {
      pathingTimer = 0;
      refreshPathing();
    }
    renderer.render(scene, cam.camera);
    portrait.render(renderer, hud.portraitRect(), canvas.clientHeight);
  };
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Handy for debugging from the console (frame() advances one tick even when the tab is hidden).
  Object.assign(window as object, { game, view, cam, db, map, hud, frame, portrait });
}

main().catch((e) => {
  console.error(e);
  document.getElementById('loading')!.textContent = `Chyba: ${e?.message ?? e}`;
});
