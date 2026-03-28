/* ============================================================
   Frontier Tower TV — 3D Building + Elevator (Three.js)
   ============================================================ */

let scene, camera, renderer;
let animationId = null;
let buildingGroup;
let windowMeshes = [];
let elevatorMesh, elevatorLight;
let basementGlow;
let time = 0;

const FLOOR_H = 0.8;
const B_W = 4.2;
const B_D = 3.0;
const B_X = 3;
let TOTAL_H = 0;
let NUM_FLOORS = 16;

let cam = { x: 0, y: 6, z: 0 };
let camLook = { x: B_X, y: 4.5, z: 0 };
let camGoal = { x: 0, y: 6, z: 0 };
let camLookGoal = { x: B_X, y: 4.5, z: 0 };
const CAM_LERP = 0.025;

let mode = 'overview';
let elevY = FLOOR_H * 0.5;
let elevStartY = 0;
let elevEndY = 0;
let elevProgress = 0;
let elevSpeed = 0;
let elevCb = null;

function _lerp(a, b, t) { return a + (b - a) * t; }
function _easeInOut(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2; }

function floorToY(floorNum) {
  if (floorNum === 0) return FLOOR_H * 0.15;
  if (floorNum > NUM_FLOORS) return TOTAL_H + FLOOR_H * 0.3;
  return (floorNum - 1) * FLOOR_H + FLOOR_H * 0.5;
}

// ---- Init ----

function initBuilding(canvas) {
  NUM_FLOORS = (typeof CONFIG !== 'undefined' && CONFIG.BUILDING_FLOOR_COUNT)
    ? CONFIG.BUILDING_FLOOR_COUNT : 16;
  TOTAL_H = NUM_FLOORS * FLOOR_H;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);

  camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 120);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  scene.add(new THREE.AmbientLight(0x303050, 0.5));

  const dirLight = new THREE.DirectionalLight(0xeeeeff, 0.6);
  dirLight.position.set(10, 18, 8);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -15;
  dirLight.shadow.camera.right = 15;
  dirLight.shadow.camera.top = 15;
  dirLight.shadow.camera.bottom = -15;
  scene.add(dirLight);

  const coolLight = new THREE.PointLight(0xccddff, 0.5, 30);
  coolLight.position.set(-6, 2, 6);
  scene.add(coolLight);

  const warmLight = new THREE.PointLight(0xffeedd, 0.3, 30);
  warmLight.position.set(6, 10, -6);
  scene.add(warmLight);

  buildingGroup = new THREE.Group();
  createTower();
  createElevator();
  buildingGroup.position.x = B_X;
  scene.add(buildingGroup);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    new THREE.MeshStandardMaterial({ color: 0x08080e, roughness: 0.9, metalness: 0.1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(50, 50, 0x101018, 0x101018);
  grid.position.y = 0.01;
  scene.add(grid);

  const initAngle = Math.PI * 0.25;
  cam.x = B_X + 16 * Math.cos(initAngle);
  cam.z = 16 * Math.sin(initAngle);
  cam.y = 6;
  Object.assign(camGoal, { ...cam });
  Object.assign(camLookGoal, { ...camLook });
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(camLook.x, camLook.y, camLook.z);
}

// ---- Tower geometry ----

function createTower() {
  windowMeshes = [];

  // Floor slabs
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x22223a, roughness: 0.5, metalness: 0.4 });
  for (let i = 0; i <= NUM_FLOORS; i++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(B_W + 0.35, 0.07, B_D + 0.35), slabMat);
    slab.position.y = i * FLOOR_H;
    slab.castShadow = true;
    slab.receiveShadow = true;
    buildingGroup.add(slab);
  }

  // Corner columns
  const colMat = new THREE.MeshStandardMaterial({ color: 0x2a2a48, roughness: 0.3, metalness: 0.7 });
  for (const [cx, cz] of [[-B_W/2,-B_D/2],[B_W/2,-B_D/2],[-B_W/2,B_D/2],[B_W/2,B_D/2]]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.18, TOTAL_H, 0.18), colMat);
    col.position.set(cx, TOTAL_H / 2, cz);
    col.castShadow = true;
    buildingGroup.add(col);
  }

  // Glass windows
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x938DEE, emissive: 0x150d25, emissiveIntensity: 0.4,
    roughness: 0.05, metalness: 0.95,
    transparent: true, opacity: 0.5, side: THREE.DoubleSide,
  });

  const nWX = 8, wW = (B_W - 0.5) / nWX;
  const nWZ = 6, wD = (B_D - 0.5) / nWZ;

  for (let f = 0; f < NUM_FLOORS; f++) {
    const y = f * FLOOR_H + FLOOR_H * 0.5;
    const pH = FLOOR_H * 0.65;

    for (let w = 0; w < nWX; w++) {
      const x = -B_W/2 + 0.25 + wW * (w + 0.5);
      const geo = new THREE.PlaneGeometry(wW * 0.82, pH);

      const front = new THREE.Mesh(geo, glassMat.clone());
      front.position.set(x, y, B_D/2 + 0.01);
      front._floorIndex = f;
      buildingGroup.add(front);
      windowMeshes.push(front);

      const back = new THREE.Mesh(geo, glassMat.clone());
      back.position.set(x, y, -B_D/2 - 0.01);
      back.rotation.y = Math.PI;
      back._floorIndex = f;
      buildingGroup.add(back);
      windowMeshes.push(back);
    }

    for (let w = 0; w < nWZ; w++) {
      const z = -B_D/2 + 0.25 + wD * (w + 0.5);
      const geo = new THREE.PlaneGeometry(wD * 0.82, pH);

      const left = new THREE.Mesh(geo, glassMat.clone());
      left.position.set(-B_W/2 - 0.01, y, z);
      left.rotation.y = -Math.PI / 2;
      left._floorIndex = f;
      buildingGroup.add(left);
      windowMeshes.push(left);

      const right = new THREE.Mesh(geo, glassMat.clone());
      right.position.set(B_W/2 + 0.01, y, z);
      right.rotation.y = Math.PI / 2;
      right._floorIndex = f;
      buildingGroup.add(right);
      windowMeshes.push(right);
    }
  }

  // ---- Rooftop deck ----
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.6, metalness: 0.3 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(B_W + 0.5, 0.08, B_D + 0.5), deckMat);
  deck.position.y = TOTAL_H;
  deck.castShadow = true;
  buildingGroup.add(deck);

  // Railings
  const railMat = new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.3, metalness: 0.7 });
  const railH = 0.25, railW = 0.04;
  const dW = B_W + 0.5, dD = B_D + 0.5;

  const frontRail = new THREE.Mesh(new THREE.BoxGeometry(dW, railH, railW), railMat);
  frontRail.position.set(0, TOTAL_H + railH/2, dD/2);
  buildingGroup.add(frontRail);

  const backRail = new THREE.Mesh(new THREE.BoxGeometry(dW, railH, railW), railMat);
  backRail.position.set(0, TOTAL_H + railH/2, -dD/2);
  buildingGroup.add(backRail);

  const leftRail = new THREE.Mesh(new THREE.BoxGeometry(railW, railH, dD), railMat);
  leftRail.position.set(-dW/2, TOTAL_H + railH/2, 0);
  buildingGroup.add(leftRail);

  const rightRail = new THREE.Mesh(new THREE.BoxGeometry(railW, railH, dD), railMat);
  rightRail.position.set(dW/2, TOTAL_H + railH/2, 0);
  buildingGroup.add(rightRail);

  // ---- Basement / The Underground ----
  basementGlow = new THREE.PointLight(0x764AE2, 0.3, 6);
  basementGlow.position.set(0, -0.2, B_D/2 * 0.5);
  buildingGroup.add(basementGlow);

  const entranceMat = new THREE.MeshStandardMaterial({
    color: 0x1a1025, emissive: 0x1a0a30, emissiveIntensity: 0.4,
    roughness: 0.5, metalness: 0.3,
  });
  const entrance = new THREE.Mesh(new THREE.BoxGeometry(B_W * 0.4, 0.04, 0.6), entranceMat);
  entrance.position.set(0, 0.02, B_D/2 + 0.3);
  buildingGroup.add(entrance);

  // Entrance canopy
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(B_W * 0.6, 0.06, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x1a1a30, roughness: 0.4, metalness: 0.5 })
  );
  canopy.position.set(0, 0.35, B_D/2 + 0.75);
  canopy.castShadow = true;
  buildingGroup.add(canopy);
}

// ---- Elevator ----

function createElevator() {
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, TOTAL_H + FLOOR_H, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.3, metalness: 0.7 })
  );
  shaft.position.set(-B_W/2 - 0.35, TOTAL_H/2 - FLOOR_H/2, B_D * 0.15);
  buildingGroup.add(shaft);

  elevatorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.5, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0.6,
      roughness: 0.2, metalness: 0.5,
    })
  );
  elevY = FLOOR_H * 0.5;
  elevatorMesh.position.set(-B_W/2 - 0.35, elevY, B_D * 0.15);
  buildingGroup.add(elevatorMesh);

  elevatorLight = new THREE.PointLight(0xffffff, 0.4, 5);
  elevatorLight.position.copy(elevatorMesh.position);
  buildingGroup.add(elevatorLight);
}

// ---- Public API ----

function showOverview() { mode = 'overview'; }

function sendElevatorToFloor(floorNum, callback) {
  elevStartY = elevY;
  elevEndY = floorToY(floorNum);
  elevProgress = 0;

  const dist = Math.abs(elevEndY - elevStartY);
  const maxDist = TOTAL_H + FLOOR_H;
  const frames = 90 + (dist / maxDist) * 90;
  elevSpeed = 1 / frames;

  mode = 'elevator';
  elevCb = callback;
}

function showFloorSpotlight(floorNum) {
  mode = 'spotlight';
  const y = floorToY(floorNum);
  camLookGoal.y = y;
  camGoal.y = y + 1.5;
}

// ---- Animation ----

let spotlightFloorIndex = -1;

function animateBuilding() {
  animationId = requestAnimationFrame(animateBuilding);
  time += 0.001;

  switch (mode) {
    case 'overview': {
      const angle = Math.PI * 0.25 + Math.sin(time) * 0.5;
      camGoal.x = B_X + 16 * Math.cos(angle);
      camGoal.z = 16 * Math.sin(angle);
      camGoal.y = 6 + Math.sin(time * 0.5) * 1.5;
      camLookGoal.x = B_X;
      camLookGoal.y = 4.5;
      camLookGoal.z = 0;
      spotlightFloorIndex = -1;
      break;
    }

    case 'elevator': {
      elevProgress = Math.min(1, elevProgress + elevSpeed);
      const eased = _easeInOut(elevProgress);
      elevY = elevStartY + (elevEndY - elevStartY) * eased;

      elevatorMesh.position.y = elevY;
      elevatorLight.position.y = elevY;

      const angle = Math.PI * 0.32;
      camGoal.x = B_X + 13 * Math.cos(angle);
      camGoal.z = 13 * Math.sin(angle);
      camGoal.y = elevY + 2.5;
      camLookGoal.x = B_X;
      camLookGoal.y = elevY;
      camLookGoal.z = 0;
      spotlightFloorIndex = -1;

      if (elevProgress >= 1 && elevCb) {
        const cb = elevCb;
        elevCb = null;
        cb();
      }
      break;
    }

    case 'spotlight': {
      const sway = Math.sin(time * 3) * 0.15;
      const angle = Math.PI * 0.28 + sway;
      camGoal.x = B_X + 10 * Math.cos(angle);
      camGoal.z = 10 * Math.sin(angle);
      spotlightFloorIndex = Math.round((camLookGoal.y - FLOOR_H * 0.5) / FLOOR_H);
      if (spotlightFloorIndex < 0 || spotlightFloorIndex >= NUM_FLOORS) spotlightFloorIndex = -1;
      break;
    }
  }

  cam.x = _lerp(cam.x, camGoal.x, CAM_LERP);
  cam.y = _lerp(cam.y, camGoal.y, CAM_LERP);
  cam.z = _lerp(cam.z, camGoal.z, CAM_LERP);
  camLook.x = _lerp(camLook.x, camLookGoal.x, CAM_LERP);
  camLook.y = _lerp(camLook.y, camLookGoal.y, CAM_LERP);
  camLook.z = _lerp(camLook.z, camLookGoal.z, CAM_LERP);

  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(camLook.x, camLook.y, camLook.z);

  // Window glow
  for (let i = 0; i < windowMeshes.length; i++) {
    const mesh = windowMeshes[i];
    const mat = mesh.material;
    const baseGlow = Math.sin(time * 2.5 + i * 0.37) * 0.5 + 0.5;

    if (spotlightFloorIndex >= 0 && mesh._floorIndex === spotlightFloorIndex) {
      mat.emissiveIntensity = 0.6 + baseGlow * 0.4;
      mat.opacity = 0.6 + baseGlow * 0.3;
      mat.emissive.setHex(0x2a1a4a);
    } else {
      mat.emissiveIntensity = 0.2 + baseGlow * 0.5;
      mat.opacity = 0.35 + baseGlow * 0.35;
      mat.emissive.setHex(0x112233);
    }
  }

  // Basement glow pulse
  if (basementGlow) {
    const pulse = Math.sin(time * 3) * 0.5 + 0.5;
    basementGlow.intensity = 0.2 + pulse * 0.2;
  }

  // Elevator glow
  if (elevatorMesh) {
    const ePulse = mode === 'elevator'
      ? 0.6 + Math.sin(time * 8) * 0.4
      : 0.5;
    elevatorMesh.material.emissiveIntensity = ePulse;
    elevatorLight.intensity = 0.2 + ePulse * 0.3;
  }

  renderer.render(scene, camera);
}

function startBuilding() { if (!animationId) animateBuilding(); }

function stopBuilding() {
  if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
}

function resizeBuilding() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
