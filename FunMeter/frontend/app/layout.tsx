import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { WsProvider } from "@/components/providers/WsProvider";
import { ConfirmDialogProvider } from "@/components/providers/ConfirmDialogProvider";
import { I18nProvider } from "@/components/providers/I18nProvider";
import { SettingsProvider } from "@/components/providers/SettingsProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { GlobalConfirm } from "@/components/modals/GlobalConfirm";
import { SettingsModal } from "@/components/modals/SettingsModal";
import { LoginModal } from "@/components/modals/LoginModal";
import { AppShell } from "@/components/layout/AppShell";

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
        <ThemeProvider>
          <I18nProvider initialLocale="id">
            <SettingsProvider>
              <AuthProvider>
                <WsProvider>
                  <ConfirmDialogProvider>
                    <AppShell>
                      {children}
                    </AppShell>
                    <LoginModal />
                    <GlobalConfirm />
                    <SettingsModal />
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
      </body>
    </html>
  );
}
