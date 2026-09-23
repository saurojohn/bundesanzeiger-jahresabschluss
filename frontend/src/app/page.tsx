import { redirect } from 'next/navigation';

export default function RootPage() {
  // Single-locale setup: redirect to /de-DE/dashboard (or login if no session)
  redirect('/de-DE/login');
}