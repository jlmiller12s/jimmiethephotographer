import * as THREE from "three";
import { photos } from "./gallery-data.js";
import "./styles.css";

const canvas = document.querySelector("#gallery-canvas");
const minimap = document.querySelector("#minimap");
const minimapContext = minimap.getContext("2d");
const frameCount = document.querySelector("#frame-count");
const frameTitle = document.querySelector("#frame-title");
const introOverlay = document.querySelector("#intro-overlay");
const enterButton = document.querySelector("#enter-button");
const loadCanvas = document.querySelector("#load-canvas");
const loadContext = loadCanvas.getContext("2d");
const loadNumber = document.querySelector("#load-number");
const prevButton = document.querySelector("#prev-frame");
const nextButton = document.querySelector("#next-frame");
const closeFocusButton = document.querySelector("#close-focus");
const overviewButton = document.querySelector("#overview-mode");
const tourButton = document.querySelector("#tour-mode");
const inspectButton = document.querySelector("#inspect-mode");
const helpButton = document.querySelector("#help-mode");
const thumbGrid = document.querySelector("#thumb-grid");
const tutorialOverlay = document.querySelector("#tutorial-overlay");
const tutorialClose = document.querySelector("#tutorial-close");
const tutorialStart = document.querySelector("#tutorial-start");
const minimapMedia = window.matchMedia("(min-width: 561px)");

const WALL_Z = -4.8;
const CAMERA_Z = 4.7;
const INSPECT_Z = -3.35;
const OVERVIEW_Z = 9.6;
const FRAME_MARGIN = 0.95;
const layout = createWallLayout();
const galleryWidth = layout.at(-1).right - layout[0].left;

function getRenderPixelRatio() {
  const cap = window.innerWidth < 700 ? 1 : 1.35;
  return Math.min(window.devicePixelRatio || 1, cap);
}

function clampProgress(value) {
  return THREE.MathUtils.clamp(value, 0, photos.length - 1);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
scene.fog = new THREE.Fog(0x050505, 24, galleryWidth + 36);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: window.innerWidth >= 700,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(getRenderPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, galleryWidth + 80);
camera.position.set(layout[0].x, 2.45, CAMERA_Z);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const mouse = new THREE.Vector2();
const clock = new THREE.Clock();
const frames = [];
const lookScratch = new THREE.Vector3();
const targetScratch = new THREE.Vector3();
let frameTick = 0;

const state = {
  activeIndex: 0,
  targetIndex: 0,
  entered: false,
  focused: true,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragStartProgress: 0,
  dragStartDepth: 0,
  progress: 0,
  targetProgress: 0,
  depth: 0,
  targetDepth: 0,
  lookOffset: new THREE.Vector2(0, 0),
  targetLookOffset: new THREE.Vector2(0, 0),
  loadProgress: 0
};

const urlParams = new URLSearchParams(window.location.search);
const shouldAutoStart = urlParams.has("autostart");
const shouldAutoInspect = urlParams.has("inspect");
const tutorialStorageKey = "jtp-gallery-tutorial-seen";
if (shouldAutoStart) introOverlay.classList.add("is-instant");

const materials = {
  wall: new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.82,
    metalness: 0.03
  }),
  frame: new THREE.MeshStandardMaterial({
    color: 0x070707,
    roughness: 0.56,
    metalness: 0.28
  }),
  mat: new THREE.MeshStandardMaterial({
    color: 0xf1ece2,
    roughness: 0.78
  }),
  floor: new THREE.MeshStandardMaterial({
    color: 0x070707,
    roughness: 0.84,
    metalness: 0.16
  }),
  rail: new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.12
  })
};

buildRoom();
buildFrames();
buildThumbnails();
bindEvents();
updateLabel(0);
animate();

function createWallLayout() {
  const sizes = photos.map((photo) => {
    const ratio = photo.width / photo.height;
    const isWide = ratio > 1.15;
    const isSquare = Math.abs(ratio - 1) < 0.08;
    const height = isWide ? 2.05 : isSquare ? 2.18 : 2.65;
    const width = height * ratio;
    return {
      width,
      height,
      outerWidth: width + 0.78
    };
  });

  const total = sizes.reduce((sum, size) => sum + size.outerWidth, 0) + FRAME_MARGIN * (sizes.length - 1);
  let cursor = -total / 2;

  return sizes.map((size, index) => {
    const left = cursor;
    const right = cursor + size.outerWidth;
    const x = (left + right) / 2;
    cursor = right + FRAME_MARGIN;
    return {
      ...size,
      index,
      x,
      left,
      right
    };
  });
}

function sampleWall(progress) {
  const index = Math.floor(clampProgress(progress));
  const next = Math.min(index + 1, layout.length - 1);
  const amount = progress - index;
  return THREE.MathUtils.lerp(layout[index].x, layout[next].x, amount);
}

function buildRoom() {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(galleryWidth + 9, 5.6, 0.22), materials.wall);
  wall.position.set(0, 2.38, WALL_Z - 0.16);
  scene.add(wall);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(galleryWidth + 12, 0.08, 12.6), materials.floor);
  floor.position.set(0, -0.04, 0.65);
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(galleryWidth + 12, 0.08, 12.6),
    new THREE.MeshStandardMaterial({
      color: 0x080808,
      roughness: 0.9
    })
  );
  ceiling.position.set(0, 5.16, 0.65);
  scene.add(ceiling);

  const baseLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-galleryWidth / 2 - 4, 0.025, -3.65),
      new THREE.Vector3(galleryWidth / 2 + 4, 0.025, -3.65)
    ]),
    materials.rail
  );
  scene.add(baseLine);

  for (let z = -2.2; z <= 4.8; z += 1.6) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-galleryWidth / 2 - 4, 0.03, z),
        new THREE.Vector3(galleryWidth / 2 + 4, 0.03, z)
      ]),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: z < 0 ? 0.045 : 0.025
      })
    );
    scene.add(line);
  }

  for (let i = 0; i < layout.length; i += 4) {
    const seam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(layout[i].left - FRAME_MARGIN / 2, 0.2, WALL_Z - 0.035),
        new THREE.Vector3(layout[i].left - FRAME_MARGIN / 2, 4.85, WALL_Z - 0.035)
      ]),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.025
      })
    );
    scene.add(seam);
  }

  const ambient = new THREE.HemisphereLight(0xd7e7ff, 0x090503, 1.42);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xfff2df, 2.2);
  keyLight.position.set(0, 6.4, 6.2);
  scene.add(keyLight);

  const warmWash = new THREE.PointLight(0xffd19a, 18, 24, 1.35);
  warmWash.position.set(layout[6]?.x ?? -8, 3.8, 2.2);
  scene.add(warmWash);

  const coolWash = new THREE.PointLight(0xa9cfff, 14, 28, 1.45);
  coolWash.position.set(layout[22]?.x ?? 8, 3.4, 2.8);
  scene.add(coolWash);
}

function buildFrames() {
  const textureLoader = new THREE.TextureLoader();
  textureLoader.manager.onProgress = (_url, loaded, total) => {
    state.loadProgress = total ? loaded / total : 1;
    drawLoading(state.loadProgress);
  };
  textureLoader.manager.onLoad = () => {
    state.loadProgress = 1;
    drawLoading(1);
    enterButton.disabled = false;
    enterButton.classList.add("is-ready");
    if (shouldAutoStart) startGallery();
  };

  photos.forEach((photo, index) => {
    const spot = layout[index];
    const group = new THREE.Group();
    group.position.set(spot.x, 2.44, WALL_Z + 0.05);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(spot.width + 0.72, spot.height + 0.72, 0.18),
      materials.frame
    );
    frame.position.z = -0.11;
    group.add(frame);

    const matBoard = new THREE.Mesh(
      new THREE.BoxGeometry(spot.width + 0.42, spot.height + 0.42, 0.08),
      materials.mat
    );
    matBoard.position.z = -0.035;
    group.add(matBoard);

    const texture = textureLoader.load(photo.src);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 2);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const imageMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide
    });
    const image = new THREE.Mesh(new THREE.PlaneGeometry(spot.width, spot.height), imageMaterial);
    image.userData.index = index;
    image.userData.kind = "photo";
    image.position.z = 0.03;
    group.add(image);

    const plaque = makePlaque(`${String(index + 1).padStart(2, "0")}  ${photo.category}`);
    plaque.position.set(0, -spot.height / 2 - 0.44, 0.055);
    group.add(plaque);

    scene.add(group);
    frames.push({ group, image, photo, position: group.position, width: spot.width, height: spot.height });
  });

  enterButton.disabled = true;
  drawLoading(0);
}

function makePlaque(text) {
  const plaqueCanvas = document.createElement("canvas");
  plaqueCanvas.width = 512;
  plaqueCanvas.height = 96;
  const context = plaqueCanvas.getContext("2d");
  context.fillStyle = "rgba(8, 8, 8, 0.78)";
  context.fillRect(0, 0, plaqueCanvas.width, plaqueCanvas.height);
  context.strokeStyle = "rgba(255, 255, 255, 0.16)";
  context.strokeRect(12, 12, plaqueCanvas.width - 24, plaqueCanvas.height - 24);
  context.font = "500 34px Arial, sans-serif";
  context.fillStyle = "rgba(255, 255, 255, 0.86)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text.toUpperCase(), plaqueCanvas.width / 2, plaqueCanvas.height / 2 + 1);
  const texture = new THREE.CanvasTexture(plaqueCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.3), material);
}

function buildThumbnails() {
  photos.forEach((photo, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb-button";
    button.innerHTML = `
      <img src="${photo.src}" alt="" loading="lazy" />
      <span>${String(index + 1).padStart(2, "0")}</span>
    `;
    button.addEventListener("click", () => {
      closePanels();
      focusFrame(index);
    });
    thumbGrid.appendChild(button);
  });
}

function bindEvents() {
  enterButton.addEventListener("click", startGallery);

  prevButton.addEventListener("click", () => focusFrame(Math.round(state.targetProgress) - 1));
  nextButton.addEventListener("click", () => focusFrame(Math.round(state.targetProgress) + 1));

  closeFocusButton.addEventListener("click", () => {
    if (state.targetDepth > 0.08) setInspectionDepth(0);
    else setOverview();
  });
  overviewButton.addEventListener("click", setOverview);
  tourButton.addEventListener("click", () => {
    state.focused = true;
    setInspectionDepth(0);
    document.body.classList.add("is-focused");
    overviewButton.classList.remove("is-active");
    tourButton.classList.add("is-active");
  });
  inspectButton.addEventListener("click", () => {
    state.focused = true;
    focusFrame(Math.round(state.targetProgress));
    setInspectionDepth(state.targetDepth > 0.55 ? 0 : 1);
  });
  helpButton.addEventListener("click", () => showTutorial(true));
  tutorialClose.addEventListener("click", hideTutorial);
  tutorialStart.addEventListener("click", hideTutorial);
  tutorialOverlay.addEventListener("click", (event) => {
    if (event.target === tutorialOverlay) hideTutorial();
  });

  document.querySelectorAll("[data-panel]").forEach((button) => {
    button.addEventListener("click", () => openPanel(button.dataset.panel));
  });
  document.querySelectorAll("[data-panel-close]").forEach((button) => {
    button.addEventListener("click", closePanels);
  });

  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);
}

function startGallery() {
  if (state.entered) return;
  state.entered = true;
  state.focused = true;
  introOverlay.classList.add("is-hidden");
  document.body.classList.add("gallery-entered", "is-focused");
  focusFrame(state.activeIndex);
  if (shouldAutoInspect) setInspectionDepth(1);
  window.setTimeout(() => showTutorial(), 520);
}

function showTutorial(force = false) {
  if (!force && localStorage.getItem(tutorialStorageKey) === "true") return;
  tutorialOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("tutorial-open");
}

function hideTutorial() {
  tutorialOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("tutorial-open");
  localStorage.setItem(tutorialStorageKey, "true");
}

function onPointerDown(event) {
  if (event.target.closest("button, a, aside")) return;
  state.dragging = true;
  state.dragStartX = event.clientX;
  state.dragStartY = event.clientY;
  state.dragStartProgress = state.targetProgress;
  state.dragStartDepth = state.targetDepth;
}

function onPointerMove(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  if (!state.dragging) return;
  const dx = (event.clientX - state.dragStartX) / window.innerWidth;
  const dy = (event.clientY - state.dragStartY) / window.innerHeight;
  state.targetProgress = clampProgress(state.dragStartProgress - dx * 7.5);
  state.targetDepth = THREE.MathUtils.clamp(state.dragStartDepth + dy * 1.65, 0, 1);
  state.targetLookOffset.x = THREE.MathUtils.clamp(dx * 0.7, -0.38, 0.38);
  state.targetLookOffset.y = THREE.MathUtils.clamp(-dy * 1.2, -0.34, 0.34);
  updateDepthUi();
}

function onPointerUp(event) {
  if (!state.dragging) return;
  const moved = Math.hypot(event.clientX - state.dragStartX, event.clientY - state.dragStartY);
  state.dragging = false;
  state.targetLookOffset.multiplyScalar(0.18);
  if (moved > 8 || event.target.closest("button, a, aside")) return;
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(frames.map((frame) => frame.image), false);
  if (hits.length) inspectFrame(hits[0].object.userData.index);
}

function onWheel(event) {
  if (!state.entered || event.target.closest("aside")) return;
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? window.innerHeight : 1;
  if (event.ctrlKey || event.shiftKey) {
    const depthAmount = event.deltaY * unit * -0.003;
    setInspectionDepth(state.targetDepth + depthAmount);
    return;
  }
  const scrollAmount = event.deltaY * unit * 0.0055;
  state.targetProgress = clampProgress(state.targetProgress + scrollAmount);
  state.focused = true;
  document.body.classList.add("is-focused");
  overviewButton.classList.remove("is-active");
  tourButton.classList.add("is-active");
}

function onKeyDown(event) {
  if (!state.entered) return;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") focusFrame(Math.round(state.targetProgress) + 1);
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") focusFrame(Math.round(state.targetProgress) - 1);
  if (event.key.toLowerCase() === "w" || event.key === "+" || event.key === "=") {
    setInspectionDepth(state.targetDepth + 0.22);
  }
  if (event.key.toLowerCase() === "s" || event.key === "-") setInspectionDepth(state.targetDepth - 0.22);
  if (event.key === "Home") focusFrame(0);
  if (event.key === "End") focusFrame(photos.length - 1);
  if (event.key === "Escape") {
    if (document.body.classList.contains("tutorial-open")) hideTutorial();
    else if (document.body.classList.contains("panel-open")) closePanels();
    else setOverview();
  }
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(getRenderPixelRatio());
  renderer.setSize(width, height);
}

function focusFrame(index) {
  const next = clampProgress(index);
  state.targetProgress = next;
  state.targetIndex = Math.round(next);
  state.focused = true;
  state.targetLookOffset.set(0, 0);
  document.body.classList.add("is-focused");
  overviewButton.classList.remove("is-active");
  tourButton.classList.add("is-active");
}

function inspectFrame(index) {
  focusFrame(index);
  setInspectionDepth(1);
}

function setInspectionDepth(value) {
  state.targetDepth = THREE.MathUtils.clamp(value, 0, 1);
  if (state.targetDepth > 0.02) {
    state.focused = true;
    document.body.classList.add("is-focused");
    overviewButton.classList.remove("is-active");
    tourButton.classList.remove("is-active");
  }
  updateDepthUi();
}

function setOverview() {
  state.focused = false;
  setInspectionDepth(0);
  state.targetLookOffset.set(0, 0);
  document.body.classList.remove("is-focused");
  overviewButton.classList.add("is-active");
  tourButton.classList.remove("is-active");
}

function updateDepthUi() {
  const inspecting = state.targetDepth > 0.12;
  document.body.classList.toggle("is-inspecting", inspecting);
  inspectButton.classList.toggle("is-active", inspecting);
  tourButton.classList.toggle("is-active", state.focused && !inspecting);
  if (!state.focused) overviewButton.classList.add("is-active");
}

function openPanel(name) {
  closePanels();
  const panel = document.querySelector(`#${name}-panel`);
  if (!panel) return;
  panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("panel-open");
}

function closePanels() {
  document.querySelectorAll(".panel, .index-panel").forEach((panel) => {
    panel.setAttribute("aria-hidden", "true");
  });
  document.body.classList.remove("panel-open");
}

function updateActiveFromProgress(progress) {
  const index = Math.round(clampProgress(progress));
  if (index === state.activeIndex) return;
  state.activeIndex = index;
  updateLabel(index);
  updateThumbState(index);
}

function updateLabel(index) {
  const photo = photos[index];
  frameCount.textContent = `${String(index + 1).padStart(2, "0")} frame`;
  frameTitle.textContent = `${photo.title} | ${photo.category}`;
}

function updateThumbState(index) {
  thumbGrid.querySelectorAll(".thumb-button").forEach((button, buttonIndex) => {
    button.classList.toggle("is-active", buttonIndex === index);
  });
}

function drawLoading(progress) {
  const width = loadCanvas.width;
  const height = loadCanvas.height;
  const x = width / 2;
  const y = height / 2;
  const radius = 44;
  loadContext.clearRect(0, 0, width, height);
  for (let i = 0; i < 42; i += 1) {
    const angle = (i / 42) * Math.PI * 2 - Math.PI / 2;
    const filled = i / 42 <= progress;
    loadContext.beginPath();
    loadContext.arc(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, filled ? 2.7 : 2.1, 0, Math.PI * 2);
    loadContext.fillStyle = filled ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.14)";
    loadContext.fill();
  }
  loadNumber.textContent = String(Math.round(progress * 100)).padStart(3, "0");
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  frameTick += 1;

  if (!frames.length) return;

  state.progress = THREE.MathUtils.damp(state.progress, state.targetProgress, 4.4, delta);
  state.depth = THREE.MathUtils.damp(state.depth, state.targetDepth, 5.2, delta);
  updateActiveFromProgress(state.progress);

  const walkX = sampleWall(state.progress);
  const lookZ = WALL_Z + 0.02;
  const focusedZ = THREE.MathUtils.lerp(CAMERA_Z, INSPECT_Z, state.depth);
  const cameraZ = state.focused ? focusedZ : OVERVIEW_Z;
  const cameraY = state.focused ? THREE.MathUtils.lerp(2.5, 2.42, state.depth) : 3.65;
  const lookY = state.focused ? THREE.MathUtils.lerp(2.42, 2.44, state.depth) : 2.6;

  targetScratch.set(walkX, cameraY, cameraZ);
  camera.position.lerp(targetScratch, 1 - Math.exp(-(state.depth > 0.08 ? 7.2 : 8.5) * delta));

  state.lookOffset.lerp(state.targetLookOffset, 1 - Math.exp(-7 * delta));
  const look = lookScratch.set(
    walkX + state.lookOffset.x * 1.65 + mouse.x * 0.12,
    lookY + state.lookOffset.y * 1.1 + mouse.y * 0.05,
    lookZ
  );
  camera.lookAt(look);

  frames.forEach((frame, index) => {
    const distance = Math.abs(index - state.progress);
    const influence = THREE.MathUtils.clamp(1 - distance / 2.25, 0, 1);
    const scale = THREE.MathUtils.damp(frame.group.scale.x, 1 + influence * (0.045 + state.depth * 0.045), 8, delta);
    const brightness = THREE.MathUtils.damp(frame.image.material.color.r, 0.62 + influence * 0.38, 8, delta);
    frame.group.scale.setScalar(scale);
    frame.image.material.color.setScalar(brightness);
  });

  if (state.entered && minimapMedia.matches && frameTick % 2 === 0) drawMinimap();
  renderer.render(scene, camera);
}

function drawMinimap() {
  const size = minimap.width;
  const mid = size / 2;
  const lineStart = 26;
  const lineEnd = size - 26;
  const t = photos.length <= 1 ? 0 : state.progress / (photos.length - 1);
  const cameraX = THREE.MathUtils.lerp(lineStart, lineEnd, t);
  const cameraY = THREE.MathUtils.lerp(mid + 12, mid - 6, state.depth);

  minimapContext.clearRect(0, 0, size, size);
  minimapContext.save();
  minimapContext.beginPath();
  minimapContext.arc(mid, mid, mid - 4, 0, Math.PI * 2);
  minimapContext.clip();
  minimapContext.fillStyle = "rgba(246, 246, 242, 0.92)";
  minimapContext.fillRect(0, 0, size, size);

  minimapContext.strokeStyle = "rgba(0, 0, 0, 0.24)";
  minimapContext.lineWidth = 2;
  minimapContext.beginPath();
  minimapContext.moveTo(lineStart, mid - 18);
  minimapContext.lineTo(lineEnd, mid - 18);
  minimapContext.stroke();

  photos.forEach((_photo, index) => {
    const dotT = photos.length <= 1 ? 0 : index / (photos.length - 1);
    const x = THREE.MathUtils.lerp(lineStart, lineEnd, dotT);
    minimapContext.beginPath();
    minimapContext.arc(x, mid - 18, index === state.activeIndex ? 4.2 : 2.1, 0, Math.PI * 2);
    minimapContext.fillStyle = index === state.activeIndex ? "#ff1745" : "rgba(0, 0, 0, 0.28)";
    minimapContext.fill();
  });

  minimapContext.beginPath();
  minimapContext.moveTo(cameraX, cameraY);
  minimapContext.lineTo(cameraX - 8, cameraY - 16);
  minimapContext.lineTo(cameraX + 8, cameraY - 16);
  minimapContext.closePath();
  minimapContext.fillStyle = "rgba(255, 0, 51, 0.86)";
  minimapContext.fill();

  minimapContext.fillStyle = "rgba(20,20,20,0.56)";
  minimapContext.font = "700 10px Arial, sans-serif";
  minimapContext.textAlign = "center";
  minimapContext.fillText(state.depth > 0.55 ? "CLOSE" : "WALL", mid, mid + 24);
  minimapContext.fillText("WALK", mid, mid + 38);
  minimapContext.restore();
}
