'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

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

type State = 'idle' | 'waiting' | 'done' | 'error'

export default function PasskeySetupContent() {
  const params = useSearchParams()
  const [wallet, setWallet] = useState(params.get('wallet') ?? '')
  const [state, setState] = useState<State>('idle')
  const [result, setResult] = useState<{ credId: string; x: string; y: string } | null>(null)
  const [error, setError] = useState('')

  async function register() {
    setState('waiting')
    try {
      const rpId = window.location.hostname === 'localhost' ? 'localhost' : 'arc402.xyz'
      const challenge = crypto.getRandomValues(new Uint8Array(32))

      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'ARC-402', id: rpId },
          user: { id: new TextEncoder().encode(wallet), name: wallet, displayName: 'ARC-402 Wallet' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
          timeout: 60000,
        },
      }) as PublicKeyCredential

      const response = cred.response as AuthenticatorAttestationResponse
      const spki = response.getPublicKey()
      if (!spki) throw new Error('Could not extract public key')

      const { x, y } = parseP256Key(spki)
      setResult({ credId: b64url(cred.rawId), x, y })
      setState('done')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', padding: '20px' }}>
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: '16px', padding: '32px', maxWidth: '480px', width: '100%', color: '#f0f0f0', fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: '8px' }}>🔑 Register Passkey</h1>
        <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '24px' }}>
          One-time setup. Your Face ID / fingerprint will replace MetaMask for all governance operations.
        </p>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '6px' }}>
            Wallet address
          </label>
          <input
            type="text"
            value={wallet}
            onChange={e => setWallet(e.target.value)}
            placeholder="0xb4aF8760..."
            style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '10px 14px', color: '#f0f0f0', fontFamily: 'monospace', fontSize: '0.75rem', outline: 'none' }}
          />
        </div>

        {state === 'idle' && (
          <button
            onClick={register}
            disabled={!wallet || !wallet.startsWith('0x') || wallet.length !== 42}
            style={{ width: '100%', padding: '14px', background: (!wallet || !wallet.startsWith('0x') || wallet.length !== 42) ? '#333' : '#3b82f6', color: (!wallet || !wallet.startsWith('0x') || wallet.length !== 42) ? '#666' : 'white', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 500, cursor: (!wallet || !wallet.startsWith('0x') || wallet.length !== 42) ? 'not-allowed' : 'pointer' }}>
            Register with Face ID / Fingerprint
          </button>
        )}

        {state === 'waiting' && (
          <div style={{ textAlign: 'center', color: '#888', padding: '14px' }}>⏳ Waiting for Face ID / fingerprint...</div>
        )}

        {state === 'error' && (
          <div>
            <div style={{ color: '#ef4444', padding: '14px', background: '#1a1a1a', borderRadius: '10px', marginBottom: '12px' }}>❌ {error}</div>
            <button onClick={() => setState('idle')} style={{ width: '100%', padding: '14px', background: '#333', color: 'white', border: 'none', borderRadius: '10px', fontSize: '1rem', cursor: 'pointer' }}>
              Try Again
            </button>
          </div>
        )}

        {state === 'done' && result && (
          <div style={{ background: '#0f1f0f', border: '1px solid #1a3a1a', borderRadius: '10px', padding: '16px' }}>
            <div style={{ color: '#22c55e', marginBottom: '12px', fontWeight: 600 }}>✅ Passkey registered</div>
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '6px' }}>Credential ID (save to daemon.toml):</div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all', background: '#111', padding: '8px', borderRadius: '6px', marginBottom: '12px' }}>{result.credId}</div>
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '4px' }}>pubKeyX:</div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all', background: '#111', padding: '8px', borderRadius: '6px', marginBottom: '8px' }}>{result.x}</div>
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '4px' }}>pubKeyY:</div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all', background: '#111', padding: '8px', borderRadius: '6px', marginBottom: '16px' }}>{result.y}</div>
            <div style={{ fontSize: '0.8rem', color: '#666', fontFamily: 'monospace' }}>
              arc402 wallet set-passkey {result.x} {result.y}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
