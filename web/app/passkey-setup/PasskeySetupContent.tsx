'use client'

import { useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function parseP256Key(spki: ArrayBuffer): { x: string; y: string } {
  const b = new Uint8Array(spki)
  let off = -1
  for (let i = 0; i < b.length - 65; i++) {
    if (b[i] === 0x04 && i > 20) { off = i + 1; break }
  }
  if (off === -1) throw new Error('P256 point not found in key')
  const hex = (arr: Uint8Array) => '0x' + Array.from(arr).map(v => v.toString(16).padStart(2, '0')).join('')
  return { x: hex(b.slice(off, off + 32)), y: hex(b.slice(off + 32, off + 64)) }
}

function short(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: '16px',
  padding: '28px', maxWidth: '480px', width: '100%', color: '#f0f0f0', fontFamily: 'system-ui',
}
const btn = (active: boolean, color = '#3b82f6'): React.CSSProperties => ({
  width: '100%', padding: '14px', background: active ? color : '#222',
  color: active ? 'white' : '#555', border: 'none', borderRadius: '10px',
  fontSize: '1rem', fontWeight: 500, cursor: active ? 'pointer' : 'not-allowed',
})
const mono: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all',
  background: '#1a1a1a', padding: '8px 10px', borderRadius: '6px',
}
const lbl: React.CSSProperties = { fontSize: '0.75rem', color: '#555', marginBottom: '4px', display: 'block' }
const stepDot = (active: boolean, done: boolean): React.CSSProperties => ({
  width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: '0.72rem', fontWeight: 600, flexShrink: 0,
  background: done ? '#166534' : active ? '#1d4ed8' : '#1a1a1a',
  color: done ? '#4ade80' : active ? '#93c5fd' : '#444',
  border: `1px solid ${done ? '#166534' : active ? '#2563eb' : '#333'}`,
})

type Step = 'connect' | 'sign' | 'passkey' | 'done'

// WalletConnect Project ID — from CLI config
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '455e9425343b9156fce1428250c9a54a'
const CHAIN_ID = 8453 // Base mainnet

// ─── Component ────────────────────────────────────────────────────────────────

export default function PasskeySetupContent() {
  const params = useSearchParams()
  const [step, setStep] = useState<Step>('connect')
  const [walletAddress, setWalletAddress] = useState(params.get('wallet') ?? '')
  const [wcUri, setWcUri] = useState('')
  const [result, setResult] = useState<{ credId: string; x: string; y: string } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  // ── Step 1+2: WalletConnect — connect + sign ownership ─────────────────────

  useEffect(() => {
    // If wallet was pre-filled from URL param, skip to passkey step
    if (params.get('wallet') && params.get('sig')) {
      setWalletAddress(params.get('wallet') ?? '')
      setStep('passkey')
    }
  }, [params])

  async function startWalletConnect() {
    setError('')
    setLoading(true)
    setStatus('Initialising WalletConnect...')

    try {
      // Dynamically import to avoid SSR issues
      const { SignClient } = await import('@walletconnect/sign-client')

      const client = await SignClient.init({
        projectId: WC_PROJECT_ID,
        metadata: {
          name: 'ARC-402 Passkey Setup',
          description: 'Register your Face ID for ARC-402 governance',
          url: 'https://app.arc402.xyz',
          icons: [],
        },
      })

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          eip155: {
            methods: ['eth_requestAccounts', 'personal_sign'],
            chains: [`eip155:${CHAIN_ID}`],
            events: ['accountsChanged'],
          },
        },
      })

      if (!uri) throw new Error('Failed to create WalletConnect session')

      // Show deep link for MetaMask
      const encoded = encodeURIComponent(uri)
      const mmDeepLink = `https://metamask.app.link/wc?uri=${encoded}`
      setWcUri(mmDeepLink)
      setStatus('Tap the button below to open MetaMask, then approve the connection.')
      setLoading(false)

      // Wait for approval
      const session = await approval()
      const account = session.namespaces.eip155.accounts[0].split(':')[2]
      setWalletAddress(account)
      setStatus('Connected ✓ Signing ownership proof...')
      setLoading(true)

      // Sign ownership message
      const message = `ARC-402 Passkey Setup\nWallet: ${account}\nTimestamp: ${Date.now()}\n\nI confirm I own this wallet and want to register a passkey for governance operations.`
      const hexMessage = '0x' + Array.from(new TextEncoder().encode(message)).map(b => b.toString(16).padStart(2, '0')).join('')

      await client.request({
        topic: session.topic,
        chainId: `eip155:${CHAIN_ID}`,
        request: {
          method: 'personal_sign',
          params: [hexMessage, account],
        },
      })

      // Disconnect — we only needed the sig for ownership proof
      try { await client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'done' } }) } catch { /* ok */ }

      setStatus('')
      setWcUri('')
      setLoading(false)
      setStep('passkey')

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('User rejected') && !msg.includes('cancelled')) {
        setError(msg)
      } else {
        setError('Connection cancelled. Try again.')
      }
      setWcUri('')
      setLoading(false)
      setStatus('')
    }
  }

  // ── Step 3: Register passkey ────────────────────────────────────────────────

  async function registerPasskey() {
    setError('')
    setLoading(true)
    try {
      const rpId = window.location.hostname === 'localhost' ? 'localhost' : 'arc402.xyz'
      const challenge = crypto.getRandomValues(new Uint8Array(32))

      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'ARC-402', id: rpId },
          user: {
            id: new TextEncoder().encode(walletAddress),
            name: walletAddress,
            displayName: 'ARC-402 ' + short(walletAddress),
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
        },
      }) as PublicKeyCredential

      const response = cred.response as AuthenticatorAttestationResponse
      const spki = response.getPublicKey()
      if (!spki) throw new Error('Could not extract public key from passkey response.')

      const { x, y } = parseP256Key(spki)
      setResult({ credId: b64url(cred.rawId), x, y })
      setStep('done')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // ── Steps indicator ─────────────────────────────────────────────────────────

  const steps = [
    { id: 'connect', label: 'Connect wallet', done: step !== 'connect' },
    { id: 'passkey', label: 'Register Face ID', done: step === 'done' },
  ]

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', padding: '20px' }}>
      <div style={card}>

        <h1 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '6px' }}>🔑 Register Passkey</h1>
        <p style={{ color: '#555', fontSize: '0.82rem', marginBottom: '24px' }}>
          Face ID replaces MetaMask for governance. One-time setup.
        </p>

        {/* Steps */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'center' }}>
          {steps.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < steps.length - 1 ? 1 : 0 }}>
              <div style={stepDot(step === s.id || (step === 'sign' && s.id === 'connect'), s.done)}>
                {s.done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: '0.72rem', color: (step === s.id || (step === 'sign' && s.id === 'connect')) ? '#93c5fd' : s.done ? '#4ade80' : '#444', whiteSpace: 'nowrap' }}>
                {s.label}
              </span>
              {i < steps.length - 1 && <div style={{ flex: 1, height: 1, background: '#222', minWidth: 12 }} />}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ color: '#ef4444', background: '#1a0808', border: '1px solid #3a1a1a', padding: '10px 12px', borderRadius: '8px', fontSize: '0.8rem', marginBottom: 16 }}>
            ❌ {error}
          </div>
        )}

        {/* Status */}
        {status && !error && (
          <div style={{ color: '#888', background: '#1a1a1a', padding: '10px 12px', borderRadius: '8px', fontSize: '0.8rem', marginBottom: 16 }}>
            {status}
          </div>
        )}

        {/* Step: connect / sign */}
        {(step === 'connect' || step === 'sign') && (
          <div>
            {!wcUri && (
              <>
                <p style={{ color: '#666', fontSize: '0.82rem', marginBottom: 16 }}>
                  Tap below to open MetaMask and prove wallet ownership. After approval, you&apos;ll register Face ID on this page.
                </p>
                <button onClick={startWalletConnect} disabled={loading} style={btn(!loading)}>
                  {loading ? '⏳ Connecting...' : '🦊 Connect & Sign with MetaMask'}
                </button>
              </>
            )}

            {wcUri && !loading && (
              <div style={{ textAlign: 'center' }}>
                <a
                  href={wcUri}
                  style={{ display: 'block', width: '100%', padding: '14px', background: '#f6851b', color: 'white', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 500, textDecoration: 'none', marginBottom: 12 }}
                >
                  🦊 Open in MetaMask
                </a>
                <p style={{ color: '#444', fontSize: '0.75rem' }}>
                  Tap above → approve connection in MetaMask → come back here
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step: passkey */}
        {step === 'passkey' && (
          <div>
            <div style={{ background: '#0a180a', border: '1px solid #1a3a1a', borderRadius: '8px', padding: '12px', marginBottom: 16 }}>
              <span style={{ color: '#4ade80', fontSize: '0.82rem' }}>✓ Wallet verified</span>
              <div style={{ ...mono, background: 'transparent', padding: '4px 0 0', color: '#666' }}>{walletAddress}</div>
            </div>
            <p style={{ color: '#666', fontSize: '0.82rem', marginBottom: 16 }}>
              Now register your Face ID. The key is generated in your device&apos;s secure enclave and never leaves your phone.
            </p>
            <button onClick={registerPasskey} disabled={loading} style={btn(!loading, '#16a34a')}>
              {loading ? '⏳ Waiting for Face ID...' : '👤 Register with Face ID'}
            </button>
          </div>
        )}

        {/* Done */}
        {step === 'done' && result && (
          <div>
            <div style={{ color: '#4ade80', fontWeight: 600, marginBottom: 16 }}>✅ Passkey registered</div>

            <div style={{ marginBottom: 10 }}>
              <span style={lbl}>Credential ID</span>
              <div style={mono}>{result.credId}</div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <span style={lbl}>pubKeyX</span>
              <div style={mono}>{result.x}</div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <span style={lbl}>pubKeyY</span>
              <div style={mono}>{result.y}</div>
            </div>

            <div style={{ background: '#0d0d1a', border: '1px solid #1a1a3a', borderRadius: '8px', padding: '14px' }}>
              <span style={{ fontSize: '0.72rem', color: '#444', display: 'block', marginBottom: 8 }}>
                Run to activate on-chain (requires one MetaMask approval):
              </span>
              <div style={{ ...mono, color: '#818cf8', lineHeight: 1.7 }}>
                arc402 wallet set-passkey \<br />
                &nbsp;&nbsp;{result.x} \<br />
                &nbsp;&nbsp;{result.y}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
