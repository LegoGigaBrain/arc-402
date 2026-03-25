'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { QRCodeSVG } from 'qrcode.react'

// ─── Constants ────────────────────────────────────────────────────────────────

const WC_PROJECT_ID   = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '455e9425343b9156fce1428250c9a54a'
const CHAIN_ID        = 8453
const BASE_RPC        = 'https://base-mainnet.g.alchemy.com/v2/YIA2uRCsFI-j5pqH-aRzflrACSlV1Qrs'
const WALLET_FACTORY  = '0x801f0553585f511D9953419A9668edA078196997' // v6 — active factory (machine key autonomous ops)
const ALL_WALLET_FACTORIES = [
  '0x801f0553585f511D9953419A9668edA078196997', // v6 active — machine key autonomous ops
  // V5 factories frozen — uncomment to detect legacy wallets for migration
  // '0xcB52B5d746eEc05e141039E92e3dBefeAe496051', // v5 frozen
  // '0x3f4d4b19a69344B04fd9653E1bB12883e97300fE', // v5 frozen
]
const ENTRY_POINT     = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'
const ARC402_REGISTRY_V2 = '0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622' // Protocol registry (v2) — fallback for existing wallets
const ARC402_REGISTRY_V3 = '0x6EafeD4FA103D2De04DDee157e35A8e8df91B6A6'  // Protocol registry (v3) — new default
const ARC402_REGISTRY    = ARC402_REGISTRY_V3 || ARC402_REGISTRY_V2 // new wallets use V3, falls back to V2
const AGENT_REGISTRY          = '0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865'
const POLICY_ENGINE           = '0x9449B15268bE7042C0b473F3f711a41A29220866' // V2
const HANDSHAKE               = '0x4F5A38Bb746d7E5d49d8fd26CA6beD141Ec2DDb3'
const SERVICE_AGREEMENT       = '0xC98B402CAB9156da68A87a69E3B4bf167A3CCcF6'
const COMPUTE_AGREEMENT       = '0xf898A8A2cF9900A588B174d9f96349BBA95e57F3'
const SUBSCRIPTION_AGREEMENT  = '0x809c1D997Eab3531Eb2d01FCD5120Ac786D850D6'
const SESSION_CHANNELS        = '0x578f8d1bd82E8D6268E329d664d663B4d985BE61'
const GIGABRAIN_WALLET = '0xa9e0612a6f82bf4056D7e48A406E36C990aB83bE'

// All protocol contracts to whitelist during onboarding — agent needs these for full ARC-402 flow
const PROTOCOL_CONTRACTS_TO_WHITELIST = [
  { address: AGENT_REGISTRY, name: 'AgentRegistry' },
  { address: SERVICE_AGREEMENT, name: 'ServiceAgreement' },
  { address: COMPUTE_AGREEMENT, name: 'ComputeAgreement' },
  { address: SUBSCRIPTION_AGREEMENT, name: 'SubscriptionAgreement' },
  { address: HANDSHAKE, name: 'Handshake' },
  { address: SESSION_CHANNELS, name: 'SessionChannels' },
]

// Standard category spend limits for onboarding
const ONBOARDING_CATEGORIES = [
  { name: 'general',  eth: '0.001' },
  { name: 'hire',     eth: '0.1'   },
  { name: 'compute',  eth: '0.05'  },
  { name: 'research', eth: '0.05'  },
  { name: 'protocol', eth: '0.1'   },
]

// ─── Priority order ───────────────────────────────────────────────────────────

const PRIORITY_RDNS = [
  'io.metamask',
  'com.coinbase.wallet',
  'io.rabby',
  'me.rainbow',
  'com.okex.wallet',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMobile(): boolean {
  if (typeof window === 'undefined') return false
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 0 && window.innerWidth < 768)
}

function detectInjectedWallets(): InjectedWallet[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof window === 'undefined' || !(window as any).ethereum) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eth = (window as any).ethereum
  const wallets: InjectedWallet[] = []
  if (eth.isMetaMask)       wallets.push({ name: 'MetaMask',       emoji: '🦊', color: '#f6851b', rdns: 'io.metamask',         provider: eth })
  if (eth.isRabby)          wallets.push({ name: 'Rabby',          emoji: '🐰', color: '#7c3aed', rdns: 'io.rabby',            provider: eth })
  if (eth.isCoinbaseWallet) wallets.push({ name: 'Coinbase',       emoji: '🔷', color: '#0052ff', rdns: 'com.coinbase.wallet', provider: eth })
  if (wallets.length === 0) wallets.push({ name: 'Browser Wallet', emoji: '🔗', color: '#888',                                 provider: eth })
  return wallets
}

function sortWalletsByPriority(wallets: InjectedWallet[]): InjectedWallet[] {
  return [...wallets].sort((a, b) => {
    const ai = PRIORITY_RDNS.indexOf(a.rdns ?? '')
    const bi = PRIORITY_RDNS.indexOf(b.rdns ?? '')
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

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

async function getWalletsFromFactory(factory: string, owner: string): Promise<string[]> {
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: factory, data: '0x422c29a4' + owner.slice(2).toLowerCase().padStart(64, '0') }, 'latest'],
    }),
  })
  const json = await res.json() as { result?: string }
  if (!json.result || json.result === '0x') return []
  const hex = json.result.slice(2)
  const count = parseInt(hex.slice(64, 128), 16)
  const wallets: string[] = []
  for (let i = 0; i < count; i++) wallets.push('0x' + hex.slice(128 + i * 64 + 24, 128 + (i + 1) * 64).toLowerCase())
  return wallets
}

async function getARC402Wallets(owner: string): Promise<string[]> {
  const results = await Promise.allSettled(ALL_WALLET_FACTORIES.map(f => getWalletsFromFactory(f, owner)))
  const seen = new Set<string>(); const all: string[] = []
  for (const r of results) if (r.status === 'fulfilled') for (const w of r.value) if (!seen.has(w)) { seen.add(w); all.push(w) }
  return all
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

type Step = 'deploy' | 'passkey' | 'policy' | 'agent' | 'handshake' | 'done'

interface PasskeyResult { credId: string; x: string; y: string }

interface InjectedWallet {
  name: string
  emoji: string
  color: string
  icon?: string   // EIP-6963 info.icon — base64 data URI
  rdns?: string   // EIP-6963 info.rdns — unique per wallet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider: any
}

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

  // ── On-chain state detection — skip completed steps on refresh ──────────
  useEffect(() => {
    async function detectState() {
      // Check URL params for pre-filled wallet
      const urlWallet = new URLSearchParams(window.location.search).get('wallet')
      const urlOwner = new URLSearchParams(window.location.search).get('owner')
      if (!urlWallet && !urlOwner) return

      try {
        const rpc = new ethers.JsonRpcProvider(BASE_RPC)
        const ownerAddr = urlOwner ?? ''
        let walletAddr = urlWallet ?? ''

        // If owner given but no wallet, look it up
        if (!walletAddr && ownerAddr) {
          const res = await fetch(BASE_RPC, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
              params: [{ to: WALLET_FACTORY, data: '0x422c29a4' + ownerAddr.slice(2).toLowerCase().padStart(64, '0') }, 'latest'] }),
          })
          const json = await res.json() as { result?: string }
          if (json.result && json.result !== '0x') {
            const hex = json.result.slice(2)
            const count = parseInt(hex.slice(64, 128), 16)
            if (count > 0) walletAddr = '0x' + hex.slice(128 + 24, 128 + 64).toLowerCase()
          }
        }
        if (!walletAddr) return

        setArc402Wallet(walletAddr)
        if (ownerAddr) setAccount(ownerAddr)

        // Check passkey
        const wallet = new ethers.Contract(walletAddr, [
          'function ownerAuth() view returns (uint8, bytes32, bytes32)',
        ], rpc)
        const [signerType] = await wallet.ownerAuth().catch(() => [0n])
        if (Number(signerType) === 1) {
          setPasskeyActivated(true)
          // Check policy state — don't assume from passkey
          try {
            const peCheck = new ethers.Contract(POLICY_ENGINE, [
              'function isContractWhitelisted(address,address) view returns (bool)',
            ], rpc)
            // Check if ALL protocol contracts are whitelisted (not just Handshake)
            const allWhitelisted = await Promise.all(
              PROTOCOL_CONTRACTS_TO_WHITELIST.map(pc => peCheck.isContractWhitelisted(walletAddr, pc.address).catch(() => false))
            )
            setPolicyDone(allWhitelisted.every(Boolean))
          } catch { setPolicyDone(false) }
        }

        // Check agent registration
        const reg = new ethers.Contract(AGENT_REGISTRY, [
          'function isRegistered(address) view returns (bool)',
        ], rpc)
        const registered = await reg.isRegistered(walletAddr).catch(() => false)

        // Skip to the right step
        if (registered) {
          setAgentDone(true)
          setStep('done')
        } else if (Number(signerType) === 1) {
          setStep('agent')
        } else {
          setStep('passkey')
        }
      } catch { /* detection failed — start from beginning */ }
    }
    detectState()

    // Platform + wallet detection (desktop only)
    if (!isMobile()) {
      setIsDesktop(true)
      const eip6963: InjectedWallet[] = []
      const onAnnounce = (event: Event) => {
        const { info, provider } = (event as CustomEvent).detail as {
          info: { name: string; rdns: string; icon?: string }
          provider: unknown
        }
        // Deduplicate by rdns — same wallet announces once per chain
        if (eip6963.some(w => w.rdns === info.rdns)) return
        const colors: Record<string, string> = {
          'io.metamask': '#f6851b',
          'io.rabby': '#7c3aed',
          'com.coinbase.wallet': '#0052ff',
          'me.rainbow': '#ff6b6b',
          'com.okex.wallet': '#333',
        }
        const emojis: Record<string, string> = {
          'io.metamask': '🦊',
          'io.rabby': '🐰',
          'com.coinbase.wallet': '🔷',
          'me.rainbow': '🌈',
          'com.okex.wallet': '⬛',
        }
        eip6963.push({
          name: info.name,
          emoji: emojis[info.rdns] ?? '🔗',
          color: colors[info.rdns] ?? '#555',
          icon: info.icon,        // use EIP-6963 self-reported logo (data URI)
          rdns: info.rdns,
          provider,
        })
        setInjectedWallets(sortWalletsByPriority(eip6963))
      }
      window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener)
      window.dispatchEvent(new Event('eip6963:requestProvider'))
      // Fallback: if no EIP-6963 providers announce, check window.ethereum directly
      setTimeout(() => {
        if (eip6963.length === 0) setInjectedWallets(sortWalletsByPriority(detectInjectedWallets()))
      }, 100)
      return () => window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener)
    }
  }, [])
  const [agentDone, setAgentDone]               = useState(false)

  // Desktop wallet detection
  const [injectedWallets, setInjectedWallets] = useState<InjectedWallet[]>([])
  const [isDesktop, setIsDesktop] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [extensionProvider, setExtensionProvider] = useState<any>(null)

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
  const [endpointMode, setEndpointMode]         = useState<'subdomain' | 'custom'>('subdomain')
  const [subdomainName, setSubdomainName]       = useState('')

  function resetWc() { setWcUri(''); setWaiting(false) }

  // ── WC session helper ──────────────────────────────────────────────────────

  async function connectWC(methods: string[]): Promise<WCHandle> {
    const { SignClient } = await import('@walletconnect/sign-client')
    const client = await SignClient.init({
      projectId: WC_PROJECT_ID,
      metadata: {
        name: 'ARC-402 Onboarding',
        description: 'ARC-402 onboarding for governed agent hiring',
        url: 'https://app.arc402.xyz',
        icons: ['https://arc402.xyz/favicon.svg'],
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

    // Switch MetaMask to Base
    const hexChainId = '0x' + CHAIN_ID.toString(16)
    try {
      await client.request({ topic: s.topic, chainId: `eip155:1`, request: {
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hexChainId, chainName: 'Base', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }],
      }}).catch(() => {})
    } catch {}
    for (let i = 0; i < 3; i++) {
      try {
        await client.request({ topic: s.topic, chainId: `eip155:${CHAIN_ID}`, request: {
          method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }],
        }})
        break
      } catch { await new Promise(r => setTimeout(r, 1000)) }
    }

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

  // ── Desktop extension connect + deploy ─────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function doDeployWithExtension(extProvider: any) {
    setError(''); setLoading(true); setStatusMsg('Connecting wallet...')
    try {
      const accounts: string[] = await extProvider.request({ method: 'eth_requestAccounts' })
      const addr = accounts[0]
      try {
        await extProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] })
      } catch (e: unknown) {
        if ((e as { code?: number }).code === 4902) {
          await extProvider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }] })
        }
      }
      setExtensionProvider(extProvider)
      setAccount(addr)

      setStatusMsg('Checking for existing ARC-402 wallets...')
      const wallets = await getARC402Wallets(addr)
      setExistingWallets(wallets)

      if (wallets.length > 0) {
        const w = wallets[0]
        setArc402Wallet(w)
        try {
          const rpc = new ethers.JsonRpcProvider(BASE_RPC)
          const walletC = new ethers.Contract(w, ['function ownerAuth() view returns (uint8, bytes32, bytes32)'], rpc)
          const [signerType] = await walletC.ownerAuth().catch(() => [0n])
          const reg = new ethers.Contract(AGENT_REGISTRY, ['function isRegistered(address) view returns (bool)'], rpc)
          const registered = await reg.isRegistered(w).catch(() => false)
          if (registered) { setAgentDone(true); setPasskeyActivated(Number(signerType) === 1); setPolicyDone(true); setStep('done') }
          else if (Number(signerType) === 1) { setPasskeyActivated(true); setPolicyDone(true); setStep('agent') }
          else { setStep('passkey') }
        } catch { setStep('passkey') }
        return
      }

      setStatusMsg('Deploying ARC-402 wallet...')
      const factoryIface = new ethers.Interface(['function createWallet(address _entryPoint) external returns (address)'])
      const data = factoryIface.encodeFunctionData('createWallet', [ENTRY_POINT])
      const ep = new ethers.BrowserProvider(extProvider)
      const signer = await ep.getSigner()
      const tx = await signer.sendTransaction({ to: WALLET_FACTORY, data, value: 0n })

      setStatusMsg('Waiting for confirmation...')
      const receipt = await tx.wait(1)
      if (!receipt || receipt.status !== 1) throw new Error('Transaction failed. Check Basescan.')

      const factoryEventIface = new ethers.Interface(['event WalletCreated(address indexed owner, address indexed walletAddress)'])
      let walletAddress = ''
      for (const log of receipt.logs) {
        try {
          const parsed = factoryEventIface.parseLog(log)
          if (parsed?.name === 'WalletCreated') { walletAddress = parsed.args.walletAddress as string; break }
        } catch { continue }
      }
      if (!walletAddress) throw new Error('Could not find deployed wallet address.')

      setArc402Wallet(walletAddress)
      setStep('passkey')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('rejected') || msg.includes('cancel') ? 'Cancelled. Try again.' : msg)
    } finally { setLoading(false); setStatusMsg('') }
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
        const w = wallets[0]
        setArc402Wallet(w)
        await disconnectWC(wc)

        // Detect on-chain state to skip completed steps
        try {
          const rpc = new ethers.JsonRpcProvider(BASE_RPC)
          const walletC = new ethers.Contract(w, [
            'function ownerAuth() view returns (uint8, bytes32, bytes32)',
          ], rpc)
          const [signerType] = await walletC.ownerAuth().catch(() => [0n])
          const reg = new ethers.Contract(AGENT_REGISTRY, [
            'function isRegistered(address) view returns (bool)',
          ], rpc)
          const registered = await reg.isRegistered(w).catch(() => false)

          if (registered) {
            setAgentDone(true)
            setPasskeyActivated(Number(signerType) === 1)
            setPolicyDone(true)
            setStep('done')
          } else if (Number(signerType) === 1) {
            setPasskeyActivated(true)
            setPolicyDone(true)
            setStep('agent')
          } else {
            setStep('passkey')
          }
        } catch {
          setStep('passkey')
        }
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
      const iface = new ethers.Interface(['function setPasskey(bytes32 pubKeyX, bytes32 pubKeyY) external'])
      const data = iface.encodeFunctionData('setPasskey', [passkeyResult.x, passkeyResult.y])
      if (extensionProvider) {
        setStatusMsg('Sending setPasskey transaction...')
        const ep = new ethers.BrowserProvider(extensionProvider)
        const signer = await ep.getSigner()
        await signer.sendTransaction({ to: arc402Wallet, data, value: 0n })
      } else {
        const wc = await connectWC(['eth_sendTransaction'])
        setStatusMsg('Sending setPasskey transaction...')
        await sendWCTx(wc, arc402Wallet, data)
        await disconnectWC(wc)
      }
      setPasskeyActivated(true)
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
      const ownerIface = new ethers.Interface([
        'function setVelocityLimit(uint256 limit) external',
        'function setGuardian(address _guardian) external',
      ])
      const policyIface = new ethers.Interface([
        'function setCategoryLimitFor(address wallet, string category, uint256 limitPerTx) external',
      ])
      const peIface = new ethers.Interface([
        'function whitelistContract(address wallet, address target) external',
      ])

      // Check velocity limit before setting (avoid revert if already set)
      const rpcCheck = new ethers.JsonRpcProvider(BASE_RPC)
      const walletCheck = new ethers.Contract(arc402Wallet, ['function velocityLimit() view returns (uint256)'], rpcCheck)
      const currentVelocity = await walletCheck.velocityLimit().catch(() => 0n)
      const limitWei = ethers.parseEther(velocityLimit || '0.05')

      let currentGuardian = ethers.ZeroAddress
      if (guardianAddr) {
        const guardianCheck = new ethers.Contract(arc402Wallet, ['function guardian() view returns (address)'], rpcCheck)
        currentGuardian = await guardianCheck.guardian().catch(() => ethers.ZeroAddress)
      }

      const hirePriceWei = maxHirePrice ? ethers.parseEther(maxHirePrice || '0.1') : null

      if (extensionProvider) {
        const ep = new ethers.BrowserProvider(extensionProvider)
        const signer = await ep.getSigner()
        if (currentVelocity === 0n) {
          setStatusMsg('Setting velocity limit...')
          await signer.sendTransaction({ to: arc402Wallet, data: ownerIface.encodeFunctionData('setVelocityLimit', [limitWei]), value: 0n })
        }
        if (guardianAddr && currentGuardian === ethers.ZeroAddress) {
          setStatusMsg('Setting guardian...')
          await signer.sendTransaction({ to: arc402Wallet, data: ownerIface.encodeFunctionData('setGuardian', [guardianAddr]), value: 0n })
        }
        if (hirePriceWei) {
          setStatusMsg('Setting max hire price...')
          await signer.sendTransaction({ to: POLICY_ENGINE, data: policyIface.encodeFunctionData('setCategoryLimitFor', [arc402Wallet, 'hire', hirePriceWei]), value: 0n })
        }
        // Set all standard category limits (skip if already non-zero)
        const peReadCats = new ethers.Contract(POLICY_ENGINE, ['function categoryLimits(address,string) view returns (uint256)'], new ethers.JsonRpcProvider(BASE_RPC))
        for (const cat of ONBOARDING_CATEGORIES) {
          const existing = await peReadCats.categoryLimits(arc402Wallet, cat.name).catch(() => 0n)
          if (existing === 0n) {
            setStatusMsg(`Setting ${cat.name} category limit...`)
            await signer.sendTransaction({ to: POLICY_ENGINE, data: policyIface.encodeFunctionData('setCategoryLimitFor', [arc402Wallet, cat.name, ethers.parseEther(cat.eth)]), value: 0n })
          }
        }
        // Whitelist all protocol contracts
        for (const pc of PROTOCOL_CONTRACTS_TO_WHITELIST) {
          const alreadyWhitelisted = await new ethers.Contract(POLICY_ENGINE, ['function isContractWhitelisted(address,address) view returns (bool)'], new ethers.JsonRpcProvider(BASE_RPC)).isContractWhitelisted(arc402Wallet, pc.address).catch(() => false)
          if (!alreadyWhitelisted) {
            setStatusMsg(`Whitelisting ${pc.name}...`)
            await signer.sendTransaction({ to: POLICY_ENGINE, data: peIface.encodeFunctionData('whitelistContract', [arc402Wallet, pc.address]), value: 0n })
          }
        }
      } else {
        const wc = await connectWC(['eth_sendTransaction'])
        if (currentVelocity === 0n) {
          setStatusMsg('Setting velocity limit...')
          await sendWCTx(wc, arc402Wallet, ownerIface.encodeFunctionData('setVelocityLimit', [limitWei]))
        }
        if (guardianAddr && currentGuardian === ethers.ZeroAddress) {
          setStatusMsg('Setting guardian...')
          await sendWCTx(wc, arc402Wallet, ownerIface.encodeFunctionData('setGuardian', [guardianAddr]))
        }
        if (hirePriceWei) {
          setStatusMsg('Setting max hire price...')
          await sendWCTx(wc, POLICY_ENGINE, policyIface.encodeFunctionData('setCategoryLimitFor', [arc402Wallet, 'hire', hirePriceWei]))
        }
        // Set all standard category limits (skip if already non-zero)
        const peReadCatsWC = new ethers.Contract(POLICY_ENGINE, ['function categoryLimits(address,string) view returns (uint256)'], new ethers.JsonRpcProvider(BASE_RPC))
        for (const cat of ONBOARDING_CATEGORIES) {
          const existing = await peReadCatsWC.categoryLimits(arc402Wallet, cat.name).catch(() => 0n)
          if (existing === 0n) {
            setStatusMsg(`Setting ${cat.name} category limit...`)
            await sendWCTx(wc, POLICY_ENGINE, policyIface.encodeFunctionData('setCategoryLimitFor', [arc402Wallet, cat.name, ethers.parseEther(cat.eth)]))
          }
        }
        // Whitelist all protocol contracts
        for (const pc of PROTOCOL_CONTRACTS_TO_WHITELIST) {
          const alreadyWhitelisted = await new ethers.Contract(POLICY_ENGINE, ['function isContractWhitelisted(address,address) view returns (bool)'], new ethers.JsonRpcProvider(BASE_RPC)).isContractWhitelisted(arc402Wallet, pc.address).catch(() => false)
          if (!alreadyWhitelisted) {
            setStatusMsg(`Whitelisting ${pc.name}...`)
            await sendWCTx(wc, POLICY_ENGINE, peIface.encodeFunctionData('whitelistContract', [arc402Wallet, pc.address]))
          }
        }
        await disconnectWC(wc)
      }

      setPolicyDone(true)
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

      // Enable DeFi access + whitelist AgentRegistry on PolicyEngine (owner-only calls)
      const peIface = new ethers.Interface([
        'function enableDefiAccess(address wallet) external',
        'function whitelistContract(address wallet, address target) external',
        'function defiAccessEnabled(address) external view returns (bool)',
        'function isContractWhitelisted(address wallet, address target) external view returns (bool)',
      ])
      const PE = POLICY_ENGINE

      // Check and enable DeFi access
      const rpcProvider = new ethers.JsonRpcProvider(BASE_RPC)
      const pe = new ethers.Contract(PE, peIface, rpcProvider)
      const defiEnabled = await pe.defiAccessEnabled(arc402Wallet).catch(() => false)
      const whitelisted = await pe.isContractWhitelisted(arc402Wallet, AGENT_REGISTRY).catch(() => false)

      if (extensionProvider) {
        const ep = new ethers.BrowserProvider(extensionProvider)
        const signer = await ep.getSigner()
        if (!defiEnabled) {
          setStatusMsg('Enabling DeFi access...')
          await signer.sendTransaction({ to: PE, data: peIface.encodeFunctionData('enableDefiAccess', [arc402Wallet]), value: 0n })
        }
        if (!whitelisted) {
          setStatusMsg('Whitelisting AgentRegistry...')
          await signer.sendTransaction({ to: PE, data: peIface.encodeFunctionData('whitelistContract', [arc402Wallet, AGENT_REGISTRY]), value: 0n })
        }
        setStatusMsg('Registering agent...')
        await signer.sendTransaction({ to: arc402Wallet, data: execData, value: 0n })
      } else {
        const wc = await connectWC(['eth_sendTransaction'])
        if (!defiEnabled) {
          setStatusMsg('Enabling DeFi access...')
          await sendWCTx(wc, PE, peIface.encodeFunctionData('enableDefiAccess', [arc402Wallet]))
        }
        if (!whitelisted) {
          setStatusMsg('Whitelisting AgentRegistry...')
          await sendWCTx(wc, PE, peIface.encodeFunctionData('whitelistContract', [arc402Wallet, AGENT_REGISTRY]))
        }
        setStatusMsg('Registering agent...')
        await sendWCTx(wc, arc402Wallet, execData)
        await disconnectWC(wc)
      }

      setAgentDone(true)
      setStep('handshake')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('rejected') || msg.includes('cancel') ? 'Cancelled. Tap to try again.' : msg)
      resetWc()
    } finally { setLoading(false); setStatusMsg('') }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const STEP_DEFS = [
    { id: 'deploy',    label: 'Deploy',    icon: '🏗️' },
    { id: 'passkey',   label: 'Face ID',   icon: '🔑' },
    { id: 'policy',    label: 'Policy',    icon: '📋' },
    { id: 'agent',     label: 'Agent',     icon: '🤖' },
    { id: 'handshake', label: 'Shake',     icon: '🤝' },
  ] as const

  const stepOrder: Step[] = ['deploy', 'passkey', 'policy', 'agent', 'handshake', 'done']
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
            Deploy your wallet, register Face ID, and prepare the machine-side governed workroom in minutes.
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
                <div key={s.id} onClick={() => setStep(s.id as Step)} style={{
                  flex: 1, padding: '5px 4px', borderRadius: 8, textAlign: 'center', cursor: 'pointer',
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

          {/* WC wallet deep links — mobile only */}
          {wcUri && isMobile() && (
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

          {/* WC QR code — desktop only */}
          {wcUri && !isMobile() && (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <p style={{ color: '#555', fontSize: '0.78rem', marginBottom: 12 }}>
                Scan with your phone wallet:
              </p>
              <div style={{ display: 'inline-block', padding: 12, background: '#fff', borderRadius: 12 }}>
                <QRCodeSVG value={decodeURIComponent(wcUri)} size={200} />
              </div>
              <p style={{ color: '#444', fontSize: '0.72rem', marginTop: 10, lineHeight: 1.5 }}>
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
                Deploy an ARC-402 wallet contract on Base Mainnet. Your connected address becomes the owner, and this launch flow assumes normal Base gas from that owner wallet.
              </p>
              <p style={{ color: '#444', fontSize: '0.75rem', marginBottom: 16, lineHeight: 1.5 }}>
                If you already have one, it will be detected automatically.
              </p>
              {loading ? (
                <div style={{ textAlign: 'center', color: '#555', padding: '20px 0', fontSize: '0.85rem' }}>
                  ⏳ {statusMsg || 'Working...'}
                </div>
              ) : isDesktop ? (
                <div>
                  {injectedWallets.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ color: '#555', fontSize: '0.73rem', marginBottom: 8 }}>Detected extensions:</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                        {injectedWallets.map(w => (
                          <button
                            key={w.rdns ?? w.name}
                            onClick={() => doDeployWithExtension(w.provider)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                              padding: '11px 16px', borderRadius: 12, cursor: 'pointer',
                              background: '#0d0d0d', border: `1px solid ${w.color}33`,
                              textAlign: 'left',
                            }}
                          >
                            {w.icon
                              ? <img src={w.icon} alt="" style={{ width: 20, height: 20, borderRadius: 4, flexShrink: 0 }} />
                              : <span style={{ fontSize: 20, flexShrink: 0 }}>{w.emoji}</span>
                            }
                            <span style={{ color: '#d0d0d0', fontSize: '0.9rem', fontWeight: 500 }}>{w.name}</span>
                            <span style={{ marginLeft: 'auto', color: w.color, fontSize: '0.75rem', fontWeight: 600 }}>Connect →</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' }}>
                    <div style={{ flex: 1, height: 1, background: '#1e1e1e' }} />
                    <span style={{ color: '#333', fontSize: '0.72rem' }}>or scan with phone</span>
                    <div style={{ flex: 1, height: 1, background: '#1e1e1e' }} />
                  </div>
                  <button onClick={doDeploy} style={{ width: '100%', padding: '11px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 12, color: '#555', fontSize: '0.85rem', cursor: 'pointer' }}>
                    Use WalletConnect QR →
                  </button>
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
                Set spending limits and an emergency guardian. These protect your wallet if hired work in the governed workroom misbehaves.
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
              <p style={{ color: '#666', fontSize: '0.82rem', marginBottom: 12, lineHeight: 1.5 }}>
                Register your wallet as an agent in the ARC-402 registry so other agents can hire you. This records your public endpoint identity; it does not by itself expand sandbox outbound permissions.
              </p>
              {/* Endpoint choice: subdomain vs custom */}
              <div style={{ background: '#0d0d12', border: '1px solid #1e1e2a', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                <div style={{ fontSize: '0.72rem', color: '#818cf8', marginBottom: 10 }}>Choose your public endpoint</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button
                    onClick={() => { setEndpointMode('subdomain'); setAgentEndpoint('') }}
                    style={{ flex: 1, padding: '10px 8px', background: endpointMode === 'subdomain' ? '#1a1a3a' : '#0a0a0a', border: `1px solid ${endpointMode === 'subdomain' ? '#4338ca' : '#1e1e1e'}`, borderRadius: 10, color: endpointMode === 'subdomain' ? '#818cf8' : '#555', fontSize: '0.78rem', cursor: 'pointer', textAlign: 'center' }}
                  >
                    🌐 Claim <span style={{ fontFamily: 'monospace' }}>youragent.arc402.xyz</span>
                  </button>
                  <button
                    onClick={() => { setEndpointMode('custom'); setSubdomainName('') }}
                    style={{ flex: 1, padding: '10px 8px', background: endpointMode === 'custom' ? '#1a1a3a' : '#0a0a0a', border: `1px solid ${endpointMode === 'custom' ? '#4338ca' : '#1e1e1e'}`, borderRadius: 10, color: endpointMode === 'custom' ? '#818cf8' : '#555', fontSize: '0.78rem', cursor: 'pointer', textAlign: 'center' }}
                  >
                    🔗 Use your own URL
                  </button>
                </div>

                {endpointMode === 'subdomain' && (
                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#555', display: 'block', marginBottom: 5 }}>Subdomain name</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                      <input
                        type="text"
                        value={subdomainName}
                        onChange={e => {
                          const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                          setSubdomainName(v)
                          setAgentEndpoint(v ? `https://${v}.arc402.xyz` : '')
                        }}
                        placeholder="myagent"
                        style={{ flex: 1, padding: '10px 12px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '10px 0 0 10px', color: '#d0d0d0', fontSize: '0.82rem', boxSizing: 'border-box' }}
                      />
                      <span style={{ padding: '10px 12px', background: '#111', border: '1px solid #1e1e1e', borderLeft: 'none', borderRadius: '0 10px 10px 0', color: '#818cf8', fontSize: '0.82rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>.arc402.xyz</span>
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#444', marginTop: 6 }}>
                      First-come-first-served. Your wallet must be registered in AgentRegistry to claim.
                    </div>
                  </div>
                )}

                {endpointMode === 'custom' && (
                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#555', display: 'block', marginBottom: 5 }}>Your HTTPS endpoint URL</label>
                    <input
                      type="text"
                      value={agentEndpoint}
                      onChange={e => setAgentEndpoint(e.target.value)}
                      placeholder="https://agent.yourdomain.com"
                      style={{ width: '100%', padding: '10px 12px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 10, color: '#d0d0d0', fontSize: '0.82rem', boxSizing: 'border-box' }}
                    />
                    <div style={{ fontSize: '0.68rem', color: '#444', marginTop: 6 }}>
                      Bring your own domain and public ingress. ARC-402 will register this URL in AgentRegistry.
                    </div>
                  </div>
                )}
              </div>

              {[
                { label: 'Agent name',            value: agentName,        setter: setAgentName,        placeholder: 'My Research Agent' },
                { label: 'Capabilities (comma-separated)', value: agentCaps, setter: setAgentCaps,      placeholder: 'research, summarization' },
                { label: 'Service type',          value: agentServiceType, setter: setAgentServiceType, placeholder: 'research' },
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

          {/* ── STEP 5: HANDSHAKE ── */}
          {step === 'handshake' && !wcUri && !waiting && (
            <div>
              <div style={{ textAlign: 'center', fontSize: 40, marginBottom: 12 }}>🤝</div>
              <div style={{ color: '#d0d0d0', fontWeight: 600, fontSize: '1rem', textAlign: 'center', marginBottom: 8 }}>
                Your first Handshake
              </div>
              <p style={{ color: '#666', fontSize: '0.82rem', marginBottom: 20, lineHeight: 1.5 }}>
                Every connection on ARC-402 starts with a handshake. Send one to the agent who referred you, or say hello to anyone on the network. It&apos;s recorded on Base mainnet.
              </p>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: '0.72rem', color: '#555', display: 'block', marginBottom: 5 }}>Recipient address</label>
                <input
                  type="text"
                  id="hs-recipient"
                  placeholder="0x... (any ARC-402 agent wallet)"
                  style={{ width: '100%', padding: '10px 12px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 10, color: '#d0d0d0', fontSize: '0.82rem', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: '0.72rem', color: '#555', display: 'block', marginBottom: 5 }}>Type</label>
                <select
                  id="hs-type"
                  defaultValue="7"
                  style={{ width: '100%', padding: '10px 12px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 10, color: '#d0d0d0', fontSize: '0.82rem', boxSizing: 'border-box' }}
                >
                  <option value="7">👋 Hello</option>
                  <option value="0">🤝 Respect</option>
                  <option value="1">🔍 Curiosity</option>
                  <option value="2">⭐ Endorsement</option>
                  <option value="3">🙏 Thanks</option>
                  <option value="4">🤝 Collaboration</option>
                  <option value="5">⚡ Challenge</option>
                  <option value="6">📣 Referral</option>
                </select>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: '0.72rem', color: '#555', display: 'block', marginBottom: 5 }}>Note (optional)</label>
                <input
                  type="text"
                  id="hs-note"
                  placeholder="First handshake on ARC-402!"
                  maxLength={140}
                  style={{ width: '100%', padding: '10px 12px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 10, color: '#d0d0d0', fontSize: '0.82rem', boxSizing: 'border-box' }}
                />
              </div>

              <button
                onClick={async () => {
                  const recipient = (document.getElementById('hs-recipient') as HTMLInputElement)?.value?.trim()
                  const hsType = parseInt((document.getElementById('hs-type') as HTMLSelectElement)?.value || '7')
                  const note = (document.getElementById('hs-note') as HTMLInputElement)?.value?.trim() || ''

                  if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
                    setError('Enter a valid recipient address')
                    return
                  }

                  setError(''); setLoading(true); setStatusMsg('Connecting wallet...')
                  try {
                    const hsIface = new ethers.Interface([
                      'function sendHandshake(address to, uint8 hsType, string note) external payable',
                    ])
                    const execIface = new ethers.Interface([
                      'function executeContractCall((address target, bytes data, uint256 value, uint256 minReturnValue, uint256 maxApprovalAmount, address approvalToken) params) external',
                    ])
                    const shakeData = hsIface.encodeFunctionData('sendHandshake', [recipient, hsType, note])
                    const execData = execIface.encodeFunctionData('executeContractCall', [{
                      target: HANDSHAKE,
                      data: shakeData,
                      value: 0n,
                      minReturnValue: 0n,
                      maxApprovalAmount: 0n,
                      approvalToken: ethers.ZeroAddress,
                    }])
                    setStatusMsg('Sending Handshake...')
                    if (extensionProvider) {
                      const ep = new ethers.BrowserProvider(extensionProvider)
                      const signer = await ep.getSigner()
                      await signer.sendTransaction({ to: arc402Wallet, data: execData, value: 0n })
                    } else {
                      const wc = await connectWC(['eth_sendTransaction'])
                      await sendWCTx(wc, arc402Wallet, execData)
                      await disconnectWC(wc)
                    }
                    setStep('done')
                  } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e)
                    setError(msg.includes('rejected') || msg.includes('cancel') ? 'Cancelled. Tap to try again.' : msg)
                    resetWc()
                  } finally { setLoading(false); setStatusMsg('') }
                }}
                disabled={loading}
                style={{ width: '100%', padding: '13px', background: loading ? '#1a1a1a' : '#1a1a2e', border: `1px solid ${loading ? '#1a1a1a' : '#2a2a4a'}`, borderRadius: 12, color: loading ? '#333' : '#818cf8', fontSize: '0.9rem', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 10 }}
              >
                {loading ? '⏳ ' + (statusMsg || 'Working...') : '🤝 Send Handshake →'}
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
                  • Keep some Base ETH on the owner wallet for deploy, policy, and agent transactions<br />
                  • Create the ARC-402 governed workroom on your machine: <span style={{ fontFamily: 'monospace', color: '#818cf8', fontSize: '0.72rem' }}>arc402 openshell init</span><br />
                  • Start the OpenShell-owned ARC-402 runtime for hired work: <span style={{ fontFamily: 'monospace', color: '#818cf8', fontSize: '0.72rem' }}>arc402 daemon start</span><br />
                  • Sign governance ops:{' '}
                  {passkeyResult ? (
                    <a
                      href={`https://app.arc402.xyz/passkey-sign?wallet=${arc402Wallet}&credId=${passkeyResult.credId}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontFamily: 'monospace', color: '#4ade80', fontSize: '0.72rem', wordBreak: 'break-all' }}
                    >
                      {`app.arc402.xyz/passkey-sign?wallet=${arc402Wallet}&credId=${passkeyResult.credId}`}
                    </a>
                  ) : (
                    <span style={{ fontFamily: 'monospace', color: '#818cf8', fontSize: '0.72rem' }}>app.arc402.xyz/passkey-sign</span>
                  )}
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
