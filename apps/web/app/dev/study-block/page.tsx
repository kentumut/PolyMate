import { notFound } from 'next/navigation';
import { StudyBlockPreview } from '@/components/study/study-block-preview';

export default function StudyBlockPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <StudyBlockPreview />;
}
