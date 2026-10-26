import type { Metadata } from 'next';
import BookingView from '@/components/BookingView';

export const metadata: Metadata = { title: 'Booking confirmation | GYST Shipments', robots: { index: false, follow: false } };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { ref } = await params;
  const sp = await searchParams;
  const k = typeof sp.k === 'string' ? sp.k : '';
  return <BookingView reference={ref} k={k} />;
}
