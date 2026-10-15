import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { createServer } from 'vite';
import pages from '../src/lib/search-pages.json';
import { searchIdentity } from '../src/lib/search-identity';

// Generate route-specific initial metadata. The platform is open for browsing.
export function searchBuild(platform: boolean): Plugin {
  let output = '';
  return {
    name: 'fynx-search-pages',
    configResolved(config) { output = path.resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const base = 'https://www.fynxfunded.com';
      const source = fs.readFileSync(path.join(output, 'index.html'), 'utf8').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g,'');
      const renderer = await createServer({configFile:false,mode:'production',esbuild:{jsx:'automatic',jsxDev:false},resolve:{alias:{'@':path.resolve('src')}},server:{middlewareMode:true},appType:'custom'});
      try {
      const { render } = await renderer.ssrLoadModule('/src/search-render.tsx');
      const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      fs.mkdirSync(path.join(output, 'seo'), { recursive: true });
      for (const [route, [label, description]] of Object.entries(pages)) {
        const title = platform ? `${label} | FYNX Funded` : 'FYNX Funded | Trading Evaluation Platform';
        const canonical = base + (platform ? route : '/');
        let html = source.replace(/<title>.*?<\/title>/, `<title>${escape(title)}</title>`);
        for (const [key, value] of Object.entries({ description: platform ? description : pages['/'][1], robots: platform ? 'index, follow, max-image-preview:large' : 'noindex, follow', 'og:title': title, 'og:description': platform ? description : pages['/'][1], 'og:url': canonical, 'twitter:title': title, 'twitter:description': platform ? description : pages['/'][1] })) {
          html = html.replace(new RegExp(`(<meta (?:name|property)="${key}" content=")[^"]*("[^>]*>)`), `$1${escape(value)}$2`);
        }
        html = html.replace(/(<link rel="canonical" href=")[^"]*("[^>]*>)/, `$1${canonical}$2`);
        html = html.replace('</head>', `<script id="search-identity" type="application/ld+json">${JSON.stringify(searchIdentity(canonical,title,description)).replace(/</g,'\\u003c')}</script></head>`);
        html = html.replace('<div id="root"></div>', `<div id="root">${render(route)}</div>`);
        fs.writeFileSync(route==='/'?path.join(output,'index.html'):path.join(output, 'seo', route.slice(1) + '.html'), html);
      }
      const routes = platform ? Object.keys(pages) : ['/'];
      fs.writeFileSync(path.join(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + routes.map(route => `<url><loc>${base}${route}</loc></url>`).join('\n') + '\n</urlset>\n');
      fs.writeFileSync(path.join(output,'robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
      } finally { await renderer.close(); }
    },
  };
}
