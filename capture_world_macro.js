import puppeteer from 'file:///C:/Users/julia/.gemini/antigravity/scratch/procedural-island-explorer/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/julia/.gemini/antigravity/brain/40dbf106-75ff-492e-8c3f-30ec0fe98531';
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function capture() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  console.log('Navigating to http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  
  await sleep(600);
  const m600 = await page.evaluate(() => ({
    chunks: window.__WORLD__.getChunkManager().getLoadedChunkCount(),
    queue: window.__WORLD__.getChunkManager().getQueueLength()
  }));
  console.log(`[Performance] Aos 600ms: ${m600.chunks} chunks carregados (fila restante: ${m600.queue})`);

  await sleep(1000);
  const m1600 = await page.evaluate(() => ({
    chunks: window.__WORLD__.getChunkManager().getLoadedChunkCount(),
    queue: window.__WORLD__.getChunkManager().getQueueLength()
  }));
  console.log(`[Performance] Aos 1600ms: ${m1600.chunks} chunks carregados (fila restante: ${m1600.queue})`);

  // Visão em solo contemplativo inicial do observador (vegetação, árvores, terreno)
  console.log('Capturando visão em solo com vegetação e relevo...');
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'world_fast_loading_ground.png') });
  console.log('Salvo world_fast_loading_ground.png');

  // Macro visão do mundo a partir do centro (0, 0)
  console.log('Capturando visão macro com frustum 1200...');
  await page.evaluate(() => {
    window.__PLAYER__.setPosition(0, 0);
    window.__PLAYER__.setFrustumSize(1200);
    window.__PLAYER__.setRotation(42 * (Math.PI / 180));
    window.__WORLD__.updateObserverPosition(0, 0);
  });
  await sleep(3000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'world_fast_loading_macro.png') });
  console.log('Salvo world_fast_loading_macro.png');

  await browser.close();
}

capture().catch(err => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
