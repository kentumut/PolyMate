import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'PolyMate demo — plan a study week',
  description: 'See how PolyMate turns Moodle deadlines into an approved calendar plan.',
};

export default function DemoPage() {
  redirect('/calendar?demo=1&view=chat');
}
