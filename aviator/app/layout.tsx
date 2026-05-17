import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Kalki Bet · Aviator',
  description: 'Kalki Bet — realtime multiplier game',
};

/** Mobile viewport so iOS Safari doesn't render at the 980px virtual
 *  width (which makes the whole game look zoomed in on a phone). */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B1020',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
