import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));

  // Posiciona a câmera focando a costa leste que aparecia na imagem do usuário
  await page.evaluate(() => {
    const player = window.__PLAYER__;
    const world = window.__WORLD__;
    if (player && world) {
      player.setPosition(250, -180);
      world.updateObserverPosition(250, -180);
      const cam = player.observerCamera;
      if (cam) {
        cam.targetFrustumSize = 650;
        cam.frustumSize = 650;
        cam.updateProjection();
      }
    }
  });

  await new Promise((r) => setTimeout(r, 3000));
  const shotPath = path.join(ARTIFACT_DIR, 'screenshot_water_color_fixed.png');
  await page.screenshot({ path: shotPath });
  console.log(`Salvo: ${shotPath}`);

  await browser.close();
}

run().catch(console.error);
