'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { AbiCoder } from 'ethers'

function hexToBytes(hex: string): Uint8Array {
  hex = hex.replace(/^0x/, '')
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16)
  return arr
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function parseDerSig(sig: Uint8Array): string {
  let off = 2 // skip 0x30 <len>
  off++ // 0x02
  const rLen = sig[off++]
  const r = sig.slice(off, off + rLen); off += rLen
  off++ // 0x02
  const sLen = sig[off++]
  const s = sig.slice(off, off + sLen)
  const pad = (arr: Uint8Array) => { const p = new Uint8Array(32); p.set(arr.slice(-32), 32 - Math.min(arr.length, 32)); return p }
  const packed = new Uint8Array(64)
  packed.set(pad(r), 0); packed.set(pad(s), 32)
  return '0x' + Array.from(packed).map(v => v.toString(16).padStart(2, '0')).join('')
}

type State = 'idle' | 'waiting' | 'done' | 'submitted' | 'error'

export default function PasskeySignContent() {
  const params = useSearchParams()
  const op = params.get('op') ?? 'Unknown operation'
  const wallet = params.get('wallet') ?? '—'
  const challengeHex = params.get('challenge') ?? ''
  const credId = params.get('credId') ?? ''
  const callbackUrl = params.get('callback') ?? ''

  const [state, setState] = useState<State>('idle')
  const [sig, setSig] = useState('')
  const [error, setError] = useState('')

  async function sign() {
    setState('waiting')
    try {
      const challengeBytes = challengeHex ? hexToBytes(challengeHex) : crypto.getRandomValues(new Uint8Array(32))

      // If credId provided, restrict to that credential. Otherwise let device offer all available credentials.
      const allowCredentials = credId ? [{
        id: Uint8Array.from(atob(credId.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer as ArrayBuffer,
        type: 'public-key' as const
      }] : []

      const hostname = window.location.hostname
      const rpId = (hostname.endsWith('.arc402.xyz') || hostname === 'arc402.xyz')
        ? 'arc402.xyz'
        : hostname === 'localhost' ? 'localhost' : hostname

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: challengeBytes.buffer as ArrayBuffer,
          allowCredentials,
          rpId,
          userVerification: 'required',
          timeout: 60000,
        },
      }) as PublicKeyCredential

      const response = assertion.response as AuthenticatorAssertionResponse

      // Parse DER signature → compact r || s (64 bytes)
      const compactHex = parseDerSig(new Uint8Array(response.signature))
      // Split into 32-byte r and s for ABI encoding
      const r = '0x' + compactHex.slice(2, 66)
      const s = '0x' + compactHex.slice(66, 130)

      // WebAuthn fields needed for on-chain hash reconstruction:
      //   sha256(authenticatorData || sha256(clientDataJSON))
      const authDataBytes = new Uint8Array(response.authenticatorData)
      const clientDataJSONBytes = new Uint8Array(response.clientDataJSON)

      // ABI-encode: (bytes32 r, bytes32 s, bytes authData, bytes clientDataJSON)
      const sigPayload = AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes', 'bytes'],
        [r, s, authDataBytes, clientDataJSONBytes]
      )
      setSig(sigPayload)

      if (callbackUrl) {
        setState('submitted')
        const res = await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signature: sigPayload, credentialId: b64url(assertion.rawId) }),
        })
        if (!res.ok) throw new Error(`Daemon returned ${res.status}`)
      }

      setState('done')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', padding: '20px' }}>
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: '16px', padding: '32px', maxWidth: '480px', width: '100%', color: '#f0f0f0', fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: '8px' }}>🔐 Sign Governance Op</h1>
        <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '20px' }}>
          ARC-402 daemon is requesting your approval. Verify details before signing.
        </p>

        <div style={{ background: '#1a1200', border: '1px solid #3a2800', borderRadius: '10px', padding: '12px', marginBottom: '20px', fontSize: '0.85rem', color: '#f59e0b' }}>
          ⚠️ Only approve if you initiated this action. Never sign unexpected requests.
        </div>

        <div style={{ background: '#1a1a1a', borderRadius: '10px', padding: '16px', marginBottom: '24px' }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#3b82f6', marginBottom: '12px' }}>{op}</div>
          <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Wallet</div>
          <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all', marginBottom: '12px' }}>{wallet}</div>
          {challengeHex && (
            <>
              <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Challenge</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.65rem', wordBreak: 'break-all', color: '#666' }}>{challengeHex}</div>
            </>
          )}
        </div>

        {state === 'idle' && (
          <button onClick={sign} style={{ width: '100%', padding: '14px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 500, cursor: 'pointer' }}>
            Sign with Face ID / Fingerprint
          </button>
        )}

        {state === 'waiting' && (
          <div style={{ textAlign: 'center', color: '#888', padding: '14px' }}>⏳ Waiting for Face ID / fingerprint...</div>
        )}

        {state === 'submitted' && (
          <div style={{ textAlign: 'center', color: '#888', padding: '14px' }}>⏳ Submitting to daemon...</div>
        )}

        {(state === 'done') && (
          <div style={{ background: '#0f1f0f', border: '1px solid #1a3a1a', borderRadius: '10px', padding: '16px' }}>
            <div style={{ color: '#22c55e', fontWeight: 600, marginBottom: callbackUrl ? 0 : '12px' }}>
              ✅ {callbackUrl ? 'Signed and submitted. Transaction on its way.' : 'Signed successfully.'}
            </div>
            {!callbackUrl && (
              <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all', color: '#888', marginTop: '8px' }}>{sig}</div>
            )}
          </div>
        )}

        {state === 'error' && (
          <div>
            <div style={{ color: '#ef4444', padding: '14px', background: '#1a1a1a', borderRadius: '10px', marginBottom: '12px' }}>❌ {error}</div>
            <button onClick={() => setState('idle')} style={{ width: '100%', padding: '14px', background: '#333', color: 'white', border: 'none', borderRadius: '10px', fontSize: '1rem', cursor: 'pointer' }}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
