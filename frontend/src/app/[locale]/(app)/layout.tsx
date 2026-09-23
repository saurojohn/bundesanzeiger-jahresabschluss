import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/layout/AppHeader';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // TODO Sprint 1.4: Server-Side Session-Check
  // Aktuell Client-Side check (siehe AuthGuard). Hier vorerst keine Redirect.
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}