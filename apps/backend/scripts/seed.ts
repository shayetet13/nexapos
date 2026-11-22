/**
 * Seed script - run after migrations.
 * SUPABASE_USER_ID มาจาก Supabase Auth → Users
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env') });

async function seed() {
  const { db } = await import('../src/db/index.js');
  const { shops, branches, products, users, userShopRoles, branchStock } = await import('../src/db/schema.js');

  const SUPABASE_USER_ID = process.env.SUPABASE_USER_ID ?? '';
  if (!SUPABASE_USER_ID) {
    console.error('Set SUPABASE_USER_ID (from Supabase Auth users)');
    process.exit(1);
  }

  const [shop] = await db.insert(shops).values({ name: 'My Shop' }).returning();
  if (!shop) throw new Error('Failed to create shop');

  const [branch] = await db.insert(branches).values({ shop_id: shop.id, name: 'Main Branch' }).returning();
  if (!branch) throw new Error('Failed to create branch');

  await db.insert(users).values({ id: SUPABASE_USER_ID, email: 'demo@pos.cloud' }).onConflictDoNothing({ target: users.id });

  await db.insert(userShopRoles).values({
    user_id: SUPABASE_USER_ID,
    shop_id: shop.id,
    role: 'owner',
  }).onConflictDoNothing({ target: [userShopRoles.user_id, userShopRoles.shop_id] });

  const [p1, p2] = await db.insert(products).values([
    { shop_id: shop.id, name: 'Product A', price: '99.00', sku: 'PA001' },
    { shop_id: shop.id, name: 'Product B', price: '149.50', sku: 'PB002' },
  ]).returning();

  if (p1 && p2 && branch) {
    await db.insert(branchStock).values([
      { branch_id: branch.id, product_id: p1.id, quantity: 100 },
      { branch_id: branch.id, product_id: p2.id, quantity: 50 },
    ]).onConflictDoNothing({ target: [branchStock.branch_id, branchStock.product_id] });
  }

  console.log('Seed done. Shop:', shop.id, 'Branch:', branch?.id);
}

seed().catch(console.error).finally(() => process.exit(0));
