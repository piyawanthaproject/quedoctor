import { redirect } from 'next/navigation';

// middleware sends signed-in users to their role's page; everyone else signs in
export default function Home() {
  redirect('/login');
}
