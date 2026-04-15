ALTER TABLE "user_shop_roles" ADD COLUMN IF NOT EXISTS "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL;
