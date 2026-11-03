import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const MAX_ATTEMPTS = 20;

/**
 * Router-level scroll handling for a single-page app:
 * - new pages open at the top (otherwise a footer link leaves you at the bottom),
 * - links with a #section jump to that section once it has rendered,
 * - back/forward navigation keeps the browser's own scroll restoration.
 */
export default function ScrollManager() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === "POP") return;
    if (!hash) {
      window.scrollTo?.(0, 0);
      return;
    }
    let attempts = 0;
    let frame = 0;
    const id = decodeURIComponent(hash.slice(1));
    const tryScroll = () => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView?.({ block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < MAX_ATTEMPTS) frame = window.requestAnimationFrame(tryScroll);
    };
    tryScroll();
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, hash, navigationType]);

  return null;
}
