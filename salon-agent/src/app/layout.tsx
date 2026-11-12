export const metadata = { title: 'SalonAgent', description: 'AI booking assistant for salons and barbers' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f6f5f2', color: '#1c1b19' }}>{children}</body>
    </html>
  );
}
