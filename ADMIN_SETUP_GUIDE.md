# Admin User Management Setup Guide

This guide walks you through setting up and using the admin user management system for The Marketing Department 2026 platform.

## Overview

The admin system provides:
- ✅ User management interface
- ✅ Role-based access control (User, Admin, Super Admin)
- ✅ User creation, editing, and deletion
- ✅ Activity logging
- ✅ Works with both Supabase and local storage

---

## Setup Instructions

### Option 1: Supabase (Production) Setup

#### Step 1: Run the Database Schema

1. Go to your Supabase project at https://app.supabase.com
2. Navigate to **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the contents of `database/admin-setup.sql`
5. Paste into the SQL Editor
6. Click **Run** to execute

#### Step 2: Create Your First Admin User

**Method A: Register then Promote (Recommended)**

1. Go to your platform's homepage
2. Click "Create Account" and register a new user with your email
3. Go back to Supabase SQL Editor
4. Run this SQL command (replace with your email):

```sql
UPDATE profiles
SET role = 'super_admin', plan = 'admin'
WHERE email = 'your-email@example.com';
```

**Method B: Using Supabase Auth Dashboard**

1. Go to **Authentication > Users** in Supabase
2. Click **Add User**
3. Enter email and password
4. After user is created, go to **SQL Editor** and run:

```sql
UPDATE profiles
SET role = 'super_admin', plan = 'admin'
WHERE email = 'the-email-you-just-created@example.com';
```

#### Step 3: Access the Admin Dashboard

1. Log in to your platform with the admin account
2. Navigate to: `https://your-domain.com/admin/users.html`
3. You should see the User Management dashboard

---

### Option 2: Local Storage (Development/Demo) Setup

For local development without Supabase:

#### Step 1: Create a Regular User

1. Go to your platform's homepage
2. Register a normal user account
3. This creates an entry in localStorage

#### Step 2: Manually Promote to Admin

1. Open Browser DevTools (F12)
2. Go to **Console** tab
3. Run this JavaScript code (replace with your email):

```javascript
// Get all users from localStorage
const users = JSON.parse(localStorage.getItem('seo_agent_users') || '[]');

// Find your user by email
const userIndex = users.findIndex(u => u.email === 'your-email@example.com');

if (userIndex !== -1) {
    // Promote to admin
    users[userIndex].role = 'super_admin';
    users[userIndex].plan = 'admin';

    // Save back to localStorage
    localStorage.setItem('seo_agent_users', JSON.stringify(users));

    // Also update current session if logged in
    const currentUser = JSON.parse(localStorage.getItem('seo_agent_user'));
    if (currentUser && currentUser.email === 'your-email@example.com') {
        currentUser.role = 'super_admin';
        currentUser.plan = 'admin';
        localStorage.setItem('seo_agent_user', JSON.stringify(currentUser));
    }

    console.log('Successfully promoted to admin! Refresh the page.');
} else {
    console.error('User not found!');
}
```

4. Refresh the page
5. Navigate to `/admin/users.html`

---

## User Roles Explained

### User (Default)
- Can access their own dashboard
- Can manage their own projects
- No access to other users' data
- No admin privileges

### Admin
- All User permissions
- Can view all users
- Can create new users
- Can edit any user (except other admins)
- Can delete regular users
- Can access admin dashboard

### Super Admin
- All Admin permissions
- Can promote/demote admins
- Can delete any user including admins
- Full system access
- Should be limited to platform owners

---

## Using the Admin Dashboard

### Accessing the Dashboard

URL: `/admin/users.html`

The dashboard will automatically:
- Check if you're logged in
- Verify you have admin or super_admin role
- Redirect non-admins to the main dashboard

### Creating a New User

1. Click **Create User** button
2. Fill in the form:
   - **Email**: User's email address (required)
   - **Password**: At least 8 characters (required for new users)
   - **First Name**: User's first name (required)
   - **Last Name**: User's last name (required)
   - **Role**: Select user, admin, or super_admin
   - **Plan**: Select free, pro, enterprise, or admin

3. Click **Create User**
4. User will receive a confirmation email (if Supabase email is configured)

### Editing a User

1. Find the user in the table
2. Click the **Edit** (pencil) icon
3. Modify the desired fields
4. Click **Update User**

**Note**: You cannot change email addresses after creation.

### Deleting a User

1. Find the user in the table
2. Click the **Delete** (trash) icon
3. Confirm the deletion
4. User and all their data will be removed

**Warning**: Deletion is permanent and cannot be undone!

---

## Security Best Practices

### 1. Limit Super Admin Accounts
- Only create super_admin for platform owners
- Use regular admin for support staff
- Regularly audit admin accounts

### 2. Use Strong Passwords
- Require at least 12 characters
- Use password managers
- Enable 2FA (if available in Supabase)

### 3. Monitor Admin Activity
- Check the `admin_activity_log` table regularly
- Review who's creating/modifying users
- Investigate suspicious activity

```sql
-- View recent admin activity
SELECT
    al.action,
    al.created_at,
    p.email as admin_email,
    al.details
FROM admin_activity_log al
JOIN profiles p ON p.id = al.admin_id
ORDER BY al.created_at DESC
LIMIT 50;
```

### 4. Regular Security Audits
- Review all admin users quarterly
- Remove inactive admin accounts
- Update admin passwords regularly

---

## Troubleshooting

### "Access Denied" Error

**Problem**: Getting access denied when trying to access admin dashboard

**Solutions**:
1. Verify your account has admin or super_admin role:
   ```sql
   SELECT email, role, plan FROM profiles WHERE email = 'your-email@example.com';
   ```

2. Clear your browser cache and cookies
3. Log out and log back in
4. Check browser console for errors

### Users Not Loading

**Problem**: Admin dashboard shows loading spinner forever

**Solutions**:
1. Check Supabase connection:
   - Go to Settings page
   - Verify Supabase URL and anon key are set
   - Test connection

2. Check RLS policies are enabled:
   ```sql
   SELECT tablename, policyname
   FROM pg_policies
   WHERE tablename = 'profiles';
   ```

3. Check browser console for API errors

### Cannot Create Users

**Problem**: "Failed to create user" error

**Solutions**:
1. **Supabase mode**: Verify email service is configured
2. **Local mode**: Check localStorage quota (may be full)
3. Ensure all required fields are filled
4. Check password meets minimum length (8 characters)

### RLS Errors

**Problem**: "permission denied for table profiles"

**Solution**: Run admin-setup.sql again to create proper RLS policies:
```sql
-- Allow admins to view all profiles
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('admin', 'super_admin')
        )
    );
```

---

## Database Schema Reference

### profiles Table (with admin support)

```sql
Column     | Type    | Description
-----------|---------|-------------
id         | UUID    | User ID (references auth.users)
email      | TEXT    | User's email
firstname  | TEXT    | First name
lastname   | TEXT    | Last name
role       | TEXT    | user | admin | super_admin
plan       | TEXT    | free | pro | enterprise | admin
avatar_url | TEXT    | Profile picture URL
company    | TEXT    | User's company
website    | TEXT    | User's website
timezone   | TEXT    | User's timezone
created_at | TIMESTAMP | Account creation date
updated_at | TIMESTAMP | Last update timestamp
```

### admin_activity_log Table

```sql
Column         | Type    | Description
---------------|---------|-------------
id             | UUID    | Log entry ID
admin_id       | UUID    | Admin who performed action
action         | TEXT    | Action type
target_user_id | UUID    | User affected by action
details        | JSONB   | Additional details
ip_address     | INET    | Admin's IP address
user_agent     | TEXT    | Admin's browser/device
created_at     | TIMESTAMP | When action occurred
```

---

## API Functions

### promote_to_admin(email, role)

Promotes a user to admin role.

```sql
SELECT promote_to_admin('user@example.com', 'admin');
-- Returns: {"success": true, "message": "User promoted to admin"}
```

### demote_to_user(email)

Demotes an admin back to regular user.

```sql
SELECT demote_to_user('admin@example.com');
-- Returns: {"success": true, "message": "User demoted to regular user"}
```

---

## Next Steps

After setting up admin access:

1. ✅ **Create Additional Admins** - Add your team members
2. ✅ **Configure Email Templates** - Customize welcome emails in Supabase
3. ✅ **Set Up 2FA** - Enable two-factor authentication
4. ✅ **Review Security** - Audit RLS policies and permissions
5. ✅ **Monitor Activity** - Set up alerts for admin actions

---

## Support

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section above
2. Review browser console for errors
3. Check Supabase logs (Logs > Database)
4. Verify RLS policies are correct

---

## Summary

You now have a complete admin system with:
- ✅ User management dashboard at `/admin/users.html`
- ✅ Role-based access control
- ✅ Activity logging
- ✅ Supabase + local storage support

**Your first admin user is ready to manage the platform!**
