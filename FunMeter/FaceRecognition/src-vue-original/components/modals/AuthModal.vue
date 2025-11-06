<script setup lang="ts">
import { inject, ref } from "vue";
import { useI18n } from "@/i18n";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const auth = inject<any>("auth", null);
const { t } = useI18n();

// state
const tab = ref<"login" | "register">("login");

const login = ref({ username: "", password: "" });
const reg = ref({ username: "", password: "", confirmPassword: "" });

const loading = ref(false);
const errorMsg = ref("");

function close() {
  auth?.closeModal?.();
  errorMsg.value = "";
  tab.value = "login";
  login.value = { username: "", password: "" };
  reg.value = { username: "", password: "", confirmPassword: "" };
}

async function onLogin(e?: Event) {
  e?.preventDefault();
  errorMsg.value = "";
  loading.value = true;
  try {
    if (!login.value.username || !login.value.password) {
      throw new Error(t("auth.error.fillFields", "Isi username dan password."));
    }
    // sinkronkan ke store auth yang kamu provide di AppShell
    if (auth?.loginForm) {
      auth.loginForm.username = login.value.username;
      auth.loginForm.password = login.value.password;
    }
    await auth?.login?.(); // submitLogin() di AppShell akan close modal sendiri saat sukses
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || err?.message || "Gagal login";
  } finally {
    loading.value = false;
  }
}

async function onRegister(e?: Event) {
  e?.preventDefault();
  errorMsg.value = "";
  loading.value = true;
  try {
    if (!reg.value.username || !reg.value.password || !reg.value.confirmPassword) {
      throw new Error(t("auth.error.fillFields", "Isi username dan password."));
    }
    if (reg.value.password.length < 6) {
      throw new Error(t("auth.error.registerShortPassword", "Password minimal 6 karakter."));
    }
    if (reg.value.password !== reg.value.confirmPassword) {
      throw new Error(t("auth.error.registerMismatch", "Konfirmasi password tidak cocok."));
    }
    if (auth?.registerForm) {
      auth.registerForm.username = reg.value.username;
      auth.registerForm.password = reg.value.password;
      auth.registerForm.confirmPassword = reg.value.confirmPassword;
    }
    await auth?.register?.();
    tab.value = "login";
    login.value.username = reg.value.username;
    reg.value = { username: "", password: "", confirmPassword: "" };
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || err?.message || "Gagal mendaftar";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <Dialog
    :open="Boolean(auth?.showModal?.value)"
    @update:open="
      (v) => {
        if (!v) close();
      }
    ">
    <!-- Authentication02 vibe: panel kiri brand, kanan form -->
    <DialogContent class="max-w-2xl overflow-hidden p-0">
      <div class="grid md:grid-cols-2">
        <!-- LEFT: Brand / welcome -->
        <div class="hidden md:flex flex-col justify-between bg-muted/60 p-6">
          <div class="flex items-center gap-2">
            <Avatar class="place-items-center rounded-lg">
              <AvatarFallback class="ti ti-mood-check bg-primary text-primary-foreground text-xl" />
            </Avatar>
            <div class="font-semibold">{{ t("aside.brand.title", "Absensi Wajah") }}</div>
          </div>
          <div class="space-y-2">
            <h3 class="text-xl font-semibold">{{ t("auth.welcome", "Selamat datang kembali") }}</h3>
            <p class="text-sm text-muted-foreground">
              {{ t("auth.subtitle", "Masuk untuk akses dashboard dan fun meter kamu.") }}
            </p>
          </div>
          <p class="text-[11px] text-muted-foreground/80">
            {{ t("auth.footer", "Dengan masuk, kamu setuju pada Ketentuan & Kebijakan Privasi.") }}
          </p>
        </div>

        <!-- RIGHT: Forms -->
        <div class="p-6">
          <DialogHeader class="mb-3">
            <DialogTitle class="text-lg">{{ t("auth.title", "Akun") }}</DialogTitle>
            <DialogDescription class="text-xs">
              {{ t("auth.description", "Masuk atau daftar akun baru.") }}
            </DialogDescription>
          </DialogHeader>

          <Tabs v-model="tab" class="w-full">
            <TabsList class="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="login">{{ t("auth.login", "Masuk") }}</TabsTrigger>
              <TabsTrigger value="register">{{ t("auth.register", "Daftar") }}</TabsTrigger>
            </TabsList>

            <!-- LOGIN -->
            <TabsContent value="login">
              <form class="space-y-4" @submit="onLogin">
                <div class="space-y-1.5">
                  <Label for="loginUser">{{ t("auth.fields.username", "Nama Pengguna") }}</Label>
                  <Input id="loginUser" type="text" v-model="login.username" autocomplete="username" />
                </div>
                <div class="space-y-1.5">
                  <Label for="loginPass">{{ t("auth.fields.password", "Kata Sandi") }}</Label>
                  <Input id="loginPass" type="password" v-model="login.password" autocomplete="current-password" />
                </div>

                <Button type="submit" class="w-full" :disabled="loading">
                  {{ loading ? t("auth.loading", "Memproses...") : t("auth.signin", "Masuk") }}
                </Button>
              </form>
            </TabsContent>

            <!-- REGISTER -->
            <TabsContent value="register">
              <form class="space-y-4" @submit="onRegister">
                <div class="space-y-1.5">
                  <Label for="regUser">{{ t("auth.fields.username", "Nama Pengguna") }}</Label>
                  <Input id="regUser" type="text" v-model="reg.username" autocomplete="username" />
                </div>
                <div class="space-y-1.5">
                  <Label for="regPass">{{ t("auth.fields.password", "Kata Sandi") }}</Label>
                  <Input id="regPass" type="password" v-model="reg.password" autocomplete="new-password" />
                </div>
                <div class="space-y-1.5">
                  <Label for="regConfirm">{{ t("auth.confirmPassword", "Konfirmasi Kata Sandi") }}</Label>
                  <Input id="regConfirm" type="password" v-model="reg.confirmPassword" autocomplete="new-password" />
                </div>
                <Button type="submit" class="w-full" :disabled="loading">
                  {{ loading ? t("auth.loading", "Memproses...") : t("auth.signup", "Daftar") }}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <DialogFooter class="mt-4">
            <p v-if="errorMsg" class="w-full rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              {{ errorMsg }}
            </p>
          </DialogFooter>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
