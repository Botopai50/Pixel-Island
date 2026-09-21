import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  console.log('--- Capturando Orlas e Linha de Costa (Areia Molhada) ---');
  
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

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));

  // 1. Visão geral da enseada inicial
  const shot1 = path.join(ARTIFACT_DIR, 'screenshot_shoreline_overview.png');
  await page.screenshot({ path: shot1 });
  console.log(`Foto 1 salva: ${shot1}`);

  // 2. Zoom na enseada de praia costeira (frustum reduzido)
  await page.evaluate(() => {
    const cam = window.__PLAYER__.observerCamera;
    if (cam) {
      cam.targetFrustumSize = 55;
      cam.frustumSize = 55;
      cam.updateProjection();
    }
  });
  await new Promise((r) => setTimeout(r, 2500));

  const shot2 = path.join(ARTIFACT_DIR, 'screenshot_shoreline_closeup.png');
  await page.screenshot({ path: shot2 });
  console.log(`Foto 2 salva: ${shot2}`);

  // 3. Aproximação máxima da orla e arrebentação (para comparar com a imagem do usuário)
  await page.evaluate(() => {
    const cam = window.__PLAYER__.observerCamera;
    if (cam) {
      cam.targetFrustumSize = 26;
      cam.frustumSize = 26;
      cam.updateProjection();
    }
  });
  await new Promise((r) => setTimeout(r, 2000));

  const shot3 = path.join(ARTIFACT_DIR, 'screenshot_shoreline_micro.png');
  await page.screenshot({ path: shot3 });
  console.log(`Foto 3 salva: ${shot3}`);

  await browser.close();
  console.log('--- Concluído com sucesso! ---');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
