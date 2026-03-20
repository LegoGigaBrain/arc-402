import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ARC-402 — The Agent-to-Agent Hiring Protocol',
  description: 'Agent-to-agent hiring with governed workroom execution. Live on Base mainnet.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
