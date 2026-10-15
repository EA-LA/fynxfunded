import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { ThemeProvider } from './components/ThemeProvider';
import { I18nProvider } from './lib/i18n';
import Index from './pages/Index';
import HowItWorks from './pages/HowItWorks';
import Challenges from './pages/ChallengesPricing';
import Rules from './pages/Rules';
import Payouts from './pages/PayoutsPage';
import FAQ from './pages/FAQ';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import Risk from './pages/RiskDisclosure';
import Refunds from './pages/RefundPolicy';
import Aml from './pages/AmlKyc';
import Builder from './pages/ChallengeBuilder';

const routes = {'/':Index,'/how-it-works':HowItWorks,'/challenges':Challenges,'/rules':Rules,'/payouts':Payouts,'/faq':FAQ,'/terms':Terms,'/privacy':Privacy,'/risk-disclosure':Risk,'/refund-policy':Refunds,'/aml-kyc':Aml,'/challenge-builder':Builder};
export function render(route: keyof typeof routes) {
  const Page = routes[route];
  if (!Page) throw new Error(`Not a public route: ${route}`);
  return renderToString(<StaticRouter location={route}><ThemeProvider><I18nProvider><Page /></I18nProvider></ThemeProvider></StaticRouter>);
}
