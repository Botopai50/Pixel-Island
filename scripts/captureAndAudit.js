import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  console.log('--- Iniciando Navegador Edge Headless ---');
  
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

  const logs = [];
  const errors = [];
  const warnings = [];

  page.on('console', (msg) => {
    const text = msg.text();
    const type = msg.type();
    logs.push({ type, text });
    if (type === 'error') {
      errors.push(text);
      console.error(`[Browser ERROR]: ${text}`);
    } else if (type === 'warning') {
      warnings.push(text);
      console.warn(`[Browser WARN]: ${text}`);
    } else {
      console.log(`[Browser LOG]: ${text}`);
    }
  });

  page.on('pageerror', (err) => {
    errors.push(err.toString());
    console.error(`[Browser PageError]: ${err.toString()}`);
  });

  page.on('requestfailed', (req) => {
    console.warn(`[Request Failed]: ${req.url()} (${req.failure()?.errorText})`);
  });

  console.log('Navegando para http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  await new Promise((r) => setTimeout(r, 3000));

  // 1. Screenshot Geral / Spawn (Tela limpa, sem qualquer interface)
  const shot1Path = path.join(ARTIFACT_DIR, 'screenshot_overview.png');
  await page.screenshot({ path: shot1Path });
  console.log(`Screenshot 1 (Puro sem UI) salvo: ${shot1Path}`);

  // 2. Teste de Zoom em Bosque de Árvores
  console.log('Navegando para o bosque de árvores e aproximando...');
  await page.keyboard.down('ArrowUp');
  await new Promise((r) => setTimeout(r, 1200));
  await page.keyboard.up('ArrowUp');
  await new Promise((r) => setTimeout(r, 800));

  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel({ deltaY: -500 });
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 1200));
  const shotTreesPath = path.join(ARTIFACT_DIR, 'screenshot_trees_closeup.png');
  await page.screenshot({ path: shotTreesPath });
  console.log(`Screenshot Árvores Close-up salvo: ${shotTreesPath}`);


  // 3. Teste de Zoom Macro (Afastamento extremo)
  console.log('Afastando câmera (Zoom Macro)...');
  for (let i = 0; i < 16; i++) {
    await page.mouse.wheel({ deltaY: 800 });
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const shot3Path = path.join(ARTIFACT_DIR, 'screenshot_macro.png');
  await page.screenshot({ path: shot3Path });
  console.log(`Screenshot 3 (Macro) salvo: ${shot3Path}`);

  // 4. Teste de Navegação Suave com as Setas do Teclado
  console.log('Testando navegação contínua com setas do teclado (ArrowUp & ArrowRight)...');
  await page.keyboard.down('ArrowUp');
  await new Promise((r) => setTimeout(r, 1200));
  await page.keyboard.up('ArrowUp');

  await page.keyboard.down('ArrowRight');
  await new Promise((r) => setTimeout(r, 1200));
  await page.keyboard.up('ArrowRight');

  await new Promise((r) => setTimeout(r, 1000));
  const shot4Path = path.join(ARTIFACT_DIR, 'screenshot_navigated.png');
  await page.screenshot({ path: shot4Path });
  console.log(`Screenshot 4 (Navegação) salvo: ${shot4Path}`);

  // Salva relatório de auditoria de logs
  const report = {
    totalLogs: logs.length,
    errorsCount: errors.length,
    warningsCount: warnings.length,
    errors,
    warnings,
    recentLogs: logs.slice(-20)
  };
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'audit_report.json'), JSON.stringify(report, null, 2));

  await browser.close();
  console.log('Auditoria concluída com sucesso!');
}

run().catch((err) => {
  console.error('Falha na execução do script:', err);
  process.exit(1);
});
