'use client';

import { usePathname } from 'next/navigation';
import React, { useEffect, useState } from 'react';

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

  // Always hide the navbar on the login/register screens. These are
  // standalone auth pages; the login page redirects away once a valid
  // session exists, so keying navbar visibility on a readable auth cookie
  // only surfaced a "logged in" navbar on the login page when a stale
  // cookie lingered after an upgrade.
  if (pathname === '/login' || pathname === '/register') {
    return null;
  }

  return <>{children}</>;
}
