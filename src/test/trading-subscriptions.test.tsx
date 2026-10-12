import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({user:{userId:"a"} as {userId:string}|null,listeners:[] as any[],stop:vi.fn()}));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({user:mocks.user})}));
vi.mock("@/lib/firebase",()=>({db:{}}));
vi.mock("firebase/firestore",()=>({collection:(_:unknown,name:string)=>name,where:vi.fn(),query:(name:string)=>name,onSnapshot:(name:string,success:any,error:any)=>{mocks.listeners.push({name,success,error});return mocks.stop;}}));
import { useTradingData } from "@/hooks/use-trading-data";
beforeEach(()=>{vi.clearAllMocks();mocks.listeners=[];mocks.user={userId:"a"};});
afterEach(cleanup);
const send=(index:number,rows:any[]=[])=>act(()=>mocks.listeners[index].success({docs:rows.map(row=>({id:row.id,data:()=>row}))}));
describe("trading subscriptions",()=>{
  it("waits for all three collections even if one emits repeatedly",()=>{
    const {result}=renderHook(()=>useTradingData());send(0);send(0);send(0);
    expect(result.current.loading).toBe(true);send(1);expect(result.current.loading).toBe(true);send(2);expect(result.current.loading).toBe(false);
  });
  it("clears prior customer data and ignores stopped listeners",()=>{
    const {result,rerender}=renderHook(()=>useTradingData());send(1,[{id:"c",status:"active",name:"Private A"}]);
    expect(result.current.accountName).toBe("Private A");mocks.user={userId:"b"};rerender();
    expect(result.current.accountName).not.toBe("Private A");send(1,[{id:"c",name:"Old listener"}]);expect(result.current.accountName).not.toBe("Old listener");expect(mocks.stop).toHaveBeenCalledTimes(3);
  });
  it("surfaces permission errors and clears affected data",()=>{
    const {result}=renderHook(()=>useTradingData());send(0);send(1);
    act(()=>mocks.listeners[2].error(new Error("permission-denied")));
    expect(result.current.loading).toBe(false);expect(result.current.error).toContain("could not be loaded");expect(result.current.trades).toEqual([]);
  });
});
