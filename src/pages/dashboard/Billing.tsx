import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, Timestamp, where } from "firebase/firestore";
import { CreditCard, FileText, ReceiptText, Search } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

type Order = Record<string, any> & { id: string };
function toDate(value: any) { if (!value) return null; if (value instanceof Timestamp) return value.toDate(); if (value?.toDate) return value.toDate(); const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function date(value: any) { return toDate(value)?.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) || "—"; }
function money(value: any, currency="USD") { return new Intl.NumberFormat(undefined, { style: "currency", currency: String(currency || "USD").toUpperCase() }).format(Number(value || 0)); }

export default function Billing() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!db || !user?.uid) return;
    return onSnapshot(query(collection(db, "orders"), where("userId", "==", user.uid)), snap => setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() }))), e => setError(e.message));
  }, [user?.uid]);
  const visible = useMemo(() => orders.filter(o => (status === "all" || o.status === status) && (!search || [o.challenge,o.id,o.status,o.stripeSessionId].some(v => String(v || "").toLowerCase().includes(search.toLowerCase())))).sort((a,b)=>(toDate(b.createdAt)?.getTime()||0)-(toDate(a.createdAt)?.getTime()||0)), [orders,search,status]);
  const paid = orders.filter(o => o.status === "paid");
  const resume = (order: Order) => {
    const expiry = toDate(order.checkoutExpiresAt);
    if (order.checkoutUrl && (!expiry || expiry > new Date())) window.location.href = order.checkoutUrl;
    else window.location.href = `/checkout?size=${sizeIndex(order.accountSize)}&phase=${order.phase || "2-phase"}&style=${order.style || "normal"}&currency=${order.currency || "USD"}`;
  };
  return <div className="space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">Orders & payments</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Billing</h1><p className="mt-2 text-sm text-muted-foreground">Review purchases, resume unpaid orders, and access order records.</p></div>
    {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</div>}
    <div className="grid gap-4 sm:grid-cols-3"><Summary icon={ReceiptText} title="Total orders" value={orders.length}/><Summary icon={CreditCard} title="Paid orders" value={paid.length}/><Summary icon={FileText} title="Total paid" value={money(paid.reduce((s,o)=>s+Number(o.amount||0),0))}/></div>
    <div className="overflow-hidden rounded-lg border border-border bg-card"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative max-w-sm flex-1"><Search size={15} className="absolute left-3 top-2.5 text-muted-foreground"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search orders..." className="h-9 w-full rounded-md border border-border bg-secondary/30 pl-9 pr-3 text-sm outline-none"/></div><div className="flex gap-1">{["all","pending","paid","failed","refunded"].map(x=><button key={x} onClick={()=>setStatus(x)} className={`rounded-md px-3 py-2 text-xs capitalize ${status===x?"bg-primary text-primary-foreground":"bg-secondary text-muted-foreground"}`}>{x}</button>)}</div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Challenge / order</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead><tbody>{visible.map(o=><tr key={o.id} className="border-t border-border"><td className="px-4 py-4"><p className="font-medium">{o.challenge || `${money(o.accountSize)} challenge`}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{o.id}</p></td><td className="px-4 py-4">{date(o.paidAt || o.createdAt)}</td><td className="px-4 py-4 font-semibold">{money(o.amount,o.currency)}</td><td className="px-4 py-4 capitalize">{o.paymentMethod || "card"}</td><td className="px-4 py-4"><Badge value={o.status}/></td><td className="px-4 py-4">{o.status === "pending" ? <button onClick={()=>resume(o)} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Pay now</button> : <button onClick={()=>window.print()} className="rounded-md border border-border px-3 py-2 text-xs">Receipt</button>}</td></tr>)}</tbody></table>{!visible.length&&<div className="py-16 text-center"><ReceiptText className="mx-auto mb-3 text-muted-foreground"/><p className="text-sm font-medium">No orders found</p><p className="mt-1 text-xs text-muted-foreground">New and completed checkout orders will appear here.</p></div>}</div>
    </div>
  </div>;
}
function sizeIndex(size:number){return size>=200000?5:size>=100000?4:size>=50000?3:size>=25000?2:size>=10000?1:0;}
function Summary({icon:Icon,title,value}:{icon:any;title:string;value:string|number}){return <div className="premium-card"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{title}</p><Icon size={17}/></div><p className="mt-4 text-2xl font-bold">{value}</p></div>}
function Badge({value}:{value:string}){const ok=value==="paid",bad=["failed","refunded"].includes(value);return <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${ok?"bg-emerald-500/10 text-emerald-500":bad?"bg-destructive/10 text-destructive":"bg-amber-500/10 text-amber-500"}`}>{value||"pending"}</span>}
