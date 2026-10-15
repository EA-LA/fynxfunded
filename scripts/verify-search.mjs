import fs from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const pages=JSON.parse(fs.readFileSync('src/lib/search-pages.json'));
for(const [route,[title]] of Object.entries(pages)) {
 const file=route==='/'?'dist/index.html':`dist/seo${route}.html`;
 const dom=new JSDOM(fs.readFileSync(file,'utf8')),d=dom.window.document;
 assert.equal(d.querySelector('link[rel=canonical]').href,'https://www.fynxfunded.com'+route);
 assert.ok(d.title.includes(title));
 assert.ok(d.querySelector('#root h1'),`${route}: static heading missing`);
 assert.ok(d.querySelector('#root').textContent.length>300,`${route}: content missing`);
 assert.equal(d.querySelectorAll('#search-identity').length,1);
 const graph=JSON.parse(d.querySelector('#search-identity').textContent)['@graph'];
 assert.equal(graph.find(x=>x['@type']==='WebPage').url,'https://www.fynxfunded.com'+route);
 dom.window.close();
}
const sitemap=fs.readFileSync('dist/sitemap.xml','utf8');
assert.equal([...sitemap.matchAll(/<loc>/g)].length,Object.keys(pages).length);
assert.ok(!/dashboard|checkout|login|signup|admin/.test(sitemap));
console.log(`${Object.keys(pages).length} public routes: static content, canonical, structured identity and private exclusions verified.`);
