import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import pages from '../src/lib/search-pages.json';

// Generate route-specific initial metadata. The platform is open for browsing.
export function searchBuild(platform: boolean): Plugin {
  let output = '';
  return {
    name: 'fynx-search-pages',
    configResolved(config) { output = path.resolve(config.root, config.build.outDir); },
    closeBundle() {
      const base = 'https://www.fynxfunded.com';
      const source = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
      const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      fs.mkdirSync(path.join(output, 'seo'), { recursive: true });
      for (const [route, [label, description]] of Object.entries(pages)) {
        if (route === '/') continue;
        const title = platform ? `${label} | FYNX Funded` : 'FYNX Funded | Trading Evaluation Platform';
        const canonical = base + (platform ? route : '/');
        let html = source.replace(/<title>.*?<\/title>/, `<title>${escape(title)}</title>`);
        for (const [key, value] of Object.entries({ description: platform ? description : pages['/'][1], robots: platform ? 'index, follow, max-image-preview:large' : 'noindex, follow', 'og:title': title, 'og:description': platform ? description : pages['/'][1], 'og:url': canonical, 'twitter:title': title, 'twitter:description': platform ? description : pages['/'][1] })) {
          html = html.replace(new RegExp(`(<meta (?:name|property)="${key}" content=")[^"]*("[^>]*>)`), `$1${escape(value)}$2`);
        }
        html = html.replace(/(<link rel="canonical" href=")[^"]*("[^>]*>)/, `$1${canonical}$2`);
        fs.writeFileSync(path.join(output, 'seo', route.slice(1) + '.html'), html);
      }
      const routes = platform ? Object.keys(pages) : ['/'];
      fs.writeFileSync(path.join(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + routes.map(route => `<url><loc>${base}${route}</loc></url>`).join('\n') + '\n</urlset>\n');
    },
  };
}
