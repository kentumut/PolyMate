import { notFound } from 'next/navigation';
import { PlanOverlayPreview } from '@/components/calendar/plan-overlay-preview';

export default function PlanOverlayPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <PlanOverlayPreview />;
}
