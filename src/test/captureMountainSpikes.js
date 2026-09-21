import puppeteer from 'file:///C:/Users/julia/.gemini/antigravity/scratch/procedural-island-explorer/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/julia/.gemini/antigravity/brain/40dbf106-75ff-492e-8c3f-30ec0fe98531';
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  await sleep(3500);

  // Posiciona a câmera olhando diretamente para a cordilheira nevada
  // Em primeira pessoa ou aéreo com zoom na montanha
  await page.evaluate(() => {
    // Vamos para a base da montanha
    window.__PLAYER__.transitionToFirstPerson(200, 100, window.__WORLD__.getTerrainGenerator());
  });

  await sleep(2000);

  await page.evaluate(() => {
    // Vira a câmera para a montanha
    window.__PLAYER__.firstPersonController.setLookDirection(Math.PI * 0.85, 0.15);
  });

  await sleep(1500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mountain_spikes_debug.png') });
  console.log('Salvo mountain_spikes_debug.png');

  await browser.close();
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
