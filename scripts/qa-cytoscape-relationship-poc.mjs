// Isolated technical gate. Never loaded by the product or packaged runtime.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = process.cwd();
const output = path.join(root, 'reports/final-consolidated-remediation/cytoscape-poc');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const results = [];
try {
  for (const count of [2, 12, 30]) {
    for (const width of [1366, 1024, 768, 480]) {
      const page = await browser.newPage({ viewport: { width, height: 850 }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html lang="zh"><meta charset="utf-8"><style>
        *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui;color:#202027;background:#f7f7f8}
        header{padding:12px 18px;background:white;border-bottom:1px solid #ddd}main{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:12px;padding:12px}
        #graph{height:680px;background:#fff;border:1px solid #ddd;border-radius:12px}aside{background:white;padding:14px;border:1px solid #ddd;border-radius:12px;max-height:680px;overflow:auto}
        button{padding:7px 9px;margin:3px;border:1px solid #ccd;background:white;border-radius:6px}button:focus-visible{outline:3px solid #6255d6}
        @media(max-width:720px){main{grid-template-columns:1fr}#graph{height:430px}aside{max-height:230px}}
      </style><header><strong>Cytoscape.js 隔离关系图 POC</strong> · 合成人物 ${count} 人；非产品界面</header>
      <main><div id="graph" role="img" aria-label="可缩放关系图；右侧列表可用键盘选择人物"></div><aside><strong>人物详情 / 键盘入口</strong><div id="people"></div><p id="detail">选择人物查看关系</p></aside></main></html>`);
      await page.addScriptTag({ path: path.join(root, '.cache/cytoscape-audit/package/dist/cytoscape.min.js') });
      const measurement = await page.evaluate(({ count }) => {
        const nodes = [{ data: { id: 'root', label: '主角' } }];
        const edges = [];
        for (let i = 1; i < count; i++) {
          nodes.push({ data: { id: `p${i}`, label: `人物${i}` } });
          edges.push({ data: { id: `e${i}`, source: 'root', target: `p${i}`, label: i % 4 === 0 ? '朋友' : '关联' } });
        }
        if (count > 6) edges.push({ data: { id: 'multi', source: 'root', target: 'p4', label: '债务' } });
        const cy = window.cytoscape({ container: document.querySelector('#graph'), elements: [...nodes, ...edges],
          style: [
            { selector: 'node', style: { label: 'data(label)', width: 64, height: 36, shape: 'round-rectangle',
              'font-size': 13, color: '#25212f', 'background-color': '#eeeaff', 'text-valign': 'center', 'text-halign': 'center' } },
            { selector: 'edge', style: { label: 'data(label)', width: 1.5, 'font-size': 10,
              'curve-style': 'bezier', 'line-color': '#b9b2dc', 'text-rotation': 'autorotate' } }
          ], layout: { name: 'breadthfirst', directed: true, spacingFactor: 1.3, padding: 28, animate: false },
          wheelSensitivity: 0.2, minZoom: 0.2, maxZoom: 2.5 });
        cy.fit(undefined, 28);
        const detail = document.querySelector('#detail');
        const people = document.querySelector('#people');
        for (let i = 0; i < count; i++) {
          const id = i ? `p${i}` : 'root';
          const button = document.createElement('button'); button.textContent = i ? `人物${i}` : '主角';
          button.addEventListener('click', () => { cy.$id(id).select(); detail.textContent = `${button.textContent}：关系证据需要独立展示。`; });
          people.append(button);
        }
        cy.on('tap', 'node', (event) => { detail.textContent = `${event.target.data('label')}：关系证据需要独立展示。`; });
        const rect = document.querySelector('#graph').getBoundingClientRect();
        const boxes = cy.nodes().map((node) => {
          const b = node.renderedBoundingBox({ includeLabels: true });
          return { id: node.id(), x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
        });
        let collisions = 0;
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (Math.min(a.x2, b.x2) > Math.max(a.x1, b.x1) + 2
            && Math.min(a.y2, b.y2) > Math.max(a.y1, b.y1) + 2) collisions++;
        }
        window.cy = cy;
        return { node_count: count, edge_count: edges.length, width: Math.round(rect.width),
          zoom: cy.zoom(), effective_label_px: 13 * cy.zoom(), collisions,
          outside: boxes.filter((b) => b.x1 < 0 || b.y1 < 0 || b.x2 > rect.width || b.y2 > rect.height).length,
          keyboard_buttons: people.querySelectorAll('button').length,
          multi_relationship: edges.some((e) => e.data.id === 'multi') };
      }, { count });
      await page.locator('#people button').nth(Math.min(1, count - 1)).focus();
      await page.keyboard.press('Enter');
      measurement.keyboard_detail = (await page.locator('#detail').textContent()).includes('关系证据');
      await page.screenshot({ path: path.join(output, `graph-${count}-${width}.png`) });
      results.push({ viewport: width, ...measurement });
      await page.close();
    }
  }
} finally { await browser.close(); }
await writeFile(path.join(output, 'measurements.json'), `${JSON.stringify({ library: 'Cytoscape.js 3.34.4',
  license: 'MIT', product_integration: false, results }, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
