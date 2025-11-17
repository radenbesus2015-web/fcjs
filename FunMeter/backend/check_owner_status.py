#!/usr/bin/env python3
"""
Script untuk mengecek status owner dan password di database
"""

from db.supabase_client import get_client, get_default_org_id

def check_owner_status():
    client = get_client()
    org_id = get_default_org_id()
    
    print(f"Checking owner status for org_id: {org_id}\n")
    
    # Check users table
    print("=== USERS TABLE ===")
    users_res = client.table("users").select(
        "id, username, is_admin, is_owner, created_at"
    ).eq("org_id", org_id).eq("is_owner", True).execute()
    
    owners = users_res.data if hasattr(users_res, 'data') else []
    
    if not owners:
        print("❌ No owner found in users table!")
        print("\nSuggestion: Register the first user to create an owner account")
        return
    
    for owner in owners:
        print(f"✅ Owner found:")
        print(f"   - ID: {owner.get('id')}")
        print(f"   - Username: {owner.get('username')}")
        print(f"   - is_admin: {owner.get('is_admin')}")
        print(f"   - is_owner: {owner.get('is_owner')}")
        print(f"   - created_at: {owner.get('created_at')}")
        
        # Check if password exists
        username = owner.get('username')
        print(f"\n=== PASSWORD STATUS FOR {username} ===")
        pwd_res = client.table("user_passwords").select(
            "username, set_at, set_by"
        ).eq("org_id", org_id).eq("username", username).execute()
        
        passwords = pwd_res.data if hasattr(pwd_res, 'data') else []
        
        if not passwords:
            print(f"❌ No password set for {username}!")
            print(f"\n🔧 SOLUTION:")
            print(f"   Run this command to set password:")
            print(f"   python -c \"from services.passwords import set_password; set_password('{username}', 'YOUR_PASSWORD', set_by='system')\"")
        else:
            pwd = passwords[0]
            print(f"✅ Password exists:")
            print(f"   - set_at: {pwd.get('set_at')}")
            print(f"   - set_by: {pwd.get('set_by')}")
            print(f"\n✅ Owner should be able to login with username and password")

if __name__ == "__main__":
    try:
        check_owner_status()
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
