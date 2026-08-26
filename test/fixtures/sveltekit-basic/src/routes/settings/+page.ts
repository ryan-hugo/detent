import { PUBLIC_API_TOKEN } from "$env/static/public";

export function preload() {
  return { token: PUBLIC_API_TOKEN };
}
