import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function main() {
  console.log('Iniciando navegador Edge via Puppeteer...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=d3d11']
  });

  const page = await browser.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('PAGE ERROR:', msg.text());
  });

  console.log('Carregando aplicação no servidor de desenvolvimento...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  await new Promise((r) => setTimeout(r, 3000));

  const targets = [
    {
      name: 'feature_volcano',
      x: -480,
      z: 520,
      zoom: 300,
      yaw: 0.8,
      desc: 'Vulcão e Caldeira com Piscina de Lava Incandescente'
    },
    {
      name: 'feature_canyon',
      x: 240,
      z: 200,
      zoom: 240,
      yaw: 1.2,
      desc: 'Cânions Estratificados e Ravinas de Arenito'
    },
    {
      name: 'feature_geothermal',
      x: -260,
      z: -260,
      zoom: 160,
      yaw: -0.6,
      desc: 'Fontes Termais Estilo Yellowstone e Gêiseres de Vapor'
    },
    {
      name: 'feature_waterfalls',
      x: 185,
      z: 320,
      zoom: 140,
      yaw: 0.4,
      desc: 'Cachoeiras com Fluxo e Espuma Dinâmica'
    },
    {
      name: 'feature_mangrove',
      x: 240,
      z: -200,
      zoom: 130,
      yaw: -1.0,
      desc: 'Manguezais Estuarinos com Raízes Aéreas Arqueadas'
    },
    {
      name: 'feature_arctic_ice',
      x: -180,
      z: -780,
      zoom: 340,
      yaw: 0.2,
      desc: 'Planície Ártica com Banquisas de Gelo Flutuantes'
    },
    {
      name: 'feature_sea_arch',
      x: 380,
      z: -160,
      zoom: 150,
      yaw: 0.6,
      desc: 'Arco Rochoso Marinho Monumental na Costa'
    },
    {
      name: 'feature_coral_reef',
      x: 255,
      z: -225,
      zoom: 120,
      yaw: -0.4,
      desc: 'Lagoa Costeira e Recifes de Coral'
    }
  ];

  for (const t of targets) {
    console.log(`Posicionando câmera para: ${t.desc} em (${t.x}, ${t.z})...`);
    await page.evaluate((pos) => {
      const player = window.__PLAYER__;
      const world = window.__WORLD__;
      if (player && world) {
        player.setPosition(pos.x, pos.z);
        player.setFrustumSize(pos.zoom);
        player.setRotation(pos.yaw);
        world.updateObserverPosition(pos.x, pos.z);
      }
    }, t);

    await new Promise((r) => setTimeout(r, 2200));

    const outPath = path.join(ARTIFACT_DIR, `${t.name}.png`);
    await page.screenshot({ path: outPath });
    console.log(`✓ Capturado: ${outPath}`);
  }

  await browser.close();
  console.log('Todas as capturas dos 8 novos recursos foram salvas com sucesso!');
}

main().catch((err) => {
  console.error('Erro na captura de screenshots:', err);
  process.exit(1);
});
