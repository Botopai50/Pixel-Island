import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  console.log('--- Iniciando Navegador Edge Headless para Captura de Biomas ---');
  
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[Browser ERROR]: ${msg.text()}`);
    }
  });

  console.log('Navegando para http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  await new Promise((r) => setTimeout(r, 4000));

  // 1. Visão Geral do Spawn
  const shotOverview = path.join(ARTIFACT_DIR, 'screenshot_biomes_overview.png');
  await page.screenshot({ path: shotOverview });
  console.log(`Visão geral salva em ${shotOverview}`);

  // 2. Busca coordenadas de biomas interessantes
  const biomeLocations = await page.evaluate(() => {
    const world = window.__WORLD__;
    if (!world) return null;

    const found = {};

    for (let r = 0; r < 500; r += 6) {
      for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const pt = world.queryPoint(x, z);

        if (!pt.isWater && pt.height > 2.0 && pt.slope < 0.4) {
          const type = pt.biome.type;
          if (!found[type]) {
            found[type] = { x, z, height: pt.height, type };
          }
        }
      }
    }
    return found;
  });

  console.log('Biomas mapeados:', biomeLocations ? Object.keys(biomeLocations) : 'nenhum');

  async function teleportAndCapture(target, filename, desc) {
    if (!target) {
      console.log(`Nenhum ponto encontrado para ${desc}`);
      return;
    }
    console.log(`Teleportando para ${desc} em (${target.x.toFixed(1)}, ${target.z.toFixed(1)})...`);
    await page.evaluate((pos) => {
      window.__PLAYER__.setPosition(pos.x, pos.z);
      window.__WORLD__.updateObserverPosition(pos.x, pos.z);
    }, target);

    // Espera streaming dos chunks
    await new Promise((r) => setTimeout(r, 4500));

    const shotPath = path.join(ARTIFACT_DIR, filename);
    await page.screenshot({ path: shotPath });
    console.log(`Captura de ${desc} salva em ${shotPath}`);
  }

  if (biomeLocations) {
    if (biomeLocations['Bosque Outonal Dourado']) {
      await teleportAndCapture(biomeLocations['Bosque Outonal Dourado'], 'screenshot_autumn_forest.png', 'Bosque Outonal');
    }
    if (biomeLocations['Savana Tropical']) {
      await teleportAndCapture(biomeLocations['Savana Tropical'], 'screenshot_savannah.png', 'Savana Tropical');
    }
    if (biomeLocations['Deserto & Dunas Áridas']) {
      await teleportAndCapture(biomeLocations['Deserto & Dunas Áridas'], 'screenshot_desert.png', 'Deserto e Cactos');
    }
    if (biomeLocations['Taiga Boreal de Coníferas']) {
      await teleportAndCapture(biomeLocations['Taiga Boreal de Coníferas'], 'screenshot_taiga.png', 'Taiga Boreal');
    }
    if (biomeLocations['Selva Tropical Úmida']) {
      await teleportAndCapture(biomeLocations['Selva Tropical Úmida'], 'screenshot_rainforest.png', 'Selva Tropical');
    }
  }

  await browser.close();
  console.log('--- Captura de biomas concluída com sucesso! ---');
}

run().catch((err) => {
  console.error('Erro ao capturar biomas:', err);
  process.exit(1);
});
