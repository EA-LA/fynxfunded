import { Link, useSearchParams } from 'react-router-dom';
import OrderProgress from '@/components/OrderProgress';
export default function OrderStatus() {
  const [params] = useSearchParams(); const orderId = params.get('orderId') || '';
  return <main className="min-h-screen bg-background px-4 py-12"><div className="mx-auto max-w-3xl space-y-6"><Link to="/dashboard/billing" className="text-sm underline">Back to Billing</Link><div><h1 className="text-2xl font-bold">Order status</h1><p className="mt-2 text-sm text-muted-foreground">Track payment confirmation and trading-account setup separately.</p></div>{/^[A-Za-z0-9_-]{1,220}$/.test(orderId) ? <OrderProgress orderId={orderId}/> : <div className="premium-card"><p>Choose an order from Billing to check its status.</p><Link className="mt-4 inline-block underline" to="/dashboard/billing">Open Billing</Link></div>}</div></main>;
}
