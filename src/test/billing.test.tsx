import { MemoryRouter } from "react-router-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({user:{userId:"customer-a"} as {userId:string}|null,subscriptions:[] as any[],where:vi.fn(),stop:vi.fn()}));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({user:mocks.user})}));
vi.mock("@/lib/firebase",()=>({db:{}}));
vi.mock("@/components/PaymentHold",()=>({default:()=>null}));
vi.mock("firebase/firestore",()=>({Timestamp:class {},collection:()=>({}),where:mocks.where,query:()=>({}),onSnapshot:(_:unknown,success:any,error:any)=>{mocks.subscriptions.push({success,error});return mocks.stop;}}));
import Billing from "@/pages/dashboard/Billing";
beforeEach(()=>{vi.clearAllMocks();mocks.subscriptions=[];mocks.user={userId:"customer-a"};});
afterEach(cleanup);
const emit=(index:number, status="paid")=>act(()=>mocks.subscriptions[index].success({docs:[{id:"order",data:()=>({status,challenge:"Customer A purchase",amount:199})}]}));
describe("billing orders",()=>{
  it("queries the application userId and only offers receipts for paid orders",()=>{
    render(<MemoryRouter><Billing/></MemoryRouter>);expect(mocks.where).toHaveBeenCalledWith("userId","==","customer-a");emit(0);
    expect(screen.getByText("Customer A purchase")).toBeInTheDocument();expect(screen.getByRole("button",{name:"Download PDF"})).toBeInTheDocument();
    emit(0,"failed");expect(screen.queryByRole("button",{name:"Download PDF"})).not.toBeInTheDocument();
  });
  it("clears prior customer records on session switch and ignores old callbacks",()=>{
    const view=render(<MemoryRouter><Billing/></MemoryRouter>);emit(0);mocks.user={userId:"customer-b"};view.rerender(<MemoryRouter><Billing/></MemoryRouter>);
    expect(mocks.stop).toHaveBeenCalled();expect(screen.queryByText("Customer A purchase")).not.toBeInTheDocument();
    emit(0);expect(screen.queryByText("Customer A purchase")).not.toBeInTheDocument();
  });
  it("shows failures as failures instead of empty order history",()=>{
    render(<MemoryRouter><Billing/></MemoryRouter>);act(()=>mocks.subscriptions[0].error(new Error("permission-denied")));
    expect(screen.getByRole("alert")).toHaveTextContent("Orders could not be loaded");expect(screen.queryByText("No orders found")).not.toBeInTheDocument();
  });
});
