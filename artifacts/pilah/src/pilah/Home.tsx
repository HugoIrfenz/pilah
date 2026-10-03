import { Link } from 'wouter';
import { ArrowRight, Bell, Lock, MessageCircle, Play, Sparkles, Users, Zap } from 'lucide-react';
import { Brand } from './ui';
import './home.css';

const cards = [
  { n: 'Mara Chen', i: 'MC', c: '#a1504a', t: '10:24', m: 'Could you approve the final poster before I send it to print?', p: 'Needs your response', pc: '#fbe5e1', pt: '#c0392b', top: 70, d: '0s' },
  { n: 'Dad', i: 'D', c: '#2d7d6b', t: '09:18', m: 'Got the 11:20 train for Sunday. I\u2019ll send the ticket details.', p: 'Read later', pc: '#faefd2', pt: '#a8700a', top: 190, d: '.8s' },
  { n: 'The housemates', i: 'H', c: '#6b8a80', t: 'Yesterday', m: 'The plumber has Thursday morning open. Does that work?', p: 'Low priority', pc: '#e8eeea', pt: '#52645d', top: 310, d: '1.6s' },
];
const feats = [
  { I: Zap, t: 'See what matters', d: 'Get a clear priority list in seconds.' },
  { I: Lock, t: 'Stay in control', d: 'You choose which chats to include.' },
  { I: Users, t: 'Built for real life', d: 'Work, family, friends \u2014 less noise, more you.' },
];

export default function Home() {
  return <div className="ph">
    <div className="ph-wrap">
      <header className="ph-nav">
        <Brand />
        <nav aria-label="Primary">
          <span className="ph-tag">A quieter inbox for a busier you.</span>
          <Link href="/demo" data-testid="link-nav-demo">Demo</Link>
          <Link href="/privacy" data-testid="link-nav-privacy">Privacy</Link>
        </nav>
      </header>
      <main>
        <section className="ph-hero">
          <div>
            <span className="ph-chip"><i />Less noise. More you.</span>
            <h1>Don&rsquo;t read everything.<em>Know what needs you.</em></h1>
            <p className="ph-lead">Pilah helps you see which WhatsApp conversations actually need your attention, so you can focus on what matters.</p>
            <div className="ph-cta">
              <Link href="/live" className="ph-btn p" data-testid="link-connect"><MessageCircle size={16} />Connect WhatsApp<ArrowRight size={15} /></Link>
              <Link href="/demo" className="ph-btn s" data-testid="link-try-demo">Try the demo<Play size={13} /></Link>
            </div>
            <p className="ph-priv"><Lock size={13} />Private. Read-only. Your messages stay yours.</p>
          </div>
          <div className="ph-art" aria-hidden="true">
            <span className="ph-orb" style={{ left: -10, top: 200, width: 130, height: 130 }} />
            <span className="ph-orb" style={{ left: 90, bottom: 0, width: 190, height: 110 }} />
            <span className="ph-heart" />
            <div className="ph-phone" />
            {cards.map(c => <div key={c.n} className="ph-card" style={{ top: c.top, animationDelay: c.d }}>
              <span className="ph-av" style={{ background: c.c }}>{c.i}</span>
              <div><b>{c.n}</b><p>{c.m}</p><span className="ph-pill" style={{ background: c.pc, color: c.pt }}><i />{c.p}</span></div>
              <time>{c.t}</time>
            </div>)}
            <span className="ph-note" style={{ right: 0, top: 30 }}>This<br />needs you.</span>
            <span className="ph-note" style={{ right: 0, top: 360, fontSize: 16 }}>Everything<br />else can wait.</span>
            <div className="ph-dock"><MessageCircle size={20} color="#0a6b52" /><Sparkles size={20} /><Bell size={20} /></div>
          </div>
        </section>
        <section className="ph-feats" aria-label="Highlights">
          {feats.map(({ I, t, d }) => <div key={t}><I size={18} /><p style={{ margin: 0 }}><b>{t}</b><span>{d}</span></p></div>)}
        </section>
      </main>
    </div>
  </div>;
}
