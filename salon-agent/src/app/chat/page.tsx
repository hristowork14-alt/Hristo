'use client';
// /chat?salon=slug — full-page chat (handy for testing, or to link from Instagram/Google).
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import ChatBox from '@/components/ChatBox';

function FullChat() {
  const salon = useSearchParams().get('salon') || 'demo-barber';
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', height: '100dvh', borderInline: '1px solid var(--line)' }}>
      <ChatBox salon={salon} />
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <FullChat />
    </Suspense>
  );
}
