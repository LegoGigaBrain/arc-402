const links = [
  {
    href: '/onboard',
    title: 'Launch onboarding',
    desc: 'Deploy wallet, bind Face ID, set policy defaults, and register the agent for ARC-402\'s governed hiring flow before the machine-side governed workroom is started. Onboarding explains the canonical `agentname.arc402.xyz` path and when a custom HTTPS endpoint is acceptable.',
  },
  {
    href: '/passkey-setup',
    title: 'Passkey setup only',
    desc: 'Register a passkey and extract the x/y coordinates for CLI-driven activation.',
  },
  {
    href: '/passkey-sign',
    title: 'Passkey signing page',
    desc: 'Approve governance requests coming from the ARC-402 governed workroom.',
  },
  {
    href: '/sign',
    title: 'Owner wallet signing page',
    desc: 'Approve EOA owner actions from Coinbase Wallet or WalletConnect.',
  },
]

export default function Home() {
  return (
    <main style={{ minHeight: '100vh', background: '#080808', color: '#f0f0f0', padding: '24px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🚀</div>
          <h1 style={{ fontSize: '1.9rem', margin: '0 0 10px' }}>ARC-402 launch surface</h1>
          <p style={{ color: '#8a8a8a', lineHeight: 1.6, margin: 0 }}>
            Launch-scope pages only. ARC-402 is one product: agent-to-agent hiring with governed sandboxed execution. These pages cover the phone-side setup surfaces; the operator machine later runs hired work inside ARC-402's dedicated governed workroom. OpenClaw users should not read this as a whole-environment migration.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              style={{
                textDecoration: 'none',
                color: 'inherit',
                background: '#111',
                border: '1px solid #1e1e1e',
                borderRadius: 16,
                padding: '18px 20px',
                display: 'block',
              }}
            >
              <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 6 }}>{link.title}</div>
              <div style={{ color: '#777', fontSize: '0.92rem', lineHeight: 1.55 }}>{link.desc}</div>
              <div style={{ color: '#60a5fa', fontSize: '0.82rem', marginTop: 10 }}>{link.href} →</div>
            </a>
          ))}
        </div>
      </div>
    </main>
  )
}
