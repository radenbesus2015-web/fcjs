"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { request } from "@/lib/api";
import { toast } from "@/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Icon } from "@/components/common/Icon";

interface User {
  id: string;
  username: string;
  is_admin: boolean;
  is_owner: boolean;
  is_current: boolean;
  api_key?: string;
}

interface CurrentUser extends User {
  promoted_by?: string;
}

interface DashboardData {
  users: User[];
  current_user: CurrentUser;
}

export default function AdminUsersPage() {
  const { t } = useI18n();
  const { user, updateUser } = useAuth();
  
  // Permission helper functions based on RBAC
  const canPromote = (currentUser: CurrentUser | null, targetUser: User): boolean => {
    if (!currentUser) return false;
    // Admin tidak boleh menaikkan user menjadi admin; hanya owner yang bisa
    if (!currentUser.is_owner) return false;
    return !targetUser.is_admin && !targetUser.is_owner;
  };
  
  const canDemote = (currentUser: CurrentUser | null, targetUser: User): boolean => {
    if (!currentUser) return false;
    // Admin tidak boleh menurunkan admin lain; hanya owner yang bisa
    if (!currentUser.is_owner) return false;
    return targetUser.is_admin && !targetUser.is_owner && !targetUser.is_current;
  };
  
  const canRotateApi = (currentUser: CurrentUser | null, targetUser: User): boolean => {
    if (!currentUser) return false;
    // Owner can rotate all
    if (currentUser.is_owner) return true;
    // Admin can rotate self and user (not owner, not other admin)
    if (currentUser.is_admin) {
      if (targetUser.is_current) return true; // own account
      return !targetUser.is_owner && !targetUser.is_admin; // only user
    }
    // User can only rotate self
    return targetUser.is_current;
  };
  
  const canDelete = (currentUser: CurrentUser | null, targetUser: User): boolean => {
    if (!currentUser) return false;
    if (targetUser.is_current) return true; // can delete own account
    // Owner can delete admin and user (not owner)
    if (currentUser.is_owner) {
      return !targetUser.is_owner;
    }
    // Admin can only delete users (not owner, not other admin)
    if (currentUser.is_admin) {
      return !targetUser.is_owner && !targetUser.is_admin;
    }
    // User cannot delete others
    return false;
  };
  
  const canEditPassword = (currentUser: CurrentUser | null, targetUser: User): boolean => {
    if (!currentUser) return false;
    // Owner can edit all passwords
    if (currentUser.is_owner) return true;
    // Admin can only edit self password and users (not owner, not other admin)
    if (currentUser.is_admin) {
      if (targetUser.is_current) return true; // own account
      return !targetUser.is_owner && !targetUser.is_admin; // only users
    }
    // User can only edit self password
    return targetUser.is_current;
  };
  
  const [state, setState] = useState({
    loading: true,
    error: "",
    users: [] as User[],
    currentUser: null as CurrentUser | null,
  });

  const [rotatingUser, setRotatingUser] = useState("");
  const [jsonModal, setJsonModal] = useState({ open: false, title: "", content: "" });
  const [passwordModal, setPasswordModal] = useState({
    open: false,
    saving: false,
    username: "",
    display: "",
    password: "",
    error: "",
  });

  const [confirmModal, setConfirmModal] = useState({
    open: false,
    processing: false,
    title: "",
    body: "",
    confirmLabel: "",
    variant: "default" as "default" | "destructive" | "outline",
    onConfirm: null as null | (() => Promise<void> | void),
  });

  const openConfirm = (opts: { title?: string; body: string; confirmLabel: string; variant?: "default" | "destructive" | "outline"; onConfirm: () => Promise<void> | void; }) => {
    setConfirmModal({
      open: true,
      processing: false,
      title: opts.title || t("adminUsers.confirm.title", "Confirm"),
      body: opts.body,
      confirmLabel: opts.confirmLabel,
      variant: opts.variant || "default",
      onConfirm: opts.onConfirm,
    });
  };

  const openJsonModal = (title: string, payload: unknown) => {
    setJsonModal({
      open: true,
      title,
      content: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
    });
  };

  const closeJsonModal = () => {
    setJsonModal({ open: false, title: "", content: "" });
  };

  const openPasswordModal = (userToEdit: User) => {
    if (!canEditPassword(state.currentUser, userToEdit)) {
      return toast.error(t("adminUsers.toast.noPermission", "You do not have permission to perform this action."));
    }
    if (!userToEdit?.username) return;
    setPasswordModal({
      open: true,
      saving: false,
      username: userToEdit.username,
      display: userToEdit.username,
      password: "",
      error: "",
    });
  };

  const closePasswordModal = () => {
    setPasswordModal({
      open: false,
      saving: false,
      username: "",
      display: "",
      password: "",
      error: "",
    });
  };

  const loadUsers = async () => {
    setState(prev => ({ ...prev, loading: true, error: "" }));
    try {
      const data = await request<DashboardData>("/admin/dashboard-data", { method: "GET" });
      
      setState(prev => ({
        ...prev,
        users: Array.isArray(data?.users) ? data.users : [],
        currentUser: data?.current_user || null,
        loading: false
      }));

      // Update auth user if current user matches
      if (user && data?.current_user?.username === user.username) {
        updateUser({ ...user, api_key: data.current_user.api_key });
      }
    } catch (err: unknown) {
      const error = err as { message?: string };
      console.error(err);
      setState(prev => ({
        ...prev,
        error: error?.message || t("adminUsers.error.fetch", "Gagal memuat data pengguna."),
        loading: false
      }));
    }
  };

  const withReload = async (action: () => Promise<void>) => {
    try {
      await action();
      await loadUsers();
    } catch (err: unknown) {
      const error = err as { message?: string };
      console.error(err);
      toast.error(error?.message || t("adminUsers.error.generic", "Terjadi kesalahan."));
    }
  };

  const promoteUser = async (userToPromote: User) => {
    if (!canPromote(state.currentUser, userToPromote)) {
      return toast.error(t("adminUsers.toast.noPermission", "You do not have permission to perform this action."));
    }
    if (!userToPromote?.username) return;
    
    openConfirm({
      body: t("adminUsers.confirm.promote", 'Promote "{user}" to admin?', { user: userToPromote.username }),
      confirmLabel: t("adminUsers.actions.promote", "Promote"),
      onConfirm: async () => {
        await withReload(async () => {
          const payload = {
            user_id: userToPromote?.id != null ? String(userToPromote.id) : undefined,
            username: userToPromote.username,
            is_admin: true,
          };
          await request("/auth/promote", { method: "POST", body: payload });
          toast.success(t("adminUsers.toast.promoted", "{user} is now an admin.", { user: userToPromote.username }));
        });
      },
    });
  };

  const demoteUser = async (userToDemote: User) => {
    if (!canDemote(state.currentUser, userToDemote)) {
      return toast.error(t("adminUsers.toast.noPermission", "You do not have permission to perform this action."));
    }
    if (!userToDemote?.username) return;
    
    if (state.currentUser?.promoted_by && state.currentUser.promoted_by === userToDemote.username) {
      toast.error(t("adminUsers.toast.cannotDemotePromoter", "Cannot demote the admin who promoted you."));
      return;
    }
    
    openConfirm({
      body: t("adminUsers.confirm.demote", 'Remove admin role from "{user}"?', { user: userToDemote.username }),
      confirmLabel: t("adminUsers.actions.demote", "Demote"),
      variant: "destructive",
      onConfirm: async () => {
        await withReload(async () => {
          const payload = {
            user_id: userToDemote?.id != null ? String(userToDemote.id) : undefined,
            username: userToDemote.username,
            is_admin: false,
          };
          await request("/auth/promote", { method: "POST", body: payload });
          toast.success(t("adminUsers.toast.demoted", "{user} has been demoted.", { user: userToDemote.username }));
        });
      },
    });
  };

  const deleteUser = async (userToDelete: User) => {
    if (!canDelete(state.currentUser, userToDelete)) {
      return toast.error(t("adminUsers.toast.noPermission", "You do not have permission to perform this action."));
    }
    if (!userToDelete?.username) return;
    
    if (!userToDelete.is_current && state.currentUser?.promoted_by && state.currentUser.promoted_by === userToDelete.username) {
      toast.error(t("adminUsers.toast.cannotDeletePromoter", "Cannot delete the user who promoted you."));
      return;
    }
    
    openConfirm({
      body: t("adminUsers.confirm.delete", 'Delete user "{user}"?', { user: userToDelete.username }),
      confirmLabel: t("adminUsers.actions.delete", "Delete"),
      variant: "destructive",
      onConfirm: async () => {
        await withReload(async () => {
          await request(`/admin/users/${encodeURIComponent(userToDelete.id)}`, { method: "DELETE" });
          toast.success(t("adminUsers.toast.deleted", "{user} has been deleted.", { user: userToDelete.username }));
        });
      },
    });
  };

  const rotateApiKey = async (userToRotate: User) => {
    if (!canRotateApi(state.currentUser, userToRotate)) {
      return toast.error(t("adminUsers.toast.noPermission", "You do not have permission to perform this action."));
    }
    if (!userToRotate?.username) return;
    
    const self = Boolean(userToRotate.is_current);
    const message = self
      ? t("adminUsers.confirm.rotateSelf", "Generate API key baru untuk akun kamu? Kamu harus memperbarui Authorization header setelah ini.")
      : t("adminUsers.confirm.rotateOther", 'Generate API key baru untuk "{user}"? Pengguna tersebut harus memakai key baru setelah ini.', { user: userToRotate.username });
    
    openConfirm({
      body: message,
      confirmLabel: t("adminUsers.actions.rotateKey", "Putar API Key"),
      onConfirm: async () => {
        setRotatingUser(userToRotate.username);
        try {
          const data = await request<{ user: User }>(`/admin/users/${encodeURIComponent(userToRotate.id)}/api-key`, {
            method: "POST",
            body: {},
          });
          toast.success(t("adminUsers.toast.rotated", "API key diperbarui."));
          await loadUsers();
          if (self && user) {
            updateUser({ ...user, api_key: data?.user?.api_key || "" });
          }
        } catch (err: unknown) {
          const error = err as { message?: string };
          console.error(err);
          toast.error(error?.message || t("adminUsers.error.generic", "Terjadi kesalahan."));
        } finally {
          setRotatingUser("");
        }
      },
    });
  };

  const submitPasswordChange = async () => {
    if (passwordModal.saving) return;
    
    const username = passwordModal.username.trim();
    const password = (passwordModal.password || "").trim();
    
    if (!username) {
      toast.error(t("adminUsers.error.generic", "Terjadi kesalahan."));
      return;
    }
    
    if (password.length < 6) {
      const message = t("adminUsers.toast.passwordTooShort", "Password minimal 6 karakter.");
      toast.warn(message);
      setPasswordModal(prev => ({ ...prev, error: message }));
      return;
    }

    setPasswordModal(prev => ({ ...prev, saving: true, error: "" }));
    try {
      const target = state.users.find((u) => u.username === username);
      await request("/auth/set-password", {
        method: "POST",
        body: { user_id: target?.id, password },
      });
      
      toast.success(t("adminUsers.toast.passwordSet", "Password diperbarui."));
      closePasswordModal();
    } catch (err: unknown) {
      const error = err as { message?: string };
      console.error(err);
      const message = error?.message || t("adminUsers.error.generic", "Terjadi kesalahan.");
      setPasswordModal(prev => ({ ...prev, error: message }));
      toast.error(message);
    } finally {
      setPasswordModal(prev => ({ ...prev, saving: false }));
    }
  };

  const sortedUsers = (() => {
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
  })();

  useEffect(() => {
    loadUsers();
  }, []);

  return (
    <div className="space-y-6">
      {/* Error */}
      {state.error && (
        <Alert variant="default">
          <AlertTitle>{t("adminUsers.error.title", "Terjadi kesalahan")}</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* Users Table */}
      {!state.error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("adminUsers.table.title", "Daftar Pengguna")}</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="p-6">
            {state.loading ? (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {t("adminUsers.state.loading", "Memuat data pengguna…")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[36%]">{t("adminUsers.table.columns.username", "Username")}</TableHead>
                      <TableHead className="w-[24%]">ID</TableHead>
                      <TableHead className="text-center">{t("adminUsers.table.columns.role", "Peran")}</TableHead>
                      <TableHead className="text-right w-[40%]">{t("adminUsers.table.columns.actions", "Aksi")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!sortedUsers.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          {t("adminUsers.table.empty", "Belum ada user")}
                        </TableCell>
                      </TableRow>
                    )}

                    {sortedUsers.map((userItem) => (
                      <TableRow key={userItem.username}>
                        <TableCell className="font-semibold">
                          {userItem.username}
                          {userItem.is_current && (
                            <Badge variant="default" className="ml-2 text-[11px] uppercase tracking-wide">
                              {t("adminUsers.badges.you", "Kamu")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{userItem.id}</TableCell>

                        <TableCell className="text-center">
                          {userItem.is_owner ? (
                            <Badge variant="destructive">{t("adminUsers.roles.owner", "Owner")}</Badge>
                          ) : (
                            <Badge variant={userItem.is_admin ? "default" : "outline"}>
                              {userItem.is_admin ? t("adminUsers.roles.admin", "Admin") : t("adminUsers.roles.user", "User")}
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {canRotateApi(state.currentUser, userItem) && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={rotatingUser === userItem.username}
                                onClick={() => rotateApiKey(userItem)}
                                className="gap-2"
                              >
                                <Icon name="Key" className="h-4 w-4 flex-shrink-0" />
                                <span className="hidden sm:inline">
                                  {rotatingUser === userItem.username
                                    ? t("adminUsers.actions.processing", "Memproses…")
                                    : t("adminUsers.actions.rotateKey", "Putar API Key")}
                                </span>
                              </Button>
                            )}
                            
                            {canEditPassword(state.currentUser, userItem) && (
                              <Button variant="outline" size="sm" onClick={() => openPasswordModal(userItem)} className="gap-2">
                                <Icon name="Lock" className="h-4 w-4 flex-shrink-0" />
                                <span className="hidden sm:inline">{t("adminUsers.actions.setPassword", "Setel Password")}</span>
                              </Button>
                            )}

                            {canPromote(state.currentUser, userItem) && (
                              <Button size="sm" onClick={() => promoteUser(userItem)} className="gap-2">
                                <Icon name="Crown" className="h-4 w-4 flex-shrink-0" />
                                <span className="hidden sm:inline">{t("adminUsers.actions.promote", "Promote")}</span>
                              </Button>
                            )}
                            
                            {canDemote(state.currentUser, userItem) && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => demoteUser(userItem)}
                                className="gap-2"
                              >
                                <Icon name="Crown" className="h-4 w-4 flex-shrink-0" />
                                <span className="hidden sm:inline">{t("adminUsers.actions.demote", "Demote")}</span>
                              </Button>
                            )}
                            
                            {canDelete(state.currentUser, userItem) && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => deleteUser(userItem)}
                                className="gap-2"
                              >
                                <Icon name="Trash" className="h-4 w-4 flex-shrink-0" />
                                <span className="hidden sm:inline">
                                  {userItem.is_current 
                                    ? t("adminUsers.actions.deleteAccount", "Hapus Akun") 
                                    : t("adminUsers.actions.delete", "Hapus")}
                                </span>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Password Modal */}
      <Dialog open={passwordModal.open} onOpenChange={(open) => !open && closePasswordModal()}>
        <DialogContent className="max-w-md border border-border bg-background rounded-2xl" hideOverlay onEscapeKeyDown={() => closePasswordModal()}>
          <DialogHeader>
            <DialogTitle>{t("adminUsers.passwordModal.title", "Setel Password")}</DialogTitle>
            <DialogDescription>
              {t("adminUsers.passwordModal.description", "Masukkan password baru untuk {user}.", {
                user: passwordModal.display || "-",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("adminUsers.passwordModal.label", "Password Baru")}
              </Label>
              <Input
                type="password"
                autoComplete="new-password"
                disabled={passwordModal.saving}
                value={passwordModal.password}
                onChange={(e) => setPasswordModal(prev => ({ ...prev, password: e.target.value }))}
                placeholder={t("adminUsers.passwordModal.placeholder", "Minimal 6 karakter")}
              />
            </div>
            {passwordModal.error && (
              <p className="text-sm text-destructive">
                {passwordModal.error}
              </p>
            )}
          </div>
          <DialogFooter className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={passwordModal.saving} onClick={closePasswordModal}>
              {t("common.cancel", "Batal")}
            </Button>
            <Button disabled={passwordModal.saving} onClick={submitPasswordChange}>
              {passwordModal.saving
                ? t("adminUsers.actions.processing", "Memproses…")
                : t("adminUsers.passwordModal.save", "Simpan Password")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Modal */}
      <Dialog open={confirmModal.open} onOpenChange={(open) => setConfirmModal(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-md border border-border bg-background rounded-2xl" hideOverlay onEscapeKeyDown={() => setConfirmModal(prev => ({ ...prev, open: false }))}>
          <DialogHeader>
            <DialogTitle>{confirmModal.title || t("adminUsers.confirm.title", "Confirm")}</DialogTitle>
            <DialogDescription>{confirmModal.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={confirmModal.processing} onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))}>
              {t("common.cancel", "Batal")}
            </Button>
            <Button
              variant={confirmModal.variant}
              disabled={confirmModal.processing}
              onClick={async () => {
                if (!confirmModal.onConfirm) { setConfirmModal(prev => ({ ...prev, open: false })); return; }
                setConfirmModal(prev => ({ ...prev, processing: true }));
                try {
                  await confirmModal.onConfirm();
                } finally {
                  setConfirmModal(prev => ({ ...prev, processing: false, open: false }));
                }
              }}
            >
              {confirmModal.confirmLabel || t("common.ok", "OK")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* JSON Modal */}
      <Dialog open={jsonModal.open} onOpenChange={(open) => setJsonModal(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-3xl border border-border bg-background rounded-2xl" hideOverlay onEscapeKeyDown={() => setJsonModal(prev => ({ ...prev, open: false }))}>
          <DialogHeader>
            <DialogTitle>{jsonModal.title}</DialogTitle>
            <DialogDescription>
              {t("adminUsers.json.hint", "Dump data mentah untuk debugging")}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4">
            <pre className="text-xs leading-relaxed">{jsonModal.content}</pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeJsonModal}>
              {t("common.close", "Tutup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
