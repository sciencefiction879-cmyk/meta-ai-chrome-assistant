import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

async function runBuild() {
  console.log('🚀 Starting Chrome Extension build...');
  const distDir = path.resolve('dist');

  // Clean dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // 1. Build HTML Pages (Dashboard, Popup, Sidepanel, Mock)
  console.log('📦 Bundling HTML pages...');
  await build({
    configFile: false,
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          dashboard: path.resolve('dashboard.html'),
          popup: path.resolve('popup.html'),
          sidepanel: path.resolve('sidepanel.html'),
          mockMeta: path.resolve('mockMeta.html')
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]'
        }
      }
    }
  });

  // 2. Build Background Service Worker (ES module)
  console.log('📦 Bundling Background Service Worker...');
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: path.resolve('src/background/serviceWorker.ts'),
        name: 'BackgroundServiceWorker',
        formats: ['es'],
        fileName: () => 'background.js'
      }
    }
  });

  // 3. Build Content Script (IIFE, self-contained without module dependencies)
  console.log('📦 Bundling Content Script...');
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: path.resolve('src/content/contentScript.ts'),
        name: 'MetaContentScript',
        formats: ['iife'],
        fileName: () => 'content.js'
      }
    }
  });

  // 4. Copy static assets
  console.log('📋 Copying manifest.json, icons, and stylesheets...');
  fs.copyFileSync(path.resolve('manifest.json'), path.resolve('dist/manifest.json'));
  fs.copyFileSync(
    path.resolve('src/content/floatingPanel.css'),
    path.resolve('dist/floatingPanel.css')
  );

  // Copy icons
  const iconSrcDir = path.resolve('public/icons');
  const iconDestDir = path.resolve('dist/icons');
  fs.mkdirSync(iconDestDir, { recursive: true });
  if (fs.existsSync(iconSrcDir)) {
    const icons = fs.readdirSync(iconSrcDir);
    for (const icon of icons) {
      fs.copyFileSync(path.join(iconSrcDir, icon), path.join(iconDestDir, icon));
    }
  }

  // 5. Automatically synchronize into all loaded extension directories (v3.5.0, v1.0.0, v3.6.0)
  // so whenever the user clicks Chrome's reload button, the latest version is immediately loaded!
  console.log('🔄 Syncing build to loaded extension directories...');
  const syncDirs = ['meta-ai-assistant-v3.5.0', 'meta-ai-assistant-v1.0.0', 'meta-ai-assistant-v3.6.0'];
  for (const dir of syncDirs) {
    const target = path.resolve(dir);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
    fs.cpSync(distDir, target, { recursive: true });
    console.log(`   ✓ Synced to ${dir}`);
  }

  console.log('✅ Chrome Extension build finished successfully in dist/ and all profile directories!');
}

runBuild().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
