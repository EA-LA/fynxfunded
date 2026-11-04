import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** How long to keep looking for a #section while a lazily loaded page renders. */
const MAX_WAIT_MS = 4000;

/**
 * Router-level scroll handling for a single-page app:
 * - new pages open at the top (otherwise a footer link leaves you at the bottom),
 * - links with a #section jump to that section once it has rendered,
 * - opening a shared link such as /payouts#calendar directly jumps to the section
 *   once the page has loaded (the browser's own jump fires before it exists),
 * - back/forward navigation keeps the browser's own scroll restoration.
 */
export default function ScrollManager() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const firstRender = useRef(true);

  useEffect(() => {
    const initial = firstRender.current;
    firstRender.current = false;
    if (navigationType === "POP" && !(initial && hash)) return;
    if (!hash) {
      window.scrollTo?.(0, 0);
      return;
    }
    const started = Date.now();
    let frame = 0;
    const id = decodeURIComponent(hash.slice(1));
    const tryScroll = () => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView?.({ block: "start" });
        return;
      }
      if (Date.now() - started < MAX_WAIT_MS) frame = window.requestAnimationFrame(tryScroll);
    };
    tryScroll();
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, hash, navigationType]);

  return null;
}
