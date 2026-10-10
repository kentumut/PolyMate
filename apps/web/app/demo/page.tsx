import type { Metadata } from 'next';
import { DemoExperience } from '@/components/agent/demo-experience';

export const metadata: Metadata = {
  title: 'PolyMate demo — plan a study week',
  description: 'See how PolyMate turns Moodle deadlines into an approved calendar plan.',
};

export default function DemoPage() {
  return <DemoExperience />;
}
