import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({lookup:vi.fn()}));
vi.mock("@/services/certificates",()=>({getCertificateByPublicId:mocks.lookup,getCertificateTitle:()=>"Challenge Passed Certificate"}));
import CertificateVerification from "@/pages/CertificateVerification";
afterEach(cleanup);
const show=()=>render(<MemoryRouter initialEntries={["/certificates/verify/public-id"]}><Routes><Route path="/certificates/verify/:certificateId" element={<CertificateVerification/>}/></Routes></MemoryRouter>);
describe("public certificate verification",()=>{
  it("distinguishes unavailable verification from a missing certificate",async()=>{
    mocks.lookup.mockRejectedValue(new Error("permission-denied"));show();
    expect(await screen.findByText("Unable to verify certificate")).toBeInTheDocument();expect(screen.queryByText(/No active public certificate/)).not.toBeInTheDocument();
  });
  it.each(["revoked","pending",undefined])("does not verify a certificate with status %s",async status=>{
    mocks.lookup.mockResolvedValue({status});show();expect(await screen.findByText("Certificate not verified")).toBeInTheDocument();expect(screen.queryByText("Verified Certificate")).not.toBeInTheDocument();
  });
});
