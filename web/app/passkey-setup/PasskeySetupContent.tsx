'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

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
  padding: '32px', maxWidth: '480px', width: '100%', color: '#f0f0f0', fontFamily: 'system-ui',
}
const btn = (active: boolean): React.CSSProperties => ({
  width: '100%', padding: '14px', background: active ? '#3b82f6' : '#222',
  color: active ? 'white' : '#555', border: 'none', borderRadius: '10px',
  fontSize: '1rem', fontWeight: 500, cursor: active ? 'pointer' : 'not-allowed',
  transition: 'background 0.2s',
})
const mono: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all',
  background: '#1a1a1a', padding: '8px 10px', borderRadius: '6px',
}
const label: React.CSSProperties = { fontSize: '0.75rem', color: '#666', marginBottom: '4px' }
const stepDot = (active: boolean, done: boolean): React.CSSProperties => ({
  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600, flexShrink: 0,
  background: done ? '#166534' : active ? '#1d4ed8' : '#222',
  color: done ? '#4ade80' : active ? '#93c5fd' : '#555',
  border: `1px solid ${done ? '#166534' : active ? '#1d4ed8' : '#333'}`,
})

// ─── Component ────────────────────────────────────────────────────────────────

type Step = 'connect' | 'sign' | 'passkey' | 'done'

export default function PasskeySetupContent() {
  const params = useSearchParams()
  const [step, setStep] = useState<Step>('connect')
  const [connectedAddress, setConnectedAddress] = useState(params.get('wallet') ?? '')
  const [ownershipSig, setOwnershipSig] = useState('')
  const [result, setResult] = useState<{ credId: string; x: string; y: string } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // ── Step 1: Connect MetaMask ────────────────────────────────────────────────

  async function connectWallet() {
    setError('')
    setLoading(true)
    try {
      const eth = (window as Window & { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum
      if (!eth) throw new Error('MetaMask not found. Install MetaMask or open this page in MetaMask\'s browser.')
      const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[]
      if (!accounts?.length) throw new Error('No accounts returned from MetaMask.')
      setConnectedAddress(accounts[0])
      setStep('sign')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: Sign ownership proof ───────────────────────────────────────────

  async function proveOwnership() {
    setError('')
    setLoading(true)
    try {
      const eth = (window as Window & { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum
      if (!eth) throw new Error('MetaMask not available.')
      const message = `ARC-402 Passkey Setup\nWallet: ${connectedAddress}\nTimestamp: ${Date.now()}\n\nI confirm I own this wallet and want to register a passkey for governance operations.`
      const sig = await eth.request({
        method: 'personal_sign',
        params: [message, connectedAddress],
      }) as string
      setOwnershipSig(sig)
      setStep('passkey')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
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
            id: new TextEncoder().encode(connectedAddress),
            name: connectedAddress,
            displayName: 'ARC-402 Wallet ' + short(connectedAddress),
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

  // ── Render ──────────────────────────────────────────────────────────────────

  const steps = [
    { id: 'connect', label: 'Connect MetaMask', done: step !== 'connect' },
    { id: 'sign', label: 'Prove ownership', done: step === 'passkey' || step === 'done' },
    { id: 'passkey', label: 'Register Face ID', done: step === 'done' },
  ]

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', padding: '20px' }}>
      <div style={card}>

        {/* Header */}
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: '6px' }}>🔑 Register Passkey</h1>
        <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '28px' }}>
          Face ID replaces MetaMask for governance. One setup, permanent.
        </p>

        {/* Steps */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 28, alignItems: 'center' }}>
          {steps.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < steps.length - 1 ? 1 : 0 }}>
              <div style={stepDot(step === s.id, s.done)}>
                {s.done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: '0.72rem', color: step === s.id ? '#93c5fd' : s.done ? '#4ade80' : '#555', whiteSpace: 'nowrap' }}>
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div style={{ flex: 1, height: 1, background: '#222', minWidth: 8 }} />
              )}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ color: '#ef4444', background: '#1a0a0a', border: '1px solid #3a1a1a', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', marginBottom: 16 }}>
            ❌ {error}
          </div>
        )}

        {/* Step 1: Connect */}
        {step === 'connect' && (
          <div>
            <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: 20 }}>
              Connect the MetaMask wallet that owns your ARC-402 wallet contract. This proves you have the right to register a passkey.
            </p>
            <button onClick={connectWallet} disabled={loading} style={btn(!loading)}>
              {loading ? '⏳ Connecting...' : '🦊 Connect MetaMask'}
            </button>
          </div>
        )}

        {/* Step 2: Sign */}
        {step === 'sign' && (
          <div>
            <div style={{ background: '#1a1a1a', borderRadius: '10px', padding: '14px', marginBottom: 20 }}>
              <div style={label}>Connected wallet</div>
              <div style={{ ...mono, background: 'transparent', padding: 0, fontSize: '0.8rem', color: '#4ade80' }}>
                {connectedAddress}
              </div>
            </div>
            <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: 20 }}>
              Sign a message to prove you own this wallet. This signature stays in the browser — it&apos;s not sent anywhere.
            </p>
            <button onClick={proveOwnership} disabled={loading} style={btn(!loading)}>
              {loading ? '⏳ Waiting for signature...' : '✍️ Sign ownership proof'}
            </button>
          </div>
        )}

        {/* Step 3: Passkey */}
        {step === 'passkey' && (
          <div>
            <div style={{ background: '#0f1a0f', border: '1px solid #1a3a1a', borderRadius: '10px', padding: '12px', marginBottom: 20, fontSize: '0.82rem' }}>
              <span style={{ color: '#4ade80' }}>✓ Ownership verified</span>
              <span style={{ color: '#666', marginLeft: 8 }}>{short(connectedAddress)}</span>
            </div>
            <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: 20 }}>
              Register your Face ID or fingerprint. This creates a P256 key in your device&apos;s secure enclave — it never leaves your device.
            </p>
            <button onClick={registerPasskey} disabled={loading} style={btn(!loading)}>
              {loading ? '⏳ Waiting for Face ID...' : '👤 Register with Face ID / Fingerprint'}
            </button>
          </div>
        )}

        {/* Done */}
        {step === 'done' && result && (
          <div>
            <div style={{ color: '#4ade80', fontWeight: 600, marginBottom: 16, fontSize: '1rem' }}>
              ✅ Passkey registered
            </div>

            <div style={{ background: '#0f1a0f', border: '1px solid #1a3a1a', borderRadius: '10px', padding: '16px', marginBottom: 16 }}>
              <div style={{ ...label, marginBottom: 6 }}>Wallet</div>
              <div style={mono}>{connectedAddress}</div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={label}>Credential ID</div>
              <div style={mono}>{result.credId}</div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={label}>pubKeyX</div>
              <div style={mono}>{result.x}</div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={label}>pubKeyY</div>
              <div style={mono}>{result.y}</div>
            </div>

            <div style={{ background: '#111', border: '1px solid #222', borderRadius: '8px', padding: '14px' }}>
              <div style={{ fontSize: '0.75rem', color: '#555', marginBottom: 8 }}>Run this command to activate on-chain:</div>
              <div style={{ ...mono, color: '#93c5fd', lineHeight: 1.6 }}>
                arc402 wallet set-passkey \<br />
                &nbsp;&nbsp;{result.x} \<br />
                &nbsp;&nbsp;{result.y}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#444', marginTop: 10 }}>
                Requires one MetaMask approval to register the key on your wallet contract. After that, Face ID handles all governance operations.
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
