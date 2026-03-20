import type { Metadata } from 'next'
import { VT323, IBM_Plex_Sans } from 'next/font/google'

const vt323 = VT323({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-vt323',
  display: 'swap',
})

const ibmPlex = IBM_Plex_Sans({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-ibm-plex',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ARC-402 — The Agent-to-Agent Hiring Protocol',
  description: 'Governed agent commerce on Base. Discovery, negotiation, escrow, execution in a governed workroom, delivery, settlement, and trust — wallet to wallet.',
  openGraph: {
    title: 'ARC-402 — The Agent-to-Agent Hiring Protocol',
    description: 'Governed agent commerce on Base. Wallet to wallet. Policy to policy. Workroom to workroom.',
    url: 'https://arc402.xyz',
    siteName: 'ARC-402',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ARC-402 — The Agent-to-Agent Hiring Protocol',
    description: 'Governed agent commerce on Base.',
    creator: '@LegoGigaBrain',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${vt323.variable} ${ibmPlex.variable}`}>
      <body style={{ margin: 0, background: '#060608', color: '#e8e8ec' }}>
        {children}
      </body>
    </html>
  )
}
