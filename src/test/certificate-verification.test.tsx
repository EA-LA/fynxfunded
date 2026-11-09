import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({lookup:vi.fn()}));
vi.mock("@/services/certificates",()=>({getCertificateByPublicId:mocks.lookup,getCertificateTitle:()=>"Challenge Passed Certificate"}));
import CertificateVerification from "@/pages/CertificateVerification";
import Terms from "@/pages/Terms";
import { I18nProvider } from "@/lib/i18n";
import { faqItems } from "@/lib/faqContent";
import { certificateVerifyPath, certificateVerifyUrl, normalizeCertificateInput } from "@/lib/certificateLookup";
afterEach(cleanup);
beforeEach(()=>{mocks.lookup.mockReset();});
const show=(path="/certificates/verify/public-id")=>render(<I18nProvider><MemoryRouter initialEntries={[path]}><Routes><Route path="/certificates/verify" element={<CertificateVerification/>}/><Route path="/certificates/verify/:certificateId" element={<CertificateVerification/>}/></Routes></MemoryRouter></I18nProvider>);
const issued={status:"issued",type:"challenge_passed",publicVerificationId:"FYNX-CERT-0ABC123",traderName:"Sam Trader",challengeType:"2-Phase",accountSize:25000};
describe("public certificate verification",()=>{
  it("distinguishes unavailable verification from a missing certificate",async()=>{
    mocks.lookup.mockRejectedValue(new Error("permission-denied"));show();
    expect(await screen.findByText("Unable to verify certificate")).toBeInTheDocument();expect(screen.queryByText(/No active public certificate/)).not.toBeInTheDocument();
  });
  it.each(["revoked","pending",undefined])("does not verify a certificate with status %s",async status=>{
    mocks.lookup.mockResolvedValue({status});show();expect(await screen.findByText("Certificate not verified")).toBeInTheDocument();expect(screen.queryByText("Verified Certificate")).not.toBeInTheDocument();
  });
  it("shows only the details a certificate records, never a column of dashes",async()=>{
    mocks.lookup.mockResolvedValue({...issued,passedDate:"2026-10-02T10:00:00Z",issuedAt:"2026-10-03T10:00:00Z"});show();
    expect(await screen.findByText("Verified Certificate")).toBeInTheDocument();
    for(const label of ["Certificate ID","Account","Challenge","Account Size","Passed Date","Issued"])expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("Funded Date")).not.toBeInTheDocument();
    expect(screen.queryByText("Profit Split")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
  it("shows course details instead of challenge rows on a learning certificate",async()=>{
    mocks.lookup.mockResolvedValue({status:"issued",type:"learning_completion",publicVerificationId:"FYNX-CERT-0LRN001",traderName:"Sam Trader",courseName:"Risk management basics",quizAverage:92,issuedAt:"2026-10-03T10:00:00Z",accountSize:0,challengeType:""});show();
    expect(await screen.findByText("Risk management basics")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("FYNX Academy")).toBeInTheDocument();
    for(const label of ["Challenge","Account Size","Passed Date","Funded Date","Profit Split"])expect(screen.queryByText(label)).not.toBeInTheDocument();
  });
  it("retries the lookup when verification was unavailable",async()=>{
    mocks.lookup.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(issued);show();
    fireEvent.click(await screen.findByRole("button",{name:/Try again/}));
    expect(await screen.findByText("Verified Certificate")).toBeInTheDocument();
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });
  it("offers a lookup form on the bare page and opens the normalized ID",async()=>{
    mocks.lookup.mockResolvedValue(issued);show("/certificates/verify");
    expect(screen.getByRole("heading",{level:1,name:"Verify a FYNX Funded certificate"})).toBeInTheDocument();
    expect(mocks.lookup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:/Verify/}));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a certificate ID");
    fireEvent.change(screen.getByLabelText("Certificate ID or verification link"),{target:{value:"  https://fynxfunded.com/certificates/verify/fynx-cert-0abc123 "}});
    fireEvent.click(screen.getByRole("button",{name:/Verify/}));
    expect(await screen.findByText("Sam Trader")).toBeInTheDocument();
    expect(mocks.lookup).toHaveBeenCalledWith("FYNX-CERT-0ABC123");
  });
  it("copies the verification link for a valid certificate",async()=>{
    const writeText=vi.fn().mockResolvedValue(undefined);Object.assign(navigator,{clipboard:{writeText}});
    mocks.lookup.mockResolvedValue(issued);show("/certificates/verify/FYNX-CERT-0ABC123");
    fireEvent.click(await screen.findByRole("button",{name:/Copy verification link/}));
    await waitFor(()=>expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/certificates/verify/FYNX-CERT-0ABC123`));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(screen.getByText(/Status checked/)).toBeInTheDocument();
  });
  it("gives help for a missing certificate and keeps site navigation",async()=>{
    mocks.lookup.mockResolvedValue(null);show("/certificates/verify/FYNX-CERT-NOPE");
    expect(await screen.findByText(/Check every character/)).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Verify a certificate"})).toHaveAttribute("href","/certificates/verify");
    expect(screen.getByRole("link",{name:"see the FAQ"})).toHaveAttribute("href","/faq#certificate-verification");
  });
});
describe("certificate ID input",()=>{
  it.each([
    ["FYNX-CERT-0ABC123","FYNX-CERT-0ABC123"],
    [" fynx-learn-00zz9x ","FYNX-LEARN-00ZZ9X"],
    ["https://www.fynxfunded.com/certificates/verify/FYNX-CERT-0ABC123?ref=x#top","FYNX-CERT-0ABC123"],
    ["fynxfunded.com/certificates/verify/FYNX-CERT-%200ABC","FYNX-CERT-0ABC"],
    ["Custom-Id","Custom-Id"],
    ["   ",""],
  ])("normalizes %j",(raw,expected)=>expect(normalizeCertificateInput(raw)).toBe(expected));
  it("builds encoded paths and links",()=>{
    expect(certificateVerifyPath("a/b")).toBe("/certificates/verify/a%2Fb");
    expect(certificateVerifyUrl("FYNX-CERT-1","https://example.com/")).toBe("https://example.com/certificates/verify/FYNX-CERT-1");
  });
  it("is answered in the FAQ with a link to the lookup",()=>{
    expect(faqItems.find(i=>i.id==="certificate-verification")?.link?.to).toBe("/certificates/verify");
  });
});
describe("legal pages",()=>{
  it("link every section back to the table of contents",()=>{
    render(<I18nProvider><MemoryRouter><Terms/></MemoryRouter></I18nProvider>);
    expect(screen.getByRole("navigation",{name:"Table of Contents"})).toHaveAttribute("id","contents");
    const back=screen.getAllByRole("link",{name:/Back to contents/});
    expect(back.length).toBe(document.querySelectorAll("section[id]").length);
    expect(back[0]).toHaveAttribute("href","#contents");
  });
});
