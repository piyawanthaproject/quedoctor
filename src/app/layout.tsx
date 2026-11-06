import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'คิวหมอ · Khiu Mor',
  description: 'ระบบนัดหมายและคัดกรองผู้ป่วยนอก · Outpatient appointments and triage',
};

// every page reads the signed-in user's data, so nothing is prerendered
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai+Looped:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&display=swap" />
      </head>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
