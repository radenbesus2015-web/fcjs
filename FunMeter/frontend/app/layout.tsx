import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/providers/ErrorBoundary";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { WsProvider } from "@/components/providers/WsProvider";
import { ConfirmDialogProvider } from "@/components/providers/ConfirmDialogProvider";
import { I18nProvider } from "@/components/providers/I18nProvider";
import { SettingsProvider } from "@/components/providers/SettingsProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { AppShell } from "@/components/layout/AppShell";
import { GlobalModals } from "@/components/layout/GlobalModals";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Face Recognition • YuNet + SFace",
  description: "Real-time attendance and emotion detection system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ErrorBoundary>
          <ThemeProvider>
            <I18nProvider>
              <SettingsProvider>
                <AuthProvider>
                  <WsProvider>
                    <ConfirmDialogProvider>
                      <AppShell>
                        {children}
                      </AppShell>
                      <GlobalModals />
                      <Toaster
                        position="bottom-right"
                        richColors
                        closeButton
                        expand
                        visibleToasts={2}
                      />
                    </ConfirmDialogProvider>
                  </WsProvider>
                </AuthProvider>
              </SettingsProvider>
            </I18nProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
