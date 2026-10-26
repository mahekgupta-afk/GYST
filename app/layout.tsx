import type { Metadata, Viewport } from 'next';
import { Gasoek_One, Geist } from 'next/font/google';
import './globals.css';
import { themeInitScript } from '@/lib/theme';

// Gasoek One is the chunky display face (headlines, big numerals, the stamp). Geist is for everything else.
const display = Gasoek_One({ subsets: ['latin'], variable: '--font-display', weight: '400' });
const body = Geist({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Get Your Ship Together: UK to EU shipment booking and error checker',
  description: 'Book a UK to EU shipment by chat or by uploading your sheets. Every booking is checked against the rulebook before it leaves.',
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: '#b09cfb',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
