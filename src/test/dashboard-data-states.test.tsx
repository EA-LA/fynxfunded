import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({data:{} as any}));
vi.mock("@/hooks/use-trading-data",async()=>{
  const actual=await import("@/lib/tradingData");return {useTradingData:()=>mocks.data,computeAnalytics:actual.computeAnalytics};
});
vi.mock("recharts",()=>({ResponsiveContainer:()=>null,Area:()=>null,AreaChart:()=>null,CartesianGrid:()=>null,Tooltip:()=>null,XAxis:()=>null,YAxis:()=>null}));
import Analytics from "@/pages/dashboard/Analytics";
import Objectives from "@/pages/dashboard/Objectives";
import Trades from "@/pages/dashboard/Trades";
import { mapClosedTrade } from "@/lib/tradingData";
beforeEach(()=>{mocks.data={hasAccount:true,accountName:"Account A",accountSize:10000,loading:false,error:"",brokerConnected:false,trades:[],objectives:null};});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("dashboard data states",()=>{
  it.each([Analytics,Trades,Objectives])("does not display empty performance while records fail to load",Page=>{
    mocks.data.error="Trading records could not be loaded.";render(<MemoryRouter><Page/></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent(mocks.data.error);expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });
  it("does not invent objectives from closed P/L when evaluation is missing",()=>{
    render(<MemoryRouter><Objectives/></MemoryRouter>);expect(screen.getByText("Evaluation not available")).toBeInTheDocument();
    expect(screen.queryByText("Daily Loss Limit")).not.toBeInTheDocument();expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });
  it("changes displayed analytics when the user selects a date range",()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,7,12));
    mocks.data.trades=[1,14,60].map((days,i)=>mapClosedTrade(String(i),{pnl:10,closeTime:new Date(Date.now()-days*86400000).toISOString()}));
    render(<MemoryRouter><Analytics/></MemoryRouter>);
    expect(screen.getByText(/showing 3 of 3 closed trades/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"7D"}));expect(screen.getByText(/showing 1 of 3 closed trades/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"30D"}));expect(screen.getByText(/showing 2 of 3 closed trades/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"All"}));expect(screen.getByText(/showing 3 of 3 closed trades/)).toBeInTheDocument();
  });
});
