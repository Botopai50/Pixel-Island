import puppeteer from 'file:///C:/Users/julia/.gemini/antigravity/scratch/procedural-island-explorer/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/julia/.gemini/antigravity/brain/40dbf106-75ff-492e-8c3f-30ec0fe98531';
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function capture() {
  console.log('Iniciando navegador Edge...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  console.log('Acessando http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await sleep(2500);

  const hydroInfo = await page.evaluate(() => {
    const hydro = window.__WORLD__.getTerrainGenerator().getHydrology();
    const lakes = hydro.getLakes();
    const rivers = hydro.getRivers();
    return {
      lakes: lakes.map(l => ({ name: l.name, x: l.x, z: l.z, waterLevel: l.waterLevel, radius: l.radius })),
      rivers: rivers.map(r => ({
        id: r.id,
        start: r.points[0],
        end: r.points[r.points.length - 1],
        count: r.points.length
      }))
    };
  });
  console.log('Dados Hidrológicos Procedurais:', JSON.stringify(hydroInfo, null, 2));

  // 1. Visão Macro Geral do Continente (mostrando os lagos e rios no conjunto da ilha)
  console.log('1. Capturando Visão Macro do Continente...');
  await page.evaluate(() => {
    window.__PLAYER__.setPosition(0, 0);
    window.__PLAYER__.setFrustumSize(1300);
    window.__PLAYER__.setRotation(35 * (Math.PI / 180));
    window.__WORLD__.updateObserverPosition(0, 0);
  });
  await sleep(3500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'inland_water_macro_overview.png') });
  console.log('Salvo inland_water_macro_overview.png');

  // 2. Lago 1: Lago Esmeralda (Alpino)
  const l1 = hydroInfo.lakes[0];
  if (l1) {
    console.log(`2. Capturando Lago 1 (${l1.name}) em (${l1.x.toFixed(1)}, ${l1.z.toFixed(1)})...`);
    await page.evaluate((lx, lz) => {
      window.__PLAYER__.setPosition(lx, lz);
      window.__PLAYER__.setFrustumSize(320);
      window.__PLAYER__.setRotation(45 * (Math.PI / 180));
      window.__WORLD__.updateObserverPosition(lx, lz);
    }, l1.x, l1.z);
    await sleep(2500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'inland_lake_alpine.png') });
    console.log('Salvo inland_lake_alpine.png');
  }

  // 3. Lago 2: Lago Sereno (Florestal / Vale)
  const l2 = hydroInfo.lakes[1];
  if (l2) {
    console.log(`3. Capturando Lago 2 (${l2.name}) em (${l2.x.toFixed(1)}, ${l2.z.toFixed(1)})...`);
    await page.evaluate((lx, lz) => {
      window.__PLAYER__.setPosition(lx, lz);
      window.__PLAYER__.setFrustumSize(340);
      window.__PLAYER__.setRotation(120 * (Math.PI / 180));
      window.__WORLD__.updateObserverPosition(lx, lz);
    }, l2.x, l2.z);
    await sleep(2500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'inland_lake_forest.png') });
    console.log('Salvo inland_lake_forest.png');
  }

  // 4. Meandros do Rio da Cordilheira com fita de água fluindo
  const r1 = hydroInfo.rivers[0];
  if (r1) {
    const midX = (r1.start.x + r1.end.x) / 2;
    const midZ = (r1.start.z + r1.end.z) / 2;
    console.log(`4. Capturando Meandros do Rio em (${midX.toFixed(1)}, ${midZ.toFixed(1)})...`);
    await page.evaluate((rx, rz) => {
      window.__PLAYER__.setPosition(rx, rz);
      window.__PLAYER__.setFrustumSize(360);
      window.__PLAYER__.setRotation(60 * (Math.PI / 180));
      window.__WORLD__.updateObserverPosition(rx, rz);
    }, midX, midZ);
    await sleep(2500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'inland_river_valley.png') });
    console.log('Salvo inland_river_valley.png');
  }

  await browser.close();
  console.log('Todas as capturas hidrológicas foram concluídas com sucesso!');
}

capture().catch(err => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
