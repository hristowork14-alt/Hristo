import './globals.css';

export const metadata = { title: 'SalonAgent', description: 'AI booking assistant for salons and barbers' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg">
      <body>{children}</body>
    </html>
  );
}
