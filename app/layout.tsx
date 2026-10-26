import type { Metadata, Viewport } from 'next';
import { Cal_Sans, Inter } from 'next/font/google';
import './globals.css';
import { themeInitScript } from '@/lib/theme';

// Cal Sans is the display face (headlines, big numerals, the stamp). Inter is for everything else.
const display = Cal_Sans({ subsets: ['latin'], variable: '--font-display', weight: '400' });
const body = Inter({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Get Your Ship Together: UK to EU shipment booking and error checker',
  description: 'Book a UK to EU shipment by chat or by uploading your sheets. Every booking is checked against the rulebook before it leaves.',
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f4f4f4' }, { media: '(prefers-color-scheme: dark)', color: '#0e0e0f' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
