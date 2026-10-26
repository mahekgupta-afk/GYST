import type { Metadata, Viewport } from 'next';
import { DM_Sans, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// DM Sans is the display face (headlines). Inter is for everything else. JetBrains Mono is for data: ids, numbers, the verdict.
const display = DM_Sans({ subsets: ['latin'], variable: '--font-display', weight: ['400', '600', '700'] });
const body = Inter({ subsets: ['latin'], variable: '--font-body' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', weight: ['400', '500'] });

export const metadata: Metadata = {
  title: 'Get Your Ship Together: UK to EU freight pre-flight checker',
  description: 'Catch paperwork errors before customs does. Ten compliance rules, carrier recommendation, and booking, by chat or file upload.',
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#080c14', colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
