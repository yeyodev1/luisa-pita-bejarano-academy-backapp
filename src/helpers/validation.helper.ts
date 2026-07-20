import { isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";

export function requireObjectId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !isValidObjectId(value)) {
    throw new CustomError(`Invalid ${field}`, 400);
  }
  return value;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CustomError(`${field} is required`, 400);
  }
  return value.trim();
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function pagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export function asDate(value: unknown, field: string): Date {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new CustomError(`Invalid ${field}`, 400);
  }
  return date;
}
