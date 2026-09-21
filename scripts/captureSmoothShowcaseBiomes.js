import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
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
  await page.setViewport({ width: 1600, height: 900 });

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));

  async function captureIso(x, z, frustum, filename) {
    await page.evaluate((tx, tz, f) => {
      window.__PLAYER__.setPosition(tx, tz);
      window.__WORLD__.updateObserverPosition(tx, tz);
      const cam = window.__PLAYER__.observerCamera;
      if (cam) {
        cam.targetFrustumSize = f;
        cam.frustumSize = f;
        cam.updateProjection();
      }
    }, x, z, frustum);

    await new Promise((r) => setTimeout(r, 3500));
    const outPath = path.join(ARTIFACT_DIR, filename);
    await page.screenshot({ path: outPath });
    console.log(`Salvo: ${outPath}`);
  }

  // 1. Bosque Temperado
  await captureIso(0, 0, 80, 'smooth_forest_grove.png');

  // 2. Bosque Outonal Dourado
  await captureIso(18, -200, 75, 'smooth_autumn_grove.png');

  // 3. Praia com Coqueiros e Mar
  await captureIso(155, 30, 85, 'smooth_beach_shore.png');

  await browser.close();
}

run().catch(console.error);
