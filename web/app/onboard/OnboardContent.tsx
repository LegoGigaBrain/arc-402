'use client'

import { useState } from 'react'
import { ethers } from 'ethers'

// ─── Constants ────────────────────────────────────────────────────────────────

const WC_PROJECT_ID   = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '455e9425343b9156fce1428250c9a54a'
const CHAIN_ID        = 8453
const BASE_RPC        = 'https://mainnet.base.org'
const WALLET_FACTORY  = '0x974d2ae81cC9B4955e325890f4247AC76c92148D'
const ENTRY_POINT     = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'
const AGENT_REGISTRY  = '0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622'
const POLICY_ENGINE   = '0xAA5Ef3489C929bFB3BFf5D5FE15aa62d3763c847'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function short(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function parseP256Key(spki: ArrayBuffer): Promise<{ x: string; y: string }> {
  const key = await crypto.subtle.importKey(
    'spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', key)
  if (!jwk.x || !jwk.y) throw new Error('Could not extract P256 coordinates from key')
  const b64ToHex = (b64: string) => {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
    return '0x' + Array.from(bin).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  }
  return { x: b64ToHex(jwk.x), y: b64ToHex(jwk.y) }
}

async function getARC402Wallets(owner: string): Promise<string[]> {
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{
        to: WALLET_FACTORY,
        data: '0x422c29a4' + owner.slice(2).toLowerCase().padStart(64, '0'),
      }, 'latest'],
    }),
  })
  const json = await res.json() as { result?: string }
  if (!json.result || json.result === '0x') return []
  const hex = json.result.slice(2)
  const count = parseInt(hex.slice(64, 128), 16)
  const wallets: string[] = []
  for (let i = 0; i < count; i++) {
    wallets.push('0x' + hex.slice(128 + i * 64 + 24, 128 + (i + 1) * 64).toLowerCase())
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

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'deploy' | 'passkey' | 'policy' | 'agent' | 'done'

interface PasskeyResult { credId: string; x: string; y: string }

interface WCHandle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
  topic: string
  account: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardContent() {
  const [step, setStep] = useState<Step>('deploy')

  // Completed data
  const [account, setAccount]                   = useState('')
  const [arc402Wallet, setArc402Wallet]         = useState('')
  const [existingWallets, setExistingWallets]   = useState<string[]>([])
  const [passkeyResult, setPasskeyResult]       = useState<PasskeyResult | null>(null)
  const [passkeyActivated, setPasskeyActivated] = useState(false)
  const [policyDone, setPolicyDone]             = useState(false)
  const [agentDone, setAgentDone]               = useState(false)

  // WC / loading UI
  const [wcUri, setWcUri]       = useState('')
  const [waiting, setWaiting]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  // Policy form
  const [velocityLimit, setVelocityLimit]       = useState('0.05')
  const [guardianAddr, setGuardianAddr]         = useState('')
  const [maxHirePrice, setMaxHirePrice]         = useState('0.1')
  const [generatedGuardianKey, setGeneratedGuardianKey] = useState('')

  // Agent form
  const [agentName, setAgentName]               = useState('')
  const [agentCaps, setAgentCaps]               = useState('')
  const [agentServiceType, setAgentServiceType] = useState('')
  const [agentEndpoint, setAgentEndpoint]       = useState('')

  function resetWc() { setWcUri(''); setWaiting(false) }

  // ── WC session helper ──────────────────────────────────────────────────────

  async function connectWC(methods: string[]): Promise<WCHandle> {
    const { SignClient } = await import('@walletconnect/sign-client')
    const client = await SignClient.init({
      projectId: WC_PROJECT_ID,
      metadata: {
        name: 'ARC-402 Onboarding',
        description: 'ARC-402 wallet setup',
        url: 'https://app.arc402.xyz',
        icons: [],
      },
    })
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        eip155: {
          methods,
          chains: [`eip155:${CHAIN_ID}`],
          events: ['accountsChanged'],
        },
      },
    })
    if (!uri) throw new Error('Failed to create WalletConnect session')
    setWcUri(encodeURIComponent(uri))
    setWaiting(true)
    const session = await approval()
    const s = session as unknown as { topic: string; namespaces: { eip155: { accounts: string[] } } }
    const acc = s.namespaces.eip155.accounts[0].split(':')[2]
    setWaiting(false)
    resetWc()
    return { client, topic: s.topic, account: acc }
  }

  async function sendWCTx(wc: WCHandle, to: string, data: string, from?: string): Promise<string> {
    return wc.client.request({
      topic: wc.topic,
      chainId: `eip155:${CHAIN_ID}`,
      request: {
        method: 'eth_sendTransaction',
        params: [{ from: from ?? wc.account, to, data, value: '0x0' }],
      },
    }) as Promise<string>
  }

  async function disconnectWC(wc: WCHandle) {
    try { await wc.client.disconnect({ topic: wc.topic, reason: { code: 6000, message: 'done' } }) } catch { /* ok */ }
  }

  // ── STEP 1: Deploy ─────────────────────────────────────────────────────────

  async function doDeploy() {
    setError(''); setLoading(true); setStatusMsg('Connecting wallet...')
    try {
      const wc = await connectWC(['eth_sendTransaction'])
      setAccount(wc.account)

      setStatusMsg('Checking for existing ARC-402 wallets...')
      const wallets = await getARC402Wallets(wc.account)
      setExistingWallets(wallets)

      if (wallets.length > 0) {
        setArc402Wallet(wallets[0])
        await disconnectWC(wc)
        setStep('passkey')
        return
      }

      setStatusMsg('Deploying ARC-402 wallet...')
      const factoryIface = new ethers.Interface([
        'function createWallet(address _entryPoint) external returns (address)',
      ])
      const data = factoryIface.encodeFunctionData('createWallet', [ENTRY_POINT])
      const txHash = await sendWCTx(wc, WALLET_FACTORY, data)

      setStatusMsg('Waiting for confirmation...')
      const provider = new ethers.JsonRpcProvider(BASE_RPC)
      const receipt = await provider.waitForTransaction(txHash, 1, 90000)
      if (!receipt || receipt.status !== 1) throw new Error('Transaction failed. Check Basescan.')

      const factoryEventIface = new ethers.Interface([
        'event WalletCreated(address indexed owner, address indexed walletAddress)',
      ])
      let walletAddress = ''
      for (const log of receipt.logs) {
        try {
          const parsed = factoryEventIface.parseLog(log)
          if (parsed?.name === 'WalletCreated') { walletAddress = parsed.args.walletAddress as string; break }
        } catch { continue }
      }
      if (!walletAddress) throw new Error('Could not find deployed wallet address.')

      setArc402Wallet(walletAddress)
      await disconnectWC(wc)
      setStep('passkey')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('rejected') || msg.includes('cancel') ? 'Cancelled. Tap to try again.' : msg)
      resetWc()
    } finally { setLoading(false); setStatusMsg('') }
  }

  // ── STEP 2: Passkey ────────────────────────────────────────────────────────

  async function doRegisterPasskey() {
    setError(''); setLoading(true)
    try {
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
          user: {
            id: new TextEncoder().encode(arc402Wallet || account),
            name: arc402Wallet || account,
            displayName: 'ARC-402 ' + short(arc402Wallet || account),
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

      const spki = (cred.response as AuthenticatorAttestationResponse).getPublicKey()
      if (!spki) throw new Error('Could not extract public key')
      const { x, y } = await parseP256Key(spki)
      setPasskeyResult({ credId: b64url(cred.rawId), x, y })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }

  async function doActivatePasskey() {
    if (!passkeyResult) return
    setError(''); setLoading(true); setStatusMsg('Connecting wallet...')
    try {
      const wc = await connectWC(['eth_sendTransaction'])
      setStatusMsg('Sending setPasskey transaction...')
      const iface = new ethers.Interface(['function setPasskey(bytes32 pubKeyX, bytes32 pubKeyY) external'])
      const data = iface.encodeFunctionData('setPasskey', [passkeyResult.x, passkeyResult.y])
      await sendWCTx(wc, arc402Wallet, data)
      setPasskeyActivated(true)
      await disconnectWC(wc)
      setStep('policy')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('rejected') || msg.includes('cancel') ? 'Cancelled. Tap to try again.' : msg)
      resetWc()
    } finally { setLoading(false); setStatusMsg('') }
  }

  // ── STEP 3: Policy ─────────────────────────────────────────────────────────

  function doGenerateGuardian() {
    const w = ethers.Wallet.createRandom()
    setGeneratedGuardianKey(w.privateKey)
    setGuardianAddr(w.address)
  }

  async function doApplyPolicy() {
    setError(''); setLoading(true); setStatusMsg('Connecting wallet...')
    try {
      const wc = await connectWC(['eth_sendTransaction'])

      const ownerIface = new ethers.Interface([
        'function setVelocityLimit(uint256 limit) external',
        'function setGuardian(address _guardian) external',
      ])
      const policyIface = new ethers.Interface([
        'function setCategoryLimitFor(address wallet, string category, uint256 limitPerTx) external',
      ])

      setStatusMsg('Setting velocity limit...')
      const limitWei = ethers.parseEther(velocityLimit || '0.05')
      await sendWCTx(wc, arc402Wallet, ownerIface.encodeFunctionData('setVelocityLimit', [limitWei]))

      if (guardianAddr) {
        setStatusMsg('Setting guardian...')
        await sendWCTx(wc, arc402Wallet, ownerIface.encodeFunctionData('setGuardian', [guardianAddr]))
      }

      if (maxHirePrice) {
        setStatusMsg('Setting max hire price...')
        const hirePriceWei = ethers.parseEther(maxHirePrice || '0.1')
        await sendWCTx(wc, POLICY_ENGINE, policyIface.encodeFunctionData('setCategoryLimitFor', [arc402Wallet, 'hire', hirePriceWei]))
      }

      setPolicyDone(true)
      await disconnectWC(wc)
      setStep('agent')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('rejected') || msg.includes('cancel') ? 'Cancelled. Tap to try again.' : msg)
      resetWc()
    } finally { setLoading(false); setStatusMsg('') }
  }

  // ── STEP 4: Agent ──────────────────────────────────────────────────────────

  async function doRegisterAgent() {
    setError(''); setLoading(true); setStatusMsg('Connecting wallet...')
    try {
      const wc = await connectWC(['eth_sendTransaction'])

      const registryIface = new ethers.Interface([
        'function register(string name, string[] capabilities, string serviceType, string endpoint, string metadataURI) external',
      ])
      const execIface = new ethers.Interface([
        'function executeContractCall((address target, bytes data, uint256 value, uint256 minReturnValue, uint256 maxApprovalAmount, address approvalToken) params) external',
      ])

      const capabilities = agentCaps.split(',').map(s => s.trim()).filter(Boolean)
      const regData = registryIface.encodeFunctionData('register', [
        agentName, capabilities, agentServiceType, agentEndpoint, '',
      ])
      const execData = execIface.encodeFunctionData('executeContractCall', [{
        target: AGENT_REGISTRY,
        data: regData,
        value: 0n,
        minReturnValue: 0n,
        maxApprovalAmount: 0n,
        approvalToken: ethers.ZeroAddress,
      }])

      setStatusMsg('Registering agent...')
      await sendWCTx(wc, arc402Wallet, execData)
      setAgentDone(true)
      await disconnectWC(wc)
      setStep('done')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('rejected') || msg.includes('cancel') ? 'Cancelled. Tap to try again.' : msg)
      resetWc()
    } finally { setLoading(false); setStatusMsg('') }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const STEP_DEFS = [
    { id: 'deploy',  label: 'Deploy',  icon: '🏗️' },
    { id: 'passkey', label: 'Face ID', icon: '🔑' },
    { id: 'policy',  label: 'Policy',  icon: '📋' },
    { id: 'agent',   label: 'Agent',   icon: '🤖' },
  ] as const

  const stepOrder: Step[] = ['deploy', 'passkey', 'policy', 'agent', 'done']
  const currentIdx = stepOrder.indexOf(step)

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
          <div style={{ fontSize: 28, marginBottom: 6 }}>🚀</div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f0f0f0', margin: '0 0 4px' }}>
            ARC-402 Setup
          </h1>
          <p style={{ color: '#555', fontSize: '0.82rem', margin: '0 0 16px', lineHeight: 1.5 }}>
            Deploy your wallet, register Face ID, and go live in minutes.
          </p>

          {/* Wallet address strip */}
          {arc402Wallet && (
            <div style={{ background: '#0a180a', border: '1px solid #1a3a1a', borderRadius: 10, padding: '8px 12px', marginBottom: 16 }}>
              <div style={{ fontSize: '0.68rem', color: '#444', marginBottom: 2 }}>ARC-402 Wallet</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#4ade80', wordBreak: 'break-all' }}>{arc402Wallet}</div>
            </div>
          )}

          {/* Step progress pills */}
          <div style={{ display: 'flex', gap: 5, marginBottom: 24 }}>
            {STEP_DEFS.map((s, i) => {
              const sIdx = stepOrder.indexOf(s.id as Step)
              const isDone    = sIdx < currentIdx
              const isActive  = step === s.id
              return (
                <div key={s.id} style={{
                  flex: 1, padding: '5px 4px', borderRadius: 8, textAlign: 'center',
                  background: isDone ? '#0a1a0a' : isActive ? '#0a0f1f' : '#0d0d0d',
                  border: `1px solid ${isDone ? '#1a3a1a' : isActive ? '#1a2a5a' : '#1a1a1a'}`,
                }}>
                  <div style={{ fontSize: '0.62rem', fontWeight: 600, color: isDone ? '#4ade80' : isActive ? '#60a5fa' : '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isDone ? '✓' : `${i + 1}.`} {s.label}
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

          {/* Status */}
          {statusMsg && !error && (
            <div style={{ color: '#555', fontSize: '0.8rem', textAlign: 'center', padding: '8px 0', marginBottom: 12 }}>
              ⏳ {statusMsg}
            </div>
          )}

          {/* WC wallet deep links */}
          {wcUri && (
            <div>
              <p style={{ color: '#555', fontSize: '0.78rem', marginBottom: 12, textAlign: 'center' }}>
                Tap your wallet to connect
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {WALLETS.map(w => (
                  <a
                    key={w.name}
                    href={w.deepLink(wcUri)}
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
              <p style={{ color: '#444', fontSize: '0.72rem', textAlign: 'center', lineHeight: 1.5 }}>
                After approving, return to this page
              </p>
            </div>
          )}

          {/* Waiting spinner */}
          {waiting && !wcUri && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: 4 }}>Waiting for wallet approval...</p>
              <p style={{ color: '#444', fontSize: '0.75rem' }}>Approve in your wallet app, then return here</p>
            </div>
          )}

          {/* ── STEP 1: DEPLOY ── */}
          {step === 'deploy' && !wcUri && !waiting && (
            <div>
              <p style={{ color: '#666', fontSize: '0.82rem', marginBottom: 6, lineHeight: 1.5 }}>
                Deploy an ARC-402 wallet contract on Base Mainnet. Your connected address becomes the owner.
              </p>
              <p style={{ color: '#444', fontSize: '0.75rem', marginBottom: 16, lineHeight: 1.5 }}>
                If you already have one, it will be detected automatically.
              </p>
              {loading ? (
                <div style={{ textAlign: 'center', color: '#555', padding: '20px 0', fontSize: '0.85rem' }}>
                  ⏳ {statusMsg || 'Working...'}
                </div>
              ) : (
                <button onClick={doDeploy} style={{ width: '100%', padding: '13px', background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12, color: '#818cf8', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer' }}>
                  Connect wallet →
                </button>
              )}
            </div>
          )}

          {/* ── STEP 2: PASSKEY ── */}
          {step === 'passkey' && !wcUri && !waiting && (
            <div>
              {/* Owner EOA */}
              {account && (
                <div style={{ background: '#0a180a', border: '1px solid #1a3a1a', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: '#444', marginBottom: 3 }}>Connected as</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#4ade80', wordBreak: 'break-all' }}>{account}</div>
                </div>
              )}

              {!passkeyResult ? (
                <>
                  <p style={{ color: '#666', fontSize: '0.82rem', marginBottom: 6, lineHeight: 1.5 }}>
                    Register Face ID as your governance key. The private key lives in your device&apos;s secure enclave — it never leaves your phone.
                  </p>
                  <p style={{ color: '#444', fontSize: '0.75rem', marginBottom: 16, lineHeight: 1.5 }}>
                    After registering, you&apos;ll activate it on-chain with one wallet tap. No more MetaMask for governance.
                  </p>
                  <button
                    onClick={doRegisterPasskey}
                    disabled={loading}
                    style={{ width: '100%', padding: '14px', background: loading ? '#1a1a1a' : '#16a34a', color: loading ? '#444' : 'white', border: 'none', borderRadius: 12, fontSize: '1rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 10 }}
                  >
                    {loading ? '⏳ Waiting for Face ID...' : '👤 Register with Face ID'}
                  </button>
                  <button
                    onClick={() => setStep('policy')}
                    style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 10, color: '#444', fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    Skip for now →
                  </button>
                </>
              ) : (
                <>
                  <div style={{ background: '#0a180a', border: '1px solid #1a3a1a', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                    <div style={{ color: '#4ade80', fontWeight: 600, fontSize: '0.85rem', marginBottom: 10 }}>
                      ✅ Face ID registered
                    </div>
                    {[
                      { label: 'pubKeyX', value: passkeyResult.x },
                      { label: 'pubKeyY', value: passkeyResult.y },
                    ].map(f => (
                      <div key={f.label} style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: '0.68rem', color: '#444', marginBottom: 2 }}>{f.label}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#888', wordBreak: 'break-all' }}>{f.value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background: '#0a0a1a', border: '1px solid #1a1a3a', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                    <div style={{ fontSize: '0.68rem', color: '#444', marginBottom: 6 }}>CLI equivalent:</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#818cf8', lineHeight: 1.8, wordBreak: 'break-all' }}>
                      arc402 wallet set-passkey \<br />
                      &nbsp;&nbsp;{passkeyResult.x} \<br />
                      &nbsp;&nbsp;{passkeyResult.y}
                    </div>
                  </div>

                  <button
                    onClick={doActivatePasskey}
                    disabled={loading}
                    style={{ width: '100%', padding: '13px', background: loading ? '#1a1a1a' : '#1a1a2e', border: `1px solid ${loading ? '#1a1a1a' : '#2a2a4a'}`, borderRadius: 12, color: loading ? '#444' : '#818cf8', fontSize: '0.9rem', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 10 }}
                  >
                    {loading ? '⏳ ' + (statusMsg || 'Working...') : '🔐 Activate on-chain (WalletConnect)'}
                  </button>
                  <button
                    onClick={() => setStep('policy')}
                    style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 10, color: '#444', fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    Skip activation for now →
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── STEP 3: POLICY ── */}
          {step === 'policy' && !wcUri && !waiting && (
            <div>
              <p style={{ color: '#666', fontSize: '0.82rem', marginBottom: 16, lineHeight: 1.5 }}>
                Set spending limits and an emergency guardian. These protect your wallet if an agent misbehaves.
              </p>

              {/* Velocity limit */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: '0.72rem', color: '#555', display: 'block', marginBottom: 6 }}>
                  Velocity limit (ETH / rolling window)
                </label>
                <input
                  type="text"
                  value={velocityLimit}
                  onChange={e => setVelocityLimit(e.target.value)}
                  placeholder="0.05"
                  style={{ width: '100%', padding: '10px 12px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 10, color: '#d0d0d0', fontSize: '0.85rem', fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
              </div>

              {/* Max hire price */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: '0.72rem', color: '#555', display: 'block', marginBottom: 6 }}>
                  Max price per hire (ETH)
                </label>
                <input
                  type="text"
                  value={maxHirePrice}
                  onChange={e => setMaxHirePrice(e.target.value)}
                  placeholder="0.1"
                  style={{ width: '100%', padding: '10px 12px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 10, color: '#d0d0d0', fontSize: '0.85rem', fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
              </div>

              {/* Guardian */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: '0.72rem', color: '#555', display: 'block', marginBottom: 6 }}>
                  Emergency guardian address (optional)
                </label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <input
                    type="text"
                    value={guardianAddr}
                    onChange={e => setGuardianAddr(e.target.value)}
                    placeholder="0x… or auto-generate"
                    style={{ flex: 1, padding: '10px 12px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 10, color: '#d0d0d0', fontSize: '0.72rem', fontFamily: 'monospace' }}
                  />
                  <button
                    onClick={doGenerateGuardian}
                    style={{ padding: '10px 12px', background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 10, color: '#818cf8', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Generate
                  </button>
                </div>
                {generatedGuardianKey && (
                  <div style={{ background: '#1a0f00', border: '1px solid #3a2000', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: '0.68rem', color: '#f59e0b', marginBottom: 4 }}>⚠️ Save this private key — it is your emergency freeze key:</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#888', wordBreak: 'break-all' }}>{generatedGuardianKey}</div>
                  </div>
                )}
              </div>

              <button
                onClick={doApplyPolicy}
                disabled={loading}
                style={{ width: '100%', padding: '13px', background: loading ? '#1a1a1a' : '#1a1a2e', border: `1px solid ${loading ? '#1a1a1a' : '#2a2a4a'}`, borderRadius: 12, color: loading ? '#444' : '#818cf8', fontSize: '0.9rem', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 10 }}
              >
                {loading ? '⏳ ' + (statusMsg || 'Working...') : 'Apply settings →'}
              </button>
              <button
                onClick={() => setStep('agent')}
                style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 10, color: '#444', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Skip for now →
              </button>
            </div>
          )}

          {/* ── STEP 4: AGENT ── */}
          {step === 'agent' && !wcUri && !waiting && (
            <div>
              <p style={{ color: '#666', fontSize: '0.82rem', marginBottom: 16, lineHeight: 1.5 }}>
                Register your wallet as an agent in the ARC-402 registry so other agents can hire you.
              </p>

              {[
                { label: 'Agent name',            value: agentName,        setter: setAgentName,        placeholder: 'My Research Agent' },
                { label: 'Capabilities (comma-separated)', value: agentCaps, setter: setAgentCaps,      placeholder: 'research, summarization' },
                { label: 'Service type',          value: agentServiceType, setter: setAgentServiceType, placeholder: 'research' },
                { label: 'Endpoint URL (HTTPS)',  value: agentEndpoint,    setter: setAgentEndpoint,    placeholder: 'https://...' },
              ].map(f => (
                <div key={f.label} style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: '0.72rem', color: '#555', display: 'block', marginBottom: 5 }}>
                    {f.label}
                  </label>
                  <input
                    type="text"
                    value={f.value}
                    onChange={e => f.setter(e.target.value)}
                    placeholder={f.placeholder}
                    style={{ width: '100%', padding: '10px 12px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 10, color: '#d0d0d0', fontSize: '0.82rem', boxSizing: 'border-box' }}
                  />
                </div>
              ))}

              <button
                onClick={doRegisterAgent}
                disabled={loading || !agentName || !agentEndpoint}
                style={{ width: '100%', padding: '13px', background: (loading || !agentName || !agentEndpoint) ? '#1a1a1a' : '#1a1a2e', border: `1px solid ${(loading || !agentName || !agentEndpoint) ? '#1a1a1a' : '#2a2a4a'}`, borderRadius: 12, color: (loading || !agentName || !agentEndpoint) ? '#333' : '#818cf8', fontSize: '0.9rem', fontWeight: 500, cursor: (loading || !agentName || !agentEndpoint) ? 'not-allowed' : 'pointer', marginBottom: 10 }}
              >
                {loading ? '⏳ ' + (statusMsg || 'Working...') : '🤖 Register Agent →'}
              </button>
              <button
                onClick={() => setStep('done')}
                style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 10, color: '#444', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Skip →
              </button>
            </div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <div>
              <div style={{ textAlign: 'center', fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ color: '#4ade80', fontWeight: 600, fontSize: '1rem', textAlign: 'center', marginBottom: 16 }}>
                Setup complete
              </div>

              <div style={{ background: '#0a180a', border: '1px solid #1a3a1a', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                <div style={{ fontSize: '0.68rem', color: '#444', marginBottom: 3 }}>ARC-402 Wallet</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#4ade80', wordBreak: 'break-all' }}>{arc402Wallet}</div>
              </div>

              {[
                { label: 'Wallet deployed', done: !!arc402Wallet },
                { label: 'Face ID activated', done: passkeyActivated, note: passkeyResult && !passkeyActivated ? 'Registered but not yet on-chain' : undefined },
                { label: 'Policy configured', done: policyDone, note: !policyDone ? 'Using defaults' : undefined },
                { label: 'Agent registered', done: agentDone, note: !agentDone ? 'Not registered' : undefined },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #111' }}>
                  <span style={{ fontSize: 14, color: item.done ? '#4ade80' : '#333' }}>
                    {item.done ? '✓' : '○'}
                  </span>
                  <span style={{ fontSize: '0.82rem', color: item.done ? '#d0d0d0' : '#555' }}>{item.label}</span>
                  {item.note && <span style={{ fontSize: '0.7rem', color: '#444', marginLeft: 'auto' }}>{item.note}</span>}
                </div>
              ))}

              <div style={{ background: '#0a0a1a', border: '1px solid #1a1a3a', borderRadius: 10, padding: '14px', marginTop: 16 }}>
                <div style={{ fontSize: '0.72rem', color: '#444', marginBottom: 8 }}>Next steps</div>
                <div style={{ fontSize: '0.78rem', color: '#666', lineHeight: 1.8 }}>
                  • Fund wallet with ETH for gas<br />
                  • Run daemon: <span style={{ fontFamily: 'monospace', color: '#818cf8', fontSize: '0.72rem' }}>arc402 daemon start</span><br />
                  • Sign governance ops: <span style={{ fontFamily: 'monospace', color: '#818cf8', fontSize: '0.72rem' }}>app.arc402.xyz/passkey-sign</span>
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
