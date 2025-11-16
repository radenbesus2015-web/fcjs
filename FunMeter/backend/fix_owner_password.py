#!/usr/bin/env python3
"""
Script untuk set password owner tsabitfi
"""

from services.passwords import set_password

# Set password untuk owner
username = "tsabitfi"
password = "tsabitfi"

try:
    print(f"Setting password for user: {username}")
    set_password(username, password, set_by="system")
    print(f"✅ Password berhasil di-set!")
    print(f"\nSekarang Anda bisa login dengan:")
    print(f"   Username: {username}")
    print(f"   Password: {password}")
except Exception as e:
    print(f"❌ Gagal set password: {e}")
    import traceback
    traceback.print_exc()
