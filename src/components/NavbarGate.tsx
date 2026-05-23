'use client';

import { usePathname } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

export default function NavbarGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep the first client render aligned with the streamed SSR shell.
  if (!mounted) return null;

  // Hide the navbar on unauthenticated login/register pages.
  if (pathname === '/login' || pathname === '/register') {
    const auth = getAuthInfoFromBrowserCookie();
    if (!auth) return null;
  }

  return <>{children}</>;
}
