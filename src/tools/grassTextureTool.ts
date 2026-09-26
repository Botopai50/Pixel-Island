import * as THREE from 'three';
import { createGrassTexture, DEFAULT_PARAMS, generateGrass, GrassMode, GrassParams, GrassTexture } from './grassTexture';

const params: GrassParams = {
  ...DEFAULT_PARAMS,
  blade: DEFAULT_PARAMS.blade.map(r => [...r]),
  palette: [...DEFAULT_PARAMS.palette],
};

type NumKey = { [K in keyof GrassParams]: GrassParams[K] extends number ? K : never }[keyof GrassParams];
const SLIDERS: [NumKey | 'zoom', string, number, number, number][] = [
  ['size', 'Tamanho (px)', 16, 256, 8],
  ['lightCover', 'Área clara', 0, 1, 0.01],
  ['darkCover', 'Área escura', 0, 1, 0.01],
  ['clumpScale', 'Manchas por lado', 1, 8, 1],
  ['bands', 'Faixa diagonal', 0, 1, 0.01],
  ['centerBias', 'Clareira no centro (bloco)', 0, 1, 0.01],
  ['spill', 'Largura da transição (px)', 1, 16, 1],
  ['density', 'Entrelaçado claro/médio', 0, 1, 0.01],
  ['detail', 'Folhagem nos tufos', 0, 1, 0.01],
  ['spacing', 'Espaçamento', 1, 5, 1],
  ['pairs', 'Pares em "V"', 0, 1, 0.01],
  ['limeTufts', 'Leques lima', 0, 20, 1],
  ['flowerClusters', 'Grupos de flores', 0, 10, 1],
  ['zoom', 'Zoom da prévia', 1, 12, 1],
];
let zoom = 4;
let current: GrassTexture;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const view = $<HTMLCanvasElement>('view');

// Prévia em Three.js: plano com a textura, câmera ortográfica olhando de cima.
const renderer = new THREE.WebGLRenderer({ canvas: view, alpha: true, antialias: false });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
camera.position.z = 1;
const material = new THREE.MeshBasicMaterial({ transparent: true });
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));

function toCanvas(tex: GrassTexture): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = tex.width; c.height = tex.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(tex.data), tex.width, tex.height), 0, 0);
  return c;
}

function render() {
  current = generateGrass(params);
  material.map?.dispose();
  const tex = createGrassTexture(params, current);
  // Modo contínuo repete 3x3 (RepeatWrapping) para conferir que não há emenda.
  const reps = params.mode === 'seamless' ? 3 : 1;
  tex.repeat.set(reps, reps);
  material.map = tex;
  material.needsUpdate = true;
  const px = current.width * reps;
  const fit = Math.max(1, Math.min(zoom, Math.floor((innerWidth - 340) / px), Math.floor((innerHeight - 48) / px)));
  renderer.setSize(px * fit, px * fit);
  renderer.render(scene, camera);
}

function download(scale: number) {
  const src = toCanvas(current);
  const c = document.createElement('canvas');
  c.width = src.width * scale; c.height = src.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const a = document.createElement('a');
  a.download = `grama_${params.mode}_${params.seed}_${scale}x.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}

// --- controles ---
const seed = $<HTMLInputElement>('seed');
seed.value = String(params.seed);
seed.oninput = () => { params.seed = Number(seed.value) | 0; render(); };
$('reroll').onclick = () => { params.seed = Math.floor(Math.random() * 1e6); seed.value = String(params.seed); render(); };

const mode = $<HTMLSelectElement>('mode');
mode.onchange = () => { params.mode = mode.value as GrassMode; render(); };

const sliders = $('sliders');
for (const [key, name, min, max, step] of SLIDERS) {
  const label = document.createElement('label');
  const value = key === 'zoom' ? zoom : params[key];
  label.innerHTML = `<span>${name}</span><output>${value}</output><input type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
  const input = label.querySelector('input')!, out = label.querySelector('output')!;
  input.oninput = () => {
    const v = Number(input.value);
    out.textContent = String(v);
    if (key === 'zoom') zoom = v; else params[key] = v;
    render();
  };
  sliders.appendChild(label);
}

const palette = $('palette');
params.palette.forEach((color, i) => {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = color;
  input.oninput = () => { params.palette[i] = input.value; render(); };
  palette.appendChild(input);
});

// Editor da lâmina 6x6 (a máscara é recortada ao menor retângulo que contém pixels).
const EDIT = 6;
const grid: number[][] = Array.from({ length: EDIT }, (_, r) =>
  Array.from({ length: EDIT }, (_, k) => params.blade[r]?.[k] ?? 0));
const bladeEl = $('blade');
function syncBlade() {
  const rows = grid.map((r, i) => r.some(Boolean) ? i : -1).filter(i => i >= 0);
  const cols = [...Array(EDIT).keys()].filter(k => grid.some(r => r[k]));
  if (!rows.length) return;
  params.blade = grid.slice(rows[0], rows[rows.length - 1] + 1)
    .map(r => r.slice(cols[0], cols[cols.length - 1] + 1));
  render();
}
grid.forEach((row, r) => row.forEach((_, k) => {
  const cell = document.createElement('div');
  cell.classList.toggle('on', !!grid[r][k]);
  cell.onclick = () => { grid[r][k] = grid[r][k] ? 0 : 1; cell.classList.toggle('on', !!grid[r][k]); syncBlade(); };
  bladeEl.appendChild(cell);
}));

$('png1').onclick = () => download(1);
$('png8').onclick = () => download(8);
addEventListener('resize', render);
render();
