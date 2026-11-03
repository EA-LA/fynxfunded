import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import NotFound from "@/pages/NotFound";
afterEach(cleanup);
const show=(path:string)=>render(<I18nProvider><MemoryRouter initialEntries={[path]}><NotFound/></MemoryRouter></I18nProvider>);
describe("not found page",()=>{
  it("keeps site navigation and offers helpful links",()=>{
    show("/old-link");
    expect(screen.getByRole("heading",{level:1,name:"We couldn't find that page"})).toBeInTheDocument();
    expect(screen.getByText("/old-link")).toBeInTheDocument();
    expect(screen.getByRole("link",{name:/Back to home/})).toHaveAttribute("href","/");
    const popular=screen.getByRole("navigation",{name:"Popular pages"});
    expect(popular.querySelectorAll("a")).toHaveLength(4);
    expect(screen.getByRole("link",{name:"support@fynxfunded.com"})).toHaveAttribute("href","mailto:support@fynxfunded.com");
  });
  it("is titled as a missing page and kept out of search results",()=>{
    const robots=document.createElement("meta");robots.setAttribute("name","robots");robots.setAttribute("content","index, follow");document.head.append(robots);
    show("/missing");
    expect(document.title).toBe("Page not found | FYNX Funded");
    expect(robots.getAttribute("content")).toBe("noindex, follow");
    robots.remove();
  });
});
