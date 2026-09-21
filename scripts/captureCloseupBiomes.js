import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  console.log('--- Captura de Close-ups dos Novos Biomas e Vegetação ---');
  
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
  await new Promise((r) => setTimeout(r, 3000));

  async function snap(targetX, targetZ, frustumSize, filename, desc) {
    console.log(`Focando em ${desc} em (${targetX}, ${targetZ}) com frustum=${frustumSize}...`);
    await page.evaluate((x, z, fSize) => {
      window.__PLAYER__.setPosition(x, z);
      window.__WORLD__.updateObserverPosition(x, z);
      const cam = window.__PLAYER__.observerCamera;
      if (cam) {
        cam.targetFrustumSize = fSize;
        cam.frustumSize = fSize;
        cam.updateProjection();
      }
    }, targetX, targetZ, frustumSize);

    await new Promise((r) => setTimeout(r, 4000));
    const outPath = path.join(ARTIFACT_DIR, filename);
    await page.screenshot({ path: outPath });
    console.log(`Foto salva: ${outPath}`);
  }

  // 1. Close-up do Bosque Outonal (Bordos vermelhos, laranjas e dourados)
  await snap(18, -200, 48, 'screenshot_autumn_closeup.png', 'Bosque Outonal Close-up');

  // 2. Close-up dos Cactos Saguaro e Dunas
  await snap(48, -75, 42, 'screenshot_cactus_closeup.png', 'Dunas com Cactos Saguaro Close-up');

  // 3. Close-up da Savana com Acácias
  await snap(38, -135, 52, 'screenshot_savannah_closeup.png', 'Savana e Acácias Close-up');

  await browser.close();
  console.log('--- Concluído com sucesso! ---');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
