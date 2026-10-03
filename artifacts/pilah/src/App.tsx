import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch } from 'wouter';
import { ArrowRight } from 'lucide-react';
import DemoInbox from './pilah/demo';
import Home from './pilah/Home';
import LiveInbox from './pilah/live';
import PrivacyPage from './pilah/privacy';
import { Frame } from './pilah/Frame';

const queryClient = new QueryClient();

function NotFoundPage() {
  return <Frame><div className="py-20 text-center"><p className="text-[11px] font-semibold uppercase tracking-[.15em] text-pine">Not found</p><h1 className="display mt-3 text-4xl font-extrabold tracking-[-.04em]">That page wandered off.</h1><Link href="/" className="mt-6 inline-flex items-center gap-2 text-[13px] font-semibold text-pine" data-testid="link-not-found-home">Back to PILAH <ArrowRight size={15} /></Link></div></Frame>;
}
function Router() {
  return <Switch><Route path="/" component={Home} /><Route path="/demo" component={DemoInbox} /><Route path="/live" component={LiveInbox} /><Route path="/privacy" component={PrivacyPage} /><Route component={NotFoundPage} /></Switch>;
}
function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter></QueryClientProvider>;
}

export default App;
