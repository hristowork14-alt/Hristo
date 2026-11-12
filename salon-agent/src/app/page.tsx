// Demo home page: a pretend salon website with the widget embedded exactly as a
// customer's site would embed it, plus links for the owner.
import Script from 'next/script';

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px 120px' }}>
      <p className="hint" style={{ margin: 0 }}>Демо сайт на салон</p>
      <h1 style={{ fontSize: 32, lineHeight: 1.15, margin: '6px 0 12px' }}>Барбър Студио Витоша</h1>
      <p style={{ maxWidth: 520 }}>
        Класическо подстригване, брада и бръснене с горещ пешкир в центъра на София. Запазете час по всяко време — онлайн
        рецепцията отговаря веднага, на български и английски.
      </p>
      <p className="hint">Натиснете бутона <b>„Запази час“</b> долу вдясно.</p>

      <section style={{ marginTop: 40, padding: 16, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
        <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>За собственика</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li><a href="/dashboard">Табло за управление</a> — днешни часове, разговори, цени и работно време</li>
          <li><a href="/chat">Чат на цял екран</a> — линк за Instagram, Facebook или Google</li>
          <li>Кодът за вашия сайт (един ред):
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'var(--surface-2)', padding: 10, borderRadius: 8, fontSize: 13 }}>
              {'<script src="https://ВАШИЯТ-ДОМЕЙН/widget.js" data-salon="demo-barber" async></script>'}
            </pre>
          </li>
        </ul>
      </section>
      <Script src="/widget.js" data-salon="demo-barber" strategy="afterInteractive" />
    </main>
  );
}
