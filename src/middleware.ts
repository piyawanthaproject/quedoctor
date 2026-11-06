import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const ROLE_HOME: Record<string, string> = { patient: '/patient', nurse: '/nurse', doctor: '/doctor', admin: '/admin' };
const PROTECTED = Object.values(ROLE_HOME);

/**
 * Keeps the Supabase session fresh and sends each user to the area of their role.
 * A patient who opens /nurse is redirected to /patient. The database enforces the same rules
 * with row level security, so this is navigation only, not the security boundary.
 */
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return res;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  const inProtected = PROTECTED.some((p) => path === p || path.startsWith(p + '/'));

  if (!user) {
    if (inProtected || path === '/') return NextResponse.redirect(new URL('/login', req.url));
    return res;
  }

  if (inProtected || path === '/' || path === '/login') {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    const home = ROLE_HOME[profile?.role ?? 'patient'];
    if (!path.startsWith(home)) return NextResponse.redirect(new URL(home, req.url));
  }
  return res;
}

export const config = { matcher: ['/', '/login', '/patient/:path*', '/nurse/:path*', '/doctor/:path*', '/admin/:path*'] };
