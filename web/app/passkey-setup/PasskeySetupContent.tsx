'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// Use Web Crypto API to parse SPKI — handles all browser/device formats correctly
async function parseP256Key(spki: ArrayBuffer): Promise<{ x: string; y: string }> {
  const key = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,  // extractable
    ['verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', key)
  if (!jwk.x || !jwk.y) throw new Error('Could not extract P256 coordinates from key')
  // JWK uses base64url encoding — convert to hex bytes
  const b64ToHex = (b64: string) => {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
    return '0x' + Array.from(bin).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  }
  return { x: b64ToHex(jwk.x), y: b64ToHex(jwk.y) }
}

function short(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '455e9425343b9156fce1428250c9a54a'
const CHAIN_ID = 8453
const BASE_RPC = 'https://mainnet.base.org'
const WALLET_FACTORY = '0x974d2ae81cC9B4955e325890f4247AC76c92148D'

async function getARC402Wallets(owner: string): Promise<string[]> {
  const response = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{
        to: WALLET_FACTORY,
        // getWallets(address) selector = keccak256("getWallets(address)")[0:4]
        data: '0x422c29a4' + owner.slice(2).toLowerCase().padStart(64, '0'),
      }, 'latest'],
    }),
  })
  const json = await response.json() as { result?: string }
  if (!json.result || json.result === '0x') return []
  // Decode address[] — offset(32) + length(32) + addresses
  const hex = json.result.slice(2)
  const count = parseInt(hex.slice(64, 128), 16)
  const wallets: string[] = []
  for (let i = 0; i < count; i++) {
    const addr = '0x' + hex.slice(128 + i * 64 + 24, 128 + (i + 1) * 64)
    wallets.push('0x' + addr.slice(2).toLowerCase())
  }
  return wallets
}

// ─── Wallet options ───────────────────────────────────────────────────────────

const WALLETS = [
  { name: 'MetaMask',        emoji: '🦊', color: '#f6851b', deepLink: (uri: string) => `https://metamask.app.link/wc?uri=${uri}` },
  { name: 'Rabby',           emoji: '🐰', color: '#7c3aed', deepLink: (uri: string) => `rabby://wc?uri=${uri}` },
  { name: 'Trust Wallet',    emoji: '🔵', color: '#3375bb', deepLink: (uri: string) => `https://link.trustwallet.com/wc?uri=${uri}` },
  { name: 'Rainbow',         emoji: '🌈', color: '#ff6b6b', deepLink: (uri: string) => `https://rnbwapp.com/wc?uri=${uri}` },
  { name: 'Coinbase Wallet', emoji: '🔷', color: '#0052ff', deepLink: (uri: string) => `https://go.cb-w.com/wc?uri=${uri}` },
]

type Step = 'connect' | 'passkey' | 'done'

// ─── Component ────────────────────────────────────────────────────────────────

export default function PasskeySetupContent() {
  const params = useSearchParams()
  const [step, setStep]         = useState<Step>('connect')
  const [walletAddr, setWalletAddr] = useState(params.get('wallet') ?? '')
  const [wcUriRaw, setWcUriRaw]   = useState('')
  const [waiting, setWaiting]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<{ credId: string; x: string; y: string } | null>(null)
  const [error, setError]       = useState('')
  const [arc402Wallets, setArc402Wallets] = useState<string[]>([])
  const [selectedWallet, setSelectedWallet] = useState('')

  // ── Step 1: WalletConnect ──────────────────────────────────────────────────

  async function initWC() {
    setError('')
    setLoading(true)
    try {
      const { SignClient } = await import('@walletconnect/sign-client')
      const client = await SignClient.init({
        projectId: WC_PROJECT_ID,
        metadata: { name: 'ARC-402 Passkey Setup', description: 'Register Face ID for ARC-402 governance', url: 'https://app.arc402.xyz', icons: [] },
      })

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          eip155: {
            methods: ['personal_sign'],
            chains: [`eip155:${CHAIN_ID}`],
            events: ['accountsChanged'],
          },
        },
      })

      if (!uri) throw new Error('Failed to create WalletConnect session')
      setWcUriRaw(encodeURIComponent(uri))
      setLoading(false)
      setWaiting(true)

      const session = await approval()
      const account = session.namespaces.eip155.accounts[0].split(':')[2]
      setWalletAddr(account)
      setWaiting(false)

      // Sign ownership proof
      const msg = `ARC-402 Passkey Setup\nWallet: ${account}\nTimestamp: ${Date.now()}\n\nI confirm I own this wallet and want to register a passkey for governance operations.`
      const hex = '0x' + Array.from(new TextEncoder().encode(msg)).map(b => b.toString(16).padStart(2, '0')).join('')
      await client.request({ topic: session.topic, chainId: `eip155:${CHAIN_ID}`, request: { method: 'personal_sign', params: [hex, account] } })

      try { await client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'done' } }) } catch { /* ok */ }

      // Look up ARC-402 wallets owned by this address
      setWcUriRaw('')
      setLoading(true)
      const wallets = await getARC402Wallets(account)
      setArc402Wallets(wallets)
      if (wallets.length === 1) setSelectedWallet(wallets[0])
      setLoading(false)
      setStep('passkey')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('rejected') || msg.includes('cancel') ? 'Cancelled. Tap a wallet button to try again.' : msg)
      setWcUriRaw('')
      setWaiting(false)
      setLoading(false)
    }
  }

  // ── Step 2: Register passkey ───────────────────────────────────────────────

  async function registerPasskey() {
    setError('')
    setLoading(true)
    try {
      // rpId must match the serving domain exactly
      // arc402-app.pages.dev → arc402-app.pages.dev
      // app.arc402.xyz       → arc402.xyz (parent domain allowed)
      const hostname = window.location.hostname
      const rpId = hostname === 'localhost'
        ? 'localhost'
        : (hostname.endsWith('.arc402.xyz') || hostname === 'arc402.xyz')
          ? 'arc402.xyz'
          : hostname
      const challenge = crypto.getRandomValues(new Uint8Array(32))
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'ARC-402', id: rpId },
          user: { id: new TextEncoder().encode(walletAddr), name: walletAddr, displayName: 'ARC-402 ' + short(walletAddr) },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
          timeout: 60000,
        },
      }) as PublicKeyCredential

      const spki = (cred.response as AuthenticatorAttestationResponse).getPublicKey()
      if (!spki) throw new Error('Could not extract public key')
      const { x, y } = await parseP256Key(spki)
      setResult({ credId: b64url(cred.rawId), x, y })
      setStep('done')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh', background: '#080808',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '16px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: '#111', border: '1px solid #1e1e1e', borderRadius: 20,
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '24px 24px 0' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🔑</div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f0f0f0', margin: '0 0 4px' }}>
            Register Passkey
          </h1>
          <p style={{ color: '#555', fontSize: '0.82rem', margin: '0 0 20px', lineHeight: 1.5 }}>
            Face ID replaces MetaMask for all governance operations. One-time setup.
          </p>

          {/* Step pills */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
            {[
              { id: 'connect', label: 'Verify ownership' },
              { id: 'passkey', label: 'Register Face ID' },
              { id: 'done',    label: 'Complete' },
            ].map((s, i) => {
              const steps = ['connect', 'passkey', 'done']
              const current = steps.indexOf(step)
              const sIdx = steps.indexOf(s.id)
              const isDone = sIdx < current
              const isActive = sIdx === current
              return (
                <div key={s.id} style={{
                  flex: 1, padding: '5px 6px', borderRadius: 8, textAlign: 'center',
                  background: isDone ? '#0a1a0a' : isActive ? '#0a0f1f' : '#0d0d0d',
                  border: `1px solid ${isDone ? '#1a3a1a' : isActive ? '#1a2a5a' : '#1a1a1a'}`,
                }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 600, color: isDone ? '#4ade80' : isActive ? '#60a5fa' : '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isDone ? '✓ ' : `${i + 1}. `}{s.label}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '0 24px 24px' }}>

          {/* Error */}
          {error && (
            <div style={{ background: '#1a0808', border: '1px solid #3a1515', borderRadius: 10, padding: '10px 12px', fontSize: '0.8rem', color: '#f87171', marginBottom: 16, lineHeight: 1.4 }}>
              {error}
            </div>
          )}

          {/* ── CONNECT STEP ── */}
          {step === 'connect' && !wcUriRaw && !waiting && (
            <div>
              <p style={{ color: '#666', fontSize: '0.82rem', marginBottom: 16, lineHeight: 1.5 }}>
                Choose your wallet to prove ownership. You&apos;ll sign one message — nothing is sent to any server.
              </p>
              {loading ? (
                <div style={{ textAlign: 'center', color: '#555', padding: '20px 0', fontSize: '0.85rem' }}>
                  ⏳ Generating connection...
                </div>
              ) : (
                <button onClick={initWC} style={{ width: '100%', padding: '13px', background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12, color: '#818cf8', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer', marginBottom: 0 }}>
                  Show wallet options →
                </button>
              )}
            </div>
          )}

          {/* Wallet buttons */}
          {step === 'connect' && wcUriRaw && (
            <div>
              <p style={{ color: '#555', fontSize: '0.78rem', marginBottom: 12, textAlign: 'center' }}>
                Tap your wallet to connect and sign
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {WALLETS.map(w => (
                  <a
                    key={w.name}
                    href={w.deepLink(wcUriRaw)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px', borderRadius: 12, textDecoration: 'none',
                      background: '#0d0d0d', border: `1px solid ${w.color}22`,
                    }}
                  >
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{w.emoji}</span>
                    <span style={{ color: '#d0d0d0', fontSize: '0.9rem', fontWeight: 500 }}>{w.name}</span>
                    <span style={{ marginLeft: 'auto', color: w.color, fontSize: '0.75rem', fontWeight: 600 }}>Open →</span>
                  </a>
                ))}
              </div>
              <p style={{ color: '#444', fontSize: '0.72rem', textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
                After approving in your wallet, return to this page
              </p>
            </div>
          )}

          {/* Waiting for approval */}
          {step === 'connect' && waiting && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: 4 }}>Waiting for wallet approval...</p>
              <p style={{ color: '#444', fontSize: '0.75rem' }}>Approve in your wallet, then come back here</p>
            </div>
          )}

          {/* ── PASSKEY STEP ── */}
          {step === 'passkey' && (
            <div>
              {/* Owner EOA */}
              <div style={{ background: '#0a180a', border: '1px solid #1a3a1a', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
                <div style={{ fontSize: '0.7rem', color: '#444', marginBottom: 3 }}>Owner (MetaMask) ✓</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#4ade80', wordBreak: 'break-all' }}>{walletAddr}</div>
              </div>

              {/* ARC-402 wallet selector */}
              {loading && (
                <div style={{ color: '#555', fontSize: '0.8rem', textAlign: 'center', padding: '12px 0', marginBottom: 12 }}>
                  ⏳ Looking up ARC-402 wallets...
                </div>
              )}

              {!loading && arc402Wallets.length === 0 && (
                <div style={{ background: '#1a0f00', border: '1px solid #3a2000', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: '0.78rem', color: '#f59e0b' }}>⚠️ No ARC-402 wallets found for this owner</div>
                  <div style={{ fontSize: '0.72rem', color: '#555', marginTop: 4 }}>Deploy one first: <code style={{ color: '#818cf8' }}>arc402 wallet deploy</code></div>
                </div>
              )}

              {!loading && arc402Wallets.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: '0.7rem', color: '#444', marginBottom: 6 }}>
                    ARC-402 wallet{arc402Wallets.length > 1 ? 's' : ''} — passkey will be registered on:
                  </div>
                  {arc402Wallets.map(w => (
                    <button
                      key={w}
                      onClick={() => setSelectedWallet(w)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 6,
                        background: selectedWallet === w ? '#0a1a2e' : '#0d0d0d',
                        border: `1px solid ${selectedWallet === w ? '#2563eb' : '#1a1a1a'}`,
                        borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                      }}
                    >
                      <span style={{ color: selectedWallet === w ? '#60a5fa' : '#333', fontSize: 14 }}>
                        {selectedWallet === w ? '●' : '○'}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: selectedWallet === w ? '#93c5fd' : '#666', wordBreak: 'break-all' }}>
                        {w}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {!loading && arc402Wallets.length > 0 && (
                <>
                  <p style={{ color: '#555', fontSize: '0.78rem', marginBottom: 14, lineHeight: 1.5 }}>
                    Face ID key is generated in your device&apos;s secure enclave. It never leaves your phone.
                  </p>
                  <button
                    onClick={registerPasskey}
                    disabled={loading || !selectedWallet}
                    style={{ width: '100%', padding: '14px', background: (!selectedWallet || loading) ? '#1a1a1a' : '#16a34a', color: (!selectedWallet || loading) ? '#444' : 'white', border: 'none', borderRadius: 12, fontSize: '1rem', fontWeight: 600, cursor: (!selectedWallet || loading) ? 'not-allowed' : 'pointer' }}
                  >
                    {loading ? '⏳ Waiting for Face ID...' : '👤 Register with Face ID'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && result && (
            <div>
              <div style={{ background: '#0a180a', border: '1px solid #166534', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
                <div style={{ color: '#4ade80', fontWeight: 600, marginBottom: 8 }}>✅ Passkey registered</div>
                <div style={{ fontSize: '0.7rem', color: '#444', marginBottom: 3 }}>Owner (MetaMask)</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#555', wordBreak: 'break-all', marginBottom: 8 }}>{walletAddr}</div>
                <div style={{ fontSize: '0.7rem', color: '#444', marginBottom: 3 }}>ARC-402 wallet</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#60a5fa', wordBreak: 'break-all' }}>{selectedWallet}</div>
              </div>

              {[
                { label: 'Credential ID', value: result.credId },
                { label: 'pubKeyX', value: result.x },
                { label: 'pubKeyY', value: result.y },
              ].map(f => (
                <div key={f.label} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: '0.72rem', color: '#444', marginBottom: 4 }}>{f.label}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 8, padding: '8px 10px', color: '#888', wordBreak: 'break-all', lineHeight: 1.5 }}>{f.value}</div>
                </div>
              ))}

              <div style={{ background: '#0a0a1a', border: '1px solid #1a1a3a', borderRadius: 10, padding: '14px', marginTop: 4 }}>
                <div style={{ fontSize: '0.72rem', color: '#444', marginBottom: 8 }}>Activate on-chain (one MetaMask tap):</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#818cf8', lineHeight: 1.8, wordBreak: 'break-all' }}>
                  arc402 wallet set-passkey \<br />
                  &nbsp;&nbsp;{result.x} \<br />
                  &nbsp;&nbsp;{result.y}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      <p style={{ color: '#2a2a2a', fontSize: '0.68rem', marginTop: 16 }}>
        ARC-402 Protocol • app.arc402.xyz
      </p>
    </div>
  )
}
