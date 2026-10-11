import { describe, expect, it } from "vitest";
import { mapClosedTrade, selectTradingData, computeAnalytics, recordedObjectives, numeric } from "@/lib/tradingData";
const trade = (id: string, pnl = 10, fields = {}) => mapClosedTrade(id, {accountId:"a", challengeId:"c", openTime:"2026-09-01T08:00:00Z", closeTime:"2026-09-01T09:00:00Z", pnl, ...fields})!;
const challenge = {id:"c", name:"Selected", accountSize:10000, status:"active", brokerAccountId:"a"};
const account = {id:"a", challengeId:"c", balance:0, equity:0, login:"123", status:"active"};
describe("broker record handling", () => {
  it("excludes open positions, missing close dates, and invalid P/L", () => {
    expect(mapClosedTrade("open", {updatedAt:"2026-09-01", pnl:12})).toBeNull();
    expect(trade("open", 12, {status:"open"})).toBeNull();
    expect(trade("bad", NaN)).toBeNull();
    expect(trade("bad", 12, {closeTime:"bad-date"})).toBeNull();
    expect(trade("bad", 12, {pnl:null})).toBeNull();
    expect(numeric(" ")).toBeNull();
  });
  it("normalizes timestamp objects and keeps zero P/L as breakeven", () => {
    expect(trade("zero",0,{closedAt:{toDate:()=>new Date("2026-09-02T09:00:00Z")},closeTime:undefined})).toMatchObject({pnl:0,result:"Breakeven",closeTime:"2026-09-02T09:00:00.000Z"});
  });
  it("never mixes accounts, conflicting associations, or unassigned trades", () => {
    const rows = [trade("ours"), trade("other",1000,{accountId:"b",challengeId:"d"}), trade("conflict",1000,{accountId:"b"}), trade("wrong-challenge",1000,{challengeId:"d"}), trade("unassigned",1000,{accountId:"",challengeId:""}), trade("challenge-only",20,{accountId:""})];
    const result = selectTradingData([account,{id:"b",challengeId:"d",status:"active",balance:90000}],[challenge],rows);
    expect(result.trades.map(x=>x.id)).toEqual(["ours","challenge-only"]);
    expect(result.balance).toBe(0); expect(result.equity).toBe(0);
    expect(result.brokerConnected).toBe(false); expect(result.objectives).toBeNull();
  });
  it("uses the requested challenge and never falls back for an unknown route", () => {
    const second={...challenge,id:"d",brokerAccountId:"b"};
    const result=selectTradingData([account,{id:"b",challengeId:"d",balance:50}],[challenge,second],[trade("second",10,{challengeId:"d",accountId:"b"})],"d");
    expect(result.trades).toHaveLength(1); expect(result.balance).toBe(50);
    expect(selectTradingData([account],[challenge],[trade("ours")],"missing").trades).toEqual([]);
  });
  it("does not invent balances before broker records arrive", () => {
    expect(selectTradingData([],[challenge],[])).toMatchObject({balance:null,equity:null});
  });
});
describe("recorded analytics", () => {
  it("calculates drawdown chronologically even with unsorted input", () => {
    const rows=[trade("last",80,{closeTime:"2026-09-03T10:00:00Z"}),trade("first",100),trade("middle",-60,{closeTime:"2026-09-02T10:00:00Z"})];
    expect(computeAnalytics(rows)).toMatchObject({maxDrawdown:60,totalPnl:120,currentDrawdown:0});
  });
  it("does not count breakeven trades as wins or preserve a streak across them", () => {
    const rows=[trade("one",20),trade("two",0,{closeTime:"2026-09-02T10:00:00Z"}),trade("three",20,{closeTime:"2026-09-03T10:00:00Z"})];
    expect(computeAnalytics(rows)).toMatchObject({winRate:2/3*100,maxConsWins:1,profitFactor:Infinity});
    expect(computeAnalytics([])).toBeNull();
  });
});
describe("recorded equity evaluations", () => {
  const evaluated={...challenge, phase:"2-phase",currentPhase:2,rulePolicyVersion:"fynx-funded-v1",rulePolicy:{phase:2},lastRuleEvaluationAt:"2026-09-01T10:00:00Z",rulePolicyEvaluation:{policy_version:"fynx-funded-v1",rule:{name:"fynx-funded-v1:2-phase:2",starting_balance:"10000",daily_loss_percent:"5",max_loss_percent:"10",profit_target_percent:"5",min_trading_days:5,consistency_percent:"40"},state:{metrics:{profit:"400",daily_used_percent:"20",max_used_percent:"30",trading_days:3,consistency_share_percent:"25"}}}};
  it("uses the recorded phase target and converts limit usage to account percent", () => {
    expect(recordedObjectives(evaluated)).toEqual({profitTarget:{current:4,target:5},dailyLoss:{current:1,limit:5},maxLoss:{current:3,limit:10},minTradingDays:{current:3,target:5},consistency:{largestWinDay:25,threshold:40}});
  });
  it("rejects incomplete, stale-phase, or mismatched evaluations", () => {
    expect(recordedObjectives({...evaluated,lastRuleEvaluationAt:null})).toBeNull();
    expect(recordedObjectives({...evaluated,currentPhase:1})).toBeNull();
    expect(recordedObjectives({...evaluated,accountSize:25000})).toBeNull();
    expect(recordedObjectives({...evaluated,rulePolicyVersion:"other"})).toBeNull();
    expect(recordedObjectives({...challenge,ruleMetrics:{profitPct:10,dailyDrawdownPct:0}})).toBeNull();
  });
});

it("prefers explicit net results and includes signed charges only when their basis is known", () => {
  const base = { closeTime: "2026-10-01T10:00:00Z", pnl: 100, commission: -5, swap: -2, fees: 0 };
  expect(mapClosedTrade("net", { ...base, netProfit: 93 })?.pnl).toBe(93);
  expect(mapClosedTrade("gross", { ...base, pnlBasis: "gross_signed_costs" })?.pnl).toBe(93);
  expect(mapClosedTrade("ambiguous", base)).toBeNull();
});
