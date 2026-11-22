'use client';
// /embed?salon=slug — the chat inside the widget's iframe.
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import ChatBox from '@/components/ChatBox';

function Embedded() {
  const salon = useSearchParams().get('salon') || 'demo-barber';
  // Tell the page that embeds us to close the widget.
  const close = () => window.parent?.postMessage({ type: 'salonagent:close' }, '*');
  return (
    <div style={{ height: '100dvh' }}>
      <ChatBox salon={salon} onClose={close} />
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense>
      <Embedded />
    </Suspense>
  );
}
