import { Suspense } from 'react';
import type { Metadata } from 'next';
import BookingView from '@/components/BookingView';

export const metadata: Metadata = { title: 'Booking confirmation | GYST Shipments', robots: { index: false, follow: false } };

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

// The reference and the secret key are read per request, so they are read inside Suspense: the page shell is prepared ahead of time.
async function Confirmation({ params, searchParams }: Props) {
  const { ref } = await params;
  const sp = await searchParams;
  return <BookingView reference={ref} k={typeof sp.k === 'string' ? sp.k : ''} />;
}

export default function BookingPage(props: Props) {
  return (
    <Suspense fallback={<main className="bookingpage"><p className="note" role="status">Loading your confirmation…</p></main>}>
      <Confirmation {...props} />
    </Suspense>
  );
}
