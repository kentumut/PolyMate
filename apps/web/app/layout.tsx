import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PolyMate — your study week',
  description: 'A little structure. More room to learn. Your ETH study companion.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
