import { db } from '../db/index.js';
import { events } from '../db/schema.js';

export const eventRepository = {
  insert(data: {
    shop_id: string;
    branch_id?: string;
    type: string;
    payload: Record<string, unknown>;
  }) {
    return db.insert(events).values(data).returning().then((rows) => rows[0] ?? null);
  },
};
