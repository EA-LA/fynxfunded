import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import pages from "@/lib/search-pages.json";
import { searchIdentity } from '@/lib/search-identity';
const publicPages: Record<string, string[]> = pages;

export default function SearchMetadata({ platform }: { platform: boolean }) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const publicPlatform = true;
    const page = platform && publicPlatform ? publicPages[pathname] : publicPages['/'];
    const indexable = platform ? publicPlatform && Boolean(publicPages[pathname]) : pathname === '/';
    const [label, description] = page || ['Account', 'Manage your FYNX Funded account.'];
    const title = `${label} | FYNX Funded`;
    const url = `https://www.fynxfunded.com${platform && publicPlatform ? pathname : '/'}`;
    document.title = title;
    for (const [selector, value] of [
      ['meta[name="description"]', description],
      ['meta[name="robots"]', indexable && !new URLSearchParams(search).has('preview') ? 'index, follow, max-image-preview:large' : 'noindex, follow'],
      ['meta[property="og:title"]', title], ['meta[property="og:description"]', description], ['meta[property="og:url"]', url],
      ['meta[name="twitter:title"]', title], ['meta[name="twitter:description"]', description],
    ]) document.querySelector(selector)?.setAttribute('content', value);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', url);
    let schema = document.getElementById('search-identity');
    if (!indexable) schema?.remove();
    else {
      if (!schema) { schema=document.createElement('script');schema.id='search-identity';schema.setAttribute('type','application/ld+json');document.head.append(schema); }
      schema.textContent=JSON.stringify(searchIdentity(url,title,description));
    }
  }, [pathname, search, platform]);
  return null;
}
