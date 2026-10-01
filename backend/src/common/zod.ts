import { z } from 'zod';

export { z };
export const uuid = z.string().uuid();
export const num = z.coerce.number().finite();
export const nonneg = num.min(0);
export const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => schema.parse(data);
