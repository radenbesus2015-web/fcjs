#!/usr/bin/env python3
"""
Script untuk set password owner
Usage: python set_owner_password.py <username> <password>
"""

import sys
from services.passwords import set_password
from db.supabase_client import get_client, get_default_org_id

def main():
    if len(sys.argv) < 3:
        print("Usage: python set_owner_password.py <username> <password>")
        print("\nExample:")
        print("  python set_owner_password.py admin mypassword123")
        sys.exit(1)
    
    username = sys.argv[1]
    password = sys.argv[2]
    
    # Verify user exists and is owner
    client = get_client()
    org_id = get_default_org_id()
    
    user_res = client.table("users").select(
        "id, username, is_owner"
    ).eq("org_id", org_id).eq("username", username).limit(1).execute()
    
    users = user_res.data if hasattr(user_res, 'data') else []
    
    if not users:
        print(f"❌ User '{username}' not found!")
        sys.exit(1)
    
    user = users[0]
    if not user.get('is_owner'):
        print(f"⚠️  Warning: User '{username}' is not an owner!")
        print(f"   is_owner: {user.get('is_owner')}")
        response = input("Continue anyway? (y/n): ")
        if response.lower() != 'y':
            print("Cancelled.")
            sys.exit(0)
    
    # Set password
    try:
        set_password(username, password, set_by="system_script")
        print(f"✅ Password successfully set for user: {username}")
        print(f"\nYou can now login with:")
        print(f"   Username: {username}")
        print(f"   Password: {password}")
    except Exception as e:
        print(f"❌ Failed to set password: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
