import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Bloch state: unit vector (x, y, z) on the sphere ---
const state = {
  x: 0,
  y: 0,
  z: 1
};

const MAX_HISTORY = 20;
const stateHistory = [];

function pushState() {
  stateHistory.push({ x: state.x, y: state.y, z: state.z });
  if (stateHistory.length > MAX_HISTORY) stateHistory.shift();
  updateUndoButton();
}

function copyState(dst, src) {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

function undo() {
  if (stateHistory.length < 1) return;
  const prev = stateHistory.pop();
  copyState(state, prev);
  onStateChange();
  updateUndoButton();
}

function normalize() {
  const n = Math.sqrt(state.x * state.x + state.y * state.y + state.z * state.z) || 1;
  state.x /= n;
  state.y /= n;
  state.z /= n;
}

// Gate rotations on the Bloch vector (each gate = rotation on Bloch sphere)
function applyX() {
  state.y = -state.y;
  state.z = -state.z;
}

function applyY() {
  state.x = -state.x;
  state.z = -state.z;
}

function applyZ() {
  state.x = -state.x;
  state.y = -state.y;
}

function applyH() {
  // Hadamard: rotation π about (x+z)/√2 axis → Bloch: (x,y,z) -> (z, -y, x)
  const x = state.x, y = state.y, z = state.z;
  state.x = z;
  state.y = -y;
  state.z = x;
}

function applyS() {
  // S = √Z: rotation π/2 about Z → (x,y,z) -> (-y, x, z)
  const x = state.x, y = state.y;
  state.x = -y;
  state.y = x;
}

function applyT() {
  // T = ∜Z: rotation π/4 about Z
  const c = Math.cos(Math.PI / 4), s = Math.sin(Math.PI / 4);
  const x = state.x, y = state.y;
  state.x = c * x - s * y;
  state.y = s * x + c * y;
}

const gates = {
  X: applyX,
  Y: applyY,
  Z: applyZ,
  H: applyH,
  S: applyS,
  T: applyT
};

function applyGate(name) {
  pushState();
  const fn = gates[name];
  if (fn) fn();
  normalize();
  onStateChange();
}

function resetTo(stateName) {
  pushState();
  state.x = 0;
  state.y = 0;
  state.z = stateName === '|1⟩' ? -1 : 1;
  onStateChange();
}

// --- Three.js scene ---
let scene, camera, renderer, controls;
let stateArrow, statePoint;

function makeLabelSprite(text) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  ctx.font = 'bold 42px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, cx, cy);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.5, 0.5, 1);
  return sprite;
}

function initThree() {
  const container = document.getElementById('canvas-container');
  const canvas = document.getElementById('bloch-canvas');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(2.5, 2, 2.5);
  camera.lookAt(0, 0, 0);
  camera.up.set(0, 0, 1);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  resize();

  // Lights
  scene.add(new THREE.AmbientLight(0x606070, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(3, 5, 5);
  scene.add(dir);

  // Wireframe sphere (Bloch sphere)
  const sphereGeom = new THREE.SphereGeometry(1, 32, 24);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: 0x2a2a4a,
    wireframe: true
  });
  const sphere = new THREE.Mesh(sphereGeom, sphereMat);
  scene.add(sphere);

  // Equator (X-Y plane, horizontal when Z is up) and prime meridian (X-Z plane, vertical through poles)
  const equatorGeom = new THREE.TorusGeometry(1, 0.008, 8, 64);
  const equatorMat = new THREE.MeshBasicMaterial({ color: 0x4a4a6a });
  const equator = new THREE.Mesh(equatorGeom, equatorMat);
  scene.add(equator);

  const meridianPoints = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    meridianPoints.push(new THREE.Vector3(Math.cos(t), 0, Math.sin(t)));
  }
  const meridianGeom = new THREE.BufferGeometry().setFromPoints(meridianPoints);
  const meridianMat = new THREE.LineBasicMaterial({ color: 0x5a5a7a });
  const meridian = new THREE.LineLoop(meridianGeom, meridianMat);
  scene.add(meridian);

  // Muted bold axes through all basis states (X, Y, Z)
  const axisLen = 1.15;
  const axisRadius = 0.014;
  const axisMat = new THREE.MeshBasicMaterial({ color: 0x404050 });
  const axisGeom = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLen * 2, 8);
  const axisX = new THREE.Mesh(axisGeom, axisMat);
  axisX.rotation.z = -Math.PI / 2;
  scene.add(axisX);
  const axisY = new THREE.Mesh(axisGeom.clone(), axisMat.clone());
  scene.add(axisY);
  const axisZ = new THREE.Mesh(axisGeom.clone(), axisMat.clone());
  axisZ.rotation.x = Math.PI / 2;
  scene.add(axisZ);

  // Basis state labels: Z-axis vertical on screen (camera.up = Z). |0⟩ north (top), |1⟩ south (bottom); |+⟩/|−⟩ on X; |+i⟩/|−i⟩ on Y.
  const labelDistance = 1.28;
  const basisLabels = [
    { pos: new THREE.Vector3(0, 0, 1), text: '|0⟩' },   // north pole (top)
    { pos: new THREE.Vector3(0, 0, -1), text: '|1⟩' },  // south pole (bottom)
    { pos: new THREE.Vector3(1, 0, 0), text: '|+⟩' },   // +X equator
    { pos: new THREE.Vector3(-1, 0, 0), text: '|−⟩' }, // -X equator
    { pos: new THREE.Vector3(0, 1, 0), text: '|+i⟩' }, // +Y equator
    { pos: new THREE.Vector3(0, -1, 0), text: '|−i⟩' } // -Y equator
  ];
  basisLabels.forEach(({ pos, text }) => {
    const sprite = makeLabelSprite(text);
    sprite.position.x = pos.x * labelDistance;
    sprite.position.y = pos.y * labelDistance;
    sprite.position.z = pos.z * labelDistance;
    scene.add(sprite);
  });

  // State vector: arrow from origin to (x,y,z), rendered on top of axes
  stateArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, 0),
    1,
    0xffaa44
  );
  stateArrow.setDirection(new THREE.Vector3(state.x, state.y, state.z));
  stateArrow.traverse((obj) => {
    if (obj.material) {
      obj.material.depthTest = false;
      obj.material.depthWrite = false;
    }
  });
  scene.add(stateArrow);

  // Small sphere at state point (more visible), also on top
  const pointGeom = new THREE.SphereGeometry(0.06, 16, 16);
  const pointMat = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    depthTest: false,
    depthWrite: false
  });
  statePoint = new THREE.Mesh(pointGeom, pointMat);
  statePoint.position.set(state.x, state.y, state.z);
  scene.add(statePoint);

  // OrbitControls
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = false;
  controls.minDistance = 1.5;
  controls.maxDistance = 6;

  window.addEventListener('resize', resize);
}

function resize() {
  const container = document.getElementById('canvas-container');
  const canvas = document.getElementById('bloch-canvas');
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function updateStateVisual() {
  stateArrow.setDirection(new THREE.Vector3(state.x, state.y, state.z));
  statePoint.position.set(state.x, state.y, state.z);
}

function onStateChange() {
  updateStateVisual();
  updateReadout();
}

function updateReadout() {
  const vecEl = document.getElementById('bloch-vec');
  const thetaEl = document.getElementById('theta-val');
  const phiEl = document.getElementById('phi-val');
  if (!vecEl) return;
  const x = state.x.toFixed(3), y = state.y.toFixed(3), z = state.z.toFixed(3);
  vecEl.textContent = `(${x}, ${y}, ${z})`;
  const theta = Math.acos(Math.max(-1, Math.min(1, state.z)));
  let phi = Math.atan2(state.y, state.x);
  if (Math.abs(state.x) < 1e-10 && Math.abs(state.y) < 1e-10) phi = 0;
  thetaEl.textContent = theta.toFixed(3);
  phiEl.textContent = phi.toFixed(3);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// --- Gate descriptions (for hover/focus panel) ---
const gateDescriptions = {
  X: 'X: Bit flip. Rotates the state by π around the X axis. |0⟩ ↔ |1⟩.',
  Y: 'Y: Rotates the state by π around the Y axis.',
  Z: 'Z: Phase flip. Rotates by π around the Z axis (flips phase in the equator).',
  H: 'H: Hadamard. Puts |0⟩ and |1⟩ into equal superposition. Moves north/south pole to the equator.',
  S: 'S (√Z): Rotates by π/2 around the Z axis.',
  T: 'T (∜Z): Rotates by π/4 around the Z axis.'
};

const DEFAULT_GATE_DESC = 'Hover a gate for a short description.';

function updateUndoButton() {
  const btn = document.getElementById('undo-btn');
  if (btn) btn.disabled = stateHistory.length < 1;
}

// --- UI: gate and reset buttons ---
function bindUI() {
  const descEl = document.getElementById('gate-description');

  document.querySelectorAll('.gate-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const gate = btn.getAttribute('data-gate');
      if (gate) applyGate(gate);
    });
    btn.addEventListener('mouseenter', () => {
      if (descEl) descEl.textContent = gateDescriptions[btn.getAttribute('data-gate')] || DEFAULT_GATE_DESC;
    });
    btn.addEventListener('focus', () => {
      if (descEl) descEl.textContent = gateDescriptions[btn.getAttribute('data-gate')] || DEFAULT_GATE_DESC;
    });
    btn.addEventListener('mouseleave', () => {
      if (descEl && !btn.matches(':focus')) descEl.textContent = DEFAULT_GATE_DESC;
    });
    btn.addEventListener('blur', () => {
      if (descEl) descEl.textContent = DEFAULT_GATE_DESC;
    });
  });

  document.getElementById('reset-0').addEventListener('click', () => resetTo('|0⟩'));
  document.getElementById('reset-1').addEventListener('click', () => resetTo('|1⟩'));

  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) undoBtn.addEventListener('click', undo);
  updateUndoButton();

  const helpBtn = document.getElementById('help-btn');
  const guideDetails = document.querySelector('#guide .guide-details');
  if (helpBtn && guideDetails) {
    helpBtn.addEventListener('click', () => {
      guideDetails.setAttribute('open', '');
      document.getElementById('guide')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  document.querySelectorAll('.try-link[data-gate]').forEach(el => {
    el.addEventListener('click', () => applyGate(el.getAttribute('data-gate')));
  });
  document.querySelectorAll('.try-link[data-reset]').forEach(el => {
    el.addEventListener('click', () => resetTo(el.getAttribute('data-reset') === '1' ? '|1⟩' : '|0⟩'));
  });

  renderChallenges();
  bindChallengeChecks();
}

// --- Challenges ---
const challenges = [
  {
    id: 'reach-one',
    title: 'Reach |1⟩',
    description: 'Start at |0⟩. Use the X gate to move the state to the south pole (|1⟩).',
    hint: 'Click the X gate once.',
    check: () => state.z < -0.99
  },
  {
    id: 'superposition',
    title: 'Superposition',
    description: 'Reset to |0⟩, then apply H to create (|0⟩+|1⟩)/√2.',
    hint: 'Use Reset |0⟩ then click H.',
    check: () => Math.abs(state.z) < 0.1
  },
  {
    id: 'phase-flip',
    title: 'Phase flip',
    description: 'From the equator (e.g. after H), apply Z. The point moves on the equator (phase change).',
    hint: 'Get to the equator with H, then apply Z.',
    check: () => Math.abs(state.z) < 0.15
  },
  {
    id: 'two-gates',
    title: 'Two gates',
    description: 'Start at |0⟩. Apply H then X. You should reach the |−⟩ state.',
    hint: 'Click H, then X. Target: x ≈ -1.',
    check: () => state.x < -0.99
  },
  {
    id: 'back-to-start',
    title: 'Back to start',
    description: 'From any state, use only X and Z (and reset if you want) to return to |0⟩.',
    hint: 'Use Reset |0⟩ or undo and gates until z is near 1.',
    check: () => state.z > 0.99
  }
];

const completedChallenges = new Set();

function renderChallenges() {
  const list = document.getElementById('challenges-list');
  if (!list) return;
  list.innerHTML = challenges.map((c, i) => `
    <div class="challenge-card" data-challenge-id="${c.id}">
      <div class="challenge-header">
        <span class="challenge-title">${i + 1}. ${c.title}</span>
        ${completedChallenges.has(c.id) ? '<span class="challenge-done">Completed</span>' : ''}
      </div>
      <p class="challenge-desc">${c.description}</p>
      <div class="challenge-feedback" id="feedback-${c.id}" aria-live="polite"></div>
      <button type="button" class="check-btn" data-challenge-id="${c.id}" ${completedChallenges.has(c.id) ? 'disabled' : ''}>Check</button>
    </div>
  `).join('');
}

function bindChallengeChecks() {
  document.querySelectorAll('.check-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-challenge-id');
      const challenge = challenges.find(c => c.id === id);
      const feedbackEl = document.getElementById(`feedback-${id}`);
      if (!challenge || !feedbackEl) return;
      if (challenge.check()) {
        completedChallenges.add(id);
        feedbackEl.textContent = 'Success!';
        feedbackEl.className = 'challenge-feedback success';
        btn.disabled = true;
        const card = btn.closest('.challenge-card');
        const header = card?.querySelector('.challenge-header');
        if (header && !header.querySelector('.challenge-done')) {
          const done = document.createElement('span');
          done.className = 'challenge-done';
          done.textContent = 'Completed';
          header.appendChild(done);
        }
      } else {
        feedbackEl.textContent = 'Not quite. Hint: ' + challenge.hint;
        feedbackEl.className = 'challenge-feedback hint';
      }
    });
  });
}

// --- Init ---
initThree();
bindUI();
updateReadout();
animate();
