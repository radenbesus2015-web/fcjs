<script setup>
import { computed, inject, onMounted, reactive, ref } from "vue";
import { apiFetch } from "@/utils/api";
import { toast } from "@/utils/toast";
import { useI18n } from "@/i18n";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

const auth = inject("auth", null);
const { t } = useI18n();
const confirmDialog = useConfirmDialog();

// shadcn-vue
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

const state = reactive({
  loading: true,
  error: "",
  users: [],
  currentUser: null,
});

const rotatingUser = ref("");
const jsonModal = reactive({ open: false, title: "", content: "" });
const passwordModal = reactive({
  open: false,
  saving: false,
  username: "",
  display: "",
  password: "",
  error: "",
});

function openJsonModal(title, payload) {
  jsonModal.title = title;
  try {
    jsonModal.content = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  } catch (err) {
    jsonModal.content = String(payload ?? "");
  }
  jsonModal.open = true;
}
function closeJsonModal() {
  jsonModal.open = false;
}

function openPasswordModal(user) {
  if (!user?.username) return;
  passwordModal.open = true;
  passwordModal.saving = false;
  passwordModal.username = user.username;
  passwordModal.display = user.username;
  passwordModal.password = "";
  passwordModal.error = "";
}

function closePasswordModal() {
  passwordModal.open = false;
  passwordModal.saving = false;
  passwordModal.username = "";
  passwordModal.display = "";
  passwordModal.password = "";
  passwordModal.error = "";
}

async function loadUsers() {
  state.loading = true;
  state.error = "";
  try {
    const data = await apiFetch("/admin/dashboard-data", { method: "GET" });
    state.users = Array.isArray(data?.users) ? data.users : [];
    state.currentUser = data?.current_user || null;
    if (auth?.state?.user && state.currentUser?.username === auth.state.user.username) {
      auth.state.user = { ...auth.state.user, api_key: state.currentUser.api_key };
    }
  } catch (err) {
    console.error(err);
    state.error = err?.message || t("adminUsers.error.fetch", "Gagal memuat data pengguna.");
  } finally {
    state.loading = false;
  }
}

async function withReload(action) {
  try {
    await action();
    await loadUsers();
  } catch (err) {
    console.error(err);
    toast.error(err?.message || t("adminUsers.error.generic", "Terjadi kesalahan."));
  }
}

async function promoteUser(user) {
  if (!state.currentUser?.is_owner) {
    return toast.error(t("adminUsers.toast.ownerOnly", "Hanya owner yang bisa ubah peran admin."));
  }
  if (!user?.username) return;
  const confirmed = await confirmDialog({
    title: t("adminUsers.confirm.promoteTitle", "Promosikan admin?"),
    description: t("adminUsers.confirm.promote", 'Promosikan "{user}" menjadi admin?', { user: user.username }),
    confirmText: t("adminUsers.actions.promote", "Promosikan"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;
  await withReload(async () => {
    const payload = {
      user_id: user?.id != null ? String(user.id) : undefined,
      username: user.username,
      is_admin: true,
    };
    await apiFetch("/auth/promote", { method: "POST", body: payload });
    toast.success(t("adminUsers.toast.promoted", "{user} kini admin.", { user: user.username }));
  });
}

async function demoteUser(user) {
  if (!state.currentUser?.is_owner) {
    return toast.error(t("adminUsers.toast.ownerOnly", "Hanya owner yang bisa ubah peran admin."));
  }
  if (!user?.username) return;
  if (state.currentUser?.promoted_by && state.currentUser.promoted_by === user.username) {
    toast.error(t("adminUsers.toast.cannotDemotePromoter", "Tidak boleh mendemote admin yang mempromosikan kamu."));
    return;
  }
  const confirmed = await confirmDialog({
    title: t("adminUsers.confirm.demoteTitle", "Cabut admin?"),
    description: t("adminUsers.confirm.demote", 'Cabut peran admin dari "{user}"?', { user: user.username }),
    confirmText: t("adminUsers.actions.demote", "Cabut"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;
  await withReload(async () => {
    const payload = {
      user_id: user?.id != null ? String(user.id) : undefined,
      username: user.username,
      is_admin: false,
    };
    await apiFetch("/auth/promote", { method: "POST", body: payload });
    toast.success(t("adminUsers.toast.demoted", "{user} diturunkan.", { user: user.username }));
  });
}

async function deleteUser(user) {
  if (!user?.username) return;
  if (state.currentUser?.promoted_by && state.currentUser.promoted_by === user.username) {
    toast.error(t("adminUsers.toast.cannotDeletePromoter", "Tidak boleh menghapus orang yang mempromosikan kamu."));
    return;
  }
  const confirmed = await confirmDialog({
    title: t("adminUsers.confirm.deleteTitle", "Hapus pengguna?"),
    description: t("adminUsers.confirm.delete", 'Hapus user "{user}"?', { user: user.username }),
    confirmText: t("common.delete", "Hapus"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;
  await withReload(async () => {
    await apiFetch(`/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
    toast.success(t("adminUsers.toast.deleted", "{user} dihapus.", { user: user.username }));
  });
}

async function rotateApiKey(user) {
  if (!user?.username) return;
  const self = Boolean(user.is_current);
  const message = self
    ? t(
        "adminUsers.confirm.rotateSelf",
        "Generate API key baru untuk akun kamu? Kamu harus memperbarui Authorization header setelah ini."
      )
    : t(
        "adminUsers.confirm.rotateOther",
        'Generate API key baru untuk "{user}"? Pengguna tersebut harus memakai key baru setelah ini.',
        { user: user.username }
      );
  const confirmed = await confirmDialog({
    title: t("adminUsers.confirm.rotateTitle", "Generate API key baru?"),
    description: message,
    confirmText: t("adminUsers.actions.rotate", "Generate"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;

  rotatingUser.value = user.username;
  try {
    const data = await apiFetch(`/admin/users/${encodeURIComponent(user.id)}/api-key`, {
      method: "POST",
      body: {},
    });
    toast.success(t("adminUsers.toast.rotated", "API key diperbarui."));
    await loadUsers();
    if (self && auth?.state?.user) {
      auth.state.user = { ...auth.state.user, api_key: data?.user?.api_key || "" };
    }
  } catch (err) {
    console.error(err);
    toast.error(err?.message || t("adminUsers.error.generic", "Terjadi kesalahan."));
  } finally {
    rotatingUser.value = "";
  }
}

async function submitPasswordChange() {
  if (passwordModal.saving) return;
  const username = passwordModal.username.trim();
  const raw = passwordModal.password;
  const password = (raw || "").trim();
  if (!username) {
    toast.error(t("adminUsers.error.generic", "Terjadi kesalahan."));
    return;
  }
  if (password.length < 6) {
    toast.warn(t("adminUsers.toast.passwordTooShort", "Password minimal 6 karakter."));
    passwordModal.error = t("adminUsers.toast.passwordTooShort", "Password minimal 6 karakter.");
    return;
  }
  passwordModal.saving = true;
  passwordModal.error = "";
  try {
    const target = state.users.find((u) => u.username === username);
    await apiFetch("/auth/set-password", {
      method: "POST",
      body: { user_id: target?.id, password },
    });
    toast.success(t("adminUsers.toast.passwordSet", "Password diperbarui."));
    closePasswordModal();
  } catch (err) {
    console.error(err);
    const message = err?.message || t("adminUsers.error.generic", "Terjadi kesalahan.");
    passwordModal.error = message;
    toast.error(message);
  } finally {
    passwordModal.saving = false;
  }
}

const sortedUsers = computed(() => {
  const cur = state.currentUser?.username || null;
  return (state.users || []).slice().sort((a, b) => {
    const aYou = (a?.is_current ? 1 : 0) || (cur && a?.username === cur ? 1 : 0);
    const bYou = (b?.is_current ? 1 : 0) || (cur && b?.username === cur ? 1 : 0);
    if (aYou !== bYou) return bYou - aYou;
    // Owner on top, then admin, then user
    const oa = a?.is_owner ? 2 : a?.is_admin ? 1 : 0;
    const ob = b?.is_owner ? 2 : b?.is_admin ? 1 : 0;
    if (oa !== ob) return ob - oa;
    return String(a?.username || "").localeCompare(String(b?.username || ""));
  });
});

onMounted(loadUsers);
</script>

<template>
  <div class="space-y-6">
    <!-- Error -->
    <Alert v-if="state.error" variant="default">
      <AlertTitle>{{ t("adminUsers.error.title", "Terjadi kesalahan") }}</AlertTitle>
      <AlertDescription>{{ state.error }}</AlertDescription>
    </Alert>
    <!-- Users Table -->
    <Card v-else>
      <CardHeader class="">
        <CardTitle class="text-lg">{{ t("adminUsers.table.title", "Daftar Pengguna") }}</CardTitle>
      </CardHeader>
      <Separator />
      <CardContent class="p-6">
        <div v-if="state.loading" class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {{ t("adminUsers.state.loading", "Memuat data pengguna…") }}
        </div>
        <div v-if="!state.loading" class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-[36%]">{{ t("adminUsers.table.columns.username", "Username") }}</TableHead>
                <TableHead class="w-[24%]">ID</TableHead>
                <TableHead class="text-center">{{ t("adminUsers.table.columns.role", "Peran") }}</TableHead>
                <TableHead class="text-right w-[40%]">{{ t("adminUsers.table.columns.actions", "Aksi") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="!sortedUsers.length">
                <TableCell colspan="3" class="text-center text-muted-foreground">
                  {{ t("adminUsers.table.empty", "Belum ada user") }}
                </TableCell>
              </TableRow>

              <TableRow v-for="user in sortedUsers" :key="user.username">
                <TableCell class="font-semibold">
                  {{ user.username }}
                  <Badge v-if="user.is_current" variant="default" class="ml-2 text-[11px] uppercase tracking-wide">
                    {{ t("adminUsers.badges.you", "Kamu") }}
                  </Badge>
                </TableCell>
                <TableCell class="font-mono text-xs text-muted-foreground">{{ user.id }}</TableCell>

                <TableCell class="text-center">
                  <Badge v-if="user.is_owner" variant="destructive">{{ t("adminUsers.roles.owner", "Owner") }}</Badge>
                  <Badge v-else :variant="user.is_admin ? 'default' : 'outline'">
                    {{ user.is_admin ? t("adminUsers.roles.admin", "Admin") : t("adminUsers.roles.user", "User") }}
                  </Badge>
                </TableCell>

                <TableCell class="text-right">
                  <div class="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="rotatingUser === user.username"
                      @click="rotateApiKey(user)">
                      <i class="ti ti-key"></i>

                      {{
                        rotatingUser === user.username
                          ? t("adminUsers.actions.processing", "Memproses…")
                          : t("adminUsers.actions.rotateKey", "Putar API Key")
                      }}
                    </Button>
                    <Button variant="outline" size="sm" @click="openPasswordModal(user)">
                      <i class="ti ti-password-user"></i>
                      {{ t("adminUsers.actions.setPassword", "Setel Password") }}
                    </Button>

                    <template v-if="!user.is_current">
                      <Button
                        v-if="user.is_admin && !user.is_owner && state.currentUser?.is_owner"
                        variant="destructive"
                        size="sm"
                        @click="demoteUser(user)">
                        <i class="ti ti-crown-off"></i>
                        {{ t("adminUsers.actions.demote", "Turunkan") }}
                      </Button>
                      <Button
                        v-else-if="!user.is_owner && state.currentUser?.is_owner"
                        size="sm"
                        @click="promoteUser(user)">
                        <i class="ti ti-crown"></i>
                        {{ t("adminUsers.actions.promote", "Naikkan") }}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        :disabled="user.is_owner || (user.is_admin && !state.currentUser?.is_owner)"
                        @click="deleteUser(user)">
                        <i class="ti ti-trash"></i>
                        {{ t("adminUsers.actions.delete", "Hapus") }}
                      </Button>
                    </template>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <!-- Password Modal -->
    <Dialog v-model:open="passwordModal.open">
      <DialogContent class="max-w-md" @open-auto-focus.prevent @close-auto-focus.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("adminUsers.passwordModal.title", "Setel Password") }}</DialogTitle>
          <DialogDescription>
            {{
              t("adminUsers.passwordModal.description", "Masukkan password baru untuk {user}.", {
                user: passwordModal.display || "-",
              })
            }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <div class="space-y-2">
            <Label class="text-sm font-medium">
              {{ t("adminUsers.passwordModal.label", "Password Baru") }}
            </Label>
            <Input
              type="password"
              autocomplete="new-password"
              :disabled="passwordModal.saving"
              v-model="passwordModal.password"
              :placeholder="t('adminUsers.passwordModal.placeholder', 'Minimal 6 karakter')" />
          </div>
          <p v-if="passwordModal.error" class="text-sm text-destructive">
            {{ passwordModal.error }}
          </p>
        </div>
        <DialogFooter class="flex flex-wrap gap-2">
          <Button variant="outline" :disabled="passwordModal.saving" @click="closePasswordModal">
            {{ t("common.cancel", "Batal") }}
          </Button>
          <Button :disabled="passwordModal.saving" @click="submitPasswordChange">
            {{
              passwordModal.saving
                ? t("adminUsers.actions.processing", "Memproses…")
                : t("adminUsers.passwordModal.save", "Simpan Password")
            }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- JSON Modal -->
    <Dialog v-model:open="jsonModal.open">
      <DialogContent class="max-w-3xl" @open-auto-focus.prevent @close-auto-focus.prevent>
        <DialogHeader>
          <DialogTitle>{{ jsonModal.title }}</DialogTitle>
          <DialogDescription>
            {{ t("adminUsers.json.hint", "Dump data mentah untuk debugging") }}
          </DialogDescription>
        </DialogHeader>
        <div class="max-h-[60vh] overflow-auto rounded-md bg-muted p-4">
          <pre class="text-xs leading-relaxed">{{ jsonModal.content }}</pre>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="closeJsonModal">{{ t("common.close", "Tutup") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
