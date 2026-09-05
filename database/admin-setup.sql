-- ═══════════════════════════════════════════════════════════════════════════════
-- ADMIN USER MANAGEMENT SETUP
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- This script adds admin role support to the Marketing Department 2026 platform.
-- Run this AFTER running supabase-schema.sql
--
-- ═══════════════════════════════════════════════════════════════════════════════

-- Step 1: Add role column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin'));

-- Step 2: Create index for role-based queries
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- Step 3: Admin status lives entirely in the `role` column above — it is
-- independent of `plan` (an admin can be on any billing tier, including
-- free, since admin access isn't a purchased plan). The canonical plan enum
-- is defined in supabase-intelligence-profiles.sql; re-assert it here too so
-- this script still works if run standalone/out of order.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN (
    'free',
    'start','growth','scale','autonomous','enterprise',
    'agency_starter','agency_growth','agency_pro','agency_enterprise'
  ));

-- Step 4: Create admin RLS policies
-- Admin users can view all profiles
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'super_admin'))
    );

-- Admin users can update any profile
CREATE POLICY "Admins can update any profile" ON profiles
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'super_admin'))
    );

-- Admin users can delete any profile (except other admins)
CREATE POLICY "Admins can delete non-admin profiles" ON profiles
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('admin', 'super_admin')
        )
        AND role = 'user'  -- Can only delete regular users
    );

-- Step 5: Admin access to all projects
CREATE POLICY "Admins can view all projects" ON projects
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'super_admin'))
    );

CREATE POLICY "Admins can update all projects" ON projects
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'super_admin'))
    );

-- Step 6: Create admin activity log table
CREATE TABLE IF NOT EXISTS admin_activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,  -- e.g., 'user_created', 'user_updated', 'user_deleted', 'plan_changed'
    target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_log_admin ON admin_activity_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_log_target ON admin_activity_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_activity_log(created_at DESC);

-- RLS for admin activity log
ALTER TABLE admin_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view activity log" ON admin_activity_log
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'super_admin'))
    );

CREATE POLICY "Admins can create activity log" ON admin_activity_log
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'super_admin'))
    );

-- Step 7: Function to promote user to admin
CREATE OR REPLACE FUNCTION promote_to_admin(user_email TEXT, admin_role TEXT DEFAULT 'admin')
RETURNS JSONB AS $$
DECLARE
    target_user_id UUID;
    result JSONB;
BEGIN
    -- Validate admin_role
    IF admin_role NOT IN ('admin', 'super_admin') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid admin role. Use admin or super_admin.');
    END IF;

    -- Find user by email
    SELECT id INTO target_user_id
    FROM auth.users
    WHERE email = user_email
    LIMIT 1;

    IF target_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'User not found with email: ' || user_email);
    END IF;

    -- Update profile to admin (role only — plan/billing is untouched)
    UPDATE profiles
    SET
        role = admin_role,
        updated_at = NOW()
    WHERE id = target_user_id;

    -- Log the action
    INSERT INTO admin_activity_log (admin_id, action, target_user_id, details)
    VALUES (
        auth.uid(),
        'user_promoted_to_admin',
        target_user_id,
        jsonb_build_object('new_role', admin_role, 'email', user_email)
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'User promoted to ' || admin_role,
        'user_id', target_user_id,
        'email', user_email
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 8: Function to demote admin to user
CREATE OR REPLACE FUNCTION demote_to_user(user_email TEXT)
RETURNS JSONB AS $$
DECLARE
    target_user_id UUID;
    result JSONB;
BEGIN
    -- Find user by email
    SELECT id INTO target_user_id
    FROM auth.users
    WHERE email = user_email
    LIMIT 1;

    IF target_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'User not found with email: ' || user_email);
    END IF;

    -- Update profile to user (role only — plan/billing is untouched)
    UPDATE profiles
    SET
        role = 'user',
        updated_at = NOW()
    WHERE id = target_user_id;

    -- Log the action
    INSERT INTO admin_activity_log (admin_id, action, target_user_id, details)
    VALUES (
        auth.uid(),
        'user_demoted_from_admin',
        target_user_id,
        jsonb_build_object('email', user_email)
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'User demoted to regular user',
        'user_id', target_user_id,
        'email', user_email
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIRST ADMIN USER CREATION
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- IMPORTANT: After running this schema, you need to:
--
-- 1. Register a user account through the normal signup process
-- 2. Then run ONE of these commands to make that user an admin:
--
--    For regular admin:
--    UPDATE profiles SET role = 'admin'
--    WHERE email = 'your-email@example.com';
--
--    For super admin:
--    UPDATE profiles SET role = 'super_admin'
--    WHERE email = 'your-email@example.com';
--
-- 3. After that, you can use the admin dashboard to manage other users
--
-- ═══════════════════════════════════════════════════════════════════════════════

-- DONE! Your admin system is now configured.
