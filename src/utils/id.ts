// src/utils/id.ts
import { ulid } from "ulid";

export function newId() {
  return ulid();
}

export function shortCode(len = 6) {
  const base = ulid().replace(/[^A-Z0-9]/g, "");
  return base.slice(-len);
}
