import { cleanup, within, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({data:{} as any}));
vi.mock("@/hooks/use-trading-data",async()=>{
  const actual=await import("@/lib/tradingData");return {useTradingData:()=>mocks.data,computeAnalytics:actual.computeAnalytics};
});
vi.mock("recharts",()=>({ResponsiveContainer:()=>null,Area:()=>null,AreaChart:()=>null,CartesianGrid:()=>null,Tooltip:()=>null,XAxis:()=>null,YAxis:()=>null,Bar:()=>null,BarChart:()=>null,Cell:()=>null}));
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
  it("links the quick risk slider to the full planner for this account size",()=>{
    mocks.data.accountSize=50000;render(<MemoryRouter><Objectives/></MemoryRouter>);
    expect(screen.getByRole("link",{name:/See how many losses fit/})).toHaveAttribute("href","/rules?size=50000&risk=1#risk-planner");
    cleanup();mocks.data.accountSize=12345;render(<MemoryRouter><Objectives/></MemoryRouter>);
    expect(screen.getByRole("link",{name:/See how many losses fit/})).toHaveAttribute("href","/rules?size=10000&risk=1#risk-planner");
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
  it("explains objective words in place and links to the journal replay",()=>{
    mocks.data.objectives={profitTarget:{current:2,target:8},dailyLoss:{current:1,limit:5},maxLoss:{current:2,limit:10},minTradingDays:{current:3,target:5},consistency:{largestWinDay:30,threshold:40}};mocks.data.evaluationAt="2026-11-01T00:00:00Z";
    render(<MemoryRouter><Objectives/></MemoryRouter>);
    for(const term of ["profit-target","daily-loss-limit","maximum-loss","minimum-trading-days","consistency-rule","risk-per-trade","trading-day"]) expect(document.querySelector(`[data-glossary-term="${term}"]`)).not.toBeNull();
    expect(screen.getByRole("button",{name:/Daily Loss Limit: What does/})).toBeInTheDocument();
    expect(screen.getByLabelText(/Planned risk/)).toHaveAttribute("type","range");
    expect(screen.getByTestId("objectives-replay-link")).toHaveAttribute("href","/dashboard/analytics#journal-replay");
  });
  it("shows the journal replay and label help on Analytics",()=>{
    mocks.data.accountSize=25000;
    mocks.data.trades=[1,2,3].map(d=>mapClosedTrade(String(d),{pnl:d===2?-1400:100,closeTime:`2026-10-0${d}T12:00:00.000Z`}));
    render(<MemoryRouter><Analytics/></MemoryRouter>);
    expect(screen.getByTestId("journal-replay")).toBeInTheDocument();
    expect(screen.getByTestId("replay-verdict")).toHaveTextContent("The daily loss limit would have been broken on Fri, Oct 2, 2026");
    // Headline tile plus the Long and Short tiles of the long/short comparison.
    expect(screen.getAllByRole("button",{name:/What does "win rate" mean/})).toHaveLength(3);
    expect(within(screen.getByTestId("long-short-card")).getAllByRole("button",{name:/What does "win rate" mean/})).toHaveLength(2);
    expect(screen.getByRole("button",{name:/What does "payoff ratio" mean/})).toBeInTheDocument();
  });
});
