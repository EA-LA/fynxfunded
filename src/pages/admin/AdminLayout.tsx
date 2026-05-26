import { Link, NavLink, Outlet } from "react-router-dom";

export default function AdminLayout(){
return <div className="min-h-screen bg-background text-foreground"><header className="border-b border-border"><div className="max-w-7xl mx-auto px-6 py-4 flex justify-between"><h1 className="font-bold">FYNX Admin</h1><Link to="/dashboard" className="text-sm text-muted-foreground">Back</Link></div></header><div className="max-w-7xl mx-auto px-6 py-6"><nav className="flex gap-4 mb-6 text-sm">{['','users','challenges','violations','payouts'].map((p)=><NavLink key={p} to={`/admin/${p}`} end={p===''} className={({isActive})=>isActive?'font-semibold':'text-muted-foreground'}>{p||'overview'}</NavLink>)}</nav><Outlet/></div></div>
}
