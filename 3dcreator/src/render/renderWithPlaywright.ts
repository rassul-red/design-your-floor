import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { SceneDescription } from '../scene/types';

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function startStaticServer(rootDir: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const reqPath = req.url ? req.url.split('?')[0] : '/';
    const relativePath = reqPath === '/' ? '/renderer.html' : reqPath;
    const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(rootDir, normalized);

    if (!fullPath.startsWith(rootDir)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    res.setHeader('Content-Type', contentTypeFor(fullPath));
    res.end(fs.readFileSync(fullPath));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start static server for renderer.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export async function renderWithPlaywright(
  scene: SceneDescription,
  rendererHtmlPath: string,
  outputPngPath: string,
): Promise<void> {
  let chromium: any;
  try {
    const playwright = (await import('playwright')) as unknown as { chromium: any };
    chromium = playwright.chromium;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Playwright is not installed or unavailable. Install dependencies first (npm install). Root cause: ${reason}`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader',
      '--use-gl=swiftshader',
      '--disable-gpu-sandbox',
    ],
  });
  const staticServer = await startStaticServer(path.dirname(rendererHtmlPath));

  try {
    const context = await browser.newContext({
      viewport: { width: scene.render.width, height: scene.render.height },
    });
    const page = await context.newPage();
    const consoleMessages: string[] = [];

    page.on('console', (msg: any) => {
      consoleMessages.push(`[console:${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err: Error) => {
      consoleMessages.push(`[pageerror] ${err.message}`);
    });

    await page.addInitScript((sceneData: SceneDescription) => {
      (window as unknown as { __SCENE__?: unknown }).__SCENE__ = sceneData;
    }, scene);

    const url = `${staticServer.baseUrl}/${path.basename(rendererHtmlPath)}`;
    await page.goto(url, { waitUntil: 'load' });
    try {
      await page.waitForFunction(() => {
        const state = window as unknown as { __RENDER_DONE__?: boolean; __RENDER_ERROR__?: string };
        return state.__RENDER_DONE__ === true || Boolean(state.__RENDER_ERROR__);
      }, { timeout: 30_000 });
    } catch (error) {
      const state = await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        return {
          done: w.__RENDER_DONE__,
          error: w.__RENDER_ERROR__,
          sceneExists: Boolean(w.__SCENE__),
          scripts: Array.from(document.scripts).map((s) => s.src || '[inline]'),
          hasCanvas: Boolean(document.querySelector('canvas')),
        };
      });
      const logs = consoleMessages.length > 0 ? `\n${consoleMessages.join('\n')}` : '';
      throw new Error(`Renderer startup timeout. State=${JSON.stringify(state)}${logs}. Root=${error instanceof Error ? error.message : String(error)}`);
    }

    const renderState = await page.evaluate(() => {
      const state = window as unknown as { __RENDER_DONE__?: boolean; __RENDER_ERROR__?: string };
      return {
        done: state.__RENDER_DONE__ === true,
        error: state.__RENDER_ERROR__,
      };
    });

    if (!renderState.done) {
      const logs = consoleMessages.length > 0 ? `\n${consoleMessages.join('\n')}` : '';
      throw new Error(`Renderer reported failure: ${renderState.error ?? 'unknown error'}${logs}`);
    }

    await page.screenshot({ path: outputPngPath });

    await context.close();
  } finally {
    await staticServer.close();
    await browser.close();
  }
}
